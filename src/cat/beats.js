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
		if (ctx.live) { L(ctx, part, key, to, dur, ez, at); return; }
		Anim.tween(part, key, to, dur, ez, ctx.t + (at || 0));
	}

	/* A tween issued WHEN ITS MOMENT COMES, rather than up front with a delay.
	 *
	 * Anim.tween() reads the value it starts from at the moment it is called, not
	 * at the moment its delay runs out. Everything in a scene is issued during the
	 * build, at time zero, so a delayed tween starts from whatever the part was
	 * doing before the scene began - which is nearly always its rest value. Two
	 * moves of the same thing in a row therefore do not chain: the second one
	 * snaps back to rest and sets off again from there, and fading out a prop
	 * that was faded in after the build is a fade from zero to zero, which is a
	 * pop.
	 *
	 * Queued here and issued by a timer, the tween starts from where the part
	 * really is. Scenes opt in with `live: true`; the older ones are left exactly
	 * as they were, because they were tuned by eye against the old behaviour.
	 * The newer verbs further down always come this way, since most of them are
	 * chains.                                                                 */
	function L(ctx, part, key, to, dur, ez, at) {
		var when = ctx.t + (at || 0);
		if (when <= 0) { Anim.tween(part, key, to, dur, ez); return; }
		ctx.queue.push({ at: when, part: part, key: key, to: to, dur: dur, ez: ez });
	}

	/* one timer per distinct moment, not one per tween */
	function flushQueue(ctx) {
		var q = ctx.queue, groups = {}, order = [], i;
		for (i = 0; i < q.length; i++) {
			var k = Math.round(q[i].at);
			if (!groups[k]) { groups[k] = []; order.push(k); }
			groups[k].push(q[i]);
		}
		for (i = 0; i < order.length; i++) {
			(function (list, at) {
				ctx.timers.push(setTimeout(function () {
					if (ctx.alive && !ctx.alive()) return;
					try {
						for (var j = 0; j < list.length; j++) {
							Anim.tween(list[j].part, list[j].key, list[j].to, list[j].dur, list[j].ez);
						}
					} catch (e) { if (typeof Guard !== 'undefined') Guard.fault('beat', e); }
				}, at));
			})(groups[order[i]], order[i]);
		}
		ctx.queue = [];
	}

	function rnd(a, b) { return a + Math.random() * (b - a); }

	/* Where she will be standing when this beat runs. Beat bodies run during the
	 * build, before she has walked anywhere, so Rig.bounds() would answer for
	 * where she is now; the travel verbs keep ctx.catX up to date instead.    */
	function catBoxAt(ctx) {
		var b = Rig.bounds();
		return { x: ctx.catX, y: b.y, w: b.w, h: b.h };
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
			/* measured from where she WILL be, once an earlier beat has moved her.
			 * Only for scenes that opt in: the old ones keep their timing. */
			if (ctx.live) from = ctx.catX;
			if (Math.abs(target - from) < 1) return 0;
			ctx.catX = target;
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
				var down = function (d) {
					Anim.tween('head', 'rot', 0, 640, 'io', d);
					Anim.tween('pawFR', 'rot', 0, 760, 'io', d + 140);
					if (p) {
						Anim.tween(p.id, 'x', 0, 780, 'io', d + 140);
						Anim.tween(p.id, 'y', 0, 780, 'io', d + 140);
					}
				};
				/* live scenes lower it from her mouth; see the same thing in `sip` */
				if (ctx.live) after(ctx, at + 100, function () { down(0); }); else down(at + 100);
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
			ctx.made.push(id);
			/* ['prop', ..., aspect, 'hidden'] puts it in place without showing it,
			 * for something that has to appear at an exact moment later on - a
			 * scarf that slips, a spark. `propFade` brings it in.               */
			if (a[7] === 'hidden') return 0;
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
			var ez = a[4] || 'io';              /* optional: 'in' falls, 'out' lands */
			T(ctx, p.id, 'x', (a[1] - p.x) / 100 * px.w, ms, ez);
			T(ctx, p.id, 'y', (a[2] - p.y) / 100 * px.h, ms, ez);
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
				/* the way back down. In a live scene it is issued when its moment
				 * comes, so the mug is lowered from her mouth rather than snapping
				 * to the table - see L() */
				var down = function (d) {
					Anim.tween(p.id, 'x', 0, 700, 'io', d);
					Anim.tween(p.id, 'y', 0, 700, 'io', d);
					Anim.tween('pawFR', 'rot', 0, 700, 'io', d);
				};
				if (ctx.live) after(ctx, 1700, function () { down(0); }); else down(1700);
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
			ctx.catX = a[0];
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
			ctx.catX = Math.max(0, ctx.catX + d);
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
		hold:    function (ctx, g) { return schedule(ctx, function () { Wardrobe.hold(g, 500); return 560; }, 560); },

		/* ['unwear', 'neck'] - take one slot off and leave the rest alone, for a
		 * scarf that slips or a hat that gets knocked off. Cat.play re-dresses her
		 * for the real weather when the scene ends.                             */
		unwear:  function (ctx, slot) { return schedule(ctx, function () { Wardrobe.remove(slot); return 340; }, 340); },

		/* ================================================================ *
		 *  The winter vocabulary. Everything from here down issues its     *
		 *  tweens through L(), so it chains properly in any scene.         *
		 * ================================================================ */

		/* ---------------- small things she does ---------------- */

		tilt:       function (ctx) { return schedule(ctx, Actions.headTilt, 2900); },
		lookAround: function (ctx) { return schedule(ctx, Actions.lookAround, 3700); },
		earTwitch:  function (ctx) { return schedule(ctx, Actions.earTwitch, 440); },
		tailFlick:  function (ctx) { return schedule(ctx, Actions.tailFlick, 820); },
		eyesShut:   function (ctx) { return schedule(ctx, function () { Actions.eyesShut(300); return 340; }, 340); },
		eyesOpen:   function (ctx) { return schedule(ctx, function () { Actions.eyesOpen(300); return 340; }, 340); },

		/* Properly lying down: the wide low mound, head sunk into it, feet tucked.
		 * `curl` is the sitting ball; this is the one for a nap by the radiator. */
		lieDown: function (ctx) { return schedule(ctx, Actions.sleep, 1150); },

		/* Back on her feet from ANY lying or curled pose, with everything those
		 * poses tucked away put back. Actions.wake() cannot be used for this: it
		 * marks her as standing before it calls stand(), which then sees nothing
		 * to do and leaves her in the sleeping silhouette.                     */
		getUp: function (ctx) {
			return schedule(ctx, function () {
				Actions.setPosture('SLEEP');
				Actions.eyesOpen(400);
				Actions.stand();
				Anim.tween('neck', 'y', 0, 600, 'io');
				Anim.tween('footL', 'y', 0, 500, 'io');
				Anim.tween('footR', 'y', 0, 500, 'io');
				Anim.poke('footL', 'o', 1, 0);
				Anim.poke('footR', 'o', 1, 0);
				Anim.tween('tail2', 'rot', 0, 700, 'io');
				Anim.tween('tail3', 'rot', 0, 700, 'io');
				Anim.tween('earL', 'rot', 0, 500, 'io');
				Anim.tween('earR', 'rot', 0, 500, 'io');
				Anim.tween('whiskerL', 'rot', 0, 500, 'io');
				Anim.tween('whiskerR', 'rot', 0, 500, 'io');
				Anim.tween('spine', 'rot', 0, 500, 'io');
				return 760;
			}, 760);
		},

		/* A quick swipe at something in the air: the paw, and a lean into it. */
		bat: function (ctx, which) {
			var paw = which === 'L' ? 'pawFL' : 'pawFR';
			var s = which === 'L' ? -1 : 1;
			L(ctx, paw, 'rot', -58, 220, 'out', 0);
			L(ctx, 'spine', 'rot', s * 3, 260, 'out', 0);
			L(ctx, paw, 'rot', 0, 360, 'io', 240);
			L(ctx, 'spine', 'rot', 0, 360, 'io', 260);
			return 640;
		},

		/* ['pawTap', 'L'|'R', n] - patting something: snow into shape, ice, a lid */
		pawTap: function (ctx, a) {
			var which = (a instanceof Array ? a[0] : a) === 'L' ? 'pawFL' : 'pawFR';
			var n = (a instanceof Array ? a[1] : 0) || 3, at = 280, i;
			L(ctx, which, 'rot', -46, 260, 'out', 0);
			for (i = 0; i < n; i++) {
				L(ctx, which, 'rot', -28, 150, 'in', at);
				L(ctx, which, 'rot', -46, 170, 'out', at + 150);
				at += 320;
			}
			L(ctx, which, 'rot', 0, 380, 'io', at);
			return at + 420;
		},

		/* A paw held up and flicked dry - what a cat does about slush. */
		shakePaw: function (ctx, which) {
			var paw = which === 'L' ? 'pawFL' : 'pawFR', at = 320, i;
			L(ctx, paw, 'rot', -56, 300, 'out', 0);
			for (i = 0; i < 6; i++) {
				L(ctx, paw, 'rot', i % 2 ? -44 : -68, 90, 'lin', at);
				at += 90;
			}
			L(ctx, paw, 'rot', 0, 420, 'io', at + 60);
			return at + 500;
		},

		/* Sniffing the air: the head lifts, the nose and whiskers work. */
		sniff: function (ctx) {
			var at = 320, i;
			L(ctx, 'head', 'y', -4, 300, 'out', 0);
			for (i = 0; i < 3; i++) {
				L(ctx, 'nose', 'sy', 1.3, 120, 'out', at);
				L(ctx, 'nose', 'sx', 1.15, 120, 'out', at);
				L(ctx, 'whiskerL', 'rot', -6, 120, 'out', at);
				L(ctx, 'whiskerR', 'rot', -6, 120, 'out', at);
				L(ctx, 'head', 'y', -5.5, 120, 'out', at);
				L(ctx, 'nose', 'sy', 1, 150, 'io', at + 130);
				L(ctx, 'nose', 'sx', 1, 150, 'io', at + 130);
				L(ctx, 'whiskerL', 'rot', 0, 150, 'io', at + 130);
				L(ctx, 'whiskerR', 'rot', 0, 150, 'io', at + 130);
				L(ctx, 'head', 'y', -4, 150, 'io', at + 130);
				at += 300;
			}
			L(ctx, 'head', 'y', 0, 400, 'io', at);
			return at + 420;
		},

		/* The chatter a cat makes at a bird it cannot reach: a fast small jaw. */
		chatter: function (ctx, n) {
			var k = n || 8, at = 160, i;
			scheduleAt(ctx, 0, function () { Actions.mouth('small', 140); });
			L(ctx, 'earL', 'rot', -11, 220, 'out', 0);
			L(ctx, 'earR', 'rot', -11, 220, 'out', 30);
			for (i = 0; i < k; i++) {
				L(ctx, 'jaw', 'y', i % 2 ? 0.3 : 2.3, 90, 'io', at);
				at += 90;
			}
			L(ctx, 'jaw', 'y', 0, 140, 'io', at);
			scheduleAt(ctx, at, function () { Actions.mouth('closed', 180); });
			return at + 240;
		},

		/* ['crossEyes', 1 | 0] - both pupils to the nose, for something sitting on it */
		crossEyes: function (ctx, on) {
			var v = on === undefined ? 1 : on;
			L(ctx, 'pupilL', 'x', 2.6 * v, 380, 'io', 0);
			L(ctx, 'pupilR', 'x', -2.6 * v, 380, 'io', 0);
			return 420;
		},

		tailSwish: function (ctx, n) {
			var k = n || 4, at = 0, i;
			for (i = 0; i < k; i++) {
				L(ctx, 'tail', 'rot', i % 2 ? 16 : -24, 280, 'io', at);
				at += 280;
			}
			L(ctx, 'tail', 'rot', 0, 320, 'io', at);
			return at + 340;
		},

		/* ['rub', dir, n] - rubbing her cheek against something warm or friendly */
		rub: function (ctx, a) {
			var dir = (a instanceof Array ? a[0] : a) < 0 ? -1 : 1;
			var n = (a instanceof Array ? a[1] : 0) || 2, at = 0, i;
			scheduleAt(ctx, 0, function () { Actions.lids(0.75, 350); });
			for (i = 0; i < n; i++) {
				L(ctx, 'head', 'rot', dir * 15, 380, 'io', at);
				L(ctx, 'head', 'x', dir * 5, 380, 'io', at);
				L(ctx, 'head', 'rot', dir * 5, 340, 'io', at + 380);
				L(ctx, 'head', 'x', dir * 1.5, 340, 'io', at + 380);
				at += 720;
			}
			L(ctx, 'head', 'rot', 0, 420, 'io', at);
			L(ctx, 'head', 'x', 0, 420, 'io', at);
			scheduleAt(ctx, at, function () { Actions.lids(0, 350, 'out'); });
			return at + 460;
		},

		/* A shudder that can be seen across a room: the whole cat, three times
		 * the distance of Actions.shiver, in steps slow enough to land on their
		 * own frames - and vibration marks either side, because a few pixels of
		 * shake alone does not read.                                           */
		shiver: function (ctx, bouts) {
			var n = bouts || 2, b = catBoxAt(ctx), bout, i, f;
			var mL = Props.put('shiverMark', b.x - 6, b.y + b.h * 0.28, 8, 9);
			var mR = Props.put('shiverMark', b.x + b.w - 2, b.y + b.h * 0.28, 8, 9);
			ctx.made.push(mL); ctx.made.push(mR);
			Rig.set(mR, 'sx', -1);                   /* mirrored: both point outwards */
			for (bout = 0; bout < n; bout++) {
				var d = bout * 1150;
				for (i = 0; i < 7; i++) {
					var sgn = i % 2 ? 1 : -1;
					L(ctx, 'spine', 'x', sgn * 3.4, 100, 'lin', d + i * 100);
					L(ctx, 'catRoot', 'x', sgn * -1.6, 100, 'lin', d + i * 100);
					L(ctx, 'body', 'rot', sgn * 1.6, 100, 'lin', d + i * 100);
				}
				L(ctx, 'spine', 'x', 0, 160, 'io', d + 700);
				L(ctx, 'catRoot', 'x', 0, 160, 'io', d + 700);
				L(ctx, 'body', 'rot', 0, 200, 'io', d + 700);
				for (f = 0; f < 3; f++) {
					L(ctx, mL, 'o', 0.95, 60, 'lin', d + f * 220);
					L(ctx, mL, 'o', 0.15, 120, 'lin', d + f * 220 + 90);
					L(ctx, mR, 'o', 0.95, 60, 'lin', d + 60 + f * 220);
					L(ctx, mR, 'o', 0.15, 120, 'lin', d + 60 + f * 220 + 90);
				}
				L(ctx, mL, 'o', 0, 220, 'io', d + 760);
				L(ctx, mR, 'o', 0, 220, 'io', d + 820);
			}
			return n * 1150;
		},

		/* ['breath', dir] - one puff of breath in cold air, from her mouth. It
		 * drifts off and thins out by itself; nothing to clean up.             */
		breath: function (ctx, dir) {
			var d = dir < 0 ? -1 : 1, px = Rig.stagePx();
			var w = 14;
			var id = Props.put('breathPuff', 0, 80, w, 9);
			ctx.made.push(id);
			if (d < 0) Rig.set(id, 'sx', -1);
			/* placed when it happens, not when the scene is built: her mouth is
			 * lower when she is sitting and lower still curled up, and only the
			 * moment itself knows which she is                                 */
			scheduleAt(ctx, 0, function () {
				var b = Rig.bounds(), pose = Actions.posture();
				var drop = pose === 'SIT' ? 0.07 : (pose === 'CURL' ? 0.12 : (pose === 'SLEEP' ? 0.25 : 0));
				/* it starts at the side of her muzzle, not over it: white breath
				 * in front of a white face is not there at all */
				Props.anchor(id, b.x + b.w * 0.5 + (d > 0 ? 5 : -w - 5), b.y + b.h * (0.3 + drop) - 2.6);
			});
			L(ctx, id, 'o', 1, 220, 'out', 20);
			L(ctx, id, 'x', d * 0.13 * px.w, 2300, 'out', 20);
			L(ctx, id, 'y', -0.014 * px.h, 2300, 'out', 20);
			L(ctx, id, 'sx', d * 1.5, 2300, 'out', 20);
			L(ctx, id, 'sy', 1.5, 2300, 'out', 20);
			L(ctx, id, 'o', 0, 1100, 'io', 1200);
			return 900;
		},

		/* ---------------- travel ---------------- */

		/* ['slide', toX, ms] - across ice: no steps, just momentum, leaning back
		 * with the front paws out for balance.                                 */
		slide: function (ctx, a) {
			var span = 100 - Rig.size.w;
			var to = Math.max(0, Math.min(span, a instanceof Array ? a[0] : a));
			var ms = (a instanceof Array ? a[1] : 0) || 1000;
			var dir = to >= ctx.catX ? 1 : -1;
			ctx.catX = to;
			/* she faces the way she is going, unless she is being pushed:
			 * ['slide', x, ms, 'keep'] leaves her facing as she was */
			if (!(a instanceof Array) || a[2] !== 'keep') {
				scheduleAt(ctx, 0, function () { Rig.face(dir); });
			}
			L(ctx, 'world', 'x', to, ms, 'out', 0);
			L(ctx, 'spine', 'rot', dir * -9, 220, 'out', 0);
			L(ctx, 'pawFL', 'rot', -50, 220, 'out', 0);
			L(ctx, 'pawFR', 'rot', -50, 220, 'out', 0);
			L(ctx, 'tail', 'rot', dir * -28, 240, 'out', 0);
			L(ctx, 'spine', 'rot', dir * 6, 320, 'io', ms * 0.62);
			L(ctx, 'spine', 'rot', 0, 320, 'io', ms);
			L(ctx, 'pawFL', 'rot', 0, 400, 'io', ms);
			L(ctx, 'pawFR', 'rot', 0, 400, 'io', ms);
			L(ctx, 'tail', 'rot', 0, 460, 'io', ms);
			return ms + 480;
		},

		/* ['sink', dyPct, ms] - down through the floor line by that much, or back
		 * up with 0. The stage clips at its bottom edge, so this is how she
		 * disappears into a snowdrift.                                         */
		sink: function (ctx, a) {
			var dy = a instanceof Array ? a[0] : (a || 0);
			var ms = (a instanceof Array ? a[1] : 0) || 600;
			if (ctx.floorY === undefined) ctx.floorY = Rig.get('world', 'y');
			L(ctx, 'world', 'y', ctx.floorY + dy, ms, 'io', 0);
			return ms + 40;
		},

		/* ['angel', n] - limbs sweeping out and in. After a `sprawl` in the snow
		 * this is a snow angel; nothing else in the rig can say that head-on.  */
		angel: function (ctx, n) {
			var k = n || 3, at = 0, i;
			for (i = 0; i < k; i++) {
				L(ctx, 'pawFL', 'rot', -64, 430, 'io', at);
				L(ctx, 'pawFR', 'rot', -64, 430, 'io', at);
				L(ctx, 'footL', 'rot', -36, 430, 'io', at);
				L(ctx, 'footR', 'rot', 36, 430, 'io', at);
				L(ctx, 'pawFL', 'rot', -6, 430, 'io', at + 450);
				L(ctx, 'pawFR', 'rot', -6, 430, 'io', at + 450);
				L(ctx, 'footL', 'rot', -10, 430, 'io', at + 450);
				L(ctx, 'footR', 'rot', 10, 430, 'io', at + 450);
				at += 900;
			}
			return at + 60;
		},

		/* ---------------- jumps and turns ---------------- */

		/* ['jump', height] - straight up and down with a proper arc and a squash
		 * on landing. `hop` is the older one; its descent is a single frame.   */
		jump: function (ctx, h) {
			var up = h || 16;
			L(ctx, 'body', 'sy', 0.86, 130, 'out', 0);
			L(ctx, 'catRoot', 'y', -up, 230, 'out', 130);
			L(ctx, 'body', 'sy', 1.06, 200, 'out', 130);
			L(ctx, 'tail', 'rot', -22, 230, 'out', 130);
			L(ctx, 'catRoot', 'y', 0, 230, 'in', 370);
			L(ctx, 'body', 'sy', 0.92, 110, 'out', 600);
			L(ctx, 'body', 'sy', 1, 220, 'io', 710);
			L(ctx, 'tail', 'rot', 0, 300, 'io', 600);
			return 940;
		},

		/* ['leap', dxPct, height] - a jump that goes somewhere. Comes out of a
		 * `stalk` crouch cleanly, and lands with a squash.                     */
		leap: function (ctx, a) {
			var dx = a instanceof Array ? a[0] : (a === undefined ? -9 : a);
			var up = (a instanceof Array ? a[1] : 0) || 28;
			var span = 100 - Rig.size.w;
			var to = Math.max(0, Math.min(span, ctx.catX + dx));
			ctx.catX = to;
			scheduleAt(ctx, 0, function () { Rig.face(dx < 0 ? -1 : 1); });
			L(ctx, 'catRoot', 'y', -up, 330, 'out', 0);
			L(ctx, 'world', 'x', to, 660, 'io', 0);
			L(ctx, 'pawFL', 'rot', -50, 260, 'out', 0);
			L(ctx, 'pawFR', 'rot', -50, 260, 'out', 0);
			L(ctx, 'catRoot', 'y', 0, 330, 'in', 330);
			scheduleAt(ctx, 600, function () { Actions.silhouette('normal', 380); });
			L(ctx, 'body', 'sy', 0.88, 110, 'out', 660);
			L(ctx, 'body', 'sy', 1, 300, 'io', 780);
			L(ctx, 'head', 'y', 0, 400, 'io', 660);
			L(ctx, 'pawFL', 'rot', 0, 360, 'io', 660);
			L(ctx, 'pawFR', 'rot', 0, 360, 'io', 660);
			return 1120;
		},

		/* ['twirl', n] - spinning on the spot, n full turns. Head-on, a turn is a
		 * mirror flip with a lean into it, so this is what joy looks like here. */
		twirl: function (ctx, n) {
			var k = (n || 2) * 2, step = 300, at = 0, i;
			for (i = 0; i < k; i++) {
				L(ctx, 'world', 'face', i % 2 ? 1 : -1, 1, 'lin', at);
				L(ctx, 'spine', 'rot', i % 2 ? 8 : -8, step, 'io', at);
				L(ctx, 'tail', 'rot', i % 2 ? -30 : 30, step, 'io', at);
				L(ctx, 'catRoot', 'y', -5, step * 0.5, 'out', at);
				L(ctx, 'catRoot', 'y', 0, step * 0.5, 'in', at + step * 0.5);
				at += step;
			}
			L(ctx, 'spine', 'rot', 0, 360, 'io', at);
			L(ctx, 'tail', 'rot', 0, 420, 'io', at);
			return at + 440;
		},

		/* ['wriggle', n] - squirming on the spot: rolling in snow, fighting yarn */
		wriggle: function (ctx, n) {
			var k = (n || 3) * 2, at = 0, i;
			for (i = 0; i < k; i++) {
				var s = i % 2 ? 1 : -1;
				L(ctx, 'spine', 'rot', s * 8, 190, 'io', at);
				L(ctx, 'catRoot', 'x', s * 4, 190, 'io', at);
				L(ctx, 'tail', 'rot', s * -24, 190, 'io', at);
				L(ctx, 'head', 'rot', s * -7, 190, 'io', at);
				at += 190;
			}
			L(ctx, 'spine', 'rot', 0, 260, 'io', at);
			L(ctx, 'catRoot', 'x', 0, 260, 'io', at);
			L(ctx, 'tail', 'rot', 0, 320, 'io', at);
			L(ctx, 'head', 'rot', 0, 260, 'io', at);
			return at + 340;
		},

		/* ---------------- pose ---------------- */

		/* ['pose', part, key, value, ms, ease] - one rig value, by name. The
		 * escape hatch for the detail no verb covers: a sigh is body.sy, fur on
		 * end is body.sx, a lifted chin is head.y. Takes no time on the cursor
		 * unless the scene waits for it, so several can be set together.       */
		pose: function (ctx, a) {
			L(ctx, a[0], a[1], a[2], a[3] || 400, a[4] || 'io', 0);
			return 0;
		},

		/* Everything a mood or a look leaves behind, put back: ears, tail, lids,
		 * mouth, head, eyes. Scenes use it between one idea and the next.      */
		relax: function (ctx) {
			scheduleAt(ctx, 0, function () {
				Actions.lids(0, 400, 'out');
				Actions.mouth('closed', 300);
			});
			L(ctx, 'earL', 'rot', 0, 450, 'io', 0);
			L(ctx, 'earR', 'rot', 0, 450, 'io', 40);
			L(ctx, 'tail', 'rot', 0, 500, 'io', 0);
			L(ctx, 'head', 'rot', 0, 500, 'io', 0);
			L(ctx, 'head', 'y', 0, 500, 'io', 0);
			L(ctx, 'head', 'x', 0, 500, 'io', 0);
			L(ctx, 'eyeL', 'sx', 1, 400, 'io', 0);
			L(ctx, 'eyeR', 'sx', 1, 400, 'io', 0);
			L(ctx, 'pupilL', 'x', 0, 400, 'io', 0);
			L(ctx, 'pupilR', 'x', 0, 400, 'io', 0);
			L(ctx, 'spine', 'rot', 0, 500, 'io', 0);
			return 540;
		},

		/* ---------------- more that props can do ---------------- */

		/* ['propHome', name, ms, ease] - back to where it was first put */
		propHome: function (ctx, a) {
			var name = a instanceof Array ? a[0] : a;
			var p = propOf(ctx, name);
			if (!p) return 0;
			var ms = (a instanceof Array ? a[1] : 0) || 600;
			var ez = (a instanceof Array ? a[2] : 0) || 'io';
			L(ctx, p.id, 'x', 0, ms, ez, 0);
			L(ctx, p.id, 'y', 0, ms, ez, 0);
			return ms + 40;
		},

		/* ['propToCat', name, fx, fy, ms, ease] - move a prop so its centre lands
		 * on a point of her: (0.5, 0.28) is her nose, (0.5, 0.06) the top of her
		 * head. Measured from where she will be standing by then.              */
		propToCat: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var b = catBoxAt(ctx), px = Rig.stagePx();
			var ms = a[3] || 700, ez = a[4] || 'io';
			var x = b.x + b.w * a[1] - p.w / 2;
			var y = b.y + b.h * a[2] - propHeight(p.w, p.aspect) / 2;
			L(ctx, p.id, 'x', (x - p.x) / 100 * px.w, ms, ez, 0);
			L(ctx, p.id, 'y', (y - p.y) / 100 * px.h, ms, ez, 0);
			return ms + 40;
		},

		/* ['propOn', name, art, fx, fy, w, z, aspect] - a prop centred on a point
		 * of HER: fx and fy are fractions of her box, measured from where she will
		 * be standing at this point in the scene. For things that have to register
		 * with her body - snow on her head, a blanket over her - where a number
		 * typed in stage percent would be right on one screen and wrong on the
		 * next.                                                                */
		propOn: function (ctx, a) {
			var b = catBoxAt(ctx), w = a[4];
			var h = propHeight(w, a[6]);
			var x = b.x + b.w * a[2] - w / 2;
			var y = b.y + b.h * a[3] - h / 2;
			return VERBS.prop(ctx, [a[0], a[1], x, y, w, a[5], a[6], a[7]]);
		},

		/* ['propFade', name, opacity, ms] */
		propFade: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var ms = a[2] || 500;
			L(ctx, p.id, 'o', a[1], ms, 'io', 0);
			return ms + 40;
		},

		/* ['propScale', name, sx, sy, ms, ease] - about the prop's own centre */
		propScale: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var ms = a[3] || 500;
			L(ctx, p.id, 'sx', a[1], ms, a[4] || 'io', 0);
			L(ctx, p.id, 'sy', a[2] === undefined ? a[1] : a[2], ms, a[4] || 'io', 0);
			return ms + 40;
		},

		/* ['fall', name, toYPct, ms, ease] - vertical only, so it can be combined
		 * with `sway`: a flake that comes down wandering rather than on rails.  */
		fall: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var ms = a[2] || 1200;
			L(ctx, p.id, 'y', (a[1] - p.y) / 100 * Rig.stagePx().h, ms, a[3] || 'in', 0);
			return ms + 40;
		},

		/* ['sway', name, ampPct, n, ms] - n sideways wanders around where it was put */
		sway: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var amp = a[1] / 100 * Rig.stagePx().w, n = a[2] || 3, ms = a[3] || 3000;
			var step = ms / n, i;
			for (i = 0; i < n; i++) {
				L(ctx, p.id, 'x', (i % 2 ? -1 : 1) * amp * (i === n - 1 ? 0 : 1), step, 'io', i * step);
			}
			return ms;
		},

		/* ['wiggle', name, deg, n, stepMs] - rocks a prop and brings it back level */
		wiggle: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var deg = a[1] || 8, n = a[2] || 4, step = a[3] || 140, i;
			for (i = 0; i < n; i++) L(ctx, p.id, 'rot', (i % 2 ? -1 : 1) * deg, step, 'io', i * step);
			L(ctx, p.id, 'rot', 0, step, 'io', n * step);
			return (n + 1) * step;
		},

		/* ['hopProp', name, toXPct, n, hopMs] - a small thing hopping along the
		 * ground to a new spot, the way a bird crosses snow.                   */
		hopProp: function (ctx, a) {
			var p = propOf(ctx, a[0]);
			if (!p) return 0;
			var px = Rig.stagePx();
			var n = a[2] || 3, ms = a[3] || 260, i;
			var from = p.hopX === undefined ? p.x : p.hopX;
			for (i = 0; i < n; i++) {
				var x = from + (a[1] - from) * (i + 1) / n;
				var at = i * (ms + 90);
				L(ctx, p.id, 'x', (x - p.x) / 100 * px.w, ms, 'lin', at);
				L(ctx, p.id, 'y', -0.022 * px.h, ms * 0.5, 'out', at);
				L(ctx, p.id, 'y', 0, ms * 0.5, 'in', at + ms * 0.5);
			}
			p.hopX = a[1];
			return n * (ms + 90);
		},

		/* ['trail', art, x0, x1, y, n, w, stepMs, holdMs, z] - a row of the same
		 * thing appearing one after another and fading again by itself: paw
		 * prints in fresh snow. Returns no length, so it runs under a walk.    */
		trail: function (ctx, a) {
			var n = Math.max(2, Math.min(10, a[4] || 5));
			var step = a[6] || 300, hold = a[7] || 4000;
			var z = a[8] === undefined ? 4 : a[8], i;
			for (i = 0; i < n; i++) {
				var x = a[1] + (a[2] - a[1]) * i / (n - 1);
				var id = Props.put(a[0], x, a[3] + (i % 2 ? 1.1 : 0), a[5] || 5, z);
				ctx.made.push(id);
				L(ctx, id, 'o', 0.9, 260, 'io', i * step);
				L(ctx, id, 'o', 0, 700, 'io', n * step + hold + i * 140);
			}
			return 0;
		},

		/* ['gust', n, ms] - snow driven sideways: up to six flakes streaking across
		 * the lower band from the right, each gone again when it reaches the far
		 * side. Reports no length, like the snowfall.                          */
		gust: function (ctx, a) {
			var n = Math.max(1, Math.min(6, (a instanceof Array ? a[0] : a) || 4));
			var ms = (a instanceof Array ? a[1] : 0) || 1300;
			var px = Rig.stagePx(), i, at = 0;
			/* the same six nodes serve every gust in a scene: each one is sent
			 * back to the right-hand edge, unseen, before it is used again */
			if (!ctx.gusts) ctx.gusts = [];
			for (i = 0; i < n; i++) {
				var id = ctx.gusts[i];
				if (!id) {
					id = Props.put('flake', 101, rnd(64.5, 91), rnd(4, 6.5), 9);
					ctx.gusts[i] = id;
					ctx.made.push(id);
				} else {
					L(ctx, id, 'x', 0, 1, 'lin', at - 20);
					L(ctx, id, 'y', 0, 1, 'lin', at - 20);
					L(ctx, id, 'rot', 0, 1, 'lin', at - 20);
				}
				L(ctx, id, 'o', 0.95, 140, 'lin', at);
				L(ctx, id, 'x', -1.14 * px.w, ms, 'lin', at);
				L(ctx, id, 'y', rnd(0.02, 0.06) * px.h, ms, 'lin', at);
				L(ctx, id, 'rot', -rnd(300, 600), ms, 'lin', at);
				L(ctx, id, 'o', 0, 180, 'lin', at + ms - 190);
				at += rnd(90, 230);
			}
			return 0;
		},

		/* ['snowfall', n, ms, 'near'] - falling snow, bounded and self-clearing.
		 *
		 * At most ten flakes, each one a single pooled node that is sent round
		 * again when it reaches the bottom, so a long scene costs no more than a
		 * short one. Everything about a flake is drawn from a range - where it
		 * starts, how big, how fast, which way it spins and wanders - because a
		 * row of identical things falling together is not weather.
		 *
		 * The default layer is the one BEHIND the forecast, which is the only
		 * layer allowed above the 63% line: the clock draws over them, as it
		 * would over snow behind a window. 'near' puts them in front of her
		 * instead, and those stay in the lower band like any other prop.
		 *
		 * It reports no length - snow falls while other things happen - and every
		 * flake has faded out before `ms` is up. Leave `ms` out (or 0) and it
		 * snows until the scene ends, however long that turns out to be: the
		 * length of a scene depends on how far she had to walk to begin it, so a
		 * number typed here would be right from one starting place only.       */
		snowfall: function (ctx, a) {
			var n = a instanceof Array ? a[0] : a;
			var ms = (a instanceof Array ? a[1] : 0) || 0;
			var near = a instanceof Array && a[2] === 'near';
			n = Math.max(1, Math.min(10, n || 6));

			if (ms) { fall(ms); return 0; }
			var from = ctx.t;
			ctx.late.push(function (total) {
				var keep = ctx.t;
				ctx.t = from;
				fall(Math.max(2500, total - from - 300));
				ctx.t = keep;
			});
			return 0;

			function fall(ms) {
			var px = Rig.stagePx(), i;
			for (i = 0; i < n; i++) {
				var x0 = rnd(2, 92);
				var y0 = near ? rnd(63.5, 66) : rnd(-10, 4);
				var yEnd = near ? 97 : 104;
				var id = Props.put('flake', x0, y0, near ? rnd(4.5, 7) : rnd(3.5, 8), near ? 9 : 2);
				ctx.made.push(id);

				var at = rnd(0, Math.min(2400, ms * 0.25)) + i * 90;
				var first = true;
				for (;;) {
					var dur = near ? rnd(3000, 4400) : rnd(5200, 9000);
					if (at + dur > ms) {
						if (!first || ms - at < 2200) break;
						dur = ms - at;                 /* one short pass beats none */
					}
					var sway = rnd(3, 9) / 100 * px.w * (Math.random() < 0.5 ? -1 : 1);
					L(ctx, id, 'o', rnd(0.7, 1), 400, 'io', at);
					L(ctx, id, 'y', (yEnd - y0) / 100 * px.h, dur, 'lin', at);
					L(ctx, id, 'rot', rnd(-400, 400), dur, 'lin', at);
					L(ctx, id, 'x', sway, dur * 0.34, 'io', at);
					L(ctx, id, 'x', -sway * 0.8, dur * 0.33, 'io', at + dur * 0.34);
					L(ctx, id, 'x', sway * 0.4, dur * 0.32, 'io', at + dur * 0.67);
					L(ctx, id, 'o', 0, 560, 'io', at + dur - 600);
					/* back to the top, unseen, for the next pass */
					L(ctx, id, 'y', 0, 1, 'lin', at + dur + 10);
					L(ctx, id, 'x', 0, 1, 'lin', at + dur + 10);
					L(ctx, id, 'rot', 0, 1, 'lin', at + dur + 10);
					at += dur + rnd(250, 900);
					first = false;
				}
			}
			}
		}
	};

	/* run something at an offset from the cursor without moving the cursor */
	function scheduleAt(ctx, at, fn) {
		var keep = ctx.t;
		ctx.t = keep + at;
		schedule(ctx, fn, 0);
		ctx.t = keep;
	}

	/* a timer started while the scene is already running, cancelled with it */
	function after(ctx, ms, fn) {
		ctx.timers.push(setTimeout(function () {
			if (ctx.alive && !ctx.alive()) return;
			try { fn(); } catch (e) { if (typeof Guard !== 'undefined') Guard.fault('beat', e); }
		}, ms));
	}

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

	/* play(list, alive, opts)
	 *
	 * opts.live - issue every beat-level tween at its own moment, so moves chain
	 *             (see L above). The newer scenes set it; the old ones do not.
	 *
	 * ['also', verb, ...] runs a beat WITHOUT moving the cursor, so the next beat
	 * starts at the same moment. It is the one way to overlap two things - snow
	 * falling while she walks, a ball rolling while it grows - without writing a
	 * new verb for every pair.                                                 */
	function play(list, alive, opts) {
		var ctx = { t: 0, props: {}, timers: [], alive: alive, queue: [], made: [], late: [],
		            live: !!(opts && opts.live), catX: Rig.get('world', 'x') || 0 };
		for (var i = 0; i < list.length; i++) {
			var beat = list[i];
			var hold = false;
			if (beat[0] === 'also') { hold = true; beat = beat.slice(1); }
			var verb = beat[0];
			var fn = VERBS[verb === 'throw' ? 'throwIt' : verb];
			if (!fn) continue;
			var arg = beat.length === 2 ? beat[1] : (beat.length > 2 ? beat.slice(1) : undefined);
			var dur = 0;
			try { dur = fn(ctx, arg) || 0; } catch (e) { if (typeof Guard !== 'undefined') Guard.fault('beat:' + verb, e); }
			if (!hold) ctx.t += dur;
		}
		/* anything that had to wait to learn how long the scene is */
		for (i = 0; i < ctx.late.length; i++) {
			try { ctx.late[i](ctx.t); } catch (e2) { if (typeof Guard !== 'undefined') Guard.fault('beat:late', e2); }
		}
		flushQueue(ctx);
		return { duration: ctx.t, timers: ctx.timers, props: ctx.made };
	}

	return {
		play: play,
		verbs: function () { var k = [], n; for (n in VERBS) k.push(n === 'throwIt' ? 'throw' : n); return k; }
	};
})();
