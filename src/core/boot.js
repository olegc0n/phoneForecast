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
	View.register();
	on(document.body, 'click', function () { fullscreen(); });

	/* Before anything reads `api`, `api_url` or the quiet hours: whatever was set
	 * on the phone wins over what the build shipped. */
	Settings.load();
	LOG('settings applied: key=...' + String(api).slice(-6) + ' url=' + api_url +
		' sleep=' + cat_quiet_from + '-' + cat_quiet_to);

	var date = new Date();
	var now = Date.now();

	/* The sky block, before the cached forecast is painted, so the first paint
	 * already has its sky. It is decoration and catches its own faults: nothing
	 * it does can stop the clock below it. */
	if (typeof Sky !== 'undefined') Sky.init();

	/* paint the cached response before the network is even attempted, so a
	 * reload or a power-cut restart shows the weather immediately             */
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
