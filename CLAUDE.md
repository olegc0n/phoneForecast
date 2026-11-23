# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Lili is a weather display (forecast + clock) for an always-on Moto G4 Plus (Android 8, WebView ~69), with an animated SVG cat on the forecast screen. `README.md` covers building and usage; `docs/ARCHITECTURE.md` explains the design and the traps behind it. Read the relevant ARCHITECTURE.md section before touching the rig, springs, frame driver or coordinates.

**This is branch `free-forecast`: Lili Weather (`com.lili.weather`), the same app with a free, keyless forecast (Open-Meteo, MET Norway as the fallback) instead of Yandex.** Read the section "Free-forecast branch" below first; where this file describes `main` (the Yandex key, the 30/day quota, `com.lili.informer`), that section overrides it.

## Commands

No package manager, no dependencies, no test framework. Everything is plain `node` or PowerShell.

```
node tools/build.js [--debug] [--test] [--plandemo] [--nocat] [--noalive]
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 [-Install] [-Overlay] [-Test] [-PlanDemo] [-NoCat] [-NoAlive] [-Release]
```

- `build.js` inlines every `src/` module into one self-contained page: `informer.html`, `android/assets/informer.html`, and `tools/studio.built.html`. All of them are generated and gitignored, so never edit them.
- `build-apk.ps1` runs `build.js` itself, then aapt2 → javac → d8 → zipalign → apksigner. There is no Gradle. Output goes to `android/build/lili-weather-<version>[-debug].apk` (version from `android/VERSION`). It needs JDK 17+ and the Android SDK (`ANDROID_HOME`, default `%LOCALAPPDATA%\Android\Sdk`).

Offline harnesses (each one is a self-contained test suite; run the one that matches the code you changed):

```
node tools/check-weather.js              # wxsource.js + weather.js: the adapter (fixtures), fact vs hourly, staleness, due(), the fetch policy
node tools/check-wardrobe.js              # wardrobe.js: outfit ladder, night, scene leftovers
node tools/check-settings.js             # settings.js + places.js + weather.js: the place, sleep hours, city search, no place = no request
node tools/check-i18n.js                 # i18n.js: language detection, both tables, formats, the screen and dialog rendered in each
node tools/check-plan.js [--full] [--weather clear|rain|snow|hot|none] [--special] [--json]
```

The PASS/FAIL harnesses (all but `check-plan.js`) print PASS/FAIL lines and exit non-zero on failure. `check-plan.js` prints the generated day and does not assert anything. Each harness loads the **real** source files into a `vm` sandbox and fakes only the browser. They never touch the network.

On the device: `adb logcat -s Lili` (the page console and lifecycle trace are piped there). `adb shell am start -n com.lili.weather/.MainActivity -e ep <episode_id>` plays one animation, and `-e plan 1` dumps today's schedule.

## Hard constraints

- **ES5 only, plain globals, no modules.** The target is WebView ~69, so don't use `let`/`const`, arrow functions, template literals or `class`. Each file defines an IIFE global (`var Weather = (function(){...})()`).
- **Load order is the `MODULES` array in `tools/build.js`.** A new `src/` file does nothing until it is added there, in dependency order (`dom` first, `bus` before emitters, `rig` before `anim`, `boot` last). If the studio needs it too, add it to `STUDIO_MODULES` as well.
- **(main only)** **The API quota is 30 requests/day.** Never write code or tests that call the Yandex API to "see what happens". Use `check-weather.js` with a synthetic or captured response. App launches must stay free: `Weather.restore()` sets `lastcall` from the cached file's timestamp. Settings saves only re-fetch when the key or URL actually changed.
- **(main only)** **The API key never goes in git.** The real key and coordinates live in `.local/config.json` (gitignored), and `build.js` substitutes them at build time. `tools/yandex-check.html` holds a key when in use, so don't commit a real one there either.

## Build-time string replacement (fragile, and fails silently)

The config block at the top of `src/informer.base.html` is plain `var` globals. Several things depend on its exact text:

- `build.js` flags and the `.local` override use **exact-string `replace()`** on lines like `var cat_debug         = false;` (column alignment included) and `var api = 'xxxxxxxx-...';`. If you reformat or rename one of these lines, its flag stops working and nothing errors. `--noalive` also matches the literal `Alive.step(dt);` in `cat.js`.
  - Known instance: `--random`/`-Random` targets `var cat_episodes_random = false;`, which no longer exists, so it is currently a no-op. (On main the README also still describes the removed launch chooser; on this branch it describes the gear.)
- The harnesses pull the config by filtering lines that match `/^var [a-z_]+ *=/`. Config globals must stay unindented, one per line, with lowercase/underscore names.
- `cat_build` is stamped by the build, and a saved day plan from a different build is discarded.

`src/core/settings.js` overlays these globals (on this branch `place_name`, `place_lat`, `place_lon`, `cat_quiet_from`, `cat_quiet_to`; on main `api`, `api_url` and the quiet hours) from localStorage at boot. Phone-side values beat build defaults, and a stored blank falls back to the default. It mutates the globals in place, and every module reads them directly.

