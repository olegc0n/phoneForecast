/* wxsource.js - where the forecast comes from, made to look like what the page
 * has always read.
 *
 * Two free sources, no key:
 *   - Open-Meteo (https://open-meteo.com): the forecast, every time it answers.
 *     Weather data by Open-Meteo.com, CC BY 4.0.
 *   - MET Norway Locationforecast 2.0 compact (https://api.met.no): only when
 *     Open-Meteo fails, and only inside the APK, because MET refuses a request
 *     that does not name the app and a contact in its User-Agent, and a page in
 *     a browser tab cannot set one. MainActivity appends it to the WebView's.
 *     Weather data by MET Norway, CC BY 4.0.
 *
 * AN ADAPTER, NOT A NEW PIPELINE. The display, weather.js's "fact or this hour"
 * logic, the cached file, the stale badge and the cat's derive() were all built
 * around one response shape, and they are right about everything except where
 * the numbers come from. So both sources are turned into that shape here:
 *
 *   { now, info: { lat, lon, source },
 *     fact: { temp, feels_like, icon, wind_speed, wind_angle, humidity, pressure_mm, pressure_hpa },
 *     forecasts: [ { date: 'YYYY-MM-DD', date_ts, sunrise: 'HH:MM', sunset: 'HH:MM',
 *                    moon_code: 0..15,
 *                    hours: [ { hour: '0'..'23', hour_ts, temp, feels_like, icon,
 *                               wind_speed, wind_angle, humidity, pressure_mm, pressure_hpa } ],
 *                    parts: { night | morning | day | evening:
 *                             { temp_avg, icon, wind_speed, wind_angle } } } ] }
 *
 * with exactly the fields view.js, weather.js and derive() read, in their units:
 * degrees C as integers, wind in m/s (one decimal), its direction as the
 * meteorological "from" angle, humidity in %, pressure in mm Hg (hPa x
 * 0.750062) and, for the English screen, in hPa as the sources give it. The weather.js cache keeps the RAW response and runs it through
 * here on every read, so a better adapter in a new build re-reads the old file.
 *
 * ICON CODES are the ones the stylesheet has a picture for:
 *   skc_d skc_n bkn_d bkn_n ovc
 *   ovc_-ra ovc_ra ovc_+ra ovc_-sn ovc_sn ovc_+sn ovc_ra_sn
 *   bkn_-ra_d bkn_ra_d bkn_+ra_d bkn_-sn_d bkn_sn_d bkn_+sn_d (and _n)
 *   ovc_ts ovc_ts_ra ovc_ts_sn
 * splitCode() in weather.js reads the sky, the precipitation, its strength and
 * thunder back out of them, so the cat sees exactly what the icon shows.
 * check-weather.js asserts both: every code has a CSS rule, and every source
 * condition survives the round trip.
 *
 * TIME IS THE PHONE'S. Days are the phone's calendar days and hours its clock
 * hours, as the clock on the same screen is. Sunrise and sunset are computed
 * here for the place (the NOAA solar position algorithm, the one behind NOAA's
 * solar calculator), so both sources behave the same and MET, which has none,
 * needs nothing more; day and night in the icons come from the sun's height at
 * the middle of each hour. The moon phase is computed too (a mean synodic month
 * from a known new moon - good to a few hours, which is far finer than the 16
 * pictures). None of it is asked of the network.                           */

