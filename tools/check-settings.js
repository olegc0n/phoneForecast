/* check-settings.js - can the shelf owner change things without a rebuild?
 *
 *   node tools/check-settings.js
 *
 * This loads the REAL src/core/settings.js and src/core/weather.js and only
 * fakes the browser, so what it proves is what the app will do. The settings
 * dialog writes four values that everything else reads as globals, and the two
 * ways that can go wrong are both silent: a stored blank that becomes an empty
 * API key, and a saved-but-identical value that spends one of thirty daily
 * requests re-checking a key nobody changed.
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

/* ---- a sandbox with just enough browser, and a Store we can reload ---- */

function makeCtx(disk) {
	var sandbox = {
		/* the retry ladder warns on every failed spy call; that is expected
		   here and reads like an error in a passing run */
		console: { log: console.log, warn: function () {} }, Math: Math, Date: Date, JSON: JSON,
		String: String, Number: Number, RegExp: RegExp,
		Store: {
			persistent: function () { return true; },
			getJSON: function (k) { return disk[k] ? JSON.parse(disk[k]) : null; },
			setJSON: function (k, v) { disk[k] = JSON.stringify(v); },
			get: function (k) { return disk[k] || null; },
			set: function (k, v) { disk[k] = v; }
		},
		/* the retry ladder arms a timer on failure; stub it so a failed spy
		   call does not schedule a real retry or hold the process open */
		setTimeout: function () { return 0; },
		clearTimeout: function () {},
		View: { update: function () {}, data: function () { return null; } },
		Bus: { emit: function () {} },
		/* a spy, so the URL the app would really have called is inspectable */
		lastUrl: null, lastHeaders: null,
		getJSON: function (url, headers) { sandbox.lastUrl = url; sandbox.lastHeaders = headers; }
	};
	sandbox.window = sandbox;
	sandbox.document = {
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		getElementById: function () { return null; }
	};
	var ctx = vm.createContext(sandbox);
	vm.runInContext(config, ctx, { filename: 'config' });
	vm.runInContext(read('src/core/dom.js'), ctx, { filename: 'dom.js' });
	vm.runInContext(read('src/core/settings.js'), ctx, { filename: 'settings.js' });
	vm.runInContext(read('src/core/weather.js'), ctx, { filename: 'weather.js' });
	/* dom.js declares the real getJSON, which would open an XHR that does not
	 * exist in here. Replace it with the spy AFTER both are loaded. */
	vm.runInContext('getJSON = function (u, h, t, ok, bad) {' +
		' lastUrl = u; lastHeaders = h;' +
		/* finish the call, or inflight stays true and every later
		   fetch() in this file is correctly refused as a duplicate */
		' if (bad) bad("spy"); };', ctx);
	return ctx;
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

console.log('\nthe build is the default');
var d = S.defaults();
check('key', d.api, ctx.api);
check('endpoint', d.api_url, 'https://api.weather.yandex.ru/v2/forecast');
check('sleep window', d.quiet_from + ' - ' + d.quiet_to, '23:00 - 10:00');

console.log('\nsaving edits the globals every other module reads');
var ch = S.save({ api: 'KEY-2', api_url: 'https://example.test/v3/f',
                  quiet_from: '22:30', quiet_to: '07:15' });
check('all four reported as changed', ch.sort().join(','), 'api,api_url,quiet_from,quiet_to');
check('api', ctx.api, 'KEY-2');
check('api_url', ctx.api_url, 'https://example.test/v3/f');
check('cat_quiet_from', ctx.cat_quiet_from, '22:30');
check('cat_quiet_to', ctx.cat_quiet_to, '07:15');

/* Re-saving must report nothing: the dialog only spends an API request when a
 * field really moved, and the allowance is thirty a day. */
console.log('\nre-saving the same values changes nothing');
ch = S.save({ api: 'KEY-2', api_url: 'https://example.test/v3/f',
              quiet_from: '22:30', quiet_to: '07:15' });
check('nothing reported as changed', ch.length, 0);

console.log('\nit survives a restart');
var ctx2 = makeCtx(disk);
ctx2.Settings.load();
check('key still the saved one', ctx2.api, 'KEY-2');
check('sleep window still the saved one', ctx2.cat_quiet_from, '22:30');

/* A cleared field is somebody emptying a box, not a value. An empty key would
 * fail every call for ever and the screen would never say why. */
console.log('\na field cleared to blank falls back to the build default');
S.save({ api: '', api_url: '', quiet_from: '', quiet_to: '' });
check('key', ctx.api, d.api);
check('endpoint', ctx.api_url, d.api_url);
check('sleep from', ctx.cat_quiet_from, d.quiet_from);

console.log('\nreset');
S.save({ api: 'KEY-9' });
S.reset();
check('back to the built-in key', ctx.api, d.api);

console.log('\nvalidation - what the dialog refuses');
checkTrue('23:00 accepted', S.okTime('23:00') === true);
checkTrue('00:00 accepted', S.okTime('00:00') === true);
checkTrue('24:00 refused', S.okTime('24:00') === false);
checkTrue('7:5 refused', S.okTime('7:5') === false);
checkTrue('blank refused', S.okTime('') === false);
checkTrue('https URL accepted', S.okUrl('https://a.b/c') === true);
checkTrue('http URL accepted', S.okUrl('http://a.b/c') === true);
checkTrue('ftp refused', S.okUrl('ftp://a.b') === false);
checkTrue('blank URL refused', S.okUrl('') === false);

/* The endpoint is a field now, so somebody will paste one that already carries a
 * query. Joining on '?' twice makes a URL the API answers 400 to. */
console.log('\nthe URL the app actually calls');
S.reset();
/* fetch() refuses to call on the placeholder key, so give it a real-looking one
 * first - otherwise this whole section silently tests nothing. */
S.save({ api: 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE' });
W.fetch(Date.now(), new Date(), false);
check('plain base gets ?lat&lon',
	ctx.lastUrl, 'https://api.weather.yandex.ru/v2/forecast?lat=' + ctx.lat + '&lon=' + ctx.lon);
check('key rides in the header', ctx.lastHeaders['X-Yandex-Weather-Key'], ctx.api);

S.save({ api_url: 'https://example.test/f?lang=ru' });
W.fetch(Date.now(), new Date(), false);
checkTrue('a base that already has a query joins with &',
	ctx.lastUrl === 'https://example.test/f?lang=ru&lat=' + ctx.lat + '&lon=' + ctx.lon,
	ctx.lastUrl);

S.save({ api_url: 'https://example.test/f?' });
W.fetch(Date.now(), new Date(), false);
checkTrue('a trailing ? is not doubled',
	ctx.lastUrl === 'https://example.test/f?lat=' + ctx.lat + '&lon=' + ctx.lon,
	ctx.lastUrl);

console.log('\n' + '='.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(66) + '\n');
process.exit(fail ? 1 : 0);
