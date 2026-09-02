# Lili

A weather display for an old phone, with a cat living in it.

The phone is a **Motorola Moto G4 Plus** on a desk, permanently on the charger
with the screen never off. It shows a large clock, the date and the Yandex
forecast — and Lili, who potters about in front of it, wears a cap when it is
hot, works at a desk during working hours, has lunch, plays when it is snowing,
and sleeps from eleven at night until ten in the morning.

Lili is modelled on a plush toy cat: white body, a ginger patch down the left of
her face, ginger-rimmed ears, big amber eyes and a mint-green vest with a crystal
button. The photograph she was drawn from is not in the repository.

---

## Before you build: your own API key

The forecast comes from the Yandex Weather API and the key that ships here is a
placeholder, so out of the box the app runs with no weather at all - which it
survives, but Lili cannot dress for a sky she cannot see.

Get a key from **yandex.ru/dev/weather** (or the Weather service in
`console.yandex.cloud`, depending on where your account lives), then either edit
the top of `src/informer.base.html`, or - better - keep it out of the repository
entirely in `.local/config.json`, which is gitignored and which the build reads
if it is there:

```json
{
  "api": "your-key-here",
  "lat": 53.9,
  "lon": 27.56
}
```

`node tools/build.js` says which of the two it used, so you can tell at a glance
whether a build has a real key in it.

**Watch the allowance.** The free plan is thirty requests a day, and this app is
built around that number - see *The API quota* below before changing `timeout` or
`retry_steps`. `tools/yandex-check.html` will tell you whether a key works, and
costs two requests to ask.

---

## Quick start

```
node tools/build.js                                  # -> informer.html
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 -Install
```

The first command produces one self-contained `informer.html`. The second wraps
it in an APK and installs it on whatever device `adb` can see.

To put it on the phone without a cable, open `informer.html` in Chrome on the
phone — everything is inlined, so there is nothing else to copy.

---

## What you need

| | | |
|---|---|---|
| **Node** | any recent version | runs `tools/build.js`; no packages, no `npm install` |
| **JDK** | 17 or newer | `javac` for the two Java files |
| **Android SDK** | build-tools + one platform | `aapt2`, `d8`, `zipalign`, `apksigner` |
| **PowerShell** | 5 or 7 | `tools/build-apk.ps1` |

Set `ANDROID_HOME` if the SDK is not at `%LOCALAPPDATA%\Android\Sdk`. There is
**no Gradle, no Kotlin and no AndroidX** — the APK is two framework-only Java
files compiled directly, which is why the build is a script rather than a
project. Min SDK 21, target 34; the G4 runs Android 8.

---

## Building

### The page

```
node tools/build.js [--debug] [--test] [--random] [--plandemo] [--nocat] [--noalive]
```

Every module in `src/` is inlined in dependency order into a single file. The
phone only ever receives one `.html`.

| flag | what it does |
|---|---|
| `--debug` | on-screen overlay: fps, tier, faults, plan, position, spring values |
| `--test` | skip the chooser and go straight to the animation test menu |
| `--random` | let activities fire on their own (on by default in normal builds) |
| `--plandemo` | replace the day with **three animations in the next five minutes** |
| `--nocat` | forecast only — for measuring what the cat costs |
| `--noalive` | cat on screen but the procedural layer stopped — also for measuring |

Outputs: `informer.html`, `android/assets/informer.html`, and the dev harnesses
`tools/*.built.html`. All of these are generated and none are in git.

### The APK

```
powershell -ExecutionPolicy Bypass -File tools/build-apk.ps1 `
  [-Install] [-Overlay] [-Test] [-Random] [-PlanDemo] [-NoCat] [-NoAlive]
```

`-Overlay` is `--debug` (PowerShell reserves `-Debug`). The script runs
`tools/build.js` first, so you never build the page separately.

Output: `android/build/phone-forecast.apk`.

**About the keystore.** `android/keystore/debug.keystore` is not in git — it is a
private key. The script recreates it if missing, but a new keystore means a new
signature, so `adb install -r` will refuse to update an app signed by the old
one and you will have to uninstall first. That loses `localStorage`: the weather
cache and the day's plan, nothing else.

---

## Configuration

Everything is at the top of `src/informer.base.html`, as plain globals:

```js
var api  = 'xxxxxxxx-...';    // Yandex Weather API key
var lat  = 53.9;  var lon = 27.56;
var timeout = 3600;           // sec between forecast calls

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

var cat_start_menu    = true;   // ask "forecast or test animations" on launch
var cat_start_timeout = 15;     // sec, then it goes to the forecast by itself
var cat_fps           = 15;     // peak frame rate during an animation
var cat_debug         = false;
```

`cat_build` is stamped by the build and should not be edited: a saved plan from
a different build is discarded, so a new APK always replans the day instead of
inheriting a schedule written by different code.

---

## Layout

```
src/informer.base.html     markup, CSS, configuration, two INJECT markers
src/core/
  dom.js         $, byId, on, hhmm, inClockWindow - and nothing clever
  bus.js         Bus (publish/subscribe) and Guard (the error firewall)
  store.js       localStorage that cannot throw
  host.js        the bridge to the Android host, if there is one
  view.js        the forecast DOM
  weather.js     fetch, cache, retry, parse, publish
  clock.js       the minute tick, re-armed on the wall-clock boundary
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
  episodes.js    the catalogue, and the picker
  wardrobe.js    what she wears for the weather
  plan.js        the diary: a whole day, planned at midnight
