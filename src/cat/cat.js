/* cat.js - the cat as the rest of the page sees it: init, disable, and a
 * scheduler that keeps her doing something.
 *
 * The scheduler here is deliberately simple - a weighted pick with a recency
 * penalty. The full director (episode pacing, takeover, mood weighting) is
 * phase 5; this is enough to prove the engine and to watch her live on the
 * phone for an hour.                                                           */

var Cat = (function () {
	var alive = false;
	var wx = null;                    /* latest weather payload, or null */
	var recent = [];                  /* last few action names */
	var nextTimer = null;
	var quiet = false;

	var floorY = 0;
	var lastHitX = -999;
	var mode = null;                  /* 'forecast' | 'test' */

	/* ---------------- placement ---------------- */

	function layout() {
		Rig.measure();
		floorY = 100 - Rig.size.h + 0.6;        /* a hair of overhang, so she stands ON the edge */
		Rig.at(Rig.get('world', 'x') || 60, floorY);
		placeHit(true);
		/* paint the placement now rather than on the first animation frame, so
		 * she never flashes at the top-left corner while the page settles      */
		Rig.flush(true);
		Alive.settle();
	}

	function placeHit(force) {
		var hit = byId('cat_hit');
		if (!hit) return;
		var x = Rig.get('world', 'x');
		if (!force && Math.abs(x - lastHitX) < 0.6) return;
		lastHitX = x;
		hit.style.left = (x + Rig.size.w * 0.08) + '%';
		hit.style.top = (floorY + Rig.size.h * 0.1) + '%';
		hit.style.width = (Rig.size.w * 0.84) + '%';
		hit.style.height = (Rig.size.h * 0.9) + '%';
	}

	/* The weather AS IT IS NOW, not as it was when the payload arrived.
	 *
	 * `isNight` is baked in at the moment the payload is derived, and a payload
	 * can sit unchanged for hours - a whole day if the API is down. So sunset
	 * passed and nothing noticed: she kept her cap and sunglasses on into the
	 * dark, and then wore them to bed. Recomputing it from the sunrise and sunset
	 * the payload already carries costs nothing, and means the outfit follows the
	 * sky rather than the network.                                             */
	function wxNow(date) {
		if (!wx) return null;
		if (typeof wx.sunriseMin !== 'number' || typeof wx.sunsetMin !== 'number') return wx;
		var m = date.getHours() * 60 + date.getMinutes();
		var night = (m < wx.sunriseMin || m > wx.sunsetMin);
		if (night === !!wx.isNight) return wx;
		var v = {}, k;
		for (k in wx) if (wx.hasOwnProperty(k)) v[k] = wx[k];
		v.isNight = night;
		return v;
	}

	/* Called every minute, on waking, and after every animation. Wardrobe.set()
	 * skips the slots that are already right, so this is free when nothing has
	 * changed - which is almost always.                                       */
	function dress(date) {
		/* Re-assert the wardrobe first, and unconditionally: a fade cancelled by
		 * Anim.clear() has to be repaired whether she is asleep, mid-animation or
		 * neither. Everything below decides what she SHOULD wear; this makes sure
		 * she is actually wearing what the wardrobe thinks she is. */
		Guard.run('wardrobe-sync', Wardrobe.sync);

		if (quiet) return;                    /* asleep: she wears nothing */

		/* NOT DURING AN ANIMATION.
		 *
		 * This runs on every minute tick, and a scene dresses her on purpose - the
		 * ice cream scene puts her in a cap and sunglasses and then hands her a
		 * cone. The tick was overruling it mid-scene: at nineteen degrees the
		 * weather outfit includes a soda, so a soda appeared in her other paw
		 * while she was holding the ice cream. Reported from the screen as "she
		 * has an ice cream in one hand and juice in the other".
		 *
		 * The wardrobe is re-applied when the animation finishes anyway, so
		 * nothing is lost by waiting.                                          */
		if (Episodes.running()) return;

		Wardrobe.forWeather(wxNow(date || new Date()));
	}

	/* ---------------- the alive layer ---------------- */

	/* Alive writes only the procedural channel, so unlike v1's ambient() this
	 * keeps running THROUGH a scene: she blinks, sways and her tail trails while
	 * an episode drives her body. That was the main reason the episodes looked
	 * dead - in v1 this layer was switched off during exactly them.            */
	function ambient(clock, dt) {
		Alive.step(dt);
		placeHit(false);
	}

	/* ---------------- weighted pick ---------------- */

	var POOL = [
		{ n: 'blink',        w: 6,  f: function () { return Actions.blink(); } },
		{ n: 'slowBlink',    w: 3,  f: function () { return Actions.slowBlink(); } },
		{ n: 'earTwitch',    w: 5,  f: function () { return Actions.earTwitch(); } },
		{ n: 'tailFlick',    w: 5,  f: function () { return Actions.tailFlick(); } },
		{ n: 'whiskers',     w: 3,  f: function () { return Actions.whiskerTwitch(); } },
		{ n: 'lookAround',   w: 4,  f: function () { return Actions.lookAround(); } },
		{ n: 'headTilt',     w: 4,  f: function () { return Actions.headTilt(); } },
		{ n: 'yawn',         w: 3,  f: function () { return Actions.yawn(); } },
		{ n: 'stretch',      w: 3,  f: function () { return Actions.stretch(); } },
		{ n: 'groom',        w: 4,  f: function () { return Actions.groom(); } },
		{ n: 'knead',        w: 2,  f: function () { return Actions.knead(); } },
		{ n: 'shakeOff',     w: 2,  f: function () { return Actions.shakeOff(); } },
		{ n: 'sneeze',       w: 1,  f: function () { return Actions.sneeze(); } },
		{ n: 'hop',          w: 2,  f: function () { return Actions.hop(); } },
		{ n: 'sit',          w: 3,  f: function () { return Actions.sit(); } },
		{ n: 'stand',        w: 2,  f: function () { return Actions.stand(); } },
		{ n: 'wander',       w: 6,  f: function () { return wander(); } }
	];

	function wander() {
		var span = 100 - Rig.size.w;
		return Actions.waddle(Math.round(Math.random() * span));
	}

	/* Weather nudges the weights. The full mapping is phase 6; these are the
	 * ones that come straight out of the payload with no new artwork.          */
	function weight(item) {
		var w = item.w;
		if (recent.indexOf(item.n) !== -1) return 0;
		if (!wx) return w;

		/* same Belarus scale as the wardrobe */
		var cold = wx.temp !== null && wx.temp < -6;
		var hot = wx.temp !== null && wx.temp > 22;
		var rain = wx.precip === 'ra' || wx.precip === 'ra_sn';
		var snow = wx.precip === 'sn';

		if (cold && (item.n === 'sit' || item.n === 'knead')) w *= 3;
		if (cold && (item.n === 'wander' || item.n === 'stretch')) w *= 0.4;
		if (hot && (item.n === 'sit' || item.n === 'yawn')) w *= 2.5;
		if (hot && item.n === 'wander') w *= 0.3;
		if (rain && (item.n === 'shakeOff' || item.n === 'groom')) w *= 2.5;
		if (snow && item.n === 'sneeze') w *= 4;
		if (wx.pressureTrend < -3 && (item.n === 'yawn' || item.n === 'slowBlink')) w *= 3;
		if (wx.wind > 10 && item.n === 'earTwitch') w *= 2;
		return w;
	}

	function pick() {
		var total = 0, i, w = [];
		for (i = 0; i < POOL.length; i++) { w[i] = weight(POOL[i]); total += w[i]; }
		if (total <= 0) return POOL[0];
		var r = Math.random() * total;
		for (i = 0; i < POOL.length; i++) {
			r -= w[i];
			if (r <= 0) return POOL[i];
		}
		return POOL[0];
	}

	/* ---------------- the loop ---------------- */

	function schedule(ms) {
		if (nextTimer) clearTimeout(nextTimer);
		nextTimer = setTimeout(beat, ms);
	}

	/* Her whole life is one loop now. Most beats are small - a blink, a stretch,
	 * a wander - and every so often the loop picks a full activity instead. No
	 * takeover, no separate stage: it all happens on the forecast screen.      */
	function beat() {
		if (!alive || !mode) return;
		Guard.run('beat', function () {
			if (quiet) { schedule(60000); return; }
			if (Episodes.running()) { schedule(3000); return; }

			/* Is one of today's animations due?
			 *
			 * The day was written down at midnight, which is the only way to
			 * guarantee that the narrow scenes actually happen - lunch matches for
			 * one hour, and when the next activity was chosen by a dice roll at
			 * the moment it ran, some days it simply never came up.            */
			if (mode === 'forecast' && cat_activities && (Date.now() - bootAt) > 20000) {
				var when = new Date();
				var slot = Plan.due(when);
				if (slot) {
					var id = slot.id;
					var ep = Episodes.find(id);
					/* The plan only knew last night's forecast. If it says sunbathe
					 * and it is raining by now, swap it out and record that.     */
					if (!ep || !ep.cond(wx, when)) id = Episodes.pick(wx, when);
					if (id) { Plan.markDone(slot, id); play(id); return; }
					Plan.skip(slot);
				}
			}

			var item = pick();
			var dur = item.f() || 400;

			recent.push(item.n);
			while (recent.length > 3) recent.shift();

			var gap = 700 + Math.random() * 2600 + (dur > 1500 ? 1400 : 0);
			schedule(dur + gap);
		});
	}

	/* ---------------- activities ---------------- */

	var bootAt = 0;

	/* play one by name - the life loop, the test menu and adb all come here */
	function play(id) {
		if (Episodes.running()) return;
		Episodes.play(id, function () {
			layout();
			/* A scene may have left an ice cream in her hand or a hat on her head;
			 * put her back into what the weather actually calls for. */
			Guard.run('dress', function () { dress(new Date()); });
			Actions.setPosture('STAND');
			Anim.to('IDLE');
			if (mode === 'test') showMenu(true);
			schedule(1800);
		});
		if (mode === 'test') showMenu(false);
	}

	/* ---------------- the back button ---------------- */

	/* Step out of whatever she is doing and offer the chooser again.
	 *
	 * Until now the back button was swallowed, so the only way to get from the
	 * forecast to the test menu was to kill the app and start it over.
	 *
	 * One press is enough, and it abandons whatever is running on the way. An
	 * earlier version made a running animation absorb the first press, which
	 * read as a dead button - with a hundred and twenty animations a day
	 * something usually is running. A press at the chooser itself is left to
	 * Android, so the app can still be closed.
	 *
	 * Returns true if we handled it.                                          */
	function back() {
		if (!alive || !mode) return false;      /* at the chooser: let Android have it */
		Guard.run('back', toChooser);           /* aborts a running animation on the way */
		return true;
	}

	function toChooser() {
		if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
		try { Episodes.abort(); } catch (e) {}
		Anim.clear();
		Props.clear();
		Rig.resetAll();
		showMenu(false);
		mode = null;
		layout();
		Actions.setPosture('STAND');
		Actions.stand();
		Anim.to('IDLE');
		buildStartScreen();
	}

	/* ---------------- quiet hours ---------------- */	/* ---------------- quiet hours ---------------- */

	function inQuiet(date) { return inClockWindow(date, cat_quiet_from, cat_quiet_to, false); }

	function setQuiet(on) {
		if (quiet === on) return;
		quiet = on;
		if (on) {
			Anim.clear();
			Alive.mood('sleepy');
			Actions.sleep();
			/* Let the curl finish, then park the loop AND lower its floor. The
			 * floor is what was missing: without it the first blink of the night
			 * lifted her to ACTIVE and dropped her back to IDLE, so one twitch at
			 * midnight left the loop at 8 fps until morning instead of 2.      */
			/* Nothing is worn in bed. A cap and sunglasses on a sleeping cat is
			 * the one thing nobody would animate on purpose.                  */
			Wardrobe.bare();
			setTimeout(function () {
				if (!quiet) return;
				Alive.asleep(true);
				Anim.base('RESTING');
				Anim.to('RESTING');
			}, 1200);
		} else {
			Alive.asleep(false);
			Anim.base('IDLE');
			Anim.to('IDLE');
			Actions.wake();
			dress(new Date());                /* dressed again for the day */
			schedule(2000);
		}
	}

	/* ---------------- touch ---------------- */

	var pressTimer = null;

	function bindTouch() {
		var hit = byId('cat_hit');
		if (!hit || !cat_touch) return;

		function greet(e) {
			if (e && e.stopPropagation) e.stopPropagation();
			Guard.run('touch', function () {
				if (Episodes.running()) Episodes.abort();
				if (quiet) { setQuiet(false); return; }
				Anim.clear();
				Actions.purr();
				popHearts();
			});
		}

		on(hit, 'click', greet);
		on(hit, 'touchstart', function () {
			pressTimer = setTimeout(function () {
				Guard.run('longpress', function () { Anim.clear(); Actions.sleep(); });
			}, 900);
		});
		on(hit, 'touchend', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
		on(hit, 'touchmove', function () { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } });
	}

	/* ---------------- the launch chooser ---------------- */

	/* Two ways in: watch the forecast, or sit and review the animations.
	 *
	 * It cannot block forever - this thing lives on a shelf and restarts by
	 * itself after a power cut, so with nobody there it counts down and goes to
	 * the forecast on its own.                                                 */
	function buildStartScreen() {
		if (byId('cat_start')) return;          /* two quick backs, one chooser */
		var el = document.createElement('div');
		el.id = 'cat_start';
		el.innerHTML =
			'<h1>' + cat_name + '</h1>' +
			'<p>Выберите режим</p>' +
			'<button data-go="forecast">Прогноз</button>' +
			'<button class="alt" data-go="test">Тест анимаций</button>' +
			'<small id="cat_start_tick">&nbsp;</small>';
		document.body.appendChild(el);

		var left = cat_start_timeout;
		var tick = byId('cat_start_tick');
		var timer = setInterval(function () {
			left--;
			if (tick) tick.innerHTML = 'Прогноз через ' + left + '&hellip;';
			if (left <= 0) { clearInterval(timer); choose('forecast'); }
		}, 1000);
		if (tick) tick.innerHTML = 'Прогноз через ' + left + '&hellip;';

		function choose(what) {
			clearInterval(timer);
			if (el.parentNode) el.parentNode.removeChild(el);
			start(what);
		}

		on(el, 'click', function (e) {
			var t = e.target || e.srcElement, go = null;
			while (t && t !== el) {
				if (t.getAttribute) { go = t.getAttribute('data-go'); if (go) break; }
				t = t.parentNode;
			}
			if (!go) return;
			if (e.stopPropagation) e.stopPropagation();
			Guard.run('choose', function () { choose(go); });
		});
	}

	function start(what) {
		mode = what;
		if (what === 'test') {
			if (!menu) buildTestMenu();
			showMenu(true);
			return;
		}
		/* forecast mode: small cat at the floor, big episodes now and then */
		Actions.stand();
		schedule(2500);
	}

	/* ---------------- hearts, and the test menu ---------------- */

	function popHearts() {
		var b = Rig.bounds();
		for (var i = 0; i < 3; i++) {
			(function (k) {
				var h = Props.put('heart', b.x + b.w * (0.3 + k * 0.18), b.y + b.h * 0.1, b.w * 0.22, 9);
				Anim.tween(h, 'o', 0.95, 300, 'out', k * 140);
				Anim.tween(h, 'y', -Rig.stagePx().h * 0.1, 1500, 'out', k * 140);
				Anim.tween(h, 'x', (k % 2 ? 1 : -1) * 12, 1500, 'io', k * 140);
				Anim.tween(h, 'o', 0, 500, 'io', k * 140 + 1000, function () { Props.drop(h); });
			})(i);
		}
	}

	var menu = null;

	function buildTestMenu() {
		var list = Episodes.list();
		menu = document.createElement('div');
		menu.id = 'cat_menu';

		/* Sleep is not an episode - it is what she does for eleven hours a night -
		 * so it never appeared in this list, and there was no way to look at it
		 * without waiting until eleven at night.                              */
		var html = '<b>EPISODES &mdash; tap to play</b>' +
			'<button class="wide" data-plan="1">TODAY&rsquo;S SCHEDULE</button>' +
			'<button class="wide" data-act="sleep">SLEEP &mdash; quiet hours</button>' +
			'<button class="wide" data-act="wake">WAKE UP</button>' +
			'<div id="cat_plan_slot"></div>';
		for (var i = 0; i < list.length; i++) {
			html += '<button data-ep="' + list[i].id + '">' + (i + 1) + '. ' + list[i].label +
				'  <span style="color:#7a8a6a">' + Math.round(list[i].dur / 1000) + 's</span></button>';
		}
		menu.innerHTML = html;
		document.body.appendChild(menu);

		on(menu, 'click', function (e) {
			var t = e.target || e.srcElement;
			var id = null, wantPlan = null, act = null;
			while (t && t !== menu) {
				if (t.getAttribute) {
					wantPlan = t.getAttribute('data-plan');
					if (wantPlan) break;
					act = t.getAttribute('data-act');
					if (act) break;
					id = t.getAttribute('data-ep');
					if (id) break;
				}
				t = t.parentNode;
			}
			if (e.stopPropagation && (id || wantPlan || act)) e.stopPropagation();
			if (wantPlan) { Guard.run('test-plan', togglePlanView); return; }
			if (act) {
				/* the real quiet-hours path, so what you see is what happens at
				 * eleven at night - the curl, the dim screen, the parked loop */
				Guard.run('test-' + act, function () {
					showMenu(false);
					setQuiet(act === 'sleep');
					setTimeout(function () { if (mode === 'test') showMenu(true); }, 4000);
				});
				return;
			}
			if (id) Guard.run('test-play', function () { play(id); });
		});
	}

	/* Today's schedule on the phone itself. The adb dump is fine at a desk with a
	 * cable; this is for standing in front of the shelf wondering what she is
	 * going to do next.                                                        */
	function togglePlanView() {
		var slot = byId('cat_plan_slot');
		if (!slot) return;
		if (slot.innerHTML) { slot.innerHTML = ''; return; }

		var slots = Plan.slots();
		if (!slots.length) { slot.innerHTML = '<div id="cat_plan_view">no plan yet</div>'; return; }

		var names = {}, list = Episodes.list(), i;
		for (i = 0; i < list.length; i++) names[list[i].id] = list[i].label;

		var st = Plan.stats();
		var now = new Date();
		var nowM = now.getHours() * 60 + now.getMinutes();
		var nextSeen = false;

		var html = '<div id="cat_plan_view"><div class="hd">' + st.day + ' &middot; ' +
			st.total + ' animations &middot; ' + st.done + ' done';
		if (st.missed) html += ' &middot; ' + st.missed + ' missed';
		html += '</div>';

		for (i = 0; i < slots.length; i++) {
			var s = slots[i];
			var cls = s.done === 1 ? 'done' : (s.done === 2 ? 'miss' : '');
			if (!cls && !nextSeen && s.m >= nowM) { cls = 'next'; nextSeen = true; }
			html += '<div class="row ' + cls + '"><b>' + Plan.clock(s.m) + '</b><i>' +
				(names[s.sub || s.id] || s.sub || s.id) +
				(s.sub ? ' (instead of ' + (names[s.id] || s.id) + ')' : '') +
				'</i></div>';
		}
		slot.innerHTML = html + '</div>';
	}

	function showMenu(on) {
		if (!menu) return;
		menu.style.display = on ? '' : 'none';
	}

	/* ---------------- debug overlay ---------------- */

	function buildDebug() {
		var d = document.createElement('div');
		d.id = 'cat_debug';
		document.body.appendChild(d);
		setInterval(function () {
			var b = Rig.bounds();
			var stage = byId('cat_stage');
			var ua = navigator.userAgent.match(/Chrome\/[\d.]+/);
			d.innerHTML = [
				'fps ' + Anim.fps() + ' ' + Anim.tier() + (quiet ? ' QUIET' : ''),
				'faults ' + Guard.faults() + (Guard.faults() ? ' ' + Guard.message() : ''),
				'store ' + (Store.persistent() ? 'disk' : 'MEMORY'),
				'wx ' + (wx ? wx.code + ' ' + wx.temp + 'C' : 'none'),
				'wearing ' + (Wardrobe.current() || 'plain'),
				'mode ' + (mode || 'choosing') + '  episode ' + (Episodes.running() || '-'),
				planLine(),
				'next ' + (Plan.upcoming(new Date(), 2).join('  ') || '-'),
				'pos ' + Math.round(b.x) + ',' + Math.round(b.y) + ' floor ' + Math.round(floorY),
				'stage ' + (stage ? stage.offsetWidth + 'x' + stage.offsetHeight : '-'),
				'tail ' + Math.round(Rig.biasOf('tail3', 'rot')) + ' neck ' + Rig.biasOf('neck', 'rot').toFixed(2),
				'host ' + Host.name() + (Host.sdk() ? ' sdk' + Host.sdk() : ''),
				ua ? ua[0] : 'ua?'
			].join('<br>');
		}, 1000);
	}

	/* one line of the day's schedule, for the overlay */
	function planLine() {
		var st = Plan.stats();
		return 'plan ' + (st.day || '-') + ' ' + st.done + '/' + st.total +
			' uniq' + st.unique + (st.missed ? ' miss' + st.missed : '') +
			(st.substituted ? ' sub' + st.substituted : '');
	}

	/* Print today's schedule. Reachable from the test menu and from
	 *   adb shell am start -n com.lili.informer/.MainActivity -e plan 1
	 * which is much easier than squinting at an overlay.                       */
	function dumpPlan() {
		var lines = Plan.lines();
		console.log('=== Lili plan ' + Plan.day() + ' - ' + lines.length + ' animations ===');
		for (var i = 0; i < lines.length; i++) console.log(lines[i]);
		var st = Plan.stats(), ids = [];
		for (var k in st.byId) if (st.byId.hasOwnProperty(k)) ids.push(k + ' x' + st.byId[k]);
		ids.sort();
		console.log('--- ' + st.unique + ' distinct: ' + ids.join(', '));
		return lines;
	}

	/* WARN WHEN THE FORECAST IS WRONG, NOT WHEN IT IS OLD.
	 *
	 * An old file used to mean a wrong screen, so age was the right thing to
	 * warn about. It is not any more: the file holds 48 hours of hourly forecast
	 * and the app reads the entry for the current hour, so a file written
	 * yesterday morning still shows what this hour was forecast to be. Warning
	 * about its age would be crying wolf on a screen that is correct.
	 *
	 * The real failure is running off the end of the hourly list - then the app
	 * falls back to the last observation, which is genuinely stale. That is what
	 * `source: 'stale-fact'` means, and that is when to say so. A few hours of
	 * warning before it happens is worth having too.                          */
	var COVER_WARN = 3;             /* hours of forecast left before saying anything */

	function showStale(now) {
		var el = byId('wx_stale');
		if (!el) return;
		var st = Weather.status();

		if (st.ageMin < 0) { el.style.display = 'none'; return; }

		var dead = st.source === 'stale-fact';
		if (!dead && st.coverH > COVER_WARN) { el.style.display = 'none'; return; }

		var age = st.ageMin >= 60
			? Math.floor(st.ageMin / 60) + ' ч ' + (st.ageMin % 60) + ' мин'
			: st.ageMin + ' мин';

		el.innerHTML = (dead
				? 'прогноз закончился &mdash; данные от ' +
				  pad(st.at.getHours()) + ':' + pad(st.at.getMinutes())
				: 'прогноз кончится через ' + st.coverH + ' ч') +
			'<br>последний ответ ' + age + ' назад' +
			(st.error ? ' &middot; ' + st.error : '');
		el.style.display = '';
	}

	/* ---------------- lifecycle ---------------- */

	function init() {
		if (!cat_enabled) return;

		Rig.init();
		Plan.init(function () { return Episodes.planLibrary(); });
		Anim.setFps(cat_fps);
		Anim.ambient(ambient);
		layout();
		Props.init();
		bindTouch();
		if (cat_debug) buildDebug();

		on(window, 'resize', function () { Guard.run('layout', layout); });

		/* `true` = replay: boot.js paints the stored forecast before starting the
		 * cat, so the first payload is normally already gone by the time we get
		 * here. Without this she starts every restart not knowing the weather. */
		Bus.on('weather', function (w) {
			var first = !wx;
			wx = w;
			/* The plan built at boot had no forecast at all. Once the first one
			 * lands, rewrite the rest of the day with it. */
			if (first) Guard.run('plan-first', function () { Plan.rebuildRest(new Date(), w); });
			Guard.run('wardrobe', function () { dress(new Date()); });
			Guard.run('alive-weather', function () {
				Alive.wind(w.wind, w.windAngle);
				if (w.isNight) Alive.mood('sleepy');
				else if (w.isThunder || (w.temp !== null && w.temp < -6)) Alive.mood('alert');
				else if (w.precip === 'ra' || w.precip === 'ra_sn') Alive.mood('sad');
				else Alive.mood('calm');
			});
			Guard.run('weather-react', function () {
				if (first) return;
				if (w.isThunder) Actions.startle();
				else if (w.precip === 'ra' || w.precip === 'ra_sn') Actions.earsFlat(true);
				else Actions.earsFlat(false);
				if (w.temp !== null && w.temp < -8) Actions.shiver();
				else if (w.temp !== null && w.temp > 26) Actions.pant();
			});
		}, true);

		/* A forecast that is hours old looks exactly like a fresh one, which is
		 * how "+14 and cloudy" stayed on screen through +19 and raining. The badge
		 * says nothing at all until the data is over STALE_MIN old, so it is an
		 * alarm rather than furniture.                                         */
		Bus.on('minute', function (m) {
			Guard.run('stale', function () { showStale(m.now); });
		});

		Bus.on('minute', function (m) {
			Guard.run('minute', function () { setQuiet(inQuiet(m.date)); });
			Guard.run('dress', function () { dress(m.date); });
			/* The 00:00 call is the one that matters: the date rolls over and a
			 * fresh day gets written. The rest are no-ops. */
			Guard.run('plan', function () { Plan.ensure(m.date, wx); });
		});

		on(document, 'visibilitychange', function () {
			if (document.hidden) Anim.to('OFF');
			else if (!quiet) Anim.to('IDLE');
		});

		alive = true;
		bootAt = Date.now();
		Guard.run('plan', function () { Plan.ensure(new Date(), wx); });
		Anim.to('IDLE');
		setQuiet(inQuiet(new Date()));

		if (cat_test) start('test');                 /* build-time shortcut for dev */
		else if (cat_start_menu) buildStartScreen();
		else start('forecast');
	}

	function disable() {
		alive = false;
		if (nextTimer) { clearTimeout(nextTimer); nextTimer = null; }
		try { Episodes.abort(); } catch (e) {}
		try { Anim.clear(); Anim.to('OFF'); } catch (e) {}
		try { Rig.hide(); } catch (e) {}
		var stage = byId('cat_stage');
		if (stage) stage.style.display = 'none';
	}

	return {
		init: init,
		disable: disable,
		play: play,
		back: back,
		plan: dumpPlan,
		weather: function () { return wx; }
	};
})();
