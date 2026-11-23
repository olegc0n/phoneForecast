/* weather.js - fetch, cache, parse, publish.
 *
 * The forecast is free and keyless: Open-Meteo, and MET Norway when Open-Meteo
 * fails (inside the APK only - see wxsource.js). wxsource.js turns either one
 * into the response shape everything below was written for, so this file is
 * about WHEN to ask and WHAT to show, not where the numbers come from.
 *
 * Three things from the original, all about surviving a shelf:
 *   1. the last good response is cached, so a reload paints instantly instead
 *      of showing an empty screen until the next call;
 *   2. a failed call backs off instead of hammering a dead network;
 *   3. the parsed conditions are published on the bus for the cat, derived
 *      from the same data the icons use - one source of truth.
 *
 * WHEN IT ASKS (the whole policy; check-weather.js tests every line of it):
 *   - never without a place. No place, no request, ever.
 *   - once an hour (`timeout`) while things work. A launch is free: restore()
 *     takes the schedule from the stored file's own timestamp.
 *   - after a failure, again in 5, 15 and 30 minutes (`retry_steps`), then back
 *     to hourly. The backoff is stored, so a restart does not reset it.
 *   - at once when the place changes (the settings dialog).
 *   - never while the phone says it is offline (navigator.onLine).
 *   - never more than `calls_per_day` requests in a calendar day (48), counting
 *     every request: Open-Meteo, MET and MET's 304s. Healthy is 24.
 *   - MET Norway only when Open-Meteo failed, only in the APK, never before
 *     the Expires it last sent for this place, and with If-Modified-Since.   */

