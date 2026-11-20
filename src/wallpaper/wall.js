/* wall.js - what makes the cat a live wallpaper.
 *
 * The Android engine renders this page onto the home screen and tells it two
 * things: Wall.show() when the wallpaper comes into view, Wall.hide() when it
 * goes out of it (an app in front, the screen off). Settings arrive as
 * Wall.apply({size, lift}). Everything else is the cat's own life.
 *
 * HIDDEN COSTS NOTHING. hide() freezes every timer on the page (timers.js), so
 * out of sight there is not one wake-up; show() thaws them and she carries on
 * from the frame she stopped at.
 *
 * COMING BACK IS THE SHOW. A wallpaper is looked at in glances: an unlock, an
 * app closed. So show() decides, after the minute tick has caught up with the
 * real clock:
 *   - in the sleep window: nothing. She is asleep, and an unlock at 3 a.m.
 *     shows her asleep. Cat.play() is NEVER called in that window: it would
 *     wake her body without clearing cat.js's `quiet` flag.
 *   - away less than wall_fresh_after seconds: nothing, she just carries on.
 *   - an animation was frozen half-way: it finishes, and the next one follows
 *     it at once (Plan.hurry) instead of after the long idle gap.
 *   - otherwise a fresh animation, 400 ms in (2.6 s if she was asleep before
 *     this show, so that Actions.wake() has finished first).
 *
 * SIZE AND HEIGHT. The 9:16 stage every scene was composed for is kept whole,
 * scaled to wall_size % of the largest 9:16 box that fits, centred, its bottom
 * edge wall_lift % of the screen height above the bottom - clear of the dock.
 * Props are percent of the stage and nothing is drawn above its 63% line, so
 * scaling the stage scales her and every prop together. The stages sit in
 * #wl_view, 15% of the stage wider on each side, which clips (with a fade) the
 * props that fly in from outside the stage. All sizes are px, set here.
 *
 * STILL MODE. With #still=1 in the URL the page is the lock-screen picture
 * (still.js): wall-boot.js runs Still.begin() instead of Wall.begin(), and
 * show() and hide() do nothing, so nothing can thaw the frozen page.        */

