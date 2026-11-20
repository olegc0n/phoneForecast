# Lili as a screen saver: design

Branch `screensaver`. This is the plan an implementer follows step by step. It
was checked against the code as of `59695b8`; file and line references are to
that commit.

---

## 1. What ships, and what the user gets

A second app, **Lili Screensaver** (`com.lili.saver`), built from the same
`src/cat/` engine. It contains an Android `DreamService` that hosts one
self-contained page: a clock (time only) and Lili. No forecast, no network, no
API key, no `INTERNET` permission, no settings dialog.

**The lock-screen answer, to pass on to the user as it is:**

| | |
|---|---|
| They get | Lili appears **when the phone is charging (or docked) and goes idle**, instead of the screen turning off. This also happens while the phone is locked. Touching the screen dismisses her and shows the lock screen or the app underneath. |
| They do not get | Lili on the lock screen itself, on the always-on display, or on battery. Android has offered no third-party lock-screen surface since 5.0, and the AOD is system-only. |
| Fallback | A **Preview** screen in the app that keeps Lili on screen while it is open, for phones whose maker removed the screen saver setting. |

Alternatives considered and rejected:

- **Live wallpaper.** `WallpaperService` draws to a bare `Surface` and cannot
  host a WebView, so the SVG rig would need a second renderer. It is visible only
  for the seconds the lock screen is lit, under the system clock, and several
  vendors do not allow live wallpapers on the lock screen at all.
- **Show-when-locked activity started on screen-off.** Android 10+ blocks
  background activity starts; the workarounds (overlay permission, full-screen
  intents, which Android 14 restricts to calls and alarms) need a permanent
  foreground service and look like lock-screen adware to Play Protect.

**Behaviour in one paragraph.** Every dream start loads the page afresh, invents
a season-appropriate "sky", and within a second plays one animation chosen at
random from the scenes that fit, never one of the last two shown. After that she
lives her idle life (blinks, wanders, grooming) with another random animation
every 45 to 150 seconds, and the sky changes every five animations. Between
23:00 and 07:00 she still plays one animation on start, then curls up and
sleeps, and the screen dims.

---

## 2. Decisions

**Q1. Lock screen.** DreamService only, plus the Preview activity as a manual
fallback. Reason: it is the only supported surface that can host the existing
WebView page; see the table above for what to tell the user.

**Q2. Divergence.** **No file under `src/`, `android/` or `tools/` that exists
on `main` is edited or deleted.** Everything is additive: `src/saver/`,
`src/saver.base.html`, `android-saver/`, three new tools. The only shared files
touched are `.gitignore` and `CLAUDE.md`, both append-only. Reason: a file that
is never edited here can never conflict, and a file never deleted can never
produce a modify/delete conflict. Three mechanisms make that possible:

- The saver build **derives its module list from `MODULES` in `tools/build.js`**
  (parsed as text, failing loudly), so a new `scenes-*.js` added on `main` is
  bundled with no change here.
- The cat's CSS and the `cat_*` / `app_*` config lines are **extracted from
  `src/informer.base.html` at build time** rather than copied.
- `cat.js` is driven through what it already exposes: a stand-in `Plan` global,
  a synthetic payload on `Bus` topic `weather`, `Cat.play(id)`, and in-place
  mutation of `cat_quiet_from/to` (the same pattern `settings.js` uses).

**Q3. Package identity.** `com.lili.saver`, label "Lili", dream label "Lili".
The launcher icon is `android/res/drawable/ic_launcher.png`, copied into a
staging folder at build time rather than duplicated in git. Reason: a different
applicationId lets both apps sit on the G4 Plus, and their `localStorage` stays
separate.

**Q4. Launcher activity.** `SetupActivity`, native views built in code: three
numbered steps, a button that fires `Settings.ACTION_DREAM_SETTINGS`, and a
Preview button. No `resolveActivity` (package visibility on Android 11+ makes it
lie); instead `try { startActivity } catch (ActivityNotFoundException)` falling
back to `ACTION_DISPLAY_SETTINGS`, then `ACTION_SETTINGS`, and revealing a hint:
"search Settings for *screen saver* or *Daydream*; if it is not there, use
Preview". If the internal bool `config_dreamsSupported` (looked up with
`Resources.getSystem().getIdentifier`, 0 means unknown) is false, the hint is
shown from the start. Vendor notes for the release text: Pixel and Samsung have
*Display → Screen saver*; Android 8 has *Display → Advanced → Screen saver*;
MIUI/HyperOS and EMUI often hide the entry (the intent sometimes still opens
it); Android Go builds may disable dreams. Step 3 of the instructions must say
**"When to start: While charging"**, because many phones default to "While
docked" and then nothing ever happens.

