/* settings-ui.js - the gear, and what is behind it.
 *
 * This replaces the chooser that used to be the first thing on screen. That
 * screen asked a question ("forecast or test animations?") that has exactly one
 * answer on a shelf, and it asked it on every power cut - so the display spent
 * fifteen seconds of every restart showing a menu instead of the weather. The
 * forecast now starts immediately and everything that was behind the chooser is
 * behind the gear instead, where it costs nothing until somebody wants it.      */

var SettingsUI = (function () {
	var gear = null;
	var panel = null;
	var open = false;
	var readyAt = 0;

	/* How long after the page is up a tap on the gear is ignored.
	 *
	 * Launching the app is a touch, and the window arrives under the finger
	 * that started it - so the touch-up lands on whatever the app drew there.
	 * The gear is in the top-right, which is exactly where a launcher icon or
	 * the recents button sits, and the result is an app that opens straight
	 * into its own settings dialog. Nobody opens settings in the first second
	 * on purpose, so the cheapest correct answer is to not believe it. */
	var LAUNCH_GRACE = 1500;

	function el(tag, id, html) {
		var d = document.createElement(tag);
		if (id) d.id = id;
		if (html !== undefined) d.innerHTML = html;
		return d;
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

	function field(label, id, value, hint) {
		return '<label for="' + id + '">' + label + '</label>' +
			'<input id="' + id + '" value="' + String(value).replace(/"/g, '&quot;') + '" ' +
			'spellcheck="false" autocapitalize="off" autocorrect="off">' +
			(hint ? '<small>' + hint + '</small>' : '');
	}

	function buildPanel() {
		if (panel) return;
		var s = Settings.get();
		panel = el('div', 'cfg_panel',
			'<b>НАСТРОЙКИ</b>' +

			'<button class="wide" id="cfg_tests">ТЕСТ АНИМАЦИЙ</button>' +

			'<div class="grp">' +
			field('API КЛЮЧ', 'cfg_api', s.api) +
			field('URL API', 'cfg_url', s.api_url, 'без lat/lon') +
			'</div>' +

			'<div class="grp">' +
			'<label>СОН — она спит, анимация остановлена</label>' +
			'<div class="row">' +
			'<span>с</span><input id="cfg_qfrom" type="time" value="' + s.quiet_from + '">' +
			'<span>до</span><input id="cfg_qto" type="time" value="' + s.quiet_to + '">' +
			'</div>' +
			'</div>' +

			'<div id="cfg_msg"></div>' +

			'<button class="wide ok" id="cfg_save">СОХРАНИТЬ</button>' +
			'<button id="cfg_reset">СБРОСИТЬ К ЗАВОДСКИМ</button>' +
			'<button id="cfg_close">ЗАКРЫТЬ</button>');
		document.body.appendChild(panel);

		on(panel, 'click', function (e) {
			var t = e.target || e.srcElement, id = null;
			while (t && t !== panel) { if (t.id) { id = t.id; break; } t = t.parentNode; }
			if (!id) return;
			if (e.stopPropagation) e.stopPropagation();

			if (id === 'cfg_close') { Guard.run('cfg-close', function () { show(false); }); return; }
			if (id === 'cfg_save')  { Guard.run('cfg-save', doSave); return; }
			if (id === 'cfg_reset') { Guard.run('cfg-reset', doReset); return; }
			if (id === 'cfg_tests') {
				/* the test menu is the cat's, and it draws over everything - so
				 * get out of its way rather than stacking two panels */
				Guard.run('cfg-tests', function () { show(false); Cat.tests(true); });
				return;
			}
		});
	}

	function byIdv(id) { var e = byId(id); return e ? e.value : ''; }

	function say(text, bad) {
		var m = byId('cfg_msg');
		if (!m) return;
		m.innerHTML = text || '';
		m.className = bad ? 'bad' : 'ok';
	}

	function doSave() {
		LOG('СОХРАНИТЬ pressed');
		var next = {
			api:        byIdv('cfg_api').replace(/\s+/g, ''),
			api_url:    byIdv('cfg_url').replace(/\s+/g, ''),
			quiet_from: byIdv('cfg_qfrom'),
			quiet_to:   byIdv('cfg_qto')
		};

		if (!next.api) { say('Ключ пуст', true); return; }
		if (!Settings.okUrl(next.api_url)) { say('URL должен начинаться с http', true); return; }
		if (!Settings.okTime(next.quiet_from) || !Settings.okTime(next.quiet_to)) {
			say('Время в формате ЧЧ:ММ', true); return;
		}

		var changed = Settings.save(next);
		if (!changed.length) { say('Без изменений'); return; }

		/* Only a key or endpoint change is worth a call: the allowance is thirty a
		 * day and re-saving the same key must not spend one. */
		var network = changed.indexOf('api') !== -1 || changed.indexOf('api_url') !== -1;
		if (network) {
			say('Сохранено, проверяем…');
			Weather.fetch(Date.now(), new Date(), false, function (why) {
				say(why ? ('Ошибка: ' + why) : 'Готово — прогноз обновлён', !!why);
			});
		} else {
			/* quiet hours are re-read on the next minute tick, so nothing to do */
			say('Сохранено');
		}
	}

	function doReset() {
		var d = Settings.reset();
		var set = function (id, v) { var e = byId(id); if (e) e.value = v; };
		set('cfg_api', d.api);
		set('cfg_url', d.api_url);
		set('cfg_qfrom', d.quiet_from);
		set('cfg_qto', d.quiet_to);
		say('Сброшено к заводским');
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
			set('cfg_api', s.api);
			set('cfg_url', s.api_url);
			set('cfg_qfrom', s.quiet_from);
			set('cfg_qto', s.quiet_to);
			say('');
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