var Weather = (function () {
	var CACHE_KEY = 'wx.raw.v2';          /* {v, t, src, key, lat, lon, place, raw, lm, expires} */
	var TRY_KEY = 'wx.try.v1';            /* {key, at, fails}: the backoff survives a restart */
	var CALLS_KEY = 'wx.calls.v1';        /* {day, n}: requests made today */
	var TREND_KEY = 'wx.pressure.v1';
	var TIMEOUT_MS = 20 * 1000;

	var lastcall = 0;             /* the last attempt, or the stored file's time */
	var fails = 0;                /* failed attempts in a row */
	var inflight = false;
	var queued = null;            /* a forced fetch asked for while one was in flight */

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
	var shownSrc = '';            /* 'fact' | 'stale-fact' | 'hour' */
	var shownHour = -1;           /* the hour the screen was last drawn for */
	var shownFrom = '';           /* 'open-meteo' | 'met': what the credit names */
	var shownNow = null;          /* the conditions on screen, for the settings dialog's summary */

	/* ---------------- the place ---------------- */

	function hasPlace() {
		return typeof place_lat === 'number' && typeof place_lon === 'number' &&
			isFinite(place_lat) && isFinite(place_lon) &&
			Math.abs(place_lat) <= 90 && Math.abs(place_lon) <= 180;
	}

	/* what a stored forecast is kept for: 4 decimals, as the settings store it */
	function placeKey() {
		return hasPlace() ? place_lat.toFixed(4) + ',' + place_lon.toFixed(4) : '';
	}

	/* "choose a city" while there is none; the forecast's own space otherwise */
	function prompt() {
		var el = byId('wx_prompt');
		if (el) el.style.display = hasPlace() ? 'none' : 'block';
	}

	/* ---------------- the schedule ---------------- */

	/* seconds until the next attempt: the backoff ladder, then hourly again */
	function wait() {
		return (fails > 0 && fails <= retry_steps.length) ? retry_steps[fails - 1] : timeout;
	}

	function due(now) {
		if (!hasPlace()) return false;
		/* A stamp from the future is not a schedule.
		 *
		 * restore() takes lastcall from the cached file's own timestamp, which is
		 * right until the clock moves backwards - a shelf phone after a power cut,
		 * before it has found a network to sync from. Then lastcall sits ahead of
		 * now and the wait would last as long as it takes real time to catch up,
		 * which can be years. Calling once is the cheap way out: fetch() sets
		 * lastcall = now before it sends, so this cannot loop.                  */
		if (lastcall > now) return true;
		return now - lastcall >= wait() * 1000;
	}

	function online() {
		try { return !(typeof navigator !== 'undefined' && navigator && navigator.onLine === false); }
		catch (e) { return true; }
	}

	/* MET refuses a request whose User-Agent does not name the app, and only
	 * the APK can set one (MainActivity). A browser tab has Open-Meteo alone. */
	function metAllowed() {
		return typeof Host !== 'undefined' && Host.native();
	}

	function dayOf(ms) {
		var d = new Date(ms);
		return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
	}

	function callsToday(now) {
		var c = Store.getJSON(CALLS_KEY);
		return (c && c.day === dayOf(now)) ? (c.n || 0) : 0;
	}

	/* one more request today, or false at the ceiling */
	function spend(now) {
		var n = callsToday(now);
		if (n >= calls_per_day) return false;
		Store.setJSON(CALLS_KEY, { day: dayOf(now), n: n + 1 });
		return true;
	}

	function saveTry() {
		Store.setJSON(TRY_KEY, { key: placeKey(), at: lastTry, fails: fails });
	}

	/* ---------------- the stored file ---------------- */

	function cached() {
		var c = Store.getJSON(CACHE_KEY);
		if (!c || c.v !== 2 || typeof c.raw !== 'string' || typeof c.t !== 'number') return null;
		if (c.src !== 'open-meteo' && c.src !== 'met') return null;
		return c;
	}

	/* the stored file for THIS place, in the shape the rest of the file reads */
	function stored() {
		var c = cached();
		if (!c || c.key !== placeKey()) return null;
		var data = WxSource.adapt(c.src, c.raw, c.lat, c.lon, c.t);
		return data ? { c: c, data: data } : null;
	}

	/* ---------------- fetch ---------------- */

	function done(report, why) {
		if (report) { try { report(why); } catch (e) {} }
	}

	function fetch(now, date, report) {
		if (!hasPlace()) { lastError = 'no place'; done(report, lastError); return false; }
		if (inflight) {
			if (report) queued = report;
			done(null, 'a call is already in flight');
			return false;
		}
		if (!online()) {
			if (lastError !== 'offline') LOG('[weather] offline - nothing asked');
			lastError = 'offline';
			done(report, lastError);
			return false;
		}
		if (!spend(now)) {
			var limit = 'daily limit of ' + calls_per_day + ' requests reached';
			if (lastError !== limit) LOG('[weather] ' + limit);
			lastError = limit;
			done(report, lastError);
			return false;
		}

		inflight = true;
		lastTry = lastcall = now;
		saveTry();
		var key = placeKey(), lat = place_lat, lon = place_lon;

		getJSON(WxSource.openMeteoUrl(lat, lon), {}, TIMEOUT_MS,
			function (body, raw) {
				if (WxSource.adapt('open-meteo', body, lat, lon, now)) {
					keep({ v: 2, t: now, src: 'open-meteo', key: key, lat: lat, lon: lon, raw: raw });
				} else {
					fallback('Open-Meteo: not a forecast');
				}
			},
			function (why) { fallback('Open-Meteo: ' + why); });

		function fallback(why) {
			if (!metAllowed()) { failed(why); return; }
			var old = cached();
			var same = !!old && old.src === 'met' && old.key === key;
			if (same && old.expires && old.expires > now) {
				/* MET's own Expires says what we have is still its forecast */
				finish();
				if (key !== placeKey()) { next(); return; }
				fails = 0;
				saveTry();
				lastError = '';
				LOG('[weather] ' + why + '; MET Norway data is current until ' + new Date(old.expires).toTimeString().slice(0, 5));
				done(report, null);
				next();
				return;
			}
			if (!spend(now)) { failed(why + '; MET Norway: daily limit'); return; }
			var headers = {};
			if (same && old.lm) headers['If-Modified-Since'] = old.lm;
			httpGet(WxSource.metUrl(lat, lon), headers, TIMEOUT_MS, function (err, status, text, header) {
				if (err) { failed(why + '; MET Norway: ' + err); return; }
				var lm = header('Last-Modified') || '';
				var exp = Date.parse(header('Expires') || '') || 0;
				if (status === 304 && same) {
					old.t = now;
					old.lm = lm || old.lm;
					old.expires = exp;
					keep(old);
					return;
				}
				if (status !== 200 && status !== 203) { failed(why + '; MET Norway: http ' + status); return; }
				if (!WxSource.adapt('met', text, lat, lon, now)) { failed(why + '; MET Norway: not a forecast'); return; }
				keep({ v: 2, t: now, src: 'met', key: key, lat: lat, lon: lon, raw: text, lm: lm, expires: exp });
			});
		}

		function finish() { inflight = false; }

		/* a forced fetch that arrived while this one was out */
		function next() {
			if (!queued) return;
			var r = queued;
			queued = null;
			fetch(Date.now(), new Date(), r);
		}

		function keep(c) {
			finish();
			if (key !== placeKey()) {
				LOG('[weather] the place changed while asking - answer dropped');
				next();
				return;
			}
			c.place = place_name;
			Store.setJSON(CACHE_KEY, c);
			fails = 0;
			saveTry();
			dataStamp = c.t;
			lastError = '';
			var data = WxSource.adapt(c.src, c.raw, c.lat, c.lon, c.t);
			LOG('[weather] ' + c.src + ' ok, ' + Math.round(c.raw.length / 1024) + ' KB, ' + callsToday(now) + ' requests today');
			if (data) apply(data, new Date(), c.t, c.src);
			done(report, null);
			next();
		}

		function failed(why) {
			finish();
			if (key === placeKey()) {
				fails++;
				saveTry();
				lastError = why;
				LOG('[weather] ' + why + ' - next try in ' + Math.round(wait() / 60) + ' min');
				done(report, why);
			}
			next();
		}
		return true;
	}

	/* A new place from the settings dialog: the old place's weather leaves the
	 * screen at once, and the new one is asked for now, backoff or not. */
	function placeChanged(report) {
		prompt();
		View.forget(['time', 'date']);
		shownSrc = '';
		shownHour = -1;
		shownFrom = '';
		shownNow = null;
		dataStamp = 0;
		fails = 0;
		lastTry = 0;
		lastcall = 0;
		lastError = '';
		Store.setJSON(CACHE_KEY, null);
		Store.setJSON(TRY_KEY, null);
		Store.setJSON(TREND_KEY, []);           /* another place's pressure is no trend */
		if (!hasPlace()) { done(report, 'no place'); return false; }
		/* always with a report, so a call still out for the old place queues
		 * this one behind it instead of swallowing it */
		return fetch(Date.now(), new Date(), report || function () {});
	}

	/* Paint whatever was cached, before the network is even tried. */
	function restore(date, now) {
		prompt();
		var t = Store.getJSON(TRY_KEY);
		if (t && t.key === placeKey()) {
			fails = t.fails || 0;
			lastTry = t.at || 0;
		}
		lastcall = lastTry;

		var s = stored();
		if (!s) return false;

		/* Feed it in with its original timestamp so the 12 h expiry still
		 * applies - stale data fades out on its own, exactly as before.        */
		apply(s.data, date, s.c.t || now, s.c.src);
		dataStamp = s.c.t || 0;

		/* THE STORED FILE IS THE SCHEDULE.
		 *
		 * Every launch used to call immediately however fresh the file was - which
		 * spent a whole daily allowance while test builds went on and off the
		 * phone every few minutes. The file's own timestamp decides: written less
		 * than `timeout` ago and there is nothing to ask for, so due() says no. A
		 * restart costs nothing. (The later of the file and the last attempt, so
		 * a restart in the middle of a backoff does not cut it short either.)   */
		lastcall = Math.max(lastcall, dataStamp);
		return true;
	}

	/* ---------------- the hourly forecast ----------------
	 *
	 * The file carries an hourly forecast - two days and more of it. None of it
	 * used to be used for the current conditions: everything came from `fact`,
	 * one observation taken at the moment of the call. So an hour after a failed
	 * call the screen showed an old moment, and after a day of failures it showed
	 * yesterday morning - "+14 and cloudy" while it was +19 and raining.
	 *
	 * With the hourly list a stale file is still useful: it knows what 17:00 was
	 * forecast to be, and it is 17:00. That is the difference between data that
	 * is old and data that is wrong.                                           */

	/* Every hourly entry across every day, flattened and stamped with the real
	 * time it belongs to: hour_ts, or the day's date plus the hour.            */
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

	/* The entry covering `date` - the last one starting at or before it, if it
	 * is less than an hour old - or null if the list does not reach that far.
	 * By time, not by clock hour, so a half-hour time zone or a DST change still
	 * finds it.                                                                */
	function hourFor(data, date) {
		var list = hourly(data), ms = date.getTime(), best = null;
		for (var i = 0; i < list.length && list[i].ts <= ms; i++) best = list[i];
		return (best && ms < best.ts + 3600000) ? best.h : null;
	}

	/* What to treat as the present.
	 *
	 * `fact` is the source's "now" and beats a forecast - while it is current.
	 * Once the file is older than one call interval it is history, and the
	 * hourly entry for the actual hour is the better answer. Fields the hourly
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
		if (!h.icon && h.condition) merged.icon = h.condition;
		return { src: 'hour', c: merged };
	}

	function apply(data, date, stamp, from) {
		var now = conditionsNow(data, date, stamp);
		shownSrc = now.src;
		shownHour = date.getHours();
		shownFrom = from || shownFrom;
		shownNow = { temp: now.c.temp, icon: now.c.icon, wind: now.c.wind_speed, angle: now.c.wind_angle };

		/* The stamp View gets is a claim about how CURRENT the numbers are, not
		 * when the file was downloaded, and View hides any field older than
		 * `expire` - twelve hours - so that a dead network fades out instead of
		 * lying. The hourly entry for the present hour IS current, whatever time
		 * the file arrived, so it is stamped now; a 'stale-fact' fallback still
		 * carries the file's own time, because then the numbers really are that
		 * old - and the credit fades with them.                               */
		var asOf = now.src === 'hour' ? Date.now() : stamp;

		var result = parse(data, date, now.c);
		if (shownFrom) result.wx_credit = WxSource.label(shownFrom);
		View.update(result, asOf);
		Bus.emit('weather', derive(data, date, now.c));
	}

	/* Redraw from the stored file when the hour turns over.
	 *
	 * This is what makes a dead network survivable: no new data, but the hour
	 * has changed and the file already knows what this hour was forecast to be.
	 * Called from the minute tick; does nothing until the hour actually changes,
	 * and nothing at all while the data is fresh enough to be `fact`.          */
	function rehour(date, now) {
		if (date.getHours() === shownHour) return false;
		if (shownSrc === 'fact' && dataStamp && (now - dataStamp) < timeout * 1000) return false;
		var s = stored();
		if (!s) return false;
		apply(s.data, date, s.c.t || 0, s.c.src);
		return true;
	}

	/* How far ahead the stored file can still answer for. */
	function coverage(data) {
		var list = hourly(data);
		if (!list.length) return 0;
		return Math.round((list[list.length - 1].ts - Date.now()) / 3600000);
	}

	/* ---------------- parse ---------------- */

	function ymd(date) {
		return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
	}

	/* Today's entry in forecasts[], or -1. By date, not position: the file can
	 * be a day old (a night without network), and its first day is yesterday. */
	function dayIndex(data, date) {
		var f = data.forecasts || [], want = ymd(date);
		for (var i = 0; i < f.length; i++) if (f[i] && f[i].date === want) return i;
		return -1;
	}

	function signed(t) { return (t > 0 ? '+' : '') + t; }

	/* `nowc` is whatever conditionsNow() decided the present is: the source's
	 * "now" while it is current, the hourly forecast for this hour once it is
	 * not. Everything below reads that rather than data.fact.                 */
	function parse(data, date, nowc) {
		var result = {};
		var f = nowc || data.fact;

		if (f.hasOwnProperty('icon')) result.icon = f.icon;
		if (f.hasOwnProperty('temp')) result.temperature = signed(f.temp);
		if (f.hasOwnProperty('wind_speed')) {
			result.wind = f.wind_speed;
			result.wind_progress = 'width: ' + Math.max(0, 100 - Math.round(f.wind_speed / wind_max * 100)) + '%';
			if (f.hasOwnProperty('wind_angle')) result.wind_icon = 'transform: rotate(' + (f.wind_angle - 180) + 'deg)';
		}
		if (f.hasOwnProperty('humidity')) {
			result.humidity = f.humidity;
			result.humidity_progress = 'width: ' + (100 - f.humidity) + '%';
		}
		if (f.hasOwnProperty('pressure_mm')) {
			/* the number in the screen's unit (hPa in English, mm Hg in Russian);
			 * the bar always from mm Hg, so it sits the same in both */
			result.pressure = (I18n.hpa() && f.hasOwnProperty('pressure_hpa')) ? f.pressure_hpa : f.pressure_mm;
			var pp, mm = f.pressure_mm;
			if (mm < pressure_min) pp = 0;
			else if (mm > pressure_max) pp = 100;
			else pp = Math.round((mm - pressure_min) / (pressure_max - pressure_min) * 100);
			result.pressure_progress = 'width: ' + (100 - pp) + '%';
		}

		var di = dayIndex(data, date);
		if (di === -1) return result;
		var d0 = data.forecasts[di], d1 = data.forecasts[di + 1] || null;

		/* today's low and high, and the hours they fall at */
		var hs = d0.hours || [], lo = null, hi = null, i;
		for (i = 0; i < hs.length; i++) {
			if (typeof hs[i].temp !== 'number') continue;
			if (!lo || hs[i].temp < lo.temp) lo = hs[i];
			if (!hi || hs[i].temp > hi.temp) hi = hs[i];
		}
		if (lo && hi) {
			result.min = signed(lo.temp);
			result.min_date = pad(Number(lo.hour !== undefined ? lo.hour : hs.indexOf(lo))) + ':00';
			result.max = signed(hi.temp);
			result.max_date = pad(Number(hi.hour !== undefined ? hi.hour : hs.indexOf(hi))) + ':00';
		}

		/* The two parts of the day still ahead. From 18:00 to midnight that is
		 * tonight and tomorrow morning, both of which belong to tomorrow's date
		 * (the night part is 00-06); after midnight they are today's again.    */
		var hour = date.getHours(), parts;
		if (hour >= 6 && hour <= 11) parts = [[d0, 'day'], [d0, 'evening']];
		else if (hour >= 12 && hour <= 17) parts = [[d0, 'evening'], [d1, 'night']];
		else if (hour >= 18) parts = [[d1, 'night'], [d1, 'morning']];
		else parts = [[d0, 'morning'], [d0, 'day']];

		for (i = 0; i < parts.length; i++) {
			var day = parts[i][0], per = parts[i][1];
			if (!day || !day.parts || !day.parts.hasOwnProperty(per)) continue;
			var src = day.parts[per];
			result['forecast_title_' + i] = I18n.t('part_' + per);
			if (src.hasOwnProperty('icon')) result['forecast_icon_' + i] = src.icon;
			if (src.hasOwnProperty('temp_avg')) result['forecast_temperature_' + i] = signed(src.temp_avg);
			if (src.hasOwnProperty('wind_speed')) result['forecast_wind_' + i] = src.wind_speed;
			if (src.hasOwnProperty('wind_angle')) result['forecast_wind_icon_' + i] = 'transform: rotate(' + (src.wind_angle - 180) + 'deg)';
		}

		if (d0.hasOwnProperty('moon_code')) result.moon = 'moon_' + d0.moon_code;
		if (d0.hasOwnProperty('sunrise') && d0.hasOwnProperty('sunset')) {
			result.rise = d0.sunrise;
			result.set = d0.sunset;
			riseset(result.rise, result.set, date);
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
			result.duration_left = I18n.t('light_day');
		} else {
			minutes = (current >= s ? 60 * 24 - current + r : r - current);
			result.duration_left = I18n.t('light_night');
		}
		hours = Math.floor(minutes / 60);
		result.duration_left += ' ' + pad(hours) + ':' + pad(minutes - hours * 60);

		View.update(result, Date.now());
	}

	/* ---------------- the cat's view of the same data ---------------- */

	/* Icon codes look like  skc_d | bkn_-ra_n | ovc_ts_ra | ovc_+sn
	 * i.e.  <sky>[_<intensity><precip>][_ts][_d|_n]  (wxsource.js writes them) */
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
		var di = dayIndex(data, date);
		var d0 = di !== -1 ? data.forecasts[di] : {};

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
		var c = cached();
		var mine = !!c && c.key === placeKey();
		return {
			ageMin: dataStamp ? Math.round((now - dataStamp) / 60000) : -1,
			at: dataStamp ? new Date(dataStamp) : null,
			lastTryMin: lastTry ? Math.round((now - lastTry) / 60000) : -1,
			error: lastError,
			inflight: inflight,
			expireMin: Math.round(expire / 60),
			place: hasPlace() ? place_name : '',
			from: mine ? WxSource.label(c.src) : '',
			fails: fails,
			calls: callsToday(now),
			limit: calls_per_day,
			source: shownSrc,
			now: hasPlace() ? shownNow : null,
			coverH: cachedCoverage()
		};
	}

	/* hours of forecast still ahead of us in the stored file */
	function cachedCoverage() {
		var s = stored();
		return s ? coverage(s.data) : 0;
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
		placeChanged: placeChanged,
		hasPlace: hasPlace,
		riseset: riseset,
		cached: function () { return !!cached(); },
		/* for the offline harness */
		parse: parse,
		derive: derive,
		splitCode: splitCode
	};
})();