var Wall = (function () {
	var SIZE_MIN = 15, SIZE_MAX = 100, LIFT_MIN = 0, LIFT_MAX = 45;

	var size = 60;
	var lift = 22;
	var configured = false;
	var geo = null;               /* the last place(): px, for the harness */

	var state = 'boot';           /* 'boot' (never shown) | 'shown' | 'hidden' */
	var hiddenAt = 0;             /* Date.now() at the last hide() */
	var firedAtHide = 0;
	var asleep = false;           /* inside the sleep window, as of the last minute */
	var begun = false;
	var performed = false;        /* a fresh animation has been chosen since load */
	var seen = false;             /* a show() has been decided since load */
	var playTimer = null;

	/* ---- configuration ---- */

	function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

	function setNum(cfg, key, lo, hi, cur) {
		if (!cfg || cfg[key] === undefined || cfg[key] === null || cfg[key] === '') return cur;
		var v = +cfg[key];
		return (v === v && isFinite(v)) ? clamp(Math.round(v), lo, hi) : cur;
	}

	function take(cfg) {
		size = setNum(cfg, 'size', SIZE_MIN, SIZE_MAX, size);
		lift = setNum(cfg, 'lift', LIFT_MIN, LIFT_MAX, lift);
	}

	/* '#size=80&lift=10&ep=snowball' -> { size: '80', lift: '10', ep: 'snowball' } */
	function hashParams() {
		var h = '', out = {};
		try { h = String(window.location.hash || ''); } catch (e) { h = ''; }
		var parts = h.replace(/^#/, '').split('&');
		for (var i = 0; i < parts.length; i++) {
			var kv = parts[i].split('=');
			if (kv.length === 2 && kv[0]) out[kv[0]] = kv[1];
		}
		return out;
	}

	/* the #ep=<id> in the URL, if any */
	function wanted() {
		var ep = hashParams().ep;
		return (ep && /^[a-z0-9_]+$/.test(ep)) ? ep : null;
	}

	/* The page's defaults, then the phone's settings, then the hash (a browser). */
	function configure() {
		if (configured) return;
		configured = true;
		take({ size: wall_size, lift: wall_lift });
		try {
			var host = window.PhoneForecast;
			if (host && host.config) take(JSON.parse(String(host.config())));
		} catch (e) { LOG('wall: host config unreadable - ' + e); }
		take(hashParams());
	}

	/* ---- placement ---- */

	function px(n) { return n + 'px'; }

	function place() {
		configure();
		var de = document.documentElement;
		var vw = de.clientWidth || window.innerWidth || 0;
		var vh = de.clientHeight || window.innerHeight || 0;
		var base = Math.min(vw, vh * 9 / 16);
		var stageW = Math.round(size / 100 * base);
		var stageH = Math.round(stageW * 16 / 9);
		var pad = Math.round(0.15 * stageW);
		var g = {
			vw: vw, vh: vh, stageW: stageW, stageH: stageH, pad: pad,
			left: Math.round((vw - stageW) / 2) - pad,
			bottom: Math.round(lift / 100 * vh),
			width: stageW + 2 * pad
		};

		var view = byId('wl_view');
		if (view) {
			view.style.left = px(g.left);
			view.style.bottom = px(g.bottom);
			view.style.width = px(g.width);
			view.style.height = px(stageH);
			if (wall_edge_fade) addClass(view, 'fade'); else removeClass(view, 'fade');
		}
		var ids = ['cat_stage_back', 'cat_stage'];
		for (var i = 0; i < ids.length; i++) {
			var st = byId(ids[i]);
			if (!st) continue;
			st.style.left = px(pad);
			st.style.width = px(stageW);
			st.style.height = px(stageH);
		}
		geo = g;
		return g;
	}

	/* A new size or height from the settings screen. A size change ends in a
	 * `resize` event, so Rig.measure() and cat.js's layout() see the new stage
	 * (and Alive.settle() is called); a height change only moves the wrapper,
	 * which nothing inside the stage can tell. */
	function apply(cfg) {
		configure();
		var before = geo ? geo.stageW + 'x' + geo.stageH : '';
		take(cfg);
		var g = place();
		LOG('wall: size ' + size + ' lift ' + lift + ' -> stage ' + g.stageW + 'x' + g.stageH +
			' at ' + g.bottom + 'px from the bottom');
		if (g.stageW + 'x' + g.stageH === before) return;
		var ev = document.createEvent('Event');
		ev.initEvent('resize', false, false);
		window.dispatchEvent(ev);
	}

	/* ---- performing ---- */

	function library() { return Episodes.planLibrary().cands; }

	function inSleep(date) { return inClockWindow(date, cat_quiet_from, cat_quiet_to, false); }

	/* A fresh animation, now. The one place this page calls Cat.play(). */
	function fresh() {
		var date = new Date();
		if (state !== 'shown') return;
		if (inSleep(date)) { LOG('wall: in the sleep window - no animation'); return; }
		if (Episodes.running()) return;
		var want = performed ? null : wanted();
		var id = (want && Episodes.find(want)) ? want : Shuffle.next(library(), Sky.current(), date);
		performed = true;
		/* disarmed as it starts, so the idle gap after it is counted from its end */
		Plan.skip(null);
		LOG('wall: animation ' + id + (want ? ' (asked for ' + want + ')' : ''));
		if (id) Cat.play(id);
	}

	function decide(away, wasAsleep, first) {
		if (asleep) {
			/* cat.js's visibility handler leaves the loop OFF in quiet hours */
			if (Anim.tier() === 'OFF') Anim.to('RESTING');
			LOG('wall: asleep - nothing plays');
			return;
		}
		if (!first && away < wall_fresh_after) return;
		var running = Episodes.running();
		if (running) {
			Plan.hurry();
			LOG('wall: ' + running + ' carries on, and the next one follows it');
			return;
		}
		if (playTimer) return;                    /* one is already on its way */
		Plan.skip(null);
		playTimer = setTimeout(function () {
			playTimer = null;
			Guard.run('wall-play', fresh);
		}, wasAsleep ? 2600 : 400);
	}

	function show() {
		if (Still.active()) return;               /* a still page stays frozen: thaw would wake her */
		if (state === 'shown') return;
		var was = state;
		state = 'shown';
		var firedHidden = Timers.fired() - firedAtHide;
		Timers.thaw();
		if (!begun) return;                       /* begin() decides, when it runs */

		/* The first show since the page loaded always performs, even if the host
		 * said hide() first: an engine can flicker hidden while it is built. */
		var first = !seen;
		seen = true;
		var away = (!first && was === 'hidden') ? Math.max(0, (Date.now() - hiddenAt) / 1000) : -1;
		var wasAsleep = asleep;
		LOG('wall: show after ' + (away < 0 ? '-' : Math.round(away)) + ' s, ' +
			(was === 'hidden' ? firedHidden : 0) + ' timers fired while hidden' +
			' (document.hidden=' + document.hidden + ')');

		if (away >= wall_sky_after) Guard.run('wall-sky', function () { Sky.redraw(new Date()); });
		/* quiet hours, the outfit and the sky catch up with the real clock */
		WallTick.kick();
		Guard.run('wall-show', function () { decide(away, wasAsleep, first); });
	}

	function hide() {
		if (Still.active()) return;
		if (state === 'hidden') return;
		state = 'hidden';
		hiddenAt = Date.now();
		firedAtHide = Timers.fired();
		Timers.freeze();
		LOG('wall: hide - ' + Timers.pending() + ' timers held (document.hidden=' + document.hidden + ')');
	}

	/* ---- start ---- */

	function begin() {
		var date = new Date();
		asleep = inSleep(date);

		/* Not in Guard: Bus hands anything thrown here to Guard.fault. cat.js
		 * subscribed first, so its quiet hours are settled before `asleep`. */
		Bus.on('minute', function (m) {
			try { Sky.tick(m.date); } catch (e) { Guard.fault('wall-sky', e); }
			asleep = inSleep(m.date);
		});

		/* a sky that leaves nothing unseen would only offer repeats */
		var cands = library();
		for (var i = 0; i < 4 && Shuffle.fresh(cands, Sky.current(), date) === 0; i++) Sky.redraw(date);

		/* after cat.js's own handler, which leaves the loop OFF in quiet hours */
		on(document, 'visibilitychange', function () {
			LOG('wall: document.hidden=' + document.hidden);
			if (!document.hidden && asleep && Anim.tier() === 'OFF') Anim.to('RESTING');
		});

		begun = true;
		LOG('wall: begun, ' + (asleep ? 'asleep' : 'awake') + ', size ' + size + ' lift ' + lift +
			(Host.native() ? '' : ' (browser)'));

		if (state === 'shown') {
			/* the host said show() before the page had started */
			state = 'boot';
			show();
		} else if (!Host.native()) {
			/* a browser tab has no engine to say so */
			var root = document.documentElement;
			root.style.background = wall_browser_bg;
			document.body.style.background = wall_browser_bg;
			setTimeout(show, 300);
		}
	}

	return {
		begin: begin,
		place: place,
		apply: apply,
		show: show,
		hide: hide,
		state: function () {
			return { hidden: state !== 'shown', asleep: asleep, size: size, lift: lift };
		},
		geometry: function () { return geo; }
	};
})();
