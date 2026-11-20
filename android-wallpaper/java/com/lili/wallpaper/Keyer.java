package com.lili.wallpaper;

/**
 * Cuts the chroma-key background (Chroma.KEY, magenta) out of a capture of the
 * home screen, leaving the launcher's icons, labels and widgets on transparent.
 * Plain Java on an int[] of ARGB pixels, no Android: it runs on a desktop JVM
 * as it does on the phone.
 *
 * A pixel is background when it is magenta-ish whatever its brightness, so the
 * launcher's dark scrims and dimming (a darker magenta) still key out:
 *   max(r, b) >= MIN,  g <= G_HARD * max(r, b),  |r - b| <= D_HARD * max(r, b).
 * G_HARD and D_HARD are 0.15, tighter than 0.25 / 0.2: at those, a purple icon
 * such as Material Purple (#9C27B0) would be cut out too.
 *
 * Background becomes transparent. A pixel next to background that is not
 * background itself is an edge (an icon's anti-aliased rim, a label's
 * outline): it is taken as a blend of the key around it (K, the mean of its
 * background neighbours) and the solid foreground beside it (F, the mean of its
 * neighbours that are not magenta at all), P = t * K + (1 - t) * F, and t is
 * solved on the line from F to K. With no solid neighbour (thin text) t is how
 * magenta it looks (magenta(): 1 at the hard thresholds, 0 at G_SOFT/D_SOFT).
 * The edge gets alpha 1 - t and its colour with the key's share taken out, so
 * it keeps no magenta fringe.
 */
final class Keyer {

    static final int MIN = 30;              /* darker than this is never background: a dark icon, a shadow */
    static final float G_HARD = 0.15f, D_HARD = 0.15f;      /* background */
    private static final float G_SOFT = 0.5f, D_SOFT = 0.4f; /* ...where magenta() reaches 0 */
    private static final float GONE = 0.06f;                 /* an edge fainter than this is dropped */
    private static final int MIN_SPAN = 3000;                /* |K - F|^2 below this: F too close to the key to solve */

    private Keyer() {}

    /** Background: magenta-ish at any brightness. */
    static boolean background(int c) {
        int r = c >>> 16 & 255, g = c >>> 8 & 255, b = c & 255;
        int mx = Math.max(r, b);
        return mx >= MIN && g <= G_HARD * mx && Math.abs(r - b) <= D_HARD * mx;
    }

    /** How magenta a pixel looks: 1 for background, 0 for anything clearly not. */
    static float magenta(int c) {
        int r = c >>> 16 & 255, g = c >>> 8 & 255, b = c & 255;
        int mx = Math.max(r, b);
        if (mx < MIN) return 0f;
        float gr = (float) g / mx, d = (float) Math.abs(r - b) / mx;
        return ramp((G_SOFT - gr) / (G_SOFT - G_HARD)) * ramp((D_SOFT - d) / (D_SOFT - D_HARD));
    }

    private static float ramp(float v) {
        return v < 0 ? 0 : v > 1 ? 1 : v;
    }

    /**
     * Keys `px` (w x h, ARGB) in place: background transparent, edges soft.
     * Returns how many pixels were background.
     */
    static int key(int[] px, int w, int h) {
        int n = w * h;
        boolean[] bg = new boolean[n];
        int count = 0;
        for (int i = 0; i < n; i++) {
            if (background(px[i])) {
                bg[i] = true;
                count++;
            }
        }
        /* the edges: not background, with background next to them */
        boolean[] edge = new boolean[n];
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                if (bg[i]) continue;
                for (int dy = -1; dy <= 1 && !edge[i]; dy++) {
                    int yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = x + dx;
                        if (xx >= 0 && xx < w && bg[yy * w + xx]) {
                            edge[i] = true;
                            break;
                        }
                    }
                }
            }
        }
        /* each edge from the frame as it was (all written after): K from the background
         * around it, F from the solid foreground beside it - neither background nor edge */
        int[] at = new int[64], val = new int[64];
        int edges = 0;
        for (int y = 0; y < h; y++) {
            for (int x = 0; x < w; x++) {
                int i = y * w + x;
                if (!edge[i]) continue;
                int kr = 0, kg = 0, kb = 0, k = 0, fr = 0, fg = 0, fb = 0, f = 0;
                for (int dy = -1; dy <= 1; dy++) {
                    int yy = y + dy;
                    if (yy < 0 || yy >= h) continue;
                    for (int dx = -1; dx <= 1; dx++) {
                        int xx = x + dx;
                        if (xx < 0 || xx >= w || (dx == 0 && dy == 0)) continue;
                        int j = yy * w + xx, c = px[j];
                        if (bg[j]) {
                            kr += c >>> 16 & 255; kg += c >>> 8 & 255; kb += c & 255; k++;
                        } else if (!edge[j] && magenta(c) == 0f) {
                            fr += c >>> 16 & 255; fg += c >>> 8 & 255; fb += c & 255; f++;
                        }
                    }
                }
                int c = px[i];
                float pr = c >>> 16 & 255, pg = c >>> 8 & 255, pb = c & 255;
                float Kr = (float) kr / k, Kg = (float) kg / k, Kb = (float) kb / k;
                float t = -1;
                if (f > 0) {
                    float Fr = (float) fr / f, Fg = (float) fg / f, Fb = (float) fb / f;
                    float er = Kr - Fr, eg = Kg - Fg, eb = Kb - Fb;
                    float span = er * er + eg * eg + eb * eb;
                    if (span >= MIN_SPAN) t = ramp(((pr - Fr) * er + (pg - Fg) * eg + (pb - Fb) * eb) / span);
                }
                if (t < 0) t = magenta(c);
                if (t <= 0) continue;                         /* solid: stays as it is */
                float a = 1 - t;
                int out;
                if (a < GONE) {
                    out = 0;
                } else {
                    out = Math.round(a * 255) << 24 | unmix(pr, Kr, t, a) << 16 | unmix(pg, Kg, t, a) << 8 | unmix(pb, Kb, t, a);
                }
                if (edges == at.length) {
                    at = java.util.Arrays.copyOf(at, edges * 2);
                    val = java.util.Arrays.copyOf(val, edges * 2);
                }
                at[edges] = i;
                val[edges] = out;
                edges++;
            }
        }
        for (int e = 0; e < edges; e++) px[at[e]] = val[e];
        for (int i = 0; i < n; i++) if (bg[i]) px[i] = 0;
        return count;
    }

    /* p = t * key + a * f, so f = (p - t * key) / a */
    private static int unmix(float p, float key, float t, float a) {
        int f = Math.round((p - t * key) / a);
        return f < 0 ? 0 : f > 255 ? 255 : f;
    }
}
