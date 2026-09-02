/* beats.js - the vocabulary scenes are written in.
 *
 * A beat is one readable verb: walkTo, sit, eat, look, throw. Each one already
 * contains the timing craft - the stagger, the overlap, the follow-through - so a
 * scene is a LIST of beats rather than a hundred hand-tuned tween calls with
 * magic delays. That is the difference between 17 animations and 100+, and it is
 * what makes them writable by hand.
 *
 *   ['walkTo', 32]        walk to 32% across the stage
 *   ['eat', 6]            six mouthfuls, chewed with the jaw
 *   ['prop', 'cup', 'mug', 64, 79, 9, 9]
 *   ['sip', 'cup']        lift that prop to her mouth and drink
 *
 * Beats run in SEQUENCE: each returns how long it takes, and the runner keeps a
 * cursor so the next one starts when the last finishes. Anything that should
 * overlap is expressed inside a single beat.
 */

var Beats = (function () {

	/* ctx.t is the cursor: every tween a beat issues is delayed by it */
	function T(ctx, part, key, to, dur, ez, at) {
		Anim.tween(part, key, to, dur, ez, ctx.t + (at || 0));
	}

	function propOf(ctx, name) {
		return ctx.props[name];
	}

	/* how tall is a prop, in stage percent, given its width and artwork aspect */
	function propHeight(wPct, aspect) {
		var px = Rig.stagePx();
		return wPct * (px.w / px.h) / (aspect || 1);
	}

	var VERBS = {

		/* ---------------- time ---------------- */

		wait: function (ctx, ms) { return ms || 500; },

		/* ---------------- travel ---------------- */

		walkTo: function (ctx, x) {
			var span = 100 - Rig.size.w;
			var target = Math.max(0, Math.min(span, x));
			var from = Rig.get('world', 'x');
			if (Math.abs(target - from) < 1) return 0;
			/* Actions.waddle issues its own tweens from now, so it has to be
			 * scheduled rather than called inline when the cursor has moved on */
			return schedule(ctx, function () { return Actions.waddle(target); }, 210 * Math.max(2, Math.round(Math.abs(target - from) / 4)) + 300);
		},

		face: function (ctx, dir) {
			return schedule(ctx, function () { Rig.face(dir); return 0; }, 60);
		},

		hop: function (ctx) { return schedule(ctx, Actions.hop, 900); },

		/* ---------------- posture ---------------- */

		sit:   function (ctx) { return schedule(ctx, Actions.sit, 520); },
		stand: function (ctx) { return schedule(ctx, Actions.stand, 520); },
		curl:  function (ctx) { return schedule(ctx, Actions.curl, 900); },
		loaf:  function (ctx) {
			return schedule(ctx, function () { Actions.silhouette('loaf', 600); Actions.sit(); return 660; }, 660);
		},
		sprawl: function (ctx) {
			return schedule(ctx, function () {
				Actions.silhouette('loaf', 900);
				Anim.tween('body', 'sy', 0.76, 900, 'io');
				Anim.tween('footL', 'rot', -26, 900, 'io');
				Anim.tween('footR', 'rot', 26, 900, 'io');
				Anim.tween('head', 'rot', 11, 900, 'io');
				return 960;
			}, 960);
		},

		/* ---------------- attention ---------------- */

		/* Look at a point on the stage. Eyes lead, the head follows. */
		look: function (ctx, a) {
			var x = a[0], y = a[1];
			return schedule(ctx, function () {
				Alive.lookAtStage(x, y);
				var b = Rig.bounds();
				var dir = x > (b.x + b.w * 0.5) ? 1 : -1;
				Anim.tween('head', 'rot', dir * 8, 500, 'io', 120);
				return 620;
			}, 620);
		},

		lookAhead: function (ctx) {
			T(ctx, 'head', 'rot', 0, 500, 'io');
			T(ctx, 'pupilL', 'x', 0, 400, 'io');
			T(ctx, 'pupilR', 'x', 0, 400, 'io');
			return 520;
		},

		head: function (ctx, a) {
			var rot = a instanceof Array ? a[0] : a;
			var y = a instanceof Array ? (a[1] || 0) : 0;
			T(ctx, 'head', 'rot', rot, 700, 'io');
			T(ctx, 'head', 'y', y, 700, 'io');
			return 720;
		},

		ears: function (ctx, deg) {
			T(ctx, 'earL', 'rot', deg, 450, 'io');
			T(ctx, 'earR', 'rot', deg, 450, 'io', 40);
			return 500;
		},

		tail: function (ctx, deg) {
			T(ctx, 'tail', 'rot', deg, 600, 'io');
			return 620;
		},

		/* ---------------- face ---------------- */

		blink:     function (ctx) { return schedule(ctx, Actions.blink, 300); },
		slowBlink: function (ctx) { return schedule(ctx, Actions.slowBlink, 1400); },
		yawn:      function (ctx) { return schedule(ctx, Actions.yawn, 1750); },
		sneeze:    function (ctx) { return schedule(ctx, Actions.sneeze, 1050); },
		startle:   function (ctx) { return schedule(ctx, Actions.startle, 1650); },
		pant:      function (ctx) { return schedule(ctx, Actions.pant, 1400); },
		shake:     function (ctx) { return schedule(ctx, Actions.shakeOff, 800); },
		stretch:   function (ctx) { return schedule(ctx, Actions.stretch, 1750); },
		groom:     function (ctx) { return schedule(ctx, Actions.groom, 2200); },
		knead:     function (ctx) { return schedule(ctx, Actions.knead, 1100); },
		purr:      function (ctx) { return schedule(ctx, Actions.purr, 2900); },

		mouth: function (ctx, name) {
			return schedule(ctx, function () { Actions.mouth(name, 350); return 380; }, 380);
		},

		lids: function (ctx, amount) {
			return schedule(ctx, function () { Actions.lids(amount, 400); return 420; }, 420);
		},

		/* A named expression, so scenes can say how she feels. */
		emote: function (ctx, mood) {
			return schedule(ctx, function () {
				switch (mood) {
					case 'happy':
						Actions.mouth('smile', 350); Actions.lids(0.25, 400);
						Anim.tween('earL', 'rot', -8, 450, 'io'); Anim.tween('earR', 'rot', -8, 450, 'io', 40);
						Anim.tween('tail', 'rot', -18, 600, 'io');
						break;
					case 'sad':
						Actions.mouth('frown', 450); Actions.lids(0.45, 500);
						Anim.tween('earL', 'rot', 30, 600, 'io'); Anim.tween('earR', 'rot', 30, 600, 'io', 50);
						Anim.tween('head', 'y', 5, 700, 'io');
						break;
					case 'surprised':
						Actions.lids(0, 200);
						Anim.tween('eyeL', 'sx', 1.12, 260, 'out'); Anim.tween('eyeR', 'sx', 1.12, 260, 'out');
						Anim.tween('earL', 'rot', -14, 240, 'out'); Anim.tween('earR', 'rot', -14, 240, 'out');
						Actions.mouth('small', 240);
						break;
					case 'annoyed':
						Actions.lids(0.55, 400);
						Anim.tween('earL', 'rot', 26, 450, 'io'); Anim.tween('earR', 'rot', 22, 450, 'io');
						Anim.tween('tail', 'rot', -26, 400, 'out');
						break;
					case 'sleepy':
						Actions.lids(0.75, 700); Actions.mouth('closed', 300);
						Anim.tween('head', 'y', 5, 800, 'io');
						break;
					default:
						Actions.lids(0, 300); Actions.mouth('closed', 300);
				}
				return 800;
			}, 800);
		},

		/* ---------------- paws ---------------- */

		paw: function (ctx, a) {
			var which = a[0] === 'L' ? 'pawFL' : 'pawFR';
			T(ctx, which, 'rot', a[1], a[2] || 400, 'out');
			return (a[2] || 400) + 40;
		},

		pawsDown: function (ctx) {
			T(ctx, 'pawFL', 'rot', 0, 500, 'io');
			T(ctx, 'pawFR', 'rot', 0, 500, 'io', 60);
			return 560;
		},

		/* Typing: alternating paws, head still, eyes reading. */
		type: function (ctx, bursts) {
			var n = bursts || 2, at = 0, i, b;
			T(ctx, 'pawFL', 'rot', -26, 500, 'io');
			T(ctx, 'pawFR', 'rot', -26, 500, 'io', 60);
			at = 560;
			for (b = 0; b < n; b++) {
				for (i = 0; i < 9; i++) {
					T(ctx, 'pawFL', 'rot', i % 2 ? -31 : -22, 110, 'io', at);
					T(ctx, 'pawFR', 'rot', i % 2 ? -22 : -31, 110, 'io', at);
					at += 110;
				}
				T(ctx, 'pawFL', 'rot', -26, 200, 'io', at);
				T(ctx, 'pawFR', 'rot', -26, 200, 'io', at);
				T(ctx, 'pupilL', 'x', -2, 500, 'io', at + 200);
				T(ctx, 'pupilR', 'x', -2, 500, 'io', at + 200);
				T(ctx, 'pupilL', 'x', 1.6, 1000, 'lin', at + 900);
				T(ctx, 'pupilR', 'x', 1.6, 1000, 'lin', at + 900);
				at += 2100;
			}
			return at;
		},

		/* Chewing with the jaw, not by bobbing the head. */
		eat: function (ctx, bites) {
			var n = bites || 6, at = 0, i;
			T(ctx, 'head', 'rot', 15, 700, 'io');
			T(ctx, 'head', 'y', 6, 700, 'io');
			at = 720;
			Anim.tween('lidUpL', 'y', 23 * 0.45, 500, 'io', ctx.t + 100);
			Anim.tween('lidUpR', 'y', 23 * 0.45, 500, 'io', ctx.t + 140);
			for (i = 0; i < n; i++) {
				T(ctx, 'jaw', 'y', i % 2 ? 2.4 : 0.2, 175, 'io', at);
				T(ctx, 'cheekL', 'sx', i % 2 ? 1.09 : 1, 175, 'io', at);
				T(ctx, 'cheekR', 'sx', i % 2 ? 1.09 : 1, 175, 'io', at);
				at += 175;
			}
			T(ctx, 'jaw', 'y', 0, 220, 'io', at);
			T(ctx, 'head', 'rot', 0, 600, 'io', at + 200);
			T(ctx, 'head', 'y', 0, 600, 'io', at + 200);
			Anim.tween('lidUpL', 'y', 0, 400, 'out', ctx.t + at + 200);
			Anim.tween('lidUpR', 'y', 0, 400, 'out', ctx.t + at + 240);
			return at + 850;
		},

		/* ---------------- props ---------------- */

		/* ['prop', name, art, x, y, w, z, aspect] */
		/* ['lick', n] - n licks at whatever she is holding.
		 *
		 * `sip` was doing this job and it is not the same thing: sip is one long
		 * pull with the eyes shut, which is what drinking looks like. Licking an
		 * ice cream is a rhythm - the head dips to the paw, the mouth opens a
		 * little, the jaw works, and it repeats. Without that it read as her
		 * holding an ice cream and thinking about it.                          */
		/* ['lick', propName, n] - n licks at a prop she is holding.
		 *
		 * The lift is the SAME code that raises the mug and the bowl: ask
		 * Rig.bounds() where she is, put the thing 53% across her and a bit under
		 * a third of the way down, which is her mouth. Measured at the moment it
		 * happens, so it lands correctly wherever she is standing and however she
		 * is posed.
		 *
		 * This replaces an attempt to do it with the wardrobe's ice cream, which
		 * is a garment inside pawFL - behind a pivot and two rotations - where the
		 * offset has to be guessed in a rotated frame. Three rounds of measuring
		 * screenshots still had it a tenth of the screen out. The prop route was
		 * already solved; the garment route only looked simpler.
		 *
		 * Licking is a rhythm, which is what makes it licking rather than sipping:
		 * the head dips to the cone, the mouth opens a little, the jaw works, and
		 * it repeats.                                                            */
		lick: function (ctx, a) {
			var name = null, licks = 4;
			if (typeof a === 'string') name = a;
			else if (typeof a === 'number') licks = a;
			else if (a) { name = a[0]; licks = a[1] || 4; }

			var p = name ? propOf(ctx, name) : null;
			var total = 760 + licks * 460 + 1100;

			return schedule(ctx, function () {
				if (p) {
					var b = Rig.bounds(), px = Rig.stagePx();
					var hPct = propHeight(p.w, p.aspect);
					var toX = b.x + b.w * 0.53 - p.w * 0.5;
					/* 0.18: the fraction of the prop that lands on her mouth line.
					 *
					 * At 0.38 the middle of the scoops sat on her mouth, so the top
					 * scoop rode up over her face - reported from the screen as
					 * looking like the ice cream was being smeared on her. At 0.18
					 * it is the TOP scoop that meets her mouth and the rest of the
					 * cone hangs below, which is how you hold one you are licking. */
					var toY = b.y + b.h * 0.295 - hPct * 0.18;
					Anim.tween(p.id, 'x', (toX - p.x) / 100 * px.w, 660, 'out');
					Anim.tween(p.id, 'y', (toY - p.y) / 100 * px.h, 660, 'out');
				}
				Anim.tween('pawFR', 'rot', -60, 620, 'out');
				Anim.tween('head', 'rot', -6, 660, 'io');
				Actions.lids(0.45, 400, 'io', 420);

				var at = 760;
				for (var i = 0; i < licks; i++) {
					Actions.mouth('small', 170, at);
					Anim.tween('jaw', 'y', 2.2, 170, 'io', at);
					Anim.tween('head', 'rot', -10, 190, 'io', at);
					Actions.mouth('closed', 190, at + 210);
					Anim.tween('jaw', 'y', 0, 200, 'io', at + 210);
					Anim.tween('head', 'rot', -5, 210, 'io', at + 210);
					at += 460;
				}

				Actions.lids(0, 400, 'out', at);
				Anim.tween('head', 'rot', 0, 640, 'io', at + 100);
				Anim.tween('pawFR', 'rot', 0, 760, 'io', at + 240);
				if (p) {
					Anim.tween(p.id, 'x', 0, 780, 'io', at + 240);
					Anim.tween(p.id, 'y', 0, 780, 'io', at + 240);
				}
				return total;
			}, total);
		},

		/* ['tint', 'hot' | 'cold', level, ms]
		 *
		 * The red on her forehead when she is too warm, and the blue over her face
		 * when she is freezing. Both are shapes authored into the rig at opacity
		 * zero, and until now only hand-written episodes could reach them - a data
		 * scene had no verb for it at all.
		 *
		 * It reports a length of zero on purpose. Going red happens WHILE she is
		 * doing other things, so holding the timeline up for it would leave her
		 * standing still and reddening, which is not what heat looks like.      */
		tint: function (ctx, a) {
			var which, level, ms;
			if (typeof a === 'string') { which = a; level = 0.9; ms = 2000; }
			else {
				which = a[0];
				level = a[1] === undefined ? 0.9 : a[1];
				ms = a[2] || 2000;
			}
			var part = which === 'cold' ? 'coldTint' : 'foreheadFlush';
			return schedule(ctx, function () {
				Anim.tween(part, 'o', level, ms, 'io');
				return 0;
			}, 0);
		},

		/* ['prop', name, art, x, y, w, z, aspect]
		 *
		 * CREATED NOW, FADED IN AT ITS OWN TIME - and that ordering is the whole
		 * point of this comment.
		 *
		 * It used to be created inside the scheduled callback. But play() walks the
		 * whole beat list up front, and schedule() only runs a callback immediately
		 * while the cursor is still at zero - so only the FIRST prop of a scene
		 * existed by the end of the build. Every verb that takes a prop looks it up
		 * during the build, which meant sip, throw and propOut silently did nothing
		 * from the second prop onwards. The mug in the tea break was never lifted;
		 * it sat where it was placed and she mimed over it.
		 *
		 * Props.put() starts a prop at opacity 0, so creating it early shows
		 * nothing at all - only the fade needs to wait for its turn.           */
		prop: function (ctx, a) {
			var name = a[0], art = a[1];
			var x = a[2], y = a[3], w = a[4], z = a[5] === undefined ? 9 : a[5];
			var id = Props.put(art, x, y, w, z);
			ctx.props[name] = { id: id, x: x, y: y, w: w, aspect: a[6] || 1 };
			return schedule(ctx, function () {
				Anim.tween(id, 'o', 1, 500, 'io');
			}, 520);
		},

		propOut: function (ctx, name) {
			var p = propOf(ctx, name);
			if (!p) return 0;
			T(ctx, p.id, 'o', 0, 600, 'io');
			return 620;
		},

		/* ['propTo', name, dxPct, dyPct, ms] - move it across the stage */
		propTo: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var px = Rig.stagePx();
			var ms = a[3] || 800;
			T(ctx, p.id, 'x', (a[1] - p.x) / 100 * px.w, ms, 'io');
			T(ctx, p.id, 'y', (a[2] - p.y) / 100 * px.h, ms, 'io');
			return ms + 40;
		},

		spin: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			T(ctx, p.id, 'rot', a[1], a[2] || 800, 'lin');
			return (a[2] || 800) + 40;
		},

		/* Lift a prop to her MOUTH and drink. Measured, not guessed: her mouth is
		 * 29% down her box and props anchor by their top-left corner.           */
		sip: function (ctx, name) {
			var p = propOf(ctx, name);

			/* She may be drinking something she is already HOLDING - a soda from
			 * the wardrobe rather than a prop on a table. Then there is nothing
			 * to move: just the drinking pose.                                  */
			if (!p) {
				if (String(name).charAt(0) !== 'w') return 0;
				return schedule(ctx, function () {
					Anim.tween('pawFL', 'rot', -68, 550, 'out');
					Actions.lids(0.5, 400, 'io', 550);
					Actions.mouth('small', 300, 600);
					Actions.mouth('closed', 300, 1500);
					Actions.lids(0, 400, 'out', 1600);
					Anim.tween('pawFL', 'rot', 0, 700, 'io', 1800);
					return 2500;
				}, 2500);
			}

			return schedule(ctx, function () {
				var b = Rig.bounds(), px = Rig.stagePx();
				var hPct = propHeight(p.w, p.aspect);
				var toX = b.x + b.w * 0.53 - p.w * 0.5;
				var toY = b.y + b.h * 0.295 - hPct * 0.2;
				Anim.tween('pawFR', 'rot', -62, 500, 'out');
				Anim.tween(p.id, 'x', (toX - p.x) / 100 * px.w, 600, 'out');
				Anim.tween(p.id, 'y', (toY - p.y) / 100 * px.h, 600, 'out');
				Actions.lids(0.5, 400, 'io', 600);
				Actions.mouth('small', 300, 600);
				Actions.mouth('closed', 300, 1400);
				Actions.lids(0, 400, 'out', 1500);
				Anim.tween(p.id, 'x', 0, 700, 'io', 1700);
				Anim.tween(p.id, 'y', 0, 700, 'io', 1700);
				Anim.tween('pawFR', 'rot', 0, 700, 'io', 1700);
				return 2500;
			}, 2500);
		},

		/* ['throw', name, toXPct] - wind up, throw, and let it splat */
		throwIt: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var px = Rig.stagePx();
			T(ctx, 'pawFL', 'rot', -96, 600, 'out');
			T(ctx, 'spine', 'rot', -8, 600, 'out');
			T(ctx, 'pawFL', 'rot', 26, 240, 'in', 900);
			T(ctx, 'spine', 'rot', 9, 240, 'in', 900);
			T(ctx, p.id, 'x', (a[1] - p.x) / 100 * px.w, 900, 'out', 1000);
			T(ctx, p.id, 'y', -px.h * 0.1, 420, 'out', 1000);
			T(ctx, p.id, 'y', px.h * 0.02, 480, 'in', 1420);
			T(ctx, p.id, 'rot', 900, 900, 'lin', 1000);
			T(ctx, p.id, 'sx', 1.9, 200, 'out', 1900);
			T(ctx, p.id, 'sy', 0.4, 200, 'out', 1900);
			T(ctx, p.id, 'o', 0, 400, 'io', 2000);
			T(ctx, 'pawFL', 'rot', 0, 700, 'io', 1900);
			T(ctx, 'spine', 'rot', 0, 700, 'io', 1900);
			return 2600;
		},

		/* ---------------- movement in two dimensions ---------------- */

		/* ['moveTo', xPct, yPct] - travel anywhere on the stage, not just along
		 * the floor. Used for climbing and for jumping onto things.            */
		moveTo: function (ctx, a) {
			var ms = a[2] || 900;
			T(ctx, 'world', 'x', a[0], ms, 'io');
			T(ctx, 'world', 'y', a[1], ms, 'io');
			return ms + 60;
		},

		/* Turn around twice before settling, the way a cat does before lying down */
		circle: function (ctx) {
			return schedule(ctx, function () {
				var i, at = 0;
				for (i = 0; i < 4; i++) {
					Rig.set('world', 'face', i % 2 ? -1 : 1);
					Anim.tween('spine', 'rot', i % 2 ? 5 : -5, 420, 'io', at);
					Anim.tween('tail', 'rot', i % 2 ? -22 : 22, 420, 'io', at);
					at += 420;
				}
				Anim.tween('spine', 'rot', 0, 400, 'io', at);
				Rig.set('world', 'face', 1);
				return at + 420;
			}, 2100);
		},

		/* Spinning after her own tail: the front view sells this as fast mirror
		 * flips with the body leaning into the turn.                            */
		chaseTail: function (ctx, turns) {
			var n = turns || 3;
			return schedule(ctx, function () {
				var i, at = 0, step = 320;
				for (i = 0; i < n * 2; i++) {
					Rig.set('world', 'face', i % 2 ? -1 : 1);
					Anim.tween('spine', 'rot', i % 2 ? 9 : -9, step, 'io', at);
					Anim.tween('tail', 'rot', i % 2 ? -34 : 34, step, 'io', at);
					Anim.tween('head', 'rot', i % 2 ? 14 : -14, step, 'io', at);
					Anim.tween('catRoot', 'y', -5, step * 0.5, 'out', at);
					Anim.tween('catRoot', 'y', 0, step * 0.5, 'in', at + step * 0.5);
					at += step;
				}
				Rig.set('world', 'face', 1);
				Anim.tween('spine', 'rot', 0, 400, 'io', at);
				Anim.tween('tail', 'rot', 0, 500, 'io', at);
				Anim.tween('head', 'rot', 0, 400, 'io', at);
				return at + 500;
			}, n * 2 * 320 + 500);
		},

		/* Dizzy: a slow wobble with the eyes not quite tracking */
		dizzy: function (ctx) {
			return schedule(ctx, function () {
				var i, at = 0;
				for (i = 0; i < 5; i++) {
					Anim.tween('spine', 'rot', i % 2 ? 6 : -6, 520, 'io', at);
					Anim.tween('head', 'rot', i % 2 ? -8 : 8, 520, 'io', at);
					Anim.tween('pupilL', 'x', i % 2 ? 2.2 : -2.2, 520, 'io', at);
					Anim.tween('pupilR', 'x', i % 2 ? -2.2 : 2.2, 520, 'io', at);
					at += 520;
				}
				Anim.tween('spine', 'rot', 0, 500, 'io', at);
				Anim.tween('head', 'rot', 0, 500, 'io', at);
				Anim.tween('pupilL', 'x', 0, 500, 'io', at);
				Anim.tween('pupilR', 'x', 0, 500, 'io', at);
				Actions.lids(0.35, 500, 'io', at);
				return at + 600;
			}, 3200);
        },

		/* A deliberate stalk: crouch, wiggle, and launch */
		stalk: function (ctx) {
			return schedule(ctx, function () {
				Actions.silhouette('crouch', 600);
				Anim.tween('body', 'sy', 0.85, 600, 'io');
				Anim.tween('head', 'y', 6, 600, 'io');
				Anim.tween('earL', 'rot', -9, 500, 'io');
				Anim.tween('earR', 'rot', -9, 500, 'io');
				Anim.tween('tail', 'rot', -20, 600, 'io');
				for (var i = 0; i < 4; i++) Anim.tween('spine', 'rot', i % 2 ? 3 : -3, 170, 'io', 700 + i * 170);
				Anim.tween('spine', 'rot', 0, 200, 'io', 1400);
				return 1700;
			}, 1700);
		},

		pounce: function (ctx, dx) {
			var d = dx === undefined ? -9 : dx;
			return schedule(ctx, function () {
				Anim.tween('catRoot', 'y', -30, 320, 'out');
				Anim.tween('world', 'x', Math.max(0, Rig.get('world', 'x') + d), 640, 'io');
				Anim.tween('catRoot', 'y', 0, 340, 'in', 320);
				Actions.silhouette('normal', 500, 700);
				Anim.tween('body', 'sy', 1, 500, 'io', 700);
				Anim.tween('head', 'y', 0, 500, 'io', 700);
				return 1300;
			}, 1300);
		},

		/* Nudge a prop off the edge and watch it go. No remorse. */
		nudge: function (ctx, name) {
			var p = propOf(ctx, name);
			if (!p) return 0;
			var px = Rig.stagePx();
			T(ctx, 'pawFR', 'rot', -52, 400, 'out');
			T(ctx, 'head', 'rot', 12, 400, 'io');
			T(ctx, 'pawFR', 'rot', -18, 260, 'in', 500);
			T(ctx, p.id, 'x', px.w * 0.09, 300, 'out', 620);
			T(ctx, p.id, 'y', px.h * 0.3, 900, 'in', 900);
			T(ctx, p.id, 'rot', 220, 900, 'lin', 900);
			T(ctx, p.id, 'o', 0, 300, 'io', 1600);
			T(ctx, 'pawFR', 'rot', 0, 500, 'io', 1000);
			/* she watches it fall, then looks straight ahead, unbothered */
			T(ctx, 'head', 'rot', 18, 600, 'io', 900);
			T(ctx, 'head', 'y', 6, 600, 'io', 900);
			T(ctx, 'head', 'rot', 0, 700, 'io', 1900);
			T(ctx, 'head', 'y', 0, 700, 'io', 1900);
			return 2700;
		},

		/* ---------------- clothes ---------------- */

		wear:    function (ctx, g) { return schedule(ctx, function () { Wardrobe.wear(g, 500); return 560; }, 560); },
		outfit:  function (ctx, n) { return schedule(ctx, function () { Wardrobe.set(n); return 560; }, 560); },
		undress: function (ctx) { return schedule(ctx, function () { Wardrobe.bare(); return 400; }, 400); },
		hold:    function (ctx, g) { return schedule(ctx, function () { Wardrobe.hold(g, 500); return 560; }, 560); }
	};

	/* Some beats have to be invoked when their moment arrives rather than up
	 * front, because the Actions they call issue tweens relative to now. */
	function schedule(ctx, fn, dur) {
		if (ctx.t <= 0) { try { fn(); } catch (e) {} return dur; }
		ctx.timers.push(setTimeout(function () {
			if (ctx.alive && !ctx.alive()) return;
			try { fn(); } catch (e) { if (typeof Guard !== 'undefined') Guard.fault('beat', e); }
		}, ctx.t));
		return dur;
	}

	/* ---- the runner ---- */

	function play(list, alive) {
		var ctx = { t: 0, props: {}, timers: [], alive: alive };
		for (var i = 0; i < list.length; i++) {
			var beat = list[i];
			var verb = beat[0];
			var fn = VERBS[verb === 'throw' ? 'throwIt' : verb];
			if (!fn) continue;
			var arg = beat.length === 2 ? beat[1] : (beat.length > 2 ? beat.slice(1) : undefined);
			var dur = 0;
			try { dur = fn(ctx, arg) || 0; } catch (e) { if (typeof Guard !== 'undefined') Guard.fault('beat:' + verb, e); }
			ctx.t += dur;
		}
		return { duration: ctx.t, timers: ctx.timers };
	}

	return {
		play: play,
		verbs: function () { var k = [], n; for (n in VERBS) k.push(n === 'throwIt' ? 'throw' : n); return k; }
	};
})();
