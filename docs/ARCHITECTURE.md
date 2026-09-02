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

## Coordinates

Stage-relative **percent**, everywhere. Not `vw`, not pixels.

`window.innerWidth` is not trustworthy on this page — a `meta viewport` with
`minimum-scale` plus a clock wider than the screen means the visual viewport was
504×579 while the window reported 411×731. Everything measures
`#cat_stage.offsetWidth/Height` instead.

`#cat_stage` must be `position: fixed`. `#wrapper` is absolutely positioned, so
the body has no height and a non-fixed stage collapses to zero.
