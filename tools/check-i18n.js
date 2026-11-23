/* check-i18n.js - does the app speak English and Russian, and only one at a time?
 *
 *   node tools/check-i18n.js
 *
 * Loads the REAL src/core modules (dom, store, settings, host, i18n, places,
 * bus, view, wxsource, weather, settings-ui) into a sandbox with a small fake
 * DOM that records every piece of markup the page writes, and checks:
 *   1. the language is picked from the phone: the #lang= override, the config,
 *      the APK bridge (PhoneForecast.lang()), then navigator - Russian for ru,
 *      be, uk and kk, English for everything else;
 *   2. the two tables carry the same keys, placeholders and list lengths, and
 *      English has no Cyrillic in it;
 *   3. every key the page uses is in both, and no page file but i18n.js has a
 *      Cyrillic letter in it;
 *   4. dates, the wind's compass points, conditions and units, in both;
 *   5. the forecast screen and the gear's dialog, rendered in each language
 *      from the captured Open-Meteo response: no missing key, no unfilled
 *      placeholder, and not one Cyrillic letter anywhere in English.
 * Nothing here touches the network.                                         */

process.env.TZ = 'Europe/Berlin';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
var BASE = read('src/informer.base.html');
var CONFIG = BASE.split('\n').filter(function (l) { return /^var [a-z_]+ *=/.test(l); }).join('\n');
var OM = read('tools/fixtures/open-meteo-forecast-berlin.json');
var GEO = read('tools/fixtures/open-meteo-geocoding-berlin.json');
var FETCHED = Date.UTC(2026, 10, 20, 13, 38, 0);
var CYR = /[Ѐ-ӿ]/;

var RealDate = Date;
var NOW = FETCHED;
class FakeDate extends RealDate {
	constructor() {
		if (arguments.length === 0) super(NOW);
		else super(...arguments);
	}
	static now() { return NOW; }
}

/* ---------------------------------------------------------------- a fake DOM that remembers what it was told */

function makeDom() {
	var ids = {}, written = [], statics = [];
	function El(tag, id) {
		var e = {
			tagName: String(tag).toUpperCase(), id: id || '', style: {}, className: '', value: '', attrs: {},
			children: [], listeners: {}, parentNode: null, _html: '',
			setAttribute: function (k, v) { this.attrs[k] = String(v); },
			getAttribute: function (k) { return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null; },
			hasAttribute: function (k) { return this.attrs.hasOwnProperty(k); },
			appendChild: function (c) { c.parentNode = this; this.children.push(c); if (c.id) ids[c.id] = c; return c; },
			addEventListener: function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); },
			focus: function () {}, blur: function () {}
		};
		Object.defineProperty(e, 'innerHTML', {
			get: function () { return this._html; },
			set: function (h) {
				this._html = String(h);
				written.push(this._html);
				var self = this;
				this._html.replace(/id="([^"]+)"/g, function (m, i) {
					var c = ids[i] || El('div', i);
					c.parentNode = self;
					ids[i] = c;
					return m;
				});
			}
		});
		if (id) ids[id] = e;
		return e;
	}
	/* the static markup's [data-i18n] elements, as boot.js finds them */
	BASE.replace(/<(\w+)([^>]*?)data-i18n="([^"]+)"/g, function (m, tag, attrs, key) {
		var idm = /id="([^"]+)"/.exec(attrs);
		var el = El(tag, idm ? idm[1] : '');
		el.setAttribute('data-i18n', key);
		statics.push(el);
		return m;
	});
	var body = El('body');
	var document = {
		body: body,
		createElement: function (t) { return El(t); },
		getElementById: function (i) { return ids[i] || null; },
		querySelector: function () { return null; },
		querySelectorAll: function (sel) { return sel === '[data-i18n]' ? statics : []; }
	};
	return { ids: ids, written: written, statics: statics, document: document };
}

