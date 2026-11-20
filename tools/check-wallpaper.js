/* check-wallpaper.js - the live wallpaper page, offline.
 *
 *   node tools/check-wallpaper.js
 *
 * Loads the REAL sources - the module list comes from tools/wallpaper-modules.js,
 * the config from the same functions tools/build-wallpaper.js injects - into a vm
 * sandbox. Only the browser is faked: a DOM that remembers what it was told, a
 * clock that can be wound forward, a localStorage, a seeded Math.random. No
 * network, no device.
 *
 *   A  Sky        the invented weather: shape, seasons, night, redraws
 *   B  Shuffle    which animation next: reachability, fairness, history
 *   C  Plan       the stand-in for cat/plan.js: gaps, re-arming, sky changes
 *   D  Contract   what the wallpaper leans on in shared code that main may change
 *   E  Built      wallpaper.html and the Android manifest (skipped if not built)
 *   F  Page       the whole bundle booted in a fake DOM: show and hide, zero
 *                 timers while hidden, day and night, size and height, #ep=
 *   G  Timers     the per-page timer gate on its own: freeze, thaw, order
 *   H  Still      #still=1, the lock-screen picture: a calm pose (asleep at
 *                 night), no scene, everything frozen, the ready signal
 *   I  Settings   the settings screen's and the preview's colours (WCAG contrast of
 *                 every pair, the preview's controls and the drawn icons over white,
 *                 black and every preset; no colour or control from the theme), the
 *                 opaque theme, its strings, the draft (the look written only by
 *                 commit()), My wallpaper never deleted, chroma mode always ended
 *
 * After a merge from main, a failure in D, E or F means main changed something
 * the wallpaper leans on: fix it in src/wallpaper/, not in the shared file.          */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var WallModules = require('./wallpaper-modules.js');
var Build = require('./build-wallpaper.js');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
var exists = function (p) { return fs.existsSync(path.join(ROOT, p)); };

var MODULES = WallModules.list();

/* ------------------------------------------------------------------ *
 *  reporting                                                          *
 * ------------------------------------------------------------------ */

var pass = 0, fail = 0, notes = 0;
function check(ok, text, detail) {
	console.log((ok ? '  PASS  ' : '  FAIL  ') + text + (detail ? '   ' + detail : ''));
	if (ok) pass++; else fail++;
	return ok;
}
function note(text) { console.log('  note  ' + text); notes++; }
function head(text) { console.log('\n' + text); }

/* ------------------------------------------------------------------ *
 *  a page in a box                                                    *
 * ------------------------------------------------------------------ */

