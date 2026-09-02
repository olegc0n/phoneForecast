/* anim.js - one frame driver, five speeds.
 *
 * This is the part that decides whether the phone stays cool.
 *
 * IT IS A TIMER, NOT requestAnimationFrame, and that is deliberate. rAF fires at
 * the display rate whatever you do with it, so gating it to 8 fps meant the
 * callback still ran sixty times a second and returned early from fifty-two of
 * them. On a phone that is never allowed to sleep that is fifty-two wake-ups a
 * second, all day, to decide to do nothing - and at RESTING it was fifty-eight.
 * A timer set to the tier interval simply does not run in between, which lets
 * the CPU idle properly.
 *
 * The trade is vsync alignment, which costs nothing here: the top tier is 15 fps
 * on a 60 Hz screen, so frames were never aligned to begin with.               */

var Anim = (function () {
	var TIERS = { MOTION: 0, ACTIVE: 1, IDLE: 2, RESTING: 3, OFF: 4 };

	/* Five speeds, and the difference between them is most of the power budget.
	 *
	 *   MOTION   15  a full activity - the showpiece, worth the frames
	 *   ACTIVE   14  a small idle beat: a blink, an ear twitch, a wander
	 *   IDLE      8  nothing but the spring layer and micro-motion
	 *   RESTING   2  curled up
	 *   OFF       0  quiet hours or hidden - the loop is genuinely stopped
	 *
	 * Small beats used to force MOTION, which meant a single blink ran the whole
	 * loop at 15 fps. They get ACTIVE now, and only an activity asks for MOTION. */
	var fps = { MOTION: 15, ACTIVE: 14, IDLE: 8, RESTING: 2, OFF: 0 };

	var tier = 'IDLE';

	/* Where the loop settles when nothing is animating. Asleep this becomes
	 * RESTING, and that matters: a single blink used to lift her to ACTIVE and
	 * then drop her back to IDLE, so one twitch at midnight left the loop
	 * running at 8 fps for the rest of the night instead of 2.                */
	var base = 'IDLE';

	var interval = 1000 / fps.IDLE;
	var MIN_GAP = 8;               /* ms; always leave the main thread some air */
	var running = false;
	var timer = null;

	var lastFrame = 0;
	var clock = 0;                 /* our own monotonic ms, so pauses don't jump */

	var tweens = [];
	var ambient = null;
	var frameCount = 0, fpsWindow = 0, fpsValue = 0;

	function setFps(peak) {
		fps.MOTION = Math.max(6, Math.min(30, peak || 15));
		if (tier === 'MOTION') interval = 1000 / fps.MOTION;
	}

	function now() {
		return (window.performance && performance.now) ? performance.now() : Date.now();
	}

	/* The tier the loop returns to when the last tween drains. */
	function setBase(name) { if (fps.hasOwnProperty(name)) base = name; }

	function to(name) {
		if (!TIERS.hasOwnProperty(name) || tier === name) return;
		tier = name;
		if (name === 'OFF') { stop(); return; }
		interval = 1000 / fps[name];
		if (running) arm(0);        /* the new rate starts now, not after the old wait */
		else start();
	}

	function start() {
		if (running) return;
		running = true;
		lastFrame = 0;
		arm(0);
	}

	function stop() {
		running = false;
		if (timer) { clearTimeout(timer); timer = null; }
	}

	function arm(ms) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(frame, ms < 0 ? 0 : ms);
	}

	/* An activity asks for full frame rate explicitly. */
	function burst() { to('MOTION'); }

	function frame() {
		timer = null;
		if (!running) return;

		var ts = now();
		if (!lastFrame) { lastFrame = ts; arm(interval); return; }

		var elapsed = ts - lastFrame;
		lastFrame = ts;

		var dt = elapsed > 250 ? 250 : elapsed;      /* clamp after a stall */
		clock += dt;

		step(dt);
		Rig.flush(false);

		frameCount++;
		if (ts - fpsWindow > 1000) { fpsValue = frameCount; frameCount = 0; fpsWindow = ts; }

		/* Measure the wait from the START of this frame, so a slow frame does not
		 * push the next one further out and the rate stays honest. step() may
		 * have changed the tier, so re-read the interval.
		 *
		 * The floor is not about pacing - a frame that overruns its interval is
		 * already rate-limited by its own duration - it is to guarantee a gap for
		 * everything else on the main thread: touches, layout, the clock.      */
		if (running && !timer) {
			var wait = interval - (now() - ts);
			arm(wait < MIN_GAP ? MIN_GAP : wait);
		}
	}

	function step(dt) {
		var i, t;
		var busy = false;

		for (i = tweens.length - 1; i >= 0; i--) {
			t = tweens[i];
			t.t += dt;
			if (t.t < 0) { busy = true; continue; }

			var n = t.dur > 0 ? t.t / t.dur : 1;
			if (n >= 1) n = 1; else busy = true;

			Rig.set(t.part, t.key, t.from + (t.to - t.from) * ease(n, t.ez));

			if (n >= 1) {
				tweens.splice(i, 1);
				if (t.done) { var cb = t.done; t.done = null; cb(); }
			}
		}

		if (ambient) ambient(clock, dt);

		/* nothing left to animate: drop back to the cheap tier on our own */
		if (!busy && (tier === 'MOTION' || tier === 'ACTIVE')) to(base);
	}

	function ease(n, kind) {
		switch (kind) {
			case 'lin':  return n;
			case 'in':   return n * n * n;
			case 'out':  return 1 - Math.pow(1 - n, 3);
			case 'back': return 1 + 2.2 * Math.pow(n - 1, 3) + 1.2 * Math.pow(n - 1, 2);
			default:     return n < 0.5 ? 4 * n * n * n : 1 - Math.pow(-2 * n + 2, 3) / 2;
		}
	}

	/* tween(part, key, to, dur, ease, delay, onDone) */
	function tween(part, key, target, dur, ez, delay, done) {
		tweens.push({
			part: part, key: key,
			from: Rig.get(part, key), to: target,
			dur: dur === undefined ? 300 : dur,
			ez: ez || 'io',
			t: -(delay || 0),
			done: done || null
		});
		/* enough to animate a blink smoothly; an activity raises this itself */
		if (tier === 'IDLE' || tier === 'RESTING') to('ACTIVE');
		else if (tier === 'OFF') to('ACTIVE');
	}

	/* Snap a value with no interpolation, still respecting the delay. */
	function poke(part, key, target, delay) {
		if (!delay) { Rig.set(part, key, target); return; }
		tweens.push({ part: part, key: key, from: target, to: target, dur: 1, ez: 'lin', t: -delay, done: null });
		if (tier === 'IDLE' || tier === 'RESTING' || tier === 'OFF') to('ACTIVE');
	}

	function clear() {
		tweens.length = 0;
	}

	/* start and stop are not exported: the tier is the only way in, so there is
	 * exactly one thing that decides whether the loop is running. */
	return {
		to: to,
		base: setBase,
		tier: function () { return tier; },
		burst: burst,
		setFps: setFps,
		tween: tween,
		poke: poke,
		clear: clear,
		fps: function () { return fpsValue; },
		ambient: function (fn) { ambient = fn; }
	};
})();