/* env: { hash, config, bridge, languages } */
function makeCtx(env) {
	env = env || {};
	var dom = makeDom(), store = {}, requests = [];
	var sb = {
		console: { log: function () {}, warn: function () {} }, Math: Math, JSON: JSON, Number: Number, String: String,
		RegExp: RegExp, Object: Object, Array: Array, isFinite: isFinite, encodeURIComponent: encodeURIComponent,
		Date: FakeDate,
		location: { hash: env.hash || '' },
		navigator: { onLine: true, languages: env.languages || [], language: (env.languages || [])[0] },
		localStorage: {
			getItem: function (k) { return store.hasOwnProperty(k) ? store[k] : null; },
			setItem: function (k, v) { store[k] = String(v); },
			removeItem: function (k) { delete store[k]; }
		},
		document: dom.document,
		setTimeout: function () { return 1; }, clearTimeout: function () {},
		Cat: { tests: function () {} },
		painted: [], requests: requests, dom: dom, store: store
	};
	sb.window = sb;
	if (env.bridge !== undefined) {
		sb.PhoneForecast = { host: function () { return 'android'; }, sdk: function () { return 26; },
		                     lang: function () { return env.bridge; }, locate: function () { return true; } };
	}
	var ctx = vm.createContext(sb);
	vm.runInContext(CONFIG, ctx, { filename: 'config' });
	if (env.config !== undefined) sb.app_lang = env.config;
	['src/core/dom.js', 'src/core/store.js', 'src/core/settings.js', 'src/core/host.js', 'src/core/i18n.js',
	 'src/core/places.js', 'src/core/bus.js', 'src/core/view.js', 'src/core/wxsource.js', 'src/core/weather.js',
	 'src/core/settings-ui.js'].forEach(function (m) { vm.runInContext(read(m), ctx, { filename: m }); });
	sb.__net = function (url) {
		requests.push(url);
		if (url.indexOf('geocoding-api.open-meteo.com') !== -1) return { status: 200, body: GEO };
		return { error: 'network' };
	};
	vm.runInContext(
		'getJSON = function (u, h, t, ok, bad) { var r = __net(u); if (r.error) bad(r.error); else ok(JSON.parse(r.body), r.body); };' +
		'httpGet = function (u, h, t, cb) { var r = __net(u); cb(r.error || null, r.status || 0, r.body || "", function () { return ""; }); };' +
		'Guard.run = function (l, f) { f(); return true; };' +
		'View.update = (function (orig) { return function (r, s) { painted.push(r); return orig(r, s); }; })(View.update);',
		ctx);
	return sb;
}

/* ---------------------------------------------------------------- checks */

var pass = 0, fail = 0;
function check(name, got, want) {
	var ok = String(got) === String(want);
	console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok ? '   ' + got : '   got ' + got + ', wanted ' + want));
	if (ok) pass++; else fail++;
}
function checkTrue(name, cond, detail) {
	console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
	if (cond) pass++; else fail++;
}
function head(t) { console.log('\n' + t); }

console.log('\n' + '='.repeat(70));
console.log('ENGLISH AND RUSSIAN - from the phone\'s language');
console.log('='.repeat(70));

/* ================================================================ 1. which language */

head('1. the language follows the phone');
var I = makeCtx({}).I18n;
[['ru', 'ru'], ['be', 'ru'], ['uk', 'ru'], ['kk', 'ru'], ['ru-RU', 'ru'], ['uk_UA', 'ru'], ['en', 'en'], ['de', 'en'],
 ['pl', 'en'], ['zh-Hans-CN', 'en'], ['KK', 'ru']].forEach(function (c) {
	check('family ' + c[0], I.family(c[0]), c[1]);
});
function how(env) { var c = makeCtx(env).I18n; return c.lang() + ' (' + c.how() + ')'; }
check('the APK says uk', how({ bridge: 'uk', languages: ['en-US'] }), 'ru (bridge)');
check('the APK says de', how({ bridge: 'de', languages: ['ru-RU'] }), 'en (bridge)');
check('a tab, navigator be-BY', how({ languages: ['be-BY', 'en'] }), 'ru (navigator)');
check('a tab, navigator fr-FR', how({ languages: ['fr-FR'] }), 'en (navigator)');
check('#lang=en beats a Russian phone', how({ hash: '#lang=en', bridge: 'ru' }), 'en (hash)');
check('#lang=ru beats an English tab', how({ hash: '#x=1&lang=ru', languages: ['en-GB'] }), 'ru (hash)');
check('app_lang = \'ru\' beats an English phone', how({ config: 'ru', bridge: 'en' }), 'ru (config)');
check('app_lang = \'\' leaves it to the phone', how({ config: '', bridge: 'kk' }), 'ru (bridge)');
check('nothing to go on: English', how({}), 'en (default)');
checkTrue('the config ships automatic', /^var app_lang = '';/m.test(BASE));