/* mulberry32: small, fast, and the same sequence on every machine */
function seeded(seed) {
	return function () {
		seed |= 0; seed = seed + 0x6D2B79F5 | 0;
		var t = Math.imul(seed ^ seed >>> 15, 1 | seed);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}

/* Every page is given this config: the cat's lines from the informer, then the
 * wallpaper's own block, exactly as the build stacks them. Hemisphere is pinned so
 * the result does not depend on the timezone of the machine running this. */
var CONFIG = Build.catConfig() + '\n' + Build.wallConfig() +
	"\nvar cat_build = 'check';\nvar wall_hemisphere = 'north';";

/* the viewport, unless a test says otherwise */
var VIEW_W = 360, VIEW_H = 640;

function makePage(opts) {
	opts = opts || {};
	var RealDate = Date;
	var page = {
		now: opts.start || new RealDate(2026, 10, 18, 14, 0, 0).getTime(),
		timers: [], seq: 0, armed: 0, logs: [], warns: [], uncaught: [], listeners: {}, docListeners: {},
		dispatched: [], storage: opts.storage || {},
		view: { w: (opts.viewport || [])[0] || VIEW_W, h: (opts.viewport || [])[1] || VIEW_H }
	};

	function node(extra) {
		var n = {
			style: {}, attrs: {}, children: [], innerHTML: '', textContent: '', id: '',
			setAttribute: function (k, v) { n.attrs[k] = String(v); },
			getAttribute: function (k) { return n.attrs[k] === undefined ? null : n.attrs[k]; },
			appendChild: function (c) { n.children.push(c); return c; },
			addEventListener: function () {},
			getElementsByTagName: function () { return []; },
			querySelector: function () { return node(); }
		};
		for (var k in (extra || {})) n[k] = extra[k];
		return n;
	}
	/* A box whose offset size is what its px style says - Wall.place() sets it -
	 * or, before that, the whole viewport, as the informer's stage would be. */
	function box(extra) {
		var n = node(extra);
		Object.defineProperty(n, 'offsetWidth', { get: function () { return parseFloat(n.style.width) || page.view.w; } });
		Object.defineProperty(n, 'offsetHeight', { get: function () { return parseFloat(n.style.height) || page.view.h; } });
		return n;
	}
	var svg = node();
	var ELS = {
		wl_view:        box(),
		cat_stage:      box(),
		cat_stage_back: box(),
		cat_holder:     node({ getElementsByTagName: function () { return [svg]; } }),
		cat_props:      node(),
		cat_props_back: node(),
		cat_hit:        node()
	};
	/* #cat_holder is 44% x 32.4% of the stage (the wallpaper's CSS) */
	Object.defineProperty(ELS.cat_holder, 'offsetWidth', { get: function () { return ELS.cat_stage.offsetWidth * 0.44; } });
	Object.defineProperty(ELS.cat_holder, 'offsetHeight', { get: function () { return ELS.cat_stage.offsetHeight * 0.324; } });
	var root = node();
	Object.defineProperty(root, 'clientWidth', { get: function () { return page.view.w; } });
	Object.defineProperty(root, 'clientHeight', { get: function () { return page.view.h; } });
	page.els = ELS;

	/* the browser's own timers; page.armed counts every one ever armed */
	function addTimer(fn, ms, every) {
		var id = ++page.seq;
		page.armed++;
		ms = Math.max(0, +ms || 0);
		page.timers.push({ id: id, at: page.now + ms, fn: fn, every: every ? Math.max(1, ms) : 0 });
		return id;
	}
	function clearTimer(id) {
		for (var i = 0; i < page.timers.length; i++) if (page.timers[i].id === id) { page.timers.splice(i, 1); return; }
	}

	function FakeDate(a, b, c, d, e, f, g) {
		var n = arguments.length;
		if (!(this instanceof FakeDate)) return new RealDate(page.now).toString();
		if (n === 0) return new RealDate(page.now);
		if (n === 1) return new RealDate(a);
		return new RealDate(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
	}
	FakeDate.now = function () { return page.now; };
	FakeDate.UTC = RealDate.UTC;
	FakeDate.parse = RealDate.parse;
	FakeDate.prototype = RealDate.prototype;

	var M = Object.create(Math);
	M.random = seeded(opts.seed || 1);

	var hash = opts.hash || '';
	var sandbox = {
		console: {
			log: function (s) { page.logs.push(String(s)); },
			warn: function (s) { page.warns.push(String(s)); },
			error: function (s) { page.warns.push(String(s)); }
		},
		Math: M,
		Date: FakeDate,
		setTimeout: function (fn, ms) { return addTimer(fn, ms, false); },
		clearTimeout: clearTimer,
		setInterval: function (fn, ms) { return addTimer(fn, ms, true); },
		clearInterval: clearTimer,
		performance: { now: function () { return page.now; } },
		navigator: { userAgent: 'check-wallpaper Chrome/69.0.0.0' },
		location: { hash: hash, href: 'file:///android_asset/wallpaper.html' + hash },
		localStorage: {
			getItem: function (k) { return page.storage.hasOwnProperty(k) ? page.storage[k] : null; },
			setItem: function (k, v) { page.storage[k] = String(v); },
			removeItem: function (k) { delete page.storage[k]; }
		},
		document: {
			hidden: false,
			createElement: function () { return node(); },
			getElementById: function (id) { return ELS[id] || null; },
			querySelector: function () { return null; },
			querySelectorAll: function () { return []; },
			addEventListener: function (ev, fn) { (page.docListeners[ev] = page.docListeners[ev] || []).push(fn); },
			createEvent: function () {
				return { initEvent: function (type) { this.type = type; } };
			},
			documentElement: root,
			body: node()
		},
		addEventListener: function (ev, fn) { (page.listeners[ev] = page.listeners[ev] || []).push(fn); },
		dispatchEvent: function (e) { page.dispatched.push(e.type); page.fire(e.type); return true; },
		innerWidth: 9999, innerHeight: 9999          /* wrong on purpose: the page must not use them */
	};
	if (opts.bridge) {
		sandbox.PhoneForecast = {
			host: function () { return 'check'; },
			sdk: function () { return 26; },
			config: function () { return opts.bridge.config || '{"size":60,"lift":22}'; }
		};
		if (opts.bridge.stillReady) sandbox.PhoneForecast.stillReady = opts.bridge.stillReady;
	}
	sandbox.window = sandbox;

	var ctx = vm.createContext(sandbox);
	page.ctx = ctx;
	page.run = function (code) { return vm.runInContext(code, ctx); };
	page.sandbox = sandbox;

	page.run(CONFIG + '\n' + (opts.config || ''));
	var last = opts.upTo ? MODULES.indexOf(opts.upTo) : MODULES.length - 1;
	if (last === -1) throw new Error('no module ' + opts.upTo + ' in the wallpaper list');
	for (var i = 0; i <= last; i++) vm.runInContext(read(MODULES[i]), ctx, { filename: MODULES[i] });

	/* run every timer due up to `to`, in order, as the browser would */
	page.advance = function (to) {
		for (;;) {
			var best = -1;
			for (var j = 0; j < page.timers.length; j++) {
				var t = page.timers[j];
				if (t.at > to) continue;
				if (best === -1 || t.at < page.timers[best].at ||
					(t.at === page.timers[best].at && t.id < page.timers[best].id)) best = j;
			}
			if (best === -1) break;
			var tm = page.timers[best];
			if (tm.at > page.now) page.now = tm.at;
			if (tm.every) tm.at += tm.every; else page.timers.splice(best, 1);
			try { tm.fn(); } catch (e) { page.uncaught.push(e && e.stack ? e.stack.split('\n')[0] : String(e)); }
		}
		page.now = Math.max(page.now, to);
	};
	page.fire = function (ev, onDocument) {
		((onDocument ? page.docListeners : page.listeners)[ev] || []).forEach(function (fn) {
			try { fn({}); } catch (e) { page.uncaught.push(String(e && e.stack || e)); }
		});
	};
	page.resize = function (w, h) { page.view.w = w; page.view.h = h; page.fire('resize'); };
	return page;
}

/* ------------------------------------------------------------------ *
 *  reading source as code: comments and strings blanked              *
 * ------------------------------------------------------------------ */

function codeOnly(src) {
	var out = [], i = 0, n = src.length, prev = '';
	while (i < n) {
		var c = src[i];
		if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
		if (c === '/' && src[i + 1] === '*') {
			var end = src.indexOf('*/', i + 2);
			i = end < 0 ? n : end + 2;
			out.push(' ');
			continue;
		}
		if (c === '\'' || c === '"') {
			var q = c; i++;
			while (i < n && src[i] !== q && src[i] !== '\n') { if (src[i] === '\\') i++; i++; }
			i++;
			out.push(q + q); prev = q;
			continue;
		}
		if (c === '/') {
			var tail = out.slice(-12).join('');
			var isRegex = !prev || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) ||
				/(^|[^\w$])(return|typeof|case|in|new|delete|void|throw)\s*$/.test(tail);
			if (isRegex) {
				i++;
				var inClass = false;
				while (i < n) {
					var d = src[i];
					if (d === '\\') { i += 2; continue; }
					if (d === '\n') break;
					if (d === '[') inClass = true;
					else if (d === ']') inClass = false;
					else if (d === '/' && !inClass) break;
					i++;
				}
				i++;
				while (i < n && /[a-z]/i.test(src[i])) i++;
				out.push('/r/'); prev = '/';
				continue;
			}
		}
		out.push(c);
		if (!/\s/.test(c)) prev = c;
		i++;
	}
	return out.join('');
}

function catModules() { return MODULES.filter(function (m) { return m.indexOf('src/cat/') === 0; }); }
function wallModules() { return MODULES.filter(function (m) { return m.indexOf('src/wallpaper/') === 0; }); }

/* ------------------------------------------------------------------ *
 *  shared fixtures                                                    *
 * ------------------------------------------------------------------ */

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* the design's table (git show e9db05a:docs/SCREENSAVER.md), typed in separately on purpose */
var SUN_SPEC = [['8:10', '16:40'], ['7:30', '17:30'], ['6:30', '18:20'], ['6:20', '20:10'],
                ['5:30', '21:00'], ['5:00', '21:30'], ['5:20', '21:20'], ['6:00', '20:30'],
                ['6:50', '19:20'], ['7:40', '18:15'], ['7:30', '16:30'], ['8:10', '16:10']];
function mins(s) { var p = s.split(':'); return +p[0] * 60 + +p[1]; }
function at(y, mo, d, h, mi) { return new Date(y, mo, d, h || 0, mi || 0, 0, 0); }
function isSnowy(wx) { return wx.precip === 'sn' || wx.precip === 'ra_sn'; }

var REQUIRED = ['code', 'sky', 'precip', 'intensity', 'isThunder', 'isNight', 'temp', 'wind',
                'windAngle', 'humidity', 'pressure', 'pressureTrend', 'sunriseMin', 'sunsetMin'];

/* ================================================================== *
 *  A. Sky                                                             *
 * ================================================================== */

head('A. Sky - the invented weather');
(function () {
	var p = makePage({ upTo: 'src/wallpaper/plan-random.js', seed: 11 });
	var Sky = p.sandbox.Sky;
	var kinds = Sky.kinds();
	check(kinds.length === 11, 'eleven kinds', kinds.join(' '));

	/* every field, with the types weather.js would give it */
	var bad = [];
	kinds.forEach(function (k) {
		var w = Sky.make(k, at(2026, 0, 15, 12));
		REQUIRED.forEach(function (f) { if (!w.hasOwnProperty(f)) bad.push(k + ' has no ' + f); });
		if (w.code !== 'wall:' + k) bad.push(k + ': code ' + w.code);
		if (['skc', 'bkn', 'ovc'].indexOf(w.sky) === -1) bad.push(k + ': sky ' + w.sky);
		if ([null, 'ra', 'sn', 'ra_sn'].indexOf(w.precip) === -1) bad.push(k + ': precip ' + w.precip);
		if (w.intensity !== 0 || w.windAngle !== 200 || w.humidity !== 60 || w.pressure !== null) bad.push(k + ': fixed fields');
		['temp', 'wind', 'pressureTrend', 'sunriseMin', 'sunsetMin'].forEach(function (f) {
			if (typeof w[f] !== 'number' || w[f] !== w[f]) bad.push(k + ': ' + f + ' is not a number');
		});
		if (typeof w.isNight !== 'boolean' || typeof w.isThunder !== 'boolean') bad.push(k + ': flags are not booleans');
		var wet = k === 'rain' || k === 'storm';
		if (w.pressureTrend !== (wet ? -4 : 0)) bad.push(k + ': pressureTrend ' + w.pressureTrend);
	});
	check(!bad.length, 'every kind has every payload field', bad.join('; '));

	['north', 'south', 'none'].forEach(function (h) {
		p.run("wall_hemisphere = '" + h + "'");
		var empty = [];
		for (var m = 0; m < 12; m++) {
			var w = Sky.weightsFor(m), t = 0;
			for (var k in w) t += w[k];
			if (!(t > 0)) empty.push(MONTHS[m]);
		}
		check(!empty.length, h + ': every month has positive total weight', empty.join(' '));
	});

	/* no snow in summer - by the table, and by actually drawing */
	function snowIn(hemi, months) {
		p.run("wall_hemisphere = '" + hemi + "'");
		var found = [];
		months.forEach(function (m) {
			var w = Sky.weightsFor(m);
			kinds.forEach(function (k) {
				if (w[k] > 0 && isSnowy(Sky.make(k, at(2026, m, 10, 12)))) found.push(MONTHS[m] + ' ' + k + ' (table)');
			});
			for (var i = 0; i < 300; i++) {
				Sky.begin(at(2026, m, 1 + (i % 28), 12));
				if (isSnowy(Sky.current())) { found.push(MONTHS[m] + ' ' + Sky.kind() + ' (drawn)'); break; }
			}
		});
		return found;
	}
	var n = snowIn('north', [5, 6, 7]);
	check(!n.length, 'north: no snow kinds June to August', n.join(', '));
	var s = snowIn('south', [11, 0, 1]);
	check(!s.length, 'south: no snow kinds December to February', s.join(', '));
	var ws = snowIn('north', [0]);
	check(ws.length > 0, 'north: snow does turn up in January');

	/* the sun table, and night flipping exactly on its minutes */
	p.run("wall_hemisphere = 'north'");
	var off = [];
	for (var m = 0; m < 12; m++) {
		var sun = Sky.sunFor(at(2026, m, 15));
		var rise = mins(SUN_SPEC[m][0]), set = mins(SUN_SPEC[m][1]);
		if (sun[0] !== rise || sun[1] !== set) off.push(MONTHS[m] + ' ' + sun.join('-'));
		var probe = function (mm) { return Sky.make('mild', at(2026, m, 15, Math.floor(mm / 60), mm % 60)).isNight; };
		if (!probe(rise - 1) || probe(rise) || probe(set) || !probe(set + 1)) off.push(MONTHS[m] + ' flips off its minutes');
	}
	check(!off.length, 'sunrise/sunset match the table, isNight flips on those minutes', off.join('; '));

	/* tick re-publishes exactly once per flip */
	var emits = [];
	p.sandbox.Bus.on('weather', function (w) { emits.push(w); });
	var wrong = [];
	for (m = 0; m < 12; m++) {
		Sky.begin(at(2026, m, 15, 0, 0));
		emits.length = 0;
		var flips = [];
		for (var mm = 0; mm < 1440; mm++) {
			if (Sky.tick(at(2026, m, 15, Math.floor(mm / 60), mm % 60))) flips.push(mm);
		}
		var sun2 = Sky.sunFor(at(2026, m, 15));
		if (emits.length !== 2 || flips.length !== 2 || flips[0] !== sun2[0] || flips[1] !== sun2[1] + 1) {
			wrong.push(MONTHS[m] + ': ' + emits.length + ' emits at ' + flips.join(','));
		}
	}
	check(!wrong.length, 'tick() re-publishes exactly once per flip (twice a day)', wrong.join('; '));

	/* redraw always changes the kind */
	var same = 0, prevKind;
	Sky.begin(at(2026, 0, 1, 12));
	prevKind = Sky.kind();
	for (var i = 0; i < 3000; i++) {
		var d = at(2026, i % 12, 1 + (i % 28), (i * 7) % 24);
		Sky.redraw(d);
		if (Sky.kind() === prevKind) same++;
		prevKind = Sky.kind();
	}
	check(same === 0, 'redraw() never repeats the current kind (3000 redraws)', same ? same + ' repeats' : '');

	/* the hemisphere from the timezone name */
	p.run("wall_hemisphere = 'auto'");
	var tz = { 'Europe/Minsk': 'north', 'America/New_York': 'north', 'Australia/Sydney': 'south',
	           'Pacific/Auckland': 'south', 'America/Sao_Paulo': 'south',
	           'America/Argentina/Buenos_Aires': 'south', 'Africa/Johannesburg': 'south', '': 'north' };
	var miss = [];
	Object.keys(tz).forEach(function (z) {
		p.run('Intl = { DateTimeFormat: function () { return { resolvedOptions: function () { return { timeZone: ' +
			JSON.stringify(z) + ' }; } }; } };');
		if (Sky.hemisphere() !== tz[z]) miss.push((z || '(blank)') + ' -> ' + Sky.hemisphere());
	});
	p.run("Intl = { DateTimeFormat: function () { throw new Error('no Intl'); } };");
	if (Sky.hemisphere() !== 'north') miss.push('Intl throwing -> ' + Sky.hemisphere());
	check(!miss.length, "'auto' hemisphere from the timezone, north when unsure", miss.join('; '));
})();

/* ================================================================== *
 *  B. Shuffle                                                         *
 * ================================================================== */

head('B. Shuffle - which animation next');
var REACHABLE = {};
(function () {
	var store = {};
	var p = makePage({ upTo: 'src/wallpaper/plan-random.js', seed: 22, storage: store });
	var Sky = p.sandbox.Sky, Shuffle = p.sandbox.Shuffle, Scenes = p.sandbox.Scenes;
	var lib = p.sandbox.Episodes.planLibrary();
	var cands = lib.cands;
	var positive = cands.filter(function (c) { return c.weight > 0; });
	var zero = cands.filter(function (c) { return !(c.weight > 0); }).map(function (c) { return c.id; });

	/* Every scene with weight is eligible somewhere the month table allows:
	 * every month, a full week plus the days the calendar scenes ask for, every
	 * half hour, every kind that month can draw, night from the sun table.    */
	var special = {};
	cands.forEach(function (c) {
		var def = Scenes.find(c.id);
		if (def && def.when && def.when.dates) def.when.dates.forEach(function (md) { special[md] = 1; });
	});
	var left = positive.slice();
	for (var m = 0; m < 12 && left.length; m++) {
		var w = Sky.weightsFor(m);
		var days = [4, 5, 6, 7, 8, 9, 10, 20, 24, 28];
		Object.keys(special).forEach(function (md) { if (+md.slice(0, 2) === m + 1) days.push(+md.slice(3)); });
		for (var di = 0; di < days.length && left.length; di++) {
			for (var half = 0; half < 48 && left.length; half++) {
				var date = at(2026, m, days[di], Math.floor(half / 2), (half % 2) * 30);
				Sky.kinds().forEach(function (k) {
					if (!(w[k] > 0) || !left.length) return;
					var el = Shuffle.eligible(left, Sky.make(k, date), date);
					if (!el.length) return;
					el.forEach(function (c) { REACHABLE[c.id] = 1; });
					left = left.filter(function (c) { return !REACHABLE[c.id]; });
				});
			}
		}
	}
	check(!left.length, Object.keys(REACHABLE).length + ' of ' + cands.length +
		' animations reachable by some kind, hour and day of the month table' +
		(zero.length ? ' (weight 0, never shown: ' + zero.join(', ') + ')' : ''),
		left.length ? 'never eligible: ' + left.map(function (c) { return c.id; }).join(', ') : '');

	/* 3000 dream starts at random times, history carried between them, each
	 * one exactly as Wall.begin() does it. One in ten falls on a day a
	 * calendar scene wants, or those would hardly ever come up to be tested. */
	var rnd = seeded(2026);
	var specialDays = [];
	cands.forEach(function (c) {
		var def = Scenes.find(c.id);
		if (!def || !def.when) return;
		(def.when.dates || []).forEach(function (md) { specialDays.push([+md.slice(0, 2) - 1, +md.slice(3)]); });
		(def.when.months || []).forEach(function (mo) {
			for (var d = def.when.dayMin || 1; d <= 28 + 3; d++) specialDays.push([mo - 1, d]);
		});
	});
	function randomDate() {
		var day;
		if (specialDays.length && rnd() < 0.1) {
			var s = specialDays[Math.floor(rnd() * specialDays.length)];
			day = at(2026, s[0], s[1]);
		} else {
			day = new Date(2026, 0, 1 + Math.floor(rnd() * 365));
		}
		day.setHours(Math.floor(rnd() * 24), Math.floor(rnd() * 60));
		return day;
	}

	var picks = [], count = {}, offered = {}, repeats = [], nulls = 0, zeroPicked = [];
	for (var i = 0; i < 3000; i++) {
		var date = randomDate();
		Sky.begin(date);
		for (var r = 0; r < 4 && Shuffle.fresh(cands, Sky.current(), date) === 0; r++) Sky.redraw(date);
		var el = Shuffle.eligible(cands, Sky.current(), date);
		el.forEach(function (c) { offered[c.id] = (offered[c.id] || 0) + 1; });
		var id = Shuffle.next(cands, Sky.current(), date);
		if (!id) { nulls++; picks.push(null); continue; }
		if (zero.indexOf(id) !== -1) zeroPicked.push(id);
		if (el.length >= 3 && (id === picks[picks.length - 1] || id === picks[picks.length - 2])) {
			repeats.push(i + ': ' + id);
		}
		picks.push(id);
		count[id] = (count[id] || 0) + 1;
	}
	check(!nulls, '3000 starts, every one found something to play', nulls ? nulls + ' found nothing' : '');
	check(!repeats.length, 'no pick repeats either of the two before it (with 3+ eligible)',
		repeats.slice(0, 5).join(', '));

	var OFFERED_ENOUGH = 25;
	var starved = positive.filter(function (c) { return (offered[c.id] || 0) >= OFFERED_ENOUGH && !count[c.id]; });
	check(!starved.length, 'every animation offered ' + OFFERED_ENOUGH + '+ times was shown',
		starved.map(function (c) { return c.id + ' (offered ' + offered[c.id] + ')'; }).join(', '));
	var rare = positive.filter(function (c) { return (offered[c.id] || 0) < OFFERED_ENOUGH; });
	var shown = positive.filter(function (c) { return count[c.id]; }).length;
	check(shown === positive.length, shown + ' of ' + positive.length + ' reachable animations appeared in the 3000 starts',
		positive.filter(function (c) { return !count[c.id]; }).map(function (c) { return c.id; }).join(', '));
	if (rare.length) note('offered fewer than ' + OFFERED_ENOUGH + ' times in this sample: ' +
		rare.map(function (c) { return c.id + ' x' + (offered[c.id] || 0); }).join(', '));

	var MULTIPLE = 4;
	var counts = positive.map(function (c) { return count[c.id] || 0; }).sort(function (a, b) { return a - b; });
	var median = counts[Math.floor(counts.length / 2)];
	var top = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; });
	check(count[top[0]] <= MULTIPLE * median, 'nothing shown more than ' + MULTIPLE + 'x the median (' + median + ')',
		'most: ' + top.slice(0, 4).map(function (k) { return k + ' x' + count[k]; }).join(', ') +
		'; least: ' + counts.slice(0, 3).join(', '));

	/* no weather at all */
	var nullBad = [];
	for (i = 0; i < 60; i++) {
		var d2 = at(2026, i % 12, 3 + (i % 20), (i * 5) % 24, 15);
		var id2 = Shuffle.next(cands, null, d2);
		var c2 = cands.filter(function (c) { return c.id === id2; })[0];
		if (!id2 || !c2 || !(c2.weight > 0) || !c2.cond(null, d2)) nullBad.push(d2.toISOString() + ' -> ' + id2);
	}
	check(!nullBad.length, 'works with wx === null', nullBad.slice(0, 3).join('; '));

	/* weight 0 is never shown, even when its conditions are met */
	var withZero = cands.concat([{ id: 'zero_weight', weight: 0, energy: 'mid', cond: function () { return true; } }]);
	for (i = 0; i < 500; i++) {
		var id3 = Shuffle.next(withZero, Sky.make('mild', at(2026, 5, 3, 12)), at(2026, 5, 3, 12));
		if (id3 === 'zero_weight') zeroPicked.push(id3);
	}
	check(!zeroPicked.length, 'never returns a weight-0 animation', zeroPicked.slice(0, 3).join(', '));

	/* late at night, nothing boisterous if anything calmer fits */
	var loud = 0;
	for (i = 0; i < 200; i++) {
		var d3 = at(2026, i % 12, 10, (i % 2) ? 1 : 23, 30);
		var el3 = Shuffle.eligible(cands, Sky.make('mild', d3), d3);
		el3.forEach(function (c) { if (c.energy === 'high') loud++; });
	}
	check(!loud, 'no high-energy animation is eligible between 22:00 and 05:00 (if calmer ones fit)');

	/* the history survives a restart */
	var seen = Shuffle.seen();
	var cap = Math.floor(cands.length * 0.6);
	check(seen.length > 0 && seen.length <= cap, 'history capped at 60% of the library', seen.length + ' of max ' + cap);
	var p2 = makePage({ upTo: 'src/wallpaper/plan-random.js', seed: 23, storage: store });
	check(JSON.stringify(p2.sandbox.Shuffle.seen()) === JSON.stringify(seen),
		'history survives a restart (through Store and localStorage)');
	check(p2.sandbox.Store.persistent() === true, 'Store used localStorage, not its memory fallback');
})();

/* ================================================================== *
 *  C. Plan stand-in                                                   *
 * ================================================================== */

