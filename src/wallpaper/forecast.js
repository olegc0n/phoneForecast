/* forecast.js - the real weather, turned into the sky Lili lives under.
 *
 * The Android side fetches a forecast for the place the user chose (Open-Meteo,
 * or MET Norway when Open-Meteo fails) and hands the page the raw response:
 *
 *   Forecast.load({ source: 'open-meteo' | 'met', body: <the JSON, a string or
 *                   an object>, lat, lon, fetchedAt: <epoch ms>, place })
 *
 * Both sources are normalised into one hourly series, oldest first:
 *
 *   [{ t (epoch ms, the start of the hour), code, sky, precip, intensity,
 *      isThunder, temp, wind, windAngle, humidity, pressure (hPa) }]
 *
 * and Forecast.now(date) answers with the payload for the hour `date` falls in,
 * in exactly the shape of core/weather.js's derive(): every `when` condition,
 * the wardrobe, her moods and the shuffle read it as they read the invented sky
 * (sky.js), so nothing downstream changes. It returns null when there is no
 * entry for this hour, or when the data was fetched more than 48 h ago: the
 * page then lives under the invented sky again.
 *
 * NIGHT IS LOCAL. Neither the payload's night nor its sunrise and sunset come
 * from the response: they are computed here, for the place and the phone's
 * date, with the NOAA solar position algorithm (the one behind NOAA's solar
 * calculator spreadsheet), so both sources behave the same and MET, which has
 * no sunrise at all, needs nothing more. sunriseMin/sunsetMin are clock minutes
 * on the phone, as derive() gives them and cat.js's wxNow() reads them. Where
 * the sun neither rises nor sets that day (polar day, polar night), or the
 * place is so far away that its daylight straddles the phone's midnight, they
 * are null and isNight is the sun's own height above the horizon right now.
 *
 * The current hour is found by time, not by clock: an entry covers [t, t + 1 h),
 * so a DST change, a midnight or a place in another time zone cannot pick the
 * wrong one. MET's later entries are 6 hours apart; each is spread over its
 * hours, so the series stays hourly.
 *
 * Nothing here publishes anything. Sky publishes (sky.js: Sky.useReal), and
 * Wall decides when (wall.js: Wall.forecast).                                 */

