/* check-weather.js - does the hourly forecast logic actually work?
 *
 *   node tools/check-weather.js                 against a synthetic 48 h response
 *   node tools/check-weather.js real.json       against a real captured response
 *
 * This loads the REAL src/core/weather.js and only fakes the browser, so what it
 * proves is what the app will do. It exists because the API allowance is thirty
 * requests a day: the logic that decides what the screen shows cannot be
 * developed by calling the API and looking, so it is developed against a
 * response shaped like the real one and confirmed against a real one later.
 *
 * The field names in the synthetic response are the ones the app already reads
 * (`fact`, `forecasts[].hours[].temp`, `.hour`, `.date`) plus the ones an hourly
 * record is expected to carry. If a real response disagrees, this is where it
 * will show - run it with the JSON from tools/yandex-check.html.
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

/* ---- the config the app runs with, taken from the app ---- */
var base = read('src/informer.base.html');
/* Every top-level config line, not a hand-picked subset. Picking a subset is how
 * this harness failed on its first run: parse() reads a `period` label table
 * that was not on the list, and it died on a global the app has always had. */
var config = base.split('\n').filter(function (l) {
	return /^var [a-z_]+ *=/.test(l);
}).join('\n');

/* ---- a sandbox with just enough browser ---- */
var painted = null, published = null, stored = {};

var sandbox = {
	console: console, Math: Math, Date: Date, JSON: JSON, Number: Number, String: String,
	View: {
		update: function (result, stamp) { painted = { result: result, stamp: stamp }; },
		data: function () { return null; }
	},
	Bus: { emit: function (topic, payload) { if (topic === 'weather') published = payload; } },
	Store: {
		getJSON: function (k) { return stored[k] ? JSON.parse(stored[k]) : null; },
		setJSON: function (k, v) { stored[k] = JSON.stringify(v); },
		get: function (k) { return stored[k] || null; },
		set: function (k, v) { stored[k] = v; }
	},
	getJSON: function () { /* no network in here, ever */ }
};
sandbox.window = sandbox;
sandbox.document = { querySelector: function () { return null; },
                     querySelectorAll: function () { return []; },
                     getElementById: function () { return null; } };

var ctx = vm.createContext(sandbox);
vm.runInContext(config, ctx, { filename: 'config' });
/* the real dom.js for pad() and hhmm(), not stubs of them - it has no top-level
 * side effects, and a stub is a way to be told what you expected */
vm.runInContext(read('src/core/dom.js'), ctx, { filename: 'dom.js' });
vm.runInContext(read('src/core/weather.js'), ctx, { filename: 'weather.js' });
var Weather = sandbox.Weather;

/* ---------------------------------------------------------------- fixtures */

function ymd(d) {
	return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
		'-' + ('0' + d.getDate()).slice(-2);
}

/* A response shaped like Yandex's, with 48 distinct hours so that picking the
 * wrong one is visible rather than plausible. Hour N of day 0 is N degrees. */
function synthetic() {
	var today = new Date();
	var tomorrow = new Date(today.getTime() + 86400000);

	function day(d, offset, withHours) {
		var f = {
			date: ymd(d),
			sunrise: '06:20', sunset: '20:10', moon_code: 4,
			parts: { night: { temp_avg: 8 }, morning: { temp_avg: 12 },
			         day: { temp_avg: 18 }, evening: { temp_avg: 14 } }
		};
		if (withHours) {
			f.hours = [];
			for (var h = 0; h < 24; h++) {
				f.hours.push({
					hour: String(h),
					hour_ts: Math.floor(new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, 0, 0, 0).getTime() / 1000),
					temp: offset + h,
					condition: h % 6 === 0 ? 'overcast-and-rain' : 'partly-cloudy',
					icon: h % 6 === 0 ? 'ovc_ra' : 'bkn_d',
					wind_speed: 3 + (h % 5),
					wind_angle: 180,
					humidity: 60,
					pressure_mm: 748,
					prec_mm: h % 6 === 0 ? 0.6 : 0,
					prec_prob: h % 6 === 0 ? 80 : 5
				});
			}
		}
		return f;
	}

	return {
		now: Math.floor(Date.now() / 1000),
		fact: {
			temp: 14, icon: 'ovc', condition: 'overcast',
			wind_speed: 2, wind_angle: 200, humidity: 75, pressure_mm: 745
		},
		forecasts: [day(today, 0, true), day(tomorrow, 100, true)]
	};
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

var arg = process.argv[2];
var data = arg ? JSON.parse(fs.readFileSync(arg, 'utf8')) : synthetic();
var real = !!arg;

console.log('\n' + '='.repeat(66));
console.log(real ? 'REAL response: ' + arg : 'SYNTHETIC 48 h response');
console.log('='.repeat(66) + '\n');

/* ---- what is in it ---- */
var list = Weather.hourly(data);
console.log('shape');
check('days returned', (data.forecasts || []).length, real ? (data.forecasts || []).length : 2);
checkTrue('hourly entries flattened', list.length > 0, list.length + ' entries');
if (!real) check('48 hourly entries', list.length, 48);