head('C. Plan - the stand-in for cat/plan.js');
(function () {
	var p = makePage({ upTo: 'src/wallpaper/plan-random.js', seed: 33 });
	p.run('var Cat = { weather: function () { return Sky.current(); } };');
	var Plan = p.sandbox.Plan, Sky = p.sandbox.Sky;
	Plan.init(function () { return p.sandbox.Episodes.planLibrary(); });
	var cfg = p.run('[wall_gap_min, wall_gap_max, wall_sky_every]');
	var MIN = cfg[0] * 1000, MAX = cfg[1] * 1000, EVERY = cfg[2];

	var t0 = at(2026, 10, 18, 14, 0).getTime();
	Sky.begin(new Date(t0));
	var r1 = Plan.due(new Date(t0));
	var armed = Plan.armed();
	check(r1 === null && armed >= t0 + MIN && armed <= t0 + MAX,
		'first due() arms a ' + cfg[0] + '-' + cfg[1] + ' s gap and returns null', 'armed +' + ((armed - t0) / 1000) + ' s');
	check(Plan.due(new Date(t0 + MIN - 1)) === null && Plan.due(new Date(armed - 1)) === null,
		'null until the gap has passed');
	check(Plan.upcoming(new Date(t0)).join !== undefined && Plan.upcoming(new Date(t0)).length === 1,
		'upcoming() is a list, as cat.js joins it', JSON.stringify(Plan.upcoming(new Date(t0))));
	var slot = Plan.due(new Date(armed));
	check(!!(slot && typeof slot.id === 'string' && p.sandbox.Episodes.find(slot.id)),
		'then a slot naming a real animation', slot ? slot.id : 'null');
	Plan.markDone(slot, slot && slot.id);
	check(Plan.armed() === 0, 'markDone() disarms');
	var r2 = Plan.due(new Date(armed + 5000));
	check(r2 === null && Plan.armed() > armed + 5000, 'the next due() arms a fresh gap');
	Plan.skip({ id: 'x' });
	check(Plan.armed() === 0, 'skip() disarms');

	/* hurry(): the next slot 1.5 s from now, once, then the random gap again */
	var th = at(2026, 10, 18, 15, 0).getTime();
	p.now = th;
	Plan.hurry();
	var h1 = Plan.armed();
	var early = Plan.due(new Date(th + 1499));
	var hs = Plan.due(new Date(th + 1500));
	Plan.markDone(hs, hs && hs.id);
	Plan.due(new Date(th + 30000));
	var gap = Plan.armed() - (th + 30000);
	check(h1 === th + 1500 && early === null && !!(hs && hs.id) && gap >= MIN && gap <= MAX,
		'hurry() owes the next slot 1.5 s from now, once; the arming after it is a normal gap',
		'armed +' + (h1 - th) + ' ms, then ' + (hs ? hs.id : 'null') + ', then a ' + Math.round(gap / 1000) + ' s gap');

	/* the sky changes on every fifth arming, and only then */
	var emitsAt = [], kinds = [];
	var p2 = makePage({ upTo: 'src/wallpaper/plan-random.js', seed: 34 });
	p2.run('var Cat = { weather: function () { return Sky.current(); } };');
	var Plan2 = p2.sandbox.Plan, Sky2 = p2.sandbox.Sky;
	Plan2.init(function () { return p2.sandbox.Episodes.planLibrary(); });
	var t = at(2026, 10, 18, 9, 0).getTime();
	Sky2.begin(new Date(t));
	var emits = 0;
	p2.sandbox.Bus.on('weather', function () { emits++; });
	var ids = [];
	for (var a = 1; a <= 4 * EVERY; a++) {
		var before = emits, kindBefore = Sky2.kind();
		Plan2.due(new Date(t));                       /* arms */
		if (emits !== before) { emitsAt.push(Plan2.armings()); if (Sky2.kind() === kindBefore) kinds.push(a); }
		t += MAX + 1000;
		var s = Plan2.due(new Date(t));
		if (s) { ids.push(s.id); Plan2.markDone(s, s.id); } else Plan2.skip(null);
		t += 20000;
	}
	var want = [];
	for (a = EVERY; a <= 4 * EVERY; a += EVERY) want.push(a);
	check(emitsAt.join(',') === want.join(',') && !kinds.length,
		'the sky is redrawn on every ' + EVERY + 'th arming, to a different kind', 'redrawn at armings ' + emitsAt.join(','));
	var rep = 0;
	for (a = 2; a < ids.length; a++) if (ids[a] === ids[a - 1] || ids[a] === ids[a - 2]) rep++;
	check(ids.length === 4 * EVERY && !rep, ids.length + ' slots, none repeating the two before');
	var st = Plan2.stats();
	check(st.day === 'wall' && st.total === ids.length && st.done === ids.length && st.missed === 0 &&
		st.substituted === 0 && typeof st.byId === 'object' && st.unique > 0,
		'stats() has the fields the overlay reads', JSON.stringify({ total: st.total, unique: st.unique }));
})();

/* ================================================================== *
 *  D. Contract with shared code                                       *
 * ================================================================== */

