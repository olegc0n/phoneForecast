/* actions.js - the action library.
 *
 * Every action returns its duration in ms so the director can schedule the
 * next one without guessing. Actions only issue tweens; none of them touch
 * the DOM, and none of them know what the weather is.
 *
 * Posture matters: the rig is drawn head-on, so the postures it can hold are
 * STAND, SIT (body compressed, feet tucked) and CURL (asleep). Actions declare
 * what they need and the director inserts a transition.                        */

var Actions = (function () {
	var T = function (part, key, to, dur, ez, delay, done) { Anim.tween(part, key, to, dur, ez, delay, done); };
	var posture = 'STAND';

	/* ---------------- morphing ---------------- */

	var shapeNow = { mouthShape: 'closed', bodyShape: 'normal' };

	/* Reshape a part between two authored outlines. This is what makes a loaf a
	 * genuinely different silhouette instead of the same one squashed.         */
	function morph(part, set, name, dur, delay) {
		if (shapeNow[part] === name) return;
		var from = set[shapeNow[part]], to = set[name];
		if (!from || !to) return;
		shapeNow[part] = name;
		Rig.morphTo(part, from, to);
		Rig.set(part, 'morph', 0);
		T(part, 'morph', 1, dur || 400, 'io', delay || 0);
	}

	function mouth(name, dur, delay) {
		Anim.poke('mouthShape', 'o', name === 'closed' ? 0 : 1, delay || 0);
		morph('mouthShape', Shapes.mouth, name, dur, delay);
	}

	function silhouette(name, dur, delay) {
		morph('bodyShape', Shapes.body, name, dur, delay);
	}

	/* ---------------- eyelids ---------------- */

	/* how far the upper lid must travel to cover the eye */
	var LID_SHUT = 23;
	var LID_LOW = -18;

	/* 0 = wide open, 1 = closed. The lids sweep, so a half-lidded sleepy look
	 * is a real pose now rather than a squashed eyeball.                       */
	function lids(amount, dur, ez, delay) {
		T('lidUpL', 'y', LID_SHUT * amount, dur || 260, ez || 'io', delay);
		T('lidUpR', 'y', LID_SHUT * amount, dur || 260, ez || 'io', delay);
		T('lidLoL', 'y', LID_LOW * amount * 0.45, dur || 260, ez || 'io', delay);
		T('lidLoR', 'y', LID_LOW * amount * 0.45, dur || 260, ez || 'io', delay);
	}

	/* ---------------- eyes ---------------- */

	function eyesOpen(dur, delay) {
		Anim.poke('eyeLidL', 'o', 0, delay);
		Anim.poke('eyeLidR', 'o', 0, delay);
		lids(0, dur || 240, 'out', delay);
		lids(0.0, dur || 200, 'out', delay);
	}

	/* closed = the eyeball hidden and the lid seam shown, which reads as a
	 * content ^ ^ rather than a highlight inside a squashed eye              */
	function eyesShut(dur, delay) {
		lids(1, dur || 240, 'io', delay);
		Anim.poke('eyeLidL', 'o', 1, (delay || 0) + (dur || 240) * 0.75);
		Anim.poke('eyeLidR', 'o', 1, (delay || 0) + (dur || 240) * 0.75);
	}

	/* the second eye a hair behind the first: perfectly synchronised eyes are
	 * one of the things that read as mechanical                                */
	function blink() {
		T('lidUpL', 'y', LID_SHUT, 80, 'out');
		T('lidUpR', 'y', LID_SHUT, 80, 'out', 18);
		T('lidUpL', 'y', 0, 150, 'out', 105);
		T('lidUpR', 'y', 0, 150, 'out', 123);
		return 290;
	}

	function slowBlink() {
		lids(1, 400, 'io', 0);
		lids(0, 460, 'io', 900);
		return 1400;
	}

	function lookAt(dir) {                        /* -1 left, 0 ahead, +1 right */
		/* eyes lead, head follows a beat later - never together */
		T('pupilL', 'x', dir * 2.8, 260, 'out');
		T('pupilR', 'x', dir * 2.8, 260, 'out', 30);
		T('head', 'rot', dir * 7, 820, 'io', 130);
		T('earL', 'rot', dir * -5, 760, 'io', 180);
		T('earR', 'rot', dir * -5, 760, 'io', 220);
		return 980;
	}

	function lookAround() {
		lookAt(-1);
		T('pupilL', 'x', 2.8, 300, 'out', 1200);
		T('pupilR', 'x', 2.8, 300, 'out', 1240);
		T('head', 'rot', 7, 950, 'io', 1320);
		T('pupilL', 'x', 0, 320, 'out', 2700);
		T('pupilR', 'x', 0, 320, 'out', 2740);
		T('head', 'rot', 0, 820, 'io', 2820);
		return 3700;
	}

	function headTilt() {
		var d = Math.random() < 0.5 ? -1 : 1;
		T('head', 'rot', d * 13, 780, 'out');
		T('earL', 'rot', d * 8, 760, 'out', 60);
		T('earR', 'rot', d * 8, 760, 'out', 100);
		T('head', 'rot', 0, 900, 'io', 1900);
		T('earL', 'rot', 0, 860, 'io', 1960);
		T('earR', 'rot', 0, 860, 'io', 2000);
		return 2900;
	}

	/* ---------------- small idle beats ---------------- */

	function earTwitch() {
		var which = Math.random() < 0.5 ? 'earL' : 'earR';
		T(which, 'rot', -16, 90, 'out');
		T(which, 'rot', 6, 110, 'io', 100);
		T(which, 'rot', 0, 180, 'io', 220);
		return 420;
	}

	function tailFlick() {
		T('tail', 'rot', -24, 180, 'out');
		T('tail', 'rot', 8, 260, 'io', 200);
		T('tail', 'rot', 0, 320, 'io', 470);
		return 800;
	}

	function whiskerTwitch() {
		T('whiskerL', 'rot', -4, 160, 'out');
		T('whiskerR', 'rot', -4, 160, 'out');
		T('whiskerL', 'rot', 0, 240, 'io', 180);
		T('whiskerR', 'rot', 0, 240, 'io', 180);
		return 440;
	}

	/* ---------------- the good ones ---------------- */

	function yawn() {
		T('head', 'rot', -13, 520, 'out');
		mouth('wide', 380, 0);
		T('jaw', 'y', 3, 320, 'out');
		T('cheekL', 'sx', 1.14, 320, 'out');
		T('cheekR', 'sx', 1.14, 320, 'out');
		lids(0.85, 320, 'io', 0);
		mouth('closed', 340, 900);
		T('jaw', 'y', 0, 380, 'io', 900);
		T('cheekL', 'sx', 1, 380, 'io', 900);
		T('cheekR', 'sx', 1, 380, 'io', 900);
		T('head', 'rot', 0, 420, 'io', 900);
		lids(0, 300, 'out', 1200);
		return 1700;
	}

	function stretch() {
		silhouette('stretch', 700);
		silhouette('normal', 600, 950);
		T('body', 'sy', 0.9, 320, 'out');
		T('body', 'sx', 1.05, 320, 'out');
		T('pawFL', 'rot', -42, 420, 'out');
		T('pawFR', 'rot', -42, 420, 'out');
		T('head', 'rot', -9, 620, 'out');
		T('tail', 'rot', -30, 560, 'out');
		T('body', 'sy', 1, 520, 'io', 950);
		T('body', 'sx', 1, 520, 'io', 950);
		T('pawFL', 'rot', 0, 600, 'io', 950);
		T('pawFR', 'rot', 0, 600, 'io', 950);
		T('head', 'rot', 0, 600, 'io', 950);
		T('tail', 'rot', 0, 700, 'io', 950);
		return 1700;
	}

	/* Paw up to the face, three licks, paw down.
	 *
	 * The PAW does the licking now, not the head. It used to swing her head 8
	 * degrees every 150ms - four times a second - which is not grooming, it is a
	 * shake. And since a dozen scenes call groom(), it was the single biggest
	 * source of head jitter in the whole app.                                  */
	function groom() {
		T('pawFR', 'rot', -76, 420, 'out');
		T('head', 'rot', 7, 620, 'io');
		lids(0.6, 380, 'io');
		var d = 520;
		for (var i = 0; i < 3; i++) {
			T('pawFR', 'rot', -88, 300, 'io', d);
			T('head', 'rot', 9, 300, 'io', d);
			T('pawFR', 'rot', -70, 340, 'io', d + 300);
			T('head', 'rot', 6, 340, 'io', d + 300);
			d += 640;
		}
		T('pawFR', 'rot', 0, 520, 'io', d);
		T('head', 'rot', 0, 700, 'io', d);
		lids(0.0, 400, 'out', d);
		return d + 760;
	}

	function knead() {
		var d = 0;
		for (var i = 0; i < 4; i++) {
			T('pawFL', 'rot', i % 2 ? -6 : -22, 200, 'io', d);
			T('pawFR', 'rot', i % 2 ? -22 : -6, 200, 'io', d);
			d += 200;
		}
		T('pawFL', 'rot', 0, 260, 'io', d);
		T('pawFR', 'rot', 0, 260, 'io', d);
		return d + 300;
	}

	function shakeOff() {
		var d = 0;
		for (var i = 0; i < 6; i++) {
			var s = i % 2 ? 1 : -1;
			T('head', 'rot', s * 9, 70, 'lin', d);
			T('earL', 'rot', s * 16, 70, 'lin', d);
			T('earR', 'rot', s * 16, 70, 'lin', d);
			T('body', 'rot', s * 3, 70, 'lin', d);
			d += 70;
		}
		T('head', 'rot', 0, 200, 'io', d);
		T('earL', 'rot', 0, 200, 'io', d);
		T('earR', 'rot', 0, 200, 'io', d);
		T('body', 'rot', 0, 200, 'io', d);
		return d + 260;
	}

	function sneeze() {
		T('head', 'rot', -10, 420, 'io');
		T('cheekL', 'sx', 1.18, 380, 'io');
		T('cheekR', 'sx', 1.18, 380, 'io');
		T('cheekL', 'sx', 1, 300, 'out', 560);
		T('cheekR', 'sx', 1, 300, 'out', 560);
		T('nose', 'sy', 1.2, 300, 'io');
		T('nose', 'sy', 1, 260, 'out', 560);
		lids(0.8, 380, 'io', 0);
		lids(0, 260, 'out', 570);
		/* the sneeze itself */
		T('head', 'rot', 14, 90, 'out', 460);
		T('body', 'sy', 0.94, 90, 'out', 460);
		T('earL', 'rot', 22, 90, 'out', 460);
		T('earR', 'rot', 22, 90, 'out', 460);
		T('head', 'rot', 0, 340, 'io', 570);
		T('body', 'sy', 1, 340, 'io', 570);
		T('earL', 'rot', 0, 380, 'io', 570);
		T('earR', 'rot', 0, 380, 'io', 570);
		lids(0.0, 260, 'out', 570);
		return 1000;
	}

	function shiver() {
		var d = 0;
		for (var i = 0; i < 10; i++) {
			T('body', 'x', (i % 2 ? 1 : -1) * 1.1, 60, 'lin', d);
			T('head', 'x', (i % 2 ? -1 : 1) * 0.8, 60, 'lin', d);
			d += 60;
		}
		T('body', 'x', 0, 140, 'io', d);
		T('head', 'x', 0, 140, 'io', d);
		return d + 200;
	}

	function pant() {
		mouth('pant', 180, 0);
		var d = 200;
		for (var i = 0; i < 6; i++) {
			T('jaw', 'y', i % 2 ? 2.6 : 0.4, 150, 'io', d);
			T('cheekL', 'sy', i % 2 ? 1.1 : 1, 150, 'io', d);
			T('cheekR', 'sy', i % 2 ? 1.1 : 1, 150, 'io', d);
			d += 150;
		}
		T('jaw', 'y', 0, 200, 'io', d);
		mouth('closed', 200, d);
		return d + 260;
	}

	function purr() {
		mouth('smile', 300, 100);
		mouth('closed', 300, 2400);
		eyesShut(260);
		T('head', 'rot', -4, 320, 'io');
		T('tail', 'rot', -20, 420, 'io');
		T('earL', 'rot', -6, 320, 'io');
		T('earR', 'rot', -6, 320, 'io');
		eyesOpen(320, 2400);
		T('head', 'rot', 0, 420, 'io', 2400);
		T('tail', 'rot', 0, 520, 'io', 2400);
		T('earL', 'rot', 0, 420, 'io', 2400);
		T('earR', 'rot', 0, 420, 'io', 2400);
		return 2900;
	}

	function startle() {
		T('catRoot', 'y', -10, 110, 'out');
		T('catRoot', 'y', 0, 260, 'in', 120);
		T('tail', 'sx', 1.5, 120, 'out');
		T('tail', 'sy', 1.5, 120, 'out');
		T('earL', 'rot', 26, 130, 'out');
		T('earR', 'rot', 26, 130, 'out');
		T('eyeL', 'sx', 1.12, 130, 'out');
		T('eyeR', 'sx', 1.12, 130, 'out');
		T('tail', 'sx', 1, 720, 'io', 700);
		T('tail', 'sy', 1, 720, 'io', 700);
		T('earL', 'rot', 0, 620, 'io', 900);
		T('earR', 'rot', 0, 620, 'io', 900);
		T('eyeL', 'sx', 1, 620, 'io', 900);
		T('eyeR', 'sx', 1, 620, 'io', 900);
		return 1600;
	}

	function earsFlat(on) {
		var a = on ? 34 : 0;
		T('earL', 'rot', a, 320, 'io');
		T('earR', 'rot', a, 320, 'io');
		return 360;
	}

	/* ---------------- postures ---------------- */

	function sit() {
		if (posture === 'SIT') return 0;
		posture = 'SIT';
		silhouette('loaf', 460);
		T('body', 'sy', 0.88, 420, 'io');
		T('body', 'sx', 1.06, 420, 'io');
		T('footL', 'rot', -14, 420, 'io');
		T('footR', 'rot', 14, 420, 'io');
		T('pawFL', 'rot', 10, 420, 'io');
		T('pawFR', 'rot', 10, 420, 'io');
		T('tail', 'rot', -12, 520, 'io');
		return 480;
	}

	function stand() {
		if (posture === 'STAND') return 0;
		posture = 'STAND';
		silhouette('normal', 460);
		T('body', 'sy', 1, 420, 'io');
		T('body', 'sx', 1, 420, 'io');
		T('footL', 'rot', 0, 420, 'io');
		T('footR', 'rot', 0, 420, 'io');
		T('pawFL', 'rot', 0, 420, 'io');
		T('pawFR', 'rot', 0, 420, 'io');
		T('tail', 'rot', 0, 480, 'io');
		T('head', 'rot', 0, 420, 'io');
		T('head', 'y', 0, 420, 'io');
		return 480;
	}

	function curl() {
		posture = 'CURL';
		silhouette('ball', 800);
		T('body', 'sy', 0.8, 800, 'io');
		T('body', 'sx', 1.12, 800, 'io');
		T('head', 'rot', 10, 800, 'io');
		T('head', 'y', 6, 800, 'io');
		T('footL', 'rot', -20, 800, 'io');
		T('footR', 'rot', 20, 800, 'io');
		T('earL', 'rot', 15, 800, 'io');
		T('earR', 'rot', 9, 800, 'io');
		T('tail', 'rot', -34, 900, 'io');
		eyesShut(700);
		return 900;
	}

	/* Properly asleep, which is NOT the same as curled.
	 *
	 * Drawn head-on she has no lying-down pose, so a curl alone just looks like
	 * standing with the eyes shut. Instead: a wide low mound of a body, the head
	 * sunk down into it so only the top and the ears show, the feet tucked out of
	 * sight, and the tail lying along the base. That reads as a sleeping cat. */
	function sleep() {
		posture = 'SLEEP';
		silhouette('sleep', 900);

		T('body', 'sy', 0.72, 900, 'io');
		T('body', 'sx', 1.06, 900, 'io');

		/* the head sinks into the body */
		T('neck', 'y', 30, 900, 'io');
		T('head', 'rot', 7, 900, 'io');
		T('head', 'y', 12, 900, 'io');

		/* feet out of sight under her */
		T('footL', 'y', 16, 800, 'io');
		T('footR', 'y', 16, 800, 'io');
		Anim.poke('footL', 'o', 0, 500);
		Anim.poke('footR', 'o', 0, 500);

		/* paws folded, tail lying along the base */
		T('pawFL', 'rot', 24, 900, 'io');
		T('pawFR', 'rot', 24, 900, 'io');
		T('tail', 'rot', -66, 1000, 'io');
		T('tail2', 'rot', -30, 1000, 'io');
		T('tail3', 'rot', -18, 1000, 'io');

		T('earL', 'rot', 20, 900, 'io');
		T('earR', 'rot', 14, 900, 'io');
		T('whiskerL', 'rot', 8, 900, 'io');
		T('whiskerR', 'rot', 8, 900, 'io');

		eyesShut(800);
		mouth('closed', 400);
		return 1100;
	}

	function wake() {
		posture = 'STAND';
		eyesOpen(420);
		var d = stand();

		/* undo everything sleep() tucked away */
		T('neck', 'y', 0, 700, 'io');
		T('head', 'y', 0, 700, 'io');
		T('footL', 'y', 0, 600, 'io');
		T('footR', 'y', 0, 600, 'io');
		Anim.poke('footL', 'o', 1, 0);
		Anim.poke('footR', 'o', 1, 0);
		T('tail', 'rot', 0, 800, 'io');
		T('tail2', 'rot', 0, 800, 'io');
		T('tail3', 'rot', 0, 800, 'io');
		T('earL', 'rot', 0, 500, 'io');
		T('earR', 'rot', 0, 500, 'io');
		T('whiskerL', 'rot', 0, 600, 'io');
		T('whiskerR', 'rot', 0, 600, 'io');
		return d + 100;
	}

	/* ---------------- travel ---------------- */

	/* A plush toy does not walk, it waddles: body rocking, feet alternating,
	 * a small hop per step. One step covers about 4vw.                         */
	function waddle(toX) {
		stand();
		var from = Rig.get('world', 'x');
		var dist = toX - from;
		if (Math.abs(dist) < 1) return 0;

		var dir = dist > 0 ? 1 : -1;
		var steps = Math.max(2, Math.round(Math.abs(dist) / 4));
		var per = 210;
		var total = steps * per;

		Rig.set('world', 'face', dir > 0 ? 1 : -1);
		Anim.tween('world', 'x', toX, total, 'io');

		var d = 0;
		for (var i = 0; i < steps; i++) {
			var s = i % 2 ? 1 : -1;
			T('body', 'rot', s * 4, per, 'io', d);
			T('footL', 'rot', s > 0 ? -10 : -2, per, 'io', d);
			T('footR', 'rot', s > 0 ? 2 : 10, per, 'io', d);
			T('pawFL', 'rot', s * -7, per, 'io', d);
			T('pawFR', 'rot', s * 7, per, 'io', d);
			T('catRoot', 'y', -3.5, per * 0.45, 'out', d);
			T('catRoot', 'y', 0, per * 0.55, 'in', d + per * 0.45);
			T('tail', 'rot', s * -10, per, 'io', d);
			d += per;
		}
		T('body', 'rot', 0, 240, 'io', d);
		T('footL', 'rot', 0, 240, 'io', d);
		T('footR', 'rot', 0, 240, 'io', d);
		T('pawFL', 'rot', 0, 240, 'io', d);
		T('pawFR', 'rot', 0, 240, 'io', d);
		T('tail', 'rot', 0, 300, 'io', d);
		return total + 300;
	}

	function hop() {
		T('body', 'sy', 0.86, 130, 'out');
		T('footL', 'rot', -8, 130, 'out');
		T('footR', 'rot', 8, 130, 'out');
		T('catRoot', 'y', -13, 190, 'out', 130);
		T('body', 'sy', 1.06, 190, 'out', 130);
		T('catRoot', 'y', 0, 220, 'in', 320);
		T('body', 'sy', 0.94, 130, 'io', 520);
		T('body', 'sy', 1, 200, 'io', 650);
		T('footL', 'rot', 0, 220, 'io', 540);
		T('footR', 'rot', 0, 220, 'io', 540);
		return 900;
	}

	return {
		posture: function () { return posture; },
		setPosture: function (p) { posture = p; },
		blink: blink, slowBlink: slowBlink, lookAt: lookAt, lookAround: lookAround,
		headTilt: headTilt, earTwitch: earTwitch, tailFlick: tailFlick,
		whiskerTwitch: whiskerTwitch, yawn: yawn, stretch: stretch, groom: groom,
		knead: knead, shakeOff: shakeOff, sneeze: sneeze, shiver: shiver, pant: pant,
		purr: purr, startle: startle, earsFlat: earsFlat,
		sit: sit, stand: stand, curl: curl, sleep: sleep, wake: wake,
		waddle: waddle, hop: hop,
		eyesShut: eyesShut, eyesOpen: eyesOpen,
		lids: lids, mouth: mouth, silhouette: silhouette
	};
})();
