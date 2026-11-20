# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lili is a weather display (Yandex forecast + clock) for an always-on Moto G4 Plus (Android 8, WebView ~69), with an animated SVG cat on the forecast screen. `README.md` covers building and usage; `docs/ARCHITECTURE.md` explains the design and the traps behind it. Read the relevant ARCHITECTURE.md section before touching the rig, springs, frame driver or coordinates.

## Commands

No package manager, no dependencies, no test framework. Everything is plain `node` or PowerShell.

```
node tools/build.js [--debug] [--test] [--plandemo] [--nocat] [--noalive]
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 [-Install] [-Overlay] [-Test] [-PlanDemo] [-NoCat] [-NoAlive]
```

- `build.js` inlines every `src/` module into one self-contained page: `informer.html`, `android/assets/informer.html`, and `tools/studio.built.html`. All of them are generated and gitignored, so never edit them.
- `build-apk.ps1` runs `build.js` itself, then aapt2 → javac → d8 → zipalign → apksigner. There is no Gradle. Output goes to `android/build/phone-forecast.apk`. It needs JDK 17+ and the Android SDK (`ANDROID_HOME`, default `%LOCALAPPDATA%\Android\Sdk`).

Offline harnesses (each one is a self-contained test suite; run the one that matches the code you changed):

```
node tools/check-weather.js [real.json]   # weather.js: fact vs hourly, staleness, due(), quota logic
node tools/check-wardrobe.js              # wardrobe.js: outfit ladder, night, scene leftovers
node tools/check-settings.js              # settings.js + weather.js: overrides, blanks, request spending
node tools/check-plan.js [--full] [--weather clear|rain|snow|hot|none] [--special] [--json]
```

The first three print PASS/FAIL lines and exit non-zero on failure. `check-plan.js` prints the generated day and does not assert anything. Each harness loads the **real** source files into a `vm` sandbox and fakes only the browser. They never touch the network.

On the device: `adb logcat -s Lili` (the page console and lifecycle trace are piped there). `adb shell am start -n com.lili.informer/.MainActivity -e ep <episode_id>` plays one animation, and `-e plan 1` dumps today's schedule.

## Hard constraints

- **ES5 only, plain globals, no modules.** The target is WebView ~69, so don't use `let`/`const`, arrow functions, template literals or `class`. Each file defines an IIFE global (`var Weather = (function(){...})()`).
- **Load order is the `MODULES` array in `tools/build.js`.** A new `src/` file does nothing until it is added there, in dependency order (`dom` first, `bus` before emitters, `rig` before `anim`, `boot` last). If the studio needs it too, add it to `STUDIO_MODULES` as well.
- **The API quota is 30 requests/day.** Never write code or tests that call the Yandex API to "see what happens". Use `check-weather.js` with a synthetic or captured response. App launches must stay free: `Weather.restore()` sets `lastcall` from the cached file's timestamp. Settings saves only re-fetch when the key or URL actually changed.
- **The API key never goes in git.** The real key and coordinates live in `.local/config.json` (gitignored), and `build.js` substitutes them at build time. `tools/yandex-check.html` holds a key when in use, so don't commit a real one there either.

## Build-time string replacement (fragile, and fails silently)

The config block at the top of `src/informer.base.html` is plain `var` globals. Several things depend on its exact text:

- `build.js` flags and the `.local` override use **exact-string `replace()`** on lines like `var cat_debug         = false;` (column alignment included) and `var api = 'xxxxxxxx-...';`. If you reformat or rename one of these lines, its flag stops working and nothing errors. `--noalive` also matches the literal `Alive.step(dt);` in `cat.js`.
  - Known instance: `--random`/`-Random` targets `var cat_episodes_random = false;`, which no longer exists, so it is currently a no-op. The README also still describes the removed launch chooser (`cat_start_menu`, "Тест анимаций") that the gear/settings dialog replaced.
- The harnesses pull the config by filtering lines that match `/^var [a-z_]+ *=/`. Config globals must stay unindented, one per line, with lowercase/underscore names.
- `cat_build` is stamped by the build, and a saved day plan from a different build is discarded.

`src/core/settings.js` overlays four of these globals (`api`, `api_url`, `cat_quiet_from`, `cat_quiet_to`) from localStorage at boot. Phone-side values beat build defaults, and a stored blank falls back to the default. It mutates the globals in place, and every module reads them directly.

## Architecture

**Two halves that only meet on `Bus`** (`src/core/bus.js`):
- `src/core/`: the forecast. It is started first and unconditionally in `boot.js` (`Settings.load` → `Weather.restore` → `Clock.start`). It must never reference the cat.
- `src/cat/`: Lili. `Cat.init()` and `SettingsUI.init()` run inside `Guard.run`. Three faults within one minute disable the cat for the session, and the clock carries on. Anything optional or cat-related goes through `Guard`.
- `Bus.on(topic, fn, replay)` keeps the last payload per topic. Weather is published as *state*, so a subscriber that arrives late (the cat starts after the forecast paints) must pass `replay` to receive it.

