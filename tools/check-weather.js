/* check-weather.js - does the free forecast actually work?
 *
 *   node tools/check-weather.js
 *
 * Loads the REAL src/core/dom.js, wxsource.js and weather.js into a sandbox and
 * fakes only the browser: a clock it can move, a Store, a network that answers
 * from the captured responses in tools/fixtures/ (Open-Meteo and MET Norway for
 * Berlin, 20 Nov 2026) or from synthetic ones. Nothing here touches the network.
 *
 * What it proves, in order:
 *   1. the adapter: both sources come out in the shape view.js, weather.js and
 *      derive() read, in their units, with an icon the stylesheet can draw;
 *   2. conditions survive the trip through the icon code to the cat;
 *   3. sunrise, sunset, day/night and the moon are computed right;
 *   4. what reaches the screen and the cat;
 *   5. the current hour is found, and a stale file is handled;
 *   6. the cached file decides when to call, so a launch is free;
 *   7. no request can reach anything but Open-Meteo and MET Norway;
 *   8. the fetch policy: hourly, the backoff, offline, the daily ceiling, the
 *      MET fallback with Expires and If-Modified-Since, a change of place.
 *
 * The fixtures are Berlin's, so the harness runs on Berlin time: the phone's
 * calendar days and the place's are then the same, as they are on a shelf.  */

process.env.TZ = 'Europe/Berlin';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var BASE = read('src/informer.base.html');
/* Every top-level config line, not a hand-picked subset. Picking a subset is how
 * this harness once failed on its first run: parse() reads a `period` table
 * that was not on the list. */
var CONFIG = BASE.split('\n').filter(function (l) { return /^var [a-z_]+ *=/.test(l); }).join('\n');

var FIX = {
	om: read('tools/fixtures/open-meteo-forecast-berlin.json'),
	met: read('tools/fixtures/met-compact-berlin.json'),
	metHeaders: headersOf(read('tools/fixtures/met-compact-berlin.headers.txt'))
};
var BERLIN = { lat: 52.52, lon: 13.41, name: 'Berlin, Germany' };
var FETCHED = Date.UTC(2026, 10, 20, 13, 38, 0);       /* when the fixtures were captured */

function headersOf(txt) {
	var h = {};
	txt.split(/\r?\n/).forEach(function (l) {
		var i = l.indexOf(':');
		if (i > 0) h[l.slice(0, i).trim()] = l.slice(i + 1).trim();
	});
	return h;
}

/* ---------------------------------------------------------------- the classes the stylesheet draws */