android/         AndroidManifest, two Java files, icon
tools/           build, APK build, studio, schedule harness
```

Two rules hold the design together:

**The forecast never knows the cat exists.** They only meet on `Bus`. Anything
the cat does is wrapped in `Guard`, and if it faults repeatedly the cat is
switched off and the clock carries on exactly as it did before she existed.

**Nothing covers the clock.** It is the reason the phone is on the desk. Props
live below 63% of the stage height, and scenery sits in a layer behind the
forecast text.

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
node tools/check-plan.js --weather rain     # clear | rain | snow | hot | none
node tools/check-plan.js --special          # the birthday and New Year
node tools/check-plan.js --json             # the lot, as data
```

This loads the **real** `scenes.js`, `episodes.js` and `plan.js` in a sandbox and
only fakes the browser, so what it prints is what the app will do. It found two
bugs on its first run.

On the phone:

```
adb shell am start -n com.lili.informer/.MainActivity -e plan 1
adb logcat -s Lili
```

The host pipes the page's console to logcat, so that prints the whole day. There
is also a **TODAY'S SCHEDULE** button in the test menu, which is easier when you
are standing in front of the shelf rather than sitting at a desk.

---

## The test menu

Choose *Тест анимаций* at launch, or build with `-Test` to skip the chooser.

- every animation, tap to play
- **TODAY'S SCHEDULE** — times and names, done ones dimmed, missed struck through
- **SLEEP / WAKE UP** — the real quiet-hours path, because otherwise you cannot
  see her sleep before eleven at night
There is deliberately no weather check in the app: `tools/yandex-check.html` does
that job from the browser, without a build.

**Back** returns to the chooser from anywhere, abandoning whatever is playing. A
press at the chooser closes the app.

Play one animation directly:

```
adb shell am start -n com.lili.informer/.MainActivity -e ep desk_work
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
adb shell "cat /proc/$(adb shell pidof com.lili.informer)/stat"
```

fields 14 and 15 are user and system jiffies; the difference over 30 seconds,
divided by 30, is the percentage of one core.

If it does run hot, the largest untried lever is **flattening the artwork** —
replacing the gradients and clip paths in `cat.svg` with flat fills.

---

## The forecast file, and why a dead API no longer shows the wrong weather

The response carries an **hourly forecast** — 24 entries for today and, on this
plan, another 24 for tomorrow. Until recently none of it was used for the current
conditions: everything came from `fact`, a single observation taken at the moment
of the call.

That is why a failed API meant a *wrong* screen rather than an old one. An hour
after a failure the display showed an old moment; after a day of failures it
showed yesterday morning — **+14 and cloudy while it was +19 and raining.**

Now:

- the whole raw response is stored, with the time it was written
- **while the file is younger than `timeout`**, the display uses `fact` — an
  observation beats a forecast while it is current
- **once it is older**, the app reads the hourly entry **for the actual current
  hour**, falling back to `fact` for any field an hourly record does not carry
- the minute tick calls `Weather.rehour()`, which redraws when the hour turns
  over — so with no network at all the screen still follows the day

The practical effect: one successful call in the morning keeps the screen and
Lili correct for up to 48 hours, hour by hour, with no further calls at all.

`Weather.status()` reports which source is in use — `fact`, `hour`, or
`stale-fact` when the hourly list has run out and only the old observation is
left. That last one is the real failure, and it is what the on-screen warning
watches for: warning about the file's *age* would be crying wolf on a screen
that is correct.

### Verifying it

```
node tools/check-weather.js               against a synthetic 48 h response
node tools/check-weather.js real.json     against a real captured response
```

This loads the real `weather.js` and only fakes the browser. It exists because
the allowance is 30 requests a day: logic that decides what the screen shows
cannot be developed by calling the API and looking. Save the JSON that
`tools/yandex-check.html` prints and run it through this to confirm the real
field names.

The synthetic response makes hour N of today N degrees, so picking the wrong
hour is visible rather than plausible.

---

## The API quota, and how often it calls

**The free Yandex plan used here is 30 requests a day.** That number is small
enough to change the design, so it is worth knowing exactly what spends it.

### Every trigger

| trigger | cost | where |
|---|---|---|
| the minute tick, once `timeout` has passed | 1 | `clock.js` -> `Weather.due()` |
| a failed call | up to 3 retries | `retry_steps` |
| a device reboot | 1 (the app auto-starts, if the file is stale) | `BootReceiver` |

