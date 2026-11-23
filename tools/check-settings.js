/* check-settings.js - can the shelf owner choose a city without a rebuild?
 *
 *   node tools/check-settings.js
 *
 * Loads the REAL src/core/settings.js, places.js, wxsource.js and weather.js and
 * fakes only the browser, so what it proves is what the app will do. The gear
 * writes the place and the sleep hours, which everything else reads as globals,
 * and the ways that can go wrong are all quiet ones: a build that ships a place
 * (or a key), a stored place that is not one, a city search that sends more
 * than the name, and an app with no place that asks the network anyway.
 *
 * The network is a spy here: it records each request and answers from
 * tools/fixtures/ - nothing leaves the machine.
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var base = read('src/informer.base.html');
var config = base.split('\n').filter(function (l) {
	return /^var [a-z_]+ *=/.test(l);
}).join('\n');
var GEO = read('tools/fixtures/open-meteo-geocoding-berlin.json');

/* ---- a sandbox with just enough browser, and a Store we can reload ---- */

function makeCtx(disk, bridge, language) {
	var sandbox = {
		console: { log: function () {}, warn: function () {} }, Math: Math, Date: Date, JSON: JSON,
		String: String, Number: Number, RegExp: RegExp, Object: Object, Array: Array,
		isFinite: isFinite, encodeURIComponent: encodeURIComponent,
		navigator: { onLine: true, language: language || 'en-GB' },
		Store: {
			persistent: function () { return true; },
			getJSON: function (k) { return disk[k] ? JSON.parse(disk[k]) : null; },
			setJSON: function (k, v) { disk[k] = JSON.stringify(v); },
			get: function (k) { return disk[k] || null; },
			set: function (k, v) { disk[k] = v; }
		},
		View: { update: function () {}, data: function () { return null; }, forget: function () {} },
		Bus: { emit: function () {} },
		requests: []
	};
	sandbox.window = sandbox;
	if (bridge) sandbox.PhoneForecast = bridge;
	sandbox.document = {
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		getElementById: function () { return null; }
	};
	var ctx = vm.createContext(sandbox);
	vm.runInContext(config, ctx, { filename: 'config' });
	['src/core/dom.js', 'src/core/settings.js', 'src/core/host.js', 'src/core/i18n.js', 'src/core/places.js',
	 'src/core/wxsource.js', 'src/core/weather.js'].forEach(function (m) {
		vm.runInContext(read(m), ctx, { filename: m });
	});
	/* dom.js declares the real getJSON/httpGet, which would open an XHR that
	 * does not exist in here. Replace them with the spy AFTER all are loaded. */
	sandbox.__answer = function (url) {
		sandbox.requests.push(url);
		if (url.indexOf('https://geocoding-api.open-meteo.com/') === 0) return { status: 200, body: GEO };
		return { error: 'spy' };
	};
	vm.runInContext(
		'getJSON = function (u, h, t, ok, bad) { var r = __answer(u, h);' +
		'  if (r.error) bad(r.error); else ok(JSON.parse(r.body), r.body); };' +
		'httpGet = function (u, h, t, cb) { var r = __answer(u, h); cb(r.error || null, r.status || 0, r.body || "", function () { return ""; }); };',
		ctx);
	return sandbox;
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

console.log('\n' + '='.repeat(66));
console.log('SETTINGS - what the gear can change');
console.log('='.repeat(66));

var disk = {};
var ctx = makeCtx(disk);
var S = ctx.Settings, W = ctx.Weather;

console.log('\nthe build ships no place, and no key');
S.load();
var d = S.get();
check('no place', d.place_lat + ' ' + d.place_lon + ' "' + d.place_name + '"', 'null null ""');
check('sleep window', d.quiet_from + ' - ' + d.quiet_to, '23:00 - 10:00');
checkTrue('no key, no URL among the settings', !('api' in d) && !('api_url' in d) &&
	typeof ctx.api === 'undefined' && typeof ctx.api_url === 'undefined');
checkTrue('no coordinates in the config block', !/^var (lat|lon) *=/m.test(base) &&
	/^var place_lat = null;/m.test(base) && /^var place_lon = null;/m.test(base));
var build = read('tools/build.js');
checkTrue('the build never opens .local/ (no key or coordinates can reach a public build)',
	!/\.local/.test(build.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
checkTrue('the build refuses yandex and 36-character keys in its output',
	/yandex\/i/.test(build) && /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}/.test(build));

console.log('\nno place: the app asks the network for nothing');
var said = null;
W.fetch(Date.now(), new Date(), function (why) { said = why; });
check('a fetch is refused', said, 'no place');
checkTrue('never due, now or tomorrow', W.due(Date.now()) === false && W.due(Date.now() + 86400000) === false);
check('no request was made', ctx.requests.length, 0);

console.log('\nchoosing a place edits the globals every other module reads');
checkTrue('reported as a change', S.setPlace('Berlin, Germany', 52.52437, 13.41053) === true);
check('place_name', ctx.place_name, 'Berlin, Germany');
check('kept to 4 decimals', ctx.place_lat + ', ' + ctx.place_lon, '52.5244, 13.4105');
checkTrue('the same place again is no change (and asks for nothing)', S.setPlace('Berlin, Germany', 52.52437, 13.41053) === false);
checkTrue('a new name for it is', S.setPlace('Berlin', 52.52437, 13.41053) === true);
checkTrue('a place without a name is called by its coordinates',
	S.setPlace('', 53.9023, 27.5619) === true && ctx.place_name === '53.90, 27.56', ctx.place_name);

console.log('\nit survives a restart');
S.setPlace('Berlin, Germany', 52.52437, 13.41053);
var ctx2 = makeCtx(disk);
ctx2.Settings.load();
check('place still the saved one', ctx2.place_name + ' ' + ctx2.place_lat + ' ' + ctx2.place_lon, 'Berlin, Germany 52.5244 13.4105');

console.log('\nwhat is not a place is refused, and nothing is kept');
['lat 91', 'lon 181', 'NaN', 'text'].forEach(function (what, i) {
	var a = [[91, 10], [10, 181], [NaN, 10], ['north', 'east']][i];
	checkTrue(what, S.setPlace('Nowhere', a[0], a[1]) === false && ctx.place_name === 'Berlin, Germany');
});
disk['cfg.v1'] = JSON.stringify({ place: { name: 'Bad', lat: 'x', lon: 200 } });
var ctx3 = makeCtx(disk);
ctx3.Settings.load();
check('a stored place that is not one loads as no place', ctx3.place_lat, 'null');
S.setPlace('Berlin, Germany', 52.52437, 13.41053);

console.log('\nwith a place, the forecast is asked for - the coordinates and nothing else');
ctx.requests = [];
W.placeChanged();
check('Open-Meteo, 2 decimals', ctx.requests[0].split('&').slice(0, 2).join('&'),
	'https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41');
checkTrue('  the place name is not sent', ctx.requests.every(function (u) { return u.indexOf('Berlin') === -1; }));
checkTrue('  no MET in a browser tab (no bridge)', ctx.requests.length === 1);
var native = makeCtx({}, { host: function () { return 'android'; }, sdk: function () { return 26; } });
native.Settings.setPlace('Berlin, Germany', 52.52437, 13.41053);
native.Weather.placeChanged();
check('in the APK, MET is the fallback, at 4 decimals', native.requests[1],
	'https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=52.5244&lon=13.4105');

console.log('\nthe sleep hours');
var ch = S.save({ quiet_from: '22:30', quiet_to: '07:15' });
check('both reported as changed', ch.sort().join(','), 'quiet_from,quiet_to');
check('cat_quiet_from', ctx.cat_quiet_from, '22:30');
check('cat_quiet_to', ctx.cat_quiet_to, '07:15');
ch = S.save({ quiet_from: '22:30', quiet_to: '07:15' });
check('re-saving the same values changes nothing', ch.length, 0);
check('saving them leaves the place alone', ctx.place_name, 'Berlin, Germany');
S.save({ quiet_from: '', quiet_to: '' });
check('a field cleared to blank falls back to the build default', ctx.cat_quiet_from + '-' + ctx.cat_quiet_to, '23:00-10:00');
S.save({ quiet_from: '21:00' });
var r = S.reset();
check('reset puts the sleep hours back', r.quiet_from + '-' + r.quiet_to, '23:00-10:00');
check('  and keeps the place', ctx.place_name + ' ' + ctx.place_lat, 'Berlin, Germany 52.5244');

console.log('\nvalidation - what the dialog refuses');
checkTrue('23:00 accepted', S.okTime('23:00') === true);
checkTrue('00:00 accepted', S.okTime('00:00') === true);
checkTrue('24:00 refused', S.okTime('24:00') === false);
checkTrue('7:5 refused', S.okTime('7:5') === false);
checkTrue('blank refused', S.okTime('') === false);

console.log('\ncity search: the typed name, and nothing else');
var P = ctx.Places;
ctx.requests = [];
var got = null;
P.search('  Berlin ', function (why, list) { got = { why: why, list: list }; });
check('Open-Meteo geocoding, 8 results, in the language of the screen (English here)', ctx.requests[0],
	'https://geocoding-api.open-meteo.com/v1/search?name=Berlin&count=8&language=en&format=json');
check('a Russian screen asks in Russian, Latin letters or not', makeCtx({}, null, 'ru-RU').Places.searchUrl('Minsk'),
	'https://geocoding-api.open-meteo.com/v1/search?name=Minsk&count=8&language=ru&format=json');
check('Russian for Cyrillic, whatever the screen', P.searchUrl('Минск'),
	'https://geocoding-api.open-meteo.com/v1/search?name=%D0%9C%D0%B8%D0%BD%D1%81%D0%BA&count=8&language=ru&format=json');
checkTrue('no coordinates, no place, no identifier in it', !/lat|lon|Germany|52\.5/.test(ctx.requests[0]));
check('the results: name, region, country, coordinates', got.list.length + ' ' + JSON.stringify(got.list[0]),
	'8 {"name":"Berlin","region":"State of Berlin","country":"Germany","lat":52.52437,"lon":13.41053}');
check('  shown as name, then region and country', got.list[1].name + ' / ' + P.where(got.list[1]), 'Berlin / New Hampshire, United States');
check('  and named for the place line', P.join(got.list[0].name, got.list[0].country), 'Berlin, Germany');
var empty = null;
P.search('   ', function (why) { empty = why; });
check('a blank search sends nothing', empty + ' ' + ctx.requests.length, 'empty 1');

console.log('\nuse my location: only with the bridge');
checkTrue('a browser tab has no "use my location"', P.canLocate() === false);
var asked = 0;
var withBridge = makeCtx({}, { host: function () { return 'android'; }, locate: function () { asked++; return true; } });
checkTrue('the APK has it', withBridge.Places.canLocate() === true);
var answer = null;
withBridge.Places.locate(function (why, p) { answer = { why: why, p: p }; });
check('a tap asks the app once', asked, 1);
withBridge.Places.locate(function () {});
check('  a second tap while it is out does not ask again', asked, 1);
withBridge.Places.located({ ok: true, lat: 53.9023, lon: 27.5619, name: 'Minsk, Belarus' });
check('the answer comes back to the dialog', answer.why + ' ' + answer.p.name + ' ' + answer.p.lat, 'null Minsk, Belarus 53.9023');
withBridge.Places.locate(function (why) { answer = why; });
withBridge.Places.located({ ok: false, error: 'denied' });
check('a refusal comes back as one', answer, 'denied');

console.log('\n' + '='.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(66) + '\n');
process.exit(fail ? 1 : 0);
