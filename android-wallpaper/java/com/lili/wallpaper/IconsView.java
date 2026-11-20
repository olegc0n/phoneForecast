package com.lili.wallpaper;

import android.content.Context;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Paint;
import android.graphics.Rect;
import android.graphics.RectF;
import android.text.TextPaint;
import android.text.TextUtils;
import android.text.format.DateFormat;
import android.text.format.DateUtils;
import android.util.TypedValue;
import android.view.View;

import java.util.Date;

/**
 * The preview's icons layer, over Lili and under the controls: what the home
 * screen puts on top of her, so the user sees how big she is next to icons and
 * whether the dock hides her.
 *
 *   NONE   nothing ("Show icons" off)
 *   DRAWN  a mock launcher, drawn here in dp, no permission needed: a status
 *          bar, a clock and date widget, two rows of app icons with labels and
 *          one folder, a dock of four, a search pill and the gesture handle.
 *          An approximation: rounded squares in muted, nearly opaque mid-tones
 *          that read over a white photo, a black one and every preset (3:1, group
 *          I of check-wallpaper.js), light labels over a dark shadow.
 *   REAL   the user's own home screen, captured (HomeShot), scaled to the view.
 *
 * Every colour is a constant below; group I checks them as it does the settings
 * screen's.
 */
final class IconsView extends View {

    static final int NONE = 0, DRAWN = 1, REAL = 2;

    /* ---- every colour of the mock (group I of check-wallpaper.js reads these lines) ---- */
    static final int MOCK_TEXT = 0xFFF5F7FA;        /* labels, the clock, the status bar, the handle */
    static final int MOCK_SHADOW = 0xCC000000;      /* ...the halo under them, so they read over a bright photo */
    static final int MOCK_GLYPH = 0xFFF5F7FA;       /* the mark inside an icon */
    static final int MOCK_BLUE = 0xF26486C9;        /* icon fills: mid-tones, 3:1 over white, black and every preset */
    static final int MOCK_GREEN = 0xF258926B;
    static final int MOCK_ORANGE = 0xF2B77743;
    static final int MOCK_RED = 0xF2D3646F;
    static final int MOCK_PURPLE = 0xF29975CA;
    static final int MOCK_TEAL = 0xF2479195;
    static final int MOCK_GREY = 0xF2808691;
    static final int MOCK_FOLDER = 0xF27E8698;      /* the folder, under its four small icons */
    static final int MOCK_PILL = 0xF27E8793;        /* the search pill */

    private static final int[] FILLS = { MOCK_BLUE, MOCK_GREEN, MOCK_ORANGE, MOCK_RED, MOCK_PURPLE, MOCK_TEAL, MOCK_GREY };

    private int mode = DRAWN;
    private Bitmap shot;
    private final String[] apps;
    private final String folder;

