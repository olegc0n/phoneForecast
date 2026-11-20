/* still.js - one still picture of Lili, for the lock screen.
 *
 * Android lets an app put a picture on the lock screen, but not a live
 * wallpaper (and Huawei and Samsung never show a third-party live wallpaper
 * there). So the app renders this page offscreen - the same page, the same
 * backdrop, her size and height - waits until she is still, takes the frame
 * and hands it to WallpaperManager as the lock-screen picture.
 *
 * The page is in still mode when its URL ends in #still=1. Then, instead of
 * Wall's show/hide life:
 *
 *   - the sky (and so the outfit) is the fresh random one Sky.begin() drew;
 *   - by day she takes one calm pose, picked at random: standing, standing
 *     with a glance aside, sitting, sitting with a glance, or sitting with her
 *     eyes half shut. Somewhere along the floor, facing either way;
 *   - in the sleep window (cat_quiet_from..cat_quiet_to) she is asleep, in
 *     Actions.sleep()'s pose, wearing nothing;
 *   - no scene plays (Cat.play is never called here), and Alive's blinks, eye
 *     darts and ear flicks are switched off from the start, so none of them
 *     can be caught half-way;
 *   - once every tween has finished (the frame loop is back to IDLE or
 *     RESTING) - at the latest STILL_MAX ms in, which is before cat.js's first
 *     idle beat at 2.5 s - the timer gate is frozen. From then on nothing on
 *     the page moves: no frame, no beat, no minute tick.
 *   - then it says so: PhoneForecast.stillReady(json) if the bridge has it,
 *     and Still.state() for anyone who asks (the harness, a desktop browser).
 *     The state names the pose, sky and outfit, whether it settled in time,
 *     and Guard's fault count; LockPicture refuses a picture with faults.
 *
 * The page never calls Cat.play here, and Wall.show()/hide() are no-ops in
 * still mode, so nothing can thaw it again. Open wallpaper.html#still=1 in a
 * desktop browser to see what the lock screen would get.
 *
 * The wardrobe fades in within 640 ms and the slowest pose takes 1.1 s, so
 * STILL_MIN is enough for everything to have arrived.                        */

var Still = (function () {
	var STILL_MIN = 1200;         /* ms after begin() before the first look */
	var STILL_POLL = 100;
	var STILL_MAX = 2200;         /* frozen by then whatever: cat.js beats at 2500 */

	/* the calm poses, by day. Each returns nothing; they only start tweens. */
	var POSES = {
		stand: function () {},
		glance: function (dir) { Actions.lookAt(dir); },
		sit: function () { Actions.sit(); },
		sit_glance: function (dir) { Actions.sit(); Actions.lookAt(dir); },
		loaf: function () { Actions.sit(); Actions.lids(0.5, 700, 'io', 200); }
	};
	var NAMES = ['stand', 'glance', 'sit', 'sit_glance', 'loaf'];

	var state = { ready: false };
	var startedAt = 0;
	var done = false;

	function active() {
		var h = '';
		try { h = String(window.location.hash || ''); } catch (e) { h = ''; }
		return /(^#|&)still=1(&|$)/.test(h);
	}

	/* the same synthetic resize Wall.apply() sends: cat.js's layout() puts her
	 * on the floor at Rig's world x, and Alive.settle()s the springs */
	function relayout() {
		var ev = document.createEvent('Event');
		ev.initEvent('resize', false, false);
		window.dispatchEvent(ev);
	}

	function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

	function begin() {
		if (startedAt) return;
		startedAt = Date.now();
		var date = new Date();
		state = {
			ready: false,
			pose: null,
			asleep: inClockWindow(date, cat_quiet_from, cat_quiet_to, false)
		};

		Guard.run('still', function () {
			/* no blink, eye dart or ear flick may start, so none is caught half-way */
			Alive.asleep(true);

			var span = Math.max(0, 100 - Rig.size.w - 12);
			var x = 6 + Math.round(Math.random() * span);
			var face = Math.random() < 0.5 ? -1 : 1;
			Rig.set('world', 'x', x);
			Rig.face(face);
			relayout();
			state.x = x;
			state.face = face;

			if (state.asleep) {
				/* Cat.init() runs setQuiet(true) - sleep() - and then start(),
				 * whose Actions.stand() stands her up again over the sleep
				 * tweens. Put her properly to bed, and re-assert the bare
				 * wardrobe, since clear() dropped the fade-outs. */
				state.pose = 'asleep';
				Anim.clear();
				Actions.sleep();
				Wardrobe.sync();
			} else {
				state.pose = pick(NAMES);
				POSES[state.pose](Math.random() < 0.5 ? -1 : 1);
			}
		});

		if (!Host.native()) {
			/* a browser tab has no backdrop behind the page */
			document.documentElement.style.background = wall_browser_bg;
			document.body.style.background = wall_browser_bg;
		}
		LOG('still: ' + (state.pose || '?') + (state.asleep ? '' : ' at x ' + state.x) + ', sky ' + Sky.kind());

		/* the deadline is armed now, so it is due before cat.js's first beat,
		 * which was armed (for 2500 ms) a moment earlier, in Cat.init() */
		setTimeout(function () { finish(false); }, STILL_MAX);
		setTimeout(look, STILL_MIN);
	}

	/* every tween done: the loop has dropped back to its base tier by itself.
	 * OFF does not count - a page Chromium thinks hidden has not drawn her. */
	function settled() {
		var t = Anim.tier();
		return t === 'IDLE' || t === 'RESTING';
	}

	function look() {
		if (done) return;
		if (settled()) { finish(true); return; }
		setTimeout(look, STILL_POLL);
	}

	function finish(inTime) {
		if (done) return;
		done = true;
		state.ready = true;
		state.settled = !!inTime || settled();
		state.ms = Date.now() - startedAt;
		state.sky = Sky.kind();
		state.outfit = Wardrobe.current() || (state.asleep ? '' : 'plain');
		state.faults = Guard.faults();
		state.hidden = !!document.hidden;      /* for the log: a hidden page draws nothing */
		state.build = cat_build;

		/* nothing on the page moves from here on */
		Timers.freeze();

		var json = JSON.stringify(state);
		LOG('still: ready ' + json);
		var host = window.PhoneForecast;
		if (host && host.stillReady) {
			try { host.stillReady(json); } catch (e) { LOG('still: the host did not take it - ' + e); }
		}
	}

	return {
		active: active,
		begin: begin,
		poses: function () { return NAMES.slice(); },
		state: function () {
			var out = {};
			for (var k in state) if (state.hasOwnProperty(k)) out[k] = state[k];
			return out;
		}
	};
})();
