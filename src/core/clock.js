/* clock.js - the minute tick, re-armed on the wall-clock boundary so the
 * displayed minute never lags behind the real one. Unchanged in behaviour;
 * it now also publishes the tick so the cat can react to time of day.          */

var Clock = (function () {
	var timer = null;

	function tick() {
		var date = new Date();
		var now = Date.now();

		View.update({
			time: pad(date.getHours()) + ':' + pad(date.getMinutes()),
			date: day[date.getDay()] + ', ' + pad(date.getDate()) + '.' + pad(date.getMonth() + 1) + '.' + String(date.getFullYear()).slice(-2)
		}, now);

		if (Weather.due(now)) Weather.fetch(now, date);

		/* Redraw from the stored forecast when the hour turns over. With no
		 * network this is the only thing that keeps the screen honest: the file
		 * holds 48 hours of hourly forecast, and the hour has changed. */
		Weather.rehour(date, now);

		/* keep the daylight progress bar moving between API calls */
		Weather.riseset(View.data('rise'), View.data('set'), date);

		Bus.emit('minute', { date: date, now: now });

		var interval = 60 * 1000;
		var wait = Math.ceil(now / interval) * interval + 1000 - now;
		timer = setTimeout(tick, wait);
	}

	return {
		start: function () { if (!timer) tick(); }
	};
})();