**Q5. Dream behaviour.**

- `setInteractive(false)`: any touch exits, as people expect of a screen saver.
  `setFullscreen(true)` plus the immersive flags `MainActivity` uses.
- One WebView per dream: created in `onAttachedToWindow`, destroyed in
  `onDetachedFromWindow`. Reason: a fresh page load per start is what makes
  "random animation on every start" true with no JS hook, and nothing is held
  between dreams. `onDreamingStarted` calls `onResume()` and `resumeTimers()`;
  `onDreamingStopped` calls `onPause()`. **Never `pauseTimers()`**: it is
  process-wide and would freeze the Preview and the next dream.
- Brightness: `setScreenBright(true)` by day; the page calls the bridge method
  `night(true)` when she falls asleep and the service posts
  `setScreenBright(false)` to the main thread. Reason: the G4 has an LCD, and a
  full-brightness backlight by the bed all night is the first complaint.
- `MainActivity`'s `evaluateJavascript` hooks (`Cat.play/plan/home/back`) are
  **not used**. The one thing that needs a parameter, playing a named scene from
  adb, goes through the URL hash (`saver.html#ep=<id>`).
- The bridge keeps the name `window.PhoneForecast`, because `host.js` detects
  exactly that and is reused unchanged. Methods: `host()`, `sdk()`, `is24h()`,
  `night(boolean)`.
- If `new WebView` throws (WebView package updating or missing), show a centred
  framework `TextClock` instead of crashing the dream.

**Q6. Random selection without weather.** A synthetic sky, then a uniform
shuffle.

- `Sky` draws one of eleven weather kinds, weighted by month (hemisphere from
  the timezone name, north by default), and publishes a payload of the same
  shape `weather.js` `derive()` produces. Reason: every `when` condition, the
  wardrobe, her mood and the idle-beat weights then work untouched, and snow
  scenes cannot turn up in July. Verified with a throwaway script against the
  real `scenes*.js` and `episodes.js`: the eleven kinds reach **82 of 83**
  entries; the 83rd is `wardrobe`, which has weight 0 on purpose.
- Night comes from local time against a per-month sunrise/sunset table, and the
  payload is re-published when it flips, because `Episodes.pick` and the scene
  conditions read `wx.isNight` raw.
- `Shuffle` picks **uniformly** among eligible scenes, not by `weight`. Reason:
  weights are day-planner frequencies (`desk_work` is 38, the fifty winter
  scenes 0.5 to 0.8, median 0.7), so a weighted pick shows the desk nearly every
  time during office hours.
- History is persisted (`saver.seen.v1`, capped at 60% of the library): unseen
  scenes are preferred, and the last two are never repeated while three or more
  are eligible.
- Clock conditions (`hours`, `weekdays`, `weekend`, `dates`, `months`, the desk
  and lunch windows, her birthday, New Year) are kept as they are.

**Q7. Remove or disable.** Nothing is removed from the tree; the saver build
simply does not bundle it. Reason: the harnesses read `src/informer.base.html`,
and the informer must keep building on this branch so a merge can be checked.
Not bundled: `core/weather.js`, `view.js`, `clock.js`, `settings.js`,
`settings-ui.js`, `boot.js`, `cat/plan.js`. Not packaged: all of `android/`
(including `BootReceiver`), `tools/yandex-check.html`. `tools/build-saver.js`
never reads `.local/config.json`, and it does no silent `replace()`: every
substitution goes through a helper that exits non-zero when the target text is
absent.

**Q8. Clock and screen.**

- **The stage becomes a fixed 9:16 box**, the largest that fits, and
  `#cat_holder` is sized as a percentage of it (44% by 32.4%). Reason: props are
  placed with `top` in percent of stage height but sized in percent of stage
  *width* with `height:auto` (`props.js` `put()`), and the holder is `44vw` by
  `57.6vw` (`informer.base.html:99`). Every scene was therefore composed for
  9:16, and on a 20:9 phone or in landscape (where 57.6vw is taller than the
  screen) props float and the floor maths goes negative. On the G4 the box is
  the whole screen, so nothing changes there.
