# How it works

`README.md` is how to build and use it. This file is the why: the four ideas the
code is built on, and the traps that come with each of them. Most of it was
written after being caught by one of those traps, which is the only reason any of
it is specific.

---

## 1. Two channels, summed

Every part of the rig has two sets of values:

```
pose   authored motion    - actions and scenes tween this
add    procedural motion  - weight shift, springs, blinks, pupils write this
```

They are summed when the frame is written:

```js
rot = pose.rot + add.rot
sx  = pose.sx * (1 + add.sx)
```

This is the most important idea in the project and it was not there at first.
In the first version there was one channel, so the idle chest movement and a
scene both wrote `body.sy` and fought over it — which meant the idle layer had to
be *switched off* while a scene played. That is exactly why the early animations
looked dead: a cat that goes rigid to eat is a diagram of a cat eating.

With two channels she keeps blinking, swaying and trailing her tail *through*
whatever a scene is doing, and no scene has to remember to animate a tail.

(The chest movement itself is gone — see the README. The two channels are why
everything else can carry on regardless, which matters more.)

**The trap:** `Rig.set` writes `pose`, `Rig.bias` writes `add`. Anything that
runs every frame forever must use `bias`. Anything an animation authors must use
`set`. Mixing them up produces motion that either fights a scene or gets wiped
by one.

---

## 2. The rig is nested pivots, and the transform attribute is owned

`cat.svg` is a hierarchy:

```
catRoot
├── tail → tail2 → tail3          three segments, each looser than the last
├── footL, footR
└── spine → body → torso          torso owns the body art
                 └── neck → head → ears, eyes, lids, pupils, muzzle, jaw…
```

Each animated part is an inner `<g id="…">` inside an outer `<g>` that only
positions the pivot. That is why only plain `rotate()`, `translate()` and
`scale()` are ever needed — no `transform-origin`, no `transform-box`, neither
of which can be relied on in WebView 69.

**The trap, and it cost real time twice:** the rig overwrites the *entire*
`transform` attribute of every part it owns, every frame. A static translate
authored directly on an animated element is silently wiped on the first frame.
This is how the raincoat and the neckerchief ended up in the wrong place. Any
garment or prop that needs a fixed offset must get an **outer wrapper group** to
carry it.

The second trap: `transform-origin` is `0 0` on the holder, so a bare
`scaleX(-1)` mirrors her around her own left edge and throws her a body-width
sideways every time she turns round. `Rig.flush` shifts by `catPx * scale` first.

---

## 3. Shapes morph; they are not just scaled

`shapes.js` holds authored key shapes — `normal loaf ball stretch crouch sleep`
for the body, `closed small wide pant smile frown` for the mouth. Every shape in
a set uses **the same path commands in the same order**; only the numbers differ,
and those are what get interpolated.

That is what makes a loaf genuinely a different outline from a stretch, rather
than the same outline squashed. It is also the answer to "she looks like an SVG
with no moving details" — you cannot get a changing silhouette out of rotations.

**The trap:** a part being morphed must be in `Rig.PARTS`. `bodyShape` was not,
so every silhouette change threw `Cannot set property 'morph' of undefined` and
aborted the whole animation. There is a self-healing guard in `morphTo` now, but
the real fix is to register the part.

---

## 4. Springs, and why they exploded

`alive.js` runs a spring per trailing part — three tail segments, both ears, the
vest, both whiskers, the neck. When the body moves they lag, overshoot and
settle. This is most of the difference between "rotating shapes" and "something
alive", and it is automatic.

Velocity is measured **per second**, not per frame, or the same movement produces
different lag at 8 fps and 15 fps. Instant repositions must not feed the springs
— when a scene starts, the cat is moved and rescaled at once, and treating that
as speed sends every spring straight to its clamp so she arrives looking
wrenched. Anything above `JUMP` is taken as a teleport and swallowed, and
`Alive.settle()` is called after every reposition.

**The bug worth remembering.** The integrator ran the whole elapsed frame in one
step:

```js
f = min(3, dt / 16.7)
v += (target - x) * stiff * f - v * damp * f
x += v * f
```

`dt` is never below 66 ms, so `f` was permanently pinned at its clamp of 3. A
spring advanced three frames in a single step is not a slow spring, it is an
unstable one. Per-frame error growth at `f = 3`:

```
tail 0.50   tail2 0.32   tail3 0.44   ear 0.75   vest 0.50
whisker 0.70   neck 1.47   <-- diverges
```

`neck` was both the stiffest and the least damped, and it was the only one that
blew up. A walk oscillates `body.rot` by 4° every 210 ms; that kick grew 1.47×
per frame until it hit the ±4° clamp and then flipped between +4 and −4 on
**every single frame, forever**. Nothing in the arithmetic could bring it back
down, which is why "once her head starts shaking it never stops".

The fix is to integrate in substeps of at most one 60 Hz frame each — same
elapsed time, every spring inside its stable region.