var WxSource = (function () {
	var HOUR = 3600 * 1000;
	var MM_PER_HPA = 0.750062;
	var ZENITH = 90.833;                  /* sunrise: the sun's upper limb on the horizon, refraction included */
	var SYNODIC = 29.530588853;           /* days, new moon to new moon */
	var NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

	var OPEN_METEO = 'https://api.open-meteo.com/v1/forecast';
	var MET = 'https://api.met.no/weatherapi/locationforecast/2.0/compact';
	var OM_VARS = 'temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,' +
		'wind_speed_10m,wind_direction_10m,pressure_msl,precipitation';

	var LABEL = { 'open-meteo': 'Open-Meteo.com', 'met': 'MET Norway' };

	/* WMO weather codes (Open-Meteo's weather_code): [sky, precip, intensity, thunder].
	 * intensity: -1 light, 0 moderate, +1 heavy.                              */
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
	 * The prefix is the intensity (MET itself spells two codes "lights..."). */
	var METSYM = {
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

	/* ---------------- small helpers ---------------- */

	function num(v) {
		if (v === null || v === undefined || v === '') return null;
		var n = +v;
		return (n === n && isFinite(n)) ? n : null;
	}
	function isArray(a) { return Object.prototype.toString.call(a) === '[object Array]'; }
	function at(a, i) { return isArray(a) ? num(a[i]) : null; }
	function rad(d) { return d * Math.PI / 180; }
	function deg(r) { return r * 180 / Math.PI; }
	function two(n) { return n < 10 ? '0' + n : '' + n; }
	function ymd(d) { return d.getFullYear() + '-' + two(d.getMonth() + 1) + '-' + two(d.getDate()); }
	function clock(min) { return two(Math.floor(min / 60)) + ':' + two(min % 60); }

	/* ---------------- the requests ---------------- */

	/* The coordinates are the only thing sent: 2 decimals (about 1 km) to
	 * Open-Meteo, 4 (MET's maximum, about 10 m) to MET. */
	function openMeteoUrl(lat, lon) {
		return OPEN_METEO + '?latitude=' + Number(lat).toFixed(2) + '&longitude=' + Number(lon).toFixed(2) +
			'&current=' + OM_VARS + '&hourly=' + OM_VARS +
			'&timezone=auto&forecast_days=3&wind_speed_unit=ms&timeformat=unixtime';
	}

	function metUrl(lat, lon) {
		return MET + '?lat=' + Number(lat).toFixed(4) + '&lon=' + Number(lon).toFixed(4);
	}

	/* ---------------- conditions ---------------- */

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
		if (!METSYM.hasOwnProperty(s)) {
			for (i = 0; i < MET_PREFIX.length; i++) {
				var p = MET_PREFIX[i][0];
				if (s.indexOf(p) === 0 && METSYM.hasOwnProperty(s.slice(p.length))) {
					s = s.slice(p.length);
					intensity = MET_PREFIX[i][1];
					break;
				}
			}
		}
		var row = METSYM.hasOwnProperty(s) ? METSYM[s] : ['bkn', null];
		return { sky: row[0], precip: row[1], intensity: row[1] ? intensity : 0, isThunder: thunder };
	}

	/* The icon the stylesheet draws for a condition, and the code splitCode()
	 * reads it back from. Precipitation under a clear or broken sky is a shower;
	 * sleet has one picture whatever its strength; thunder with snow keeps the
	 * snow (its picture is heavy snow) so she still dresses for it.            */
	function iconCode(w, night) {
		var dn = night ? '_n' : '_d';
		if (w.isThunder) return w.precip === 'sn' ? 'ovc_ts_sn' : w.precip ? 'ovc_ts_ra' : 'ovc_ts';
		if (!w.precip) return w.sky === 'ovc' ? 'ovc' : (w.sky === 'bkn' ? 'bkn' : 'skc') + dn;
		if (w.precip === 'ra_sn') return 'ovc_ra_sn';
		var i = w.intensity > 0 ? '+' : w.intensity < 0 ? '-' : '';
		if (w.sky === 'ovc') return 'ovc_' + i + w.precip;
		return 'bkn_' + i + w.precip + dn;
	}

	/* ---------------- the two normalisers ---------------- */

	/* One hour of either source, before it is put into the page's shape:
	 * { t (epoch ms, the start of the hour), sky, precip, intensity, isThunder,
	 *   temp, feels, wind, windAngle, humidity, pressure (hPa) }               */
	function entry(t, w, temp, feels, wind, angle, humidity, pressure) {
		return { t: t, sky: w.sky, precip: w.precip, intensity: w.intensity, isThunder: w.isThunder,
		         temp: temp, feels: feels, wind: wind, windAngle: angle, humidity: humidity, pressure: pressure };
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
			out.push(entry(t * 1000, wmo(code, at(h.precipitation, i), temp), temp,
				at(h.apparent_temperature, i), at(h.wind_speed_10m, i), at(h.wind_direction_10m, i),
				at(h.relative_humidity_2m, i), at(h.pressure_msl, i)));
		}
		return out;
	}

	/* current=...: the model's state now (15-minute data), when it was asked for */
	function currentOpenMeteo(b) {
		var c = b && b.current;
		if (!c || num(c.time) === null || num(c.temperature_2m) === null) return null;
		var code = num(c.weather_code !== undefined ? c.weather_code : c.weathercode);
		var temp = num(c.temperature_2m);
		return entry(num(c.time) * 1000, wmo(code, num(c.precipitation), temp), temp,
			num(c.apparent_temperature), num(c.wind_speed_10m), num(c.wind_direction_10m),
			num(c.relative_humidity_2m), num(c.pressure_msl));
	}

	/* Locationforecast 2.0 compact: properties.timeseries, ISO times in UTC.
	 * Hourly for about two and a half days, then six-hourly; a six-hourly
	 * entry is spread over its hours, so the series stays hourly. No feels-like. */
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
				out.push(entry(list[i].t + k * HOUR, w, num(inst.air_temperature), null,
					num(inst.wind_speed), num(inst.wind_from_direction),
					num(inst.relative_humidity), num(inst.air_pressure_at_sea_level)));
			}
		}
		return out;
	}

	function series(src, body) {
		var s = src === 'met' ? fromMet(body) : src === 'open-meteo' ? fromOpenMeteo(body) : [];
		s.sort(function (a, b) { return a.t - b.t; });
		return s;
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

	function nightAt(lat, lon, ms) { return elevation(lat, lon, ms) < 90 - ZENITH; }

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

	/* Sunrise and sunset as clock minutes on the phone for the phone's date at
	 * a place, or null for both when the sun does not rise or set that day, or
	 * when its day straddles the phone's midnight (a place far from the phone's
	 * time zone).                                                             */
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

	/* ---------------- the moon ---------------- */

	/* The phase as the 16 pictures number it: 0 full, 4 last quarter, 8 new,
	 * 12 first quarter (moon_0 is the whole disc, moon_8 none of it). */
	function moonCode(ms) {
		var age = ((ms - NEW_MOON) / 86400000) % SYNODIC;
		if (age < 0) age += SYNODIC;
		return (8 + Math.round(age / SYNODIC * 16)) % 16;
	}

	/* ---------------- into the old shape ---------------- */

	function record(e, lat, lon, mid) {
		var r = { icon: iconCode(e, nightAt(lat, lon, mid)) };
		if (e.temp !== null) r.temp = Math.round(e.temp);
		if (e.feels !== null) r.feels_like = Math.round(e.feels);
		if (e.wind !== null) r.wind_speed = Math.round(e.wind * 10) / 10;
		if (e.windAngle !== null) r.wind_angle = Math.round(e.windAngle);
		if (e.humidity !== null) r.humidity = Math.round(e.humidity);
		if (e.pressure !== null) {
			r.pressure_mm = Math.round(e.pressure * MM_PER_HPA);
			r.pressure_hpa = Math.round(e.pressure);     /* what English shows */
		}
		return r;
	}

	/* the entry covering ms - the last one starting at or before it - or null */
	function entryAt(s, ms) {
		var best = null;
		for (var i = 0; i < s.length && s[i].t <= ms; i++) best = s[i];
		return (best && ms < best.t + HOUR) ? best : null;
	}

	/* Six hours in one picture, the way a forecast says "rain in the morning":
	 * wet when two of the hours are (or the only one is), as wet as its wettest
	 * kind gets; dry, the commonest sky, cloudier on a tie. Thunder in any hour
	 * is thunder.                                                              */
	function summarise(list) {
		var wet = [], thunder = false, skies = { skc: 0, bkn: 0, ovc: 0 }, i;
		for (i = 0; i < list.length; i++) {
			if (list[i].isThunder) thunder = true;
			if (list[i].precip) wet.push(list[i]);
			skies[list[i].sky] = (skies[list[i].sky] || 0) + 1;
		}
		if (wet.length && (thunder || wet.length >= Math.min(2, list.length))) {
			var count = { sn: 0, ra_sn: 0, ra: 0 }, kind = 'ra', best = -1;
			for (i = 0; i < wet.length; i++) count[wet[i].precip]++;
			var order = ['sn', 'ra_sn', 'ra'];               /* a tie goes to the colder */
			for (i = 0; i < order.length; i++) if (count[order[i]] > best) { best = count[order[i]]; kind = order[i]; }
			var intensity = -1, ovc = false;
			for (i = 0; i < wet.length; i++) {
				if (wet[i].precip !== kind) continue;
				if (wet[i].intensity > intensity) intensity = wet[i].intensity;
				if (wet[i].sky === 'ovc') ovc = true;
			}
			return { sky: ovc ? 'ovc' : 'bkn', precip: kind, intensity: intensity, isThunder: thunder };
		}
		var sky = (skies.ovc >= skies.bkn && skies.ovc >= skies.skc) ? 'ovc' : (skies.bkn >= skies.skc ? 'bkn' : 'skc');
		return { sky: sky, precip: null, intensity: 0, isThunder: false };
	}

	function mean(list, k) {
		var s = 0, n = 0;
		for (var i = 0; i < list.length; i++) if (list[i][k] !== null) { s += list[i][k]; n++; }
		return n ? s / n : null;
	}

	/* the direction the wind mostly comes from, weighted by its speed */
	function meanAngle(list) {
		var x = 0, y = 0, n = 0;
		for (var i = 0; i < list.length; i++) {
			var a = list[i].windAngle;
			if (a === null) continue;
			var w = list[i].wind === null ? 1 : Math.max(0.1, list[i].wind);
			x += Math.cos(rad(a)) * w;
			y += Math.sin(rad(a)) * w;
			n++;
		}
		if (!n) return null;
		return Math.round((deg(Math.atan2(y, x)) + 360) % 360);
	}

	var PARTS = [['night', 0], ['morning', 6], ['day', 12], ['evening', 18]];

	function part(list, lat, lon, midMs) {
		var t = mean(list, 'temp'), w = mean(list, 'wind'), a = meanAngle(list);
		var p = { icon: iconCode(summarise(list), nightAt(lat, lon, midMs)) };
		if (t !== null) p.temp_avg = Math.round(t);
		if (w !== null) p.wind_speed = Math.round(w * 10) / 10;
		if (a !== null) p.wind_angle = a;
		return p;
	}

	function day(list, lat, lon) {
		var d0 = new Date(list[0].t);
		var y = d0.getFullYear(), m = d0.getMonth(), dd = d0.getDate();
		var noon = new Date(y, m, dd, 12, 0, 0, 0);
		var out = { date: ymd(d0), date_ts: Math.floor(new Date(y, m, dd, 0, 0, 0, 0).getTime() / 1000),
		            moon_code: moonCode(noon.getTime()), hours: [], parts: {} };
		var s = sun(lat, lon, noon);
		if (s.riseMin !== null) { out.sunrise = clock(s.riseMin); out.sunset = clock(s.setMin); }

		var i, k, by = [[], [], [], []];
		for (i = 0; i < list.length; i++) {
			var h = new Date(list[i].t).getHours();
			var r = record(list[i], lat, lon, list[i].t + HOUR / 2);
			r.hour = String(h);
			r.hour_ts = Math.floor(list[i].t / 1000);
			out.hours.push(r);
			by[Math.floor(h / 6)].push(list[i]);
		}
		for (k = 0; k < PARTS.length; k++) {
			if (!by[k].length) continue;
			out.parts[PARTS[k][0]] = part(by[k], lat, lon, new Date(y, m, dd, PARTS[k][1] + 3, 0, 0, 0).getTime());
		}
		return out;
	}

	/* The forecast in the page's shape, or null for anything that is not a usable
	 * one. `fetchedAt` is when it was asked for: the moment `fact` describes
	 * when the source has no "current" block of its own (MET never does).    */
	function adapt(src, body, lat, lon, fetchedAt) {
		if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return null; } }
		if (!body || typeof body !== 'object') return null;
		if (src !== 'open-meteo' && src !== 'met') return null;
		var s = series(src, body);
		if (!s.length) return null;

		lat = num(lat); lon = num(lon);
		if (lat === null || lon === null) {
			var g = body.geometry && body.geometry.coordinates;
			lat = num(body.latitude !== undefined ? body.latitude : g && g[1]);
			lon = num(body.longitude !== undefined ? body.longitude : g && g[0]);
		}
		if (lat === null || lon === null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;

		var when = num(fetchedAt) || s[0].t;
		var cur = src === 'open-meteo' ? currentOpenMeteo(body) : null;
		var fe = cur || entryAt(s, when) || (when < s[0].t ? s[0] : null);
		if (!fe) return null;                 /* it does not reach the moment it was fetched */

		var forecasts = [], i, run = [], key = '';
		for (i = 0; i < s.length; i++) {
			var k = ymd(new Date(s[i].t));
			if (k !== key && run.length) { forecasts.push(day(run, lat, lon)); run = []; }
			key = k;
			run.push(s[i]);
		}
		if (run.length) forecasts.push(day(run, lat, lon));

		return {
			now: Math.floor(when / 1000),
			info: { lat: lat, lon: lon, source: src },
			fact: record(fe, lat, lon, cur ? cur.t : when),
			forecasts: forecasts
		};
	}

	return {
		openMeteoUrl: openMeteoUrl,
		metUrl: metUrl,
		adapt: adapt,
		label: function (src) { return LABEL.hasOwnProperty(src) ? LABEL[src] : ''; },
		/* for the offline harness */
		series: series,
		wmo: wmo,
		metSymbol: metSymbol,
		iconCode: iconCode,
		summarise: summarise,
		sun: sun,
		elevation: elevation,
		moonCode: moonCode,
		WMO: WMO,
		METSYM: METSYM
	};
})();