head('D. Contract - what the wallpaper leans on in shared code');
var BUILT = exists('wallpaper.html') ? read('wallpaper.html') : null;
(function () {
	var p = makePage({ seed: 44 });
	var Plan = p.sandbox.Plan;

	/* every Plan.<name> the bundled cat code calls */
	var used = {}, missing = [];
	catModules().forEach(function (m) {
		var code = codeOnly(read(m)), re = /\bPlan\.([A-Za-z_$][\w$]*)/g, x;
		while ((x = re.exec(code))) used[x[1]] = (used[x[1]] || []).concat(m.replace('src/cat/', ''));
	});
	Object.keys(used).forEach(function (n) { if (typeof Plan[n] !== 'function') missing.push(n + ' (' + used[n][0] + ')'); });
	check(!missing.length, 'every Plan.<name> the bundled cat code uses exists on the stand-in',
		missing.length ? 'missing: ' + missing.join(', ') : Object.keys(used).sort().join(' '));

	/* the forecast's globals do not exist here */
	var ALLOW = { 'src/cat/cat.js': ['Weather.status'] };
	var stray = [];
	MODULES.forEach(function (m) {
		var code = codeOnly(read(m)), re = /(^|[^\w$.])((Weather|View|Settings|Clock)\.[A-Za-z_$][\w$]*)/g, x;
		while ((x = re.exec(code))) if ((ALLOW[m] || []).indexOf(x[2]) === -1) stray.push(m + ': ' + x[2]);
	});
	check(!stray.length, 'Weather/View/Settings/Clock referenced only where allowed (Weather.status in cat.js)',
		stray.join(', '));
	var cat = read('src/cat/cat.js');
	var a = cat.indexOf("byId('wx_stale')"), b = cat.indexOf('Weather.status()');
	var guard = a !== -1 && b > a && /if\s*\(\s*!el\s*\)\s*return\s*;/.test(cat.slice(a, b));
	check(guard, "cat.js showStale() returns before Weather.status() when there is no #wx_stale");

	check(/function inQuiet\(date\)\s*\{\s*return inClockWindow\(date,\s*cat_quiet_from,\s*cat_quiet_to,\s*false\);\s*\}/.test(cat),
		'cat.js still reads cat_quiet_from/to live through inQuiet()');
	var blank = p.run("inClockWindow(new Date(2026, 0, 1, 3, 0), '', '', false)");
	var night = p.run("inClockWindow(new Date(2026, 0, 1, 3, 0), '23:00', '07:00', false)");
	var day = p.run("inClockWindow(new Date(2026, 0, 1, 12, 0), '23:00', '07:00', false)");
	check(blank === false && night === true && day === false,
		'dom.js inClockWindow: a blank window is false, 23:00-07:00 wraps midnight');

	/* every bare cat_ / app_ / wall_ name used is declared in the page */
	var declared = {};
	var source = BUILT || CONFIG;
	var dre = /^var ((?:cat|app|wall)_[a-z0-9_]+)\s*=/gm, d;
	while ((d = dre.exec(source))) declared[d[1]] = 1;
	var undeclared = {}, names = {};
	MODULES.forEach(function (m) {
		var code = codeOnly(read(m)), re = /(^|[^\w$.])((?:cat|app|wall)_[a-z0-9_]+)\b/g, x;
		while ((x = re.exec(code))) {
			names[x[2]] = 1;
			if (!declared[x[2]]) undeclared[x[2]] = m;
		}
	});
	var und = Object.keys(undeclared);
	check(!und.length, 'every cat_/app_/wall_ global the bundle uses is declared in ' +
		(BUILT ? 'wallpaper.html' : 'the assembled config'),
		und.length ? und.map(function (n) { return n + ' (' + undeclared[n] + ')'; }).join(', ') : Object.keys(names).length + ' names');

	/* the payload has every field weather.js derive() publishes */
	var wsrc = exists('src/core/weather.js') ? codeOnly(read('src/core/weather.js')) : '';
	var di = wsrc.indexOf('function derive(');
	var block = di === -1 ? null : /return\s*\{([\s\S]*?)\}\s*;/.exec(wsrc.slice(di));
	if (!block) note('derive() not found in src/core/weather.js - payload shape not compared');
	else {
		var keys = [], kre = /^\s*([A-Za-z_$][\w$]*)\s*:/gm, k;
		while ((k = kre.exec(block[1]))) keys.push(k[1]);
		var payload = p.sandbox.Sky.make('mild', at(2026, 5, 1, 12));
		var lack = keys.filter(function (key) { return !payload.hasOwnProperty(key); });
		check(keys.length > 5 && !lack.length, 'the sky payload has every field weather.js derive() returns',
			lack.length ? 'missing: ' + lack.join(', ') : keys.length + ' fields');
	}

	/* the shared calls the wallpaper makes */
	var api = ['Cat.init', 'Cat.play', 'Cat.weather', 'Episodes.running', 'Episodes.find', 'Episodes.planLibrary',
	           'Bus.on', 'Bus.emit', 'Guard.run', 'Guard.fault', 'Store.getJSON', 'Store.setJSON', 'Anim.tier', 'Anim.to',
	           'Host.native', 'inClockWindow', 'addClass', 'removeClass', 'byId', 'on', 'LOG',
	           /* still.js */
	           'Rig.set', 'Rig.get', 'Rig.face', 'Rig.facing', 'Rig.parts', 'Rig.biasOf', 'Actions.sit',
	           'Actions.lookAt', 'Actions.lids', 'Actions.posture', 'Alive.asleep', 'Wardrobe.current'];
	var gone = api.filter(function (n) { return p.run('typeof ' + n) !== 'function'; });
	check(!gone.length, 'the shared functions the wallpaper calls all exist', gone.join(', '));

	/* ES5 in everything the wallpaper adds to the page */
	var es6 = [];
	wallModules().forEach(function (m) {
		var code = codeOnly(read(m));
		if (/(^|[^\w$.])(let|const|class)\s/.test(code)) es6.push(m + ': let/const/class');
		if (/=>/.test(code)) es6.push(m + ': arrow function');
		if (/`/.test(code)) es6.push(m + ': template literal');
	});
	check(!es6.length, 'src/wallpaper/*.js is ES5 (no let/const/class, arrows or template literals)', es6.join(', '));

	/* The timer gate's premise. timers.js replaces window's four timer functions,
	 * so it holds only if every timer in shared code is a bare call made at call
	 * time: no requestAnimationFrame (not gated), and no reference to a native
	 * function kept from before the gate loaded (`= setTimeout`, `window.setTimeout`,
	 * passing it as a value). setInterval itself is fine - the gate wraps it - and
	 * cat.js uses it for the debug overlay; those uses are listed, not failed. */
	var NAMES = /\b(setTimeout|clearTimeout|setInterval|clearInterval)\b/g;
	var raf = [], refs = [], intervals = [];
	MODULES.forEach(function (m) {
		if (m.indexOf('src/cat/') !== 0 && m.indexOf('src/core/') !== 0) return;
		var code = codeOnly(read(m)), x;
		if (/\b(webkit|moz)?[rR]equestAnimationFrame\b/.test(code)) raf.push(m);
		NAMES.lastIndex = 0;
		while ((x = NAMES.exec(code))) {
			var before = code.slice(Math.max(0, x.index - 1), x.index);
			var after = code.slice(x.index + x[0].length).replace(/^\s+/, '');
			if (before === '.' || after.charAt(0) !== '(') {
				refs.push(m + ': ' + code.slice(Math.max(0, x.index - 12), x.index + x[0].length + 3).replace(/\s+/g, ' '));
			}
			if (x[1] === 'setInterval') intervals.push(m.replace('src/', ''));
		}
	});
	check(!raf.length && !refs.length,
		'shared code calls timers only as bare setTimeout(...)/setInterval(...): no rAF, no kept reference (the gate\'s premise)',
		raf.map(function (m) { return m + ': requestAnimationFrame'; }).concat(refs).join(', ') ||
		(intervals.length ? 'setInterval, gated, in ' + intervals.join(', ') : ''));

	/* and nothing in the #cat_ CSS animates by itself, where no timer is involved */
	var css = Build.catCss();
	check(!/@keyframes|(^|[;{\s])(-webkit-)?(animation|transition)\s*:/m.test(css),
		'the #cat_ CSS has no animation or transition of its own');
})();

/* ================================================================== *
 *  E. Built artefacts                                                 *
 * ================================================================== */

head('E. Built - wallpaper.html and the Android manifest');
(function () {
	if (!BUILT) {
		note('wallpaper.html is not built - run node tools/build-wallpaper.js to check it');
	} else {
		check(!/yandex/i.test(BUILT), 'wallpaper.html never mentions yandex');
		check(!/^var api(_url)?\s*=/m.test(BUILT), 'wallpaper.html declares no API key config (var api / api_url)');
		check(!/#wx_stale|id="wx_stale"/.test(BUILT), 'wallpaper.html has no #wx_stale badge');
		check(!/<!--INJECT:/.test(BUILT), 'every INJECT marker was filled');
		check(!/<!doctype/i.test(BUILT), 'no doctype - quirks mode, like the informer');
		check(/^var cat_build = '[^']+';$/m.test(BUILT), 'the build stamp is there');
		var banners = MODULES.filter(function (m) { return BUILT.indexOf('/* ==================== ' + m + ' ') === -1; });
		check(!banners.length, 'every module in the wallpaper list is in the page', banners.join(', '));
		var scripts = [], re = /<script>([\s\S]*?)<\/script>/g, m;
		while ((m = re.exec(BUILT))) scripts.push(m[1]);
		var syntax = [];
		scripts.forEach(function (s, i) { try { new vm.Script(s); } catch (e) { syntax.push('script ' + i + ': ' + e.message); } });
		check(scripts.length >= 3 && !syntax.length, scripts.length + ' script blocks, all parse', syntax.join('; '));
		var asset = exists('android-wallpaper/assets/wallpaper.html') ? read('android-wallpaper/assets/wallpaper.html') : null;
		check(asset === BUILT, 'android-wallpaper/assets/wallpaper.html is the same page');
	}

	var man = exists('android-wallpaper/AndroidManifest.xml') ? read('android-wallpaper/AndroidManifest.xml') : null;
	if (!man) { note('android-wallpaper/AndroidManifest.xml not found'); return; }
	var bare = man.replace(/<!--[\s\S]*?-->/g, '');
	/* Exactly these, and nothing else: setting the lock-screen picture and
	 * restoring wallpapers, the 3-hourly refresh job surviving a reboot,
	 * reading the current wallpaper for the backup and My wallpaper - with
	 * READ_EXTERNAL_STORAGE up to API 32, where Android lets that permission do
	 * it, and "All files access" (MANAGE_EXTERNAL_STORAGE) from API 33 - and the
	 * foreground service the home-screen capture needs (API 28+, and of type
	 * mediaProjection on API 34+). */
	var WANT_PERMS = ['android.permission.FOREGROUND_SERVICE',
	                  'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
	                  'android.permission.MANAGE_EXTERNAL_STORAGE',
	                  'android.permission.READ_EXTERNAL_STORAGE max 32',
	                  'android.permission.RECEIVE_BOOT_COMPLETED',
	                  'android.permission.SET_WALLPAPER'];
	var perms = [], pre = /<uses-permission(?:-sdk-\d+)?\b([^>]*)>/g, pm;
	while ((pm = pre.exec(bare))) {
		var pname = (/android:name="([^"]+)"/.exec(pm[1]) || [])[1] || '?';
		var pmax = (/android:maxSdkVersion="(\d+)"/.exec(pm[1]) || [])[1];
		perms.push(pname + (pmax ? ' max ' + pmax : '') + (/^<uses-permission-sdk/.test(pm[0]) ? ' (sdk-xx form)' : ''));
	}
	perms.sort();
	check(perms.join(', ') === WANT_PERMS.join(', '),
		'the manifest requests exactly SET_WALLPAPER, RECEIVE_BOOT_COMPLETED, READ_EXTERNAL_STORAGE (max SDK 32), ' +
		'MANAGE_EXTERNAL_STORAGE, FOREGROUND_SERVICE and FOREGROUND_SERVICE_MEDIA_PROJECTION',
		perms.join(', ') || 'none');

	/* the home-screen capture: one foreground service, of type mediaProjection, not
	 * exported; a transparent activity of its own task, not exported, not in recents */
	function element(tag, name) {
		var re = new RegExp('<' + tag + '\\b[^>]*android:name="\\.' + name + '"[^>]*>');
		return (re.exec(bare) || [''])[0];
	}
	function attr(el, a) { return (new RegExp('android:' + a + '="([^"]*)"').exec(el) || [])[1]; }
	var capSvc = element('service', 'CaptureService');
	var fgsTypes = bare.match(/android:foregroundServiceType="[^"]*"/g) || [];
	check(!!capSvc && attr(capSvc, 'exported') === 'false' && attr(capSvc, 'foregroundServiceType') === 'mediaProjection' &&
		fgsTypes.length === 1 && !attr(capSvc, 'permission'),
		'CaptureService is the one foreground service: type mediaProjection, not exported',
		capSvc ? 'exported=' + attr(capSvc, 'exported') + ' type=' + attr(capSvc, 'foregroundServiceType') +
			', ' + fgsTypes.length + ' typed services' : 'not declared');
	var capAct = element('activity', 'CaptureActivity');
	var themesXml = exists('android-wallpaper/res/values/themes.xml') ? read('android-wallpaper/res/values/themes.xml') : '';
	var capStyle = (/<style name="LiliCapture"[^>]*>[\s\S]*?<\/style>/.exec(themesXml) || [''])[0];
	check(!!capAct && attr(capAct, 'exported') === 'false' && attr(capAct, 'excludeFromRecents') === 'true' &&
		!!attr(capAct, 'taskAffinity') && attr(capAct, 'taskAffinity') !== (/package="([^"]+)"/.exec(bare) || [])[1] &&
		attr(capAct, 'theme') === '@style/LiliCapture' &&
		/windowIsTranslucent">\s*true/.test(capStyle) && /windowBackground">@android:color\/transparent/.test(capStyle) &&
		/backgroundDimEnabled">\s*false/.test(capStyle),
		'CaptureActivity: not exported, its own taskAffinity, not in recents, a transparent theme that does not dim',
		capAct ? 'affinity ' + attr(capAct, 'taskAffinity') : 'not declared');
	var capCode = exists('android-wallpaper/java/com/lili/wallpaper/CaptureActivity.java') ?
		codeOnly(read('android-wallpaper/java/com/lili/wallpaper/CaptureActivity.java')) : '';
	var svcCode = exists('android-wallpaper/java/com/lili/wallpaper/CaptureService.java') ?
		codeOnly(read('android-wallpaper/java/com/lili/wallpaper/CaptureService.java')) : '';
	var consent = capCode.slice(capCode.indexOf('protected void onActivityResult('));
	check(/SDK_INT >= 29\) startForeground\(NOTE_ID, n, ServiceInfo\.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION\)/.test(svcCode) &&
		/SDK_INT >= 29\) \{\s*serviceAsked = true;\s*CaptureService\.start\(/.test(consent) &&
		consent.indexOf('CaptureService.start(') < consent.indexOf('project(result, data)') &&
		/projection\.registerCallback\(/.test(capCode) &&
		capCode.indexOf('projection.registerCallback(') < capCode.indexOf('createVirtualDisplay('),
		'the projection is asked for only once CaptureService is in the foreground (API 29+), and its callback is registered before the virtual display');
	check(/<service[^>]*android:name="\.LockJob"[^>]*android:permission="android\.permission\.BIND_JOB_SERVICE"/.test(bare),
		'the lock-picture refresh job is a service guarded by BIND_JOB_SERVICE');
	var jobSrc = exists('android-wallpaper/java/com/lili/wallpaper/LockJob.java') ?
		codeOnly(read('android-wallpaper/java/com/lili/wallpaper/LockJob.java')) : '';
	check(/\.setPersisted\(\s*true\s*\)/.test(jobSrc) && /\.setPeriodic\(/.test(jobSrc),
		'LockJob is periodic and persisted (which is what RECEIVE_BOOT_COMPLETED is for)');
	check(/android:permission="android\.permission\.BIND_WALLPAPER"/.test(bare) &&
		/<action android:name="android\.service\.wallpaper\.WallpaperService"/.test(bare) &&
		/<meta-data[^>]*android:name="android\.service\.wallpaper"[^>]*android:resource="@xml\/wallpaper"/.test(bare),
		'the wallpaper service is declared: BIND_WALLPAPER, the WallpaperService action, its meta-data');
	check(/<uses-feature android:name="android\.software\.live_wallpaper"/.test(bare),
		'uses-feature android.software.live_wallpaper');
	check(!/DreamService|BIND_DREAM_SERVICE/.test(bare), 'no screen saver left: the manifest does not mention DreamService');
	check(!/directBootAware/.test(bare), 'not directBootAware (prefs and the photo are credential-protected)');
	check(!/versionCode|versionName/.test(bare), 'no version in the manifest - VERSION is injected by the build');

	/* one application id: the manifest's package, every Java file's package, $AppId */
	var pkg = (/package="([^"]+)"/.exec(bare) || [])[1];
	var ps1 = exists('tools/build-wallpaper-apk.ps1') ? read('tools/build-wallpaper-apk.ps1') : '';
	var appId = (/^\$AppId = '([^']+)'/m.exec(ps1) || [])[1];
	var javaDir = 'android-wallpaper/java/' + String(pkg).replace(/\./g, '/');
	var javaFiles = exists(javaDir) ?
		fs.readdirSync(path.join(ROOT, javaDir)).filter(function (f) { return /\.java$/.test(f); }) : [];
	var wrongPkg = javaFiles.filter(function (f) { return read(javaDir + '/' + f).indexOf('package ' + pkg + ';') !== 0; });
	check(pkg === 'com.lili.wallpaper' && appId === pkg && javaFiles.length > 0 && !wrongPkg.length,
		'package="com.lili.wallpaper" is $AppId in build-wallpaper-apk.ps1 and every Java file\'s package',
		'manifest ' + pkg + ', $AppId ' + appId + ', ' + javaFiles.length + ' java files' +
		(wrongPkg.length ? ', wrong: ' + wrongPkg.join(' ') : ''));
	var wx = exists('android-wallpaper/res/xml/wallpaper.xml') ? read('android-wallpaper/res/xml/wallpaper.xml') : '';
	check(/android:settingsActivity="com\.lili\.wallpaper\.SettingsActivity"/.test(wx),
		'res/xml/wallpaper.xml names com.lili.wallpaper.SettingsActivity');
})();

/* ================================================================== *
 *  F. The whole page in a fake DOM                                    *
 * ================================================================== */

head('F. Page - the whole bundle, booted in a fake DOM with a fake clock');
(function () {
	function boot(opts) {
		var p = makePage(opts);
		p.played = [];
		p.sandbox.__played = p.played;
		p.run('(function () { var real = Episodes.play; Episodes.play = function (id, done) {' +
			' __played.push({ id: id, at: Date.now() }); return real(id, done); }; })();');
		p.t0 = p.now;
		p.fire('load');
		return p;
	}
	function faults(p) { return p.run('Guard.faults()'); }
	function clean(p) {
		var f = faults(p);
		return f === 0 && !p.uncaught.length ? '' :
			(f + ' faults ' + p.warns.slice(0, 2).join(' | ') + ' ' + p.uncaught.slice(0, 2).join(' | '));
	}
	function running(p) { return p.run('Episodes.running()'); }
	function ids(p, from) { return p.played.slice(from || 0).map(function (x) { return x.id; }).join(', '); }
	/* step until nothing plays; the time it stopped, or 0 */
	function waitIdle(p, limit) {
		var end = p.now + limit;
		while (p.now < end) { p.advance(p.now + 100); if (!running(p)) return p.now; }
		return 0;
	}
	function show(p) { p.run('Wall.show()'); }
	function hide(p) { p.run('Wall.hide()'); }
	function at2(d) { return d.getTime(); }

	/* ---- by day, in a browser tab (no bridge), with the debug overlay on ---- */
	var p = boot({ seed: 55, start: at(2026, 10, 18, 14, 0).getTime() + 15000, config: 'var cat_debug = true;' });
	p.advance(p.t0 + 1000);
	var firstId = running(p);
	check(!!firstId && p.played.length === 1 && p.played[0].at - p.t0 <= 1000 && p.run('Wall.state().hidden') === false,
		'day, no bridge: the page shows itself and an animation starts within a second', firstId || 'nothing running');
	check(p.run('Cat.weather()') === p.run('Sky.current()') && !!p.run('Cat.weather()'),
		'day: the cat received the sky published before it existed (replay)');
	check(p.sandbox.document.documentElement.style.background === p.run('wall_browser_bg'),
		'day, no bridge: the page paints its own background', p.sandbox.document.documentElement.style.background);
	check(!!waitIdle(p, 60000), 'day: the first animation ends', ids(p));

	/* back after 5 s: nothing new */
	var n0 = p.played.length;
	hide(p);
	p.advance(p.now + 5000);
	show(p);
	p.advance(p.now + 3000);
	check(p.played.length === n0 && !running(p), 'shown again after 5 s: nothing new, she carries on', ids(p, n0));

	/* back after 60 s: a new one at once, not the last */
	hide(p);
	p.advance(p.now + 60000);
	var shownAt = p.now;
	show(p);
	p.advance(p.now + 1000);
	var fresh = p.played[n0];
	check(p.played.length === n0 + 1 && fresh.at - shownAt <= 1000 && fresh.id !== p.played[n0 - 1].id,
		'shown again after 60 s: a new animation within a second, not the last one',
		fresh ? fresh.id + ' at +' + (fresh.at - shownAt) + ' ms, last was ' + p.played[n0 - 1].id : 'nothing');

	/* hidden mid-animation for 10 minutes: not one timer */
	p.advance(p.now + 2000);
	var mid = running(p);
	var armed0 = p.armed, fired0 = p.run('Timers.fired()'), n1 = p.played.length, logs0 = p.logs.length;
	hide(p);
	var held = p.run('Timers.pending()');
	p.advance(p.now + 10 * 60000);
	check(!!mid && p.armed === armed0 && p.timers.length === 0 && p.run('Timers.fired()') === fired0 &&
		p.played.length === n1 && p.run('Timers.pending()') === held,
		'hidden 10 minutes: zero timers armed, zero callbacks, nothing played',
		'armed +' + (p.armed - armed0) + ', native pending ' + p.timers.length + ', fired +' +
		(p.run('Timers.fired()') - fired0) + ', ' + held + ' held');
	var back = p.now;
	show(p);
	var showLine = p.logs.slice(logs0).filter(function (l) { return /wall: show after/.test(l); })[0] || '';
	check(/show after 600 s, 0 timers fired while hidden/.test(showLine), 'the show is logged with the time away and 0 timers fired',
		showLine.replace('[LILI] ', ''));
	var ended = waitIdle(p, 60000);
	var still = p.played.length === n1;
	p.advance(ended + 5000);
	var next = p.played[n1];
	check(still && !!ended && !!next && next.at - ended <= 5000 && next.id !== mid,
		'then the frozen one finishes and the next starts within 5 s of its end',
		mid + ' ended +' + Math.round((ended - back) / 1000) + ' s, then ' +
		(next ? next.id + ' +' + (next.at - ended) + ' ms' : 'nothing'));

	/* her idle life between glances */
	waitIdle(p, 60000);
	var n2 = p.played.length;
	p.advance(p.now + 10 * 60000);
	var reps = 0;
	for (var i = n2 + 1; i < p.played.length; i++) if (p.played[i].id === p.played[i - 1].id) reps++;
	check(p.played.length - n2 >= 3 && !reps, 'in view for 10 minutes: she lives on, ' + (p.played.length - n2) +
		' animations, none twice in a row', ids(p, n2));
	var dbg = p.sandbox.document.body.children.filter(function (x) { return x.id === 'cat_debug'; })[0];
	check(!!dbg && /plan wall/.test(dbg.innerHTML) && /next /.test(dbg.innerHTML),
		'the debug overlay runs against the stand-in', dbg ? dbg.innerHTML.split('<br>').slice(5, 8).join(' | ') : 'no overlay');
	check(p.els.cat_stage.style.display !== 'none' && !clean(p), 'day: no faults, no uncaught errors, the cat is still on', clean(p));

	/* ---- with an engine: nothing until it says show() ---- */
	var b = boot({ seed: 56, start: at(2026, 10, 18, 11, 0).getTime(), bridge: { config: '{"size":70,"lift":15}' } });
	b.advance(b.t0 + 3000);
	var waited = b.played.length;
	var st = b.run('Wall.state()');
	show(b);
	b.advance(b.now + 1000);
	check(waited === 0 && st.hidden === true && st.size === 70 && st.lift === 15 && b.played.length === 1 && !clean(b),
		'with a bridge: its config is read, and nothing plays until the engine calls show()',
		'size ' + st.size + ' lift ' + st.lift + ', then ' + ids(b));

	/* an engine flickers visible -> hidden while it is built, so the page's
	 * first word can be hide(): the first show() must still perform (seen on
	 * Android 8, where it did not) */
	var fl = boot({ seed: 57, start: at(2026, 10, 18, 11, 0).getTime(), bridge: {} });
	fl.advance(fl.t0 + 500);
	hide(fl);
	fl.advance(fl.now + 30);
	show(fl);
	fl.advance(fl.now + 1000);
	check(fl.played.length === 1 && !clean(fl), 'with a bridge: hide() before the first show() - that show still performs',
		ids(fl) || 'nothing');

	/* ---- at night ---- */
	var n = boot({ seed: 66, start: at(2026, 10, 18, 2, 0).getTime() + 15000 });
	n.advance(n.t0 + 3000);
	check(!n.played.length && n.run('Anim.tier()') === 'RESTING' && n.run('Wall.state().asleep') === true,
		'boot at 02:00: nothing played, she sleeps, tier RESTING', n.run('Anim.tier()') + ' ' + ids(n));
	hide(n);
	n.advance(n.now + 60000);
	show(n);
	n.advance(n.now + 5000);
	check(!n.played.length && n.run('Anim.tier()') === 'RESTING', 'at 02:00, shown again after a minute: still nothing',
		n.run('Anim.tier()') + ' ' + ids(n));
	hide(n);
	n.advance(at2(at(2026, 10, 18, 7, 30)));
	var morning = n.now;
	show(n);
	n.advance(morning + 2000);
	var woke = n.run('Anim.tier()') !== 'RESTING' && n.run('Wall.state().asleep') === false && !n.played.length;
	n.advance(morning + 4000);
	check(woke && n.played.length === 1 && n.played[0].at - morning >= 2500,
		'hidden 02:00, shown 07:30: she wakes first, then plays',
		n.played.length ? n.played[0].id + ' at +' + (n.played[0].at - morning) + ' ms' : 'nothing');
	check(!clean(n), 'night: no faults, no uncaught errors', clean(n));

	var e = boot({ seed: 67, start: at(2026, 10, 18, 22, 50).getTime() });
	e.advance(e.t0 + 1000);
	waitIdle(e, 60000);
	var ne = e.played.length;
	hide(e);
	e.advance(at2(at(2026, 10, 18, 23, 30)));
	show(e);
	e.advance(e.now + 4000);
	check(ne === 1 && e.played.length === ne && e.run('Anim.tier()') === 'RESTING' && e.run('Wall.state().asleep') === true,
		'hidden 22:50, shown 23:30: she curls up, nothing played', e.run('Anim.tier()') + ' ' + ids(e, ne));
	check(!clean(e), '23:30: no faults', clean(e));

	/* ---- size and height ---- */
	function geo(w, h, cfg) {
		var g = boot({ seed: 80, viewport: [w, h], hash: cfg || '' });
		g.advance(g.t0 + 500);
		var v = g.els.wl_view.style, s = g.els.cat_stage.style, sb = g.els.cat_stage_back.style;
		return { page: g, text: [v.left, v.bottom, v.width, v.height, s.left, s.width, s.height].join(' '),
		         same: sb.left === s.left && sb.width === s.width && sb.height === s.height,
		         fade: /\bfade\b/.test(g.els.wl_view.getAttribute('class') || '') };
	}
	/* typed in from the design: stage = size% of the largest 9:16 box, 15% padding */
	var WANT = {
		'360x640': '40px 141px 280px 384px 32px 216px 384px',
		'360x800': '40px 176px 280px 384px 32px 216px 384px',
		'800x360': '321px 79px 158px 217px 18px 122px 217px'
	};
	Object.keys(WANT).forEach(function (k) {
		var d = k.split('x');
		var g = geo(+d[0], +d[1]);
		check(g.text === WANT[k] && g.same && g.fade && !clean(g.page),
			'place() at 60/22 on ' + k + ': wrapper left bottom width height, stage left width height', g.text);
	});
	var old = geo(360, 640, '#size=100&lift=0');
	check(old.text === '-54px 0px 468px 640px 54px 360px 640px', '#size=100&lift=0 is the old layout: the whole 9:16 box at the bottom',
		old.text);

	var a = geo(360, 640).page;
	var rz = a.dispatched.length;
	a.run('Wall.apply({size: 80, lift: 10})');
	var v = a.els.wl_view.style;
	var moved = [v.left, v.bottom, v.width, v.height, a.els.cat_stage.style.width].join(' ');
	var rig = a.run('Rig.size.w.toFixed(1) + "x" + Rig.size.h.toFixed(1)');
	check(moved === '-7px 64px 374px 512px 288px' && a.dispatched.length === rz + 1 && a.dispatched[rz] === 'resize' &&
		rig === '44.0x32.4' && !clean(a),
		'apply({size:80, lift:10}): the px move, one resize, the rig re-measures, no faults', moved + ', rig ' + rig);
	a.run('Wall.apply({lift: 30})');
	check(a.els.wl_view.style.bottom === '192px' && a.dispatched.length === rz + 1,
		'apply({lift:30}): only the wrapper moves, no resize', a.els.wl_view.style.bottom);
	a.run('Wall.apply({size: 5, lift: 99})');
	check(a.run('Wall.state().size') === 15 && a.run('Wall.state().lift') === 45, 'apply() clamps size to 15-100 and lift to 0-45');
	a.resize(400, 900);
	check(a.els.cat_stage.style.width === '60px' && !clean(a), 'a real resize re-places the stage before the cat measures it',
		a.els.cat_stage.style.width + ' rig ' + a.run('Rig.size.w.toFixed(1)'));

	/* ---- #ep= ---- */
	var ep = boot({ seed: 77, hash: '#ep=snowball' });
	ep.advance(ep.t0 + 1000);
	check(running(ep) === 'snowball', '#ep=snowball plays snowball first', running(ep) || 'nothing');
	waitIdle(ep, 60000);
	hide(ep);
	ep.advance(ep.now + 60000);
	show(ep);
	ep.advance(ep.now + 1000);
	check(ep.played.length === 2 && ep.played[1].id !== 'snowball', '#ep= is honoured by the first animation only', ids(ep));
	var ep2 = boot({ seed: 78, hash: '#ep=no_such_scene' });
	ep2.advance(ep2.t0 + 1000);
	check(!!running(ep2) && running(ep2) !== 'no_such_scene', '#ep= naming nothing falls back to the shuffle', running(ep2));
	check(!clean(ep) && !clean(ep2), '#ep=: no faults', clean(ep) + clean(ep2));

	/* ---- every load a different animation ---- */
	var store = {}, firsts = [];
	for (var k = 0; k < 6; k++) {
		var r = boot({ seed: 100 + k, storage: store, start: at(2026, 10, 18, 10 + k, 7).getTime() });
		r.advance(r.t0 + 1000);
		firsts.push(running(r));
	}
	var dup = firsts.filter(function (x, i) { return !x || firsts.indexOf(x) !== i; });
	check(!dup.length, 'six loads in a row, six different first animations', firsts.join(', '));
})();

/* ================================================================== *
 *  G. The timer gate on its own                                       *
 * ================================================================== */

head('G. Timers - the per-page timer gate, on its own');
(function () {
	function gate() {
		var p = makePage({ upTo: 'src/wallpaper/timers.js' });
		p.sandbox.__log = [];
		p.t0 = p.now;
		p.rel = function () { return p.now - p.t0; };
		return p;
	}

	/* order and timing across a freeze */
	var p = gate();
	p.run('setTimeout(function () { __log.push(["a", Date.now()]); }, 100);' +
	      'setTimeout(function () { __log.push(["b", Date.now()]); }, 300);' +
	      'setTimeout(function () { __log.push(["c", Date.now()]); }, 200);' +
	      'setTimeout(function () { __log.push(["d", Date.now()]); }, 500);' +
	      'setTimeout(function () { __log.push(["e", Date.now()]); }, 500);');
	p.advance(p.t0 + 50);
	p.run('Timers.freeze()');
	var nativeLeft = p.timers.length, armedAtFreeze = p.armed;
	p.advance(p.t0 + 50 + 10 * 60000);
	var frozenFired = p.sandbox.__log.length;
	check(p.run('Timers.frozen()') === true && nativeLeft === 0 && frozenFired === 0 && p.armed === armedAtFreeze &&
		p.run('Timers.pending()') === 5,
		'freeze: every native timer cancelled, nothing armed or fired in 10 minutes, 5 still pending',
		'native ' + nativeLeft + ', fired ' + frozenFired + ', armed +' + (p.armed - armedAtFreeze));
	var thawAt = p.now;
	p.run('Timers.thaw()');
	p.advance(thawAt + 1000);
	var got = p.sandbox.__log.map(function (e) { return e[0] + '+' + (e[1] - thawAt); }).join(' ');
	check(got === 'a+50 c+150 b+250 d+450 e+450', 'thaw: the same order, each with the time it had left', got);
	check(p.run('Timers.pending()') === 0 && p.run('Timers.fired()') === 5 && !p.timers.length,
		'pending() drains to 0, fired() counts 5');

	/* an interval survives */
	var q = gate();
	q.run('var iv = setInterval(function () { __log.push(Date.now()); }, 100);');
	q.advance(q.t0 + 250);
	q.run('Timers.freeze()');
	q.advance(q.t0 + 250 + 5000);
	var during = q.sandbox.__log.length;
	var back = q.now;
	q.run('Timers.thaw()');
	q.advance(back + 260);
	var ticks = q.sandbox.__log.map(function (t) { return t - q.t0; });
	check(during === 2 && ticks.length === 5 && ticks[2] === 5300 && ticks[3] === 5400 && ticks[4] === 5500 &&
		q.run('Timers.pending()') === 1,
		'setInterval: survives a freeze under one id, the next tick after the time it had left', ticks.join(','));
	q.run('clearInterval(iv)');
	q.advance(q.now + 1000);
	check(q.sandbox.__log.length === 5 && q.run('Timers.pending()') === 0 && !q.timers.length, 'clearInterval stops it');

	/* cleared while frozen */
	var c = gate();
	c.run('var x = setTimeout(function () { __log.push("x"); }, 100); Timers.freeze(); clearTimeout(x); Timers.thaw();');
	c.advance(c.t0 + 1000);
	check(!c.sandbox.__log.length && c.run('Timers.pending()') === 0 && !c.timers.length,
		'a timer cleared while frozen never fires');

	/* set while frozen */
	var f = gate();
	var armedBefore = f.armed;
	f.run('Timers.freeze(); setTimeout(function () { __log.push(Date.now()); }, 100);');
	f.advance(f.t0 + 1000);
	var early = f.sandbox.__log.length;
	var armedFrozen = f.armed;
	var t1 = f.now;
	f.run('Timers.thaw()');
	f.advance(t1 + 99);
	var at99 = f.sandbox.__log.length;
	f.advance(t1 + 100);
	check(early === 0 && armedFrozen === armedBefore && at99 === 0 && f.sandbox.__log.length === 1 &&
		f.sandbox.__log[0] - t1 === 100,
		'a timer set while frozen is not armed, and fires its full delay after thaw',
		'early ' + early + ' armed +' + (armedFrozen - armedBefore) + ' at99 ' + at99 + ' log ' + f.sandbox.__log.map(function (t) { return t - t1; }).join());

	/* arguments, odd input */
	var a = gate();
	a.run('setTimeout(function (s, n) { __log.push(s + ":" + n + ":" + (this === window)); }, 10, "x", 2);');
	a.advance(a.t0 + 20);
	check(a.sandbox.__log.join() === 'x:2:true', 'extra arguments are passed through, `this` is window', a.sandbox.__log.join());
	var odd = a.run('(function () { try { clearTimeout(987654); clearTimeout(null); clearTimeout(); return "ok"; }' +
		' catch (e) { return String(e); } })()');
	var ids = a.run('[setTimeout(function () {}, 5), setTimeout(function () {}, 5)]');
	check(odd === 'ok' && ids[0] > 0 && ids[1] === ids[0] + 1,
		'clearTimeout of an unknown id is a no-op; ids are the gate\'s own integers', odd + ' ' + ids.join(','));
	var before = a.armed;
	a.run('Timers.freeze(); Timers.freeze(); Timers.thaw(); Timers.thaw();');
	check(a.run('Timers.frozen()') === false && a.armed === before + 2 && a.timers.length === 2,
		'freeze() and thaw() are idempotent');
})();

/* ================================================================== *
 *  H. Still mode: the lock-screen picture                             *
 * ================================================================== */

head('H. Still - #still=1, the lock-screen picture');
(function () {
	var GARMENTS = ['wCap', 'wWarmHat', 'wPartyHat', 'wSunglasses', 'wScarf', 'wCoat', 'wUmbrella', 'wIceCream', 'wSoda'];
	var KEYS = ['rot', 'x', 'y', 'sx', 'sy', 'o', 'morph'];

	function boot(opts) {
		opts = opts || {};
		var signals = [];
		var p = makePage({
			seed: opts.seed || 1, start: opts.start, hash: '#still=1', viewport: opts.viewport,
			bridge: opts.noBridge ? null : {
				config: opts.config || '{"size":60,"lift":22}',
				stillReady: function (json) { signals.push({ json: String(json), at: p.now }); }
			}
		});
		p.signals = signals;
		p.played = [];
		p.sandbox.__played = p.played;
		p.run('(function () { var real = Episodes.play; Episodes.play = function (id, done) {' +
			' __played.push(id); return real(id, done); }; })();');
		p.t0 = p.now;
		p.fire('load');
		return p;
	}
	function clean(p) {
		var f = p.run('Guard.faults()');
		return f === 0 && !p.uncaught.length ? '' : f + ' faults ' + p.warns.slice(0, 2).join(' | ') + ' ' + p.uncaught.slice(0, 2).join(' | ');
	}
	/* every value the rig would write, the procedural channel too, and where she stands */
	function snapshot(p) {
		var Rig = p.sandbox.Rig, out = [];
		Rig.parts().forEach(function (part) {
			KEYS.forEach(function (k) { out.push(part + '.' + k + '=' + Rig.get(part, k)); });
			['rot', 'x', 'y', 'sx', 'sy'].forEach(function (k) { out.push(part + '+' + k + '=' + Rig.biasOf(part, k)); });
		});
		out.push('world=' + Rig.get('world', 'x') + ',' + Rig.get('world', 'y') + ',' + Rig.facing());
		out.push('holder=' + p.els.cat_holder.style.transform);
		return out.join(';');
	}
	/* garments are on or off, never half-way through a fade */
	function halfDrawn(p) {
		return GARMENTS.filter(function (g) {
			var o = p.sandbox.Rig.get(g, 'o');
			return !(o === null || o === 0 || o === 1);
		}).map(function (g) { return g + '=' + p.sandbox.Rig.get(g, 'o'); });
	}
	function worn(p) {
		var W = p.sandbox.Wardrobe, out = [];
		['head', 'eyes', 'neck', 'body', 'hand'].forEach(function (s) { if (W.wearing(s)) out.push(W.wearing(s)); });
		return out;
	}
	function props(p) { return p.els.cat_props.children.length + p.els.cat_props_back.children.length; }

	var POSES = null;

	/* ---- by day ---- */
	var d = boot({ seed: 201, start: at(2026, 10, 18, 14, 0).getTime() + 15000 });
	POSES = d.run('Still.poses()');
	d.advance(d.t0 + 3000);
	var sig = d.signals[0], st = sig ? JSON.parse(sig.json) : {};
	check(d.signals.length === 1 && st.ready === true && sig.at - d.t0 <= 2200 && st.ms <= 2200,
		'day: PhoneForecast.stillReady(json) is called once, within 2.2 s of load',
		d.signals.length + ' signal(s), at +' + (sig ? sig.at - d.t0 : '-') + ' ms');
	check(POSES.indexOf(st.pose) !== -1 && st.asleep === false && st.settled === true && st.faults === 0,
		'day: a calm pose from the set, every tween finished before the freeze, no faults',
		st.pose + ' of ' + POSES.join('/') + ', settled ' + st.settled + ', ' + st.ms + ' ms');
	var posture = d.run('Actions.posture()');
	check((/^sit|^loaf/.test(st.pose) ? 'SIT' : 'STAND') === posture, 'day: her posture matches the pose', posture);
	check(!d.played.length && d.run('Episodes.running()') === null && !props(d),
		'day: no scene played, none running, no prop on the stage', d.played.join(', '));
	check(d.run('Timers.frozen()') === true && d.timers.length === 0,
		'day: the page is frozen once ready - not one native timer left armed', d.timers.length + ' armed');
	var hd = halfDrawn(d), wd = worn(d);
	var allOn = wd.every(function (g) { return d.sandbox.Rig.get(g, 'o') === 1; });
	check(!hd.length && allOn && st.outfit === (d.run('Wardrobe.current()') || 'plain'),
		'day: the outfit is fully on, nothing half-faded, and the state names it', 'sky ' + st.sky + ', wearing ' + (wd.join(' ') || 'nothing') + (hd.length ? ', half: ' + hd.join(' ') : ''));
	var lo = 6, hi = 100 - d.run('Rig.size.w') - 6;
	check(st.x >= lo && st.x <= hi && d.run("Rig.get('world', 'x')") === st.x && d.run('Rig.facing()') === st.face,
		'day: she stands on the stage at x ' + lo + '..' + Math.round(hi) + ', facing the way the state says',
		'x ' + st.x + ' face ' + st.face);
	check(d.run("Rig.biasOf('pupilL', 'x') === 0 && Rig.biasOf('pupilL', 'y') === 0"),
		'day: Alive moved no eye on its own (no dart, no blink left half-way)');

	var snap = snapshot(d), armed = d.armed, fired = d.run('Timers.fired()');
	d.advance(d.now + 10 * 60000);
	check(snapshot(d) === snap && d.armed === armed && d.run('Timers.fired()') === fired && !d.played.length,
		'day: ten minutes later not one value has changed, no timer armed or fired');
	d.run('Wall.show()');
	d.advance(d.now + 60000);
	d.run('Wall.hide(); Wall.show()');
	d.advance(d.now + 60000);
	check(d.run('Timers.frozen()') === true && snapshot(d) === snap && !d.played.length && d.signals.length === 1,
		'day: Wall.show()/hide() do nothing to a still page (it stays frozen, still one signal)');
	check(!clean(d), 'day: no faults, no uncaught errors', clean(d));

	/* ---- at night: asleep ---- */
	var n = boot({ seed: 202, start: at(2026, 10, 18, 2, 0).getTime() + 15000 });
	n.advance(n.t0 + 3000);
	var ns = n.signals[0] ? JSON.parse(n.signals[0].json) : {};
	check(n.signals.length === 1 && ns.pose === 'asleep' && ns.asleep === true && ns.settled === true && ns.faults === 0,
		'02:00: ready once, asleep, settled', JSON.stringify({ pose: ns.pose, settled: ns.settled, ms: ns.ms }));
	check(n.run('Actions.posture()') === 'SLEEP' && n.run('Wardrobe.current()') === '' && !worn(n).length && !halfDrawn(n).length &&
		GARMENTS.every(function (g) { var o = n.sandbox.Rig.get(g, 'o'); return o === null || o === 0; }),
		'02:00: in her sleeping pose, wearing nothing', n.run('Actions.posture()') + ' ' + worn(n).join(' '));
	check(!n.played.length && !props(n) && n.run('Timers.frozen()') === true && n.timers.length === 0 && !clean(n),
		'02:00: nothing played, no prop, frozen, no faults', clean(n));
	var ns2 = snapshot(n);
	n.advance(n.now + 3 * 3600000);
	check(snapshot(n) === ns2, '02:00: three hours later she has not moved');

	/* ---- many renders: variety, and always the same guarantees ---- */
	var seen = {}, faces = {}, bad = [], dressed = 0;
	for (var i = 0; i < 24; i++) {
		var r = boot({ seed: 300 + i, start: at(2026, i % 12, 10, 9 + (i % 12), 30).getTime() });
		r.advance(r.t0 + 3000);
		var s = r.signals[0] ? JSON.parse(r.signals[0].json) : null;
		if (!s) { bad.push(i + ': no signal'); continue; }
		seen[s.pose] = (seen[s.pose] || 0) + 1;
		faces[s.face] = 1;
		if (POSES.indexOf(s.pose) === -1) bad.push(i + ': pose ' + s.pose);
		if (!s.settled || s.ms > 2200) bad.push(i + ': not settled (' + s.ms + ' ms)');
		if (r.played.length || props(r) || halfDrawn(r).length) bad.push(i + ': played/prop/half-drawn');
		var on = worn(r);
		if (on.length) dressed++;
		if (!on.every(function (gm) { return r.sandbox.Rig.get(gm, 'o') === 1; })) bad.push(i + ': ' + on.join(' ') + ' not fully on');
		if (r.run('Timers.frozen()') !== true || r.timers.length) bad.push(i + ': not frozen');
		if (clean(r)) bad.push(i + ': ' + clean(r));
	}
	check(!bad.length && Object.keys(seen).length >= 4 && faces['1'] && faces['-1'] && dressed >= 3,
		'24 daytime renders: every one ready, settled, frozen, clean, its outfit fully on (' + dressed + ' dressed); ' +
		Object.keys(seen).length + ' different poses, both facings',
		bad.slice(0, 4).join('; ') || Object.keys(seen).map(function (k) { return k + ' x' + seen[k]; }).join(', '));

	/* ---- her size and height from the phone's settings ---- */
	var g = boot({ seed: 210, config: '{"size":45,"lift":30}', viewport: [360, 640] });
	g.advance(g.t0 + 3000);
	check(g.run('Wall.state().size') === 45 && g.run('Wall.state().lift') === 30 &&
		g.els.cat_stage.style.width === '162px' && g.els.wl_view.style.bottom === '192px' && g.signals.length === 1,
		'the size and height the user chose are applied before the picture is taken',
		'stage ' + g.els.cat_stage.style.width + ', ' + g.els.wl_view.style.bottom + ' from the bottom');

	/* ---- in a browser: no bridge ---- */
	var b = boot({ seed: 211, noBridge: true });
	b.advance(b.t0 + 3000);
	var bs = b.run('Still.state()');
	check(bs.ready === true && POSES.concat('asleep').indexOf(bs.pose) !== -1 && b.run('Timers.frozen()') === true &&
		b.sandbox.document.documentElement.style.background === b.run('wall_browser_bg') && !b.played.length && !clean(b),
		'no bridge (a browser): Still.state() says ready, the page paints its own background', bs.pose);

	/* ---- and a normal page is not in still mode ---- */
	var w = makePage({ seed: 212, hash: '#size=60' });
	check(w.run('Still.active()') === false, 'without #still=1 the page is not in still mode');
})();

/* ================================================================== *
 *  I. Settings - colours, strings, the draft                          *
 * ================================================================== */

head('I. Settings - every colour on the settings screen and the preview is legible, every string used, the look written only on Apply, My wallpaper kept, chroma mode ended');
(function () {
	var DIR = 'android-wallpaper/java/com/lili/wallpaper/';
	var file = DIR + 'SettingsActivity.java';
	if (!exists(file)) { note(file + ' not found'); return; }
	var src = read(file);
	var code = codeOnly(src);
	function java(name) { return exists(DIR + name) ? codeOnly(read(DIR + name)) : ''; }
	var preview = java('PreviewActivity.java');

	/* the colour constants, as declared */
	var C = {}, decl = /static final int ([A-Z_]+) = 0x([0-9A-Fa-f]{8});/g, dm, declared = 0;
	while ((dm = decl.exec(code))) { C[dm[1]] = parseInt(dm[2], 16) >>> 0; declared++; }
	var NEED = ['PANEL', 'TEXT', 'TEXT_DIM', 'BUTTON', 'BUTTON_DOWN', 'BUTTON_TEXT', 'BUTTON_OFF', 'BUTTON_OFF_TEXT',
	            'PRIMARY', 'PRIMARY_DOWN', 'EDGE', 'OUTLINE', 'ACCENT', 'KNOB', 'DISABLED', 'DISABLED_ON', 'KNOB_OFF',
	            'DIALOG', 'RIPPLE'];
	var missing = NEED.filter(function (k) { return !(k in C); });
	check(!missing.length, 'SettingsActivity declares every colour it uses as a constant (' + declared + ')',
		missing.length ? 'missing: ' + missing.join(' ') : '');
	if (missing.length) return;

	/* WCAG 2: relative luminance of an opaque colour, contrast of two */
	function chan(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
	function lum(c) { return 0.2126 * chan(c >>> 16 & 255) + 0.7152 * chan(c >>> 8 & 255) + 0.0722 * chan(c & 255); }
	function ratio(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
	/* fg (any alpha) drawn over an opaque bg */
	function over(fg, bg) {
		var a = (fg >>> 24) / 255, out = 0xFF000000;
		for (var s = 0; s <= 16; s += 8) {
			out += Math.round((fg >>> s & 255) * a + (bg >>> s & 255) * (1 - a)) << s;
		}
		return out >>> 0;
	}
	function hex(c) { return '#' + ('00000000' + c.toString(16)).slice(-8).toUpperCase(); }
	function opaque(c) { return (c >>> 24) === 255; }

	/* The settings screen is opaque: no wallpaper shows through any more, so
	 * PANEL is all there is behind its controls. Alpha in it would bring back
	 * whatever is behind the window. */
	check(opaque(C.PANEL), 'PANEL is opaque: nothing shows through the settings screen', hex(C.PANEL));
	var panels = [{ name: 'PANEL', c: over(C.PANEL, 0xFF000000) }];
	function worst(fg, bgs) {
		var w = null;
		bgs.forEach(function (b) {
			var r = ratio(over(fg, b.c), b.c);
			if (!w || r < w.r) w = { r: r, on: b.name };
		});
		return w;
	}
	function one(name, c) { return [{ name: name, c: c }]; }

	/* The preview's buttons sit on her backdrop: white and black stand for the
	 * brightest and the darkest photo, and every preset is there too (its colours
	 * read from Backdrop.java). */
	var BACKDROPS = [{ name: 'white', c: 0xFFFFFFFF }, { name: 'black', c: 0xFF000000 }];
	var bd = java('Backdrop.java');
	var names = (/PRESETS\s*=\s*\{([^}]*)\}/.exec(read(DIR + 'Backdrop.java')) || [])[1] || '';
	names = names.split(',').map(function (s) { return s.replace(/["\s]/g, ''); });
	var cols = [], cre = /\{\s*0x([0-9A-Fa-f]{8})\s*,\s*0x([0-9A-Fa-f]{8})\s*\}/g, cm;
	while ((cm = cre.exec(bd))) cols.push([parseInt(cm[1], 16) >>> 0, parseInt(cm[2], 16) >>> 0]);
	check(names.length === 6 && cols.length === names.length, 'the six presets\' colours read from Backdrop.java',
		names.length + ' names, ' + cols.length + ' colour pairs');
	cols.forEach(function (pair, i) {
		BACKDROPS.push({ name: names[i] + ' (top)', c: pair[0] }, { name: names[i] + ' (bottom)', c: pair[1] });
	});

	/* [what, foreground, backgrounds, minimum]: 4.5 for text, 3 for a control against what is around it */
	var PAIRS = [
		['label text on the panel', 'TEXT', panels, 4.5],
		['dim text (headings, statuses, tips, a disabled switch label) on the panel', 'TEXT_DIM', panels, 4.5],
		['a switch label with the touch ripple over the panel', 'TEXT',
			panels.map(function (p) { return { name: 'RIPPLE over ' + p.name, c: over(C.RIPPLE, p.c) }; }), 4.5],
		['button text on its face', 'BUTTON_TEXT', one('BUTTON', C.BUTTON), 4.5],
		['button text, pressed (face and ripple)', 'BUTTON_TEXT',
			[{ name: 'BUTTON_DOWN', c: C.BUTTON_DOWN }, { name: 'RIPPLE over BUTTON_DOWN', c: over(C.RIPPLE, C.BUTTON_DOWN) }], 4.5],
		['primary button text (Preview with changes waiting, Apply) on its face', 'BUTTON_TEXT', one('PRIMARY', C.PRIMARY), 4.5],
		['primary button text, pressed (face and ripple)', 'BUTTON_TEXT',
			[{ name: 'PRIMARY_DOWN', c: C.PRIMARY_DOWN }, { name: 'RIPPLE over PRIMARY_DOWN', c: over(C.RIPPLE, C.PRIMARY_DOWN) }], 4.5],
		['a disabled button\'s text on its face', 'BUTTON_OFF_TEXT', one('BUTTON_OFF', C.BUTTON_OFF), 4.5],
		['dialog text', 'TEXT', one('DIALOG', C.DIALOG), 4.5],
		['a button\'s outline around it (panel and dialog)', 'EDGE', panels.concat(one('DIALOG', C.DIALOG)), 3],
		['a preview button\'s and the preview panel\'s outline over her backdrop (white, black, every preset)', 'OUTLINE', BACKDROPS, 3],
		['the My wallpaper card\'s text on its face', 'TEXT', one('DIALOG', C.DIALOG), 4.5],
		['"My wallpaper" on the tile\'s label band', 'BUTTON_TEXT', one('BUTTON', C.BUTTON), 4.5],
		['the preview panel\'s notes (on its opaque PANEL face)', 'TEXT_DIM', one('PANEL', C.PANEL), 4.5],
		['a switch track, off, on the panel', 'EDGE', panels, 3],
		['a switch track, on, on the panel', 'ACCENT', panels, 3],
		['the knob on the track, off', 'KNOB', one('EDGE', C.EDGE), 3],
		['the knob on the track, on', 'KNOB', one('ACCENT', C.ACCENT), 3],
		/* a disabled switch (the Lock screen one, mostly): greyed, but on and off still readable */
		['a disabled switch: the knob on its track, off', 'KNOB_OFF', one('DISABLED', C.DISABLED), 3],
		['a disabled switch: the knob on its track, on', 'KNOB_OFF', one('DISABLED_ON', C.DISABLED_ON), 3],
		['a disabled switch: the knob on the panel', 'KNOB_OFF', panels, 3],
		['a slider knob on the panel', 'KNOB', panels, 3]
	];
	PAIRS.forEach(function (p) {
		var w = worst(C[p[1]], p[2]);
		check(w.r >= p[3], 'contrast ' + w.r.toFixed(2) + ' >= ' + p[3] + ': ' + p[0],
			p[1] + ' ' + hex(C[p[1]]) + ', worst on ' + w.on);
	});
	/* Opaque faces: a button's text is then read against its face alone, never
	 * against what is behind it - the preview's buttons over a bright photo or black. */
	var FACES = ['BUTTON', 'BUTTON_DOWN', 'BUTTON_OFF', 'PRIMARY', 'PRIMARY_DOWN'];
	var thin = FACES.filter(function (k) { return !opaque(C[k]); });
	check(!thin.length, 'every button face is opaque, so a preview button\'s text reads the same over any backdrop',
		thin.join(' '));

	/* nothing coloured from anywhere else */
	var hexes = code.match(/0x[0-9A-Fa-f]{8}\b/g) || [];
	check(hexes.length === declared, 'no colour literal outside the constant block',
		(hexes.length - declared) + ' more');
	var COLOR_SRC = /\bColor\.(?!TRANSPARENT\b)\w+|\bR\.color\.\w+|\bgetColor(StateList)?\(|android\.R\.attr\.\w*[cC]olor\w*/g;
	var otherColor = code.match(COLOR_SRC) || [];
	check(!otherColor.length, 'no theme, resource or Color.* colour (Color.TRANSPARENT only)', otherColor.join(' '));
	var viewAlpha = code.match(/\.setAlpha\(\s*[\d.]+f\s*\)/g) || [];
	check(!viewAlpha.length, 'no view alpha that would dim text below what is checked here', viewAlpha.join(' '));
	check(!/AlertDialog/.test(code), 'no AlertDialog (its colours come from the theme): the dialogs are our own panel');

	/* every control comes from one factory, and the factory colours it */
	function bodyIn(text, sig) {
		var at = text.indexOf(sig);
		if (at < 0) return '';
		var open = text.indexOf('{', at), depth = 0;
		for (var i = open; i < text.length; i++) {
			if (text[i] === '{') depth++;
			else if (text[i] === '}' && --depth === 0) return text.slice(open, i + 1);
		}
		return '';
	}
	function body(sig) { return bodyIn(code, sig); }
	/* [control, its factory, more bodies that colour it, what they must call] */
	var FACTORIES = [
		['Button', 'static Button button(Context', ['static void paint(Button b, boolean primary, boolean'],
			['paint(', 'setTextColor(', 'setBackground(', 'setBackgroundTintList(null)']],
		['Switch', 'static Switch toggle(Context', [], ['setTextColor(', 'setThumbDrawable(', 'setTrackDrawable(', 'setBackground(']],
		['SeekBar', 'private SeekBar slider(', [], ['setProgressTintList(', 'setProgressBackgroundTintList(', 'setThumbTintList(']],
		['TextView', 'static TextView text(Context', [], ['setTextColor(']]
	];
	FACTORIES.forEach(function (f) {
		var n = (code.match(new RegExp('new ' + f[0] + '\\(', 'g')) || []).length;
		var b = body(f[1]);
		var all = b + f[2].map(body).join('');
		var lacks = f[3].filter(function (call) { return all.indexOf(call) < 0; });
		check(n === 1 && b.indexOf('new ' + f[0] + '(') >= 0 && !lacks.length,
			'every ' + f[0] + ' is made by ' + f[1].replace(/^(private |static )+/, '').replace(/\(.*$/, '()') + ', which colours it',
			(n !== 1 ? n + ' made; ' : '') + (b ? '' : 'factory not found; ') + (lacks.length ? 'lacks ' + lacks.join(' ') : ''));
	});
	check(/scroll\.setBackgroundColor\(PANEL\)/.test(code) && /box\.setBackground\(rounded\(DIALOG/.test(code) &&
		/\.setBackgroundDrawable\(new ColorDrawable\(PANEL\)\)/.test(body('protected void onCreate(')),
		'the window, the panel and the dialogs are painted with PANEL and DIALOG');

	/* The preview's controls: the settings screen's factories, its buttons painted
	 * for a backdrop, its panel opaque with the backdrop outline; nothing of its own. */
	var pControls = preview.match(/new (Button|TextView|Switch|SeekBar|CheckBox|ToggleButton|RadioButton)\(/g) || [];
	var pHex = preview.match(/0x[0-9A-Fa-f]{6,8}\b/g) || [];
	var pColor = preview.match(COLOR_SRC) || [];
	var pButtons = (preview.match(/SettingsActivity\.button\(/g) || []).length;
	var pPaint = preview.match(/SettingsActivity\.paint\(\s*\w+\s*,\s*[^,()]+\s*,\s*true\s*\)/g) || [];
	var pPlain = preview.match(/SettingsActivity\.paint\(\s*\w+\s*,\s*[^,()]+\s*\)|SettingsActivity\.paint\([^)]*,\s*false\s*\)/g) || [];
	var buttonVars = [], bre = /(\w+)\s*=\s*SettingsActivity\.button\(/g, bv;
	while ((bv = bre.exec(preview))) buttonVars.push(bv[1]);
	var unpainted = buttonVars.filter(function (v) {
		return !new RegExp('SettingsActivity\\.paint\\(\\s*' + v + '\\s*,[^,()]+,\\s*true\\s*\\)').test(preview);
	});
	check(preview.length > 0 && !pControls.length && !pHex.length && !pColor.length && !/\.setAlpha\(/.test(preview) &&
		pButtons >= 2 && buttonVars.length === pButtons && !unpainted.length && !pPlain.length,
		'PreviewActivity\'s ' + pButtons + ' buttons come from SettingsActivity.button(), every one painted over a backdrop; no control or colour of its own',
		(pControls.concat(pHex, pColor, pPlain).join(' ') || '') + (unpainted.length ? ' not painted for a backdrop: ' + unpainted.join(' ') : ''));
	var pSwitches = (preview.match(/SettingsActivity\.toggle\(/g) || []).length;
	check(pSwitches === 3 && /SettingsActivity\.text\(/.test(preview) &&
		/\.setBackground\(SettingsActivity\.panelOverBackdrop\(this\)\)/.test(preview) &&
		/rounded\(PANEL,/.test(body('static Drawable panelOverBackdrop(')) &&
		/setStroke\(px\(c, 2\), OUTLINE\)/.test(body('static Drawable panelOverBackdrop(')),
		'the preview\'s panel: its three switches (Home, Lock, Show icons) and its notes from the factories, on opaque PANEL with the 2 dp OUTLINE',
		pSwitches + ' switches');

	/* The settings screen is not a wallpaper window any more. */
	var themes = exists('android-wallpaper/res/values/themes.xml') ? read('android-wallpaper/res/values/themes.xml') : '';
	var style = (/<style name="LiliSettings"[^>]*?(\/>|>[\s\S]*?<\/style>)/.exec(themes) || [''])[0];
	var parent = (/parent="([^"]+)"/.exec(style) || [])[1] || '';
	check(!!style && parent.length > 0 && !/Wallpaper/i.test(parent) &&
		!/windowShowWallpaper">\s*true/.test(style) && /windowShowWallpaper">\s*false/.test(style) &&
		!/FLAG_SHOW_WALLPAPER/.test(code),
		'LiliSettings is not a wallpaper theme (parent ' + parent + ', windowShowWallpaper false); no FLAG_SHOW_WALLPAPER');
	var man = read('android-wallpaper/AndroidManifest.xml').replace(/<!--[\s\S]*?-->/g, '');
	check(/<activity[^>]*android:name="\.SettingsActivity"[^>]*android:theme="@style\/LiliSettings"/.test(man),
		'the manifest gives SettingsActivity the LiliSettings theme');

	/* ---- the draft: nothing reaches prefs, the wallpaper or the lock picture until Apply ---- */
	var files = fs.readdirSync(path.join(ROOT, DIR)).filter(function (f) { return /\.java$/.test(f); });
	var lookCode = java('Look.java');
	var LOOK_KEYS = 'BG_KIND|BG_PRESET|BG_DIM|BG_REV|SIZE|LIFT';
	var writes = new RegExp('\\.(put\\w+|remove)\\(\\s*(?:Prefs\\.)?(' + LOOK_KEYS + ')\\b', 'g');
	var rawWrites = /\.(put\w+|remove)\(\s*"(bg_\w*|size|lift)"/g;
	var toPrefsBody = bodyIn(lookCode, 'void toPrefs(');
	var stray = [];
	files.forEach(function (f) {
		var c = java(f), outside = f === 'Look.java' ? c.replace(toPrefsBody, '') : c;
		(outside.match(writes) || []).forEach(function (m) { stray.push(f + ': ' + m); });
		/* a key spelt out instead of named; Look's own Bundle keys are not prefs */
		var raw = read(DIR + f);
		if (f === 'Look.java') raw = raw.replace(bodyIn(raw, 'Bundle toBundle('), '');
		(raw.match(rawWrites) || []).forEach(function (m) { stray.push(f + ': ' + m); });
	});
	check(!!toPrefsBody && (toPrefsBody.match(writes) || []).length === 6 && (toPrefsBody.match(/\.apply\(\)/g) || []).length === 1 &&
		!stray.length,
		'the look keys (bg_*, size, lift) are written only in Look.toPrefs(), all six in one apply()',
		stray.join(', '));

	var commitBody = body('private boolean commit(Look');
	var calls = function (re) {
		var out = [];
		files.forEach(function (f) { (java(f).match(re) || []).forEach(function () { out.push(f); }); });
		return out;
	};
	var toPrefsCalls = calls(/\.toPrefs\(/g), adoptCalls = calls(/Backdrop\.adoptDraft\(/g),
	    lockCalls = calls(/LockPicture\.requestSoon\(/g);
	check(!!commitBody && toPrefsCalls.length === 1 && /\.toPrefs\(/.test(commitBody) &&
		adoptCalls.length === 1 && /Backdrop\.adoptDraft\(/.test(commitBody),
		'SettingsActivity.commit() is the only caller of toPrefs() and Backdrop.adoptDraft(): the look is written on Apply only',
		'toPrefs from ' + (toPrefsCalls.join(' ') || 'nowhere') + ', adoptDraft from ' + (adoptCalls.join(' ') || 'nowhere'));
	check(lockCalls.length === 1 && /LockPicture\.requestSoon\(/.test(commitBody) &&
		!/requestSoon/.test(body('onSharedPreferenceChanged(')),
		'the legacy lock picture is re-rendered once per Apply (from commit(), not per changed key)',
		lockCalls.join(' '));

	/* the photo: the settings screen imports into the draft file, never straight into bg.jpg */
	var allJava = files.map(java).join('\n');
	check(/DRAFT_FILE = "bg_draft\.jpg"/.test(read(DIR + 'Backdrop.java')) &&
		/Backdrop\.importPhoto\(\s*app\s*,\s*uri\s*,\s*dst\s*\)/.test(code) &&
		/final File dst = Backdrop\.draftFile\(app\)/.test(code) &&
		!/importPhoto\(\s*\w+\s*,\s*\w+\s*\)/.test(allJava),
		'a chosen photo is imported into files/bg_draft.jpg (Backdrop.draftFile), never straight into bg.jpg');
	var bdCode = java('Backdrop.java');
	check(/static Bitmap photo\(Context context, Look look\)/.test(bdCode) &&
		/look\.draftPhoto\)\s*return decode\(context, DRAFT, look\.stamp\)/.test(bdCode) &&
		/return decode\(context, APPLIED, Prefs\.of\(context\)\.getInt\(Prefs\.BG_REV/.test(bdCode),
		'the decoded photo is kept per file and revision: the wallpaper\'s bg.jpg by bg_rev, the draft by its stamp');

	/* the preview of a draft draws that draft and does not listen to prefs */
	var lv = java('LiliView.java');
	check(/follows = still == null && look == null;/.test(lv) &&
		(lv.match(/\bregisterOnSharedPreferenceChangeListener\(/g) || []).length === 1 &&
		/if \(follows\) \{?\s*prefs\.registerOnSharedPreferenceChangeListener\(this\)/.test(lv) &&
		/look != null \? look\.pageConfig\(\)/.test(lv) && /callbacks != null \? callbacks\.config\(\)/.test(java('LiliWeb.java')),
		'a LiliView given a Look registers no prefs listener, and its page boots with the look\'s size and height');

	/* the preview never writes; Apply hands the look back, Cancel and Back change nothing */
	check(!/\.edit\(\)|toPrefs\(|Prefs\.of\(|adoptDraft|dropDraft|HomeShot\.save|Original\.(obtain|fromPhoto)/.test(preview) &&
		/setResult\(RESULT_OK, out\)/.test(bodyIn(preview, 'private void apply()')) &&
		/look\.into\(out\)/.test(bodyIn(preview, 'private void apply()')) &&
		/setResult\(RESULT_CANCELED\)/.test(bodyIn(preview, 'private void cancel()')) &&
		/cancel\(\)/.test(bodyIn(preview, 'public void onBackPressed()')),
		'PreviewActivity writes nothing: Apply returns RESULT_OK with the look, Cancel and Back RESULT_CANCELED');

	/* settings: the draft survives a recreation, a fresh open starts from prefs, Back asks */
	var onCreate = body('protected void onCreate(');
	check(/out\.putBundle\(STATE_DRAFT, draft\.toBundle\(\)\)/.test(code) &&
		/Look\.fromBundle\(state\.getBundle\(STATE_DRAFT\)\)/.test(onCreate) &&
		/draft = saved;/.test(onCreate) && /Backdrop\.dropDraft\(app\)/.test(onCreate) &&
		/askLeave\(\)/.test(body('public void onBackPressed()')) &&
		/R\.string\.apply\b/.test(body('private void askLeave()')) && /R\.string\.discard\b/.test(body('private void askLeave()')) &&
		/R\.string\.keep_editing\b/.test(body('private void askLeave()')),
		'the draft is kept across a recreation, a fresh open starts from prefs (a leftover draft photo deleted), Back with changes asks Apply / Discard / Keep editing');

	/* strings: none left over from the old screen, the same names in Russian */
	var STR = 'android-wallpaper/res/values/strings.xml', RU = 'android-wallpaper/res/values-ru/strings.xml';
	function strNames(f) {
		var out = [], re = /<string name="([a-z_0-9]+)"/g, m;
		var s = exists(f) ? read(f) : '';
		while ((m = re.exec(s))) out.push(m[1]);
		return out;
	}
	var en = strNames(STR), ru = strNames(RU);
	var javaAll = files.map(function (f) { return read(DIR + f); }).join('\n');
	var xmlAll = read('android-wallpaper/AndroidManifest.xml') + read('android-wallpaper/res/xml/wallpaper.xml');
	var unused = en.filter(function (k) {
		return !new RegExp('R\\.string\\.' + k + '\\b').test(javaAll) && xmlAll.indexOf('@string/' + k + '"') < 0;
	});
	check(en.length > 0 && !unused.length, en.length + ' strings, every one used', unused.join(' '));
	var NAMES_ONLY_EN = ['app_name', 'wallpaper_name'];
	var notRu = en.filter(function (k) { return NAMES_ONLY_EN.indexOf(k) < 0 && ru.indexOf(k) < 0; });
	var notEn = ru.filter(function (k) { return en.indexOf(k) < 0; });
	check(!notRu.length && !notEn.length, 'values-ru has the same strings (the app name stays "Lili")',
		(notRu.length ? 'not in ru: ' + notRu.join(' ') : '') + (notEn.length ? ' only in ru: ' + notEn.join(' ') : ''));
	var GONE = ['where_both', 'where_tip', 'restore_home', 'restore_lock', 'restore_photo', 'forget', 'previous_heading',
	            'lock_failed', 'settings_active', 'apply_and_set', 'screen_previous'];
	var back = GONE.filter(function (k) { return en.indexOf(k) >= 0 || new RegExp('R\\.string\\.' + k + '\\b').test(javaAll); });
	check(!back.length, 'the old mode buttons, the restore section, the see-through status line, "Apply and set as wallpaper" ' +
		'and the switches\' "previous wallpaper" line are gone (strings and code)', back.join(' '));
	check(!/EXTRA_SET_HOME/.test(javaAll) && (code.match(/\btoggle\(/g) || []).length === 1,
		'the settings screen has no switch of its own any more (they are the preview\'s plan); no "set as wallpaper" extra');

	/* The lock-screen picture is blocked: nothing may turn lock mode on. Prefs.migrate()
	 * only carries an existing one over from an earlier build, and LockPicture and
	 * LockJob stay in the tree for that phone and for the feature to come back. */
	var javaCode = codeOnly(javaAll);
	check(!/LOCK_ON\s*,\s*true\b/.test(javaCode) && !/LockPicture\.request\(/.test(code) &&
		exists(DIR + 'LockPicture.java') && exists(DIR + 'LockJob.java'),
		'nothing turns lock mode on (no LOCK_ON true, no picture asked for from the settings screen); LockPicture and LockJob kept');

	/* ---- the plan: the preview's switches decide nothing until Apply ---- */
	var previewedBody = body('private void previewed(');
	check(/private boolean planHome = true;/.test(preview) &&
		/out\.putExtra\(EXTRA_HOME, planHome\)/.test(bodyIn(preview, 'private void apply()')) &&
		/out\.putExtra\(EXTRA_LOCK_OFF, planLockOff\)/.test(bodyIn(preview, 'private void apply()')) &&
		/lockSwitch\.setEnabled\(offable\)/.test(preview) &&
		/boolean offable = lockState != SettingsActivity\.L_PREVIOUS && !withHome;/.test(preview) &&
		!/homeOn\(|homeOff\(|lockOff\(|Backup\.|LockPicture\.|WallpaperManager/.test(preview) &&
		/if \(!commit\(look\)\) return;/.test(previewedBody) &&
		previewedBody.indexOf('commit(look)') < previewedBody.indexOf('continuePlan()') &&
		previewedBody.indexOf('commit(look)') < previewedBody.indexOf('lockOff()'),
		'the preview\'s switches are a plan (Home starts on, Lock only turns an old picture off; nothing acts before Apply); the settings screen carries it out after committing the look');

	/* ---- My wallpaper: files/original.jpg is never deleted, replaced or written over ---- */
	var origSrc = exists(DIR + 'Original.java') ? read(DIR + 'Original.java') : '';
	var origCode = java('Original.java');
	var literalAt = files.filter(function (f) { return /"original\.jpg"/.test(read(DIR + f)); });
	var fileRefs = files.filter(function (f) { return f !== 'Original.java' && /\bOriginal\.FILE\b/.test(java(f)); });
	var harm = [];
	files.forEach(function (f) {
		var c = java(f), names = [], bm;
		/* every variable that holds the kept file */
		var bindRe = f === 'Original.java' ? /(\w+)\s*=\s*(?:Original\.)?file\(/g : /(\w+)\s*=\s*Original\.file\(/g;
		while ((bm = bindRe.exec(c))) names.push(bm[1]);
		names.forEach(function (n) {
			var re = new RegExp('\\b' + n + '\\.(delete|deleteOnExit|renameTo|setWritable)\\(|' +
				'\\b(importPhoto|replace|rename|write|copyFile|copyDrawable|save)\\([^;]*\\b' + n + '\\b|' +
				'FileOutputStream\\(\\s*' + n + '\\b', 'g');
			(c.match(re) || []).forEach(function (m) { harm.push(f + ': ' + m); });
		});
		/* the file itself, unnamed; and anything that sweeps the files directory */
		(c.match(/Original\.file\([^)]*\)\s*\.(delete|renameTo|deleteOnExit)\(|\bdeleteFile\(|\blistFiles\(|\b(importPhoto|replace|rename|write)\([^;]*Original\.file\(/g) || [])
			.forEach(function (m) { harm.push(f + ': ' + m); });
	});
	var keepBody = bodyIn(origCode, 'private static void keep(');
	var guarded = keepBody.indexOf('if (kept.isFile())'), into = keepBody.indexOf('.renameTo(kept)');
	check(literalAt.length === 1 && literalAt[0] === 'Original.java' && /static final String FILE = "original\.jpg";/.test(origSrc) &&
		fileRefs.length === 1 && fileRefs[0] === 'Backdrop.java' && /new Slot\(Original\.FILE\)/.test(java('Backdrop.java')) &&
		!harm.length && guarded >= 0 && into > guarded && (allJava.match(/\.renameTo\(\s*kept\s*\)/g) || []).length === 1,
		'files/original.jpg is never deleted, replaced or written over: named once, only decoded and read, renamed into only when there is none',
		harm.join(', ') || '');
	var origWrites = calls(/\.put\w+\(\s*Prefs\.ORIG_AT\b/g);
	check(origWrites.length === 1 && origWrites[0] === 'Original.java' &&
		!/Original\.(obtain|fromPhoto)\(/.test(java('Backdrop.java') + java('LiliView.java') + java('LiliWallpaper.java')),
		'orig_at (My wallpaper kept) is written once, by Original; only the settings screen asks for the picture',
		origWrites.join(' '));
	var bk = java('Backup.java');
	check(/if \(Original\.have\(app\)\) return ORIGINAL;/.test(bodyIn(bk, 'static int homePlan(')) &&
		/case ORIGINAL:\s*setPicture\(app, Original\.file\(app\), lock\);/.test(bk) &&
		/plan == Backup\.PICTURE \|\| plan == Backup\.ORIGINAL/.test(body('private void homeOff()')),
		'Home off with no home backup puts My wallpaper back (Backup.ORIGINAL) before it asks');
	var lookCodeNow = java('Look.java');
	check(/Prefs\.kind\(p\)/.test(bodyIn(lookCodeNow, 'static Look fromPrefs(')) &&
		/if \(k == null\) return hasOriginal\(p\) \? KIND_ORIGINAL : KIND_PRESET;/.test(java('Prefs.java')) &&
		/\|\| !prefs\.contains\(Prefs\.BG_KIND\)/.test(body('private boolean commit(Look')),
		'My wallpaper is the default look only until the first Apply (no bg_kind yet); every Apply records its look');

	/* ---- the preview's drawn icons: muted mid-tones that read over any backdrop ---- */
	var iv = java('IconsView.java');
	var M = {}, mre = /static final int (MOCK_[A-Z_]+) = 0x([0-9A-Fa-f]{8});/g, mm, mDeclared = 0;
	while ((mm = mre.exec(iv))) { M[mm[1]] = parseInt(mm[2], 16) >>> 0; mDeclared++; }
	var FILL_NAMES = Object.keys(M).filter(function (k) { return !/^MOCK_(TEXT|SHADOW|GLYPH)$/.test(k); });
	var mockOk = iv.length > 0 && ['MOCK_TEXT', 'MOCK_SHADOW', 'MOCK_GLYPH'].every(function (k) { return k in M; }) &&
		FILL_NAMES.length >= 5;
	check(mockOk, 'IconsView declares the mock\'s colours as constants (' + mDeclared + ', ' + FILL_NAMES.length + ' fills)');
	if (mockOk) {
		var weakFill = [], weakGlyph = [];
		FILL_NAMES.forEach(function (k) {
			var wf = null, wg = null;
			BACKDROPS.forEach(function (b) {
				var f = over(M[k], b.c), r = ratio(f, b.c), g = ratio(over(M.MOCK_GLYPH, f), f);
				if (!wf || r < wf.r) wf = { r: r, on: b.name };
				if (!wg || g < wg.r) wg = { r: g, on: b.name };
			});
			if (wf.r < 3) weakFill.push(k + ' ' + wf.r.toFixed(2) + ' on ' + wf.on);
			if (wg.r < 3) weakGlyph.push(k + ' ' + wg.r.toFixed(2) + ' on ' + wg.on);
		});
		check(!weakFill.length, 'contrast >= 3: every mock icon, the folder and the search pill against white, black and every preset',
			weakFill.join(', '));
		check(!weakGlyph.length, 'contrast >= 3: the mark inside each icon, on it, over any backdrop', weakGlyph.join(', '));
		var darkBds = BACKDROPS.filter(function (b) { return b.name !== 'white'; });
		var tw = worst(M.MOCK_TEXT, darkBds), th = ratio(M.MOCK_TEXT, over(M.MOCK_SHADOW, 0xFFFFFFFF));
		check(tw.r >= 4.5 && th >= 4.5, 'contrast ' + tw.r.toFixed(2) + ' >= 4.5: the mock\'s light labels on the darkest backdrop (' + tw.on +
			'), and ' + th.toFixed(2) + ' on their own dark halo over white', 'MOCK_TEXT ' + hex(M.MOCK_TEXT) + ', MOCK_SHADOW ' + hex(M.MOCK_SHADOW));
	}
	var ivHex = iv.match(/0x[0-9A-Fa-f]{6,8}\b/g) || [];
	var ivColor = iv.match(COLOR_SRC) || [];
	check(iv.length > 0 && ivHex.length === mDeclared && !ivColor.length && !/\.setAlpha\(/.test(iv),
		'no colour in IconsView outside its constants (no other literal, no theme, resource or Color.*, no alpha)',
		(ivHex.length - mDeclared) + ' more literals ' + ivColor.join(' '));

	/* ---- chroma mode: only the capture turns it on, and it always ends, in a finally ---- */
	var capJava = java('CaptureActivity.java');
	function blocksAfter(text, re) {
		var out = [], m;
		while ((m = re.exec(text))) {
			var open = text.indexOf('{', m.index), depth = 0;
			for (var i = open; i < text.length; i++) {
				if (text[i] === '{') depth++;
				else if (text[i] === '}' && --depth === 0) { out.push(text.slice(open, i + 1)); break; }
			}
		}
		return out;
	}
	var onCalls = calls(/Chroma\.set\(\s*true\s*\)/g);
	var offAll = (allJava.match(/Chroma\.set\(\s*false\s*\)/g) || []).length;
	var offInFinally = blocksAfter(capJava, /\bfinally\s*\{/g).reduce(function (n, b) {
		return n + (b.match(/Chroma\.set\(\s*false\s*\)/g) || []).length;
	}, 0);
	var safetyRun = (/private final Runnable safety = new Runnable\(\) \{([\s\S]*?)\};/.exec(capJava) || [])[1] || '';
	check(onCalls.length === 1 && onCalls[0] === 'CaptureActivity.java' && offAll >= 1 && offAll === offInFinally &&
		/finally\s*\{\s*Chroma\.set\(\s*false\s*\)/.test(bodyIn(capJava, 'private void release()')) &&
		/SAFETY_MS = 5000;/.test(capJava) && /postDelayed\(safety, SAFETY_MS\)/.test(capJava) && /\bfail\(/.test(safetyRun) &&
		/\brelease\(\)/.test(bodyIn(capJava, 'private void fail(')) && /\brelease\(\)/.test(bodyIn(capJava, 'protected void onDestroy(')) &&
		/\brelease\(\)/.test(bodyIn(capJava, 'private void take()')) &&
		capJava.indexOf('postDelayed(safety, SAFETY_MS)') < capJava.indexOf('Chroma.set(true)'),
		'chroma mode: on only in CaptureActivity, after its 5 s safety timeout is armed; off only in a finally (release()), which a frame, every failure, the timeout and onDestroy reach',
		onCalls.join(' ') + '; ' + offInFinally + ' of ' + offAll + ' "off" in a finally');
	var cKey = (/static final int KEY = 0x([0-9A-Fa-f]{8});/.exec(java('Chroma.java')) || [])[1];
	check(cKey && cKey.toUpperCase() === 'FFFF00FF' && /follows && Chroma\.on\(\)\) canvas\.drawColor\(Chroma\.KEY\)/.test(lv) &&
		/Chroma\.on\(\)\) c\.drawColor\(Chroma\.KEY\)/.test(java('LiliWallpaper.java')),
		'the key is pure magenta (#FF00FF), drawn by the wallpaper\'s views and by an engine drawing flat; the preview of a draft never keys');
})();

console.log('\n' + '='.repeat(70));
console.log(pass + ' passed, ' + fail + ' failed' + (notes ? ', ' + notes + ' notes' : ''));
console.log('='.repeat(70) + '\n');
process.exit(fail ? 1 : 0);