## Architecture

**Two halves that only meet on `Bus`** (`src/core/bus.js`):
- `src/core/`: the forecast. It is started first and unconditionally in `boot.js` (`Settings.load` → `Weather.restore` → `Clock.start`). It must never reference the cat.
- `src/cat/`: Lili. `Cat.init()` and `SettingsUI.init()` run inside `Guard.run`. Three faults within one minute disable the cat for the session, and the clock carries on. Anything optional or cat-related goes through `Guard`.
- `Bus.on(topic, fn, replay)` keeps the last payload per topic. Weather is published as *state*, so a subscriber that arrives late (the cat starts after the forecast paints) must pass `replay` to receive it.

**Weather** (`weather.js`) stores the whole raw API response (on this branch the raw Open-Meteo or MET body, run through `wxsource.js` on every read). While the response is fresher than `timeout` it shows `fact`; after that it shows the hourly entry for the current hour (up to 48 h ahead). `Clock`'s minute tick calls `Weather.rehour()` and `Weather.due()`. `Weather.status()` → `fact | hour | stale-fact`, and only `stale-fact` counts as a real failure.

**Cat layers, bottom up:** `rig.js` (pose) → `anim.js` (timer-driven frame loop, five fps tiers, *not* rAF) → `alive.js` (springs/micro-motion) → `actions.js` (verbs) → `beats.js` (beat vocabulary, cursor-timed) → `scenes.js` (animations as data) / `episodes.js` (17 legacy hand-written animations plus the weighted picker) → `plan.js` (the whole day planned at 00:00) → `cat.js` (the one life loop; also `Cat.play/plan/home/back`, which `MainActivity.java` calls through `evaluateJavascript`, so keep those names stable).

Key rules from ARCHITECTURE.md that are easy to break:
- `Rig.set` writes the authored `pose` channel and `Rig.bias` writes the procedural `add` channel. Anything that runs every frame uses `bias`.
- The rig owns each animated part's whole `transform` attribute. A static offset on an animated `<g>` gets wiped on the first frame, so put it on an outer wrapper group.
- Morphed parts must be registered in `Rig.PARTS`. Every shape in a `shapes.js` set uses identical path commands in the same order.
- Coordinates are **percent of `#cat_stage`**, never `vw` or px (`window.innerWidth` is wrong on this page). Props stay below 63% of the stage height, because nothing may cover the clock.
- Instant repositions must call `Alive.settle()`, or the springs read them as speed.

**New animations** go in `src/cat/scenes.js` as data (`Scenes.add(id, {tags, when, weight, beats, perDay?})`), not in `episodes.js`. `tools/studio.html` (built to `studio.built.html`) previews them. Run `check-plan.js` afterwards to see where the scene lands in the day.

**Android host** (`android/`, package `com.lili.weather` on this branch): two framework-only Java files, no AndroidX. It loads `file:///android_asset/informer.html` and needs `setAllowUniversalAccessFromFileURLs(true)`, or every XHR is blocked as a null-origin CORS failure. The JS bridge is `window.PhoneForecast`, feature-detected in `host.js`, so the same page also runs in a plain browser tab. Text files are LF except `*.ps1` (CRLF), as set in `.gitattributes`.

## Free-forecast branch (`free-forecast`)

Lili Weather: the full app (forecast, clock, cat, gear dialog) with the Yandex forecast replaced by free, keyless sources. App id `com.lili.weather`, label "Lili Weather", so it installs beside main's `com.lili.informer`. `docs/WEATHER-RELEASE.md` is the release-notes draft for 1.0.0.

**What changed versus main:**