    private final Paint fill = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final TextPaint text = new TextPaint(Paint.ANTI_ALIAS_FLAG);
    private final Paint image = new Paint(Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
    private final RectF box = new RectF();
    private final Rect dst = new Rect();

    IconsView(Context context) {
        super(context);
        apps = context.getString(R.string.mock_apps).split(",");
        folder = context.getString(R.string.mock_folder);
        text.setColor(MOCK_TEXT);
        text.setTextAlign(Paint.Align.CENTER);
    }

    void setMode(int m) {
        if (m == mode) return;
        mode = m;
        invalidate();
    }

    int mode() {
        return mode;
    }

    /** The captured home screen (REAL), or null. */
    void setShot(Bitmap b) {
        shot = b;
        invalidate();
    }

    boolean hasShot() {
        return shot != null;
    }

    @Override
    protected void onDraw(Canvas canvas) {
        if (mode == NONE) return;
        if (mode == REAL && shot != null) {
            dst.set(0, 0, getWidth(), getHeight());
            canvas.drawBitmap(shot, null, dst, image);
            return;
        }
        drawMock(canvas, getWidth(), getHeight());
    }

    private float dp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics());
    }

    private float sp(float v) {
        return TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, v, getResources().getDisplayMetrics());
    }

    /* light text with its dark halo */
    private void label(Canvas c, String s, float x, float y, float size, float maxW) {
        text.setTextSize(size);
        text.setShadowLayer(dp(3), 0, dp(1), MOCK_SHADOW);
        String fit = TextUtils.ellipsize(s, text, maxW, TextUtils.TruncateAt.END).toString();
        c.drawText(fit, x, y, text);
        text.clearShadowLayer();
    }

    /* a rounded-square icon with a simple mark in it */
    private void icon(Canvas c, float cx, float cy, float size, int color, int mark) {
        float r = size * 0.24f;
        box.set(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
        fill.setColor(color);
        c.drawRoundRect(box, r, r, fill);
        fill.setColor(MOCK_GLYPH);
        float g = size * 0.2f;
        switch (mark % 3) {
            case 0:
                c.drawCircle(cx, cy, g, fill);
                break;
            case 1:
                box.set(cx - g, cy - g, cx + g, cy + g);
                c.drawRoundRect(box, g * 0.3f, g * 0.3f, fill);
                break;
            default:
                box.set(cx - g * 1.2f, cy - g * 0.45f, cx + g * 1.2f, cy + g * 0.45f);
                c.drawRoundRect(box, g * 0.45f, g * 0.45f, fill);
        }
    }

    /* a folder: a rounded square holding four small icons */
    private void folder(Canvas c, float cx, float cy, float size) {
        float r = size * 0.24f;
        box.set(cx - size / 2, cy - size / 2, cx + size / 2, cy + size / 2);
        fill.setColor(MOCK_FOLDER);
        c.drawRoundRect(box, r, r, fill);
        float mini = size * 0.3f, step = size * 0.21f;
        for (int i = 0; i < 4; i++) {
            float mx = cx + (i % 2 == 0 ? -step : step), my = cy + (i < 2 ? -step : step);
            box.set(mx - mini / 2, my - mini / 2, mx + mini / 2, my + mini / 2);
            fill.setColor(FILLS[(i + 2) % FILLS.length]);
            c.drawRoundRect(box, mini * 0.24f, mini * 0.24f, fill);
        }
    }

    private void drawMock(Canvas c, int w, int h) {
        if (w <= 0 || h <= 0) return;
        float side = dp(16);
        Date now = new Date();

        /* the status bar: the time on the left, signal, wi-fi and battery as dots on the right */
        String time = DateFormat.getTimeFormat(getContext()).format(now);
        text.setTextAlign(Paint.Align.LEFT);
        label(c, time, side, dp(17), sp(13), w / 3f);
        text.setTextAlign(Paint.Align.CENTER);
        fill.setColor(MOCK_TEXT);
        float sy = dp(12), dot = dp(2.5f);
        for (int i = 0; i < 3; i++) c.drawCircle(w - side - dp(34) - i * dp(8), sy, dot, fill);
        box.set(w - side - dp(20), sy - dp(5), w - side, sy + dp(5));
        c.drawRoundRect(box, dp(2), dp(2), fill);

        /* the clock and date widget near the top */
        label(c, time, w / 2f, dp(118), sp(56), w - 2 * side);
        String date = DateUtils.formatDateTime(getContext(), now.getTime(),
            DateUtils.FORMAT_SHOW_WEEKDAY | DateUtils.FORMAT_SHOW_DATE | DateUtils.FORMAT_NO_YEAR);
        label(c, date, w / 2f, dp(146), sp(15), w - 2 * side);

        /* from the bottom up: the gesture handle, the search pill, the dock, two rows of apps */
        float handleY = h - dp(10);
        box.set(w / 2f - dp(54), handleY - dp(2), w / 2f + dp(54), handleY + dp(2));
        fill.setColor(MOCK_TEXT);
        fill.setShadowLayer(dp(2), 0, 0, MOCK_SHADOW);
        c.drawRoundRect(box, dp(2), dp(2), fill);
        fill.clearShadowLayer();

        float pillH = dp(48), pillBottom = h - dp(28);
        box.set(side + dp(8), pillBottom - pillH, w - side - dp(8), pillBottom);
        fill.setColor(MOCK_PILL);
        c.drawRoundRect(box, pillH / 2, pillH / 2, fill);
        fill.setColor(MOCK_GLYPH);
        float gx = box.left + pillH / 2, gy = box.centerY();
        c.drawCircle(gx, gy, dp(7), fill);
        fill.setColor(MOCK_PILL);
        c.drawCircle(gx, gy, dp(4.5f), fill);

        int cols = w / getResources().getDisplayMetrics().density >= 400 ? 5 : 4;
        float cell = (w - 2 * side) / cols;
        float size = Math.min(dp(54), cell - dp(18));
        float dockY = pillBottom - pillH - dp(20) - size / 2;
        for (int i = 0; i < 4; i++) {
            float cx = side + (w - 2 * side) * (i + 0.5f) / 4;
            icon(c, cx, dockY, size, FILLS[(i * 3) % FILLS.length], i);
        }

        float rowH = size + dp(34);
        float labelSize = sp(12);
        int n = 0;
        for (int row = 0; row < 2; row++) {
            float cy = dockY - dp(28) - rowH * (2 - row) + size / 2;
            for (int col = 0; col < cols; col++) {
                float cx = side + cell * (col + 0.5f);
                String name;
                if (row == 1 && col == 0) {
                    folder(c, cx, cy, size);
                    name = folder;
                } else {
                    icon(c, cx, cy, size, FILLS[(n + row) % FILLS.length], n);
                    name = apps.length > 0 ? apps[n % apps.length].trim() : "";
                    n++;
                }
                label(c, name, cx, cy + size / 2 + dp(16), labelSize, cell - dp(4));
            }
        }
    }
}
