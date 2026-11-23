# Lili Weather

A weather display for an old phone, with a cat living in it.

The phone is a **Motorola Moto G4 Plus** on a desk, permanently on the charger
with the screen never off. It shows a large clock, the date and the forecast for
a city you choose — and Lili, who potters about in front of it, wears a cap when
it is hot, works at a desk during working hours, has lunch, plays when it is
snowing, and sleeps from eleven at night until ten in the morning.

Lili is modelled on a plush toy cat: white body, a ginger patch down the left of
her face, ginger-rimmed ears, big amber eyes and a mint-green vest with a crystal
button. The photograph she was drawn from is not in the repository.

**This is the free-forecast version** (branch `free-forecast`, app id
`com.lili.weather`, "Lili Weather"). The forecast comes from
[Open-Meteo](https://open-meteo.com), with [MET Norway](https://api.met.no) as
the fallback: no key, no account, nothing to configure before you build. It
installs beside the keyed build on `main` (`com.lili.informer`), which it does
not replace. **It speaks English and Russian**, chosen from the phone's language
(see *Languages*).

---

## No key: choose a city on the phone

There is nothing secret in this build and nothing to set before building it. No
place is built in either: on first run the screen shows the clock, the date and
a short prompt to open the gear (top right) and choose a city, and Lili lives
under no weather until you do. With no place the app asks the network for
nothing at all.

Behind the gear, under **CITY** (**ГОРОД**):

- **type a city and tap FIND** (**НАЙТИ**, or Enter). Up to eight places come back from
  Open-Meteo's place search, each with its region and country. Tap one. It is
  kept on the phone and its forecast is asked for at once.
- **USE MY LOCATION** (**МОЁ МЕСТОПОЛОЖЕНИЕ**, in the APK only): Android asks for approximate location
  the first time you tap it. The phone's own network location gives the place,
  and Android's geocoder names it where the phone has one (otherwise it is
  called by its coordinates). No Google services are needed. In a plain browser
  tab this button is not offered; search instead.

Under the city, a line says what the weather is there now (with the wind's
compass point and the condition in words, which the shelf screen shows only as
icons), and another when the forecast was last updated, from which source, and
how many requests the app has made today.

The build never reads `.local/config.json` (or anything else in `.local/`), so no
developer key or coordinates can reach a public build, and `tools/build.js`
refuses to write a page that mentions `yandex` or holds a 36-character key-shaped
string.

---

## Languages

