/* weather.js - fetch, cache, parse, publish.
 *
 * Three changes from the original, all about surviving a shelf:
 *   1. the last good response is cached, so a reload paints instantly instead
 *      of showing an empty screen until the next hourly call;
 *   2. a failed call retries on a backoff instead of costing a whole hour;
 *   3. the parsed conditions are published on the bus for the cat, derived
 *      from the same data the icons use - one source of truth.                 */

var Weather = (function () {
	var CACHE_KEY = 'wx.raw.v1';
	var TREND_KEY = 'wx.pressure.v1';

	var lastcall = 0;
	var retryIndex = 0;
	var retryTimer = null;
	var inflight = false;

	/* What happened last time, so the app can be asked instead of guessed at.
	 *
	 * Stale data is the failure mode that does not look like one: the display
	 * keeps showing the last good forecast for twelve hours, confidently, and
	 * "+14 and cloudy" reads exactly like a fresh reading when it is really this
	 * morning's. So the age of the data and the reason for the last failure are
	 * both kept, and both are reportable.                                      */
	var dataStamp = 0;            /* when the shown data was fetched */
	var lastTry = 0;              /* when a call was last attempted */
	var lastError = '';           /* '' while the last call succeeded */

	/* ---------------- fetch ---------------- */

	function due(now) {
		return lastcall < now - timeout * 1000;
	}

	/* `isRetry` matters: without it retryIndex only ever reset on success, so
	 * after one bad day it sat at the end of the ladder and every later hourly
	 * call got a single attempt with no backoff behind it. A day of HTTP 403 is
	 * exactly the case that has to recover cleanly once the key is fixed.     */
	function fetch(now, date, isRetry, report) {
		if (api === 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx') {
			lastError = 'no API key configured';
			if (report) report(lastError, null);
			return;
		}
		if (inflight) { if (report) report('a call is already in flight', null); return; }
		if (!isRetry) retryIndex = 0;
		inflight = true;
		lastTry = now;
		lastcall = now;

		getJSON(
			'https://api.weather.yandex.ru/v2/forecast?lat=' + lat + '&lon=' + lon,
			{ 'X-Yandex-Weather-Key': api },
			30 * 1000,
			function (data, raw) {
				inflight = false;
				retryIndex = 0;
				if (data && data.hasOwnProperty('fact') && data.hasOwnProperty('forecasts')) {
					Store.setJSON(CACHE_KEY, { t: now, raw: raw });
					dataStamp = now;
					lastError = '';
					apply(data, date, now);
					if (report) report(null, data.fact);
				} else {
					lastError = 'response had no fact/forecasts';
					if (report) report(lastError, null);
				}
			},
			function (why) {
				inflight = false;
				lastError = why;
				scheduleRetry(why, date);
				if (report) report(why, null);
			}
		);
	}

	function scheduleRetry(why, date) {
		if (retryIndex >= retry_steps.length) return;
		var wait = retry_steps[retryIndex] * 1000;
		retryIndex++;
		if (window.console && console.warn) console.warn('[weather] ' + why + ', retry in ' + (wait / 1000) + 's');
		if (retryTimer) clearTimeout(retryTimer);
		retryTimer = setTimeout(function () {
			/* re-arm as if the hourly slot were open, but keep the hourly cadence */
			var now = Date.now();
			inflight = false;
			lastcall = 0;
			fetch(now, new Date(), true);
		}, wait);
	}

	/* Paint whatever was cached, before the network is even tried. */
	function restore(date, now) {
		var c = Store.getJSON(CACHE_KEY);
		if (!c || !c.raw) return false;
		var data = null;
		try { data = JSON.parse(c.raw); } catch (e) { return false; }
		if (!data || !data.fact) return false;

		/* Feed it in with its original timestamp so the 12 h expiry still
		 * applies - stale data fades out on its own, exactly as before.        */
		apply(data, date, c.t || now);
		dataStamp = c.t || 0;

		/* THE STORED FILE IS THE SCHEDULE.
		 *
		 * This used to clear lastcall, so every launch called the API immediately
		 * however fresh the file was - which is what quietly spent an allowance of
		 * thirty a day while test builds went on and off the phone every few
		 * minutes. Now the file's own timestamp decides: written less than
		 * `timeout` ago and there is nothing to ask for, so due() says no. A
		 * restart costs nothing, and a whole day costs 24 calls at most.       */
		lastcall = dataStamp;
		return true;
	}

	/* ---------------- parse (unchanged logic, plus the cat payload) ---------------- */

	/* ---------------- the hourly forecast ----------------
	 *
	 * The response carries an hourly forecast - 24 entries for today and, on this
	 * plan, another 24 for tomorrow. None of it was used for the current
	 * conditions: everything came from `fact`, which is one observation taken at
	 * the moment of the call. So an hour after a failed call the screen showed an
	 * old moment, and after a day of failures it showed yesterday morning -
	 * "+14 and cloudy" while it was +19 and raining.
	 *
	 * With the hourly list a stale file is still useful: it knows what 17:00 was
	 * forecast to be, and it is 17:00. That is the difference between data that
	 * is old and data that is wrong.                                           */

	/* Every hourly entry across every day, flattened and stamped with the real
	 * time it belongs to. Yandex numbers hours 0..23 within a forecast day and may
	 * or may not also give hour_ts, so hour_ts is preferred and the day's date
	 * plus the hour is the fallback.                                           */
	function hourly(data) {
		var out = [], f = data.forecasts || [], i, j;
		for (i = 0; i < f.length; i++) {
			var hs = f[i].hours || [];
			for (j = 0; j < hs.length; j++) {
				var h = hs[j];
				var ts = null;
				if (h.hour_ts) {
					ts = Number(h.hour_ts) * 1000;
				} else if (f[i].date) {
					var d = String(f[i].date).split('-');
					if (d.length === 3) {
						var hh = (h.hour === undefined || h.hour === null) ? j : Number(h.hour);
						ts = new Date(Number(d[0]), Number(d[1]) - 1, Number(d[2]), hh, 0, 0, 0).getTime();
					}
				}
				if (ts !== null && ts === ts) out.push({ ts: ts, h: h });
			}
		}
		out.sort(function (a, b) { return a.ts - b.ts; });
		return out;
	}

	/* The entry covering `date`, or null if the list does not reach that far. */
	function hourFor(data, date) {
		var list = hourly(data);
		if (!list.length) return null;
		var want = new Date(date.getFullYear(), date.getMonth(), date.getDate(),
		                    date.getHours(), 0, 0, 0).getTime();
		for (var i = 0; i < list.length; i++) {
			if (list[i].ts === want) return list[i].h;
		}
		return null;
	}

	/* What to treat as the present.
	 *
	 * `fact` is an observation and beats a forecast - while it is current. Once
	 * the file is older than one call interval that observation is history, and
	 * the hourly entry for the actual hour is the better answer. Fields the hourly
	 * entry does not carry fall back to `fact`, so a thin hourly record degrades
	 * the screen rather than blanking it.                                      */
	function conditionsNow(data, date, stamp) {
		var fact = data.fact || {};
		var fresh = stamp && (Date.now() - stamp) < timeout * 1000;
		if (fresh) return { src: 'fact', c: fact };

		var h = hourFor(data, date);
		if (!h) return { src: 'stale-fact', c: fact };

		var merged = {}, k;
		for (k in fact) if (fact.hasOwnProperty(k)) merged[k] = fact[k];
		for (k in h) if (h.hasOwnProperty(k) && h[k] !== null && h[k] !== '') merged[k] = h[k];
		/* hourly records name the icon `icon`, but not in every response */
		if (!h.icon && h.condition) merged.icon = h.condition;
		return { src: 'hour', c: merged };
	}

	var shownSrc = '';            /* 'fact' | 'stale-fact' | 'hour' */
	var shownHour = -1;           /* the hour the screen was last drawn for */

	function apply(data, date, stamp) {
		var now = conditionsNow(data, date, stamp);
		shownSrc = now.src;
		shownHour = date.getHours();

		/* The stamp View gets is a claim about how CURRENT the numbers are, not
		 * when the file was downloaded, and View hides any field older than
		 * `expire` - twelve hours - so that a dead API fades out instead of lying.
		 *
		 * That was right when everything came from `fact`. It is wrong now: the
		 * hourly entry for the present hour IS current, whatever time the file
		 * arrived, so passing the download time would blank a perfectly correct
		 * screen twelve hours into an outage - exactly when the hourly forecast is
		 * doing its most useful work. A 'stale-fact' fallback still carries the
		 * file's own time, because then the numbers really are that old.       */
		var asOf = now.src === 'hour' ? Date.now() : stamp;

		var result = parse(data, date, now.c);
		View.update(result, asOf);
		Bus.emit('weather', derive(data, date, now.c));
	}

	/* Redraw from the stored file when the hour turns over.
	 *
	 * This is what makes a dead API survivable: no network, no new data, but the
	 * hour has changed and the file already knows what this hour was forecast to
	 * be. Called from the minute tick; does nothing until the hour actually
	 * changes, and nothing at all while the data is fresh enough to be `fact`. */
	function rehour(date, now) {
		if (date.getHours() === shownHour) return false;
		if (shownSrc === 'fact' && dataStamp && (now - dataStamp) < timeout * 1000) return false;
		var c = Store.getJSON(CACHE_KEY);
		if (!c || !c.raw) return false;
		var data = null;
		try { data = JSON.parse(c.raw); } catch (e) { return false; }
		if (!data || !data.fact) return false;
		apply(data, date, c.t || 0);
		return true;
	}

	/* How far ahead the stored file can still answer for. */
	function coverage(data) {
		var list = hourly(data);
		if (!list.length) return 0;
		return Math.round((list[list.length - 1].ts - Date.now()) / 3600000);
	}

	/* `nowc` is whatever conditionsNow() decided the present is: the observation
	 * while it is current, the hourly forecast for this hour once it is not.
	 * Everything below reads that rather than data.fact.                      */
	function parse(data, date, nowc) {
		var result = {};
		var id, min, max, hour;
		var f = nowc || data.fact;

		if (f.hasOwnProperty('icon')) result.icon = f.icon;
		if (f.hasOwnProperty('temp')) result.temperature = (f.temp > 0 ? '+' : '') + f.temp;
		if (f.hasOwnProperty('wind_speed')) {
			result.wind = f.wind_speed;
			result.wind_progress = 'width: ' + (100 - Math.round(f.wind_speed / wind_max * 100)) + '%';
			if (f.hasOwnProperty('wind_angle')) result.wind_icon = 'transform: rotate(' + (f.wind_angle - 180) + 'deg)';
		}
		if (f.hasOwnProperty('humidity')) {
			result.humidity = f.humidity;
			result.humidity_progress = 'width: ' + (100 - f.humidity) + '%';
		}
		if (f.hasOwnProperty('pressure_mm')) {
			result.pressure = f.pressure_mm;
			var pp;
			if (result.pressure < pressure_min) pp = 0;
			else if (result.pressure > pressure_max) pp = 100;
			else pp = Math.round((result.pressure - pressure_min) / (pressure_max - pressure_min) * 100);
			result.pressure_progress = 'width: ' + (100 - pp) + '%';
		}

		if (data.forecasts.hasOwnProperty('0')) {
			if (data.forecasts[0].hasOwnProperty('hours')) {
				min = max = 0;
				for (id in data.forecasts[0].hours) {
					if (data.forecasts[0].hours[id].hasOwnProperty('temp')) {
						if (data.forecasts[0].hours[id].temp < data.forecasts[0].hours[min].temp) min = id;
						if (data.forecasts[0].hours[id].temp > data.forecasts[0].hours[max].temp) max = id;
					}
				}
				result.min = (data.forecasts[0].hours[min].temp > 0 ? '+' : '') + data.forecasts[0].hours[min].temp;
				result.min_date = pad(min) + ':00';
				result.max = (data.forecasts[0].hours[max].temp > 0 ? '+' : '') + data.forecasts[0].hours[max].temp;
				result.max_date = pad(max) + ':00';
			}

			hour = date.getHours();
			var parts = {};
			if (hour >= 6 && hour <= 11) {
				parts = { 0: { part: 0, period: 'day' },     1: { part: 0, period: 'evening' } };
			} else if (hour >= 12 && hour <= 17) {
				parts = { 0: { part: 0, period: 'evening' }, 1: { part: 1, period: 'night' } };
			} else if (hour >= 18 && hour <= 22) {
				parts = { 0: { part: 1, period: 'night' },   1: { part: 1, period: 'morning' } };
			} else {
				parts = { 0: { part: 0, period: 'morning' }, 1: { part: 0, period: 'day' } };
			}

			for (id in parts) {
				var per = parts[id].period;
				if (data.forecasts.hasOwnProperty(id) && data.forecasts[id].hasOwnProperty('parts') && data.forecasts[id].parts.hasOwnProperty(per)) {
					var src = data.forecasts[parts[id].part].parts[per];
					result['forecast_title_' + id] = period[per];
					if (src.hasOwnProperty('icon')) result['forecast_icon_' + id] = src.icon;
					if (src.hasOwnProperty('temp_avg')) {
						result['forecast_temperature_' + id] = (src.temp_avg > 0 ? '+' : '') + src.temp_avg;
					}
					if (src.hasOwnProperty('wind_speed')) result['forecast_wind_' + id] = src.wind_speed;
					if (src.hasOwnProperty('wind_angle')) result['forecast_wind_icon_' + id] = 'transform: rotate(' + (src.wind_angle - 180) + 'deg)';
				}
			}

			if (data.forecasts[0].hasOwnProperty('moon_code')) result.moon = 'moon_' + data.forecasts[0].moon_code;
			if (data.forecasts[0].hasOwnProperty('sunrise') && data.forecasts[0].hasOwnProperty('sunset')) {
				result.rise = data.forecasts[0].sunrise;
				result.set = data.forecasts[0].sunset;
				riseset(result.rise, result.set, date);
			}
		}
		return result;
	}

	function riseset(rise, set, date) {
		if (!rise || !set) return;
		var r = hhmm(rise), s = hhmm(set);
		if (r < 0 || s < 0) return;

		var result = {};
		var duration = s - r;
		var current = date.getHours() * 60 + date.getMinutes();
		var hour = Math.floor(duration / 60);

		result.duration_hour = pad(hour);
		result.duration_minute = pad(duration - hour * 60);
		result.duration_time = 'width: ' + Math.round(duration / (60 * 24) * 100) + '%; left: ' + Math.round(r / (60 * 24) * 100) + '%';
		result.duration_progress = 'width: ' + Math.round(current / (60 * 24) * 100) + '%';

		var minutes, hours;
		if (current > r && current < s) {
			minutes = s - current;
			result.duration_left = period.day_day;
		} else {
			minutes = 60 * 24 - current + r;
			result.duration_left = period.day_night;
		}
		hours = Math.floor(minutes / 60);
		result.duration_left += ' ' + pad(hours) + ':' + pad(minutes - hours * 60);

		View.update(result, Date.now());
	}

	/* ---------------- the cat's view of the same data ---------------- */

	/* Yandex icon codes look like  skc_d | bkn_-ra_n | ovc_ts_ra | ovc_+sn
	 * i.e.  <sky>[_<intensity><precip>][_ts][_d|_n]                            */
	function splitCode(code) {
		var out = { sky: 'skc', precip: null, intensity: 0, thunder: false };
		if (!code) return out;

		if (code.indexOf('ovc') === 0) out.sky = 'ovc';
		else if (code.indexOf('bkn') === 0) out.sky = 'bkn';
		else out.sky = 'skc';

		if (code.indexOf('ts') !== -1) out.thunder = true;
		if (code.indexOf('ra_sn') !== -1) out.precip = 'ra_sn';
		else if (code.indexOf('ra') !== -1) out.precip = 'ra';
		else if (code.indexOf('sn') !== -1) out.precip = 'sn';

		if (code.indexOf('+') !== -1) out.intensity = 1;
		else if (code.indexOf('-') !== -1) out.intensity = -1;
		return out;
	}

	function pressureTrend(mm) {
		var hist = Store.getJSON(TREND_KEY) || [];
		var now = Date.now();
		hist.push({ t: now, p: mm });
		while (hist.length && hist[0].t < now - 6 * 3600 * 1000) hist.shift();
		if (hist.length > 24) hist = hist.slice(hist.length - 24);
		Store.setJSON(TREND_KEY, hist);
		return hist.length > 1 ? mm - hist[0].p : 0;
	}

	function derive(data, date, nowc) {
		var f = nowc || data.fact;
		var code = f.icon || '';
		var bits = splitCode(code);
		var d0 = data.forecasts && data.forecasts[0] ? data.forecasts[0] : {};

		var r = hhmm(d0.sunrise), s = hhmm(d0.sunset);
		var current = date.getHours() * 60 + date.getMinutes();
		var night = (r >= 0 && s >= 0) ? (current < r || current > s) : (code.indexOf('_n') !== -1);

		return {
			code: code,
			sky: bits.sky,
			precip: bits.precip,
			intensity: bits.intensity,
			isThunder: bits.thunder,
			isNight: night,
			temp: typeof f.temp === 'number' ? f.temp : null,
			wind: typeof f.wind_speed === 'number' ? f.wind_speed : 0,
			windAngle: typeof f.wind_angle === 'number' ? f.wind_angle : 0,
			humidity: typeof f.humidity === 'number' ? f.humidity : 50,
			pressure: f.pressure_mm || null,
			pressureTrend: f.pressure_mm ? pressureTrend(f.pressure_mm) : 0,
			moonCode: typeof d0.moon_code === 'number' ? d0.moon_code : null,
			minutesToSunrise: r >= 0 ? r - current : null,
			minutesToSunset: s >= 0 ? s - current : null,
			/* Absolute clock minutes, not offsets from now. The day planner builds
			 * a schedule at midnight for hours it is not living in yet, and an
			 * offset from "now" is worthless to it - it would have every slot
			 * inheriting midnight's darkness and put moon-gazing at two in the
			 * afternoon.                                                        */
			sunriseMin: r >= 0 ? r : null,
			sunsetMin: s >= 0 ? s : null
		};
	}

	/* Everything a human needs to answer "is this forecast current?" */
	function status() {
		var now = Date.now();
		return {
			ageMin: dataStamp ? Math.round((now - dataStamp) / 60000) : -1,
			at: dataStamp ? new Date(dataStamp) : null,
			lastTryMin: lastTry ? Math.round((now - lastTry) / 60000) : -1,
			error: lastError,
			inflight: inflight,
			expireMin: Math.round(expire / 60),
			keyTail: api && api.length > 6 ? api.slice(-6) : '(unset)',
			source: shownSrc,
			coverH: cachedCoverage()
		};
	}


	/* hours of forecast still ahead of us in the stored file */
	function cachedCoverage() {
		var c = Store.getJSON(CACHE_KEY);
		if (!c || !c.raw) return 0;
		try { return coverage(JSON.parse(c.raw)); } catch (e) { return 0; }
	}

	return {
		status: status,
		rehour: rehour,
		hourFor: hourFor,
		hourly: hourly,
		conditionsNow: conditionsNow,
		due: due,
		fetch: fetch,
		restore: restore,
		riseset: riseset,
		cached: function () { return !!Store.getJSON(CACHE_KEY); }
	};
})();