- Stacked layout (aspect below 1): stage at the bottom, clock centred in the
  area above the stage's 63% line. Side layout (aspect 1 and above): stage on
  the right, clock centred in the space to its left.
- **Lili does not get bigger and the 63% rule stays.** Reason: it is baked into
  every scene and enforced by `check-scenes.js`; changing it means editing
  shared scene data on every merge.
- Burn-in: once a minute the clock block and the two stage containers are each
  nudged along a slow two-sine path (clock about ±4% of its zone; stage ±1.5%
  horizontally only, so her feet stay on the bottom edge). No transition, so it
  costs no frames. The clock is `#d8d8d8`, light weight, and drops to 35%
  opacity while she sleeps.
- 12/24-hour follows the system setting via `PhoneForecast.is24h()`; 24-hour in
  a browser tab.

**Q9. Release signing.** A separate `tools/build-saver-apk.ps1` rather than a
switch on `build-apk.ps1` (reason: Q2; the release block can be ported to `main`
later). `-Release` signs with `.local/release.keystore` (already gitignored),
alias from `LILI_KEY_ALIAS` (default `lili`), passwords passed to apksigner as
`env:LILI_KS_PASS` and `env:LILI_KEY_PASS` so they never appear on a command
line. It **never creates a keystore**: if the file or a variable is missing it
fails and prints the `keytool` command to run once. Without `-Release` it uses
the existing `android/keystore/debug.keystore`. Version lives in one tracked
file, `android-saver/VERSION` (`1.0.0`), and is injected with
`aapt2 link --version-name` / `--version-code` (major*10000 + minor*100 +
patch); the manifest carries neither.

**Q10. Verification.** See section 6.

---

## 3. File-by-file change list

### New: the page

| file | global | what it does |
|---|---|---|
| `src/saver.base.html` | | Markup, saver CSS, saver config, four INJECT markers. **No doctype**, like the informer page (see Risks). |
| `src/saver/sky.js` | `Sky` | `begin(date)`, `redraw(date)`, `tick(date)`, `current()`, `kinds()`, `weightsFor(month)`. Emits `Bus.emit('weather', payload)`. |
| `src/saver/shuffle.js` | `Shuffle` | `next(cands, wx, date)` picks and records; `eligible(cands, wx, date)`; `fresh(...)` count; `seen()`. |
| `src/saver/plan-random.js` | `Plan` | Stand-in for `cat/plan.js` with the interface `cat.js` calls. |
| `src/saver/saver-clock.js` | `SaverClock` | `paint()`, `start()`. Writes `#sv_time`, emits `minute` with `{date, now}` (the payload `cat.js` expects), re-arms on the minute boundary exactly as `core/clock.js` does. Must not reference the cat. |
| `src/saver/saver.js` | `Saver` | `begin()`: first animation, sleep window, drift, night bridge. |
| `src/saver/saver-boot.js` | | The `load` handler. |

`saver.base.html` body: `<div id="sv_clock"><div id="sv_time"></div></div>`,
then the same stage markup as the informer (`#cat_stage_back > #cat_props_back`,
`#cat_stage > #cat_holder + #cat_props + #cat_hit`). No `#wrapper`, no
`#wx_stale` (its absence is what makes `showStale` in `cat.js` return before it
touches `Weather`).

Markers: `<!--INJECT:CAT_CONFIG-->`, `<!--INJECT:CAT_CSS-->`,
`<!--INJECT:CAT_SVG-->`, `<!--INJECT:JS-->`. The saver's own config follows
`CAT_CONFIG` in a second block and overrides by re-declaring:

```js
var cat_quiet_from = '';      // owned by Saver at run time, see below
var cat_quiet_to   = '';
var cat_test       = false;
var cat_plan_demo  = false;
var saver_sleep_from = '23:00';
var saver_sleep_to   = '07:00';
var saver_gap_min    = 45;    // sec of idle life between animations
var saver_gap_max    = 150;
var saver_sky_every  = 5;     // animations per sky
var saver_hemisphere = 'auto';   // 'auto' | 'north' | 'south' | 'none'
```