---

## The frame driver

Five tiers (`MOTION ACTIVE IDLE RESTING OFF`), and a **timer** rather than
`requestAnimationFrame` — see the README for why.

Two subtleties:

- `Anim.base(tier)` sets where the loop settles when the last tween drains.
  Without it, one blink at midnight lifted her to `ACTIVE` and dropped her back
  to `IDLE`, so a single twitch left the loop at 8 fps until morning instead
  of 2.
- `Anim.tween` used to force `MOTION`, which meant a single blink ran the whole
  loop at full speed. Small beats get `ACTIVE`; only an activity calls
  `Anim.burst()`.

`Rig.flush` caches the last string written per part and skips the write if it
would be identical. The procedural channel changes every frame, but the output is
rounded, and a sine at rest or an ease that has converged both stop moving long
before the maths does.

---

## Behaviour, from the bottom up

```
actions.js   verbs        sit, waddle, groom, yawn, sleep - issue tweens
beats.js     vocabulary   ~40 named beats a scene is written in, run in sequence
scenes.js    data         a list of beats plus the conditions that suit it
episodes.js  catalogue    the weighted picker, and 17 older hand-written ones
plan.js      the diary    the whole day, decided at midnight
cat.js       the life     one loop: mostly small beats, sometimes an activity
```

A scene never computes a delay. `beats.js` keeps a cursor (`ctx.t`) and each beat
reports its own length, so the runner adds up the timeline. `schedule()` defers
beats whose actions issue tweens relative to *now*.

`cat.js` has one loop for her whole life. Most beats are small; every so often
the diary says an activity is due. There is no takeover and no separate stage —
it all happens on the forecast screen, at her normal size, with the clock still
showing.

---

## Error handling

`Guard` wraps everything optional. Three faults **inside a minute** and the cat
is switched off for the session: the stage empties, the loop stops, the forecast
carries on.

The window matters. It used to be three faults *ever*, which on a device that
runs for weeks meant three unrelated hiccups a fortnight apart would disable her
permanently until someone power-cycled the phone. Three in a minute means she is
genuinely broken; three in a month means nothing.

`NaN` is guarded in both `Rig.set` and `Rig.bias`, because one `NaN` reaching a
transform attribute makes Chrome throw for every frame after it.

---

## The sky

`src/core/sky.js` draws the current weather as a picture, in the block between
the date and the evening forecast (54vw..107vw from the top; `#sky` sits at
`top: -12vw` inside `#now`, which keeps its height, so `#forecast` stays at
108vw). It replaced the weather icon, today's low and high, the three bars and
the whole sunrise / day length / sunset / moon row.

```
#sky_back    canvas, whole screen, z 1   rain, small flakes, puddles, lying snow
#sky_svg     inside #wrapper, z 2        arc, sun/moon, stars, clouds, bolt, windsock
numbers      inside #wrapper             #temperature, wind, humidity, pressure (View)
#cat_stage   z 3                         Lili
#sky_front   canvas, whole screen, z 4   near snow crystals, drops off her umbrella
```

**Units.** The svg's viewBox is 100 x 53 over a 100vw x 53vw box, so one unit is
one vw. The canvases use the same units, measured off the svg's own rect (not
`window.innerWidth`), with the backing store at the canvas rect x
`devicePixelRatio`, capped at 2: on the G4's 3x screen a full-screen canvas
cleared twice a frame costs more than thin rain gains from it.

**Data flow.** `weather.js` keeps a sky state next to what it paints - the
present's icon code and `cloudness`, the wind, and every day's sunrise, sunset
and `moon_code` - and hands it over in `apply()` with the same stamp View gets
(`Sky.feed(state, asOf)`), so the sky expires with the numbers. `#sky` itself is
a View field (`sector_sky`, class type), so it appears with the data and fades
with it like everything else. `clock.js` calls `Sky.minute(date)` every minute:
the sun and moon walk the arc by the clock, not by the network, and at midnight
tomorrow's sunrise is already in hand. Today is found by date
(`Sky.pickDays`), so a file written yesterday still gives today's sun.

The icon code is read with `Weather.splitCode` - the same parser the cat uses -
then forced so it reads: a storm is heavy rain, heavy anything is overcast, rain
from a clear sky or one cloud gets two clouds. `bkn` with `cloudness <= 0.25` is
one cloud, otherwise two.

A partly cloudy cloud never leaves the sky empty: each one has a twin `<use>`
one screen-width (`LANE`, 100 units) behind it. The twin starts in on the left
the moment the cloud starts out on the right, so a whole cloud's worth is always
on screen. Once the cloud is fully off the right edge it takes the twin's place.
Rain falls from whichever copy is on screen. Overcast needs no twins: its rows
are spaced to wrap without a gap. `check-sky.js` runs one cloud across two and a
half crossings and fails if less than a whole cloud is ever visible.