**A launch is free.** `restore()` reads the stored file, paints it, and sets
`lastcall` to the file's own timestamp — so if it was written less than `timeout`
ago there is nothing to ask for and `due()` says no. This used to clear
`lastcall`, which meant every launch called immediately however fresh the file
was: fine on a shelf where the app starts once a month, expensive while test
builds go on and off the phone every few minutes. That is what spent an
allowance of thirty on 2026-08-25 — the console read 32 by mid-afternoon and the
API returned 403 for the rest of the day.

### The arithmetic

With `timeout = 60 * 60` and `retry_steps = [30, 120, 480]`:

| situation | calls per day |
|---|---|
| healthy, any number of restarts | **24** |
| API failing (1 attempt + 3 retries per ~70 min cycle) | ~82 |

One call an hour, 24 a day, whatever else happens — restarts and reinstalls no
longer cost anything. The failing case is still expensive; see the note on the
retry ladder below.

### If you are seeing 403

**Quotas reset daily, so an exhausted plan clears overnight.** Check again the
next morning *before* doing anything else — if it works, it was the quota.

Nothing on the wire tells you which it was. Yandex answers a bad key, a missing
key and a spent quota with the same opaque reply, and sends no rate-limit
headers:

```
HTTP/1.1 403 Forbidden
X-Req-Id: ...rtc-balancer-cloudapi-weather-yandex-33-BAL
{"message":"forbidden"}
```

A deliberately wrong key and no key at all produce that byte-for-byte. The
request count in the Yandex developer console is the only place the difference
shows.

### Living inside 30 a day

```js
var timeout     = 2 * 60 * 60;   // 12 calls/day instead of 24
var retry_steps = [600];         // one retry at 10 min, not three
```

That is 12 a day, 24 in the worst case, leaving room for restarts. `expire` is
12 h, so the screen never blanks between calls — a two-hour-old temperature is
fine on a desk, and the wardrobe and the weather-dependent animations only need
to know roughly what the sky is doing.

The remaining lever is not calling on launch when the cache is younger than
`timeout`, which makes reinstalling free.

**Note on the retry ladder.** `retryIndex` resets on every hourly attempt, so a
failing API costs four calls an hour rather than one. That reset exists so the
app recovers promptly once a key is fixed, but at 30 requests a day it is the
wrong trade — a single retry is enough.

---

## Checking the API by hand

`tools/yandex-check.html` — open it in a browser on the phone. No build step, no
server; it runs three tests and gives a verdict. **It contains the API key, so
do not share the file.** ⚠️ **Each run costs 2 requests** (tests 2 and 3), which
matters at 30 a day — read test 2 and ignore test 3 unless test 2 is blocked.

1. can the phone reach Yandex at all
2. the real call, key in the `X-Yandex-Weather-Key` header
3. the same call with the key as a query parameter

You cannot do this from the address bar: the key travels as a **header**, and
typing a URL cannot send one, so opening the API URL directly returns 403 whether
the key is good or not.

A page loaded from disk may also be refused by the browser rather than the
server, which the page reports as *blocked by the browser* — inconclusive, not a
failed key. In practice Chrome on Android has let the status through.

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

**The outfit follows the clock, not the API.** `isNight` is baked into a forecast
payload when it is derived, and a payload can sit unchanged for hours - a whole
day if the API is down. So the wardrobe used to be re-evaluated only when new
weather arrived, which meant sunset could pass unnoticed: she kept her cap and
sunglasses on into the dark and then wore them to bed. `dress()` now runs on every
minute tick, recomputing day/night from the sunrise and sunset the payload already
carries. `Wardrobe.set()` skips the slots that are already right, so this costs
nothing on the 1439 minutes when nothing changes.

**Nothing is worn in bed.** Quiet hours call `Wardrobe.bare()`.

**A scene cannot leave things on her.** The ice-cream scene puts an ice cream in
her hand directly, so the *slot* changes while the outfit *name* does not - and
`set()` used to return early when the name was unchanged, so it stayed there for
good. It reconciles every slot now, and the wardrobe is re-applied after every
animation.

```
node tools/check-wardrobe.js
```

36 checks: the ladder at ten weathers, sun accessories removed at every
temperature after sunset, five scene-leftover scenarios, bedtime, and that every
one of the eight garments is reachable from some outfit.

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

The older `src/cat/episodes.js` holds seventeen hand-written animations from
before the data format existed. They still work and the picker treats them
identically; new ones should go in `scenes.js`.

---

## Known issues

**The Yandex API returns HTTP 403.** The key or the quota needs checking. The
cache keeps the display alive for twelve hours, and the retry ladder is working,
but with no forecast Lili cannot dress for the weather and every
weather-dependent animation is correctly excluded — about fourteen distinct
scenes a day instead of nineteen. On the author's PC this is the antivirus
blocking the call, not the key.

**`episodes.js` is misnamed** and holds two parallel systems. There are no
episodes any more; everything happens in place on the forecast screen.

---

## Credits

The forecast layout — the clock, the day columns and the icon set — began as
**Weather informer v1** (2025) by Alexey N. Everything in `src/cat`, the frame
driver, the day scheduler and the build are new work; the forecast half has been
rewritten around the hourly API but the layout is still recognisably his.

Licensed under the MIT License — see `LICENSE`.
