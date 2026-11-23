# Lili as a live wallpaper: design

Branch `screensaver`. This supersedes `docs/SCREENSAVER.md` (the screen-saver
design is in git at `e9db05a`). It is the plan an implementer follows step by
step. Everything said about the repository was checked against `e9db05a`.
Statements about Chromium or Android internals could not be checked here; they
are marked **(platform, confirm in step N)** and the step says how.

---

## 1. What ships, and what the user gets

One app, **Lili** (`com.lili.wallpaper`): an Android live wallpaper. Lili lives
on the user's own home screen, under their icons, widgets and clock, and,
animated, on the lock screen of phones that show third-party live wallpapers
there (stock Android). No clock of her own and no forecast on screen. Three
permissions, for the user's previous wallpapers and a lock-screen picture that
is blocked in this version (section 8). (Since section 9, six; since section
10, nine: with a place set, the real weather for it - fetched, never shown -
dresses her and picks her scenes, and otherwise she lives under an invented
sky with no network at all.)

| | |
|---|---|
| They get | A **Home screen** switch (in the preview since section 9, a plan carried out on Apply): on sets the animated wallpaper through the system picker, off brings back the wallpaper that was there before. Where the phone allows it, "Home screen and lock screen" in the picker also animates her on the lock screen. The **Lock screen** switch shows that, but cannot be turned on itself (section 8). A background they choose: **My wallpaper** (the picture they had as wallpaper, kept for good; section 9), one of six dark presets or their own photo. Sliders for her size and how high she stands. A preview with home-screen icons over her, drawn or their own captured (section 9). |
| When she performs | Each time the wallpaper comes back into view after 10 s or more out of sight (unlock, leaving an app), she starts a random animation. While in view she lives her idle life with another every 45 to 150 s. From 23:00 to 07:00 she sleeps. |
| Battery | When the wallpaper is not visible (screen off, an app in front) the page runs **no timers at all** and the WebView is paused. Asleep she costs 2 frames a second. |
| They do not get | Their existing wallpaper picture behind her where Android will not let an app read it and they do not pick it from their photos (section 9: up to Android 12 with READ_EXTERNAL_STORAGE, from 13 only with "All files access"; another app's live wallpaper has no picture). Lili on the always-on display. Lili on the lock screen on phones whose maker blocks third-party live wallpapers there (Huawei EMUI/HarmonyOS, Samsung One UI, most MIUI/HyperOS and ColorOS builds). Lili before the first unlock after a reboot (see Risks, direct boot). Touch: an engine can receive touches and taps, but Lili keeps touch off for now, so she cannot be petted yet. |
| Preview | **Preview** in the app shows her full screen with the settings as changed, before they are applied, with home-screen icons over her; the **Home screen** and **Lock screen** switches are there, as a plan, and **Apply** applies the look and then carries out the plan (sections 8 and 9). |

---

## 2. Decisions

**D0. Names.** The application id is `com.lili.wallpaper` (settled by the user).
**Rename everything to match, as the first step, before any behaviour changes**:
Java package and manifest `package`, `android-saver/` → `android-wallpaper/`,
`src/saver/` → `src/wallpaper/`, `saver.html` → `wallpaper.html`, the four
tools, the JS global `Saver` → `Wall`, config `saver_*` → `wall_*`. Reason:
nothing is released, every one of these files exists only on this branch (so a
rename can never conflict with `main`), most are being rewritten anyway, and a
directory called "saver" that builds `com.lili.wallpaper` would confuse every
later reader. `$AppId` and `--rename-manifest-package` stay in the build script
as the single place to change the id, but now equal the manifest's `package`,
and the harness asserts that. Unchanged names: `sky.js`, `shuffle.js`,
`plan-random.js`, `LiliWeb`, `LiliWallpaper`, `PreviewActivity`,
`res/xml/wallpaper.xml`. The full map is in section 3.

**D1. Size and position.** The 9:16 stage model is kept and the whole stage is
scaled and lifted.

- Verified: props are `%` of the stage, `#cat_holder` is `44% x 32.4%` of it,
  `Rig.measure()` reads `offsetWidth/Height` of stage and holder (`rig.js:70`),
  and `check-scenes.js` (`BAND = 63`) guarantees nothing is drawn above 63% of
  the stage height. So **everything she ever does fits in the bottom 37% of the
  stage**, a box `stageW` wide and `0.658 * stageW` tall. Scaling the stage
  scales her and every prop together, with no change to scene data.
- `base` = width of the largest 9:16 box that fits the viewport (as today).
  `stageW = size/100 * base`, `stageH = stageW * 16/9`. The stage is centred
  horizontally and its bottom edge sits `lift`% of the viewport height above
  the bottom of the screen.
- Defaults: **`size = 60`** (she is 26% of the screen width instead of 44%) and
  **`lift = 22`**. Reason for 22: on the 1080x2400 screen that is about 200 dp,
  which clears gesture bar + search bar + dock on the Pixel launcher; on
  1080x1920 it is about 140 dp, clearing a 48 dp nav bar + dock. Window insets
  are not used: they report the nav bar but not the dock, so a slider is needed
  anyway and one mechanism is enough.
- **User-adjustable** in settings: size 15 to 100, height 0 to 45, applied live.
  100 is her size in the weather app; at 15 she is smaller than a launcher icon
  (about 30 dp tall).
- The 63% rule stays in the shared checker as it is. Its meaning for the
  wallpaper is only "the content box is known". The top 63% of the stage is
  empty and may hang off the top of the screen at large sizes; harmless.
- **Stage edges.** Both stages are `overflow: hidden` (shared CSS) and scenes
  bring props in from outside (`scenes-winter.js:135`, a bird at `x = -12`). At
  `size < 100` that edge is mid-screen. So the stages sit inside a new wrapper
  `#wl_view`, 15% of `stageW` wider on each side; the stages become
  `overflow: visible` and the wrapper clips, with a horizontal fade mask over
  those margins. She never stands in the margins (`wander()` keeps her in
  `0..100 - w`), so only arriving props fade. `wall_edge_fade = false` drops the
  mask and leaves a hard clip, in case the mask costs frames on the G4.
- Sizes are set **in px by `Wall.place()`**, not CSS `calc()`. Reason: nested
  `calc()` with custom properties is not something to trust on WebView 69, and
  px from JS can be asserted in the offline harness.

**D2. Battery: a per-page timer gate.** Verified in code:

- `cat.js:608` handles `visibilitychange`: hidden → `Anim.to('OFF')`, visible
  and not quiet → `Anim.to('IDLE')`. That is not a pause: `cat.js`'s private
  beat timer keeps firing every few seconds, each beat issues a tween, and
  `Anim.tween` restarts the loop from `OFF` (`anim.js:171`). A running scene's
  `setTimeout`s (`beats.js:59`, `episodes.js:1325`) also keep going.
- Every timer in the bundled shared code is a bare `setTimeout`/`clearTimeout`
  call; there is no `requestAnimationFrame`, `setInterval` or CSS animation in
  `src/cat/`, and nothing keeps a private reference to the native functions.

So a new first module, `src/wallpaper/timers.js`, replaces
`window.setTimeout/clearTimeout/setInterval/clearInterval` with wrappers that
keep a table of pending timers. `Timers.freeze()` cancels every native timer and
records the time each had left; `Timers.thaw()` re-arms them. Frozen, the page
has zero wake-ups and resumes exactly where it stopped (`anim.js` clamps the
first frame's `dt` to 250 ms, so nothing jumps). It is per page, so the picker's
preview engine and the real engine never affect each other. `pauseTimers()` is
never called anywhere. The engine also calls `WebView.onPause()/onResume()`,
which stops compositing and **(platform, confirm in step 8)** sets
`document.hidden` through Chromium's `AwContents`; the design does not depend on
that, it only makes `cat.js`'s own handler agree.

**D3. When she performs.** The engine tells the page `Wall.show()` and
`Wall.hide()`.

- `hide`: note the time, freeze.
- `show`: thaw, emit a `minute` at once (so quiet hours, sky and outfit catch up
  with the real clock). Then, if she is in the sleep window: nothing. If she was
  away less than `wall_fresh_after` (10 s): nothing, she just carries on. If an
  animation was frozen half-way: it continues, and the next one follows 1.5 s
  after it ends (`Plan.hurry()`) instead of after the long gap. Otherwise:
  `Plan.skip()` then `Cat.play(Shuffle.next(...))` 400 ms later (2600 ms if she
  was asleep before this show, so `Actions.wake` finishes first).
- Away 3 h or more (`wall_sky_after`): `Sky.redraw` first, so the outfit is not
  stale.
- **Night.** `cat_quiet_from/to` are simply `23:00`/`07:00` from boot. She
  sleeps and an unlock at night shows her asleep; she does not perform.
  Reason: "one animation then sleep" made sense per dream start, but a phone is
  unlocked many times a night. This removes the screen saver's delayed
  hand-over. The trap it guarded remains: **never `Cat.play` inside the sleep
  window** (it wakes her body without clearing `cat.js`'s `quiet` flag).
  `Wall.show` re-asserts `Anim.to('RESTING')` when asleep, because `cat.js`'s
  visibility handler leaves the loop `OFF` in quiet hours.
- No dimming, no `night()` bridge, no burn-in drift (nothing is on screen long
  enough, and the launcher is drawn over it).

**D4. Engine lifecycle.**

- Rendering as the spike proved: private `VirtualDisplay` on the holder's
  surface (flags 0, `densityDpi` from resources), a `Presentation` on it. Keep
  those calls exactly as in the spike.
- **Size change = rebuild, not `VirtualDisplay.resize`.** `onSurfaceChanged`
  with the same size is ignored; a new size schedules `rebuild()` (teardown,
  then build) 150 ms later, debounced. Reason: `Presentation` dismisses itself
  when its display's metrics change on Android 11 and below **(platform,
  confirm in step 5)**, a rebuild is the path that must work anyway, and
  rotation of a phone home screen is rare. The page reloads and she starts a
  fresh animation.
- `onSurfaceDestroyed` and `onDestroy` both call `teardown()` (idempotent):
  dismiss the presentation, destroy the WebView, release the display.
  `onDestroy` also unregisters the prefs listener.
- Multiple engines: each has its own display, presentation, WebView and page.
  Shared: the prefs file, one decoded background bitmap, `localStorage` (the
  shuffle history interleaves, harmlessly).
- **Never blank**, three levels: (1) presentation with backdrop + WebView;
  (2) `new WebView` throws → presentation with the backdrop alone, WebView
  retried on a later `visible=true`, at most once per 30 s; (3) the display or
  presentation cannot be created → `teardown()`, then draw the backdrop straight
  onto the surface with `lockCanvas`. Level 3 lasts until the surface is
  recreated, because a surface that has been locked for software drawing cannot
  go back to a hardware producer.
- Memory: `setRendererPriorityPolicy(RENDERER_PRIORITY_BOUND, true)` (API 26+)
  lets the system reclaim the renderer while the wallpaper is hidden. That makes
  `WebViewClient.onRenderProcessGone` (API 26+) mandatory: return `true`, drop
  the WebView, build a new one on the next show. Without it the system kills the
  whole wallpaper process.
- `setTouchEventsEnabled(false)`. `onOffsetsChanged` is not overridden.

**D5. Background: native, behind a transparent WebView.** The presentation's
content is `LiliView` (a `FrameLayout`): a `BackdropView` plus the WebView with
`setBackgroundColor(Color.TRANSPARENT)`; the page's `html, body` are
transparent. Reason: the same draw routine serves the fallback levels above, the
colour extraction and the settings swatches; the photo is decoded once at a size
we control and shared by all engines; the page keeps zero file access.

- Photo import (settings, worker thread): read bounds, pick `inSampleSize`,
  apply EXIF orientation (`android.media.ExifInterface(InputStream)`, API 24+;
  skipped below), centre-crop to the portrait screen (`Display.getRealSize`),
  never upscale, write JPEG 92 via a temp file and rename. Since section 8's
  draft it goes to `files/bg_draft.jpg` first, and **Apply** renames it over
  `files/bg.jpg`. Stored at exactly screen size: 8 to 10 MB decoded, one shared
  instance (plus one for a draft photo while it is previewed). In landscape it
  is centre-cropped again and upscaled; accepted.
- `bg_dim` (0 to 60, default 20) darkens a photo so white props and the
  launcher's labels stay readable.
- Presets, all dark because props are drawn for a dark page: `night`
  `#22335a→#141d33` (**default**), `black` `#000000`, `graphite`
  `#2a2d34→#17191d`, `forest` `#1f3b33→#11211c`, `plum` `#3a2444→#1c1224`,
  `ember` `#4a2a2a→#1f1414`. Vertical gradients, top to bottom.
- **No parallax.** Reason: Lili cannot scroll with the pages (the page would
  need `Alive.settle()` on every offset), so only the photo would move behind
  her; the photo is stored with no spare width; many launchers send no offsets.
- `onComputeColors()` (API 27+): draw the backdrop into a 108x192 bitmap with
  the same routine and return `WallpaperColors.fromBitmap`. The platform then
  derives Material You colours and the dark-text hint itself.
  `notifyColorsChanged()` after an applied `bg_*` change, once per Apply.

**D6. Settings and setup.** One activity, `SettingsActivity`, is both the
launcher icon and the wallpaper xml's `settingsActivity`. `SetupActivity` is
deleted.

- Native views built in code, like `SetupActivity` was, on one opaque
  scrolling screen: the My wallpaper card (only while it cannot be kept;
  section 9), **Where Lili lives** (since section 9 a read-only status line;
  the switches of section 8 moved into the preview), **My wallpaper** and the
  preset swatches, **Choose photo…**, **Darken photo** slider (pictures only),
  **Size** and **Height** sliders, the line "Changes not applied yet" (only
  while there are some), **Preview**, and a note.
- **Opaque; changes are a draft until applied.** The first version used
  `Theme.Material.Wallpaper.NoTitleBar`: with Lili active, the real engine
  showed through the bottom of the screen and every change was seen there as it
  was made. After the Huawei tests the user found that strip useless and did not
  want changes applied as they were made. Now `LiliSettings` is
  `Theme.Material.NoActionBar` with `windowShowWallpaper` false, and the window,
  the system bars and the panel are `PANEL`, opaque. Background, photo,
  darkening, size and height are a **draft** held by the screen; **Preview**
  shows it full screen, and **Apply** there writes it to prefs, which is when
  the wallpaper changes. Section 8, "Settings: draft, Preview, Apply", has the
  details; section 9 moved the switches into the preview as a plan.
- Set as wallpaper: `ACTION_CHANGE_LIVE_WALLPAPER` with
  `EXTRA_LIVE_WALLPAPER_COMPONENT`; on `ActivityNotFoundException`,
  `ACTION_LIVE_WALLPAPER_CHOOSER`; if that fails too, show a hint ("long-press
  the home screen → Wallpapers → Live wallpapers → Lili"). No `resolveActivity`.
  If `hasSystemFeature(FEATURE_LIVE_WALLPAPER)` is false the hint shows from
  the start.
- Photo: `ACTION_OPEN_DOCUMENT` (`image/*`, `CATEGORY_OPENABLE`), falling back
  to `ACTION_GET_CONTENT`. Copied in `onActivityResult` (into the draft file),
  so no URI grant is kept. No permission is needed for it.
- **Applied settings reach engines through `SharedPreferences`**: every
  `LiliView` that follows prefs registers an `OnSharedPreferenceChangeListener`
  (activities and the service share one process). `bg_*` → redraw the
  backdrop; `size`/`lift` → `Wall.apply(...)` in the page. No page reload. An
  Apply writes every look key in one `apply()`, and each listener folds the
  keys it hears into one redraw, one `Wall.apply` and one
  `notifyColorsChanged()`.
- `PreviewActivity` shows the draft it is given, with **Apply** and **Cancel**
  at the top, the plan's switches and the icons layer (section 9). Without a
  draft (from adb, with `-e ep <id>` to play one named scene) it is the plain
  preview of what is applied.

---

## 3. File-by-file change list (against `e9db05a`)

### Renamed (step 1; `git mv`, then the content changes below)

| from | to |
|---|---|
| `android-saver/` | `android-wallpaper/` |
| `android-saver/java/com/lili/saver/*.java` | `android-wallpaper/java/com/lili/wallpaper/*.java` |
| `src/saver/` | `src/wallpaper/` |
| `src/saver.base.html` | `src/wallpaper.base.html` |
| `src/saver/saver.js`, `saver-boot.js` | `src/wallpaper/wall.js`, `wall-boot.js` |
| `tools/build-saver.js`, `saver-modules.js`, `check-saver.js`, `build-saver-apk.ps1` | `tools/build-wallpaper.js`, `wallpaper-modules.js`, `check-wallpaper.js`, `build-wallpaper-apk.ps1` |
| `docs/SCREENSAVER-RELEASE.md` | `docs/WALLPAPER-RELEASE.md` |
| generated `saver.html`, `android-saver/assets/saver.html` | `wallpaper.html`, `android-wallpaper/assets/wallpaper.html` |

Every occurrence of `com.lili.saver` at `e9db05a`, all of which become
`com.lili.wallpaper`:

- `android-saver/AndroidManifest.xml`: line 10 (comment), line 12 (`package=`).
- `package com.lili.saver;` on line 1 of all five Java files, and the two adb
  lines in `PreviewActivity.java`'s javadoc (19, 20).
- `tools/build-saver-apk.ps1`: line 29 (comment), line 31 (`$AppId`), line 252
  (`am start -n "$AppId/com.lili.saver.SetupActivity"` → `…wallpaper.SettingsActivity`).
- `tools/check-saver.js`: line 736 (the manifest `package` assertion).
- `CLAUDE.md`: lines 74, 80, 87.
- `docs/SCREENSAVER.md`: replaced by a stub. `docs/SCREENSAVER-RELEASE.md` has
  no occurrence but is rewritten.

Other identifiers renamed in the same step: global `Saver` → `Wall`;
`saver_gap_min/max`, `saver_sky_every`, `saver_hemisphere` → `wall_*`;
`saver_sleep_from/to` are deleted (D3); the storage key `saver.seen.v1` →
`wall.seen.v1` (`shuffle.js:17`); log prefix `saver:` → `wall:`; the day name
`'saver'` in `plan-random.js` → `'wall'` (the harness matches `/plan saver/`);
`e.saverBuild` → `e.wallBuild`; themes `Saver`/`SaverFullscreen` →
`Lili`/`LiliFullscreen`; `LiliWeb.PAGE`; `.gitignore`'s three saver lines.

### Deleted

- `android-…/LiliDream.java`, `SetupActivity.java`; the dream `<service>` and
  the "SPIKE" comments in the manifest.
- `src/…/saver-clock.js` (`SaverClock`), `#sv_clock`/`#sv_time` markup and CSS,
  the drift, `setAsleep`, the `night` bridge, `LiliWeb.Listener`,
  `Bridge.is24h()`, `Bridge.night()`.
- Strings `dream_name`, `setup_intro`, `step1..3`, `open_settings`,
  `hint_missing`, `setup_note` (both languages).

### The page

**`src/wallpaper/timers.js` (new, global `Timers`, first in the module list).**
`freeze()`, `thaw()`, `frozen()`, `pending()`, `fired()` (callbacks run since
load, for the battery check). Wrappers issue their own integer ids. A record is
`{fn, args, at, left, every, real}`. `setInterval` is a self-re-arming record
under one id. A non-function first argument is passed to the native function
untouched. Timers set while frozen are stored and not armed. `clearTimeout` of
an unknown id is a no-op. Assign through `window.` so bare calls in every later
module resolve to the wrappers.

**`src/wallpaper/wall-tick.js` (new, global `WallTick`).** The minute tick
without a clock face: `start()`, `kick()` (cancel, tick now, re-arm on the
minute boundary). Emits `Bus.emit('minute', {date, now})`, the payload `cat.js`
expects. Must not reference the cat.

**`src/wallpaper/wall.js` (rewrite of `saver.js`, global `Wall`).**

- `begin()`: subscribe to `minute` (`Sky.tick`, remember `asleep`); the
  up-to-four `Sky.redraw` loop until `Shuffle.fresh(...) > 0` (kept); add a
  `visibilitychange` listener (registered after `Cat.init`, so it runs after
  `cat.js`'s) that re-asserts `RESTING` when visible and asleep; if
  `!Host.native()`, call `show()` after 300 ms so a browser tab behaves.
- `place()`: read `document.documentElement.clientWidth/Height`, compute
  `base`, `stageW`, `stageH`, `pad = 0.15 * stageW`, write px `left`, `bottom`,
  `width`, `height` on `#wl_view` and `left`, `width`, `height` on both stages.
- `apply(cfg)`: clamp and store `size`, `lift`; `place()`; dispatch a synthetic
  `resize` (`document.createEvent('Event')`), which runs `Rig.measure` and
  `cat.js`'s `layout()` (floor, `Alive.settle()`).
- `show()`, `hide()`: as in D3. Both idempotent. `show()` calls `Timers.thaw()`
  before anything else and `WallTick.kick()` before deciding.
- `state()`: `{hidden, asleep, size, lift}` for the harness.
- Initial config, in order: `wall_size`/`wall_lift`; then
  `window.PhoneForecast.config()` (a JSON string) if present; then
  `#size=..&lift=..` in the hash, for a desktop browser. `#ep=<id>` is honoured
  by the first fresh play only (kept).
- A `resize` listener calling `place()` is registered in `wall-boot.js`
  **before** `Cat.init`, so on a real resize the stage is resized before
  `cat.js` measures it.

**`src/wallpaper/plan-random.js` (changed).** Add `hurry()`: the next arming
uses 1500 ms instead of the random gap, once. Day name `'wall'`. Otherwise as
is.

**`src/wallpaper/wall-boot.js`.** `Guard.run('sky', Sky.begin)` →
`Wall.place()` and the resize listener → `WallTick.start()` →
`Guard.run('init', Cat.init)` → `Guard.run('wall', Wall.begin)`.

**`src/wallpaper.base.html` (changed).** Still no doctype. Body:

```html
<div id="wl_view">
	<div id="cat_stage_back"><div id="cat_props_back"></div></div>
	<div id="cat_stage"> …holder, props, hit as before… </div>
</div>
```

Own config block (unindented, one per line, after `CAT_CONFIG`):

```js
var cat_quiet_from = '23:00';   //she sleeps; never Cat.play inside this window
var cat_quiet_to   = '07:00';
var cat_touch      = false;     //no petting yet: the engine keeps touch off
var cat_test       = false;
var cat_plan_demo  = false;
var wall_size        = 60;      //stage width, % of the largest 9:16 box
var wall_lift        = 22;      //stage bottom, % of the viewport height
var wall_fresh_after = 10;      //sec out of sight before a show starts a new animation
var wall_sky_after   = 10800;   //sec out of sight before the sky is redrawn
var wall_edge_fade   = true;
var wall_gap_min     = 45;
var wall_gap_max     = 150;
var wall_sky_every   = 5;
var wall_hemisphere  = 'auto';
var wall_browser_bg  = '#1d2b44';  //only when there is no native host behind the page
```

CSS after `CAT_CSS`: `html, body { background: transparent; margin: 0;
overflow: hidden; }`; `#wl_view { position: fixed; overflow: hidden;
pointer-events: none; }`; `#cat_stage, #cat_stage_back { position: absolute;
top: 0; overflow: visible; }`; `#cat_holder { width: 44%; height: 32.4%; }`;
`#wl_view.fade { -webkit-mask-image: linear-gradient(to right, transparent 0,
#000 11.5%, #000 88.5%, transparent 100%); }` (11.5% of the wrapper is the 15%
margin). No `vw`/`vh`, no media queries.

### Tools

- `tools/wallpaper-modules.js`: `HEAD = ['src/wallpaper/timers.js']` placed
  before everything; stand-in paths under `src/wallpaper/`;
  `TAIL = ['src/wallpaper/wall-tick.js', 'wall.js', 'wall-boot.js']`.
- `tools/build-wallpaper.js`: paths and output names; `catCss()` unchanged; add
  two final guards that fail the build: the page contains `sv_clock`, or a
  module banner for `timers.js` is not the first banner.
- `tools/check-wallpaper.js`:
  - A, B unchanged. C adds `hurry()`. D unchanged in substance (keeps the
    `inQuiet` line assertion), plus: no bundled `src/cat/*` or `src/core/*`
    file mentions `requestAnimationFrame`, `setInterval` or keeps a reference
    like `= setTimeout` / `window.setTimeout` (the gate's premise).
  - E: manifest requests exactly the permissions of section 8 (it had none
    before that section); declares
    `android.permission.BIND_WALLPAPER`, the
    `android.service.wallpaper.WallpaperService` action, the
    `android.service.wallpaper` meta-data and `uses-feature`
    `android.software.live_wallpaper`; **does not** mention `DreamService`;
    `package="com.lili.wallpaper"` and the same string is `$AppId` in
    `build-wallpaper-apk.ps1`; `res/xml/wallpaper.xml` names
    `com.lili.wallpaper.SettingsActivity`.
  - F rewritten (the fake DOM gains `documentElement.clientWidth/Height`,
    `createEvent`/`dispatchEvent`, and a counter of native timers armed):
    day boot with no bridge plays within a second; `hide()` then 10 minutes →
    zero timers armed, zero callbacks, nothing played; `show()` after 5 s →
    nothing new; after 60 s idle → a new animation within a second, different
    from the last; `hide()` mid-animation then `show()` → the same one
    finishes and the next starts within 5 s; boot at 02:00 → nothing played,
    tier `RESTING`, and `show()` plays nothing; hidden 02:00 → shown 07:30 →
    she wakes, then plays; hidden 22:50 → shown 23:30 → she curls up, nothing
    played; `place()` px for 360x640, 360x800 and 800x360 at 60/22;
    `apply({size:80, lift:10})` moves the px, fires one `resize`, no faults;
    `#ep=`; six loads, six different first animations (kept).
  - G (new), `Timers` alone: order and timing preserved across freeze/thaw;
    interval survives; clear while frozen; timer set while frozen fires only
    after thaw; extra arguments passed through.
- `tools/build-wallpaper-apk.ps1` (CRLF): `$AppId = 'com.lili.wallpaper'`;
  `$src = android-wallpaper`; APK name `lili-wallpaper-<version>[-debug].apk`;
  banner text and `-dname 'CN=Lili Wallpaper'` in the printed keytool hint;
  `-Install` opens `"$AppId/com.lili.wallpaper.SettingsActivity"`; fail early
  if the chosen platform is below API 27 (`WallpaperColors` must compile; the
  machine has `android-36.1`). `$MinSdk = 21` stays. Signing rules unchanged.

### Android (`android-wallpaper/`)

`AndroidManifest.xml`: `package="com.lili.wallpaper"`, no version attributes,
**no `directBootAware`**. (No `<uses-permission>` at first; section 8 added three
and the `LockJob` service.)

```xml
<uses-feature android:name="android.software.live_wallpaper" android:required="true" />
<application … android:theme="@style/Lili">
  <activity android:name=".SettingsActivity" android:exported="true"
      android:theme="@style/LiliSettings"> MAIN + LAUNCHER </activity>
  <activity android:name=".PreviewActivity" android:exported="true"
      android:theme="@style/LiliFullscreen" android:configChanges="…as before…" />
  <service android:name=".LiliWallpaper" android:exported="true"
      android:label="@string/wallpaper_name"
      android:permission="android.permission.BIND_WALLPAPER">
    <intent-filter><action android:name="android.service.wallpaper.WallpaperService" /></intent-filter>
    <meta-data android:name="android.service.wallpaper" android:resource="@xml/wallpaper" />
  </service>
</application>
```

`res/xml/wallpaper.xml`: `android:thumbnail="@drawable/wallpaper_thumb"`,
`android:description="@string/wallpaper_description"`,
`android:settingsActivity="com.lili.wallpaper.SettingsActivity"` (fully
qualified; it is resolved by the picker, not by us).

`res/drawable-nodpi/wallpaper_thumb.png` (new, tracked): a square crop of a
`PreviewActivity` screenshot on the default preset, about 512 px. Until it
exists, point `thumbnail` at `@drawable/ic_launcher`.

`res/values/themes.xml`: `Lili` (Material, black window), `LiliFullscreen`, and
`LiliSettings` with parent `@android:style/Theme.Material.Wallpaper.NoTitleBar`
(since section 8's draft: `Theme.Material.NoActionBar`, opaque).

Strings (en + ru): `app_name` "Lili", `wallpaper_name`,
`wallpaper_description`, `settings_active`, `set_wallpaper`, `hint_manual`,
`background`, `choose_photo`, `darken_photo`, `size`, `height`, `preview`,
`note_lock`, `photo_failed`, `no_webview`.

Java, framework only, package `com.lili.wallpaper`:

- **`Prefs`** (new). File `"lili"`. Keys and defaults: `bg_kind`
  (`"preset"`|`"photo"`, `"preset"`), `bg_preset` (`"night"`), `bg_dim` (20),
  `bg_rev` (0; incremented on every photo import so listeners fire), `size`
  (60), `lift` (22). `static SharedPreferences of(Context)`,
  `static String pageConfig(Context)` → `{"size":60,"lift":22}`.
- **`Backdrop`** (new). The preset table; `static void draw(Canvas, int w,
  int h, Context)` (gradient, or the photo centre-cropped with a `Matrix`,
  filtered, then the dim); `static Bitmap photo(Context)` (one cached decode of
  `files/bg.jpg`, keyed by `bg_rev`; never `recycle()`, a view may be drawing
  it; a missing or broken file falls back to the preset);
  `static void importPhoto(Context, Uri)` (D5; throws on failure, catches
  `OutOfMemoryError`); `static WallpaperColors colors(Context)` (API 27+ only,
  called behind an SDK check).
- **`LiliView`** (new, `FrameLayout`,
  `OnSharedPreferenceChangeListener`). `LiliView(Context, String ep)` adds a
  `BackdropView` (inner `View` whose `onDraw` calls `Backdrop.draw`) and tries
  `LiliWeb.create`. `setShown(boolean)`: shown → `web.onResume()` then
  `js("window.Wall&&Wall.show()")`; hidden → `js("window.Wall&&Wall.hide()")`
  then `web.onPause()`. Before `onPageFinished` it only records the state, and
  `onPageFinished` pushes it. `onSharedPreferenceChanged`: `bg_*` → invalidate
  the backdrop and call an optional `Runnable onBackdropChanged`; `size`/`lift`
  → `js("window.Wall&&Wall.apply(" + Prefs.pageConfig(ctx) + ")")`.
  `rendererGone()`: destroy the WebView, recreate on the next
  `setShown(true)`. `destroy()`: unregister, `LiliWeb.destroy`. Registers the
  listener in the constructor and keeps itself strongly referenced by its owner
  (the prefs object holds listeners weakly).
- **`LiliWeb`** (changed). `create(Context, Callbacks)` where `Callbacks` has
  `pageFinished()` and `rendererGone()`; transparent background;
  `setRendererPriorityPolicy` on API 26+; `onRenderProcessGone` returns `true`
  and posts `rendererGone()`; bridge `PhoneForecast` with `host()`, `sdk()`,
  `config()` (returns `Prefs.pageConfig`). `PAGE` → `wallpaper.html`.
  `destroy` and `url(ep)` unchanged.
- **`LiliWallpaper`** (rewritten from the spike). `LiliEngine`:
  `onCreate` (`setTouchEventsEnabled(false)`), `onSurfaceCreated` (clear
  `flat`), `onSurfaceChanged` (D4), `onVisibilityChanged` (store, forward to
  `view.setShown`), `onSurfaceDestroyed`, `onDestroy`, `onComputeColors`
  (API 27+), private `build()`, `rebuild()`, `teardown()`, `drawFlat()`. The
  display is named `"lili-wallpaper-" + id` from a static counter. The view's
  context is `presentation.getContext()`. The presentation window gets
  `FLAG_NOT_FOCUSABLE | FLAG_NOT_TOUCHABLE`, and an `OnDismissListener` that
  schedules `rebuild()` if the engine did not dismiss it itself.
  `onBackdropChanged` → `drawFlat()` when flat, and `notifyColorsChanged()` on
  API 27+. Log every transition with tag `Lili`, prefix `[WALL n]`, including
  `preview=`, the size, and `view.isHardwareAccelerated()` after show.
- **`SettingsActivity`** (new, replaces `SetupActivity`): D6. Photo import on a
  plain `Thread`, result posted to the main thread, failure shown as a `Toast`.
  Status refreshed in `onResume`.
- **`PreviewActivity`** (changed): content is a `LiliView` with the `ep` extra;
  `onResume`/`onPause` call `setShown(true/false)`; immersive as before; no
  `resumeTimers()`.

### Changed, shared files (append-only rule still holds for `main`'s lines)

- `.gitignore`: the three saver lines become `/wallpaper.html`,
  `/android-wallpaper/assets/`, `/android-wallpaper/build/`.
- `CLAUDE.md`: section 6.
- `docs/SCREENSAVER.md`: stub.

No file under `src/core/`, `src/cat/`, `android/`, or any tool that exists on
`main`, is touched.

---

## 4. Implementation steps

Each step ends with a check. Emulators: `Oreo_G4_sim` (API 26) and `Pixel_7`
(API 34); `$adb = "$env:LOCALAPPDATA\Android\Sdk\platform-tools\adb.exe"`, with
`-s <serial>` when both run.

1. **Rename, nothing else.** `git mv` per the table, then replace the
   identifiers listed under it. *Check:* `node tools/check-wallpaper.js` passes
   with the same counts as `check-saver.js` did before; `node
   tools/build-wallpaper.js` writes `wallpaper.html`; `git grep -n -i "saver"`
   shows only `docs/SCREENSAVER.md`, `CLAUDE.md` (until step 10) and code that
   steps 2 to 4 delete; `git grep -n "com\.lili\.saver"` shows only docs.
2. **Timer gate.** `timers.js`, module list `HEAD`, harness group G and the new
   D assertion. *Check:* harness passes; the existing F scenarios still pass
   with the gate installed.
3. **Page.** Delete `saver-clock.js`; write `wall-tick.js`, `wall.js`,
   `wall-boot.js`, the base page, `Plan.hurry`; rewrite F. *Check:* harness
   passes. In desktop Chrome, `wallpaper.html` shows her at 60% size standing
   22% up on a navy page; `#size=100&lift=0` matches the old layout; in the
   console `Wall.hide()` stops everything (`Timers.pending()` stays constant,
   `Timers.fired()` does not grow) and `Wall.show()` after 10 s starts a new
   animation; a bird-entry scene (`#ep=` a winter bird scene) fades in at the
   edge. `node tools/check-scenes.js` still passes.
4. **Native view.** `Prefs`, `Backdrop`, `LiliView`, `LiliWeb`,
   `PreviewActivity`; delete `LiliDream`, `SetupActivity`; manifest, themes,
   strings; the build script. Temporarily make `PreviewActivity` the launcher.
   *Check:* `build-wallpaper-apk.ps1 -Install` builds;
   `aapt2 dump permissions <apk>` lists none (three since section 8); on both emulators
   `am start -n com.lili.wallpaper/.PreviewActivity -e ep snowball` shows the
   gradient with her on it and plays that scene; logcat `Lili` shows no faults.
5. **Engine.** `LiliWallpaper`, `wallpaper.xml`. *Check on both emulators:*
   ```
   & $adb shell am start -a android.service.wallpaper.CHANGE_LIVE_WALLPAPER `
       --ecn android.service.wallpaper.extra.LIVE_WALLPAPER_COMPONENT `
       com.lili.wallpaper/com.lili.wallpaper.LiliWallpaper
   & $adb shell uiautomator dump /sdcard/ui.xml     # find and tap "Set wallpaper" / "Home screen and lock screen"
   & $adb shell input tap <x> <y>
   & $adb shell input keyevent KEYCODE_HOME
   & $adb exec-out screencap -p > shot.png
   & $adb shell dumpsys wallpaper | Select-String lili
   ```
   Screenshots on 1080x1920 and 1080x2400: she stands clear of the dock and
   nav bar. Logcat shows the preview engine torn down (`surface destroyed`,
   `WebView destroyed`) once the wallpaper is set. Rotate
   (`settings put system accelerometer_rotation 0; settings put system
   user_rotation 1`, on a launcher that rotates, or `wm size 1920x1080` and
   back): one rebuild per change, she is on the floor, no leaked WebView. Note
   in the commit message whether API 26 dismissed the presentation by itself.
6. **Settings.** `SettingsActivity`, launcher entry moved to it. *Check:* the
   picker's settings button opens it; with Lili active the bottom of the screen
   shows the live wallpaper and each slider and swatch changes it at once
   (superseded: the screen is opaque now and changes wait for Apply, section 8);
   picking a photo (push one with `adb push` to `/sdcard/Pictures`, plus a
   portrait JPEG with EXIF orientation 6) shows it upright and centre-cropped
   on home and lock; `run-as com.lili.wallpaper ls -l files` shows one
   `bg.jpg` of screen size; with another wallpaper active the screen is opaque
   and **Set as wallpaper** opens the picker.
7. **Colours and failure paths.** `onComputeColors`, the three fallback levels,
   `onRenderProcessGone`. *Check:* API 34: `dumpsys wallpaper` shows colours,
   and the launcher's Material You accent changes between `night` and `forest`.
   API 26: the app loads and runs (the `WallpaperColors` override does not
   break class loading). Force level 2 by throwing in `LiliWeb.create` behind a
   temporary debug flag: backdrop only, never black. Force level 3 the same way
   in `build()`. On an emulator with `adb root`, kill the
   `…webview…:sandboxed_process` pid: the wallpaper process survives and she is
   back at the next show.
8. **Battery.** *Check, build with `-Overlay` (debug page):* logcat on
   `visible=false` shows `wall: hide`; on return `wall: show after N s, 0 timers
   fired while hidden`. Log `document.hidden` in both to settle the platform
   question in D2. With an app in front for a minute, `adb shell top -n 1`
   shows the app and its WebView sandbox process at 0% CPU. With the picker
   preview open over the home screen, hiding one engine does not stop the
   other. `input keyevent KEYCODE_SLEEP`, wait 30 s, `KEYCODE_WAKEUP`: a new
   animation starts on the lock screen. Set the clock to 23:30
   (`adb shell su 0 date …` or the emulator's settings): she is asleep, an
   unlock plays nothing, tier `RESTING`.
9. **Thumbnail and release path.** Screenshot → `wallpaper_thumb.png`; restore
   the xml reference. *Check:* the picker lists "Lili" with the thumbnail and
   description; `-Release` without a keystore still fails cleanly and writes no
   APK.
10. **Docs.** Section 6. *Check:* `git diff main --stat -- src/core src/cat
    android tools/build.js tools/build-apk.ps1 README.md` is empty; all of
    `check-scenes`, `check-wardrobe`, `check-wallpaper` pass; `git grep -i
    saver` shows only the stub and deliberate history references.

On the real G4 Plus, after step 8: frame rate with `wall_edge_fade` on and off
(the overlay's fps line during a scene should hold 14 to 15), and memory with
`dumpsys meminfo com.lili.wallpaper`.

---

## 5. Risks and traps

- **Never `Cat.play` in the sleep window** (D3). `Wall` is the only caller.
- **The gate must load first.** A module that captured the native `setTimeout`
  before `timers.js` ran would escape the freeze. Guarded by the build check
  and group D.
- **`evaluateJavascript` before the page exists** does nothing. `LiliView`
  therefore records the wanted state and pushes it from `onPageFinished`, and
  every call is written `window.Wall&&…`.
- **The rig owns `#cat_holder`'s transform**; `Wall.place()` writes only
  `left/bottom/width/height` on the wrapper and stages. A size change must end
  in a `resize` event so `cat.js` re-measures and calls `Alive.settle()`;
  a lift change moves only the wrapper and needs nothing.
- **The stage is no longer `position: fixed`.** ARCHITECTURE requires fixed
  because the informer's body has no height; here the parent has px sizes, so
  absolute is safe. Do not give the stages a percentage height of `body`.
- **Viewport size** comes from `documentElement.clientWidth/Height`. That is
  trustworthy only because this page has a plain viewport meta and nothing
  overflowing. Check the overlay's `stage WxH` line on the G4.
- **Quirks mode**: still no doctype.
- **A slider dragged mid-scene** snaps her to the floor (`layout()`). Accepted.
- **Mask cost and correctness on WebView 69** is unmeasured. `wall_edge_fade`
  is the switch; the hard clip is correct without it.
- **`lockCanvas` is one-way** for a surface (D4), and `lockCanvas` on a surface
  still attached to the virtual display fails: always `teardown()` first.
- **`onRenderProcessGone` must return `true`**, or Android kills the wallpaper
  process on every renderer reclaim.
- **`SharedPreferences` holds listeners weakly.** An anonymous listener is
  collected and settings silently stop arriving.
- **Direct boot.** The service is not `directBootAware` (prefs, the photo and
  the WebView's data are in credential-protected storage). Between a reboot and
  the first unlock the system shows its own fallback wallpaper; Lili appears
  after the unlock. Say so in the release notes.
- **Vendors.** Lock-screen live wallpapers are blocked or replaced on some
  phones; some skins kill wallpaper processes aggressively and show black until
  the service restarts; Android Go may have no live wallpaper picker.
- **API-level guards**: `ExifInterface(InputStream)` 24, `setRendererPriorityPolicy`
  and `onRenderProcessGone` 26, `WallpaperColors`/`notifyColorsChanged` 27.
  `minSdk` stays 21; each is behind `Build.VERSION.SDK_INT`.
- **The first decode of `bg.jpg` is on the main thread** (50 to 150 ms on the
  G4). Acceptable once per process; do not add a second copy per engine. A
  draft photo has its own decode, made by the preview and handed to the
  wallpaper on Apply.
- **`windowShowWallpaper` shows whatever the wallpaper is.** The first settings
  screen switched to an opaque root when Lili was not active; since section 8's
  draft it is opaque always and shows no wallpaper.
- **`Episodes.pick` fallback, `x = 0` means "not placed", lazy `localStorage`
  flush, sideloading and the release keystore**: unchanged from the screen-saver
  design.
- **ES5 only** in `src/wallpaper/*`; group D keeps checking it.

---

## 6. Updates for `CLAUDE.md` and the release notes (implementer's list)

`CLAUDE.md`, the closing section:

- Retitle to "Live wallpaper variant (branch `screensaver`)"; describe the app
  as **Lili** (`com.lili.wallpaper`), a `WallpaperService`, no clock (and,
  since section 8, the three permissions listed there); point at
  `docs/WALLPAPER.md` and `docs/WALLPAPER-RELEASE.md`.
- Replace the four commands with `build-wallpaper.js`, `check-wallpaper.js`
  (groups A to G), `build-wallpaper-apk.ps1`, the
  `am start … PreviewActivity [-e ep <id>]` line with the new package, and the
  `CHANGE_LIVE_WALLPAPER` line from step 5.
- "Edit nothing shared": update the list of additive paths to the new names.
- Module list: `timers.js` first; `plan.js` replaced as before; tail is
  `wall-tick.js`, `wall.js`, `wall-boot.js`.
- Replace "in-place mutation of `cat_quiet_from/to` after the first animation"
  with: quiet hours are fixed in the page config, and `Wall` never calls
  `Cat.play` inside them.
- Add: timers are gated per page (`Timers.freeze/thaw`), never
  `pauseTimers()`; the engine drives `Wall.show/hide/apply`; settings travel by
  `SharedPreferences`; the Java package and `$AppId` are both
  `com.lili.wallpaper` and the harness asserts they agree.
- Post-merge routine: same three harnesses with the new name, then
  `node tools/build-wallpaper.js`.

`docs/WALLPAPER-RELEASE.md` (rewrite of the draft):

- Title "Lili Wallpaper 1.0.0"; APK `lili-wallpaper-1.0.0.apk`; tag
  `wallpaper-v1.0.0`.
- What it is: live wallpaper, own photo or preset, size and height, random
  animation when you come back to the screen, sleeps 23:00 to 07:00, pauses
  completely when not visible. No network. (Since section 8 also: the three
  modes, the lock picture, previous wallpapers, the permissions explained.)
- Install section: unchanged apart from the file name.
- Set up: open Lili → Set as wallpaper → choose "Home screen and lock screen";
  manual route through the launcher's wallpaper picker.
- What it does not do: section 1's list (own wallpaper picture not reused,
  vendor lock-screen limits, always-on display, before first unlock, no touch).
- Remove everything about screen savers, "While charging" and dimming.

---

## 7. Open questions for the user

1. **Night unlocks.** The design keeps her asleep from 23:00 to 07:00 and plays
   nothing when the phone is unlocked in that window. The alternative is one
   animation per night-time unlock, then back to sleep. Which is wanted?
2. **Name in the wallpaper picker.** "Lili" is used for the app and the
   wallpaper. Say so if it should read differently there (for example "Lili the
   cat").

---

## 8. Lock screen and previous wallpapers

Added after the first test on a real Huawei phone. The home-screen wallpaper
worked, but choosing "Home screen and lock screen" in the picker did not put
Lili on the lock screen: EMUI/HarmonyOS, like Samsung, never shows a
third-party live wallpaper there. There was also no way to put her on the lock
screen alone, and the user wanted their previous wallpapers kept and restorable.

A still picture of her for the lock screen was built and worked on the Huawei
phone. Then, after the second test, the three mode buttons became two switches
that bring the old wallpaper back when turned off, and the lock-screen picture
was blocked (see "Decision" below; its code is kept).

**Platform facts this rests on** (not checkable here; see "Untested" below):

- No public API sets a *live* wallpaper for the lock screen alone
  (`setWallpaperComponent*` is system-only), and the picker cannot be told which
  of its options to preselect.
- Any app with `SET_WALLPAPER` (a normal permission, no prompt) can set a
  *picture* for the lock screen only: `setBitmap(bmp, null, true, FLAG_LOCK)`,
  API 24+. A lock-only picture under a live home wallpaper splits the two.
- `getWallpaperInfo()` (home) and `getWallpaperId(which)` need no permission.
  `getWallpaperId(FLAG_LOCK) < 0` means the lock screen mirrors home.
  `getWallpaperInfo(FLAG_LOCK)` exists only from API 34.
- Reading a wallpaper's picture (`getWallpaperFile`, `getDrawable`) needs
  `READ_EXTERNAL_STORAGE` on API 27-32 (24-26 may not), and "All files
  access" (`MANAGE_EXTERNAL_STORAGE`) on 33+ (section 9). `clear(FLAG_LOCK)`
  makes the lock mirror home again.

### Where Lili lives: two switches

The first version had three buttons, **Home screen**, **Lock screen** and
**Both**. On the Huawei test phone only the selected one was readable: EMUI drew
the theme's default `Button` white while the Material theme's text stayed
white. They were replaced by two framework `Switch` rows, **Home screen** and
**Lock screen**, each with a status line under it. Turning a switch off brings
back the wallpaper that was there before.

**The switches show the system's state, not a stored choice.** `onResume`, the
picker's return, every action and every change to a `lock_*`/`bk_*` pref read it
again. The checked state is set with the listener detached, so it never fires a
turn-on or turn-off by itself.

| Switch | Shown as | When |
|---|---|---|
| Home | on, "Lili, animated" | `getWallpaperInfo()` is `LiliWallpaper` |
| Home | off, "Your previous wallpaper" | anything else |
| Lock | on, disabled, "Lili, animated (with the home screen)" | her live wallpaper covers the lock screen too: `getWallpaperInfo(FLAG_LOCK)` is ours (API 34+), or `getWallpaperId(FLAG_LOCK) < 0` (no lock wallpaper of its own; always so below API 24) while Home is on. Turning Home off ends it. |
| Lock | on, enabled only for turning off, "Lili picture, updated 14:05" / "...from 14:05, no longer updated" / "Updating the picture..." | her still picture from an earlier build is on the lock screen: `getWallpaperId(FLAG_LOCK)` equals the stored `lock_id`. "Updated" while lock mode (`lock_on`) is still on, so it is kept fresh; "no longer updated" when it is off. |
| Lock | on, enabled only for turning off, "Lili, animated" | API 34+: her live wallpaper on the lock screen alone, the home screen something else |
| Lock | off, disabled, "Not available. Android doesn't let apps animate the lock screen. On stock Android (Pixel, Motorola...), turn on Home screen and choose 'Home screen and lock screen' in the picker." | anything else |

While a save or a restore runs, both switches are disabled and the line says
"Saving your current wallpaper..." or "Putting your previous wallpaper back...".

**Home on.** Save both screens (`Backup.beforeHome`, below), then the system
picker for Lili, with a toast: "Choose 'Home screen and lock screen' to have her
on the lock screen too, on phones that allow it (stock Android). Huawei,
Samsung, Xiaomi and Oppo show her on the home screen only." The switch stays on
while the picker is open; back from it, the system decides. Cancelled, it is off
again.

**Home off.**
- A saved picture: `setStream(FLAG_SYSTEM)` on a worker thread. This replaces
  the live Lili and leaves a lock-only picture where it is.
- A saved live wallpaper (someone else's): the picker for that component, with
  "Choose 'Home screen' on the next screen" (or "...'Home screen and lock
  screen'..." when her live wallpaper also covers the lock screen).
- Nothing saved: the dialog below.
- When her live wallpaper also covered the lock screen, the lock screen gets
  its saved picture back after the home screen (`Backup.restoreLockAfterHome`).
  Without a saved picture it gets `clear(FLAG_LOCK)`, so it follows the home
  screen again. This also undoes what the system does to a mirroring lock screen
  when the home wallpaper changes (it may move an old image to the lock screen,
  or keep the live wallpaper there on Android 14). After the picker, this waits
  until `getWallpaperInfo()` is no longer Lili, for at most 0.8 s after the
  return.

**Lock off** (her picture from an earlier build, or her lock-only live
wallpaper): lock mode off, the job cancelled, any render in flight cancelled,
then the saved lock wallpaper back on a worker thread:
- a picture: `setStream(FLAG_LOCK)`;
- "mirror" or someone else's live wallpaper: `clear(FLAG_LOCK)`. A lock-only
  live wallpaper cannot be set by an app;
- but when the home screen is the live Lili, clearing would leave her on the
  lock screen. Then the saved *home* picture goes on the lock screen (which is
  what a mirroring lock screen showed before her), and without one, the dialog.

**Nothing saved for that screen:** a small dialog, drawn by the app (not an
`AlertDialog`, whose colours come from the theme). It offers **Choose photo...**
(the backdrop's photo picker and import, upright and screen-sized, then
`setStream` for that screen), **System default** and **Cancel**, which leaves
the switch on. System default is `clear(FLAG_SYSTEM)` for the home screen
(`clear()` below API 24), and `clear(FLAG_LOCK)` for the lock screen. When the
home screen is the live Lili, the lock screen gets the built-in picture
(`getBuiltInDrawable(..., FLAG_LOCK)`, screen-sized) set on it alone instead,
falling back to clearing. This is the only confirmation. A restore from a
backup is what the user asked for, so it gets none. A failed restore shows a
toast with the reason, and the switches show what is really there (her picture
still there: the Lock switch is on again, to try once more).

**Colours.** Nothing on the screen takes a colour from the theme. Every
`TextView`, `Button`, `Switch` and `SeekBar` is made by one factory that sets
its text colour and its background: our track and knob drawables, a rounded
face with an outline, explicit tints, vendor tints cleared with
`setBackgroundTintList(null)` and `setThumb/TrackTintList(null)`. All colours
are named constants in `SettingsActivity`. Group I of `check-wallpaper.js`
checks the WCAG contrast of every pair: 4.5:1 for text, 3:1 for a control
against what is around it. The screen is opaque (`PANEL`; the group fails if
it gets any alpha), and pressed states include the ripple. A disabled switch is
greyed (a dull track, a grey knob, a dim label) but its knob still reads at 3:1
or more, on or off. The group also fails on any other colour literal,
`Color.*` (except `TRANSPARENT`), `R.color`, a view alpha, an `AlertDialog` or
a control made outside its factory. The preview's buttons come from the same
factory (next section).

### Settings: draft, Preview, Apply

Added after the second Huawei test. The user found the see-through strip at the
bottom of the settings screen useless, and did not want changes applied as they
were made. The screen is now opaque, and the look is a draft until it is
previewed and applied.

**The draft** is a `Look` (`Look.java`, immutable): preset or photo, the
preset, the darkening, size, height, and for a photo not applied yet
`draftPhoto` plus the `stamp` of its import. `fromPrefs`, `toPrefs` (every look
key in one editor, one `apply()`), `equals` (what is seen: the preset only
without a photo, the darkening and the photo only with one), and a `Bundle`
form for `onSaveInstanceState` and the preview's `Intent` both ways (every value
clamped again when read). `SettingsActivity` holds the draft and the applied
look. A fresh open starts from prefs; a recreation (process reclaimed in the
background, a config change it does not handle) gets the draft back.

**What is in it:** the preset swatches, **Choose photo…**, **Darken photo**,
**Size** and **Height**. They change the draft and nothing else: the running
wallpaper, the picker's preview engine and the legacy lock picture all read
prefs, which only Apply writes. **The two switches are not in it.** They act at
once, as before.

**The settings screen.** While the draft differs from what is applied, a line
above Preview says "Changes not applied yet" and **Preview** is the primary
button (`PRIMARY`, blue). Preview is always there, also with no changes, as the
plain preview; it is disabled only for the second a picked photo is being
copied in.

**The preview** (`PreviewActivity` with `Look.EXTRA`): full screen, the
backdrop and Lili as the draft has them, as on the home screen without the
launcher. Its `LiliView` is given the `Look`: the backdrop is drawn from it, the
page's boot config (`PhoneForecast.config()`, through `LiliWeb.Callbacks`) has
its size and height, and it registers no prefs listener. Two buttons at the
top, below the status bar and any cutout (Lili stands at the bottom):

| Button | Does |
|---|---|
| **Cancel** (and Back) | `RESULT_CANCELED`. Back on the settings screen, the draft unchanged. |
| **Apply** (primary) | `RESULT_OK` with the look. The settings screen applies it, toasts "Applied", and the "not applied" line goes. |
| **Apply and set as wallpaper** (the same button, when Lili is not the home wallpaper) | Applies, then the Home switch's turn-on: save both screens, then the system picker with its hint. |

The preview writes nothing itself (group I checks it). Without a draft (adb,
`-e ep <id>`) it is the plain preview of what is applied, with no buttons.

**Apply is `SettingsActivity.commit()`**, the only place the look reaches
prefs: group I fails if any other code writes `bg_*`, `size` or `lift`, or
calls `Look.toPrefs()` or `Backdrop.adoptDraft()`. A draft photo is renamed over
`bg.jpg` first and `bg_rev` goes up by one; then all six keys in one
`apply()`. A key that does not change notifies nobody; the engines and
`LiliView` fold the ones that do into one backdrop redraw, one `Wall.apply` and
one `notifyColorsChanged()`. Lock mode still on from an earlier build: one
`LockPicture.requestSoon()` from `commit()` (a new picture about 1 s later),
not one per key.

**Leaving.** Back with changes not applied opens the app's own small dialog
(the no-backup dialog's panel and buttons): **Apply** (applies, toasts, leaves),
**Discard** (leaves; a draft photo is deleted) and **Keep editing** (the
dialog's Back too). Home or recents leave the screen as it is; nothing is
written. A fresh open starts from prefs, and deletes a `bg_draft.jpg` left
behind. A settings screen finishing deletes its draft photo too.

**The draft photo.** **Choose photo…** imports into `files/bg_draft.jpg`
(`Backdrop.draftFile`; a temp file, then a rename), never into `bg.jpg`, and
the draft gets a new `stamp`. Apply renames it over `bg.jpg`
(`Backdrop.adoptDraft`). Choosing a preset after it, Discard, or leaving
deletes it (`Backdrop.dropDraft`). Each file has its own decode, keyed by
revision: `bg.jpg` by `bg_rev`, the draft by its stamp. The wallpaper only asks
for `bg.jpg`, so it never shows a photo that is not applied, and the preview of
a draft photo asks for the draft, so it never shows the old one. On Apply the
preview's decode becomes the applied one, so the wallpaper does not decode the
same picture again. The launcher and the wallpaper picker can each open a
settings screen, and both share the one file: the screen that imported last
owns it, no other deletes it, and a screen whose draft photo has been taken
over falls back to the applied background (with "Could not use that picture").

**Colours of the preview's buttons.** They are made by
`SettingsActivity.button()` and painted by `paint(button, primary, true)`:
opaque faces (`BUTTON`, `PRIMARY`; group I fails on any face with alpha), so
their text reads the same over a dark preset, a bright photo or black, and a 2
dp `OUTLINE` (`#8089A0`), which is 3:1 or more against white, black and the top
and bottom colour of every preset (worst: 3.47 on `forest`). `EDGE`, the
settings screen's outline, is only about 2.6:1 on the dark presets, so it is
not used there. Primary text is 5.24:1 on `PRIMARY` and 4.73:1 pressed, ripple
included.

### Decision: no lock-screen switch to turn on

After the still lock-screen picture worked on the Huawei phone, the user
decided against it. The Lock screen switch can no longer be turned on.

- **Animated on the lock screen** works only where the phone maker's lock
  screen shows third-party live wallpapers. That is stock Android: Pixel,
  Motorola, Nokia, and the Android emulator (checked on API 26 and 34). The
  user turns on Home screen and chooses "Home screen and lock screen" in the
  picker. The Lock switch then shows on, disabled, "Lili, animated (with the
  home screen)".
- **Not supported:**
  - Huawei (EMUI, HarmonyOS 2-4): no third-party live wallpapers or video on
    the lock screen. Only an unofficial Theme Editor workaround exists, and we
    don't support it.
  - Samsung One UI: no third-party live wallpapers on the lock screen.
    Samsung's own video lock-screen wallpaper (15 s at most) is a manual
    option. The app doesn't export a video (yet).
  - Xiaomi, Oppo/OnePlus: varies by model; usually home screen only.
- **Why not more:** Android gives apps no API to animate the lock screen. The
  only other way is an app that replaces the lock screen ("Display over other
  apps", a permanent notification, the system lock screen hidden behind it). We
  decided against that.
- **What was left in code.** The still picture (`LockPicture.java`,
  `LockJob.java`, `src/wallpaper/still.js`, the `#still=1` page mode and its
  group H) was built and tested on Huawei, where it works. It stays in the tree,
  unreachable for turning on. Nothing sets `lock_on` true, and group I fails if
  anything does, or if the settings screen asks `LockPicture` for a picture.
  `Prefs.migrate()` carries over lock mode from the three-button build
  (`where` = `lock`/`both`). On such a phone the picture is kept fresh (the job,
  and the re-render after background, size or height changes) until the Lock
  switch is turned off. To bring the feature back, turning it on was: save the
  lock screen (`Backup.saveLock`'s rules), `lock_on` true with `lock_id` 0,
  `LockJob.schedule`, `LockPicture.request(context, false, callback)`. On
  failure (a toast with the reason), lock mode went off again and nothing was
  restored.

### The lock picture (`LockPicture.java`, `src/wallpaper/still.js`)

- **Offscreen, with the same page and backdrop.** A private `VirtualDisplay`
  (flags 0, as in the engine) on an `ImageReader` surface (RGBA_8888, the real
  screen size from `Display.getRealSize`, portrait, `densityDpi` from
  resources) and a `Presentation` on it holding `LiliView.still()`: the native
  backdrop (preset or photo), the transparent WebView, her size and height
  through the bridge's `config()`. The still view registers no prefs listener
  and never sends `Wall.show/hide`.
- **Still mode** is `wallpaper.html#still=1`. `wall-boot.js` runs
  `Still.begin()` instead of `Wall.begin()`, and `Wall.show/hide` are no-ops.
  She gets the fresh random sky (and outfit) of `Sky.begin()`. By day: one of
  five calm poses at random (`stand`, `glance` = `Actions.lookAt`, `sit`,
  `sit_glance`, `loaf` = sit with `Actions.lids(0.5)`), at a random x along the
  floor (6 to `100 - w - 6` % of the stage), facing either way. In the sleep
  window (23:00-07:00): asleep, `Actions.sleep()`, bare. `Alive.asleep(true)`
  from the start, so no blink, eye dart or ear flick can be caught half-way. No
  scene: `Cat.play` is never called.
- **Ready.** From 1.2 s it polls every 100 ms until the frame loop is back to
  `IDLE` or `RESTING` (every tween done); a deadline armed at begin freezes it
  at 2.2 s whatever happens, which is before `cat.js`'s first idle beat (armed
  for 2.5 s in `Cat.init`). Then `Timers.freeze()` - nothing on the page moves
  again - and `PhoneForecast.stillReady(json)` with
  `{pose, asleep, x, face, sky, outfit, settled, ms, faults, hidden, build}`.
- **Capture.** `LockPicture` keeps the latest `Image` (maxImages 3: one held,
  two for `acquireLatestImage`), and 600 ms after the ready call copies it into
  an `ARGB_8888` `Bitmap`, row by row when `rowStride` is padded. It refuses a
  page that reported faults. Then teardown (presentation, WebView, display,
  images, reader) and `setBitmap(bmp, null, true, FLAG_LOCK)` on a worker
  thread; `getWallpaperId(FLAG_LOCK)` read back right after is stored as
  `lock_id`, with `lock_at`.
- **Bounded.** One render at a time; requests during one fold into one more
  after it. The offscreen part ends within 8 s (timeout, then teardown);
  `setBitmap` then has 20 s before the render is given up on. Every wallpaper
  write (the picture, every restore) holds one lock, `Backup.WRITE`, and the
  picture re-checks lock mode inside it, so a restore always wins. Callbacks
  are always posted to the main thread. A lost renderer fails at once.
- **Night boot quirk (shared code, not changed).** `Cat.init()` calls
  `setQuiet(true)` (sleep) and then `start()`, whose `Actions.stand()` runs
  over the sleep tweens. `still.js` re-asserts `Actions.sleep()`; the live
  wallpaper booted inside the sleep window still shows the mixed pose until
  morning.

### Refresh (only while lock mode is on from an earlier build)

- (a) at once when lock mode was turned on (an explicit render; `lock_id` was
  reset to 0 first, so it overwrote whatever was there). Unreachable now;
- (b) about 1 s after an Apply that changed the background, size or height
  while lock mode is on (asked for once by `SettingsActivity.commit()`,
  debounced in `LockPicture`; before the draft it was a prefs listener, once
  the slider stopped);
- (c) `LockJob`, a `JobService` scheduled every 3 hours, persisted across
  reboots (`RECEIVE_BOOT_COMPLETED`), cancelled when lock mode goes off, and
  re-scheduled idempotently whenever the settings screen opens with lock mode
  on. Each run is a fresh pose and outfit, so a day/night flip shows at the
  next run.

(b) and (c) are "auto": if `getWallpaperId(FLAG_LOCK)` no longer equals the
stored `lock_id`, the user has put something else on the lock screen. It is
not overwritten: lock mode is turned off (`lock_on` false), the job is
cancelled, and `lock_note` says why. The settings screen applies the same rule
whenever it reads the state, so the Lock switch shows off (and disabled) at
once. With no stored id (0: a first picture that never came) the screen turns
lock mode off; when the call fails, the picture is taken to be still there.

### Previous wallpapers (`Backup.java`)

- **Saved on every turn-on of Home, before the picker opens: both screens**,
  because on stock Android the picker's "Home screen and lock screen" replaces
  the lock wallpaper too (on API 24-33 the picker clears it). Each turn-on
  replaces the older copy of that screen, since the user may have changed
  wallpapers in between. The exception is Lili's own wallpaper (her live
  component, her lock picture, a lock screen mirroring the live Lili): then the
  older copy stays, because it is still the one from before her. A screen that
  cannot be read has no backup afterwards (`bk_*` removed, file deleted).
- Home: live (not Lili) → `live:<component>`; a picture →
  `getWallpaperFile(FLAG_SYSTEM)` copied to `files/backup_home` (or
  `getDrawable()` as PNG below API 24, or when there is no file).
  Lock (API 24+): `getWallpaperId(FLAG_LOCK) < 0` or no lock file → `mirror`;
  a lock-only live wallpaper (API 34+) → `live:<component>`; a picture →
  `files/backup_lock`.
- **Permission.** A `SecurityException` while reading comes back as DENIED
  (from either screen). On API 23-32, if `READ_EXTERNAL_STORAGE` is not
  granted, it is requested once and the backup retried. Otherwise (denied, or
  API 33+) a toast says: "Android doesn't let Lili read your current wallpaper,
  so she can't save it. When you turn her off, you can choose a photo or the
  system default instead." Home on then goes ahead.
- **Restore**: see "Home off", "Lock off" and the no-backup dialog above
  (`Backup.homePlan`/`lockPlan` decide, `restore`, `restoreLockAfterHome` and
  `systemDefault` do it, off the main thread, each under `Backup.WRITE`). The
  backups are kept after a restore; there is no "forget" (the next turn-on
  replaces them).
- Lili's own previous *settings* are not kept: "remember previous settings
  and restore" was read as the previous wallpapers.
- **Migration from the three-button build.** `Prefs.of()` once per process:
  `where` = `lock`/`both` becomes `lock_on` true, and `where`, `bk_at`,
  `bk_denied` are removed. That build's backups (`bk_home`, `bk_lock` and their
  files) are used as they are.

### Permissions and manifest

Section 9 added three (`MANAGE_EXTERNAL_STORAGE`, `FOREGROUND_SERVICE`,
`FOREGROUND_SERVICE_MEDIA_PROJECTION`); its own "Permissions" lists all six.
As of this section: `SET_WALLPAPER` (normal), `RECEIVE_BOOT_COMPLETED` (normal; only the kept
lock-picture job needs it now), `READ_EXTERNAL_STORAGE` with
`maxSdkVersion="32"` (asked at run time only where it helps). `LockJob` is a
service with `android:permission="android.permission.BIND_JOB_SERVICE"`. Group
E of `check-wallpaper.js` asserts that exact list, the job service, and that
`LockJob` is periodic and persisted. `SettingsActivity` handles
`orientation|screenSize|smallestScreenSize|screenLayout|keyboardHidden` itself,
so a rotation never orphans a save, a restore or the dialog. The APK script
needs platform API 34 (`getWallpaperInfo(int)`), and hands d8 one jar of
classes (the list of `.class` paths outgrew cmd.exe's line limit).

### Vendor notes

- **Huawei (EMUI/HarmonyOS).** No third-party live wallpaper on the lock
  screen, and the still picture is blocked (above). For a phone that still has
  the picture from an earlier build, the settings screen shows a one-line tip
  while lock mode is on: turn off **Magazine unlock** if the picture doesn't
  show, and allow Lili in the background (Battery → App launch → Lili → Manage
  manually) for the 3-hourly refresh.
- **Samsung, Xiaomi, Oppo/OnePlus**: see the decision above; home screen only.

### Files

New: `src/wallpaper/still.js` (in `wallpaper-modules.js`'s tail, before
`wall.js`), `LockPicture.java`, `LockJob.java`, `Backup.java`. Changed:
`wall.js` (show/hide are no-ops in still mode), `wall-boot.js`,
`LiliView.java` (`still()`), `LiliWeb.java` (`stillReady`, `stillUrl()`),
`Prefs.java` (`lock_on`, `lock_*`, `bk_*`, the migration), `Backdrop.java`
(`importPhoto` into any file), `SettingsActivity.java` (the two switches, the
dialog, the colours), the manifest, strings (en, ru), `check-wallpaper.js` (E,
H, I, D's API list), `build-wallpaper-apk.ps1`.

The draft, later: new `Look.java`. Changed: `SettingsActivity.java` (the draft,
`commit()`, the leave dialog, the opaque window, the shared button factory and
`PRIMARY`/`OUTLINE`), `PreviewActivity.java` (the draft and its two buttons),
`LiliView.java` (a fixed `Look`, no listener; one `Wall.apply` per Apply),
`LiliWeb.java` (`Callbacks.config()`), `Backdrop.java` (the draft file, one
decode per file and revision, `adoptDraft`/`dropDraft`), `LiliWallpaper.java`
(one `notifyColorsChanged()` per Apply), `Prefs.java` (`pageConfig(size,
lift)`), `themes.xml`, strings (en, ru), group I of `check-wallpaper.js`. The
page is unchanged.

### Untested (no device in this round)

On the phone: the switches' colours as drawn by EMUI (group I checks the
numbers, not the rendering), `getWallpaperId(FLAG_LOCK)` on Huawei matching the
stored id (otherwise the Lock switch shows off at once and lock mode turns
itself off), every restore path (`setStream(FLAG_SYSTEM)` leaving a lock-only
picture alone, `clear(FLAG_LOCK)`, the built-in picture on the lock screen),
the permission prompt, `getWallpaperInfo()` right after the picker returns, and
what a vendor's picker does to the lock screen with "Home screen" alone. The
lock picture's offscreen render was tested on Huawei (it works); its job timing
under Huawei's background limits was not. The page side (still mode) is covered
offline by group H. Check on the phone with `adb logcat -s Lili`: `[LIFE]`,
`[BACKUP]`, `[LOCK]` and `[JOB]` lines.

The draft (no device either): group I checks the colours and who may write the
look, and `Look`'s logic was run on a desktop JVM, but on the phone: the opaque
screen and its system bars as EMUI draws them; that the home screen does not
change before Apply and does change, once, after it (logcat: one
`settings: applied`, one `Wall.apply` per engine); the preview's buttons clear
of the status bar and a notch, and readable over a dark preset, a bright photo
and black; a picked photo shown in the preview and not on the home screen until
Apply (`[BG] bg_draft.jpg ...`, then `[BG] draft photo applied`); "Apply and
set as wallpaper" going on to the picker; Back with changes, and the three
buttons of its dialog; the draft surviving a trip to the photo picker; and
`run-as com.lili.wallpaper ls files` showing no `bg_draft.jpg` after Discard,
Apply or a fresh open.

---

## 9. My wallpaper, the plan in the preview, the icons layer

Added after the third round. The user wanted three things: the picture they
already had as wallpaper as a background option that is never lost; the two
switches moved out of the settings screen into the preview, so the workflow is
edit, Preview, choose where she goes, Apply; and a preview that looks like the
home screen, with icons over her, so they can see how big she is next to them.

### My wallpaper (`Original.java`)

Users mostly have a picture of their own as wallpaper and may long have
deleted the file it came from. So on every open (and every resume) of the
settings screen, until it has worked once, Lili asks for the current **home**
wallpaper's picture on a worker thread (`Original.obtain`) and keeps it for
good as `files/original.jpg`.

| The home screen shows | Then |
|---|---|
| Lili's live wallpaper | the static home backup `Backup` saved before she took the screen (`Backup.homePicture`); without one, `NO_BACKUP` |
| another app's live wallpaper | there is no picture: `LIVE` |
| a picture, Android 12 or older | read it (`Backup.readHome`: `getWallpaperFile(FLAG_SYSTEM)`, else `getDrawable()` as PNG). API 27-32 need `READ_EXTERNAL_STORAGE`: `DENIED` asks for it once per screen (the same question as before Home on, which also counts) |
| a picture, Android 13 or newer | read it only if "All files access" is granted (`Environment.isExternalStorageManager()`); otherwise `NEED_ALL_FILES` and nothing is read |

Whatever was read goes through the backdrop's import (`Backdrop.importPhoto`:
sampled, EXIF upright, centre-cropped to the portrait screen, a temp file then
a rename) into `files/original.part`, and `keep()` renames that to
`original.jpg` **only if there is no `original.jpg` yet**, under a lock. Then
`Prefs.ORIG_AT` is written, once: it is the decode key of the picture
(`Backdrop`'s third slot, next to `bg.jpg` and `bg_draft.jpg`) and what every
view and engine listens to.

**Never lost.** No code path deletes, replaces or writes over `original.jpg`:
not Discard, Apply, a fresh open (which deletes only `bg_draft.jpg`), Choose
photo (its own slot, `bg.jpg`), a restore (it is only read, by
`Backup.setPicture`), or anything that sweeps `files/`. Group I checks it
statically: the name is spelt once, `Original.FILE` is used only by the
decoder, no variable holding the file is deleted, renamed, imported into or
written, there is no `deleteFile`/`listFiles` anywhere, and the one rename into
it sits behind `if (kept.isFile()) return`.

**The card.** While it cannot be kept, a card at the top of the settings
screen (on `DIALOG`, like the dialogs) says why and offers a way:

| State | Text | Buttons |
|---|---|---|
| `NEED_ALL_FILES` | To keep a copy of your current wallpaper, allow Lili "All files access". Android 13 and newer allow reading the wallpaper only with this permission. Lili reads nothing else. | **Allow** (primary): `Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION` with `package:com.lili.wallpaper`, falling back to `ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION`; `onResume` tries again. **Pick from photos instead** |
| `LIVE` | Your current wallpaper is animated, so there is no picture of it to keep. If you have it as a photo, pick it... | **Pick from photos** |
| `DENIED`, `NO_BACKUP`, `FAILED` | Lili couldn't get a copy of your current wallpaper. If you have it as a photo, pick it... | **Pick from photos** |

A pick from photos imports into `original.jpg` the same way
(`Original.fromPhoto`). Once it is kept, the card is gone for good. There is
no "not now": the card stays until there is a picture, because that is the
point of it.

**The background option.** Once kept, **My wallpaper** is the first button in
the background row: its thumbnail, centre-cropped, with "My wallpaper" on a
`BUTTON` band (`BUTTON_TEXT`, as on every button), ringed when chosen like a
swatch. It is a kind of its own, `original`, next to `preset` and `photo`
(`Look.kind`, `Prefs.KIND_ORIGINAL`, `bg_kind`). **Darken** applies to it as
to a photo (`Look.picture()`).

**The default look.** Before the first Apply there is no `bg_kind` in prefs;
then the applied look is My wallpaper once it is kept, otherwise the `night`
preset (`Prefs.kind`). Every Apply writes `bg_kind`, even one that applies the
default unchanged (`commit()`), so My wallpaper kept after a look was applied
never overrides that look. Kept while the settings screen is open, the
untouched draft follows it (as it follows an Apply from another settings
screen), and a wallpaper engine showing the default repaints.

**Restore.** Home off with no home backup now puts My wallpaper back
(`Backup.ORIGINAL`, `setStream(FLAG_SYSTEM)`) instead of asking; the
no-backup dialog only comes when there is neither. A saved live wallpaper
still goes through its picker first. A lock screen that needs a picture of its
own while the live Lili stays at home gets the home backup, else My wallpaper.

**Why "All files access".** From Android 13, `WallpaperManager.getDrawable()`
and `getWallpaperFile()` serve the real picture only to holders of
`READ_WALLPAPER_INTERNAL` (a system permission) or `MANAGE_EXTERNAL_STORAGE`
(**platform, unconfirmed here**; that is what the user decided on).
`READ_EXTERNAL_STORAGE` no longer counts and is declared only up to API 32.
`MANAGE_EXTERNAL_STORAGE` is not a runtime prompt: the user grants it on a
system settings page. Google Play allows it only for apps whose core purpose
needs broad file access (file managers, backup apps...), so a Play release
would be rejected; Lili is distributed through GitHub, where nothing reviews
it. On 13+ the picture is never read without the permission, so a platform
that answers with the default picture instead of refusing never gets that kept
by mistake. With it granted, `Backup.beforeHome` can also save the wallpapers
before Home on.

### The switches move into the preview: a plan

The workflow is: edit the look in settings, **Preview**, choose **Home screen**
/ **Lock screen** there, **Apply**.

**Settings** no longer has switches. Under **Where Lili lives** a read-only
line says what the system shows, read as the switches were (on every resume,
after every action, on every `lock_*`/`bk_*` change):

| System | Line |
|---|---|
| home is `LiliWallpaper`, lock mirrors it (or `getWallpaperInfo(FLAG_LOCK)` is ours) | Lili is on: home and lock screen (animated) |
| home is `LiliWallpaper` | Lili is on: home screen |
| her live wallpaper on the lock screen alone (API 34+) | Lili is on: lock screen (animated) |
| her picture from an earlier build on the lock screen | Lili is on: lock screen (her picture) / ...home screen, and her picture on the lock screen, plus "updated 14:05" etc. |
| nothing of hers | Not set: Lili isn't your wallpaper yet. Tap Preview, keep Home screen on and tap Apply. |
| a save or restore running | Saving your current wallpaper... / Putting your previous wallpaper back... |

**The preview's switches are a plan**, not actions, in a compact panel under
Apply and Cancel (opaque `PANEL`, the 2 dp `OUTLINE` that reads over any
backdrop, every control from the settings screen's factories). They start
from the real state, except that **Home starts on** when Lili is not the home
wallpaper yet: the user is previewing to set her. A line under each says what
Apply will do ("Lili takes the home screen after Apply", "Your previous
wallpaper comes back after Apply"...). The **Lock** switch is blocked exactly
as in section 8: off and disabled with "Not available..."; on and disabled
while her live wallpaper covers the lock screen (it shows off, "Leaves with the
home screen", when Home is planned off); enabled only to turn off her picture
from an earlier build or her lock-only live wallpaper. The settings screen
hands the preview the lock state and its line (`EXTRA_LOCK_STATE`,
`EXTRA_LOCK_NOTE`), so the preview reads nothing that writes. **Cancel** (and
Back) throws the plan away.

**Apply** returns the look and the plan (`EXTRA_HOME`, `EXTRA_LOCK_OFF`), and
`SettingsActivity.previewed()` - one code path - first commits the look (as
before; a draft photo that is gone stops everything), then carries out the
plan's differences from the system now, the old ways: Lock off first (her old
picture: lock mode off, the saved lock wallpaper back), then Home on (both
screens saved, then the picker with its hint) or Home off (the home backup,
else My wallpaper, else the no-backup dialog). A Home change waiting for the
Lock one runs when that restore ends, or when its dialog is cancelled or its
photo pick returns nothing (`continuePlan`). Dialogs come after Apply, on the
settings screen, as before. "Applied" is toasted when no Home change follows
(Home on has its own toasts). Preview is disabled while a plan is being
carried out. The button reads **Apply** always; "Apply and set as wallpaper"
is gone, because the Home switch says it.

### The icons layer (`IconsView.java`)

The preview's layers, bottom to top: the draft's backdrop; Lili (the WebView,
the draft's size and height); the **icons layer**; the controls. **Show
icons** in the panel turns the layer off and on (on by default).

**Drawn icons** (always there, no permission): drawn on a `Canvas` in dp - a
status bar strip (the time, three dots, a battery), a clock and date widget
near the top, two rows of rounded-square app icons (54 dp at most, 4 columns,
5 from 400 dp wide, the usual cell spacing) with light labels, one folder (a
rounded square holding four small icons), a dock of four above the search pill,
and the gesture handle. Its fills are muted mid-tones at 95% opacity, chosen
so each stands out 3:1 from white, black and every preset with a light mark
inside it at 3:1 too; the labels are light with a dark shadow (4.5:1 on the
darkest backdrop and on their own halo over white). Every colour is a constant
in `IconsView`, checked by group I. It is an approximation: it shows how big
she is next to icons and whether the dock covers her, not the user's launcher.

**Real icons**: **Use my real home screen** in the panel captures the user's
own home screen with Lili cut out, and the layer shows that instead while the
screen is the size it was taken at; **Drawn icons / Real icons** switches
between them once both exist (a new capture is shown at once). The button is
enabled only while Lili is the home wallpaper (her magenta is what is cut
out); otherwise "Set Lili as your wallpaper first to capture your real home
screen". A tap on the picture hides the panel; another shows it.

### The capture (`CaptureActivity`, `CaptureService`, `Chroma`, `Keyer`, `HomeShot`)

1. The preview starts `CaptureActivity` - transparent, no views, a task of its
   own (`taskAffinity="com.lili.wallpaper.capture"`, `NEW_TASK |
   MULTIPLE_TASK`, `excludeFromRecents`, `LiliCapture`: translucent, no dim, no
   animation, transparent bars with no contrast scrim) - and then moves its
   own task (settings and preview) to the back, so the launcher, with Lili as
   its wallpaper, is what shows behind the transparent window.
2. `MediaProjectionManager.createScreenCaptureIntent()`: the system's consent
   dialog, every time (an app cannot keep or skip it). On Android 14+ the user
   may choose "A single app" or "Entire screen", so a toast says "choose
   Entire screen" first (cancelled when the dialog returns, so it is not in
   the picture).
3. **API 29+**: `CaptureService`, a foreground service of type
   `mediaProjection` with its own channel and the notification "Lili is
   capturing your home screen", is started after the consent, and
   `getMediaProjection()` is called only when it reports that it is in the
   foreground. This is earlier than the brief's API 34: with targetSdk 29 or
   more, Android 10+ refuses `getMediaProjection()` without such a service
   (`SecurityException: Media projections require a foreground service of type
   ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION`); API 34 adds the
   `FOREGROUND_SERVICE_MEDIA_PROJECTION` permission and that the service may
   start only after the consent. Below API 29 there is no service. The
   projection's `Callback` is registered before the virtual display (Android
   14 requires it); one virtual display per projection.
4. **Chroma mode on** (`Chroma.set(true)`): a process-wide flag plus a
   notification to every live `LiliView` that follows prefs (the engines'
   views) and every engine drawing flat - activities and engines share one
   process. They draw solid `Chroma.KEY` (`#FF00FF`) instead of the backdrop
   and hide the WebView. The preview of a draft and the lock picture never
   key. 700 ms for the home screen to repaint and the consent dialog to go.
5. A `VirtualDisplay` (`VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR`) on an `ImageReader`
   at the real screen size; the latest frame 400 ms later (retried every
   100 ms, up to 15 times). Then `release()`: the display, the reader, the
   projection, the service - and chroma mode off **in a `finally`**. Every
   failure, the projection being stopped, Back, `onDestroy` and a **5 s
   safety timeout** armed at the consent all go through `release()`. The flag
   is not persisted, so a process that dies with it on comes back without it.
6. `Keyer` (plain Java, run on a desktop JVM): a pixel is background if it is
   magenta at any brightness - `max(r, b) >= 30`, `g <= 0.15 max(r, b)`,
   `|r - b| <= 0.15 max(r, b)` - so a launcher's dark scrims and dimming key
   out too. That is tighter than the brief's example (0.25 / 0.2): with those,
   a purple icon such as Material Purple `#9C27B0` is cut out. Background
   becomes transparent. An edge pixel (next to background) is solved as a
   blend of the key around it and the solid foreground beside it (least
   squares on the line between them; a 50/50 white rim comes out white at
   alpha 128), or, with no solid neighbour (thin text), by how magenta it
   looks; it gets that alpha and its colour with the key taken out, so there
   is no magenta fringe. Less than 10% background means the wallpaper was not
   on screen (a single app was chosen): a failure. About 120 ms for 1080x2400
   on a desktop.
7. Saved as `files/homescreen.png` (ARGB, a temp file then a rename) with the
   screen size and time (`shot_w`, `shot_h`, `shot_at`; `HomeShot`), the
   preview's task brought back (`ActivityManager.getAppTasks()`,
   `AppTask.moveToFront()`: an app's own tasks need no permission), the
   capture finished, and the preview's `onResume` loads the picture.

Any failure (consent denied, a single app chosen, nothing keyed out, the
timeout, the projection stopped) ends chroma mode, toasts why, and goes back;
the drawn icons stay.

### Permissions (six)

| Permission | Kind | When | For |
|---|---|---|---|
| `SET_WALLPAPER` | normal, at install | - | putting a saved wallpaper or My wallpaper back; the old lock picture |
| `RECEIVE_BOOT_COMPLETED` | normal | - | the old lock picture's refresh job survives a reboot |
| `READ_EXTERNAL_STORAGE` (max SDK 32) | runtime, API 23-32 | once, when My wallpaper cannot be read, and before Home on if a backup cannot be read | reading the current wallpaper |
| `MANAGE_EXTERNAL_STORAGE` | system settings page | when the user taps **Allow** on the card (API 33+) | reading the current wallpaper on Android 13+ |
| `FOREGROUND_SERVICE` | normal | - | the capture's service (API 28+) |
| `FOREGROUND_SERVICE_MEDIA_PROJECTION` | normal | - | ...of type `mediaProjection` (API 34+) |

The capture itself has no permission: the system's consent dialog allows one
capture, each time. `POST_NOTIFICATIONS` is not asked for: on Android 13+
without it the service's notice shows in the task manager rather than the
shade, and the capture works the same.

### Files

New: `Original.java`, `Chroma.java`, `Keyer.java`, `HomeShot.java`,
`IconsView.java`, `CaptureActivity.java`, `CaptureService.java`. Changed:
`Look.java` (`kind`, `original`, `picture()`), `Prefs.java` (`KIND_ORIGINAL`,
`ORIG_AT`, `SHOT_*`, `kind()`), `Backdrop.java` (the third slot),
`Backup.java` (`ORIGINAL`, `readHome`, `homePicture`), `LiliView.java` and
`LiliWallpaper.java` (chroma, `orig_at`), `LockPicture.java` (`copy()` shared),
`SettingsActivity.java` (status line, card, tile, the plan, static factories),
`PreviewActivity.java` (the panel, the plan, the icons layer, the capture), the
manifest, `themes.xml` (`LiliCapture`), strings (en, ru), `check-wallpaper.js`
(E and I). The page is unchanged.

### Checks added

Group E: the six permissions exactly; `CaptureService` the one typed
foreground service, `mediaProjection`, not exported; `CaptureActivity` not
exported, its own task affinity, not in recents, a translucent theme that does
not dim; the projection asked for only once the service is in the foreground
(API 29+), its callback registered before the virtual display. Group I: the
new colour pairs (the card, the tile's band, the preview panel's outline and
notes) and the mock's (every fill 3:1 over white, black and every preset, the
marks 3:1 on them, the labels 4.5:1); no colour in `IconsView` outside its
constants; every preview button painted for a backdrop, its three switches and
notes from the factories; the plan (Home starts on, nothing acts before
Apply, the look committed first); only `Look.toPrefs` writes look keys (as
before); `original.jpg` never deleted (above); `orig_at` written only by
`Original`; Home off falls back to My wallpaper; chroma on only in
`CaptureActivity`, after the safety timeout is armed, off only in a `finally`.
The new static checks were each made to fail once on purpose (a delete of the
file, chroma off outside the `finally`, a plain-painted button, Home starting
off, an extra permission).

### Untested (no device in this round)

- **All files access**: that Android 13/14 read the real wallpaper with it
  (and not without), that the Allow intent opens Lili's own page on each
  vendor, and the retry on return. The Huawei test phone (HarmonyOS, API
  29-31) takes the `READ_EXTERNAL_STORAGE` path instead.
- On Huawei: that `getWallpaperFile`/`getDrawable` give the real picture (EMUI
  themes and Magazine unlock may keep it elsewhere); that My wallpaper looks
  right (cropped, upright) as a background and as the restored wallpaper.
- **The capture on Huawei**: the consent dialog's wording and whether it asks
  for single app or entire screen; that the launcher shows behind the
  transparent window after `moveTaskToBack` (if another app's task was below
  ours, that app would show instead - for example when the settings were
  opened from the wallpaper picker); that the wallpaper repaints magenta
  within 700 ms; that the first frame comes within the retries; how EMUI's
  launcher dims or blurs the wallpaper (scrims must stay dark for the key);
  translucent dock and folder backgrounds (they come out tinted, not
  transparent); a screen-recording indicator in the picture;
  `AppTask.moveToFront()` bringing the preview back; and that chroma mode
  always ends (logcat `[CAPTURE] chroma off`).
- Android 14+: "A single app" ending in "couldn't find her wallpaper" (the
  chosen app is then in front, and bringing the preview back from behind it
  may be refused).
- The drawn icons' look on the phone; the preview panel's height on a small
  screen (it scrolls, and a tap hides it); the status line's wording for each
  state.
- Check with `adb logcat -s Lili`: `[ORIG]`, `[CAPTURE]`, plus the earlier
  `[LIFE]`, `[BACKUP]`, `[BG]`.

---

## 10. Real weather

Added after the fourth round. Until now her sky was invented (`sky.js`: eleven
kinds weighted by the month), which kept the app off the network. The user
wanted her clothes and animations to follow the real forecast for where they
live, with **no weather shown on screen**: it only drives her behaviour.

### Decisions (made by the user)

- **Sources.** **Open-Meteo** (no key; free for non-commercial use under
  10,000 calls a day; data CC BY 4.0, credited "Weather data by
  Open-Meteo.com"), hourly for three days. **MET Norway** Locationforecast 2.0
  `compact` is the fallback, used only when Open-Meteo fails (a network error,
  a 5xx, or JSON that is not a forecast), credited "Weather data by MET
  Norway". MET answers 403 without a User-Agent naming the app and a contact,
  so every request carries one constant, `Lili/<versionName>
  (+https://github.com/olegc0n/phoneForecast)`. Its `Expires` is respected and
  `If-Modified-Since` is sent with its `Last-Modified`. MET has no sunrise or
  sunset, so the page computes both, for either source.
- **Location**: a city search (Open-Meteo geocoding), plus **Use my location**.
  That asks for `ACCESS_COARSE_LOCATION` once, when tapped, and uses the
  framework `LocationManager`'s network provider (Huawei has no Google
  services). The place is named by `android.location.Geocoder` where there is
  one, else "My location (52.52, 13.41)". Prefs keep the name, the latitude and
  longitude (4 decimals) and how it was set (`search`/`gps`).
- **A Weather section in settings**, not part of the look's draft. It applies
  at once, with no Preview or Apply. A **Real weather** switch is on by default
  once a place is set; off means the invented sky and no network at all.
- **Never shown.** The settings say where the weather is for, when it was last
  fetched and from whom ("Updated 14:05 · Open-Meteo", or "No data yet"), and
  credit the source. No temperature or condition appears there or anywhere
  else.

### How it flows

```
WeatherPanel (settings) --place, switch--> Forecast.java --fetch--> files/forecast.json
LiliWallpaper (shown, data > 2 h old), WeatherJob (3 h) --^                 |
                                                                            v
page boot: PhoneForecast.forecast() ------------------------------> Wall.forecast(data)
new forecast, place or switch: LiliView pushes Wall.forecast(data | null)   |
                                                                            v
             Forecast.load (forecast.js) -> Sky.useReal(Forecast.now) -> Bus 'weather'
```

The page asks for the forecast once at boot through the bridge, **before** the
first sky is published, so she never starts in an invented outfit and changes
it a moment later. After that, every `LiliView` except the still one listens to
`Forecast` (weakly, like `Chroma`) and pushes `Wall.forecast(...)`: at once
while shown, else just before the next `Wall.show()`, so a hidden page is not
woken for it. The preview and the lock picture's still page get the same
forecast at boot, so her outfit matches. The WebView itself still loads nothing
from the network (`setBlockNetworkLoads(true)`); only Java fetches.

### The page: `src/wallpaper/forecast.js`

It sits in the tail of `tools/wallpaper-modules.js`, before `still.js` and
`wall.js`.

- `Forecast.load({source, body, lat, lon, fetchedAt, place})` (the body as a
  string or an object) normalises either source into one hourly series
  `[{t, code, sky, precip, intensity, isThunder, temp, wind, windAngle,
  humidity, pressure}]`. MET's later entries are six hours apart; each is
  spread over its hours, and the last one (a temperature with no sky) is left
  out. Anything that is not a usable forecast is refused, and nothing is kept.
- `Forecast.now(date)` returns the payload for the hour `date` falls in, in
  exactly `derive()`'s shape and key order (`src/core/weather.js`, not edited).
  It returns **null** when nothing is loaded, when the data was fetched more
  than **48 h** ago, or when there is no entry for this hour. The hour is found
  by time (an entry covers `[t, t + 1 h)`), never by the clock, so midnight,
  DST and a place in another time zone cannot pick the wrong one.
  - `temp` is rounded to a whole degree (as `derive()` gives it) and `wind` to
    0.1 m/s. `pressure` is in mm Hg (hPa x 0.750062, rounded), and
    `pressureTrend` is how many mm Hg it will have changed by over the next 3
    hours of the series. `moonCode` is null, as in `sky.js`. A missing
    `humidity` is 50 and a missing `wind` 0, as in `derive()`.
  - **Sunrise and sunset are computed locally** with the NOAA solar position
    algorithm (the one behind NOAA's solar calculator), for the place and the
    phone's date, each event refined at its own time. `sunriseMin` and
    `sunsetMin` are clock minutes on the phone (what `cat.js`'s `wxNow()`
    compares with), and `isNight` is `derive()`'s
    `m < sunriseMin || m > sunsetMin`. In polar day or night, or for a place so
    far away that its daylight straddles the phone's midnight, both are null
    (so `wxNow()` leaves `isNight` alone), and `isNight` is the sun's height
    right now (below -0.833 deg).
- **Sky stays the fallback and becomes the switch** (`sky.js`). `Wall.forecast`
  hands it `Forecast.now` (`Sky.useReal`), or null. While that has an answer,
  it is the sky:
  - `begin()` publishes it;
  - `tick()` (every minute) publishes it again **only when something material
    changed**. `Sky.material()` is the sky, the precipitation and its
    intensity, thunder, night, the whole degree, the whole m/s, and whether the
    pressure is falling by more than 3 mm (`cat.js`'s threshold). So her
    clothes do not flicker;
  - `redraw()` changes nothing. That covers the shuffle's every-fifth arming, a
    show after three hours away, and the boot loop that looks for unseen
    scenes.

  When it has no answer, or is taken away, the next tick publishes an invented
  sky again (`Wall.forecast(null)` does it at once). Meanwhile `Sky.kind()` is
  `'real'`, and the still page's state says so.
- **Off means never consulted.** With no forecast from the host, `Wall` never
  calls `Forecast` at all, and the page behaves exactly as before.

### The mapping

WMO codes (Open-Meteo's `weather_code`) are one table in `forecast.js`. The
intensity is what `derive()` gives: -1 light, 0 moderate, +1 heavy.

| WMO | sky | precip | intensity | thunder |
|---|---|---|---|---|
| 0 clear | `skc` | - | 0 | |
| 1, 2 mainly clear, partly cloudy | `bkn` | - | 0 | |
| 3 overcast; 45, 48 fog | `ovc` | - | 0 | |
| 51, 53, 55 drizzle | `ovc` | `ra` | -1 | |
| 56, 57 freezing drizzle | `ovc` | `ra_sn` | -1 | |
| 61, 63, 65 rain | `ovc` | `ra` | -1, 0, +1 | |
| 66, 67 freezing rain | `ovc` | `ra_sn` | -1, +1 | |
| 71, 73, 75 snow; 77 snow grains | `ovc` | `sn` | -1, 0, +1; -1 | |
| 80, 81, 82 rain showers | `bkn` | `ra` | -1, 0, +1 | |
| 85, 86 snow showers | `bkn` | `sn` | -1, +1 | |
| 95, 96, 99 thunderstorm (with hail) | `ovc` | `ra` | 0, 0, +1 | yes |
| any other | `ovc` with 0.1 mm or more of precipitation (`sn` at 0 C or below, else `ra`), otherwise `bkn` | | 0 | |

MET's `symbol_code` is one table of families. First `_day`, `_night` or
`_polartwilight` is taken off, then a `light`/`heavy` prefix (-1/+1; MET itself
spells two codes `lights...`), then an `andthunder` suffix (thunder).

| family | sky | precip |
|---|---|---|
| `clearsky` | `skc` | - |
| `fair`, `partlycloudy` | `bkn` | - |
| `cloudy`, `fog` | `ovc` | - |
| `rain` / `rainshowers` | `ovc` / `bkn` | `ra` |
| `sleet` / `sleetshowers` | `ovc` / `bkn` | `ra_sn` |
| `snow` / `snowshowers` | `ovc` / `bkn` | `sn` |
| unknown | `bkn` | - |

`fair` is `bkn`, like WMO 1, so both sources give the same sky for the same
weather.

### The Java side: `Forecast`, `WeatherJob`, `WeatherPanel`

**The fetch policy** (`Forecast.request`):

1. Fetch at once when the place changes or Real weather is turned on.
2. Fetch when a wallpaper engine becomes visible and the kept forecast is
   older than 2 h.
3. `WeatherJob` runs every 3 h with `NETWORK_TYPE_ANY`, persisted (job id 2;
   `LockJob` is 1). It fetches unless the forecast is younger than 1 h.
4. Never more than once in 30 min for one place, except for (1). After a
   failure, not again for 30 min, then 1 h, then 3 h for every later one
   (`wx_fails`).
5. With no place, or Real weather off, never: no request at all, and the job
   is cancelled (by `setOn(false)` and `ensureJob`; a job run that finds
   weather off also cancels itself).

Offline (no active network, `ACCESS_NETWORK_STATE`), nothing is attempted. One
fetch runs at a time, and a forced one asked for meanwhile follows it. A result
for a place that is no longer the place, or that arrives after the switch went
off, is thrown away. A stored attempt time in the future (a clock that went
backwards) does not block a fetch.

**The request** (`get()`, the one place a connection is opened) is HTTPS only
(anything else is refused), carries the User-Agent, asks for gzip, waits 10 s
to connect and 10 s to read, follows no redirects and reads 4 MB at most.
Open-Meteo gets the coordinates to 2 decimals (about 1 km) and MET to 4 (its
maximum). The geocoding gets the name typed, with `language=ru` on a Russian
phone.

**What is kept**: `files/forecast.json` (a temp file, then a rename) holds the
raw body, the source, when it was fetched, the place and its key (4
decimals), and MET's `Last-Modified` and `Expires`. A restart costs no
request. Prefs hold the metadata (`wx_at`, `wx_src`, `wx_key`, `wx_try_at`,
`wx_fails`, `wx_error`), so the policy and the settings never read the file on
the main thread. `Forecast.pageData()` gives the page
`{source, body, lat, lon, fetchedAt, place}`. It gives "" with no place, with
Real weather off, or when what is kept is for another place, so a new place
shows the invented sky until its own forecast arrives.

**Settings** (`WeatherPanel`, below Preview). Every view comes from
`SettingsActivity`'s factories, with a new `field()` for the city box.

| Line | Shows |
|---|---|
| Weather for: Minsk, Belarus | or "No place set, so the weather is invented" |
| **Real weather** (switch) | disabled until a place is set; turned on when one is chosen |
| [City] **Search** | the results (name, region, country) in the screen's own dialog; a tap sets the place |
| **Use my location** | permission, fix, name, as above: the last known fix if it is under a day old, else one update within 15 s, else the old fix |
| status | "Updated 14:05 · Open-Meteo", "Updated ... (the last update failed; Lili tries again later)", "No data yet", "Updating...", "Searching...", "Finding your location...", "Real weather is off..." |
| credit | "Weather data by Open-Meteo.com" or "Weather data by MET Norway" |
| note | what it does, and that only the coordinates (or the city searched for) are sent |

### Permissions (nine)

Section 9's six, plus three:

- `INTERNET` (normal): the forecast and the search.
- `ACCESS_NETWORK_STATE` (normal): nothing is attempted offline.
- `ACCESS_COARSE_LOCATION` (runtime): only when **Use my location** is tapped.

`android.hardware.location` and `android.hardware.location.network` are
declared not required, because a city can always be searched for.

### Files

New: `src/wallpaper/forecast.js`, `Forecast.java`, `WeatherJob.java`,
`WeatherPanel.java`, and `tools/fixtures/`: three real responses with their
headers, each captured once on 2026-11-20 for Berlin, with the app's
User-Agent.

Changed:

- `sky.js` (the real mode), `wall.js` (`forecast()`, `hostForecast()`),
  `wall-boot.js` (the forecast before the first sky), `wallpaper-modules.js`;
- `LiliView.java` (the bridge's `forecast()`, the listener, the push before a
  show), `LiliWeb.java` (`forecast()`, `setBlockNetworkLoads`),
  `LiliWallpaper.java` (when shown, a fetch if due; when created, the job);
- `SettingsActivity.java` (the section, `field()`, a `CharSequence` `button()`,
  the shared dialog helpers), `Prefs.java` (`wx_*`), the manifest, the strings
  (en, ru);
- `check-wallpaper.js` (E, I and the new group J).

### Checks added (group J, and E and I)

Group J runs on a Berlin clock, so DST is covered. It checks:

- both normalisers on the real fixtures;
- every WMO code, and every documented MET symbol (41, with each suffix),
  against tables typed in separately;
- the hour across midnight and both DST changes;
- sunrise and sunset within 3 min of Open-Meteo's own for Berlin, and of the
  independent USNO algorithm for Berlin and Minsk (the worst is under a
  minute); polar day and night at 78 N; a place whose day straddles the
  phone's midnight;
- data 47 h old is used, 49 h old is stale, and eleven broken inputs are
  refused;
- `derive()`'s keys, order and types for every hour of both fixtures;
- three hours of real weather publish only on material changes (four payloads
  in 180 ticks);
- with no forecast, `Forecast` is never called;
- real weather survives every redraw and gives way after 48 h, and the still
  page wears it;
- real weather reaches every scene that the invented sky of the same kind
  reaches: clear 20, rain 19, snow 51 and hot 22 of 82.

Statically, it checks: the User-Agent set on every request by the one `get()`;
HTTPS and the timeouts; the coordinates' precision; MET only when Open-Meteo
fails, with `Expires` and `If-Modified-Since`; no fetch without a place; the
job persisted, needing a network, and cancelled when off; the policy's
numbers; the page blocked from the network; the location path without Google
services; and the settings never reading the forecast. Each new static check,
and the "no republish" check, was made to fail once on purpose.

Group E checks the nine permissions and the job service. Group I checks the
field's colours, and that the Weather section has no control, colour or
dialog of its own.

### Untested (no device in this round)

- The fetch on the phone: HTTPS to both services through Huawei's network
  stack, gzip, the job every 3 h under EMUI's background limits (Lili may need
  "Manage manually" in App launch, as the old lock picture did), and the fetch
  when an engine comes into view (`[WX]` lines in `adb logcat -s Lili`).
- **Use my location on Huawei** (no Google services): whether its network
  provider gives a fix, whether `Geocoder.isPresent()` is true (otherwise the
  place is named by its coordinates), and the permission dialog.
- The Weather section as EMUI draws it: the city field (below API 29 the
  cursor colour comes from the theme), the keyboard over the screen
  (`adjustResize`), and the results dialog with eight places.
- That her outfit changes once when a forecast arrives or the hour turns, and
  that turning "Real weather" off brings the invented sky back on the home
  screen at the next show.
