/* saver.js - what makes the cat a screen saver.
 *
 * Every dream start loads the page afresh, so "a random animation on every
 * start" needs no hook from Android: begin() runs once per page.
 *
 *   1. Make sure the invented sky leaves something she has not shown lately.
 *   2. 600 ms in, play one: the #ep=<id> in the URL if it names a real scene
 *      (adb, for testing), otherwise the shuffle's pick. Cat.play() bypasses
 *      the 20-second boot guard in cat.js, which only gates the Plan path.
 *   3. When that first animation is over, hand cat.js its quiet hours. Not at
 *      boot: Cat.init() would put her to sleep, Cat.play() would then wake her
 *      body without clearing cat.js's `quiet` flag, and she would stand frozen
 *      at 8 fps until morning. So at night she plays one, then curls up.
 *   4. Every minute: the sky's day/night, a nudge against burn-in, and the
 *      clock and backlight dimmed while she sleeps.
 *
 * The drift goes on #sv_clock and the two stage boxes, never on #cat_holder,
 * whose whole transform belongs to the rig. Stage-relative coordinates do not
 * change, so the springs never see it and no Alive.settle() is needed.     */

var Saver = (function () {
	var handedOver = false;       /* step 3 has run: the sleep window is live */
	var asleep = false;
	var poll = null;
	var step = 0;                 /* drift phase, in minutes */

	/* the #ep=<id> in the URL, if any */
	function wanted() {
		var h = '';
		try { h = String(window.location.hash || ''); } catch (e) { h = ''; }
		var m = /(?:^#|&)ep=([a-z0-9_]+)/.exec(h);
		return m ? m[1] : null;
	}

	function library() { return Episodes.planLibrary().cands; }

	/* ---- the first animation ---- */

	/* The cat's part runs inside Guard; the watch and the hand-over do not,
	 * because the clock's dimming must still happen if she has been switched
	 * off (a disabled cat simply reads as "nothing running"). */
	function first() {
		Guard.run('saver-first', function () {
			var date = new Date();
			var want = wanted();
			var id = (want && Episodes.find(want)) ? want : Shuffle.next(library(), Sky.current(), date);
			LOG('saver: first animation ' + id + (want ? ' (asked for ' + want + ')' : ''));
			if (id) Cat.play(id);
		});
		poll = setInterval(function () {
			try { watch(); } catch (e) { Guard.fault('saver-watch', e); }
		}, 1000);
	}

	function watch() {
		var running = null;
		try { running = Episodes.running(); } catch (e) { running = null; }
		if (running) return;
		if (poll) { clearInterval(poll); poll = null; }
		handOver();
	}

	/* Quiet hours belong to cat.js; this is the moment it gets them. It reads
	 * cat_quiet_from/to live on every minute, the same way it picks up the ones
	 * settings.js writes in the informer, so setting the globals is enough. The
	 * extra `minute` makes it look now rather than at the next tick. */
	function handOver() {
		if (handedOver) return;
		handedOver = true;
		cat_quiet_from = saver_sleep_from;
		cat_quiet_to = saver_sleep_to;
		LOG('saver: first animation over; she sleeps ' +
			(saver_sleep_from && saver_sleep_to ? saver_sleep_from + '-' + saver_sleep_to : 'never'));
		Bus.emit('minute', { date: new Date(), now: Date.now() });
	}

	/* ---- burn-in ---- */

	function wave(k, a, b, pa, pb) {
		return 0.6 * Math.sin(k * 2 * Math.PI / a + pa) + 0.4 * Math.sin(k * 2 * Math.PI / b + pb);
	}

	function shift(id, t) {
		var el = byId(id);
		if (el) el.style.transform = t;
	}

	/* Two slow sines each, a different pair per axis, so the path never quite
	 * repeats. No transition: one jump a minute costs no frames at all. The
	 * stage only moves sideways, so her feet stay on the bottom edge. */
	function drift() {
		step++;
		var cx = 4 * wave(step, 37, 89, 0, 1.3);           /* % of the clock's own zone */
		var cy = 4 * wave(step, 53, 113, 2.1, 0.4);
		var sx = 1.5 * wave(step, 61, 131, 0.7, 2.6);      /* % of the stage's width */
		shift('sv_clock', 'translate(' + cx.toFixed(2) + '%,' + cy.toFixed(2) + '%)');
		var st = 'translateX(' + sx.toFixed(2) + '%)';
		shift('cat_stage', st);
		shift('cat_stage_back', st);
	}

	/* ---- night ---- */

	function setAsleep(on) {
		if (on === asleep) return;
		asleep = on;
		var clock = byId('sv_clock');
		if (on) addClass(clock, 'sleeping'); else removeClass(clock, 'sleeping');
		LOG('saver: ' + (on ? 'asleep - clock and screen dimmed' : 'awake'));
		try {
			var host = window.PhoneForecast;
			if (host && host.night) host.night(on);
		} catch (e) {}
	}

	/* Not wrapped in Guard.run: a switched-off cat stops Guard.run from running
	 * anything, and the clock still needs its drift and its night. Bus already
	 * hands anything thrown here to Guard.fault. */
	function minute(date) {
		try { Sky.tick(date); } catch (e) { Guard.fault('saver-sky', e); }
		drift();
		setAsleep(handedOver && inClockWindow(date, saver_sleep_from, saver_sleep_to, false));
	}

	/* ---- start ---- */

	function begin() {
		var date = new Date();
		/* a different starting point on the drift path every time */
		step = Math.floor(Math.random() * 10000);
		drift();
		Bus.on('minute', function (m) { minute(m.date); });

		/* a sky that leaves nothing unseen would only offer repeats */
		var cands = library();
		for (var i = 0; i < 4 && Shuffle.fresh(cands, Sky.current(), date) === 0; i++) Sky.redraw(date);

		setTimeout(first, 600);
	}

	return {
		begin: begin,
		asleep: function () { return asleep; },
		handedOver: function () { return handedOver; }
	};
})();