English and Russian, picked from the phone's language: **Russian** when it is
Russian, Belarusian, Ukrainian or Kazakh, **English** for everything else. The APK
asks Android (`PhoneForecast.lang()`, the phone's `Locale`); a browser tab asks
`navigator.language`. To force one, set `var app_lang = 'en'` (or `'ru'`) in the
config block, or open the page with `#lang=en` / `#lang=ru` in a browser tab.

Every word is in one table, `src/core/i18n.js`, and no other page file has a
Cyrillic letter in it (`check-i18n.js` checks). The two differ in more than words:

| | English | Russian |
|---|---|---|
| date under the clock | `Mon 23 Nov` | `пн, 23.11.26` |
| pressure | hPa, as the sources give it | mm Hg (`мм рс`) |
| wind | m/s, `NW` | м/с, `СЗ` |
| forecast columns | morning, afternoon, evening, night | утром, днём, вечером, ночью |

The credit is the source's own name in both. City search asks Open-Meteo in the
screen's language, except that a name typed in Cyrillic always gets Russian
results. The animation list behind the gear is a developer's tool and shows the
scenes' own English names in both languages. The Android side has `res/values`
(English) and `res/values-ru` for its label and its location rationale.

---

## Quick start

```
node tools/build.js                                  # -> informer.html
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 -Install
```

The first command produces one self-contained `informer.html`. The second wraps
it in an APK and installs it on whatever device `adb` can see.

To put it on the phone without a cable, open `informer.html` in Chrome on the
phone — everything is inlined, so there is nothing else to copy. In a tab the
forecast is Open-Meteo only (MET Norway needs the app's User-Agent, which a tab
cannot set) and there is no "use my location".

---

## What you need

| | | |
|---|---|---|
| **Node** | any recent version | runs `tools/build.js`; no packages, no `npm install` |
| **JDK** | 17 or newer | `javac` for the two Java files |
| **Android SDK** | build-tools + one platform (API 23+) | `aapt2`, `d8`, `zipalign`, `apksigner` |
| **PowerShell** | 5 or 7 | `tools/build-apk.ps1` |

Set `ANDROID_HOME` if the SDK is not at `%LOCALAPPDATA%\Android\Sdk`. There is
**no Gradle, no Kotlin and no AndroidX** — the APK is two framework-only Java
files compiled directly, which is why the build is a script rather than a
project. Min SDK 21, target 34; the G4 runs Android 8.

---

## Building

### The page

```
node tools/build.js [--debug] [--test] [--plandemo] [--nocat] [--noalive]
```

Every module in `src/` is inlined in dependency order into a single file. The
phone only ever receives one `.html`.

| flag | what it does |
|---|---|
| `--debug` | on-screen overlay: fps, tier, faults, plan, position, spring values |
| `--test` | open the animation test menu at launch |
| `--plandemo` | replace the day with **three animations in the next five minutes** |
| `--nocat` | forecast only — for measuring what the cat costs |
| `--noalive` | cat on screen but the procedural layer stopped — also for measuring |

Outputs: `informer.html`, `android/assets/informer.html`, and the dev harness
`tools/studio.built.html`. All of these are generated and none are in git.

### The APK

```
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 `
  [-Install] [-Overlay] [-Test] [-PlanDemo] [-NoCat] [-NoAlive]
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 -Release
```

`-Overlay` is `--debug` (PowerShell reserves `-Debug`). The script runs
`tools/build.js` first, so you never build the page separately, and stops if it
fails.

Output: `android/build/lili-weather-<version>-debug.apk`, or
`android/build/lili-weather-<version>.apk` with `-Release`. The version is
`android/VERSION` (major.minor.patch), injected by aapt2 as `versionName` and as
`versionCode` = major·10000 + minor·100 + patch; the manifest carries none. Each
build prints the APK's SHA-256. Only `android/build/tmp` is cleaned, so a debug
build does not delete the release built before it. Debug builds are debuggable
(for `adb shell run-as`); release builds are not.

**Release signing.** `-Release` signs with `.local/release.keystore` (gitignored,
alias `lili` unless `LILI_KEY_ALIAS` says otherwise) — the same key that signs
Lili Wallpaper. The passwords come from `LILI_KS_PASS` and `LILI_KEY_PASS` and
are handed to apksigner by name, so they never appear on a command line. The
script never creates a keystore: if anything is missing it stops before
building and says what to set. It warns when the working tree has uncommitted
changes, and prints the certificate when done.

```powershell
$env:LILI_KS_PASS  = Read-Host 'keystore password'
$env:LILI_KEY_PASS = $env:LILI_KS_PASS
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 -Release
```

**About the debug keystore.** `android/keystore/debug.keystore` is not in git —
it is a private key. The script recreates it if missing, but a new keystore
means a new signature, so `adb install -r` will refuse to update an app signed
by the old one and you will have to uninstall first. That loses `localStorage`:
the chosen city, the weather cache and the day's plan. A debug and a release
build cannot replace each other either.

---

## Configuration

Everything is at the top of `src/informer.base.html`, as plain globals:

```js
var place_name = '';  var place_lat = null;  var place_lon = null;   // set on the phone
var app_lang      = '';                      // '' = the phone's language; 'en' | 'ru' to force
var timeout       = 60 * 60;                 // sec between forecast calls
var retry_steps   = [5 * 60, 15 * 60, 30 * 60];   // after a failure, then hourly again
var calls_per_day = 48;                      // ceiling on requests per calendar day

var cat_enabled       = true;
var cat_name          = 'Lili';
var cat_activities    = true;   // let the big animations run by themselves
var cat_plan_per_hour = 60;     // animations per awake hour, planned at 00:00
var cat_plan_demo     = false;  // true = three animations in the next five minutes

var cat_quiet_from    = '23:00';  var cat_quiet_to = '10:00';   // she sleeps
var cat_work_from     = '09:00';  var cat_work_to  = '18:00';
var cat_work_weekdays = true;     // no desk on Saturday or Sunday
var cat_lunch_from    = '13:00';  var cat_lunch_to = '14:00';
var cat_birthday      = '11-07';  // 7 November

var cat_fps           = 15;     // peak frame rate during an animation
var cat_debug         = false;
```

The place and the sleep hours are set behind the gear and kept in the phone's
`localStorage` (`src/core/settings.js`); what is set there wins over the build.
**RESET SLEEP HOURS** (**СБРОСИТЬ ЧАСЫ СНА**) puts the sleep hours back to the
build's; it does not forget the city.

`cat_build` is stamped by the build and should not be edited: a saved plan from
a different build is discarded, so a new APK always replans the day instead of
inheriting a schedule written by different code.

---

## Layout

```
src/informer.base.html     markup, CSS, configuration, two INJECT markers
src/core/
  dom.js         $, byId, on, getJSON, httpGet, hhmm, inClockWindow - and nothing clever
  store.js       localStorage that cannot throw
  settings.js    the place and the sleep hours, kept on the phone
  host.js        the bridge to the Android host, if there is one
  i18n.js        every word on screen, English and Russian, and which one
  places.js      city search (Open-Meteo geocoding) and "use my location"
  bus.js         Bus (publish/subscribe) and Guard (the error firewall)
  view.js        the forecast DOM
  wxsource.js    Open-Meteo and MET Norway, turned into the shape the page reads;
                 sunrise, sunset and the moon, computed
  weather.js     when to ask, the cache, the hourly fallback, parse, publish
  clock.js       the minute tick, re-armed on the wall-clock boundary
  settings-ui.js the gear and its dialog
  boot.js        startup order
src/cat/
  cat.svg        the rig: ~36 named parts and eight garments
  shapes.js      authored key shapes for morphing
  rig.js         the pose layer - two channels, summed
  anim.js        the frame driver, five speeds
  alive.js       springs and micro-motion; the always-on layer
  actions.js     the verbs - sit, waddle, groom, yawn, sleep
  props.js       bowls, books, desks, snowballs
  beats.js       the beat vocabulary a data scene is written in
  scenes.js      animations as data
  scenes-winter.js  fifty more of them, for cold days and snow
  episodes.js    the catalogue, and the picker
  wardrobe.js    what she wears for the weather
  plan.js        the diary: a whole day, planned at midnight
android/         AndroidManifest, two Java files, icon, VERSION
tools/           build, APK build, studio, offline harnesses, fixtures/
```

Two rules hold the design together:

**The forecast never knows the cat exists.** They only meet on `Bus`. Anything
the cat does is wrapped in `Guard`, and if it faults repeatedly the cat is
switched off and the clock carries on exactly as it did before she existed.

**Nothing covers the clock.** It is the reason the phone is on the desk. Props
live below 63% of the stage height, and scenery sits in a layer behind the
forecast text.

---

## Where the forecast comes from

**Open-Meteo** answers every call it can: the current conditions (its 15-minute
"current" data), and three days of hourly temperature, feels-like, humidity,
weather code, wind (in m/s) and direction, sea-level pressure and precipitation,
for the city's coordinates rounded to **2 decimals** (about 1 km).

**MET Norway** (Locationforecast 2.0 compact) is asked only when Open-Meteo
fails, and only in the APK: MET refuses a request whose User-Agent does not name
the app and a contact, and an XHR cannot set one, so `MainActivity` appends
`Lili-Weather/<version> (+https://github.com/olegc0n/phoneForecast)` to the
WebView's User-Agent. It gets the coordinates at **4 decimals**, the app never
asks it again before the `Expires` it sent for that place, and it sends
`If-Modified-Since` with the `Last-Modified` MET gave, so an unchanged forecast
costs a `304` and no body.

**An adapter, not a new pipeline.** `src/core/wxsource.js` turns either response
into the shape the display, the hourly fallback, the cache and the cat were
written for — `fact`, and `forecasts[]` with `hours[]` and four `parts` a day —
with exactly the fields they read, in their units: whole degrees, wind in m/s,
humidity in %, pressure in **mm Hg** (hPa × 0.750062). Weather codes (WMO for
Open-Meteo, symbol codes for MET) become the icon codes the stylesheet already
draws (`skc_d`, `bkn_-ra_n`, `ovc_+sn`, `ovc_ts_ra`...), so the icons stay local
and the cat reads the sky, the precipitation, its strength and thunder back out
of the same code. Everything else is computed on the phone: **sunrise and
sunset** (the NOAA solar algorithm, polar day and night included), **day and
night** in the icons (the sun's height at the middle of each hour), and the
**moon phase**. Today's low and high, and the hours they fall at, come from the
hourly temperatures. Days and hours are the phone's, like the clock above them.

The cache keeps the **raw response** and runs it through the adapter on every
read, so a better adapter in a new build re-reads the old file.

**The credit** is on the forecast screen: a small, dim "Open-Meteo.com" or "MET
Norway" in the bottom-right corner, in the forecast's own layer — behind Lili,
below the last row, nowhere near the clock — and it fades with the data it
credits. The settings dialog has the full credits and licences.

---

## Her day

The schedule is written at **00:00** for the whole day: **sixty animations per
awake hour** at random times, 780 in all across the thirteen hours she is up.

Two limits move with that rate. `MIN_GAP` is one minute, not three - at sixty an
hour a three-minute gap is arithmetically impossible and the extra slots were
being dropped on the floor. And a declared `perDay` is scaled by the rate, because
it is written for the default of ten: the desk declares thirty, and unscaled at
sixty an hour that was spent by twenty past eleven, so she worked solidly all
morning and then never again.

Scarce scenes are placed first — sorted by how few slots they could possibly
occupy — so a one-hour, weekday-only scene claims its slot before anything with
a free run of the day. That is the guarantee: **if lunch fits today, lunch is on
the schedule.** It was added because it did not use to be, and some days the
lunch animation simply never happened.

A working day and a holiday are different days. Episodes carry a tag, and the
day decides what it is worth: `work` counts 3.4× on a weekday and **zero** on a
holiday, where `play` counts 2.3×. Zero is a hard exclusion that even the
guarantee pass honours. In practice the desk takes about 44% of working hours
and stops dead at six; a holiday has no work at all and two thirds games.

The plan only knows last night's forecast, so every slot is re-checked against
the live sky when it comes up. If it says sunbathe and it is raining, the app
substitutes and records that it did. Sunrise and sunset *are* known in advance —
`weather.js` reports them as absolute clock minutes — so moon gazing only ever
appears after dark.

### Inspecting the schedule

```
node tools/check-plan.js                    # 5 working days + 5 holidays
node tools/check-plan.js --full             # every slot
node tools/check-plan.js --weather rain     # clear | hot | rain | snow | cold | sleet | none
node tools/check-plan.js --weather snow --counts   # how often each animation ran
node tools/check-plan.js --special          # the birthday and New Year
node tools/check-plan.js --json             # the lot, as data
```

This loads the **real** `scenes.js`, `episodes.js` and `plan.js` in a sandbox and
only fakes the browser, so what it prints is what the app will do. It found two
bugs on its first run.

On the phone:

```
adb shell am start -n com.lili.weather/.MainActivity -e plan 1
adb logcat -s Lili
```

The host pipes the page's console to logcat, so that prints the whole day. There
is also a **TODAY'S SCHEDULE** button in the test menu, which is easier when you
are standing in front of the shelf rather than sitting at a desk.

---

## The test menu

Open the gear and tap **TEST ANIMATIONS** (**ТЕСТ АНИМАЦИЙ**), or build with
`-Test` to open it at launch.

- every animation, tap to play
- **TODAY'S SCHEDULE** — times and names, done ones dimmed, missed struck through
- **SLEEP / WAKE UP** — the real quiet-hours path, because otherwise you cannot
  see her sleep before eleven at night

**Back** unwinds one layer at a time, abandoning whatever is playing; a press on
the forecast closes the app.

Play one animation directly:

```
adb shell am start -n com.lili.weather/.MainActivity -e ep desk_work
```

---

## Frame rates and CPU

Five tiers, and the difference between them is most of the power budget:

| tier | fps | when |
|---|---|---|
| `MOTION` | 15 | a full animation |
| `ACTIVE` | 14 | a small beat — a blink, an ear twitch, a wander |
| `IDLE` | 8 | the spring layer and micro-motion only |
| `RESTING` | 2 | asleep |
| `OFF` | 0 | hidden — the loop is genuinely stopped |

**The loop is a timer, not `requestAnimationFrame`.** rAF fires at the display
rate whatever you do with it, so gating it to 8 fps still ran the callback sixty
times a second and returned early from fifty-two of them. On a phone that is
never allowed to sleep that is fifty-two wake-ups a second to decide to do
nothing. A timer set to the tier interval does not run in between.

Measured on the **emulator** (software-rendered x86, no GPU — see the caveat):

| build | app | renderer | total |
|---|---|---|---|
| `--nocat`, forecast only | 0% | 0% | ~0% |
| `--noalive`, cat on screen but still | 15–25% | 5–9% | 21–35% |
| everything running | ~48% | ~19% | 65–69% |

So the always-on procedural layer roughly doubled the cost, and the forecast
itself is free. Snapping the procedural signals to a grid coarser than the eye
made **no measurable difference**, which ruled out the obvious explanation: it was
not the number of transform strings, it was that the torso moved at all. `torso`
owns the body art, every fur shape carries a gradient and four clip paths sit over
the top, so anything that moves the chest re-rasterises the largest part of the
picture.

That measurement is what got breathing removed.

**There is no breathing any more.** It was a rising and falling chest on `torso`,
and after a long test on the phone the verdict was that the app looks better
without it - so it is gone rather than defaulted off, along with its setting and
its button. It was also the most expensive thing she did: `torso` owns the body
art, so every breath re-rasterised the largest part of the picture. She is still
not static; the weight shift, the springs, the blinks, the pupils and the ear
flicks all remain.

Against that, sixty animations an hour puts her at `MOTION` for roughly 30% of
the day rather than 5%. The two changes pull in opposite directions and the net
effect is not predictable from here - the phone is where that number lives.

**The caveat that matters:** the emulator has no GPU and rasterises that SVG in
software. The G4 has an Adreno 405 and a hardware-accelerated WebView, so these
numbers do not predict the phone. Measure there:

```
adb shell "cat /proc/$(adb shell pidof com.lili.weather)/stat"
```

fields 14 and 15 are user and system jiffies; the difference over 30 seconds,
divided by 30, is the percentage of one core.

If it does run hot, the largest untried lever is **flattening the artwork** —
replacing the gradients and clip paths in `cat.svg` with flat fills.

---

## The forecast file, and why a dead network does not show the wrong weather

The forecast carries **hourly** data — three days of it from Open-Meteo, about
ten from MET. A single "now" reading (Open-Meteo's current data, or MET's entry
for the hour of the call) is only right for a while; an hour after a failure it
is an old moment, and after a day of failures it is yesterday morning.

So:

- the whole raw response is stored, with the time it was written and the place
  it is for
- **while the file is younger than `timeout`**, the display uses that "now"
  reading
- **once it is older**, the app reads the hourly entry **for the actual current
  hour**, falling back to the "now" reading for any field an hourly record does
  not carry
- the minute tick calls `Weather.rehour()`, which redraws when the hour turns
  over — so with no network at all the screen still follows the day, and today's
  low, high and the two forecast columns are found by date, not by position in
  the file

The practical effect: one successful call keeps the screen and Lili correct for
two days and more, hour by hour, with no further calls at all.

`Weather.status()` reports which source is in use — `fact`, `hour`, or
`stale-fact` when the hourly list has run out and only the old reading is left.
That last one is the real failure, and it is what the on-screen warning watches
for: warning about the file's *age* would be crying wolf on a screen that is
correct.

A forecast is kept for one place. Choosing another one clears the screen and the
file, and asks for the new place at once.

---

## How often it asks

Open-Meteo is free for non-commercial use up to 10,000 calls a day; this app
makes about 24. Every rule, each tested by `tools/check-weather.js`:

| rule | |
|---|---|
| no place | **no request, ever** |
| healthy | one call an hour (`timeout`) |
| a launch or a restart | **free**: the stored file's own time is the schedule |
| a failure | again in 5, 15 and 30 minutes (`retry_steps`), then hourly; the backoff is stored, so a restart does not cut it short |
| offline (`navigator.onLine`) | nothing is tried, and no backoff builds up |
| a new place | at once, whatever the backoff says |
| MET Norway | only after Open-Meteo failed, only in the APK, never before its `Expires` for that place, with `If-Modified-Since` |
| ceiling | **48 requests per calendar day** (`calls_per_day`), counting Open-Meteo, MET and MET's 304s; at the ceiling nothing more is asked until midnight |
| a device reboot | 1 (the app auto-starts), only if the file is older than an hour |

| situation | requests per day |
|---|---|
| healthy, any number of restarts | **24** |
| Open-Meteo down, in a browser tab | 27 |
| Open-Meteo down, MET answering, in the APK | 48: one of each an hour, exactly the ceiling |
| both sources down, in the APK | at most 48 (the ceiling) |

City searches are a different service, one per tap, and are not counted.

```
node tools/check-weather.js
node tools/check-settings.js     # the place, the sleep hours, city search, no place = no request
node tools/check-i18n.js         # both languages: detection, tables, formats, the rendered screen and dialog
```

`check-weather.js` loads the **real** `wxsource.js` and `weather.js`, fakes the clock, the storage
and the network, and runs the adapter over the captured Open-Meteo and MET
Norway responses in `tools/fixtures/` (Berlin, 20 November 2026) and over
synthetic ones in which hour N is N degrees, so picking the wrong hour is visible
rather than plausible. It never touches the network.

## What she wears

One garment per slot - head, eyes, neck, body, hand - so a warm hat takes the cap
off by itself. Every garment is authored inside the rig at opacity 0, which is the
whole trick: clothes hang off the same pivots as her body, so the scarf trails
when she walks and the cap tips when she tilts her head without a line of
animation code.

The ladder is scaled for **Belarus**, where a summer maximum is 23-25:

| weather | outfit |
|---|---|
| rain or sleet | coat + umbrella |
| snow | warm hat + scarf |
| at or below 0 | warm hat + scarf |
| 23 and up, daylight | cap + sunglasses + ice cream |
| 19 and up, daylight | cap + sunglasses + soda |
| 16 and up, clear sky, daylight | cap + sunglasses |
| wind over 11 m/s | scarf |
| anything else | her own mint vest |

Precipitation beats temperature: wet is wet.

**The outfit follows the clock, not the network.** `isNight` is baked into a
forecast payload when it is derived, and a payload can sit unchanged for hours -
a whole day if the network is down. So the wardrobe used to be re-evaluated only
when new weather arrived, which meant sunset could pass unnoticed: she kept her
cap and sunglasses on into the dark and then wore them to bed. `dress()` now runs
on every minute tick, recomputing day/night from the sunrise and sunset the
payload already carries. `Wardrobe.set()` skips the slots that are already right,
so this costs nothing on the 1439 minutes when nothing changes.

**Nothing is worn in bed.** Quiet hours call `Wardrobe.bare()`.

**A scene cannot leave things on her.** The ice-cream scene puts an ice cream in
her hand directly, so the *slot* changes while the outfit *name* does not - and
`set()` used to return early when the name was unchanged, so it stayed there for
good. It reconciles every slot now, and the wardrobe is re-applied after every
animation.

```
node tools/check-wardrobe.js
```

The ladder at ten weathers, sun accessories removed at every temperature after
sunset, five scene-leftover scenarios, bedtime, and that every one of the eight
garments is reachable from some outfit.

## Adding an animation

Write it as data in `src/cat/scenes.js`:

```js
Scenes.add('tea_break', {
    tags:   ['work'],
    label:  'Tea and sweets',
    energy: 'low',
    weight: 7,
    when:   { hours: ['09:00', '18:00'], weekdays: true },
    beats: [
        ['prop', 'cup', 'mug', 21, 92, 10, 9, 60 / 54],
        ['walkTo', 28], ['sit'], ['lookAhead'],
        ['sip', 'cup'], ['emote', 'happy'], ['groom'],
        ['propOut', 'cup']
    ]
});
```

No tween calls, no hand-maintained duration — the runner adds up the beats.
`tools/studio.html` (built to `tools/studio.built.html`) has the beat palette, a
live 360×640 preview and nine weather presets, and writes this block for you.

`when` fields, all optional: `hours weekdays weekend precip sky night thunder
tempMin tempMax windMin dates months dayMin`. Optional `tags: ['work'|'play']`
and `perDay: n` to override the automatic per-day cap.

Coordinates are **percent of the stage**, never `vw` and never pixels —
`window.innerWidth` is not trustworthy on this page.

Two things a scene can ask for beyond the list of beats:

- `live: true` — consecutive moves of the same thing chain instead of each one
  starting again from rest, and a fade really fades. Every scene in
  `scenes-winter.js` sets it; the ones in `scenes.js` predate it and were tuned
  without. The comment on `L()` in `beats.js` has the reason.
- `['also', verb, ...]` — runs a beat without moving the cursor, so the next one
  starts at the same moment: snow falling while she walks, a ball rolling while
  it grows.

Then check it without a phone:

```
node tools/check-scenes.js              # every scene played through, PASS/FAIL
node tools/check-scenes.js --only <id>  # one scene, with the time of each beat
```

It loads the real rig, frame driver, props and beats, plays each scene on a fake
clock, and fails on an unknown verb or artwork, a prop used before it exists,
anything drawn above the 63% line, and props or tint left behind at the end.

The older `src/cat/episodes.js` holds seventeen hand-written animations from
before the data format existed. They still work and the picker treats them
identically; new ones should go in `scenes.js`.

---

## Permissions

| permission | why |
|---|---|
| Internet | the forecast and the city search |
| Network state | so the page knows it is offline and tries nothing |
| Run at startup | to come back by itself after a power cut |
| Approximate location | only for **USE MY LOCATION**, asked when it is tapped |

---

## Known issues

**Times are the phone's.** Days, hours, sunrise and sunset are shown on the
phone's clock, as the clock itself is. A city in another time zone shows its
weather on your time.

**`episodes.js` is misnamed** and holds two parallel systems. There are no
episodes any more; everything happens in place on the forecast screen.

---

## Credits

The forecast layout — the clock, the day columns and the icon set — began as
**Weather informer v1** (2025) by Alexey N (meczengo@gmail.com). Everything in
`src/cat`, the frame driver, the day scheduler and the build are new work, and the
forecast half has been rewritten around the hourly forecast — but the layout is
still recognisably his.

Weather data by **Open-Meteo.com** ([open-meteo.com](https://open-meteo.com)),
licensed CC BY 4.0; its place search is built on GeoNames. Fallback weather data
by **MET Norway** (the Norwegian Meteorological Institute,
[api.met.no](https://api.met.no)), licensed CC BY 4.0 and NLOD 2.0.

Licensed under the MIT License — see `LICENSE`.
