/* settings-ui.js - the gear, and what is behind it.
 *
 * This replaces the chooser that used to be the first thing on screen. That
 * screen asked a question ("forecast or test animations?") that has exactly one
 * answer on a shelf, and it asked it on every power cut - so the display spent
 * fifteen seconds of every restart showing a menu instead of the weather. The
 * forecast now starts immediately and everything that was behind the chooser is
 * behind the gear instead, where it costs nothing until somebody wants it.
 *
 * Behind it:
 *   - the animation test list;
 *   - the CITY: what the forecast is for. Type a name and search (Open-Meteo's
 *     place search), tap a result; or "use my location" in the APK. Choosing
 *     applies at once and asks for the new forecast - there is nothing to save.
 *   - the SLEEP hours, saved with the save button;
 *   - where the weather comes from, and what is sent to get it.             */

var SettingsUI = (function () {
	var gear = null;
	var panel = null;
	var open = false;
	var readyAt = 0;
	var found = [];               /* the last search's results, as buttons cfg_res_<i> */
	var searching = false;

	/* How long after the page is up a tap on the gear is ignored.
	 *
	 * Launching the app is a touch, and the window arrives under the finger
	 * that started it - so the touch-up lands on whatever the app drew there.
	 * The gear is in the top-right, which is exactly where a launcher icon or
	 * the recents button sits, and the result is an app that opens straight
	 * into its own settings dialog. Nobody opens settings in the first second
	 * on purpose, so the cheapest correct answer is to not believe it. */
	var LAUNCH_GRACE = 1500;

	/* Places' error codes that have their own words: loc_<code> in i18n.js */
	var LOCATE_ERRORS = ['denied', 'off', 'timeout', 'unavailable'];

	var T = I18n.t;

	function el(tag, id, html) {
		var d = document.createElement(tag);
		if (id) d.id = id;
		if (html !== undefined) d.innerHTML = html;
		return d;
	}

	/* names come from the network and the phone's geocoder: text, never markup */
	function esc(s) {
		return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
	}

	/* ---------------- the gear ---------------- */

	function buildGear() {
		if (gear) return;
		gear = el('div', 'cfg_gear',
			'<svg viewBox="0 0 24 24" width="100%" height="100%">' +
			'<path fill="currentColor" d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.62-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.5.42l-.36 2.54c-.59.24-1.13.56-1.62.94l-2.39-.96a.5.5 0 0 0-.6.22L2.67 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.31.6.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.04.24.25.42.5.42h3.84c.25 0 .46-.18.5-.42l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.09.47 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.6A3.6 3.6 0 1 1 12 8.4a3.6 3.6 0 0 1 0 7.2z"/>' +
			'</svg>');
		document.body.appendChild(gear);
		on(gear, 'click', function (e) {
			if (e.stopPropagation) e.stopPropagation();
			var since = Date.now() - readyAt;
			LOG('gear clicked, ' + since + 'ms since ready' +
				(since < LAUNCH_GRACE ? ' -> IGNORED (launch grace)' : ' -> opening'));
			if (Date.now() - readyAt < LAUNCH_GRACE) return;   /* the tap that started the app */
			Guard.run('cfg-open', function () { show(true); });
		});
	}

	/* ---------------- the dialog ---------------- */

	function buildPanel() {
		if (panel) return;
		var s = Settings.get();
		panel = el('div', 'cfg_panel',
			'<b>' + T('cfg_title') + '</b>' +

			'<button class="wide" id="cfg_tests">' + T('cfg_tests') + '</button>' +

			'<div class="grp">' +
			'<label>' + T('cfg_city') + '</label>' +
			'<div id="cfg_place"></div>' +
			'<div id="cfg_now"></div>' +
			'<div id="cfg_wx"></div>' +
			'<div class="row">' +
			'<input id="cfg_city" placeholder="' + esc(T('cfg_city_hint')) + '" ' +
			'spellcheck="false" autocapitalize="words" autocorrect="off">' +
			'<button id="cfg_find" class="mini">' + T('cfg_find') + '</button>' +
			'</div>' +
			'<div id="cfg_results"></div>' +
			'<button id="cfg_locate">' + T('cfg_locate') + '</button>' +
			'<div id="cfg_pmsg"></div>' +
			'</div>' +

			'<div class="grp">' +
			'<label>' + T('cfg_sleep') + '</label>' +
			'<div class="row">' +
			'<span>' + T('cfg_from') + '</span><input id="cfg_qfrom" type="time" value="' + s.quiet_from + '">' +
			'<span>' + T('cfg_to') + '</span><input id="cfg_qto" type="time" value="' + s.quiet_to + '">' +
			'</div>' +
			'</div>' +

			'<div id="cfg_msg"></div>' +

			'<button class="wide ok" id="cfg_save">' + T('cfg_save') + '</button>' +
			'<button id="cfg_reset">' + T('cfg_reset') + '</button>' +
			'<button id="cfg_close">' + T('cfg_close') + '</button>' +

			'<div class="grp credits">' +
			'<label>' + T('cfg_data') + '</label>' +
			'<small>' + T('cfg_credit_om') + '</small>' +
			'<small>' + T('cfg_credit_met') + '</small>' +
			'<small>' + T('cfg_credit_geo') + '</small>' +
			'<small>' + T('cfg_credit_sent') + '</small>' +
			'</div>');
		document.body.appendChild(panel);

		on(panel, 'click', function (e) {
			var t = e.target || e.srcElement, id = null;
			while (t && t !== panel) { if (t.id) { id = t.id; break; } t = t.parentNode; }
			if (!id) return;
			if (e.stopPropagation) e.stopPropagation();

			if (id === 'cfg_close')  { Guard.run('cfg-close', function () { show(false); }); return; }
			if (id === 'cfg_save')   { Guard.run('cfg-save', doSave); return; }
			if (id === 'cfg_reset')  { Guard.run('cfg-reset', doReset); return; }
			if (id === 'cfg_find')   { Guard.run('cfg-find', doSearch); return; }
			if (id === 'cfg_locate') { Guard.run('cfg-locate', doLocate); return; }
			if (id.indexOf('cfg_res_') === 0) {
				var r = found[Number(id.slice(8))];
				if (r) Guard.run('cfg-choose', function () { choose(Places.join(r.name, r.country), r.lat, r.lon); });
				return;
			}
			if (id === 'cfg_tests') {
				/* the test menu is the cat's, and it draws over everything - so
				 * get out of its way rather than stacking two panels */
				Guard.run('cfg-tests', function () { show(false); Cat.tests(true); });
				return;
			}
		});

		on(byId('cfg_city'), 'keydown', function (e) {
			if ((e.keyCode || e.which) !== 13) return;
			if (e.preventDefault) e.preventDefault();
			Guard.run('cfg-find', doSearch);
		});
	}

	function byIdv(id) { var e = byId(id); return e ? e.value : ''; }

	function put(id, html, cls) {
		var m = byId(id);
		if (!m) return;
		m.innerHTML = html || '';
		if (cls !== undefined) m.className = cls;
	}

	/* both take markup from the table; anything from outside goes through esc() */
	function say(html, bad) { put('cfg_msg', html || '', bad ? 'bad' : 'ok'); }
	function sayPlace(html, bad) { put('cfg_pmsg', html || '', bad ? 'bad' : 'ok'); }

	function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
	function signed(t) { return (t > 0 ? '+' : '') + t; }

	/* the place line, the weather there now, and how its forecast is doing */
	function showPlace() {
		var s = Settings.get();
		put('cfg_place', s.place_lat === null ? T('place_none') : esc(s.place_name),
			s.place_lat === null ? 'none' : '');
		var st = Weather.status(), t = '', n = '';
		if (st.place) {
			if (st.inflight) t = T('st_loading');
			else if (st.at) {
				var today = new Date().toDateString() === st.at.toDateString();
				t = T('st_updated', (today ? '' : I18n.dayMonth(st.at) + ' ') + hm(st.at)) +
					(st.from ? ' \u00b7 ' + st.from : '') + (st.error ? ' \u00b7 ' + T('st_last_failed') : '');
			} else t = T('st_no_data') + (st.error ? ' (' + esc(st.error) + ')' : '');
			t += ' \u00b7 ' + T('st_calls', st.calls, st.limit);
			var w = st.now;
			if (w && typeof w.temp === 'number') {
				n = T('st_now', signed(w.temp), I18n.condition(w.icon), I18n.compass(w.angle),
					typeof w.wind === 'number' ? w.wind : '', T('unit_wind'));
			}
		}
		put('cfg_now', n);
		put('cfg_wx', t);
		var loc = byId('cfg_locate');
		if (loc) loc.style.display = Places.canLocate() ? 'block' : 'none';
	}

	function showResults(list) {
		found = list || [];
		var html = '';
		for (var i = 0; i < found.length; i++) {
			var w = Places.where(found[i]);
			html += '<button class="res" id="cfg_res_' + i + '"><span>' + esc(found[i].name) + '</span>' +
				(w ? '<small>' + esc(w) + '</small>' : '') + '</button>';
		}
		put('cfg_results', html);
	}

	function doSearch() {
		var q = byIdv('cfg_city').replace(/\s+/g, ' ').trim();
		var input = byId('cfg_city');
		if (!q) { sayPlace(T('msg_type_city'), true); if (input) input.focus(); return; }
		if (searching) return;
		if (input) input.blur();                /* the keyboard covers the results */
		searching = true;
		showResults([]);
		sayPlace(T('msg_searching'));
		LOG('city search');
		Places.search(q, function (why, list) {
			searching = false;
			if (why) { sayPlace(T('msg_search_failed', esc(why)), true); return; }
			if (!list.length) { sayPlace(T('msg_not_found', esc(q)), true); return; }
			sayPlace(T(list.length === 1 ? 'msg_pick_one' : 'msg_pick'));
			showResults(list);
		});
	}

	function doLocate() {
		sayPlace(T('msg_locating'));
		Places.locate(function (why, p) {
			if (why) { sayPlace(T(LOCATE_ERRORS.indexOf(why) !== -1 ? 'loc_' + why : 'loc_failed'), true); return; }
			choose(p.name, p.lat, p.lon);
		});
	}

	/* A place from either way: kept, and its forecast asked for now. */
	function choose(name, lat, lon) {
		var changed = Settings.setPlace(name, lat, lon);
		showResults([]);
		var city = byId('cfg_city');
		if (city) city.value = '';
		if (!changed) {
			showPlace();
			sayPlace(T(Settings.get().place_lat === null ? 'msg_not_a_place' : 'msg_same_city'));
			return;
		}
		LOG('place chosen');
		sayPlace(T('st_loading'));
		Weather.placeChanged(function (why) {
			sayPlace(why ? T('msg_failed', esc(why)) : T('msg_done'), !!why);
			showPlace();
		});
		showPlace();
	}

	function doSave() {
		LOG('save pressed');
		var next = {
			quiet_from: byIdv('cfg_qfrom'),
			quiet_to:   byIdv('cfg_qto')
		};
		if (!Settings.okTime(next.quiet_from) || !Settings.okTime(next.quiet_to)) {
			say(T('msg_bad_time'), true); return;
		}
		var changed = Settings.save(next);
		/* quiet hours are re-read on the next minute tick, so nothing to do */
		say(T(changed.length ? 'msg_saved' : 'msg_unchanged'));
	}

	function doReset() {
		var d = Settings.reset();
		var set = function (id, v) { var e = byId(id); if (e) e.value = v; };
		set('cfg_qfrom', d.quiet_from);
		set('cfg_qto', d.quiet_to);
		say(T('msg_reset', d.quiet_from, d.quiet_to));
	}

	function show(on) {
		LOG('SettingsUI.show(' + on + ') wasOpen=' + open);
		buildPanel();
		open = !!on;
		/* an explicit value, not '': the stylesheet now says none, so
		   clearing the inline style would hide the panel we just opened */
		panel.style.display = open ? 'block' : 'none';
		if (gear) gear.style.display = open ? 'none' : 'block';
		if (open) {
			var s = Settings.get();
			var set = function (id, v) { var e = byId(id); if (e) e.value = v; };
			set('cfg_qfrom', s.quiet_from);
			set('cfg_qto', s.quiet_to);
			showResults([]);
			showPlace();
			say('');
			sayPlace('');
		}
	}

	function init() {
		readyAt = Date.now();
		LOG('SettingsUI.init() readyAt set');
		buildGear();
	}

	return {
		init: init,
		show: show,
		isOpen: function () { return open; }
	};
})();