/* ================================================================ 2. the tables */

head('2. the two tables');
var T = I.tables, en = T.en, ru = T.ru;
var keysEn = Object.keys(en).sort(), keysRu = Object.keys(ru).sort();
var onlyEn = keysEn.filter(function (k) { return !ru.hasOwnProperty(k); });
var onlyRu = keysRu.filter(function (k) { return !en.hasOwnProperty(k); });
checkTrue('the same keys in both', !onlyEn.length && !onlyRu.length,
	(onlyEn.length ? 'only in English: ' + onlyEn.join(' ') + ' ' : '') + (onlyRu.length ? 'only in Russian: ' + onlyRu.join(' ') : '') ||
	keysEn.length + ' keys');
check('seven weekdays, twelve months, eight compass points, in both',
	[en.wday.length, ru.wday.length, en.month.length, ru.month.length, en.compass.length, ru.compass.length].join(' '), '7 7 12 12 8 8');
function holes(v) { return (String(v).match(/\{\d\}/g) || []).sort().join(''); }
var badHoles = keysEn.filter(function (k) { return ru.hasOwnProperty(k) && holes(en[k]) !== holes(ru[k]); });
checkTrue('the same {placeholders} in both', !badHoles.length, badHoles.join(' '));
function flat(v) { return Object.prototype.toString.call(v) === '[object Array]' ? v.join(' ') : String(v); }
var cyrEn = keysEn.filter(function (k) { return CYR.test(flat(en[k])); });
checkTrue('English has no Cyrillic', !cyrEn.length, cyrEn.join(' '));
var emptyRu = keysRu.filter(function (k) { return !flat(ru[k]).trim(); });
checkTrue('no empty Russian entries', !emptyRu.length, emptyRu.join(' '));

/* ================================================================ 3. the page uses only what is there */

head('3. every key the page asks for, and no Cyrillic outside the table');
function walk(dir, out) {
	fs.readdirSync(path.join(ROOT, dir)).forEach(function (n) {
		var p = dir + '/' + n;
		if (fs.statSync(path.join(ROOT, p)).isDirectory()) walk(p, out); else out.push(p);
	});
	return out;
}
var page = walk('src', []);
var used = {};
/* the quoted names in the first argument of every T(...), I18n.t(...) - and t(...)
 * inside i18n.js - so T(a ? 'x' : 'y') counts both and an element id never does */