Saver CSS, placed after `CAT_CSS` so it wins:

```css
html, body { width:100%; height:100%; margin:0; overflow:hidden; background:#000; }
#cat_holder { width:44%; height:32.4%; }                 /* of the 9:16 stage */
/* taller than 9:16: stage is full width, anchored to the bottom */
#cat_stage, #cat_stage_back { left:0; top:auto; bottom:0; width:100vw; height:177.78vw; }
#sv_clock { position:fixed; z-index:2; left:0; top:0; width:100vw;
            height:calc(100vh - 65.78vw); font-size:30vw; }
@media (min-aspect-ratio: 9/16) {      /* wider: stage is full height, centred */
  #cat_stage, #cat_stage_back { width:56.25vh; height:100vh; left:calc(50vw - 28.125vh); }
  #sv_clock { height:63vh; font-size:16.9vh; }
}
@media (min-aspect-ratio: 1/1) {       /* landscape: stage right, clock left */
  #cat_stage, #cat_stage_back { left:auto; right:3vw; }
  #sv_clock { width:calc(100vw - 56.25vh - 3vw); height:100vh;
              font-size:calc((100vw - 56.25vh) * 0.3); }
}
```

`#sv_clock` is a flex box centring `#sv_time`. Z-order is unchanged from the
informer: back scenery 1, clock 2, stage 3. Viewport meta is
`width=device-width, initial-scale=1`.

**`Sky` kinds** (sky, precip, temp, wind; thunder where marked) and month
weights for the north, January to December. South shifts the month by six;
`'none'` uses weight 1 everywhere.

```
mild     skc  null   18   3      1 1 2 3 3 3 3 3 3 2 1 1
hot      skc  null   26   2      0 0 0 0 1 3 3 3 1 0 0 0
grey     ovc  null   13   4      1 1 2 2 2 1 1 1 2 3 2 1
rain     ovc  ra     10   6      0 0 1 2 2 1 1 1 2 2 1 0
storm    ovc  ra     20   7  T   0 0 0 0 1 2 2 2 1 0 0 0
windy    bkn  null   12  10      1 1 2 2 1 1 1 1 2 2 2 1
chill    ovc  null    3   4      2 2 2 1 0 0 0 0 0 1 3 2
frost    skc  null   -8   2      3 3 1 0 0 0 0 0 0 0 1 3
snow     ovc  sn     -3   3      3 3 1 0 0 0 0 0 0 0 1 3
blizzard ovc  sn     -5   7      1 1 0 0 0 0 0 0 0 0 0 1
sleet    ovc  ra_sn   1   6      1 1 1 0 0 0 0 0 0 0 2 1
```

Payload fields, all required: `code` (`'saver:<kind>'`), `sky`, `precip`,
`intensity` 0, `isThunder`, `isNight`, `temp`, `wind`, `windAngle` 200,
`humidity` 60, `pressure` null, `pressureTrend` (-4 for rain and storm, else 0),
`sunriseMin`, `sunsetMin`. Sunrise/sunset by month, about 50° N, as clock
minutes: Jan 8:10-16:40, Feb 7:30-17:30, Mar 6:30-18:20, Apr 6:20-20:10,
May 5:30-21:00, Jun 5:00-21:30, Jul 5:20-21:20, Aug 6:00-20:30, Sep 6:50-19:20,
Oct 7:40-18:15, Nov 7:30-16:30, Dec 8:10-16:10. `'auto'` hemisphere: south when
`Intl.DateTimeFormat().resolvedOptions().timeZone` starts with `Australia/`,
`Antarctica/`, or is one of a short list (Auckland, Sao_Paulo, Buenos_Aires,
Santiago, Johannesburg, and similar); wrapped in try/catch, north otherwise.
`redraw` never returns the kind it had.

**`Shuffle.next`**: eligible = `weight > 0` and `cond(wx, date)` true (cond in
try/catch). Between 22:00 and 05:00 drop `energy: 'high'` if anything else is
left. Pool = eligible not in `seen`; if empty, eligible minus the last two
shown; if still empty, eligible. Uniform pick, append to `seen`, trim, save.

