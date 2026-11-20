/* saver-clock.js - the time, and the minute tick.
 *
 * The screen saver's half of core/clock.js: no date, no forecast, just the
 * time in the system's own 12/24-hour format. It re-arms on the wall-clock
 * minute boundary exactly as core/clock.js does, so the minute shown never lags
 * the real one, and it publishes the same `minute` payload the cat listens for.
 *
 * It knows nothing about the cat, and it is started before anything optional,
 * so whatever happens to her the clock keeps going.                          */

var SaverClock = (function () {
	var timer = null;

	/* the phone's setting when there is a phone; 24-hour in a browser tab */
	function is24h() {
		try {
			var host = window.PhoneForecast;
			if (host && host.is24h) return !!host.is24h();
		} catch (e) {}
		return true;
	}

	function text(date) {
		var h = date.getHours(), m = date.getMinutes();
		if (is24h()) return pad(h) + ':' + pad(m);
		return (h % 12 || 12) + ':' + pad(m);
	}

	function paint(date) {
		var el = byId('sv_time');
		if (el) el.textContent = text(date || new Date());
	}

	function tick() {
		var date = new Date();
		var now = Date.now();
		paint(date);
		Bus.emit('minute', { date: date, now: now });

		var interval = 60 * 1000;
		var wait = Math.ceil(now / interval) * interval + 1000 - now;
		timer = setTimeout(tick, wait);
	}

	return {
		paint: function () { paint(new Date()); },
		start: function () { if (!timer) tick(); },
		text: text
	};
})();
