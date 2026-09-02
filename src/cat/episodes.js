/* episodes.js - the things Lili does. Her life, on the forecast screen.
 *
 * NO TAKEOVER. Everything happens in place, at her normal size, with the clock
 * and the forecast still showing. She walks to where the action is, props appear
 * around her, and when she is done she goes back to pottering about. There is no
 * separate stage any more - this screen is where she lives.
 *
 * The one hard rule: props live below BAND, in the lower part of the screen. The
 * clock is the reason the phone is on the desk at all, so nothing covers it.
 *
 * Each entry declares:
 *   id      stable name, used by the test menu and by adb -e ep <id>
 *   label   what shows in the test menu
 *   dur     how long it runs, ms
 *   energy  low | mid | high - the time of day biases which get picked
 *   cond    (wx, date) -> is this weather/time right for it
 *   weight  base weight for the picker
 *   run     issues tweens and places props
 */

var Episodes = (function () {
	var A = null;
	var current = null;
	var endTimer = null;
	var onFinish = null;

	/* Props stay below this line. The clock and the temperature are the reason
	 * the phone is on the desk, so nothing goes near them; scenery also sits in
	 * the layer behind the forecast text, so numbers stay readable through it. */
	var BAND = 63;

	function T(part, key, to, dur, ez, delay, done) { Anim.tween(part, key, to, dur, ez, delay, done); }
	function fade(name, to, dur, delay) { Anim.tween(name, 'o', to, dur || 400, 'io', delay || 0); }
	function catBox() { return Rig.bounds(); }

	/* Walk her to a spot so the scene composes, instead of teleporting her. */
	function place(x) {
		var span = 100 - Rig.size.w;
		return A.waddle(Math.max(0, Math.min(span, x)));
	}

	/* Lift a held prop from where it rests up to her MOUTH.
	 *
	 * Guessing the offsets by eye is how the mug ended up on her forehead: the
	 * mouth is about 29% down her box, not level with her eyes, and the prop is
	 * anchored by its top-left corner, not its centre. So measure both.
	 *
	 *   rest   where the prop sits, in stage percent
	 *   wPct   its width in stage percent
	 *   aspect its artwork width / height
	 */
	function liftToMouth(name, restX, restY, wPct, aspect, dur, delay) {
		var b = Rig.bounds(), px = Rig.stagePx();
		var hPct = wPct * (px.w / px.h) / aspect;      /* height, in stage percent */
		var toX = b.x + b.w * 0.53 - wPct * 0.5;
		var toY = b.y + b.h * 0.295 - hPct * 0.2;      /* the rim, not the base */
		T(name, 'x', (toX - restX) / 100 * px.w, dur || 600, 'out', delay || 0);
		T(name, 'y', (toY - restY) / 100 * px.h, dur || 600, 'out', delay || 0);
	}

	function lowerProp(name, dur, delay) {
		T(name, 'x', 0, dur || 700, 'io', delay || 0);
		T(name, 'y', 0, dur || 700, 'io', delay || 0);
	}

	/* An unset window means "no window configured", so nothing matches. */
	function within(date, from, to) { return inClockWindow(date, from, to, false); }

	function isWorkday(date) {
		if (!cat_work_weekdays) return true;
		var d = date.getDay();
		return d >= 1 && d <= 5;
	}

	/* Point her attention at a prop, so she is not staring through it. */
	function watch(px, py, delay) {
		setTimeout(function () { if (current) Alive.lookAtStage(px, py); }, delay || 0);
	}

	/* ------------------------------------------------------------------ *
	 *  the catalogue                                                     *
	 * ------------------------------------------------------------------ */

	var LIST = [

	/* 1 - was too much head shaking: she chews with her JAW now, and the head
	 *     dips into the bowl once instead of bobbing on every bite.            */
	{ id: 'meal', label: 'Meal - the bowl', dur: 15000, weight: 6, energy: 'mid',
	  cond: function () { return true; },
	  bias: function (wx, date) { var h = date.getHours(); return (h >= 8 && h < 10) || (h >= 12 && h < 14) || (h >= 18 && h < 20) ? 3 : 1; },
	  run: function () {
		var c = catBox();
		var bx = Math.min(90, c.x + c.w * 0.85);

		/* THE BOWL COMES UP TO HER.
		 *
		 * It used to sit on the floor at y = 90 while her mouth is at about 81,
		 * and the only thing that moved was a 15 degree head dip - nowhere near
		 * eleven percent of the screen. So she leaned vaguely towards a bowl she
		 * never reached, and you could not see her drinking at all.
		 *
		 * She lifts it in her paws instead, the same way she lifts the mug in the
		 * tea break: liftToMouth() measures from Rig.bounds(), so the rim arrives
		 * at her actual mouth rather than at a guessed offset. And it is HELD -
		 * paws up, then down with it - because a bowl rising on its own is the
		 * floating-mug problem all over again.                                   */
		var REST_Y = 88;
		var ASPECT = 100 / 60;
		var bowl = Props.put('bowl', bx, REST_Y, 15, 9);
		fade(bowl, 1, 450);
		watch(bx + 7, REST_Y + 2, 300);

		A.stand();
		var walk = place(Math.max(0, bx - c.w * 0.7));

		/* the lift has to be measured after the walk, or it aims at where she
		 * was standing a second ago */
		var lift = walk + 260;
		setTimeout(function () {
			if (current) liftToMouth(bowl, bx, REST_Y, 15, ASPECT, 560);
		}, lift);

		/* paws up to meet it, and a small dip to close the last of the gap */
		T('pawFR', 'rot', -62, 520, 'out', lift);
		T('pawFL', 'rot', -34, 560, 'out', lift + 60);
		T('head', 'rot', 6, 620, 'io', lift);
		T('head', 'y', 3, 620, 'io', lift);
		A.lids(0.45, 500, 'io', lift + 200);

		var d = lift + 900;
		for (var i = 0; i < 7; i++) {
			T('jaw', 'y', i % 2 ? 2.4 : 0.2, 170, 'io', d);
			T('cheekL', 'sx', i % 2 ? 1.09 : 1, 170, 'io', d);
			T('cheekR', 'sx', i % 2 ? 1.09 : 1, 170, 'io', d);
			d += 170;
		}
		A.mouth('closed', 200, d);
		T('jaw', 'y', 0, 220, 'io', d);

		/* down again, still held, and set back on the floor */
		lowerProp(bowl, 620, d + 200);
		T('pawFR', 'rot', 0, 640, 'io', d + 240);
		T('pawFL', 'rot', 0, 640, 'io', d + 200);
		T('head', 'rot', 0, 600, 'io', d + 300);
		T('head', 'y', 0, 600, 'io', d + 300);
		A.lids(0, 400, 'out', d + 400);

		/* and a lick of the lips afterwards */
		T('pawFR', 'rot', -70, 420, 'out', d + 1100);
		A.mouth('smile', 300, d + 1200);
		T('pawFR', 'rot', 0, 480, 'io', d + 2100);
		A.mouth('closed', 300, d + 2200);
		fade(bowl, 0, 600, d + 2600);
	  } },

	{ id: 'reading', label: 'Reading a book', dur: 18000, weight: 5, energy: 'low',
	  cond: function () { return true; },
	  bias: function (wx, date) {
		var w = 1;
		if (date.getHours() >= 19) w *= 2;
		if (wx && wx.sky === 'ovc') w *= 2;
		return w;
	  },
	  run: function () {
		var c = catBox();
		/* 84, not 88: at 88 the book sat down on her belly. It is 9.75% of the
		 * stage tall, so this lifts it to just under her muzzle - held up to
		 * read - without ever reaching her face. */
		var book = Props.put('book', c.x + c.w * 0.16, 84, 26, 9);
		fade(book, 1, 500, 300);
		A.sit();
		T('head', 'rot', 11, 700, 'io', 700);
		T('head', 'y', 4, 700, 'io', 700);

		/* the eyes do the reading; the head barely moves */
		var d = 1500;
		for (var line = 0; line < 5; line++) {
			T('pupilL', 'x', -2.6, 260, 'out', d);
			T('pupilR', 'x', -2.6, 260, 'out', d);
			T('pupilL', 'x', 2.6, 1500, 'lin', d + 300);
			T('pupilR', 'x', 2.6, 1500, 'lin', d + 300);
			if (line === 2) {
				T('pawFR', 'rot', -30, 280, 'out', d + 1900);
				T(book, 'sx', 0.95, 260, 'io', d + 2000);
				T(book, 'sx', 1, 380, 'out', d + 2260);
				T('pawFR', 'rot', 0, 380, 'io', d + 2260);
			}
			d += 2300;
		}
		T('pupilL', 'x', 0, 400, 'io', d);
		T('pupilR', 'x', 0, 400, 'io', d);
		setTimeout(function () { if (current) A.yawn(); }, d + 300);
		fade(book, 0, 700, d + 2200);
		T('head', 'rot', 0, 700, 'io', d + 2300);
		T('head', 'y', 0, 700, 'io', d + 2300);
	  } },

	{ id: 'rainy_window', label: 'Sad at the rainy window', dur: 18000, weight: 8, energy: 'low',
	  cond: function (wx) { return !!wx && (wx.precip === 'ra' || wx.precip === 'ra_sn'); },
	  run: function () {
		var win = Props.put('window', 5, BAND + 2, 22, 4);
		fade(win, 1, 700);

		var drops = [], i;
		for (i = 0; i < 4; i++) drops.push(Props.put('drop', 8 + i * 4.6, BAND + 6, 3.4, 4));
		for (i = 0; i < drops.length; i++) {
			for (var pass = 0; pass < 3; pass++) {
				var t0 = 500 + pass * 5200 + i * 600;
				fade(drops[i], 0.9, 200, t0);
				T(drops[i], 'y', Rig.stagePx().h * 0.2, 4200, 'in', t0);
				fade(drops[i], 0, 400, t0 + 4000);
				T(drops[i], 'y', 0, 1, 'lin', t0 + 4500);
			}
		}

		place(34);
		Rig.face(-1);
		A.sit();
		watch(14, BAND + 12, 900);
		T('earL', 'rot', 30, 900, 'io', 900);
		T('earR', 'rot', 30, 900, 'io', 900);
		A.mouth('frown', 700, 1400);
		T('body', 'sy', 0.94, 1300, 'io', 1800);

		A.lids(0.4, 800, 'io', 3000);
		T('head', 'y', 5, 1200, 'io', 7000);      /* a sigh */
		T('body', 'sy', 0.9, 900, 'io', 7000);
		T('body', 'sy', 0.94, 1200, 'io', 8000);
		A.mouth('closed', 500, 13000);
		fade(win, 0, 800, 15500);
	  } },

	/* 4 - was too much head shaking: her PUPILS follow the flakes, she bats with
	 *     alternating paws, and the head turns only once.                      */
	{ id: 'snow_play', label: 'Playing with snowflakes', dur: 18000, weight: 8, energy: 'high',
	  tags: ['play'],
	  cond: function (wx) { return !!wx && wx.precip === 'sn'; },
	  run: function () {
		var c = catBox(), i;
		var px = Rig.stagePx();

		/* SNOW FALLS FROM THE SKY, AND NO TWO FLAKES ALIKE.
		 *
		 * There were five of them, spaced exactly eighteen percent apart, all
		 * starting just above her head and all falling straight down at the same
		 * speed with the same spin. Which is a row of five identical things
		 * moving together, not weather.
		 *
		 * Two changes. The sky ones go in the BACK layer (z below 5), because
		 * that layer draws behind the forecast - so they can start above the top
		 * of the screen and fall the whole height without ever covering the
		 * clock. The clock simply draws over them, which is also what snow
		 * behind a window actually looks like.
		 *
		 * And everything about each flake is drawn from a range: where it starts,
		 * how big it is, how fast it falls, which way and how far it spins, how
		 * far it drifts sideways and when it sets off. The drift is three
		 * alternating sideways tweens over the fall, so they wander rather than
		 * dropping on rails.                                                    */
		function rnd(a, b) { return a + Math.random() * (b - a); }

		var SKY = 8;
		for (i = 0; i < SKY; i++) {
			var x0 = rnd(2, 92);
			var y0 = rnd(-10, 8);
			var w = rnd(4, 9);
			var dur = rnd(4200, 9000);
			var t0 = rnd(0, 2600);
			var f = Props.put('flake', x0, y0, w, 2);      /* 2 = behind the forecast */

			fade(f, rnd(0.7, 1), 500, t0);
			/* to just off the bottom, whatever height it started at */
			T(f, 'y', (105 - y0) / 100 * px.h, dur, 'lin', t0);
			T(f, 'rot', rnd(-420, 420), dur, 'lin', t0);

			/* three sideways wanders, so it does not fall on rails */
			var sway = rnd(3, 10) / 100 * px.w * (Math.random() < 0.5 ? -1 : 1);
			T(f, 'x', sway, dur * 0.34, 'io', t0);
			T(f, 'x', -sway * 0.8, dur * 0.33, 'io', t0 + dur * 0.34);
			T(f, 'x', sway * 0.4, dur * 0.33, 'io', t0 + dur * 0.67);

			fade(f, 0, 700, t0 + dur - 700);
		}

		/* two in FRONT of her, at her own height, so the paw swipes connect with
		 * something the eye can see */
		for (i = 0; i < 2; i++) {
			var nx = c.x + c.w * (i ? 0.72 : 0.16);
			var nt = 1200 + i * 1500;
			var nd = rnd(3200, 4200);
			var near = Props.put('flake', nx, BAND - 2, rnd(6, 8), 9);
			fade(near, 0.95, 400, nt);
			T(near, 'y', (96 - (BAND - 2)) / 100 * px.h, nd, 'lin', nt);
			T(near, 'rot', rnd(-260, 260), nd, 'lin', nt);
			var s2 = rnd(2, 5) / 100 * px.w * (i ? -1 : 1);
			T(near, 'x', s2, nd * 0.5, 'io', nt);
			T(near, 'x', -s2 * 0.6, nd * 0.5, 'io', nt + nd * 0.5);
			fade(near, 0, 500, nt + nd - 500);
		}

		A.stand();
		T('head', 'rot', -9, 800, 'io', 500);
		watch(30, 70, 700);
		watch(66, 76, 3000);
		watch(40, 82, 5600);

		var d = 1500;
		for (i = 0; i < 4; i++) {
			var paw = i % 2 ? 'pawFL' : 'pawFR';
			T(paw, 'rot', -58, 220, 'out', d);
			T('spine', 'rot', (i % 2 ? -3 : 3), 260, 'out', d);
			T(paw, 'rot', 0, 360, 'io', d + 240);
			T('spine', 'rot', 0, 360, 'io', d + 260);
			d += 1000;
		}

		var onNose = Props.put('flake', c.x + c.w * 0.44, c.y + c.h * 0.22, 7, 9);
		fade(onNose, 1, 300, d + 600);
		T('pupilL', 'x', 1.8, 400, 'io', d + 800);
		T('pupilR', 'x', -1.8, 400, 'io', d + 800);
		T('head', 'rot', 0, 500, 'io', d + 800);
		fade(onNose, 0, 200, d + 2100);
		T('pupilL', 'x', 0, 300, 'io', d + 2100);
		T('pupilR', 'x', 0, 300, 'io', d + 2100);
		setTimeout(function () { if (current) A.sneeze(); }, d + 2100);
	  } },

	{ id: 'thunder_hide', label: 'Hiding from thunder', dur: 18000, weight: 10, energy: 'mid',
	  cond: function (wx) { return !!wx && wx.isThunder; },
	  run: function () {
		/* SHE GOES INDOORS, AND THE LIGHTNING IS AN ACTUAL BOLT.
		 *
		 * Before, she crouched where she stood and the lightning was the `flash`
		 * prop - a white rectangle over the whole screen. So there was no
		 * lightning in the lightning and nowhere to hide.
		 *
		 * The house is scenery: it goes in the layer behind the forecast, which
		 * is the layer allowed to be tall, so the doorway can be big enough to
		 * hide a cat in without anything covering the clock.
		 *
		 * She walks to the doorway and fades out - she is inside - and two eyes
		 * appear in the dark. Rig.resetAll() restores catRoot opacity now, so if
		 * this scene is ever cut short while she is invisible she comes straight
		 * back.                                                                 */
		var HX = 34, HY = 54, HW = 62;                 /* house box, stage percent */
		var door = HX + HW / 2;                        /* the doorway is centred */

		var house = Props.put('house', HX, HY, HW, 3); /* 3 = behind the forecast */
		fade(house, 1, 500);

		var flash = Props.put('flash', 0, 0, 100, 12);
		Props.anchor(flash, 0, 0);

		/* one strike: the white sheet, and a bolt somewhere in the sky */
		function strike(t, x, w, power) {
			fade(flash, 0.75 * power, 60, t);
			fade(flash, 0, 240, t + 70);
			fade(flash, 0.45 * power, 50, t + 260);
			fade(flash, 0, 360, t + 320);

			var b = Props.put('bolt', x, 1, w, 2);
			fade(b, 1, 40, t);
			fade(b, 0, 90, t + 120);
			fade(b, 0.9, 40, t + 260);
			fade(b, 0, 300, t + 360);
		}

		strike(300, 10, 13, 1);

		A.startle();

		/* off to the house */
		T('earL', 'rot', 34, 500, 'io', 700);
		T('earR', 'rot', 34, 500, 'io', 700);
		T('tail3', 'rot', -40, 600, 'io', 700);
		var walk = place(Math.max(0, door - Rig.size.w / 2));

		/* in through the door */
		var inAt = 900 + walk + 300;
		T('catRoot', 'o', 0, 420, 'io', inAt);

		var eyes = Props.put('catEyes', door - 4.5, 82, 9, 9);
		fade(eyes, 0.95, 300, inAt + 380);

		/* blinks in the dark, and a flinch away from each strike */
		fade(eyes, 0.1, 120, inAt + 1400);
		fade(eyes, 0.95, 180, inAt + 1560);

		strike(inAt + 2100, 62, 15, 1);
		fade(eyes, 0.25, 90, inAt + 2100);
		fade(eyes, 0.95, 260, inAt + 2320);

		fade(eyes, 0.1, 120, inAt + 3600);
		fade(eyes, 0.95, 180, inAt + 3760);

		strike(inAt + 4600, 30, 11, 0.8);
		fade(eyes, 0.25, 90, inAt + 4600);
		fade(eyes, 0.95, 260, inAt + 4820);

		fade(eyes, 0.1, 120, inAt + 6000);
		fade(eyes, 0.95, 180, inAt + 6160);

		/* the storm passes, and she comes back out */
		var outAt = inAt + 7200;
		fade(eyes, 0, 300, outAt);
		T('catRoot', 'o', 1, 500, 'io', outAt + 200);
		T('earL', 'rot', 0, 700, 'io', outAt + 700);
		T('earR', 'rot', 0, 700, 'io', outAt + 700);
		T('tail3', 'rot', 0, 800, 'io', outAt + 700);
		setTimeout(function () { if (current) A.lookAround(); }, outAt + 900);
		fade(house, 0, 700, outAt + 2200);
	  } },

	/* 6 - the motion was fine, it just did not read as SUNNY. Now there is a
	 *     sun, a parasol and a cactus, and she suns herself under it.          */
	{ id: 'sunbath', label: 'Sunbathing', dur: 20000, weight: 6, energy: 'low',
	  cond: function (wx) { return !!wx && wx.sky === 'skc' && !wx.isNight; },
	  run: function () {
		var sun = Props.put('sun', 78, BAND + 1, 16, 4);
		/* 54% wide at x = 25 puts the pole behind her middle - hidden by her own
		 * body - and the canopy across 26 to 78, which covers the 30 to 74 she
		 * occupies. y = 46 lands the canopy's lower edge at about 60 (just above
		 * her head at 64) with the foot of the pole at about 95, on the towel. */
		var parasol = Props.put('parasol', 25, 46, 54, 4);
		var cactus = Props.put('cactus', 88, 78, 11, 4);
		var patch = Props.put('sunpatch', 14, 84, 64, 4);

		fade(sun, 1, 900);
		fade(parasol, 1, 700, 300);
		fade(cactus, 1, 700, 500);
		fade(patch, 1, 1100, 400);
		T(sun, 'rot', 26, 18000, 'lin', 0);

		/* SHE LIES ON A TOWEL, AND SHE CATCHES THE SUN.
		 *
		 * She used to sunbathe standing up with the `stretch` silhouette, which
		 * made her taller - the opposite of lying down. The `sleep` silhouette is
		 * the wide low mound, so that is what lying on a towel looks like, with
		 * her lowered onto it and her legs out to the sides.
		 *
		 * The towel is scenery underneath her, so it goes in the layer behind the
		 * forecast, drawn after the sunpatch so it sits on top of the glow.     */
		var towel = Props.put('towel', 6, 86, 74, 4);
		fade(towel, 1, 800, 200);

		place(30);
		A.stand();
		watch(84, BAND + 6, 900);
		Wardrobe.wear('wSunglasses', 500, 1200);

		/* down onto the towel */
		A.silhouette('sleep', 1400, 1000);
		T('body', 'sy', 0.74, 1400, 'io', 1000);
		T('body', 'sx', 1.08, 1400, 'io', 1000);
		/* UP, not down. She was 13 units lower than standing, which put the bottom
		 * of her at about 100% of the stage while the towel's surface was at 83 to
		 * 93 - so she sat seven percent BELOW it and the towel read as hanging
		 * behind her. Raised to -20 (about four percent of the screen up) and the
		 * towel dropped to 86, the two now meet: her weight lands between the back
		 * and front edges of the stripes. */
		T('catRoot', 'y', -20, 1400, 'io', 1000);
		T('neck', 'y', 22, 1400, 'io', 1000);
		T('head', 'rot', 5, 1400, 'io', 1000);
		T('pawFL', 'rot', -52, 1300, 'io', 1000);
		T('pawFR', 'rot', 30, 1300, 'io', 1100);
		T('footL', 'rot', -24, 1300, 'io', 1000);
		T('footR', 'rot', 24, 1300, 'io', 1000);
		T('tail', 'rot', -22, 1400, 'io', 1000);
		A.lids(0.72, 1300, 'io', 1600);
		A.mouth('smile', 700, 2200);

		/* and slowly goes red in the face. Two steps rather than one, so it
		 * creeps up on her instead of switching on. */
		T('foreheadFlush', 'o', 0.55, 4200, 'io', 3000);
		T('foreheadFlush', 'o', 0.95, 4500, 'io', 7400);

		var d = 3200;
		for (var i = 0; i < 3; i++) { T('tail', 'rot', i % 2 ? -6 : -30, 2400, 'io', d); d += 2400; }

		/* it is getting hot: a fan of the paw, and a pant */
		T('pawFR', 'rot', -18, 420, 'io', 9000);
		T('pawFR', 'rot', 30, 480, 'io', 9420);
		T('pawFR', 'rot', -18, 420, 'io', 9900);
		T('pawFR', 'rot', 30, 480, 'io', 10320);
		A.mouth('pant', 500, 10900);
		A.mouth('smile', 600, 12600);

		A.mouth('closed', 500, 13400);
		A.eyesShut(1200, 14000);
		T('foreheadFlush', 'o', 0, 1600, 'io', 17000);
		fade(towel, 0, 900, 17600);
		fade(patch, 0, 1000, 17000);
		fade(sun, 0, 900, 17400);
		fade(parasol, 0, 800, 17400);
		fade(cactus, 0, 800, 17400);
	  } },

	{ id: 'moongaze', label: 'Moon gazing', dur: 16000, weight: 6, energy: 'low',
	  cond: function (wx) { return !!wx && wx.isNight && wx.sky !== 'ovc'; },
	  run: function () {
		var moon = Props.put('moon', 72, BAND + 4, 15, 4);
		fade(moon, 1, 1400, 400);
		T(moon, 'y', -Rig.stagePx().h * 0.04, 14000, 'io', 400);

		place(30);
		A.sit();
		watch(79, BAND + 8, 900);
		T('head', 'rot', -14, 1400, 'io', 900);
		T('eyeL', 'sy', 1.06, 1200, 'io', 900);
		T('eyeR', 'sy', 1.06, 1200, 'io', 900);
		T('tail', 'rot', -22, 1500, 'io', 900);
		T('earL', 'rot', -6, 1300, 'io', 900);
		T('earR', 'rot', -6, 1300, 'io', 900);

		A.slowBlink();
		setTimeout(function () { if (current) A.slowBlink(); }, 7000);
		T('head', 'rot', -9, 1500, 'io', 10000);
		T('head', 'rot', -14, 1500, 'io', 12500);
		fade(moon, 0, 1200, 14000);
	  } },

	{ id: 'dream', label: 'Dreaming of a fish', dur: 18000, weight: 5, energy: 'low',
	  cond: function (wx) { return !wx || wx.isNight || wx.pressureTrend < -3; },
	  run: function () {
		var c = catBox();

		/* THE BED, IN TWO HALVES.
		 *
		 * She curls up in this scene, so she should be curled up in something.
		 * The back rim is scenery behind her; the front rim is a prop in front,
		 * which is what makes her sit inside the bed instead of beside it. Both
		 * are placed from her own bounds, because this scene never walks her -
		 * she curls up wherever she happens to be standing.                     */
		var bw = c.w * 1.16;
		var bx = c.x + c.w / 2 - bw / 2;
		var bedB = Props.put('bedBack', bx, 84, bw, 4);
		var bedF = Props.put('bedFront', bx, 93, bw, 9);
		fade(bedB, 1, 700);
		fade(bedF, 1, 700, 120);

		A.curl();

		var bub = Props.put('bubble', Math.min(64, c.x + c.w * 0.55), BAND + 4, 30, 9);
		var fish = Props.put('fish', Math.min(72, c.x + c.w * 0.72), BAND + 11, 11, 10);
		fade(bub, 0.95, 900, 1600);
		fade(fish, 1, 900, 2000);

		var d = 2400;
		for (var i = 0; i < 3; i++) {
			T(fish, 'x', 16, 1900, 'io', d);
			T(fish, 'sx', -1, 1, 'lin', d + 1900);
			T(fish, 'x', -6, 1900, 'io', d + 2000);
			T(fish, 'sx', 1, 1, 'lin', d + 3900);
			d += 4000;
		}

		var zs = [Props.put('zzz', c.x + c.w * 0.3, c.y + c.h * 0.02, 8, 9),
		          Props.put('zzz', c.x + c.w * 0.4, c.y + c.h * 0.02, 6.5, 9),
		          Props.put('zzz', c.x + c.w * 0.5, c.y + c.h * 0.02, 5, 9)];
		for (var pass = 0; pass < 3; pass++) {
			for (var k = 0; k < zs.length; k++) {
				var t0 = 2600 + pass * 5000 + k * 600;
				fade(zs[k], 0.9, 400, t0);
				T(zs[k], 'y', -Rig.stagePx().h * 0.09, 3000, 'out', t0);
				T(zs[k], 'x', 8 + k * 3, 3000, 'io', t0);
				fade(zs[k], 0, 600, t0 + 2400);
				T(zs[k], 'y', 0, 1, 'lin', t0 + 3100);
				T(zs[k], 'x', 0, 1, 'lin', t0 + 3100);
			}
		}
		fade(bub, 0, 800, 15400);
		fade(fish, 0, 800, 15400);

		/* and the bed goes last, after she has stopped using it */
		fade(bedF, 0, 800, 16600);
		fade(bedB, 0, 800, 16700);
	  } },

	{ id: 'shiver_ball', label: 'Freezing - a tight ball', dur: 16000, weight: 9, energy: 'low',
	  cond: function (wx) { return !!wx && wx.temp !== null && wx.temp < -6; },
	  run: function () {
		var c = catBox();
		A.curl();
		T('body', 'sx', 1.12, 1100, 'io', 400);

		/* SHE GOES BLUE, AND THE SHAKE IS ACTUALLY VISIBLE.
		 *
		 * The shudder was `spine.x` by 1.1 units - under a single pixel on the
		 * phone - in 60 ms steps. At fifteen frames a second a 60 ms step does not
		 * survive to be drawn, so it was a sub-pixel wobble at a rate the screen
		 * could not show. Three things fix that: three times the distance, steps
		 * slowed to 100 ms so each one lands on its own frame, and the whole cat
		 * shaking rather than just her spine.                                    */
		T('coldTint', 'o', 0.5, 1600, 'io', 600);

		for (var bout = 0; bout < 3; bout++) {
			var d = 1600 + bout * 3600;
			for (var i = 0; i < 7; i++) {
				var sgn = i % 2 ? 1 : -1;
				T('spine', 'x', sgn * 3.4, 100, 'lin', d + i * 100);
				T('catRoot', 'x', sgn * -1.6, 100, 'lin', d + i * 100);
				T('body', 'rot', sgn * 1.6, 100, 'lin', d + i * 100);
			}
			T('spine', 'x', 0, 160, 'io', d + 700);
			T('catRoot', 'x', 0, 160, 'io', d + 700);
			T('body', 'rot', 0, 200, 'io', d + 700);

			/* the blue deepens with every bout */
			T('coldTint', 'o', 0.5 + bout * 0.18, 500, 'io', d);

			/* vibration marks either side, flashing with the shake */
			var mL = Props.put('shiverMark', c.x - 7, c.y + c.h * 0.28, 9, 9);
			var mR = Props.put('shiverMark', c.x + c.w - 2, c.y + c.h * 0.28, 9, 9);
			T(mR, 'sx', -1, 1, 'lin', 0);          /* mirrored, so both point outwards */
			for (var f = 0; f < 3; f++) {
				fade(mL, 0.95, 60, d + f * 220);
				fade(mL, 0.15, 120, d + f * 220 + 90);
				fade(mR, 0.95, 60, d + 60 + f * 220);
				fade(mR, 0.15, 120, d + 60 + f * 220 + 90);
			}
			fade(mL, 0, 250, d + 780);
			fade(mR, 0, 250, d + 840);

			var puff = Props.put('puff', c.x + c.w * 0.52, c.y + c.h * 0.2, 15, 9);
			fade(puff, 0.85, 300, d + 150);
			T(puff, 'x', 14, 1900, 'out', d + 150);
			T(puff, 'sx', 1.5, 1900, 'out', d + 150);
			T(puff, 'sy', 1.5, 1900, 'out', d + 150);
			fade(puff, 0, 800, d + 1200);
		}

		/* a real garment, not a prop: it moves with her from here on */
		Wardrobe.wear('wWarmHat', 600, 11800);
		Wardrobe.wear('wScarf', 600, 12300);
		/* warm at last - the blue drains away */
		T('coldTint', 'o', 0, 2200, 'io', 12600);
		T('body', 'sx', 1.08, 1200, 'io', 13200);
		A.mouth('smile', 500, 13400);
		A.eyesShut(800, 13600);
	  } },

	/* 10 - it was unclear WHY she had melted. Now a sun, a thermometer and
	 *      sweat drops say it before she even moves.                          */
	{ id: 'heat_sprawl', label: 'Too hot - sprawled flat', dur: 17000, weight: 9, energy: 'low',
	  cond: function (wx) { return !!wx && wx.temp !== null && wx.temp > 22; },
	  run: function () {
		var c = catBox();

		/* She is walked to a fixed spot so there is room for the fan on her left,
		 * and everything below is placed from that spot rather than from where she
		 * happened to be standing - catBox() was read before the walk.          */
		var atX = 38;
		var mid = atX + c.w * 0.5;

		var sun = Props.put('sun', 74, BAND, 18, 4);
		var therm = Props.put('thermometer', 92, BAND + 6, 8, 4);
		fade(sun, 1, 700);
		fade(therm, 1, 700, 300);
		T(sun, 'sx', 1.08, 2000, 'io', 600);
		T(sun, 'sy', 1.08, 2000, 'io', 600);
		T(sun, 'sx', 1, 2000, 'io', 2600);
		T(sun, 'sy', 1, 2000, 'io', 2600);
		watch(80, BAND + 4, 500);

		/* THE FAN. Body and blades are separate props: a prop rotates as a whole,
		 * so a one-piece fan would have spun its own stand. The blades sit with
		 * their centre on the hub at (19, 76.7) and turn one revolution a second -
		 * fast enough to read as spinning, slow enough not to strobe at 15 fps. */
		var fanBody = Props.put('fan', 6, 70, 26, 9);
		var blades = Props.put('fanBlades', 10, 71.6, 18, 9);
		fade(fanBody, 1, 600, 200);
		fade(blades, 1, 600, 300);
		T(blades, 'rot', 3600, 10000, 'lin', 600);
		T(blades, 'rot', 4680, 4000, 'out', 10600);   /* winding down at the end */

		A.stand();
		place(atX);
		A.silhouette('loaf', 1600, 600);
		T('body', 'sy', 0.74, 1700, 'io', 600);
		T('footL', 'rot', -26, 1700, 'io', 600);
		T('footR', 'rot', 26, 1700, 'io', 600);
		T('pawFL', 'rot', -38, 1700, 'io', 600);
		T('pawFR', 'rot', -38, 1700, 'io', 600);
		T('head', 'rot', 11, 1700, 'io', 600);
		T('head', 'y', 7, 1700, 'io', 600);
		A.lids(0.72, 1400, 'io', 900);
		T('earL', 'rot', 17, 1400, 'io', 900);
		T('earR', 'rot', 17, 1400, 'io', 900);

		/* red in the face, the same flush the sunbathing scene uses */
		T('foreheadFlush', 'o', 0.5, 3000, 'io', 1400);
		T('foreheadFlush', 'o', 0.9, 3600, 'io', 6000);
		T('foreheadFlush', 'o', 0, 1800, 'io', 15000);

		/* THE DROP RUNS DOWN HER FOREHEAD.
		 *
		 * It used to start at 16% across her own box - out by her left ear, not on
		 * her face at all - and fall 7% of the screen, which took it past her chin
		 * into thin air. Now it starts just off centre on her forehead and slides
		 * about 5%, so it travels her forehead and stops around her cheek. The
		 * small sideways wobble is what makes it read as running down her rather
		 * than dropping past her.                                               */
		for (var i = 0; i < 3; i++) {
			var t0 = 2600 + i * 3800;
			var sx0 = mid - 4 + i * 2.2;
			var sw = Props.put('sweat', sx0, c.y + c.h * 0.09, 5.5, 9);
			fade(sw, 0.95, 250, t0);
			T(sw, 'y', Rig.stagePx().h * 0.052, 1700, 'in', t0);
			T(sw, 'x', 3, 900, 'io', t0);
			T(sw, 'x', -1.5, 800, 'io', t0 + 900);
			fade(sw, 0, 400, t0 + 1450);
		}

		/* the air arriving, and her ears fluttering in it */
		for (var b = 0; b < 4; b++) {
			var bt = 1400 + b * 3300;
			var br = Props.put('breeze', 30, 73, 22, 9);
			fade(br, 0.85, 400, bt);
			T(br, 'x', Rig.stagePx().w * 0.16, 2300, 'out', bt);
			fade(br, 0, 600, bt + 1700);

			T('earL', 'rot', 24, 420, 'io', bt + 300);
			T('earL', 'rot', 15, 460, 'io', bt + 720);
			T('earR', 'rot', 24, 420, 'io', bt + 380);
			T('earR', 'rot', 15, 460, 'io', bt + 800);
			T('whiskerL', 'rot', 7, 500, 'io', bt + 300);
			T('whiskerL', 'rot', 0, 600, 'io', bt + 800);
		}

		setTimeout(function () { if (current) A.pant(); }, 2400);
		setTimeout(function () { if (current) A.pant(); }, 6200);
		setTimeout(function () { if (current) A.pant(); }, 10600);

		T('spine', 'rot', 11, 1500, 'io', 8600);
		T('head', 'rot', 20, 1500, 'io', 8600);
		T('tail', 'rot', 22, 1500, 'io', 8600);
		A.lids(0.85, 1200, 'io', 13200);
		fade(sun, 0, 800, 14800);
		fade(therm, 0, 800, 14800);
	  } },

	/* 11 - was unreadable. Rebuilt: leaves blow past first so the idea lands,
	 *      then one big slow leaf she tracks, crouches at, and pounces on.     */
	{ id: 'wind_leaf', label: 'Chasing a leaf', dur: 19000, weight: 7, energy: 'high',
	  tags: ['play'],
	  cond: function (wx) { return !!wx && wx.wind > 8; },
	  run: function () {
		var i;
		place(58);
		A.stand();

		for (i = 0; i < 2; i++) {
			var lf = Props.put('leaf', 100, 74 + i * 6, 9, 9);
			var t0 = 400 + i * 1600;
			fade(lf, 1, 300, t0);
			T(lf, 'x', -Rig.stagePx().w * 1.15, 4200, 'lin', t0);
			T(lf, 'rot', -300, 4200, 'lin', t0);
			fade(lf, 0, 400, t0 + 3900);
		}
		watch(70, 76, 700);
		watch(40, 78, 2200);
		T('head', 'rot', 10, 700, 'io', 600);
		T('head', 'rot', -10, 1600, 'io', 1600);

		/* now THE leaf: bigger, slower, and it stops in front of her */
		var leaf = Props.put('leaf', 96, 80, 14, 9);
		fade(leaf, 1, 300, 4600);
		T(leaf, 'x', -Rig.stagePx().w * 0.34, 2600, 'out', 4600);
		T(leaf, 'rot', -170, 2600, 'lin', 4600);
		watch(62, 82, 5000);

		A.silhouette('crouch', 700, 7400);
		T('body', 'sy', 0.85, 700, 'io', 7400);
		T('head', 'y', 6, 700, 'io', 7400);
		T('earL', 'rot', -8, 500, 'io', 7400);
		T('earR', 'rot', -8, 500, 'io', 7400);
		for (i = 0; i < 4; i++) T('spine', 'rot', i % 2 ? 3 : -3, 170, 'io', 8200 + i * 170);
		T('spine', 'rot', 0, 200, 'io', 8900);

		T('catRoot', 'y', -30, 320, 'out', 9200);
		T('world', 'x', Math.max(0, Rig.get('world', 'x') - 9), 640, 'io', 9200);
		T('catRoot', 'y', 0, 340, 'in', 9520);
		A.silhouette('normal', 500, 9900);
		T('body', 'sy', 1, 500, 'io', 9900);
		T('head', 'y', 0, 500, 'io', 9900);

		T(leaf, 'y', -Rig.stagePx().h * 0.22, 1800, 'out', 9500);
		T(leaf, 'rot', -280, 1800, 'lin', 9500);
		fade(leaf, 0, 700, 10800);

		watch(52, 60, 10000);
		T('head', 'rot', -16, 900, 'io', 10200);
		T('head', 'rot', 0, 900, 'io', 12600);
		A.mouth('frown', 500, 12800);
		A.mouth('closed', 500, 14600);
		setTimeout(function () { if (current) A.groom(); }, 14200);
	  } },

	/* 12 - was too much head shaking: paws and body lean do the work now.     */
	{ id: 'yarn', label: 'Ball of yarn', dur: 18000, weight: 6, energy: 'high',
	  tags: ['play'],
	  cond: function () { return true; },
	  run: function () {
		var c = catBox();
		var ball = Props.put('yarn', Math.min(88, c.x + c.w * 0.92), 90, 13, 9);
		fade(ball, 1, 450, 300);
		watch(Math.min(94, c.x + c.w), 92, 500);

		A.stand();
		T('head', 'rot', 10, 700, 'io', 800);

		T('pawFR', 'rot', -56, 220, 'out', 1900);
		T('spine', 'rot', 5, 260, 'out', 1900);
		T('pawFR', 'rot', 0, 380, 'io', 2140);
		T('spine', 'rot', 0, 420, 'io', 2180);
		T(ball, 'x', Rig.stagePx().w * 0.2, 2400, 'out', 2140);
		T(ball, 'rot', 640, 2400, 'out', 2140);

		setTimeout(function () { if (current) place(Rig.get('world', 'x') + 16); }, 3100);
		watch(96, 92, 3200);

		T('pawFL', 'rot', -56, 220, 'out', 7200);
		T('spine', 'rot', -5, 260, 'out', 7200);
		T('pawFL', 'rot', 0, 380, 'io', 7440);
		T('spine', 'rot', 0, 420, 'io', 7480);
		T(ball, 'x', -Rig.stagePx().w * 0.16, 2200, 'out', 7440);
		T(ball, 'rot', 200, 2200, 'out', 7440);

		setTimeout(function () { if (current) place(Rig.get('world', 'x') - 12); }, 8400);
		setTimeout(function () { if (current) A.sit(); }, 12600);
		T('head', 'rot', 8, 800, 'io', 13400);
		T('tail', 'rot', -18, 900, 'io', 13400);
		A.mouth('smile', 500, 13800);
		setTimeout(function () { if (current) A.slowBlink(); }, 14800);
		A.mouth('closed', 500, 16000);
		fade(ball, 0, 800, 16400);
	  } },

	{ id: 'butterfly', label: 'The butterfly', dur: 18000, weight: 6, energy: 'high',
	  tags: ['play'],
	  cond: function (wx) { return !wx || (!wx.isNight && !wx.precip); },
	  run: function () {
		var c = catBox();
		var px = Rig.stagePx();
		var sw = px.w / 100, sh = px.h / 100;

		/* NO MORE BUTTERFLIES OUT OF HER NOSE.
		 *
		 * The old version called Props.anchor() to move the butterfly to her nose,
		 * which sets the prop's CSS position OUTRIGHT while the tweened offsets
		 * are still where the last waypoint left them. So it teleported to
		 * nose-plus-offset and then slid to the nose - it never approached, it
		 * appeared there - and then flew off upwards. Which looks exactly like
		 * something coming out of her nose.
		 *
		 * The anchor is gone. The landing spot is worked out in the same offset
		 * space as every other waypoint, so she is flown to rather than jumped to,
		 * and it settles, sits, and takes off sideways.
		 *
		 * Two more simply cross the screen and never come near her, because one
		 * butterfly doing everything is what made it read as being about her nose
		 * in the first place.                                                    */
		var BW = 12;
		var BH = BW * 0.5625 / 1.25;               /* art is 50 x 40 */
		var noseX = c.x + c.w * 0.5;
		var noseY = c.y + c.h * 0.22;

		/* ---- the two passers-by ---- */
		for (var p = 0; p < 2; p++) {
			var py = p ? 66 : 88;
			var pw = p ? 9 : 10.5;
			var pt = 300 + p * 3400;
			var pb = Props.put('butterfly', -16, py, pw, 9);
			fade(pb, 0.9, 450, pt);
			T(pb, 'x', 146 * sw, 7200, 'lin', pt);
			for (var q = 0; q < 5; q++) {
				T(pb, 'y', (q % 2 ? -3.2 : 3.2) * sh, 1000, 'io', pt + q * 1000);
				T(pb, 'rot', (q % 2 ? 12 : -12), 1000, 'io', pt + q * 1000);
			}
			fade(pb, 0, 600, pt + 6400);
		}

		/* ---- the one that lands ---- */
		var bf = Props.put('butterfly', 8, 72, BW, 9);
		fade(bf, 1, 500, 900);

		var pts = [[26, 66], [58, 76], [38, 65], [70, 72]];
		var d = 900;
		for (var i = 0; i < pts.length; i++) {
			T(bf, 'x', (pts[i][0] - 8) * sw, 1900, 'io', d);
			T(bf, 'y', (pts[i][1] - 72) * sh, 1900, 'io', d);
			T(bf, 'rot', (i % 2 ? 12 : -12), 1900, 'io', d);
			watch(pts[i][0], pts[i][1], d + 150);
			T('head', 'rot', (pts[i][0] > 48 ? 12 : -11), 1500, 'io', d + 250);
			d += 1900;
		}

		setTimeout(function () { if (current) A.hop(); }, 3200);
		setTimeout(function () { if (current) A.hop(); }, 6800);

		/* the landing: centred on her nose, approached with a little overshoot so
		 * it settles rather than arriving on rails */
		var landX = (noseX - BW / 2 - 8) * sw;
		var landY = (noseY - BH / 2 - 72) * sh;
		T('head', 'rot', 0, 900, 'io', d);
		watch(noseX, noseY, d + 300);
		T(bf, 'x', landX + 5 * sw, 1000, 'out', d);
		T(bf, 'y', landY - 6 * sh, 1000, 'out', d);
		T(bf, 'rot', 0, 1000, 'io', d);
		T(bf, 'x', landX, 800, 'io', d + 1000);
		T(bf, 'y', landY, 800, 'io', d + 1000);

		/* sitting on it: she goes cross-eyed, the wings fold and open slowly, and
		 * her nose twitches */
		var sit = d + 1800;
		T('pupilL', 'x', 2.6, 600, 'io', sit);
		T('pupilR', 'x', -2.6, 600, 'io', sit);
		A.mouth('smile', 400, sit + 200);
		for (var w = 0; w < 4; w++) {
			T(bf, 'sx', 0.68, 440, 'io', sit + w * 900);
			T(bf, 'sx', 1, 440, 'io', sit + w * 900 + 440);
		}
		T('nose', 'sy', 1.2, 220, 'io', sit + 1300);
		T('nose', 'sy', 1, 280, 'io', sit + 1520);
		T('nose', 'sy', 1.16, 200, 'io', sit + 2600);
		T('nose', 'sy', 1, 260, 'io', sit + 2800);

		/* and away, off to the side - not upwards out of her face */
		var off = sit + 3800;
		T(bf, 'x', (124 - 8) * sw, 2300, 'in', off);
		T(bf, 'y', landY - 14 * sh, 2300, 'out', off);
		T(bf, 'rot', 14, 900, 'io', off);
		fade(bf, 0, 700, off + 1600);
		T('pupilL', 'x', 0, 500, 'io', off + 300);
		T('pupilR', 'x', 0, 500, 'io', off + 300);
		A.mouth('closed', 400, off + 700);
		setTimeout(function () { if (current) A.lookAround(); }, off + 600);
	  } },

	/* 15 - zoomies, then a little zombie shuffles in and she copies its walk.
	 *      (That is my reading of "add zombie" - say the word and I'll change it.) */
	{ id: 'zoomies', label: 'Zoomies, then zombie', dur: 19000, weight: 4, energy: 'high',
	  tags: ['play'],
	  cond: function () { return true; },
	  bias: function (wx) { return (wx && wx.isNight) ? 0.3 : 1; },
	  run: function () {
		var span = 100 - Rig.size.w;
		var i, k;
		A.stand();

		function dash(to, at, ms) {
			Anim.tween('world', 'x', to, ms, 'io', at);
			Rig.set('world', 'face', to > Rig.get('world', 'x') ? 1 : -1);
			var steps = Math.max(3, Math.round(ms / 140));
			for (var j = 0; j < steps; j++) {
				var s = j % 2 ? 1 : -1;
				T('spine', 'rot', s * 6, 140, 'io', at + j * 140);
				T('catRoot', 'y', -6, 70, 'out', at + j * 140);
				T('catRoot', 'y', 0, 70, 'in', at + j * 140 + 70);
				T('tail', 'rot', s * -18, 140, 'io', at + j * 140);
			}
			T('spine', 'rot', 0, 200, 'io', at + ms);
		}

		T('earL', 'rot', -10, 300, 'out', 200);
		T('earR', 'rot', -10, 300, 'out', 200);
		dash(Math.max(0, span * 0.02), 600, 1300);
		dash(span * 0.96, 2100, 1700);
		dash(span * 0.42, 4100, 1400);

		/* out of breath */
		T('body', 'sy', 0.78, 500, 'out', 5800);
		T('head', 'rot', 9, 500, 'out', 5800);
		T('earL', 'rot', 13, 500, 'io', 5800);
		T('earR', 'rot', 13, 500, 'io', 5800);
		setTimeout(function () { if (current) A.pant(); }, 6300);
		setTimeout(function () { if (current) A.pant(); }, 8000);

		/* a small zombie rises at the edge */
		var z = Props.put('zombie', 82, 74, 15, 9);
		T(z, 'y', Rig.stagePx().h * 0.12, 1, 'lin', 0);
		fade(z, 1, 700, 9200);
		T(z, 'y', 0, 1400, 'out', 9200);
		watch(88, 78, 9600);
		T('head', 'rot', 14, 700, 'io', 9600);
		T('eyeL', 'sx', 1.12, 500, 'io', 9800);
		T('eyeR', 'sx', 1.12, 500, 'io', 9800);
		A.mouth('small', 400, 9900);

		for (k = 0; k < 6; k++) T(z, 'rot', k % 2 ? 7 : -7, 700, 'io', 11000 + k * 700);

		/* and she copies it: paws out, stiff wobble */
		T('body', 'sy', 1, 600, 'io', 11000);
		T('pawFL', 'rot', -74, 700, 'out', 11000);
		T('pawFR', 'rot', -74, 700, 'out', 11000);
		A.mouth('wide', 500, 11200);
		A.lids(0.55, 600, 'io', 11200);
		T('head', 'rot', 0, 700, 'io', 11200);
		for (k = 0; k < 6; k++) {
			T('spine', 'rot', k % 2 ? 6 : -6, 700, 'io', 11400 + k * 700);
			T('catRoot', 'x', k % 2 ? 3 : -3, 700, 'io', 11400 + k * 700);
		}
		T('spine', 'rot', 0, 600, 'io', 15600);
		T('catRoot', 'x', 0, 600, 'io', 15600);
		T('pawFL', 'rot', 0, 700, 'io', 15800);
		T('pawFR', 'rot', 0, 700, 'io', 15800);
		A.mouth('closed', 500, 15800);
		A.lids(0, 500, 'out', 15800);
		T('eyeL', 'sx', 1, 500, 'io', 15800);
		T('eyeR', 'sx', 1, 500, 'io', 15800);
		fade(z, 0, 900, 16000);
		T(z, 'y', Rig.stagePx().h * 0.12, 1200, 'in', 16000);
	  } },

	/* ---- her working day: she works while you work ---- */

	/* Her job, and during work hours it should read as one. weight and perDay are
	 * both deliberately large: the fit-based cap would otherwise hold the desk to
	 * eight sessions a day, which over an eight-hour window is one every eighty
	 * minutes - not a working day by any standard.                             */
	{ id: 'desk_work', label: 'At her desk, working', dur: 24000, weight: 38, energy: 'mid',
	  tags: ['work'], perDay: 30,
	  cond: function (wx, date) {
		return isWorkday(date) && within(date, cat_work_from, cat_work_to) &&
		       !within(date, cat_lunch_from, cat_lunch_to);
	  },
	  run: function () {
		/* The desk sits BEHIND her (z 4) and she stands centred in front of it,
		 * paws on the surface. In front, its monitor covered her face.         */
		var desk = Props.put('desk', 24, 76, 52, 4);
		fade(desk, 1, 600);

		place(28);
		A.stand();
		A.sit();

		/* ONE settle of the head, and then it stays put. The eyes do the work. */
		T('head', 'rot', 4, 900, 'io', 900);
		T('head', 'y', 3, 900, 'io', 900);
		T('pawFL', 'rot', -26, 800, 'io', 900);
		T('pawFR', 'rot', -26, 800, 'io', 900);

		var d = 2000;
		for (var burst = 0; burst < 3; burst++) {
			for (var i = 0; i < 9; i++) {
				T('pawFL', 'rot', i % 2 ? -31 : -22, 110, 'io', d);
				T('pawFR', 'rot', i % 2 ? -22 : -31, 110, 'io', d);
				d += 110;
			}
			T('pawFL', 'rot', -26, 200, 'io', d);
			T('pawFR', 'rot', -26, 200, 'io', d);

			/* reading the screen: pupils only */
			T('pupilL', 'x', -2, 500, 'io', d + 200);
			T('pupilR', 'x', -2, 500, 'io', d + 200);
			T('pupilL', 'x', 1.6, 1000, 'lin', d + 900);
			T('pupilR', 'x', 1.6, 1000, 'lin', d + 900);
			d += 2500;

			/* halfway through, something on the screen catches her: ears up, a
			 * long look, one slow blink. Still no head movement.               */
			if (burst === 1) {
				T('earL', 'rot', -13, 400, 'out', d);
				T('earR', 'rot', -13, 400, 'out', d);
				T('pupilL', 'x', -2.4, 400, 'out', d + 200);
				T('pupilR', 'x', -2.4, 400, 'out', d + 200);
				T('eyeL', 'sx', 1.07, 500, 'io', d + 300);
				T('eyeR', 'sx', 1.07, 500, 'io', d + 300);
				setTimeout(function () { if (current) A.slowBlink(); }, d + 900);
				T('eyeL', 'sx', 1, 500, 'io', d + 2100);
				T('eyeR', 'sx', 1, 500, 'io', d + 2100);
				T('earL', 'rot', 0, 500, 'io', d + 2200);
				T('earR', 'rot', 0, 500, 'io', d + 2200);
				d += 2900;
			}
		}

		/* back to typing until the end, then the paws come off the desk */
		T('pawFL', 'rot', 0, 600, 'io', d + 400);
		T('pawFR', 'rot', 0, 600, 'io', d + 400);
		T('head', 'rot', 0, 700, 'io', d + 400);
		T('head', 'y', 0, 700, 'io', d + 400);
		A.lids(0.35, 600, 'io', d + 900);
		A.lids(0, 500, 'out', d + 2000);
		fade(desk, 0, 800, d + 2400);
	  } },

	{ id: 'lunch', label: 'Lunch break', dur: 20000, weight: 14, energy: 'mid',
	  cond: function (wx, date) { return within(date, cat_lunch_from, cat_lunch_to); },
	  run: function () {
		var desk = Props.put('desk', 24, 76, 52, 4);
		var bowl = Props.put('bowl', 40, 80, 14, 9);
		var mug = Props.put('mug', 64, 79, 9, 9);
		fade(desk, 0.9, 600);
		fade(bowl, 1, 500, 600);
		fade(mug, 1, 500, 900);

		place(28);
		A.sit();
		watch(47, 82, 800);
		A.mouth('smile', 400, 1000);

		/* she leaves the screen alone and eats properly */
		T('head', 'rot', 14, 700, 'io', 1600);
		T('head', 'y', 6, 700, 'io', 1600);
		A.mouth('closed', 300, 1600);
		A.lids(0.4, 500, 'io', 1700);

		var d = 2500;
		for (var i = 0; i < 10; i++) {
			T('jaw', 'y', i % 2 ? 2.4 : 0.2, 180, 'io', d);
			T('cheekL', 'sx', i % 2 ? 1.1 : 1, 180, 'io', d);
			T('cheekR', 'sx', i % 2 ? 1.1 : 1, 180, 'io', d);
			d += 180;
		}
		T('jaw', 'y', 0, 220, 'io', d);
		A.lids(0, 400, 'out', d + 200);
		T('head', 'rot', 4, 700, 'io', d + 300);
		T('head', 'y', 0, 700, 'io', d + 300);

		/* tea, then washing her face */
		T('pawFR', 'rot', -62, 500, 'out', d + 900);
		liftToMouth(mug, 64, 79, 9, 60 / 54, 600, d + 900);
		A.lids(0.5, 400, 'io', d + 1400);
		A.lids(0, 400, 'out', d + 2200);
		lowerProp(mug, 700, d + 2400);
		T('pawFR', 'rot', 0, 700, 'io', d + 2400);
		setTimeout(function () { if (current) A.groom(); }, d + 3200);
		A.mouth('smile', 400, d + 5200);
		A.mouth('closed', 400, d + 6600);

		fade(mug, 0, 600, d + 6000);
		fade(bowl, 0, 600, d + 6200);
		fade(desk, 0, 700, d + 6400);
	  } },

	{ id: 'snowball', label: 'Throwing snowballs', dur: 22000, weight: 9, energy: 'high',
	  tags: ['play'],
	  cond: function (wx) { return !!wx && wx.precip === 'sn'; },
	  run: function () {
		var i;
		place(24);
		A.stand();
		Wardrobe.wear('wWarmHat', 500, 400);
		Wardrobe.wear('wScarf', 500, 800);

		/* roll one up off the floor */
		var ball = Props.put('snowball', 40, 92, 8, 9);
		fade(ball, 1, 400, 1400);
		watch(44, 93, 1400);
		T('head', 'rot', 16, 700, 'io', 1500);
		T('head', 'y', 6, 700, 'io', 1500);
		T('pawFL', 'rot', -34, 600, 'io', 1600);
		T('pawFR', 'rot', -34, 600, 'io', 1600);
		for (i = 0; i < 4; i++) {
			T(ball, 'x', Rig.stagePx().w * 0.03 * (i + 1), 500, 'io', 2200 + i * 500);
			T(ball, 'rot', 180 * (i + 1), 500, 'lin', 2200 + i * 500);
			T(ball, 'sx', 1 + (i + 1) * 0.14, 500, 'io', 2200 + i * 500);
			T(ball, 'sy', 1 + (i + 1) * 0.14, 500, 'io', 2200 + i * 500);
			T('spine', 'rot', i % 2 ? 4 : -4, 500, 'io', 2200 + i * 500);
		}
		T('spine', 'rot', 0, 400, 'io', 4300);

		/* wind up, and throw */
		T('head', 'rot', 0, 500, 'io', 4600);
		T('head', 'y', 0, 500, 'io', 4600);
		T('pawFL', 'rot', -96, 600, 'out', 4900);
		T('spine', 'rot', -8, 600, 'out', 4900);
		T(ball, 'y', -Rig.stagePx().h * 0.06, 600, 'out', 4900);
		A.mouth('small', 300, 5200);

		T('pawFL', 'rot', 26, 240, 'in', 5900);
		T('spine', 'rot', 9, 240, 'in', 5900);
		T(ball, 'x', Rig.stagePx().w * 0.62, 900, 'out', 6000);
		T(ball, 'y', -Rig.stagePx().h * 0.12, 420, 'out', 6000);
		T(ball, 'y', Rig.stagePx().h * 0.02, 480, 'in', 6420);
		T(ball, 'rot', 900, 900, 'lin', 6000);
		/* splat */
		T(ball, 'sx', 1.9, 200, 'out', 6900);
		T(ball, 'sy', 0.4, 200, 'out', 6900);
		fade(ball, 0, 400, 7000);

		T('pawFL', 'rot', 0, 700, 'io', 6900);
		T('spine', 'rot', 0, 700, 'io', 6900);
		A.mouth('smile', 400, 7200);
		watch(88, 90, 6600);
		setTimeout(function () { if (current) A.hop(); }, 7600);

		/* one comes back at her */
		var back = Props.put('snowball', 92, 74, 9, 9);
		fade(back, 1, 200, 11000);
		T(back, 'x', -Rig.stagePx().w * 0.55, 800, 'in', 11000);
		T(back, 'rot', -700, 800, 'lin', 11000);
		fade(back, 0, 200, 11800);
		watch(60, 76, 11200);
		setTimeout(function () { if (current) { A.startle(); A.shakeOff(); } }, 11800);
		A.mouth('wide', 300, 11900);
		A.mouth('closed', 400, 13200);
		setTimeout(function () { if (current) A.groom(); }, 14200);
	  } },

	/* Not a real activity - weight 0 keeps the picker away from it. It exists so
	 * the whole wardrobe can be reviewed from the test menu in one go.         */
	{ id: 'wardrobe', label: 'Wardrobe parade (all outfits)', dur: 26000, weight: 0, energy: 'mid',
	  cond: function () { return false; },
	  run: function () {
		var names = ['plain', 'hot', 'treat', 'soda', 'rain', 'cold', 'snow', 'windy'];
		var px = Rig.stagePx(), sw = px.w / 100, sh = px.h / 100;

		/* She stands on the left and the wardrobe is on her right, with a gap
		 * between them - props in this layer draw in front of her, so an overlap
		 * would put the wardrobe over her shoulder. */
		var atX = 16;
		var CX = 64, CY = 66, CW = 33;

		A.stand();
		place(atX);
		Wardrobe.bare();

		var shut = Props.put('closetShut', CX, CY, CW, 9);
		var open = Props.put('closetOpen', CX, CY, CW, 9);
		fade(shut, 1, 500, 200);

		/* she notices it, reaches over, and it opens */
		watch(CX + CW * 0.5, CY + 12, 700);
		T('head', 'rot', 13, 600, 'io', 900);
		T('pawFR', 'rot', -48, 500, 'out', 1200);
		fade(shut, 0, 240, 1560);
		fade(open, 1, 300, 1580);
		T(open, 'sx', 1.05, 260, 'out', 1580);
		T(open, 'sx', 1, 320, 'io', 1840);
		T('pawFR', 'rot', 0, 600, 'io', 2000);

		/* each outfit: reach into the wardrobe, then wear it and show it off */
		var STEP = 2800, START = 2600;
		for (var i = 0; i < names.length; i++) {
			var at = START + i * STEP;
			T('head', 'rot', 13, 500, 'io', at - 600);
			T('pawFR', 'rot', -52, 420, 'out', at - 550);
			T('pawFR', 'rot', 0, 520, 'io', at + 80);
			T('head', 'rot', 0, 600, 'io', at + 200);
			(function (n, when) {
				setTimeout(function () {
					if (!current) return;
					Wardrobe.set(n);
					Actions.headTilt();
				}, when);
			})(names[i], at);
		}

		/* and every so often the last thing goes on the floor. It arcs out of her
		 * paws and lands to her left, and each one stays where it fell, so a pile
		 * builds up over the scene. */
		var TOSS = ['tossCap', 'tossScarf', 'tossCoat', 'tossScarf'];
		var spots = [5, 13, 21, 9];
		var tossed = [];
		for (var k = 0; k < TOSS.length; k++) {
			var tt = START + (k * 2 + 1) * STEP - 700;
			var fromX = atX + 8, fromY = 76;
			var ts = Props.put(TOSS[k], fromX, fromY, 11, 9);
			tossed.push(ts);
			fade(ts, 1, 180, tt);
			/* up and over, then down - two tweens make an arc out of straight lines */
			T(ts, 'y', -7 * sh, 380, 'out', tt);
			T(ts, 'x', (spots[k] - fromX) * 0.55 * sw, 380, 'lin', tt);
			T(ts, 'y', (94 - fromY) * sh, 620, 'in', tt + 380);
			T(ts, 'x', (spots[k] - fromX) * sw, 620, 'lin', tt + 380);
			T(ts, 'rot', (k % 2 ? 34 : -28), 1000, 'out', tt);
			/* she watches it land */
			watch(spots[k] + 5, 95, tt + 500);
		}

		/* shut the wardrobe again at the end, and tidy the pile away */
		var endAt = START + names.length * STEP + 400;
		fade(open, 0, 260, endAt);
		fade(shut, 1, 300, endAt + 20);
		for (var m = 0; m < tossed.length; m++) fade(tossed[m], 0, 700, endAt + 900 + m * 120);
		fade(shut, 0, 700, endAt + 2000);

		setTimeout(function () { if (current) Wardrobe.forWeather(Cat.weather()); }, endAt + 1400);
	  } },

	];

	/* Scenes written as data live in scenes.js and join the same list, so the
	 * picker, the test menu and the adb trigger treat them identically. */
	LIST = LIST.concat(Scenes.activities(function () { return !!current; }));

	/* ------------------------------------------------------------------ *
	 *  running one - in place, on the forecast screen                    *
	 * ------------------------------------------------------------------ */

	function find(id) {
		for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
		return null;
	}

	function play(id, done) {
		var ep = find(id);
		if (!ep || current) return 0;

		A = Actions;
		current = ep;
		onFinish = done || null;

		Anim.clear();
		/* Anim.clear() has just binned any half-finished garment fade, so put the
		 * wardrobe back to what it believes it is wearing before the scene starts
		 * dressing her. Without this a cancelled fade-out leaves the old outfit on
		 * screen underneath the new one. */
		Wardrobe.sync();
		Props.clear();
		Rig.resetAll();
		A.setPosture('STAND');
		A.silhouette('normal', 1);
		Rig.face(1);
		Alive.settle();
		Anim.burst();

		/* A beat-based scene adds up its own length; hand-written ones declare it */
		var reported = 0;
		Guard.run('episode:' + ep.id, function () { reported = ep.run() || 0; });
		var total = (reported > 0 ? reported : ep.dur) + 900;

		endTimer = setTimeout(function () { endTimer = null; finish(); }, total);
		return total;
	}

	function finish() {
		if (!current) return;
		var cb = onFinish;
		current = null;
		onFinish = null;
		if (endTimer) { clearTimeout(endTimer); endTimer = null; }

		Anim.clear();
		Wardrobe.sync();                     /* same reason as in play() */
		Scenes.cancel();
		Props.clear();
		Rig.resetAll();
		A.silhouette('normal', 400);
		Rig.face(1);
		Alive.settle();
		if (cb) cb();
	}

	/* Time of day decides the ENERGY of what she does; the forecast decides
	 * WHICH of those are possible. Both multiply into the weight.               */
	function timeFactor(energy, hour) {
		var band;
		if (hour >= 5 && hour < 10) band = { high: 1.4, mid: 1.2, low: 0.6 };
		else if (hour >= 10 && hour < 17) band = { high: 1.2, mid: 1.0, low: 0.8 };
		else if (hour >= 17 && hour < 22) band = { high: 0.7, mid: 1.0, low: 1.4 };
		else band = { high: 0.25, mid: 0.6, low: 1.8 };
		return band[energy || 'mid'];
	}

	var recent = [];

	function pick(wx, date) {
		var i, ep, w, total = 0, weights = [], usable = [];
		for (i = 0; i < LIST.length; i++) {
			ep = LIST[i];
			if (!ep.cond(wx, date)) continue;
			if (recent.indexOf(ep.id) !== -1) continue;
			w = ep.weight * timeFactor(ep.energy, date.getHours()) * (ep.bias ? ep.bias(wx, date) : 1);
			if (w <= 0) continue;
			usable.push(ep); weights.push(w); total += w;
		}
		if (!usable.length) return null;
		var r = Math.random() * total;
		var chosen = usable[usable.length - 1];
		for (i = 0; i < usable.length; i++) {
			r -= weights[i];
			if (r <= 0) { chosen = usable[i]; break; }
		}
		recent.push(chosen.id);
		while (recent.length > 3) recent.shift();
		return chosen.id;
	}

	/* Everything the day planner needs to lay out a schedule, and nothing it
	 * does not: no run functions, no artwork. This is also what the offline
	 * harness in tools/check-plan.js consumes, which is why the schedule can be
	 * checked without a phone.                                                */
	function planLibrary() {
		var cands = [];
		for (var i = 0; i < LIST.length; i++) {
			var e = LIST[i];
			cands.push({ id: e.id, label: e.label, dur: e.dur, weight: e.weight,
			             energy: e.energy, cond: e.cond, bias: e.bias || null,
			             tags: e.tags || null, perDay: e.perDay || 0 });
		}
		return { cands: cands, timeFactor: timeFactor };
	}

	return {
		play: play,
		abort: finish,
		running: function () { return current ? current.id : null; },
		pick: pick,
		find: find,
		planLibrary: planLibrary,
		list: function () {
			var out = [];
			for (var i = 0; i < LIST.length; i++) out.push({ id: LIST[i].id, label: LIST[i].label, dur: LIST[i].dur });
			return out;
		}
	};
})();
