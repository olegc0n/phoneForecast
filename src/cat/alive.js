/* alive.js - the layer that makes her a creature rather than a diagram.
 *
 * Everything here writes ONLY the procedural channel (Rig.bias), so it runs
 * permanently and never fights a scene for a value. Two parts to it:
 *
 * SPRINGS - follow-through. When the body moves, the tail, ears, vest and
 *   whiskers lag behind, overshoot, and settle. This is the single biggest
 *   difference between "rotating shapes" and "something alive", and it is
 *   automatic: no scene has to remember to animate a tail.
 *
 * MICRO - she is never perfectly still. A slow weight
 *   shift, blinks on an irregular cadence, pupils making small saccades, the odd
 *   ear flick. Costs nothing and is most of the effect.                        */

var Alive = (function () {
	var t = 0;

	/* Asleep, the eyes are shut and the ears are down. Blinking, darting pupils
	 * and ear flicks are all invisible then, and each one lifts the frame loop
	 * out of its cheapest tier - so for eleven hours a night they were pure
	 * cost. The springs and the weight shift carry on, because a sleeping cat
	 * that is perfectly rigid looks like a dead one.                          */
	var asleep = false;
	function setAsleep(on) { asleep = !!on; }

	/* QUANTISE THE INVISIBLE.
	 *
	 * A continuous sine changes the rounded transform string on every single
	 * frame, and each changed transform re-rasterises that part's whole subtree -
	 * every fur shape carries a gradient and there are four clip paths. The
	 * weight shift is the worst of them by far: it writes `spine`, which sits
	 * near the root, so a 0.9 degree sway nobody can see was repainting the
	 * entire cat eight times a second.
	 *
	 * Snapping these to a grid coarser than the eye keeps the motion and drops
	 * most of the repaints. The step is chosen per signal: what matters is how
	 * much of the picture the part owns, not how big the movement is.         */
	function q(v, step) { return Math.round(v / step) * step; }

	/* NO BREATHING. It was a rising and falling chest on `torso`, switchable
	 * between two grids and off, and after a long test on the phone the verdict
	 * was that the app looks best with it off - so it is gone rather than
	 * defaulted off. The chest was also the most expensive thing she did: `torso`
	 * owns the body art, and every breath re-rasterised the largest part of the
	 * picture. She is still not static - the weight shift, the springs, the
	 * blinks, the pupils and the ear flicks all remain.                       */

	/* ---- springs ----------------------------------------------------------
	 *
	 * Velocity is measured per SECOND, not per frame, or the same movement
	 * produces different lag at 8 fps and 15 fps.
	 *
	 * Teleports must not feed the springs. When a scene starts, the cat is
	 * repositioned and rescaled instantly; treating that as motion sends every
	 * spring straight to its clamp and she arrives looking wrenched. Anything
	 * above JUMP is taken as a teleport and swallowed.                        */

	function S(part, key, stiff, damp, gain, limit) {
		return { part: part, key: key, x: 0, v: 0,
		         stiff: stiff, damp: damp, gain: gain, limit: limit };
	}

	var springs = [
		/* tail segments trail the body, each looser than the one before */
		S('tail',  'rot', 0.16, 0.34, -0.22, 10),
		S('tail2', 'rot', 0.13, 0.30, -0.34, 14),
		S('tail3', 'rot', 0.10, 0.27, -0.46, 18),
		/* ears bounce on vertical movement */
		S('earL',  'rot', 0.18, 0.36, -0.075, 8),
		S('earR',  'rot', 0.18, 0.36, -0.075, 8),
		/* cloth lags the torso */
		S('vest',  'rot', 0.18, 0.32, -0.13, 7),
		/* whiskers drift */
		S('whiskerL', 'rot', 0.20, 0.32, -0.08, 6),
		S('whiskerR', 'rot', 0.20, 0.32, -0.08, 6),
		/* The head settles a beat after the body - gently. This spring was both
		 * the stiffest and the least damped of the set, which is why it was the
		 * only one that blew up (see the substep note in step()). It is soft and
		 * well damped now: her head follows the walk instead of whipping.      */
		S('neck',  'rot', 0.13, 0.44, -0.030, 2.4)
	];

	var JUMP = { x: 6, y: 14, rot: 22 };      /* per frame; above this = teleport */

	var prev = { x: 0, y: 0, rot: 0, valid: false };
	var vel = { x: 0, y: 0, rot: 0 };

	/* Call after any instant reposition, so the springs do not read it as speed */
	function settle() {
		prev.valid = false;
		vel.x = vel.y = vel.rot = 0;
		for (var i = 0; i < springs.length; i++) {
			springs[i].x = 0;
			springs[i].v = 0;
			Rig.bias(springs[i].part, springs[i].key, 0);
		}
	}

	function readVelocity(dt) {
		var wx = Rig.get('world', 'x');
		var cy = Rig.get('catRoot', 'y');
		var brot = Rig.get('body', 'rot') + Rig.get('spine', 'rot');

		if (!prev.valid) {
			prev.x = wx; prev.y = cy; prev.rot = brot; prev.valid = true;
			vel.x = vel.y = vel.rot = 0;
			return;
		}

		var dx = wx - prev.x, dy = cy - prev.y, dr = brot - prev.rot;
		prev.x = wx; prev.y = cy; prev.rot = brot;

		/* a teleport, not a movement */
		if (Math.abs(dx) > JUMP.x || Math.abs(dy) > JUMP.y || Math.abs(dr) > JUMP.rot) {
			vel.x = vel.y = vel.rot = 0;
			return;
		}

		var perSec = 1000 / Math.max(1, dt);
		vel.x = dx * perSec;
		vel.y = dy * perSec;
		vel.rot = dr * perSec;
	}

	/* ---- micro-motion state ---- */

	var nextBlink = 2600;
	var nextFlick = 5000;
	var nextSaccade = 1800;
	var gaze = { x: 0, y: 0 };
	var mood = 'calm';           /* calm | sleepy | alert | sad */

	function setMood(m) { mood = m || 'calm'; }

	/* Wind pushes her fur and whiskers downwind, all the time, in every scene. */
	var wind = 0;
	function setWind(speed, angle) {
		/* -1 .. 1, sign from whether it blows left or right across the screen */
		var lateral = Math.sin((angle || 0) * Math.PI / 180);
		wind = Math.max(-1, Math.min(1, (speed || 0) / 14)) * lateral;
	}

	function step(dt) {
		t += dt;
		var f = Math.min(3, dt / 16.7);        /* frames elapsed, for the integrator */

		readVelocity(dt);

		/* ---------- springs ----------
		 *
		 * INTEGRATE IN SUBSTEPS. This used to run the whole elapsed frame in one
		 * go, and since dt is never below 66ms, f was permanently pinned at its
		 * clamp of 3. A spring advanced three frames in a single step is not a
		 * slow spring, it is an unstable one - and the neck's numbers diverged
		 * at f = 3, growing 1.47x per frame until they hit the clamp and then
		 * flipping between +4 and -4 degrees on every frame, forever.
		 *
		 * That was the head shaking after a walk and never settling again: the
		 * walk was only the kick, and nothing in the maths could ever bring it
		 * back down. Held below one frame per substep, every spring decays.    */
		var sub = Math.max(1, Math.ceil(f));
		var sf = f / sub;
		var drive, i, s, k;
		for (i = 0; i < springs.length; i++) {
			s = springs[i];
			if (s.part === 'earL' || s.part === 'earR') drive = vel.y * 0.9 + vel.rot * 0.2;
			else if (s.part === 'neck') drive = vel.rot * 0.8 + vel.x * 0.25;
			else drive = vel.x * 0.7 + vel.rot * 0.45 + vel.y * 0.25;

			var target = drive * s.gain;
			if (target > s.limit) target = s.limit;
			else if (target < -s.limit) target = -s.limit;

			for (k = 0; k < sub; k++) {
				s.v += (target - s.x) * s.stiff * sf - s.v * s.damp * sf;
				s.x += s.v * sf;
				if (s.x > s.limit) { s.x = s.limit; s.v = 0; }
				else if (s.x < -s.limit) { s.x = -s.limit; s.v = 0; }
			}
			/* park it properly, so a spring never sits twitching in the last
			 * hundredth of a degree for the rest of the day */
			if (Math.abs(s.v) < 0.015 && Math.abs(target - s.x) < 0.015) {
				s.v = 0; s.x = target;
			}
			Rig.bias(s.part, s.key, Math.round(s.x * 100) / 100);
		}

		/* the wind is a constant lean on top of the spring result */
		if (wind) {
			Rig.bias('whiskerL', 'rot', Rig.biasOf('whiskerL', 'rot') + wind * 7);
			Rig.bias('whiskerR', 'rot', Rig.biasOf('whiskerR', 'rot') + wind * 7);
			Rig.bias('tail3', 'rot', Rig.biasOf('tail3', 'rot') + wind * 10);
		}

		/* ---------- slow weight shift, so standing is never static ----------
		 * Coarsest grid in the file: `spine` owns everything below the head, and
		 * this is a sway of under a degree over five seconds.                  */
		Rig.bias('spine', 'rot', q(Math.sin(t / 5200) * 0.9, 0.25));
		Rig.bias('spine', 'x', q(Math.sin(t / 6100) * 0.8, 0.25));

		/* ---------- eyes ---------- */
		if (asleep) return;

		if (t > nextSaccade) {
			/* small darts, and she looks where the wind or the action is */
			gaze.x = (Math.random() * 2 - 1) * 2.4;
			gaze.y = (Math.random() * 2 - 1) * 1.2;
			nextSaccade = t + 900 + Math.random() * 2600;
		}
		/* The eyes are a small subtree, so they can afford a finer grid than the
		 * body - but an exponential ease never quite arrives, and without a grid
		 * it kept writing hundredths of a pixel forever after every saccade.   */
		var ease = 0.12 * f;
		var px = Rig.biasOf('pupilL', 'x'), py = Rig.biasOf('pupilL', 'y');
		var nx = q(px + (gaze.x - px) * ease, 0.05);
		var ny = q(py + (gaze.y - py) * ease, 0.05);
		Rig.bias('pupilL', 'x', nx); Rig.bias('pupilR', 'x', nx);
		Rig.bias('pupilL', 'y', ny); Rig.bias('pupilR', 'y', ny);

		if (t > nextBlink) {
			if (typeof Actions !== 'undefined' && Actions.blink) Actions.blink();
			nextBlink = t + (mood === 'sleepy' ? 1400 : 2400) + Math.random() * 4200;
		}

		if (t > nextFlick) {
			if (typeof Actions !== 'undefined' && Actions.earTwitch) Actions.earTwitch();
			nextFlick = t + 6000 + Math.random() * 14000;
		}
	}

	/* Look at a point on the stage, in stage percent. Scenes use this to make
	 * her attention follow a prop rather than staring through it.               */
	function lookAtStage(px, py) {
		var b = Rig.bounds();
		var cx = b.x + b.w * 0.5;
		var cy = b.y + b.h * 0.28;
		gaze.x = Math.max(-3, Math.min(3, (px - cx) * 0.16));
		gaze.y = Math.max(-2, Math.min(2, (py - cy) * 0.10));
		nextSaccade = t + 1800;
	}

	return {
		step: step,
		settle: settle,
		asleep: setAsleep,
		mood: setMood,
		wind: setWind,
		lookAtStage: lookAtStage
	};
})();