var CSS = {};
BASE.split('\n').forEach(function (l) {
	if (!/^\.[^{]*\{\s*$/.test(l)) return;
	l.replace(/\{.*$/, '').split(',').forEach(function (sel) {
		sel = sel.trim();
		if (sel.charAt(0) === '.') CSS[sel.slice(1).replace(/\\/g, '')] = true;
	});
});

/* ---------------------------------------------------------------- a clock the page cannot tell from the real one */

var RealDate = Date;
var NOW = FETCHED;
class FakeDate extends RealDate {
	constructor() {
		if (arguments.length === 0) super(NOW);
		else super(...arguments);
	}
	static now() { return NOW; }
}

/* ---------------------------------------------------------------- the sandbox */

/* opts: { disk, native, online, place: {lat, lon, name} | null, net: fn(url, headers) -> reply }
 * A reply is { status, body, headers } or { error } or 'defer' (answered later
 * through ctx.deferred). */
function makeCtx(opts) {
	opts = opts || {};
	var disk = opts.disk || {};
	var sb = {
		console: { log: function () {}, warn: function () {} },
		Math: Math, JSON: JSON, Number: Number, String: String, RegExp: RegExp, Object: Object,
		Array: Array, isFinite: isFinite, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
		encodeURIComponent: encodeURIComponent,
		Date: FakeDate,
		/* the Russian screen, whose words these checks were written in; English is check-i18n.js's */
		navigator: { onLine: opts.online !== false, language: 'ru-RU' },
		Store: {
			persistent: function () { return true; },
			getJSON: function (k) { return disk[k] ? JSON.parse(disk[k]) : null; },
			setJSON: function (k, v) { disk[k] = JSON.stringify(v); },
			get: function (k) { return disk.hasOwnProperty(k) ? disk[k] : null; },
			set: function (k, v) { disk[k] = v; }
		},
		View: {
			update: function (result, stamp) { sb.painted.push({ result: result, stamp: stamp }); },
			data: function () { return null; },
			forget: function () { sb.forgot++; }
		},
		Bus: { emit: function (topic, payload) { if (topic === 'weather') sb.published = payload; } },
		Host: { native: function () { return !!opts.native; } },
		painted: [], published: null, forgot: 0, requests: [], deferred: [],
		net: opts.net || okNet
	};
	sb.window = sb;
	sb.document = {
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		getElementById: function () { return null; }
	};
	var ctx = vm.createContext(sb);
	vm.runInContext(CONFIG, ctx, { filename: 'config' });
	vm.runInContext(read('src/core/dom.js'), ctx, { filename: 'dom.js' });
	vm.runInContext(read('src/core/i18n.js'), ctx, { filename: 'i18n.js' });
	vm.runInContext(read('src/core/wxsource.js'), ctx, { filename: 'wxsource.js' });
	vm.runInContext(read('src/core/weather.js'), ctx, { filename: 'weather.js' });

	/* the only way out of the sandbox: every request recorded, answered by sb.net */
	sb.__net = function (url, headers, reply) {
		sb.requests.push({ url: url, headers: headers || {} });
		var r = sb.net(url, headers || {});
		if (r === 'defer') sb.deferred.push(reply);
		else reply(r);
	};
	vm.runInContext(
		'getJSON = function (u, h, t, ok, bad) { __net(u, h, function (r) {' +
		'  if (r.error) { bad(r.error); return; }' +
		'  if (r.status < 200 || r.status > 299) { bad("http " + r.status); return; }' +
		'  var d; try { d = JSON.parse(r.body); } catch (e) { bad("parse"); return; }' +
		'  ok(d, r.body); }); };' +
		'httpGet = function (u, h, t, cb) { __net(u, h, function (r) {' +
		'  if (r.error) { cb(r.error, 0, "", function () { return ""; }); return; }' +
		'  cb(null, r.status, r.body || "", function (n) { return (r.headers || {})[n] || ""; }); }); };',
		ctx);

	var p = opts.place === undefined ? BERLIN : opts.place;
	if (p) { sb.place_lat = p.lat; sb.place_lon = p.lon; sb.place_name = p.name; }
	return sb;
}

/* ---------------------------------------------------------------- networks */

function isOM(u) { return u.indexOf('https://api.open-meteo.com/v1/forecast?') === 0; }
function isMET(u) { return u.indexOf('https://api.met.no/weatherapi/locationforecast/2.0/compact?') === 0; }

/* Open-Meteo answers with a forecast made for "now", whatever now is */
function okNet(url) {
	if (isOM(url)) return { status: 200, body: JSON.stringify(synthOM(NOW)) };
	if (isMET(url)) return { status: 200, body: FIX.met, headers: {} };
	return { status: 404, body: '' };
}

function failNet(url) {
	if (isOM(url)) return { error: 'network' };
	if (isMET(url)) return { error: 'network' };
	return { status: 404, body: '' };
}

/* 72 hours from the phone's midnight. Hour N of day 0 is N degrees, of day 1
 * 100 + N, so picking the wrong hour is visible rather than plausible. The
 * `current` block is 99 degrees, so the fact is told apart from any hour. */
function synthOM(nowMs, noCurrent) {
	var d = new RealDate(nowMs);
	var h = { time: [], temperature_2m: [], apparent_temperature: [], relative_humidity_2m: [], weather_code: [],
	          wind_speed_10m: [], wind_direction_10m: [], pressure_msl: [], precipitation: [] };
	for (var i = 0; i < 72; i++) {
		var t = new RealDate(d.getFullYear(), d.getMonth(), d.getDate() + Math.floor(i / 24), i % 24, 0, 0, 0).getTime();
		h.time.push(t / 1000);
		h.temperature_2m.push(Math.floor(i / 24) * 100 + i % 24);
		h.apparent_temperature.push(Math.floor(i / 24) * 100 + i % 24 - 2);
		h.relative_humidity_2m.push(60);
		h.weather_code.push(i % 6 === 0 ? 63 : 2);
		h.wind_speed_10m.push(3 + i % 5);
		h.wind_direction_10m.push(180);
		h.pressure_msl.push(997.3);
		h.precipitation.push(i % 6 === 0 ? 0.6 : 0);
	}
	var body = { latitude: 52.52, longitude: 13.42, utc_offset_seconds: 3600, timezone: 'Europe/Berlin', hourly: h };
	if (!noCurrent) {
		body.current = { time: Math.floor(nowMs / 900000) * 900, interval: 900, temperature_2m: 99.2,
		                 apparent_temperature: 96.6, relative_humidity_2m: 75, weather_code: 3,
		                 wind_speed_10m: 2.04, wind_direction_10m: 200, pressure_msl: 993.3, precipitation: 0 };
	}
	return body;
}

function cacheFor(src, raw, t, place, extra) {
	place = place || BERLIN;
	var c = { v: 2, t: t, src: src, key: place.lat.toFixed(4) + ',' + place.lon.toFixed(4),
	          lat: place.lat, lon: place.lon, place: place.name, raw: raw };
	for (var k in extra || {}) c[k] = extra[k];
	return c;
}

/* ---------------------------------------------------------------- checks */

var pass = 0, fail = 0;

function check(name, got, want) {
	var ok = String(got) === String(want);
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name +
		(ok ? '   ' + got : '   got ' + got + ', wanted ' + want));
	if (ok) pass++; else fail++;
}

function checkTrue(name, cond, detail) {
	console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
	if (cond) pass++; else fail++;
}

function head(t) { console.log('\n' + t); }

function hhmmOf(ms) { var d = new RealDate(ms); return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2); }
function minutesOf(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }

/* every icon code anywhere in an adapted forecast */
function iconsIn(data) {
	var out = [data.fact.icon];
	data.forecasts.forEach(function (f) {
		f.hours.forEach(function (h) { out.push(h.icon); });
		for (var p in f.parts) out.push(f.parts[p].icon);
	});
	return out;
}

console.log('\n' + '='.repeat(70));
console.log('THE FREE FORECAST - Open-Meteo, MET Norway, offline');
console.log('='.repeat(70));

/* ================================================================ 1. adapter */

var cx = makeCtx();
var W = cx.Weather, S = cx.WxSource;

head('1. the adapter: Open-Meteo, as captured (hourly only, no "current" block)');
NOW = FETCHED;
var omBody = JSON.parse(FIX.om);
var om = S.adapt('open-meteo', omBody, BERLIN.lat, BERLIN.lon, FETCHED);
checkTrue('a usable forecast', !!om);
check('three calendar days', om.forecasts.length, 3);
check('  dated by the phone\'s calendar', om.forecasts.map(function (f) { return f.date; }).join(' '),
	'2026-11-20 2026-11-21 2026-11-22');
check('  24 hours each, numbered 0..23',
	om.forecasts.map(function (f) { return f.hours.length + ':' + f.hours[0].hour + '-' + f.hours[23].hour; }).join(' '),
	'24:0-23 24:0-23 24:0-23');
var iNow = omBody.hourly.time.reduce(function (best, t, i) { return t * 1000 <= FETCHED ? i : best; }, -1);
check('fact = the hour the call was made in (no "current" asked of the capture)', om.fact.temp,
	Math.round(omBody.hourly.temperature_2m[iNow]));
check('  pressure in mm Hg (hPa x 0.750062)', om.fact.pressure_mm, Math.round(omBody.hourly.pressure_msl[iNow] * 0.750062));
check('  wind in m/s, one decimal', om.fact.wind_speed, Math.round(omBody.hourly.wind_speed_10m[iNow] * 10) / 10);
check('  wind direction, degrees "from"', om.fact.wind_angle, Math.round(omBody.hourly.wind_direction_10m[iNow]));
check('  humidity %', om.fact.humidity, Math.round(omBody.hourly.relative_humidity_2m[iNow]));
checkTrue('  no feels-like when the source has none', om.fact.feels_like === undefined);
checkTrue('  every hour carries temp, icon, wind, humidity, pressure, hour_ts',
	om.forecasts.every(function (f) { return f.hours.every(function (h) {
		return typeof h.temp === 'number' && typeof h.icon === 'string' && typeof h.wind_speed === 'number' &&
			typeof h.wind_angle === 'number' && typeof h.humidity === 'number' && typeof h.pressure_mm === 'number' &&
			typeof h.hour_ts === 'number' && typeof h.hour === 'string';
	}); }));
checkTrue('  four parts a day, each with temp_avg, icon, wind_speed, wind_angle',
	om.forecasts.every(function (f) {
		return ['night', 'morning', 'day', 'evening'].every(function (p) {
			var x = f.parts[p];
			return x && typeof x.temp_avg === 'number' && typeof x.icon === 'string' &&
				typeof x.wind_speed === 'number' && typeof x.wind_angle === 'number';
		});
	}));
check('  the morning is the mean of 06..11', om.forecasts[0].parts.morning.temp_avg,
	Math.round(omBody.hourly.temperature_2m.slice(6, 12).reduce(function (a, b) { return a + b; }, 0) / 6));
checkTrue('  a moon code 0..15 every day', om.forecasts.every(function (f) { return f.moon_code >= 0 && f.moon_code <= 15; }));
var omIcons = iconsIn(om);
var noCss = omIcons.filter(function (c) { return !CSS[c]; });
checkTrue('every icon code has a picture in the stylesheet', !noCss.length,
	noCss.length ? 'missing: ' + noCss.join(' ') : omIcons.length + ' icons');

head('   sunrise and sunset are computed, and agree with Open-Meteo\'s own');
om.forecasts.forEach(function (f, i) {
	var r = hhmmOf(omBody.daily.sunrise[i] * 1000), s = hhmmOf(omBody.daily.sunset[i] * 1000);
	checkTrue(f.date + ' sunrise ' + f.sunrise + ' / sunset ' + f.sunset,
		Math.abs(minutesOf(f.sunrise) - minutesOf(r)) <= 2 && Math.abs(minutesOf(f.sunset) - minutesOf(s)) <= 2,
		'Open-Meteo says ' + r + ' / ' + s);
});

head('   with the "current" block the app asks for');
var omCur = JSON.parse(FIX.om);
omCur.current = { time: Math.floor(FETCHED / 1000 / 900) * 900, interval: 900, temperature_2m: 7.4,
                  apparent_temperature: 3.6, relative_humidity_2m: 81, weather_code: 3, wind_speed_10m: 4.26,
                  wind_direction_10m: 271, pressure_msl: 1003.2, precipitation: 0 };
var omc = S.adapt('open-meteo', omCur, BERLIN.lat, BERLIN.lon, FETCHED);
check('fact is the "current" block', [omc.fact.temp, omc.fact.feels_like, omc.fact.icon, omc.fact.wind_speed,
	omc.fact.wind_angle, omc.fact.humidity, omc.fact.pressure_mm].join(' '), '7 4 ovc 4.3 271 81 752');
var url = S.openMeteoUrl(BERLIN.lat, BERLIN.lon);
checkTrue('the request asks for "current", hourly, m/s, unixtime, 3 days',
	/[?&]current=[^&]*apparent_temperature/.test(url) && /[?&]hourly=[^&]*weather_code/.test(url) &&
	/wind_speed_unit=ms/.test(url) && /timeformat=unixtime/.test(url) && /forecast_days=3/.test(url), url);

head('1b. the adapter: MET Norway compact, as captured');
var metBody = JSON.parse(FIX.met);
var met = S.adapt('met', metBody, BERLIN.lat, BERLIN.lon, FETCHED);
checkTrue('a usable forecast', !!met);
var ser = S.series('met', metBody);
checkTrue('hourly throughout: the six-hourly tail is spread over its hours',
	ser.every(function (e, i) { return i === 0 || e.t - ser[i - 1].t === 3600000; }),
	ser.length + ' hours, to ' + new RealDate(ser[ser.length - 1].t).toISOString().slice(0, 16));
var ts0 = metBody.properties.timeseries[0].data.instant.details;
check('fact = the hour the call was made in', [met.fact.temp, met.fact.pressure_mm, met.fact.humidity, met.fact.icon].join(' '),
	[Math.round(ts0.air_temperature), Math.round(ts0.air_pressure_at_sea_level * 0.750062),
	 Math.round(ts0.relative_humidity), 'bkn_d'].join(' '));
check('today starts at the first hour MET gives', met.forecasts[0].date + ' from ' + met.forecasts[0].hours[0].hour, '2026-11-20 from 14');
checkTrue('ten days of it', met.forecasts.length >= 10, met.forecasts.length + ' days');
checkTrue('MET has no sunrise; the adapter computes the same one',
	met.forecasts[0].sunrise === om.forecasts[0].sunrise && met.forecasts[0].sunset === om.forecasts[0].sunset,
	met.forecasts[0].sunrise + ' / ' + met.forecasts[0].sunset);
var metIcons = iconsIn(met);
noCss = metIcons.filter(function (c) { return !CSS[c]; });
checkTrue('every icon code has a picture in the stylesheet', !noCss.length,
	noCss.length ? 'missing: ' + noCss.join(' ') : metIcons.length + ' icons');
checkTrue('MET "snow" comes out as snow', metIcons.indexOf('ovc_sn') !== -1);
checkTrue('MET URL: 4 decimals, nothing else', S.metUrl(52.520008, 13.404954) ===
	'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.5200&lon=13.4050', S.metUrl(52.520008, 13.404954));
checkTrue('Open-Meteo URL: 2 decimals', /^https:\/\/api\.open-meteo\.com\/v1\/forecast\?latitude=52\.52&longitude=13\.40&/.test(
	S.openMeteoUrl(52.520008, 13.404954)));
checkTrue('not a forecast -> null', S.adapt('open-meteo', { hourly: {} }, 1, 2, FETCHED) === null &&
	S.adapt('met', '{"type":"Feature"}', 1, 2, FETCHED) === null && S.adapt('yandex', omBody, 1, 2, FETCHED) === null);

/* ================================================================ 2. conditions */

head('2. conditions survive the icon code, so the cat sees what the icon shows');
var trips = [], lost = [];
function trip(label, w) {
	var code = S.iconCode(w, false), b = W.splitCode(code);
	trips.push(code);
	var wantPrecip = w.isThunder && w.precip === 'ra_sn' ? 'ra' : w.precip;        /* documented: sleet storms read as rain */
	/* kept: what falls, thunder, the sky when nothing falls, and how hard rain
	 * or snow falls outside a storm (a storm and sleet have one picture each) */
	var ok = !!CSS[code] && b.precip === wantPrecip && b.thunder === w.isThunder &&
		(w.precip || b.sky === w.sky) &&
		(!((w.precip === 'ra' || w.precip === 'sn') && !w.isThunder) || b.intensity === w.intensity);
	if (!ok) lost.push(label + ' -> ' + code);
}
Object.keys(S.WMO).forEach(function (c) { trip('wmo ' + c, S.wmo(+c, null, null)); });
var fams = Object.keys(S.METSYM);
fams.forEach(function (f) {
	['', 'light', 'heavy'].forEach(function (pre) {
		/* MET has thunder only with something falling: rainandthunder, ... */
		(S.METSYM[f][1] ? ['', 'andthunder'] : ['']).forEach(function (suf) {
			['_day', '_night', ''].forEach(function (dn) {
				var sym = pre + f + suf + dn;
				trip('met ' + sym, S.metSymbol(sym));
			});
		});
	});
});
checkTrue('every WMO code and MET symbol: precipitation, thunder, sky and strength kept', !lost.length,
	lost.length ? lost.slice(0, 6).join('; ') : trips.length + ' conditions');
check('drizzle is light rain', S.iconCode(S.wmo(53, null, null), false), 'ovc_-ra');
check('heavy snow showers at night', S.iconCode(S.wmo(86, null, null), true), 'bkn_+sn_n');
check('a thunderstorm', S.iconCode(S.wmo(95, null, null), false), 'ovc_ts_ra');
check('MET heavy snow with thunder keeps the snow', W.splitCode(S.iconCode(S.metSymbol('heavysnowandthunder'), false)).precip, 'sn');
check('an unknown WMO code with 2 mm below zero is snow', S.wmo(42, 2, -3).precip, 'sn');
check('a six-hour part with two wet hours is wet', S.iconCode(S.summarise([
	S.wmo(0, 0, 5), S.wmo(0, 0, 5), S.wmo(61, 0, 5), S.wmo(63, 0, 5), S.wmo(1, 0, 5), S.wmo(2, 0, 5)]), false), 'ovc_ra');
check('...and one shower in six is not', S.iconCode(S.summarise([
	S.wmo(0, 0, 5), S.wmo(0, 0, 5), S.wmo(80, 0, 5), S.wmo(1, 0, 5), S.wmo(2, 0, 5), S.wmo(2, 0, 5)]), false), 'bkn_d');

/* ================================================================ 3. sun and moon */

head('3. the sun and the moon, computed on the phone');
function moonAt(iso) { return S.moonCode(RealDate.parse(iso)); }
check('new moon, 8 Apr 2024 (the eclipse)', moonAt('2024-04-08T18:21:00Z'), 8);
check('full moon, 14 Mar 2025 (the eclipse)', moonAt('2025-03-14T06:55:00Z'), 0);
check('first quarter, 6 Mar 2025', moonAt('2025-03-06T16:32:00Z'), 12);
check('last quarter, 22 Mar 2025', moonAt('2025-03-22T11:29:00Z'), 4);
var trom = S.sun(69.65, 18.96, new RealDate(2026, 11, 21, 12));
check('Tromso, midwinter: polar night, no sunrise', trom.polar + ' ' + trom.riseMin, 'night null');
var tromS = S.sun(69.65, 18.96, new RealDate(2026, 5, 21, 12));
check('Tromso, midsummer: polar day', tromS.polar + ' ' + tromS.riseMin, 'day null');
checkTrue('  and the icons know: night at noon in December, day at midnight in June',
	S.elevation(69.65, 18.96, new RealDate(2026, 11, 21, 12).getTime()) < -0.833 &&
	S.elevation(69.65, 18.96, new RealDate(2026, 5, 21, 0, 30).getTime()) > -0.833);
var d0 = om.forecasts[0], rise = minutesOf(d0.sunrise), set = minutesOf(d0.sunset);
var dnWrong = d0.hours.filter(function (h) {
	var m = +h.hour * 60 + 30, dn = h.icon.slice(-2);
	if (dn !== '_d' && dn !== '_n') return false;
	if (m > rise + 30 && m < set - 30) return dn !== '_d';
	if (m < rise - 30 || m > set + 30) return dn !== '_n';
	return false;
});
checkTrue('day and night in the hourly icons follow sunrise and sunset', !dnWrong.length,
	dnWrong.length ? dnWrong.map(function (h) { return h.hour + ':' + h.icon; }).join(' ') : d0.sunrise + '-' + d0.sunset);

/* ================================================================ 4. the screen */

head('4. what reaches the screen and the cat (Open-Meteo, restored at 14:38)');
/* the last full paint (riseset() paints the daylight bar on its own first) */
function screenOf(c) {
	for (var i = c.painted.length - 1; i >= 0; i--) {
		if (c.painted[i].result.hasOwnProperty('temperature')) return c.painted[i].result;
	}
	return {};
}
function restored(t, at, src, raw) {
	var disk = {};
	disk['wx.raw.v2'] = JSON.stringify(cacheFor(src || 'open-meteo', raw || FIX.om, t));
	var c = makeCtx({ disk: disk });
	NOW = at;
	c.Weather.restore(new FakeDate(), NOW);
	return c;
}
cx = restored(FETCHED, FETCHED + 60000);
var p = screenOf(cx);
checkTrue('painted', cx.painted.length > 0);
['temperature', 'icon', 'wind', 'wind_icon', 'humidity', 'pressure', 'min', 'min_date', 'max', 'max_date',
 'forecast_title_0', 'forecast_icon_0', 'forecast_temperature_0', 'forecast_wind_0',
 'forecast_title_1', 'forecast_icon_1', 'forecast_temperature_1', 'rise', 'set', 'moon', 'wx_credit'].forEach(function (k) {
	checkTrue('  ' + k, p[k] !== undefined && p[k] !== '', String(p[k]));
});
var temps0 = omBody.hourly.temperature_2m.slice(0, 24).map(Math.round);
var lo = Math.min.apply(null, temps0), hi = Math.max.apply(null, temps0);
check('today\'s low, and its hour', p.min + ' ' + p.min_date, (lo > 0 ? '+' : '') + lo + ' ' + ('0' + temps0.indexOf(lo)).slice(-2) + ':00');
check('today\'s high, and its hour', p.max + ' ' + p.max_date, (hi > 0 ? '+' : '') + hi + ' ' + ('0' + temps0.indexOf(hi)).slice(-2) + ':00');
check('the credit names the source', p.wx_credit, 'Open-Meteo.com');
var cat = cx.published;
checkTrue('the cat was told the weather', !!cat, cat ? cat.temp + 'C ' + cat.code + (cat.isNight ? ' night' : ' day') : '');
checkTrue('  sky, precip, thunder, night from the icon and the sun',
	cat && ['skc', 'bkn', 'ovc'].indexOf(cat.sky) !== -1 && typeof cat.isThunder === 'boolean' && cat.isNight === false);
checkTrue('  sunrise/sunset are absolute clock minutes',
	cat && cat.sunriseMin === rise && cat.sunsetMin === set, cat ? cat.sunriseMin + ' / ' + cat.sunsetMin : '');
checkTrue('  the moon', cat && cat.moonCode === om.forecasts[0].moon_code);

head('   the two forecast columns follow the clock');
function columns(h, m) {
	NOW = new RealDate(2026, 10, 20, h, m).getTime();
	var r = cx.Weather.parse(om, new FakeDate(), om.fact);
	return r.forecast_title_0 + '/' + r.forecast_title_1 + ' ' + r.forecast_temperature_0 + '/' + r.forecast_temperature_1;
}
function pt(day, part) { var t = om.forecasts[day].parts[part].temp_avg; return (t > 0 ? '+' : '') + t; }
check('03:00 - this morning, today', columns(3, 0), 'утром/днём ' + pt(0, 'morning') + '/' + pt(0, 'day'));
check('08:00 - today, this evening', columns(8, 0), 'днём/вечером ' + pt(0, 'day') + '/' + pt(0, 'evening'));
check('14:00 - this evening, tonight', columns(14, 0), 'вечером/ночью ' + pt(0, 'evening') + '/' + pt(1, 'night'));
check('20:00 - tonight, tomorrow morning', columns(20, 0), 'ночью/утром ' + pt(1, 'night') + '/' + pt(1, 'morning'));
check('23:30 - still tonight and tomorrow morning, not this morning', columns(23, 30),
	'ночью/утром ' + pt(1, 'night') + '/' + pt(1, 'morning'));
NOW = new RealDate(2026, 10, 21, 1, 0).getTime();
var next = cx.Weather.parse(om, new FakeDate(), om.fact);
check('a day later the low/high are the new day\'s, not the file\'s first',
	next.min, (function () { var t = omBody.hourly.temperature_2m.slice(24, 48).map(Math.round); var m = Math.min.apply(null, t); return (m > 0 ? '+' : '') + m; })());

head('   the daylight bar counts to sunrise, not to tomorrow\'s');
cx.painted = [];
NOW = new RealDate(2026, 10, 20, 5, 0).getTime();
cx.Weather.riseset(d0.sunrise, d0.sunset, new FakeDate());
var left = cx.painted.length ? cx.painted[0].result.duration_left : '';
check('05:00, sunrise ' + d0.sunrise, left, 'ночь 0' + Math.floor((rise - 300) / 60) + ':' + ('0' + (rise - 300) % 60).slice(-2));

head('   MET restored: the credit follows the source');
cx = restored(FETCHED, FETCHED + 60000, 'met', FIX.met);
check('credit', screenOf(cx).wx_credit, 'MET Norway');

/* ================================================================ 5. this hour */

head('5. the current hour, and a stale file (synthetic: hour N is N degrees)');
NOW = new RealDate(2026, 10, 20, 13, 20).getTime();
var syn = cx.WxSource.adapt('open-meteo', synthOM(NOW), BERLIN.lat, BERLIN.lon, NOW);
var d = new FakeDate();
var h = cx.Weather.hourFor(syn, d);
check('finds this hour', h && h.temp, 13);
check('five hours ahead', cx.Weather.hourFor(syn, new FakeDate(NOW + 5 * 3600000)).temp, 18);
check('tomorrow 02:00', cx.Weather.hourFor(syn, new FakeDate(2026, 10, 21, 2, 59)).temp, 102);
checkTrue('nothing beyond the forecast', cx.Weather.hourFor(syn, new FakeDate(NOW + 90 * 3600000)) === null);
var fresh = cx.Weather.conditionsNow(syn, d, NOW - 5 * 60000);
check('file 5 min old -> the "current" block', fresh.src + ' ' + fresh.c.temp, 'fact 99');
var stale = cx.Weather.conditionsNow(syn, d, NOW - 5 * 3600000);
check('file 5 h old -> this hour of the forecast', stale.src + ' ' + stale.c.temp, 'hour 13');
check('no hours at all -> the old "current", marked stale',
	cx.Weather.conditionsNow({ fact: syn.fact, forecasts: [{ date: '2026-11-20' }] }, d, NOW - 5 * 3600000).src, 'stale-fact');
cx = restored(NOW - 20 * 3600000, NOW, 'open-meteo', JSON.stringify(synthOM(NOW - 20 * 3600000)));
checkTrue('a 20 h old file still paints, stamped as current (View keeps it)',
	cx.painted.length > 0 && Math.abs(cx.painted[0].stamp - NOW) < 60000, cx.Weather.status().source);
check('  this hour\'s temperature, not the old "current"', screenOf(cx).temperature, '+113');

/* ================================================================ 6. the stored file is the schedule */

head('6. the stored file decides when to call: a launch is free');
NOW = new RealDate(2026, 10, 20, 15, 0).getTime();
cx = restored(NOW - 10 * 60000, NOW, 'open-meteo', JSON.stringify(synthOM(NOW - 10 * 60000)));
checkTrue('file 10 min old -> painted, no call due', cx.painted.length > 0 && cx.Weather.due(NOW) === false);
checkTrue('  and nothing was asked', cx.requests.length === 0);
cx = restored(NOW - 3 * 3600000, NOW, 'open-meteo', JSON.stringify(synthOM(NOW - 3 * 3600000)));
checkTrue('file 3 h old -> a call IS due', cx.Weather.due(NOW) === true);
cx = restored(NOW + 30 * 24 * 3600000, NOW, 'open-meteo', JSON.stringify(synthOM(NOW)));
checkTrue('clock went back, file from the future -> a call IS due', cx.Weather.due(NOW) === true);
cx.Weather.fetch(NOW, new FakeDate());
checkTrue('  and after it, no call storm', cx.Weather.due(NOW + 60000) === false);
var disk = {};
disk['wx.raw.v2'] = JSON.stringify(cacheFor('open-meteo', JSON.stringify(synthOM(NOW)), NOW - 60000,
	{ lat: 53.9, lon: 27.5667, name: 'Minsk, Belarus' }));
cx = makeCtx({ disk: disk });
cx.Weather.restore(new FakeDate(), NOW);
checkTrue('a file for another place is not shown, and a call is due', cx.painted.length === 0 && cx.Weather.due(NOW));
cx = makeCtx({ place: null });
cx.Weather.restore(new FakeDate(), NOW);
var said = null;
cx.Weather.fetch(NOW, new FakeDate(), function (why) { said = why; });
checkTrue('no place: nothing painted, never due, and a fetch asks nothing',
	cx.painted.length === 0 && cx.Weather.due(NOW) === false && cx.Weather.due(NOW + 86400000) === false &&
	cx.requests.length === 0, 'fetch says: ' + said);

/* ================================================================ 8. policy (7 is checked at the end, over every request) */

var ALL = [];                 /* every request every scenario made */
function collect(c) { ALL = ALL.concat(c.requests); }

/* minute ticks, as clock.js makes them: due() then fetch() */
function run(c, fromMs, minutes) {
	for (var i = 0; i < minutes; i++) {
		NOW = fromMs + i * 60000 + 1000;
		if (c.Weather.due(NOW)) c.Weather.fetch(NOW, new FakeDate());
	}
}
var MIDNIGHT = new RealDate(2026, 10, 21, 0, 0).getTime();

head('8. the fetch policy');
cx = makeCtx();
run(cx, MIDNIGHT, 1440);
collect(cx);
check('healthy, a whole day from nothing: one call an hour', cx.requests.length, 24);
checkTrue('  all to Open-Meteo', cx.requests.every(function (r) { return isOM(r.url); }));
check('  the credit', cx.painted[cx.painted.length - 1].result.wx_credit, 'Open-Meteo.com');

cx = makeCtx({ net: failNet });
run(cx, MIDNIGHT, 1440);
collect(cx);
var at = cx.requests.length;
var mins = []; /* when they happened */
cx = makeCtx({ net: function (u) { mins.push(Math.round((NOW - MIDNIGHT) / 60000)); return failNet(u); } });
run(cx, MIDNIGHT, 1440);
check('Open-Meteo down, in a browser: 5, 15, 30 min, then hourly', mins.slice(0, 6).join(' '), '0 5 20 50 110 170');
checkTrue('  a whole failing day stays well inside the ceiling', at <= 30, at + ' requests');
checkTrue('  and never MET (a tab cannot name itself to it)', cx.requests.every(function (r) { return isMET(r.url) === false; }));

cx = makeCtx({ net: failNet, native: true });
run(cx, MIDNIGHT, 1440);
collect(cx);
var byDay = cx.Store.getJSON('wx.calls.v1');
checkTrue('both sources down, in the APK: never more than ' + cx.calls_per_day + ' requests in the day',
	cx.requests.length <= cx.calls_per_day, cx.requests.length + ' requests, ' + cx.requests.filter(function (r) { return isMET(r.url); }).length + ' of them MET');
run(cx, MIDNIGHT + 1440 * 60000, 120);
checkTrue('  the next day the count starts again', cx.Store.getJSON('wx.calls.v1').day === '2026-11-22' &&
	cx.Store.getJSON('wx.calls.v1').n > 0, JSON.stringify(cx.Store.getJSON('wx.calls.v1')));
cx = makeCtx({ native: true, net: function (u) {
	if (isOM(u)) return { status: 503, body: '' };
	return { status: 200, body: FIX.met, headers: { 'Last-Modified': 'Fri, 20 Nov 2026 13:16:01 GMT',
	         'Expires': new RealDate(NOW + 30 * 60000).toUTCString() } };
} });
run(cx, MIDNIGHT, 1440);
collect(cx);
checkTrue('Open-Meteo down, MET answering, in the APK: one of each an hour, inside the ceiling',
	cx.requests.length <= cx.calls_per_day && cx.Weather.status().fails === 0 &&
	cx.Weather.status().from === 'MET Norway', cx.requests.length + ' requests, ' +
	cx.requests.filter(function (r) { return isMET(r.url); }).length + ' to MET');
var capped = makeCtx({ net: failNet, native: true });
capped.Store.setJSON('wx.calls.v1', { day: '2026-11-21', n: capped.calls_per_day });
NOW = MIDNIGHT + 12 * 3600000;
capped.Weather.fetch(NOW, new FakeDate());
checkTrue('  at the ceiling nothing is asked at all', capped.requests.length === 0, capped.Weather.status().error);

cx = makeCtx({ online: false });
run(cx, MIDNIGHT, 1440);
check('offline all day: no request', cx.requests.length, 0);
check('  and no backoff built up', cx.Weather.status().fails, 0);
cx.navigator.onLine = true;
run(cx, MIDNIGHT + 1440 * 60000, 2);
check('  back online: asked on the next tick', cx.requests.length, 1);
collect(cx);

head('   the backoff survives a restart');
disk = {};
cx = makeCtx({ disk: disk, net: failNet });
NOW = MIDNIGHT + 8 * 3600000;
cx.Weather.fetch(NOW, new FakeDate());
var t0 = NOW;
var again = makeCtx({ disk: disk, net: failNet });
NOW = t0 + 2 * 60000;
again.Weather.restore(new FakeDate(), NOW);
checkTrue('restarted 2 min after a failure -> not due yet', again.Weather.due(NOW) === false);
checkTrue('  due at 5 min', again.Weather.due(t0 + 5 * 60000 + 1) === true);

head('   MET Norway: the fallback, its Expires and If-Modified-Since');
var EXP = RealDate.parse(FIX.metHeaders.Expires), LM = FIX.metHeaders['Last-Modified'];
var metNet = function (u, hdr) {
	if (isOM(u)) return { status: 503, body: '' };
	if (isMET(u)) {
		if (hdr['If-Modified-Since'] === LM) return { status: 304, body: '', headers: { 'Last-Modified': LM, 'Expires': new RealDate(NOW + 1800000).toUTCString() } };
		return { status: 200, body: FIX.met, headers: { 'Last-Modified': LM, 'Expires': FIX.metHeaders.Expires } };
	}
	return { status: 404 };
};
disk = {};
cx = makeCtx({ disk: disk, native: true, net: metNet });
NOW = FETCHED;
cx.Weather.fetch(NOW, new FakeDate());
var c1 = cx.Store.getJSON('wx.raw.v2');
check('Open-Meteo 503 -> MET asked, at 4 decimals', cx.requests.map(function (r) { return isOM(r.url) ? 'OM' : r.url.split('?')[1]; }).join(' | '),
	'OM | lat=52.5200&lon=13.4100');
check('  kept as MET, with its Expires and Last-Modified', c1.src + ' ' + (c1.expires === EXP) + ' ' + (c1.lm === LM), 'met true true');
check('  the credit says MET Norway', cx.painted[cx.painted.length - 1].result.wx_credit, 'MET Norway');
checkTrue('  the first MET request had no If-Modified-Since', !cx.requests[1].headers['If-Modified-Since']);
cx.requests = [];
NOW = FETCHED + 5 * 60000;                         /* before MET's Expires (13:47:35) */
cx.Weather.fetch(NOW, new FakeDate());
check('Open-Meteo still down, MET\'s Expires not reached -> MET not asked', cx.requests.map(function (r) { return isOM(r.url) ? 'OM' : 'MET'; }).join(' '), 'OM');
cx.requests = [];
NOW = EXP + 60000;
cx.Weather.fetch(NOW, new FakeDate());
check('after Expires: MET asked with If-Modified-Since', cx.requests.length === 2 && cx.requests[1].headers['If-Modified-Since'] === LM, true);
var c2 = cx.Store.getJSON('wx.raw.v2');
check('  304 -> the same forecast, stamped now, new Expires', [c2.t === NOW, c2.raw === c1.raw, c2.expires > NOW].join(' '), 'true true true');
check('  and no failure counted', cx.Weather.status().fails, 0);
collect(cx);

head('   a change of place');
disk = {};
disk['wx.raw.v2'] = JSON.stringify(cacheFor('open-meteo', JSON.stringify(synthOM(NOW)), NOW - 60000));
cx = makeCtx({ disk: disk, net: function (u) { return 'defer'; } });
cx.Weather.restore(new FakeDate(), NOW);
cx.Weather.fetch(NOW + 3600 * 1000, new FakeDate());       /* a call for Berlin, still out */
cx.place_lat = 53.9; cx.place_lon = 27.5667; cx.place_name = 'Minsk, Belarus';
var reported = 'not yet';
cx.Weather.placeChanged(function (why) { reported = why; });
checkTrue('the old place\'s weather leaves the screen at once, and its file is dropped',
	cx.forgot === 1 && cx.Store.getJSON('wx.raw.v2') === null);
check('  only the call already out for the old place so far', cx.requests.length, 1);
cx.net = okNet;
cx.deferred.shift()({ status: 200, body: JSON.stringify(synthOM(NOW)) });
checkTrue('  its answer is dropped, and the new place is asked for at once',
	cx.requests.length === 2 && /latitude=53\.90&longitude=27\.57/.test(cx.requests[1].url), cx.requests[1] && cx.requests[1].url.split('&')[0] + '&' + cx.requests[1].url.split('&')[1]);
check('  and the file is the new place\'s', cx.Store.getJSON('wx.raw.v2').key + ' ' + reported, '53.9000,27.5667 null');
collect(cx);

/* ================================================================ 7. nothing but the free sources */

head('7. no request can reach anything but Open-Meteo and MET Norway');
var hosts = {};
ALL.forEach(function (r) { hosts[r.url.split('/')[2]] = (hosts[r.url.split('/')[2]] || 0) + 1; });
checkTrue('every request this run made went to one of the two', Object.keys(hosts).every(function (h) {
	return h === 'api.open-meteo.com' || h === 'api.met.no';
}), JSON.stringify(hosts));
checkTrue('  over HTTPS, with no header but If-Modified-Since', ALL.every(function (r) {
	return r.url.indexOf('https://') === 0 && Object.keys(r.headers).every(function (k) { return k === 'If-Modified-Since'; });
}), ALL.length + ' requests');

function walk(dir, out) {
	fs.readdirSync(path.join(ROOT, dir)).forEach(function (n) {
		var p = dir + '/' + n, st = fs.statSync(path.join(ROOT, p));
		if (st.isDirectory()) walk(p, out);
		else out.push(p);
	});
	return out;
}
/* the page and the app; tools/build.js names the word only to refuse it */
var sources = walk('src', []).concat(walk('android/java', []),
	['android/AndroidManifest.xml', 'android/res/values/strings.xml']);
var mentions = sources.filter(function (p) { return /yandex/i.test(read(p)); });
checkTrue('no source file mentions yandex (' + sources.length + ' files)', !mentions.length, mentions.join(' '));
checkTrue('there is no key setting left', !/^var api\b/m.test(BASE) && !/api_url/.test(BASE));
var urls = (read('src/core/wxsource.js') + read('src/core/places.js') + read('src/core/weather.js')).match(/https?:\/\/[^'"\s)]+/g) || [];
checkTrue('the only URLs in the forecast code are the free services', urls.every(function (u) {
	return /^https:\/\/(api\.open-meteo\.com|api\.met\.no|geocoding-api\.open-meteo\.com|open-meteo\.com)\b/.test(u);
}), urls.map(function (u) { return u.split('/')[2]; }).filter(function (h, i, a) { return a.indexOf(h) === i; }).join(' '));

console.log('\n' + '='.repeat(70));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(70) + '\n');
process.exit(fail ? 1 : 0);
