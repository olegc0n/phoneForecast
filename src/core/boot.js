/* boot.js - startup order, and the one place the two halves meet.
 *
 * The forecast is started first and unconditionally. The cat is started last,
 * inside the guard, so nothing about it can prevent the clock from running.    */

function fullscreen() {
	var e = document.documentElement;
	if (e.requestFullscreen && !document.fullscreenElement) e.requestFullscreen();
	else if (e.webkitRequestFullscreen && !document.webkitFullscreenElement) e.webkitRequestFullscreen();
}

on(window, 'load', function () {
	LOG('=== page load === build ' + cat_build + ' at ' + location.href);

	/* Every touch and click, with where it landed and what it hit, before any
	 * handler can swallow it. This is the line that settles whether a dialog
	 * opened itself or something pressed it. */
	onCapture(document, 'touchstart', function (e) {
		var t = e.touches && e.touches[0];
		LOG('touchstart at ' + (t ? Math.round(t.clientX) + ',' + Math.round(t.clientY) : '?') +
			' on ' + LOGtarget(e.target));
	});
	onCapture(document, 'click', function (e) {
		LOG('click at ' + Math.round(e.clientX) + ',' + Math.round(e.clientY) +
			' on ' + LOGtarget(e.target));
	});
	onCapture(document, 'visibilitychange', function () {
		LOG('visibilitychange hidden=' + document.hidden);
	});
	/* ---- forecast ---- */
	/* the words of the static markup, in the phone's language (i18n.js) */
	I18n.paint(document);
	LOG('language ' + I18n.lang() + ' (from ' + I18n.how() + ')');
	View.register();
	on(document.body, 'click', function () { fullscreen(); });

	/* Before anything reads the place or the quiet hours: whatever was set on
	 * the phone wins over what the build shipped (which is no place at all). */
	Settings.load();
	LOG('settings applied: place=' + (place_lat === null ? '(none - asking for nothing)' : place_name) +
		' sleep=' + cat_quiet_from + '-' + cat_quiet_to);

	var date = new Date();
	var now = Date.now();

	/* paint the cached response before the network is even attempted, so a
	 * reload or a power-cut restart shows the weather immediately; with no
	 * place, show the prompt to choose one instead                            */
	Weather.restore(date, now);
	Clock.start();

	/* ---- cat ---- */
	Guard.run('init', function () { Cat.init(); });

	/* ---- the gear ----
	 * Last, and in its own guard: the settings dialog must never be what stops
	 * the forecast from appearing. */
	Guard.run('settings', function () { SettingsUI.init(); });
	LOG('=== boot complete ===');
});
