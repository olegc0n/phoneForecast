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
	/* ---- forecast ---- */
	View.register();
	on(document.body, 'click', function () { fullscreen(); });

	var date = new Date();
	var now = Date.now();

	/* paint the cached response before the network is even attempted, so a
	 * reload or a power-cut restart shows the weather immediately             */
	Weather.restore(date, now);
	Clock.start();

	/* ---- cat ---- */
	Guard.run('init', function () { Cat.init(); });
});