- **Sources.** Open-Meteo (`api.open-meteo.com`, `current=` + three days `hourly=`, `wind_speed_unit=ms`, `timeformat=unixtime`), and MET Norway Locationforecast 2.0 compact only when Open-Meteo fails and only in the APK (`Host.native()`): MET refuses a request without an app User-Agent, an XHR cannot set one, so `MainActivity.USER_AGENT` (`Lili-Weather/<versionName> (+https://github.com/olegc0n/phoneForecast)`) is appended to the WebView's. MET is never asked before its `Expires` for the same place and gets `If-Modified-Since`; a 304 renews the stored file's stamp. The page's own XHR does all of it (`getJSON`, and `httpGet` in `dom.js` for status and headers). Nothing on this branch may contact a Yandex domain; there is no key, no URL setting, and `tools/yandex-check.html` is gone.
- **An adapter, not a new pipeline.** `src/core/wxsource.js` (`WxSource.adapt(src, body, lat, lon, fetchedAt)`) turns either response into the main-era response shape (`fact`, `forecasts[]` with `date`, `sunrise`, `sunset`, `moon_code`, `hours[]` with `hour`/`hour_ts`, `parts.night|morning|day|evening`) with exactly the fields `view.js`, `weather.js` and `derive()` read, in their units (whole degrees, m/s, %, mm Hg = hPa x 0.750062). WMO codes and MET symbols become the icon codes the stylesheet already has, and `splitCode()` reads them back for the cat (one alias was added: `.ovc_ts_sn` shares `.ovc_+sn`). Sunrise/sunset (NOAA), day/night in icons (sun elevation at mid-hour) and the moon phase are computed locally. Days and hours are the phone's. The normalisers and the NOAA code come from the screensaver branch's `src/wallpaper/forecast.js`. Don't name anything in page code "yandex": `build.js` refuses any output that contains the word.
- **The cache** is `wx.raw.v2` = `{v, t, src, key, lat, lon, place, raw, lm, expires}`, the raw body, adapted on every read and shown only for the current place (`key` = lat,lon at 4 decimals).
- **The place** is chosen behind the gear: city search (`src/core/places.js`, Open-Meteo geocoding, `language=ru` for Cyrillic input, else `en`) or "use my location" (bridge `PhoneForecast.locate()`; `MainActivity` asks `ACCESS_COARSE_LOCATION` when tapped, `LocationManager` network provider, last fix under a day or one update in 15 s, `Geocoder` for the name, then `Places.located({...})` - keep that name, like `Cat.play/plan/home/back`). `onResume()` skips `Cat.home()` for the resume right after the permission dialog, or the settings dialog would close. Choosing applies at once (`Settings.setPlace` + `Weather.placeChanged`, which clears the view and the cache). The place is stored in `cfg.v1` as `place: {name, lat, lon}` and overlays `place_name/place_lat/place_lon`. **No default place**: with none, `#wx_prompt` asks for one and nothing is requested. "Reset" resets the sleep hours only.
- **Two languages.** `src/core/i18n.js` (`I18n`, after `host.js` in `MODULES`) holds every word the page shows, English and Russian, with identical keys; it is the only page file allowed a Cyrillic letter (`check-i18n.js` fails otherwise, and on a key used but missing, an unused key, or any Cyrillic in the rendered English screen and dialog). Language: `#lang=en|ru` in the address, then `app_lang` in the config, then the bridge `PhoneForecast.lang()` (`Locale.getDefault().getLanguage()`), then `navigator.languages`; ru, be, uk, kk -> Russian, anything else -> English. Static markup uses `<span data-i18n="key">`, filled by `I18n.paint()` in `boot.js`; code uses `I18n.t(key, args...)` (`{0}` placeholders; values may hold markup, so escape anything from outside with `esc()`). English shows pressure in hPa (`pressure_hpa` from the adapter; the bar still from mm), the date as `Mon 23 Nov` (Russian keeps `пн, 23.11.26`). The gear's status shows "now" with `I18n.condition(icon)` and `I18n.compass(angle)`, which the shelf screen itself never shows (it has icons and an arrow). Scene labels are already English and stay so in both. City search asks in the UI language, Cyrillic input always `ru`. Android: `res/values` (English) and `res/values-ru` (label, `location_rationale` toast before asking again).
- **The display** gains `#wx_credit` (View field, "Open-Meteo.com" / "MET Norway", bottom-right, in `#wrapper` behind the cat, fades with the data) and `#wx_prompt`. `parse()` now finds today by date (`dayIndex`), labels min/max by `hour`, shows tomorrow's night/morning from 18:00 to midnight (main showed this morning at 23:00), and the daylight countdown before sunrise counts to sunrise.

**The Yandex rules that do not apply here:** the 30 requests/day quota and its arithmetic, the API key, `.local/config.json` (the build never reads `.local/`; check-settings asserts it), the `var api = ...` string replacement, "settings saves only re-fetch when the key or URL changed". **What replaces them** (`weather.js`, all tested in `check-weather.js`): no place = no request; hourly (`timeout`); after a failure 5, 15, 30 min (`retry_steps`) then hourly, stored in `wx.try.v1` so restarts keep it; nothing while `navigator.onLine` is false; at most `calls_per_day` (48) requests per calendar day, counting MET and 304s (`wx.calls.v1`); launches stay free (`restore()` takes `lastcall` from the file and the last attempt). Still never call a real service from code or tests "to see": the harnesses run on `tools/fixtures/` (Open-Meteo forecast and geocoding, MET compact, Berlin, 20 Nov 2026) and synthetic responses.

**Build and release.** `build.js` fails (exit 1, nothing written) if any output mentions `yandex` or holds a 36-character UUID-shaped string. `build-apk.ps1` takes the version from `android/VERSION` (aapt2 `--version-name`, `--version-code` = major*10000 + minor*100 + patch; the manifest must carry none), checks the manifest package equals `$AppId`, debug builds are debuggable, and `-Release` signs with `.local/release.keystore` (alias `lili`, `LILI_KS_PASS`/`LILI_KEY_PASS`; the same key as Lili Wallpaper, certificate `CN=Lili Wallpaper`) and never creates a keystore. SHA-256 is computed with .NET (`Get-FileHash` is missing when PowerShell is started from Git Bash). Permissions: `INTERNET`, `ACCESS_NETWORK_STATE` (so `navigator.onLine` works), `RECEIVE_BOOT_COMPLETED`, `ACCESS_COARSE_LOCATION` (asked when tapped).