Under overcast the sun or moon is dimmed to 0.4 behind the clouds, and over them
a glow (`#sky_halo`, `skyGHaloSun`/`skyGHaloMoon`) and a thick dashed outline
(`#sky_ring`) show where it is, bright enough to find from across the room.

**The turf under the windsock.** The mast stands in a concrete footing on a flat
strip of grass (x 39..61) with a thin edge of soil below the horizon, drawn into
`#sky_land`. It follows the weather:
- **Temperature** (`temp` in the sky state, from `fact.temp`; the wardrobe's
  thresholds): frozen at 0 and below (pale, stiff white blades, frost glints),
  muted below 10, green below 23, lush with four flowers from 23. The grass
  gradient's stops (`#sky_turf_a/b`) are set from the state; darker at night.
- **Rain floods it.** `gWater` (0..1) rises while it rains - about 15 / 10 / 6
  minutes to full for light / moderate / heavy - and drains over about an hour.
  The water sits flat on the strip, widening and deepening as it fills; past 0.4
  it overflows into a puddle on the ground either side, and past 0.45 it runs
  off both ends. Rings spread where drops land, on the strip or a puddle by
  width. Below 0 the same water is a sheet of ice: no rings, no run-off. The
  first real data after a start finds it at 0.7 if it is already raining.
- **Lying snow** (`gSnow`, the floor's) caps it in white and hides the blades.
The shape is rebuilt only when what it shows changes (a key of state, day,
snow and water in 5 % steps: a few times an hour in real weather); every frame
only the rings (`#sky_turf_fx`), the run-off dashes and the glints move. In the
quiet hours the level still catches up once a minute. A preview fills and drains
in seconds, and the real level is put back when it ends; the SKY group's
"Frost -8°" and "Heat +28°" change only the turf, never the numbers.

**The shelter hook, and why it is a hook.** Core never looks at the cat, but
the rain must stop on her umbrella. `cat.js` registers `Sky.shelter(fn)`; the
sky calls it each frame while something falls and gets back
`{outline: [[x, y] ...], floor: y}` in screen px, or `outline: null` when she
is not holding the umbrella. The outline is the dome of `wUmbrella` (half an
ellipse, rx 40 ry 36, on the rim at y -52 in its own coordinates) through its
`getScreenCTM()`, so it follows every turn, hop and paw angle. The sky turns it
into a height map; drops that reach it splash on the front canvas and water
drips off the lower rim end. `floor` is where her feet stand, from the layout's
own numbers. With no hook (no cat) the rain lands 3 units above the bottom. A
hook that throws is ignored, not counted.

**The loop.** A `setTimeout` loop like `anim.js`, not rAF, for the same reason:
20 fps while rain, snow, sleet or a storm is on screen, 12 otherwise. Stopped
while the page is hidden or there is no current data. In the cat's quiet hours
(`cat_quiet_from..cat_quiet_to`, overlaid by `settings.js`) it does not run at
all: one still frame a minute, in which the lying snow still catches up. While
`#wrapper` carries `.hidden` the canvases are cleared and hidden. Attributes are
written only when they change, rounded so a slow cloud or a calm sock is not
rewritten every frame; stars twinkle on every third frame.

**Faults.** The sky has its own guard, not the cat's `Guard`: a sky fault must
not count against her, and core cannot depend on her. Three faults in a minute
stop the animation for the session; what is drawn stays, and the numbers are
View's, so the forecast is untouched.

**Previews.** Rain and snow may not come during a test week, so the test menu
(gear -> ТЕСТ АНИМАЦИЙ -> the SKY group) can ask for any state:
`Sky.preview(key)` with clear, 1 or 2 clouds, overcast, light/moderate/heavy
rain or snow, sleet, storm, wind 0/4/10, day/night flip, or "play a day" (an
hour a second). They add up, change the picture and never the numbers, and go
back to the real weather after ten minutes on their own. Choosing one steps the
menu aside; a tap anywhere brings it back. A rain or snow preview also dresses
her for it (`dress()` asks `Sky.previewing()` and calls `Wardrobe.set`), so the
umbrella can be seen catching the rain.

`node tools/check-sky.js` covers the geometry, the moon, the code mapping, the
windsock, the loop's modes and the umbrella, on a fake DOM built from the real
markup's ids.

---

## Coordinates

Stage-relative **percent**, everywhere. Not `vw`, not pixels.

`window.innerWidth` is not trustworthy on this page — a `meta viewport` with
`minimum-scale` plus a clock wider than the screen means the visual viewport was
504×579 while the window reported 411×731. Everything measures
`#cat_stage.offsetWidth/Height` instead.

`#cat_stage` must be `position: fixed`. `#wrapper` is absolutely positioned, so
the body has no height and a non-fixed stage collapses to zero.

The sky block is the one exception, because it is part of the forecast: it is
in the forecast's `vw`, and its canvases measure themselves and the svg rather
than the window (see *The sky*).