function keysIn(s, file) {
	/* T( only where it is I18n.t (episodes.js has a T of its own) */
	var re = file === 'src/core/i18n.js' ? /\bt\(/g : /var T = I18n\.t;/.test(s) ? /(?:\bT|I18n\.t)\(/g : /I18n\.t\(/g, m;
	while ((m = re.exec(s))) {
		var i = m.index + m[0].length, depth = 1, q = null, arg = '';
		for (; i < s.length && depth > 0; i++) {
			var ch = s.charAt(i);
			if (q) { if (ch === q && s.charAt(i - 1) !== '\\') q = null; }
			else if (ch === '\'' || ch === '"') q = ch;
			else if (ch === '(') depth++;
			else if (ch === ')') depth--;
			else if (ch === ',' && depth === 1) break;
			if (depth > 0) arg += ch;
		}
		arg.replace(/'([a-z]+(?:_[a-z]+)*)'/g, function (x, k) { used[k] = file; return x; });
	}
}
page.forEach(function (p) {
	var s = read(p);
	if (/\.js$/.test(p)) keysIn(s, p);
	s.replace(/data-i18n="([a-z_]+)"/g, function (m, k) { used[k] = p; return m; });
});
/* built at run time: 'part_' + per, 'loc_' + error, and the rest of the conditions */
['part_morning', 'part_day', 'part_evening', 'part_night', 'loc_denied', 'loc_off', 'loc_timeout', 'loc_unavailable',
 'loc_failed'].forEach(function (k) { used[k] = 'built'; });
var missing = Object.keys(used).filter(function (k) { return !en.hasOwnProperty(k) || !ru.hasOwnProperty(k); });
checkTrue('all ' + Object.keys(used).length + ' keys used are in both tables', !missing.length,
	missing.map(function (k) { return k + ' (' + used[k] + ')'; }).join(' '));
var unused = keysEn.filter(function (k) { return !used.hasOwnProperty(k) && ['wday', 'month', 'compass'].indexOf(k) === -1 &&
	k.indexOf('cond_') !== 0 && k.indexOf('light_') !== 0; });
checkTrue('and no key is left over', !unused.length, unused.join(' '));
var cyrFiles = page.filter(function (p) { return p !== 'src/core/i18n.js' && CYR.test(read(p)); });
checkTrue('no page file but i18n.js has a Cyrillic letter (' + page.length + ' files)', !cyrFiles.length, cyrFiles.join(' '));

/* ================================================================ 4. formats */

head('4. dates, wind, conditions, units');
var E = makeCtx({ hash: '#lang=en' }), R = makeCtx({ hash: '#lang=ru' });
var mon = new FakeDate(2026, 10, 23, 9, 0);
check('Russian date', R.I18n.date(mon), 'пн, 23.11.26');
check('English date', E.I18n.date(mon), 'Mon 23 Nov');
check('English date, a single-digit day', E.I18n.date(new FakeDate(2026, 0, 4)), 'Sun 4 Jan');
check('a day that is not today', R.I18n.dayMonth(mon) + ' / ' + E.I18n.dayMonth(mon), '23 ноя / 23 Nov');
check('compass, Russian', [0, 45, 90, 135, 180, 225, 270, 315, 350, -10, 405].map(R.I18n.compass).join(' '), 'С СВ В ЮВ Ю ЮЗ З СЗ С С СВ');
check('compass, English', [0, 45, 90, 135, 180, 225, 270, 315, 350, -10, 405].map(E.I18n.compass).join(' '), 'N NE E SE S SW W NW N N NE');
check('conditions, English', ['skc_d', 'bkn_n', 'ovc', 'ovc_-ra', 'ovc_+sn', 'bkn_ra_d', 'ovc_ra_sn', 'ovc_ts_ra'].map(E.I18n.condition).join(' | '),
	'clear | partly cloudy | overcast | light rain | heavy snow | showers | sleet | thunderstorm');
check('conditions, Russian', ['skc_d', 'ovc', 'ovc_ra', 'ovc_sn', 'ovc_ts_ra'].map(R.I18n.condition).join(' | '),
	'ясно | пасмурно | дождь | снег | гроза');
check('"now", English', E.I18n.t('st_now', '+5', 'overcast', 'NW', 3.2, E.I18n.t('unit_wind')), 'Now +5°, overcast, wind NW 3.2 m/s');
check('"now", Russian', R.I18n.t('st_now', '+5', 'пасмурно', 'СЗ', 3.2, R.I18n.t('unit_wind')), 'Сейчас +5°, пасмурно, ветер СЗ 3.2 м/с');
check('pressure unit: hPa in English, mm Hg in Russian', E.I18n.t('unit_pressure') + ' / ' + R.I18n.t('unit_pressure'), 'hPa / мм рс');

/* ================================================================ 5. rendered */

function render(lang) {
	var c = makeCtx({ hash: '#lang=' + lang });
	NOW = FETCHED;
	c.Settings.setPlace('Berlin, Germany', 52.52, 13.41);
	c.store['wx.raw.v2'] = JSON.stringify({ v: 2, t: FETCHED, src: 'open-meteo', key: '52.5200,13.4100',
		lat: 52.52, lon: 13.41, place: 'Berlin, Germany', raw: OM });
	NOW = FETCHED + 60000;
	c.I18n.paint(c.document);
	c.View.register();
	c.Weather.restore(new FakeDate(), NOW);
	var out = [c.I18n.date(new FakeDate())];
	c.dom.statics.forEach(function (el) { out.push(el.innerHTML); });
	c.painted.forEach(function (r) { for (var k in r) out.push(String(r[k])); });
	/* the stale badge's words (cat.js puts them together) */
	out.push(c.I18n.t('stale_dead', '14:05'), c.I18n.t('stale_ends', 2), c.I18n.t('stale_last', c.I18n.t('age_hm', 3, 10)),
		c.I18n.t('age_m', 7));
	/* the gear: open it, search, choose, every message */
	c.SettingsUI.init();
	c.SettingsUI.show(true);
	var ids = c.dom.ids;
	var nowLine = ids.cfg_now.innerHTML;                 /* Berlin's weather, before a new city clears it */
	function click(id) { ids.cfg_panel.listeners.click.forEach(function (f) { f({ target: ids[id], stopPropagation: function () {} }); }); }
	ids.cfg_city.value = '';
	click('cfg_find');                                   /* "type a city" */
	ids.cfg_city.value = 'Berlin';
	click('cfg_find');                                   /* eight results */
	click('cfg_res_1');                                  /* a new place; its forecast fails here */
	ids.cfg_city.value = 'Berlin';
	click('cfg_find');
	click('cfg_res_1');                                  /* the same again: "already chosen" */
	click('cfg_locate');
	['denied', 'off', 'timeout', 'unavailable', 'weird'].forEach(function (e) {
		c.Places.located({ ok: false, error: e });
		click('cfg_locate');
	});
	ids.cfg_qfrom.value = '25:00'; click('cfg_save');
	ids.cfg_qfrom.value = '22:00'; ids.cfg_qto.value = '07:00'; click('cfg_save'); click('cfg_save');
	click('cfg_reset');
	out = out.concat(c.dom.written, [ids.cfg_city.attrs.placeholder || '']);
	return { c: c, out: out, painted: c.painted, now: nowLine };
}

function visible(s) {
	return String(s).replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

['en', 'ru'].forEach(function (lang) {
	head('5. ' + (lang === 'en' ? 'English' : 'Russian') + ', rendered: the forecast screen and the gear');
	var r = render(lang), all = r.out.map(visible).filter(Boolean), text = ' ' + all.join(' | ') + ' ';
	checkTrue('rendered', all.length > 60, all.length + ' strings');
	var keyLike = all.filter(function (s) { return /\b(cfg|msg|st|loc|cond|part|unit|stale|age|place)_[a-z_]+\b/.test(s) && !/cfg_res_/.test(s); });
	checkTrue('no key shown in place of words', !keyLike.length, keyLike.slice(0, 3).join(' | '));
	var holesLeft = all.filter(function (s) { return /\{\d\}/.test(s); });
	checkTrue('no placeholder left unfilled', !holesLeft.length, holesLeft.slice(0, 3).join(' | '));
	var screen = {};
	r.painted.forEach(function (p) { for (var k in p) screen[k] = p[k]; });
	if (lang === 'en') {
		var cyr = all.filter(function (s) { return CYR.test(s); });
		checkTrue('not one Cyrillic letter on screen or in the dialog', !cyr.length, cyr.slice(0, 3).join(' | '));
		checkTrue('pressure in hPa', screen.pressure > 900 && screen.pressure < 1100, screen.pressure + ' hPa');
		check('the columns', screen.forecast_title_0 + ' / ' + screen.forecast_title_1, 'evening / night');
		checkTrue('the dialog is English', text.indexOf('SETTINGS') !== -1 && text.indexOf('USE MY LOCATION') !== -1 &&
			text.indexOf('This city is already chosen') !== -1 && text.indexOf('Choose your city from the list') !== -1);
	} else {
		checkTrue('Russian, as before', text.indexOf('НАСТРОЙКИ') !== -1 && text.indexOf('МОЁ МЕСТОПОЛОЖЕНИЕ') !== -1 &&
			text.indexOf('Этот город уже выбран') !== -1);
		checkTrue('pressure in mm Hg', screen.pressure > 700 && screen.pressure < 800, screen.pressure + ' мм рс');
		check('the columns', screen.forecast_title_0 + ' / ' + screen.forecast_title_1, 'вечером / ночью');
	}
	check('the credit is the same name in both', screen.wx_credit, 'Open-Meteo.com');
	var now = visible(r.now);
	checkTrue('the dialog says what the weather is now', lang === 'en' ? /^Now [+-]?\d+°, [a-z ]+, wind [NSEW]{1,2} [\d.]+ m\/s$/.test(now) :
		/^Сейчас [+-]?\d+°, [а-яё ]+, ветер [СЮВЗ]{1,2} [\d.]+ м\/с$/.test(now), now);
});

head('   the search asks in the screen\'s language');
var er = render('en'), rr = render('ru');
check('English screen, "Berlin"', /language=(\w+)/.exec(er.c.requests.filter(function (u) { return /geocoding/.test(u); })[0])[1], 'en');
check('Russian screen, "Berlin"', /language=(\w+)/.exec(rr.c.requests.filter(function (u) { return /geocoding/.test(u); })[0])[1], 'ru');

console.log('\n' + '='.repeat(70));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(70) + '\n');
process.exit(fail ? 1 : 0);