**`Plan` stand-in.** `init(fn)` keeps the library getter (`cat.js` passes
`Episodes.planLibrary`). `due(date)` is only reached when nothing is playing
(`cat.js` `beat()` returns earlier otherwise): the first call after an animation
arms a timer `now + random(saver_gap_min..max)`, and on every
`saver_sky_every`-th arming calls `Sky.redraw` so she changes clothes during the
idle gap rather than mid-scene; later calls return `null` until the timer
passes, then `{ id: Shuffle.next(lib.cands, Cat.weather(), date) }`.
`markDone` and `skip` disarm. `ensure`, `rebuildRest` are no-ops; `stats()`
returns `{day:'saver', total, done, unique, missed:0, substituted:0, byId}`;
`slots()` and `lines()` return `[]`; `upcoming()` returns the seconds to the
next one; plus `day()` and `clock(m)`.

**`Saver.begin`**, in order:

1. Up to four `Sky.redraw` attempts until `Shuffle.fresh(...)` is above zero.
2. After 600 ms: `Cat.play(id)`, where `id` is the `#ep=` hash value if it names
   a real scene, otherwise `Shuffle.next(...)`. This bypasses the 20-second boot
   guard in `beat()` (`cat.js:189`), which only gates the `Plan.due` path.
3. Poll `Episodes.running()` once a second. When the first animation has ended:
   set `cat_quiet_from = saver_sleep_from`, `cat_quiet_to = saver_sleep_to`, and
   `Bus.emit('minute', {date: new Date(), now: Date.now()})` so `cat.js` applies
   quiet hours at once. Reason for the delay: if the window were set at boot,
   `Cat.init` would put her to sleep, `Cat.play` would wake her body without
   clearing the `quiet` flag, and she would stand frozen at 8 fps until morning.
4. On every `minute`: `Sky.tick(date)`; step the drift; if "asleep"
   (`inClockWindow(date, saver_sleep_from, saver_sleep_to, false)` and step 3
   has run) changed, toggle class `sleeping` on `#sv_clock` and call
   `window.PhoneForecast.night(on)` if it exists.

**Boot order** (`saver-boot.js`): `SaverClock.paint()` → `Guard.run('sky',
Sky.begin)` → `SaverClock.start()` → `Guard.run('init', Cat.init)` →
`Guard.run('saver', Saver.begin)`. The clock is painted before anything
optional. `Cat` subscribes to `weather` with replay, so it receives the sky
published before it existed.

### New: tools

- `tools/saver-modules.js`: exports `list()`. Reads `tools/build.js` as text,
  extracts the `var MODULES = [...]` literal, keeps `src/core/{dom,store,host,
  bus}.js` and every `src/cat/*` entry in order, replaces `src/cat/plan.js` with
  `src/saver/sky.js`, `shuffle.js`, `plan-random.js`, and appends
  `saver-clock.js`, `saver.js`, `saver-boot.js`. Throws if the literal is not
  found or `dom.js`, `bus.js`, `plan.js`, `episodes.js` or `cat.js` is missing
  from it.
- `tools/build-saver.js [--debug]`: writes `saver.html` and
  `android-saver/assets/saver.html`. `CAT_CONFIG` = lines of
  `informer.base.html` matching `/^var (cat|app)_[a-z_]+ *=/`. `CAT_CSS` = every
  rule in it whose selector starts with `#cat_` (the CSS is flat, so
  `/#cat_[^{}]*\{[^}]*\}/g`); fail unless `#cat_stage`, `#cat_holder` and
  `#cat_props div` were all found. `cat_build` and `--debug` are applied by
  appending `var cat_build = '<stamp>';` / `var cat_debug = true;` after the
  injected block, so there is no exact-string match to break. The SVG gets the
  same two replacements as `build.js`, checked. Finally fail if the output
  contains `yandex` or `var api`.