var ahead = 0, now = Date.now();
for (var i = 0; i < list.length; i++) if (list[i].ts >= now) ahead++;
console.log('        ' + ahead + ' of them are still in the future');
if (list.length) {
	console.log('        first ' + new Date(list[0].ts).toString().slice(0, 24));
	console.log('        last  ' + new Date(list[list.length - 1].ts).toString().slice(0, 24));
}

/* ---- does it find the right hour ---- */
console.log('\nhour lookup');
var d = new Date();
var h = Weather.hourFor(data, d);
checkTrue('finds an entry for the current hour', !!h, h ? 'temp ' + h.temp : 'none');
if (!real && h) check('and it is THIS hour, not another', h.temp, d.getHours());

if (!real) {
	var later = new Date(d.getTime() + 5 * 3600000);
	var h5 = Weather.hourFor(data, later);
	checkTrue('finds an entry five hours ahead', !!h5, h5 ? 'temp ' + h5.temp : 'none');
	if (h5) {
		var want = later.getHours() + (later.getDate() !== d.getDate() ? 100 : 0);
		check('and it is the right one', h5.temp, want);
	}

	var tooFar = new Date(d.getTime() + 90 * 3600000);
	checkTrue('returns nothing beyond the forecast', Weather.hourFor(data, tooFar) === null);
}

/* ---- fresh vs stale ---- */
console.log('\nwhich conditions get used');
var fresh = Weather.conditionsNow(data, d, Date.now() - 5 * 60000);
check('file 5 min old -> the observation', fresh.src, 'fact');
check('  and it is the observed temp', fresh.c.temp, data.fact.temp);

var stale = Weather.conditionsNow(data, d, Date.now() - 5 * 3600000);
check('file 5 h old -> this hour of the forecast', stale.src, 'hour');
if (!real) {
	check('  and it is this hour, not the old observation', stale.c.temp, d.getHours());
	checkTrue('  fields the hourly record lacks fall back to the observation',
		stale.c.pressure_mm !== undefined, 'pressure ' + stale.c.pressure_mm);
}

var noHours = { fact: data.fact, forecasts: [{ date: ymd(d) }] };
check('no hourly data at all -> the observation, marked stale',
	Weather.conditionsNow(noHours, d, Date.now() - 5 * 3600000).src, 'stale-fact');

/* ---- a restart must not spend a request ---- */
console.log('\nthe stored file decides when to call');
sandbox.Store.setJSON('wx.raw.v1', { t: Date.now() - 10 * 60000, raw: JSON.stringify(data) });
Weather.restore(new Date(), Date.now());
checkTrue('file 10 min old -> no call is due', Weather.due(Date.now()) === false);

sandbox.Store.setJSON('wx.raw.v1', { t: Date.now() - 3 * 3600000, raw: JSON.stringify(data) });
Weather.restore(new Date(), Date.now());
checkTrue('file 3 h old -> a call IS due', Weather.due(Date.now()) === true);

/* ---- a long outage must not blank the screen ----
 *
 * View hides any field older than `expire` (12 h) so a dead API fades out rather
 * than lying. But hourly data for the present hour is current however old the
 * file is, so it has to be stamped as such or the screen goes blank exactly when
 * the hourly forecast is most useful. */
console.log('\nsurviving a long outage');
painted = null;
var old20 = Date.now() - 20 * 3600000;
sandbox.Store.setJSON('wx.raw.v1', { t: old20, raw: JSON.stringify(data) });
Weather.restore(new Date(), Date.now());
checkTrue('file 20 h old still paints', !!painted);
if (painted) {
	var age = Math.round((Date.now() - painted.stamp) / 60000);
	checkTrue('  and is stamped as current, not 20 h old', age < 5, age + ' min old');
	checkTrue('  so View keeps the fields visible',
		painted.stamp > Date.now() - sandbox.expire * 1000,
		'expire is ' + Math.round(sandbox.expire / 3600) + ' h');
}
check('  source is the hourly forecast', Weather.status().source, 'hour');

/* ---- and the screen gets painted from it ---- */
console.log('\nwhat reaches the screen');
checkTrue('the view was painted', !!painted, painted ? 'temperature ' + painted.result.temperature : '');
checkTrue('the cat was told the weather', !!published,
	published ? published.temp + 'C  ' + published.code + (published.isNight ? '  night' : '  day') : '');
if (published) {
	checkTrue('  sunrise/sunset are absolute minutes',
		typeof published.sunriseMin === 'number' && typeof published.sunsetMin === 'number',
		published.sunriseMin + ' / ' + published.sunsetMin);
}

console.log('\n' + '='.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(66) + '\n');

if (real) {
	console.log('Field names seen in the first hourly record:');
	var f0 = (data.forecasts || [])[0] || {};
	var h0 = (f0.hours || [])[0];
	console.log(h0 ? '  ' + Object.keys(h0).join(', ') : '  (no hourly records in this response)');
	console.log('');
}

process.exit(fail ? 1 : 0);