var Forecast = (function () {
	var HOUR = 3600 * 1000;
	var STALE_MS = 48 * HOUR;             /* fetched longer ago than this: the invented sky again */
	var TREND_AHEAD = 3 * HOUR;           /* pressureTrend: the next three hours */
	var MM_PER_HPA = 0.750062;            /* the payload's pressure is mm Hg, as derive() gives it */
	var ZENITH = 90.833;                  /* sunrise: the sun's upper limb on the horizon, refraction included */

	/* WMO weather codes (Open-Meteo's weather_code): [sky, precip, intensity, thunder].
	 * intensity as derive() has it: -1 light, 0 moderate, +1 heavy.            */
	var WMO = {
		0:  ['skc', null,    0, false],   /* clear */
		1:  ['bkn', null,    0, false],   /* mainly clear */
		2:  ['bkn', null,    0, false],   /* partly cloudy */
		3:  ['ovc', null,    0, false],   /* overcast */
		45: ['ovc', null,    0, false],   /* fog */
		48: ['ovc', null,    0, false],   /* rime fog */
		51: ['ovc', 'ra',   -1, false],   /* drizzle: light, moderate, dense - all light rain */
		53: ['ovc', 'ra',   -1, false],
		55: ['ovc', 'ra',   -1, false],
		56: ['ovc', 'ra_sn', -1, false],  /* freezing drizzle */
		57: ['ovc', 'ra_sn', -1, false],
		61: ['ovc', 'ra',   -1, false],   /* rain: slight, moderate, heavy */
		63: ['ovc', 'ra',    0, false],
		65: ['ovc', 'ra',    1, false],
		66: ['ovc', 'ra_sn', -1, false],  /* freezing rain: light, heavy */
		67: ['ovc', 'ra_sn', 1, false],
		71: ['ovc', 'sn',   -1, false],   /* snow: slight, moderate, heavy */
		73: ['ovc', 'sn',    0, false],
		75: ['ovc', 'sn',    1, false],
		77: ['ovc', 'sn',   -1, false],   /* snow grains */
		80: ['bkn', 'ra',   -1, false],   /* rain showers: slight, moderate, violent */
		81: ['bkn', 'ra',    0, false],
		82: ['bkn', 'ra',    1, false],
		85: ['bkn', 'sn',   -1, false],   /* snow showers: slight, heavy */
		86: ['bkn', 'sn',    1, false],
		95: ['ovc', 'ra',    0, true],    /* thunderstorm */
		96: ['ovc', 'ra',    0, true],    /* ...with slight hail */
		99: ['ovc', 'ra',    1, true]     /* ...with heavy hail */
	};

	/* MET Norway's symbol_code families, once _day/_night/_polartwilight, a
	 * light/heavy prefix and an "andthunder" suffix are taken off: [sky, precip].
	 * The prefix is the intensity (light -1, heavy +1; MET itself spells two
	 * codes "lights..."), the suffix is thunder.                               */
	var MET = {
		clearsky:     ['skc', null],
		fair:         ['bkn', null],
		partlycloudy: ['bkn', null],
		cloudy:       ['ovc', null],
		fog:          ['ovc', null],
		rain:         ['ovc', 'ra'],
		rainshowers:  ['bkn', 'ra'],
		sleet:        ['ovc', 'ra_sn'],
		sleetshowers: ['bkn', 'ra_sn'],
		snow:         ['ovc', 'sn'],
		snowshowers:  ['bkn', 'sn']
	};
	var MET_PREFIX = [['lights', -1], ['light', -1], ['heavy', 1]];

	var data = null;              /* { source, series, lat, lon, fetchedAt, place } */
	var sunCache = null;          /* { key, sun } for the last local date asked about */

	/* ---------------- small helpers ---------------- */

	function num(v) {
		if (v === null || v === undefined || v === '') return null;
		var n = +v;
		return (n === n && isFinite(n)) ? n : null;
	}
	function isArray(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
	function rad(d) { return d * Math.PI / 180; }
	function deg(r) { return r * 180 / Math.PI; }
	function at(a, i) { return isArray(a) ? num(a[i]) : null; }

	/* ---------------- the two mappings ---------------- */

	/* A WMO code; one not in the table is judged by its precipitation, if any. */
	function wmo(code, precipitation, temp) {
		var row = (code !== null && WMO.hasOwnProperty(code)) ? WMO[code] : null;
		if (row) return { sky: row[0], precip: row[1], intensity: row[2], isThunder: row[3] };
		var wet = precipitation !== null && precipitation >= 0.1;
		return { sky: wet ? 'ovc' : 'bkn', precip: wet ? (temp !== null && temp <= 0 ? 'sn' : 'ra') : null,
		         intensity: 0, isThunder: false };
	}

	function metSymbol(code) {
		var s = String(code || '').replace(/_(day|night|polartwilight)$/, '');
		var thunder = /andthunder$/.test(s);
		s = s.replace(/andthunder$/, '');
		var intensity = 0, i;
		if (!MET.hasOwnProperty(s)) {
			for (i = 0; i < MET_PREFIX.length; i++) {
				var p = MET_PREFIX[i][0];
				if (s.indexOf(p) === 0 && MET.hasOwnProperty(s.slice(p.length))) {
					s = s.slice(p.length);
					intensity = MET_PREFIX[i][1];
					break;
				}
			}
		}
		var row = MET.hasOwnProperty(s) ? MET[s] : ['bkn', null];
		return { sky: row[0], precip: row[1], intensity: row[1] ? intensity : 0, isThunder: thunder };
	}

	/* ---------------- the two normalisers ---------------- */

	function entry(t, code, w, temp, wind, angle, humidity, pressure) {
		return { t: t, code: code, sky: w.sky, precip: w.precip, intensity: w.intensity, isThunder: w.isThunder,
		         temp: temp, wind: wind, windAngle: angle, humidity: humidity, pressure: pressure };
	}

	/* hourly=...&timeformat=unixtime: parallel arrays, `time` in seconds */
	function fromOpenMeteo(b) {
		var h = b && b.hourly, out = [];
		if (!h || !isArray(h.time)) return out;
		var codes = isArray(h.weather_code) ? h.weather_code : h.weathercode;
		for (var i = 0; i < h.time.length; i++) {
			var t = num(h.time[i]);
			if (t === null) continue;
			var code = at(codes, i), temp = at(h.temperature_2m, i);
			out.push(entry(t * 1000, 'wmo:' + (code === null ? '?' : code), wmo(code, at(h.precipitation, i), temp),
				temp, at(h.wind_speed_10m, i), at(h.wind_direction_10m, i),
				at(h.relative_humidity_2m, i), at(h.pressure_msl, i)));
		}
		return out;
	}

	/* Locationforecast 2.0 compact: properties.timeseries, ISO times in UTC.
	 * Hourly for about two and a half days, then six-hourly; a six-hourly
	 * entry is spread over its hours, with its next_6_hours symbol.           */
	function fromMet(b) {
		var ts = b && b.properties && b.properties.timeseries, out = [];
		if (!isArray(ts)) return out;
		var list = [], i, k;
		for (i = 0; i < ts.length; i++) {
			var t = ts[i] && Date.parse(ts[i].time);
			if (!(t === t) || !ts[i].data) continue;
			list.push({ t: t, d: ts[i].data });
		}
		for (i = 0; i < list.length; i++) {
			var d = list[i].d;
			var inst = (d.instant && d.instant.details) || {};
			var next = d.next_1_hours || d.next_6_hours || d.next_12_hours || null;
			var sym = next && next.summary ? next.summary.symbol_code : '';
			if (!sym) continue;               /* the last entry: a temperature, but no sky */
			var w = metSymbol(sym);
			var hours = i + 1 < list.length ? Math.round((list[i + 1].t - list[i].t) / HOUR) :
				(d.next_1_hours ? 1 : d.next_6_hours ? 6 : 1);
			hours = Math.max(1, Math.min(6, hours));
			for (k = 0; k < hours; k++) {
				out.push(entry(list[i].t + k * HOUR, 'met:' + sym, w,
					num(inst.air_temperature), num(inst.wind_speed), num(inst.wind_from_direction),
					num(inst.relative_humidity), num(inst.air_pressure_at_sea_level)));
			}
		}
		return out;
	}

	/* ---------------- the sun (NOAA) ---------------- */

	/* Julian centuries since J2000.0 */
	function century(ms) { return (ms / 86400000 + 2440587.5 - 2451545) / 36525; }

	/* the sun's declination (degrees) and the equation of time (minutes) */
	function solar(T) {
		var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
		var M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
		var e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
		var C = Math.sin(rad(M)) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
			Math.sin(rad(2 * M)) * (0.019993 - 0.000101 * T) + Math.sin(rad(3 * M)) * 0.000289;
		var omega = 125.04 - 1934.136 * T;
		var lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(rad(omega));
		var eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
		var eps = eps0 + 0.00256 * Math.cos(rad(omega));
		var decl = deg(Math.asin(Math.sin(rad(eps)) * Math.sin(rad(lambda))));
		var y = Math.tan(rad(eps / 2));
		y *= y;
		var eq = 4 * deg(y * Math.sin(2 * rad(L0)) - 2 * e * Math.sin(rad(M)) +
			4 * e * y * Math.sin(rad(M)) * Math.cos(2 * rad(L0)) -
			0.5 * y * y * Math.sin(4 * rad(L0)) - 1.25 * e * e * Math.sin(2 * rad(M)));
		return { decl: decl, eq: eq };
	}

	/* cos of the hour angle at sunrise: above 1 the sun stays down, below -1 up */
	function cosRise(lat, decl) {
		return Math.cos(rad(ZENITH)) / (Math.cos(rad(lat)) * Math.cos(rad(decl))) -
			Math.tan(rad(lat)) * Math.tan(rad(decl));
	}

	/* The sun's height above the horizon at an instant, in degrees. */
	function elevation(lat, lon, ms) {
		var s = solar(century(ms));
		var minutes = ((ms / 60000) % 1440 + 1440) % 1440;
		var ha = rad((minutes + s.eq + 4 * lon) / 4 - 180);
		var cz = Math.sin(rad(lat)) * Math.sin(rad(s.decl)) + Math.cos(rad(lat)) * Math.cos(rad(s.decl)) * Math.cos(ha);
		return 90 - deg(Math.acos(Math.max(-1, Math.min(1, cz))));
	}

	/* Sunrise and sunset (epoch ms) of the solar day whose noon is nearest to
	 * `noonMs`, each refined at its own time; polar: 'day' | 'night' | ''.     */
	function sunEvents(lat, lon, noonMs) {
		var day = Math.round((noonMs - (720 - 4 * lon) * 60000) / 86400000);
		var base = day * 86400000;
		var s = solar(century(base + (720 - 4 * lon) * 60000));
		var c = cosRise(lat, s.decl);
		if (c > 1) return { rise: null, set: null, polar: 'night' };
		if (c < -1) return { rise: null, set: null, polar: 'day' };
		function event(sign) {
			var t = base + (720 - 4 * lon - s.eq) * 60000;
			for (var k = 0; k < 3; k++) {
				var p = solar(century(t));
				var ha = deg(Math.acos(Math.max(-1, Math.min(1, cosRise(lat, p.decl)))));
				t = base + (720 - 4 * (lon + sign * ha) - p.eq) * 60000;
			}
			return Math.round(t);
		}
		return { rise: event(1), set: event(-1), polar: '' };
	}

	function sameDay(d, y, m, dd) { return d.getFullYear() === y && d.getMonth() === m && d.getDate() === dd; }
	function clockMinutes(d) { return Math.round(d.getHours() * 60 + d.getMinutes() + d.getSeconds() / 60); }

	/* The sun for the phone's date at a place: the events, and the clock minutes
	 * on the phone that derive() calls sunriseMin/sunsetMin - null when the sun
	 * does not rise or set that day, or when its day straddles the phone's
	 * midnight (a place far from the phone's time zone).                      */
	function sun(lat, lon, date) {
		var y = date.getFullYear(), m = date.getMonth(), dd = date.getDate();
		var ev = sunEvents(lat, lon, new Date(y, m, dd, 12, 0, 0, 0).getTime());
		var out = { rise: ev.rise, set: ev.set, polar: ev.polar, riseMin: null, setMin: null };
		if (ev.rise === null) return out;
		var r = new Date(ev.rise), s = new Date(ev.set);
		if (sameDay(r, y, m, dd) && sameDay(s, y, m, dd)) {
			var rm = clockMinutes(r), sm = clockMinutes(s);
			if (rm < sm && sm < 1440) { out.riseMin = rm; out.setMin = sm; }
		}
		return out;
	}

	function sunFor(date) {
		var key = data.lat + ',' + data.lon + ',' + date.getFullYear() + '-' + date.getMonth() + '-' + date.getDate();
		if (!sunCache || sunCache.key !== key) sunCache = { key: key, sun: sun(data.lat, data.lon, date) };
		return sunCache.sun;
	}

	/* ---------------- loading ---------------- */

	function clear() {
		data = null;
		sunCache = null;
	}

	/* The page's copy of what the phone fetched. False, and nothing kept, for
	 * anything that is not a usable forecast.                                  */
	function load(d) {
		clear();
		if (typeof d === 'string') { try { d = JSON.parse(d); } catch (e) { return false; } }
		if (!d || typeof d !== 'object') return false;
		var body = d.body;
		if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return false; } }
		if (!body || typeof body !== 'object') return false;
		var source = d.source === 'met' ? 'met' : d.source === 'open-meteo' ? 'open-meteo' : null;
		if (!source) return false;
		var series = source === 'met' ? fromMet(body) : fromOpenMeteo(body);
		series.sort(function (a, b) { return a.t - b.t; });
		if (!series.length) return false;

		var lat = num(d.lat), lon = num(d.lon);
		if (lat === null || lon === null) {
			var g = body.geometry && body.geometry.coordinates;
			lat = num(body.latitude !== undefined ? body.latitude : g && g[1]);
			lon = num(body.longitude !== undefined ? body.longitude : g && g[0]);
		}
		if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return false;
		data = { source: source, series: series, lat: lat, lon: lon, fetchedAt: num(d.fetchedAt) || 0,
		         place: String(d.place || '') };
		return true;
	}

	/* the entry covering ms - the last one starting at or before it - or -1 */
	function indexAt(ms) {
		var s = data.series, lo = 0, hi = s.length - 1, best = -1;
		while (lo <= hi) {
			var mid = (lo + hi) >> 1;
			if (s[mid].t <= ms) { best = mid; lo = mid + 1; } else hi = mid - 1;
		}
		return (best !== -1 && ms < s[best].t + HOUR) ? best : -1;
	}

	function mmHg(hpa) { return hpa === null ? null : Math.round(hpa * MM_PER_HPA); }

	/* mm Hg the pressure will have changed by in the next three hours (as far
	 * ahead as the series reaches), as derive() measures its trend in mm      */
	function trend(i) {
		var s = data.series, now = mmHg(s[i].pressure), j, later = null;
		if (now === null) return 0;
		for (j = i + 1; j < s.length && s[j].t <= s[i].t + TREND_AHEAD; j++) {
			if (s[j].pressure !== null) later = mmHg(s[j].pressure);
		}
		return later === null ? 0 : later - now;
	}

	/* ---------------- the payload ---------------- */

	/* derive()'s payload for the hour `date` falls in, or null: nothing loaded,
	 * fetched more than 48 h ago, or no entry for this hour.                   */
	function now(date) {
		if (!data) return null;
		var ms = date.getTime();
		if (data.fetchedAt && ms - data.fetchedAt > STALE_MS) return null;
		var i = indexAt(ms);
		if (i === -1) return null;
		var e = data.series[i];
		var sn = sunFor(date);
		var m = date.getHours() * 60 + date.getMinutes();
		var r = sn.riseMin, s = sn.setMin;
		var night = (r !== null && s !== null) ? (m < r || m > s) :
			sn.polar === 'day' ? false : sn.polar === 'night' ? true :
			elevation(data.lat, data.lon, ms) < 90 - ZENITH;
		return {
			code: e.code,
			sky: e.sky,
			precip: e.precip,
			intensity: e.intensity,
			isThunder: e.isThunder,
			isNight: night,
			temp: e.temp === null ? null : Math.round(e.temp),
			wind: e.wind === null ? 0 : Math.round(e.wind * 10) / 10,
			windAngle: e.windAngle === null ? 0 : Math.round(e.windAngle),
			humidity: e.humidity === null ? 50 : Math.round(e.humidity),
			pressure: mmHg(e.pressure),
			pressureTrend: trend(i),
			moonCode: null,
			minutesToSunrise: r !== null ? r - m : null,
			minutesToSunset: s !== null ? s - m : null,
			sunriseMin: r,
			sunsetMin: s
		};
	}

	/* for the log: where it is from, for where, how old, how far it reaches */
	function describe(date) {
		if (!data) return 'none';
		var ms = (date || new Date()).getTime(), s = data.series;
		var age = data.fetchedAt ? Math.round((ms - data.fetchedAt) / 60000) + ' min old' : 'age unknown';
		var ahead = Math.round((s[s.length - 1].t + HOUR - ms) / HOUR);
		return data.source + (data.place ? ' for ' + data.place : '') + ', ' + age + ', ' + s.length +
			' hours, ' + ahead + ' h ahead';
	}

	return {
		load: load,
		clear: clear,
		loaded: function () { return !!data; },
		now: now,
		describe: describe,
		source: function () { return data ? data.source : null; },
		/* for the offline harness */
		series: function () { return data ? data.series.slice() : []; },
		fromOpenMeteo: fromOpenMeteo,
		fromMet: fromMet,
		wmo: wmo,
		metSymbol: metSymbol,
		sun: sun,
		sunEvents: sunEvents,
		elevation: elevation,
		STALE_MS: STALE_MS
	};
})();