- `tools/build-saver-apk.ps1 [-Install] [-Overlay] [-Release]` (CRLF): the
  pipeline of `build-apk.ps1`, with `android-saver/` as the source, a staged
  `res` (copy of `android-saver/res` plus the informer's `ic_launcher.png`),
  the version flags, and the signing rules from Q9. Output
  `android-saver/build/lili-screensaver-<version>[-debug].apk`. `-Release`
  refuses `-Overlay`, warns on a dirty git tree, and ends with
  `apksigner verify --print-certs` and the file's SHA-256. `-Install` opens
  `com.lili.saver/.SetupActivity`.
- `tools/check-saver.js`: section 6.

### New: `android-saver/`

`AndroidManifest.xml`: package `com.lili.saver`, **no `<uses-permission>` at
all**, no version attributes.

```xml
<application android:label="@string/app_name" android:icon="@drawable/ic_launcher"
    android:hardwareAccelerated="true" android:allowBackup="false" android:theme="@style/Saver">
  <activity android:name=".SetupActivity" android:exported="true">
    <intent-filter>
      <action android:name="android.intent.action.MAIN" />
      <category android:name="android.intent.category.LAUNCHER" />
    </intent-filter>
  </activity>
  <activity android:name=".PreviewActivity" android:exported="true"
      android:theme="@style/SaverFullscreen"
      android:configChanges="orientation|screenSize|smallestScreenSize|screenLayout|keyboardHidden|uiMode" />
  <service android:name=".LiliDream" android:exported="true"
      android:label="@string/dream_name" android:icon="@drawable/ic_launcher"
      android:permission="android.permission.BIND_DREAM_SERVICE">
    <intent-filter>
      <action android:name="android.service.dreams.DreamService" />
      <category android:name="android.intent.category.DEFAULT" />
    </intent-filter>
  </service>
</application>
```

No `android.service.dream` meta-data in v1: it is optional, there is no settings
activity to point at, and its `previewImage` attribute needs a platform 33+
`android.jar`, which the build does not guarantee.

`java/com/lili/saver/`, framework-only, anonymous classes as in `MainActivity`:

- `LiliWeb.java`: `static WebView create(Context, Listener)` with the settings
  from `MainActivity` minus `setAllowUniversalAccessFromFileURLs`,
  `setAllowFileAccessFromFileURLs` and `setAllowFileAccess` (assets load without
  them and there is no XHR), `setLoadWithOverviewMode(false)`, console piped to
  logcat tag `Lili`, the `PhoneForecast` bridge; `static void destroy(WebView)`
  (detach from parent, `stopLoading`, `about:blank`, `removeJavascriptInterface`,
  `destroy`); `static String url(String ep)` which appends `#ep=` only if `ep`
  matches `[a-z0-9_]+`.
- `LiliDream.java`: `DreamService` as in Q5.
- `SetupActivity.java`: as in Q4.
- `PreviewActivity.java`: immersive, `FLAG_KEEP_SCREEN_ON`, `LiliWeb`, reads the
  `ep` string extra; `night()` is a no-op; back finishes.

`res/values/strings.xml` (English), `res/values-ru/strings.xml`,
`res/values/themes.xml` (`Saver` on `Theme.Material`, `SaverFullscreen` on
`Theme.Black.NoTitleBar.Fullscreen`), and `VERSION`.

### Changed (append-only)

- `.gitignore`: `/saver.html`, `/android-saver/assets/`, `/android-saver/build/`.
- `CLAUDE.md`: a closing section naming the saver commands, the "edit nothing
  shared" rule, and the post-merge routine below.

### Removed

Nothing.

---

## 4. Implementation steps

Each step ends with something that can be checked before the next begins.

1. **Module list.** Write `tools/saver-modules.js`. *Check:* `node -e
   "console.log(require('./tools/saver-modules.js').list())"` prints
   `scenes-winter.js`, no `weather.js`, and `plan-random.js` where `plan.js` was.
2. **Sky and Shuffle** with `tools/check-saver.js` groups A and B (section 6).
   *Check:* `node tools/check-saver.js` passes; reachability reports 82 scenes.
3. **Plan stand-in**, plus group C. *Check:* harness passes.
4. **Page skeleton.** `saver.base.html`, `saver-clock.js`, `saver-boot.js` with
   only the clock wired, and `build-saver.js`. *Check:* open `saver.html` in
   desktop Chrome; the time shows and ticks; the console has no errors; the
   build fails loudly if a marker is renamed.
5. **Cat on stage.** Add `Cat.init` to the boot, with the 9:16 CSS. *Check:* in
   Chrome device mode at 360x640, 360x800, 768x1024 and 800x360 she stands on
   the bottom edge of the stage, idles and wanders; `--debug` shows the stage as
   9:16 in each. `node tools/check-scenes.js` still passes.
6. **`Saver.begin`.** *Check:* each reload starts a different animation within a
   second; `saver.html#ep=snowball` plays that one; left alone for five minutes
   she plays several more and changes outfit once; with the PC clock at 02:00
   she plays one, then sleeps, and the clock dims.
7. **Drift.** *Check:* with the tick temporarily at one second the clock and
   stage wander within bounds and nothing is clipped; restore the tick.
8. **Android app** (`android-saver/`, `build-saver-apk.ps1` debug path).
   *Check:* the APK builds; `aapt2 dump permissions` lists none; on an emulator
   or the G4 the on-device checklist passes.
9. **Release path.** *Check:* `-Release` without a keystore or without the
   variables fails with the instructions and writes no APK. (Creating the real
   keystore is the user's step.)
10. **Docs.** Append to `CLAUDE.md` and `.gitignore`. *Check:* `git status`
    shows only new files and those two; `git diff main --stat -- src android
    tools/build.js tools/build-apk.ps1` is empty.

**After every merge from `main`:** `node tools/check-scenes.js && node
tools/check-wardrobe.js && node tools/check-saver.js`, then
`node tools/build-saver.js`. A failure in `check-saver` groups D or E means
`main` changed something the saver leans on; fix it in `src/saver/`, not in the
shared file.

---

## 5. Risks and traps

- **Quirks mode.** `informer.base.html` has no doctype, so every prop was tuned
  in quirks mode. `saver.base.html` must also have none, or percentage heights
  and line boxes shift.
- **The transform is owned** (ARCHITECTURE §2). `Rig.flush` rewrites
  `#cat_holder`'s whole transform (`rig.js:278`), so the burn-in drift goes on
  `#cat_stage` and `#cat_stage_back`, never on the holder. That also keeps it
  invisible to the springs (§4): stage-relative coordinates do not change, so no
  `Alive.settle()` is needed.
- **Coordinates** (ARCHITECTURE "Coordinates"). The stage must stay
  `position: fixed` and all cat code must keep measuring `#cat_stage`. The
  saver's CSS does use `vw`/`vh`, which is safe only because this page has a
  plain viewport meta and nothing overflowing. Confirm the `stage WxH` line of
  the debug overlay on a real phone before trusting it.
- **Guard** (ARCHITECTURE "Error handling"). Three faults in a minute remove
  her for the session. The likeliest source after a merge is `cat.js` calling a
  `Plan` method the stand-in lacks, once per beat. Group D exists for this.
- **The quiet-hours handover** depends on two lines staying as they are:
  `cat.js:276` reading `cat_quiet_from/to` live through `inClockWindow(..., false)`,
  and `dom.js` answering `false` for a blank window. Group D asserts the first.
- **`Episodes.pick` still exists** and is weighted. `cat.js` falls back to it if
  the stand-in hands over a scene whose `cond` no longer holds (a sky flip
  between pick and play). Rare, harmless, but it is why a desk scene can
  occasionally appear twice.
- **`x = 0` means "not placed"** in `cat.js` `layout()`. Saver code never moves
  her, so this only matters if someone adds positioning to `Saver`.
- **A resize mid-scene** (rotation on a dock) runs `layout()` and snaps her to
  the floor. Accepted.
- **localStorage is flushed lazily** by the WebView. A dream dismissed within a
  couple of seconds may lose its history write and repeat a scene next time.
- **Sideloading.** Play Protect will warn about an unknown developer, and users
  must allow installs from the browser. Say so in the release notes.
- **The release keystore is the app's identity.** Lose it and every user has to
  uninstall to update. It needs a backup outside the repository. Debug and
  release builds share the package name, so switching between them on one phone
  also means uninstalling.
- **ES5 only**, as on `main`: `src/saver/*` runs on WebView 69. `Intl` exists
  there but is wrapped in try/catch anyway.

---

## 6. Verification

**Existing harnesses on this branch**

| harness | status |
|---|---|
| `check-scenes.js` | Applies fully. The engine and every scene are shared. |
| `check-wardrobe.js` | Applies. The wardrobe is driven by the synthetic sky. |
| `check-plan.js`, `check-weather.js`, `check-settings.js` | Test code the saver does not ship. They keep passing because their files are untouched; run them only to confirm a merge left `main`'s side intact. |

**New: `tools/check-saver.js`** (PASS/FAIL lines, non-zero exit; real sources in
a `vm` sandbox with the proxy stubs `check-plan.js` uses; module list from
`saver-modules.js`; seeded `Math.random`; no network).

- **A. Sky.** Every kind has every payload field. Each month has positive total
  weight. No snow kinds June to August in the north, and none December to
  February in the south. `isNight` flips at the table's minutes and `tick`
  re-emits exactly once per flip. `redraw` never repeats the current kind.
- **B. Shuffle.** Every scene with `weight > 0` is eligible for some
  kind/hour/weekday/date allowed by the month table. Over 3000 simulated starts
  at random times: no pick equals either of the two before it; every reachable
  scene appears; no scene has more than a stated multiple of the median count.
  Works with `wx === null`. Never returns a weight-0 scene. History survives a
  simulated restart through the fake `Store`.
- **C. Plan stand-in.** `due` returns null until the gap passes, then a slot;
  `markDone` re-arms; the sky is redrawn on every fifth arming.
- **D. Contract with shared code.** Every `Plan.<name>` referenced in the
  bundled `src/cat/*` exists on the stand-in. References to `Weather.`, `View.`,
  `Settings.`, `Clock.` in bundled modules match an allowlist (today: only
  `Weather.status` in `cat.js`). `cat.js` still contains the `inQuiet` line.
  Every bare `cat_*`/`app_*` identifier used by bundled modules is declared in
  the built page.
- **E. Built artefacts** (skipped with a notice if not built). `saver.html` has
  no `yandex`, no `var api`, no `#wx_stale`. The manifest has no
  `uses-permission` and does declare `BIND_DREAM_SERVICE`.

**On-device checklist**

```
powershell -ExecutionPolicy Bypass -File tools/build-saver-apk.ps1 -Install
adb logcat -s Lili
adb shell am start -n com.lili.saver/.PreviewActivity              # preview
adb shell am start -n com.lili.saver/.PreviewActivity -e ep snowball
adb shell am start -a android.settings.DREAM_SETTINGS              # the system picker
adb shell settings put secure screensaver_components com.lili.saver/.LiliDream
adb shell settings put secure screensaver_enabled 1
adb shell settings put secure screensaver_activate_on_sleep 1      # while charging
adb shell am start -n com.android.systemui/.Somnambulator          # start the dream now
adb shell dumpsys dreams
```

`Somnambulator` is stock SystemUI and some vendors strip it; the picker's own
*Preview* / *Start now* is the alternative. `adb shell cmd dreams
start-dreaming` exists on Android 13+ but, as far as I know, is root-only, so
treat it as emulator-only.

1. The Setup screen opens after install, and its button lands on the screen
   saver picker (or the fallback hint appears).
2. Lili is listed; selecting her and pressing Preview shows the clock and her.
3. Charging, screen timeout reached: the dream starts and an animation begins
   within about a second. Repeat five times: five different animations.
4. A touch exits. With a lock set, the lock screen follows.
5. Ten minutes: further animations, at least one outfit change, the clock moves
   slightly, the time is right and in the system's 12/24 format.
6. Rotate while dreaming (auto-rotate on): stage on the right, clock on the
   left, nothing clipped.
7. With the phone's clock set to 23:30: one animation, then she sleeps, the
   clock dims and the backlight drops.
8. Unplug: the dream ends. Logcat shows the WebView destroyed and no further
   `[LILI]` lines.
9. With the informer also installed: both launch, and neither's data changes.
10. `adb shell dumpsys package com.lili.saver | grep permission`: none requested.

**Publishing** (the user's step, after creating the keystore once):
`build-saver-apk.ps1 -Release`, then
`gh release create saver-v<version> <apk> --title "Lili Screensaver <version>"`
with notes covering install-from-unknown-sources, the three setup steps, and the
"While charging" setting.

---

## 7. Open questions for the user

1. **Package name.** `com.lili.saver` is the default. It is permanent once the
   first APK is public, so if a name tied to the GitHub account is preferred
   (`io.github.<account>.lili`), say so before the first release.
2. **Nights.** The default is one animation, then she sleeps from 23:00 to 07:00
   with the screen dimmed, because most charging happens overnight by a bed. If
   she should keep performing all night, set `saver_sleep_from/to` to `''`.
