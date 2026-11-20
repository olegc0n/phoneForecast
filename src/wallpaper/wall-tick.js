/* wall-tick.js - the minute tick, without a clock face.
 *
 * core/clock.js's tick minus everything it draws: it re-arms on the wall-clock
 * minute boundary (a second past it, as clock.js does) and publishes the same
 * `minute` payload the cat listens for. Quiet hours, the outfit and the sky's
 * day/night all hang off it.
 *
 * kick() ticks now and re-arms from here. Wall.show() calls it, because the
 * timer gate stops time for the page while the wallpaper is out of sight: the
 * frozen tick knows nothing about the hours that passed, and the cat must catch
 * up with the real clock before anything is decided.
 *
 * It knows nothing about the cat.                                            */

var WallTick = (function () {
	var timer = null;

	function tick() {
		timer = null;
		var date = new Date();
		var now = Date.now();
		var interval = 60 * 1000;
		/* armed first, so a fault in a subscriber can never stop the tick */
		timer = setTimeout(tick, Math.ceil(now / interval) * interval + 1000 - now);
		Bus.emit('minute', { date: date, now: now });
	}

	function start() {
		if (!timer) tick();
	}

	function kick() {
		if (timer) { clearTimeout(timer); timer = null; }
		tick();
	}

	return { start: start, kick: kick };
})();