**Weather** (`weather.js`) stores the whole raw API response. While the response is fresher than `timeout` it shows `fact`; after that it shows the hourly entry for the current hour (up to 48 h ahead). `Clock`'s minute tick calls `Weather.rehour()` and `Weather.due()`. `Weather.status()` → `fact | hour | stale-fact`, and only `stale-fact` counts as a real failure.

**Cat layers, bottom up:** `rig.js` (pose) → `anim.js` (timer-driven frame loop, five fps tiers, *not* rAF) → `alive.js` (springs/micro-motion) → `actions.js` (verbs) → `beats.js` (beat vocabulary, cursor-timed) → `scenes.js` (animations as data) / `episodes.js` (17 legacy hand-written animations plus the weighted picker) → `plan.js` (the whole day planned at 00:00) → `cat.js` (the one life loop; also `Cat.play/plan/home/back`, which `MainActivity.java` calls through `evaluateJavascript`, so keep those names stable).

Key rules from ARCHITECTURE.md that are easy to break:
- `Rig.set` writes the authored `pose` channel and `Rig.bias` writes the procedural `add` channel. Anything that runs every frame uses `bias`.
- The rig owns each animated part's whole `transform` attribute. A static offset on an animated `<g>` gets wiped on the first frame, so put it on an outer wrapper group.
- Morphed parts must be registered in `Rig.PARTS`. Every shape in a `shapes.js` set uses identical path commands in the same order.
- Coordinates are **percent of `#cat_stage`**, never `vw` or px (`window.innerWidth` is wrong on this page). Props stay below 63% of the stage height, because nothing may cover the clock.
- Instant repositions must call `Alive.settle()`, or the springs read them as speed.

**New animations** go in `src/cat/scenes.js` as data (`Scenes.add(id, {tags, when, weight, beats, perDay?})`), not in `episodes.js`. `tools/studio.html` (built to `studio.built.html`) previews them. Run `check-plan.js` afterwards to see where the scene lands in the day.

**Android host** (`android/`): two framework-only Java files, no AndroidX. It loads `file:///android_asset/informer.html` and needs `setAllowUniversalAccessFromFileURLs(true)`, or every XHR is blocked as a null-origin CORS failure. The JS bridge is `window.PhoneForecast`, feature-detected in `host.js`, so the same page also runs in a plain browser tab. Text files are LF except `*.ps1` (CRLF), as set in `.gitattributes`.

## Screen saver variant (branch `screensaver`)

A second app, **Lili Screensaver** (`com.lili.saver`): an Android `DreamService` showing a clock and the cat, with no weather, no network, no key and no permissions. The design and the reasons behind it are in `docs/SCREENSAVER.md`, and the release-notes draft is `docs/SCREENSAVER-RELEASE.md`.

```
node tools/build-saver.js [--debug]          # saver.html + android-saver/assets/saver.html
node tools/check-saver.js                    # groups A-F: sky, shuffle, Plan stand-in, contract, built files, whole page
powershell -ExecutionPolicy Bypass -File tools/build-saver-apk.ps1 [-Install] [-Overlay] [-Release]
adb shell am start -n com.lili.saver/.PreviewActivity [-e ep <episode_id>]
```

- **Edit nothing shared.** No file under `src/`, `android/` or `tools/` that exists on `main` is edited or deleted on this branch, and neither is `README.md`. Everything the saver needs is additive: `src/saver/`, `src/saver.base.html`, `android-saver/`, `tools/saver-modules.js`, `tools/build-saver.js`, `tools/build-saver-apk.ps1`, `tools/check-saver.js`. That is what lets `main` keep merging in with no conflicts.
- The saver's module list is derived from `MODULES` in `tools/build.js` (with `cat/plan.js` replaced by `src/saver/sky.js`, `shuffle.js`, `plan-random.js`). Its `cat_*`/`app_*` config and `#cat_` CSS are extracted from `src/informer.base.html` at build time. A new `scenes-*.js` on `main` is bundled automatically.
- `cat.js` is driven only through what it already exposes: a stand-in `Plan`, a synthetic payload on Bus topic `weather` (`Sky`), `Cat.play(id)`, and in-place mutation of `cat_quiet_from/to` after the first animation.
- `build-saver.js` never reads `.local/config.json`, and it fails (exit 1, nothing written) when an expected marker, CSS rule or SVG attribute is missing, or when the page would mention the forecast API.
- The application id is the single variable `$AppId` in `tools/build-saver-apk.ps1` (passed to `aapt2 link --rename-manifest-package`). The Java package stays `com.lili.saver`. The version is `android-saver/VERSION`. `-Release` needs `.local/release.keystore` plus `LILI_KS_PASS`/`LILI_KEY_PASS` (and optionally `LILI_KEY_ALIAS`). It never creates a keystore.

**After every merge from `main`:** `node tools/check-scenes.js && node tools/check-wardrobe.js && node tools/check-saver.js`, then `node tools/build-saver.js`. A failure in `check-saver` groups D, E or F means `main` changed something the saver leans on. Fix it in `src/saver/`, not in the shared file.
