/* check-saver.js - the screen saver, offline.
 *
 *   node tools/check-saver.js
 *
 * Loads the REAL sources - the module list comes from tools/saver-modules.js,
 * the config from the same functions tools/build-saver.js injects - into a vm
 * sandbox. Only the browser is faked: a DOM that remembers what it was told, a
 * clock that can be wound forward, a localStorage, a seeded Math.random. No
 * network, no device.
 *
 *   A  Sky        the invented weather: shape, seasons, night, redraws
 *   B  Shuffle    which animation next: reachability, fairness, history
 *   C  Plan       the stand-in for cat/plan.js: gaps, re-arming, sky changes
 *   D  Contract   what the saver leans on in shared code that main may change
 *   E  Built      saver.html and the Android manifest (skipped if not built)
 *   F  Page       the whole bundle booted in a fake DOM: first animation, the
 *                 quiet-hours hand-over, day and night, #ep=, the overlay
 *
 * After a merge from main, a failure in D, E or F means main changed something
 * the saver leans on: fix it in src/saver/, not in the shared file.          */

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var SaverModules = require('./saver-modules.js');
var Build = require('./build-saver.js');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };
var exists = function (p) { return fs.existsSync(path.join(ROOT, p)); };

var MODULES = SaverModules.list();

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
 * saver's own block, exactly as the build stacks them. Hemisphere is pinned so
 * the result does not depend on the timezone of the machine running this. */
var CONFIG = Build.catConfig() + '\n' + Build.saverConfig() +
	"\nvar cat_build = 'check';\nvar saver_hemisphere = 'north';";

var STAGE_W = 360, STAGE_H = 640;

function makePage(opts) {
	opts = opts || {};
	var RealDate = Date;
	var page = {
		now: opts.start || new RealDate(2026, 10, 18, 14, 0, 0).getTime(),
		timers: [], seq: 0, logs: [], warns: [], uncaught: [], listeners: {}, bridge: [],
		storage: opts.storage || {}
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
	var svg = node();
	var ELS = {
		cat_stage:      node({ offsetWidth: STAGE_W, offsetHeight: STAGE_H }),
		cat_stage_back: node({ offsetWidth: STAGE_W, offsetHeight: STAGE_H }),
		cat_holder:     node({ offsetWidth: STAGE_W * 0.44, offsetHeight: STAGE_H * 0.324,
		                       getElementsByTagName: function () { return [svg]; } }),
		cat_props:      node(),
		cat_props_back: node(),
		cat_hit:        node(),
		sv_clock:       node(),
		sv_time:        node()
	};
	page.els = ELS;

	function addTimer(fn, ms, every) {
		var id = ++page.seq;
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
		navigator: { userAgent: 'check-saver Chrome/69.0.0.0' },
		location: { hash: hash, href: 'file:///android_asset/saver.html' + hash },
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
			addEventListener: function () {},
			body: node()
		},
		addEventListener: function (ev, fn) { (page.listeners[ev] = page.listeners[ev] || []).push(fn); }
	};
	if (opts.bridge) {
		sandbox.PhoneForecast = {
			host: function () { return 'check'; },
			sdk: function () { return 26; },
			is24h: function () { return opts.bridge.is24h !== false; },
			night: function (on) { page.bridge.push({ on: !!on, at: page.now }); }
		};
	}
	sandbox.window = sandbox;

	var ctx = vm.createContext(sandbox);
	page.ctx = ctx;
	page.run = function (code) { return vm.runInContext(code, ctx); };
	page.sandbox = sandbox;

	page.run(CONFIG + '\n' + (opts.config || ''));
	var last = opts.upTo ? MODULES.indexOf(opts.upTo) : MODULES.length - 1;
	if (last === -1) throw new Error('no module ' + opts.upTo + ' in the saver list');
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
	page.fire = function (ev) {
		(page.listeners[ev] || []).forEach(function (fn) {
			try { fn({}); } catch (e) { page.uncaught.push(String(e && e.stack || e)); }
		});
	};
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
function saverModules() { return MODULES.filter(function (m) { return m.indexOf('src/saver/') === 0; }); }

/* ------------------------------------------------------------------ *
 *  shared fixtures                                                    *
 * ------------------------------------------------------------------ */

var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/* the design's table (docs/SCREENSAVER.md), typed in separately on purpose */
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
	var p = makePage({ upTo: 'src/saver/plan-random.js', seed: 11 });
	var Sky = p.sandbox.Sky;
	var kinds = Sky.kinds();
	check(kinds.length === 11, 'eleven kinds', kinds.join(' '));

	/* every field, with the types weather.js would give it */
	var bad = [];
	kinds.forEach(function (k) {
		var w = Sky.make(k, at(2026, 0, 15, 12));
		REQUIRED.forEach(function (f) { if (!w.hasOwnProperty(f)) bad.push(k + ' has no ' + f); });
		if (w.code !== 'saver:' + k) bad.push(k + ': code ' + w.code);
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
		p.run("saver_hemisphere = '" + h + "'");
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
		p.run("saver_hemisphere = '" + hemi + "'");
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
	p.run("saver_hemisphere = 'north'");
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
	p.run("saver_hemisphere = 'auto'");
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
	var p = makePage({ upTo: 'src/saver/plan-random.js', seed: 22, storage: store });
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
	 * one exactly as Saver.begin() does it. One in ten falls on a day a
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
	var p2 = makePage({ upTo: 'src/saver/plan-random.js', seed: 23, storage: store });
	check(JSON.stringify(p2.sandbox.Shuffle.seen()) === JSON.stringify(seen),
		'history survives a restart (through Store and localStorage)');
	check(p2.sandbox.Store.persistent() === true, 'Store used localStorage, not its memory fallback');
})();

/* ================================================================== *
 *  C. Plan stand-in                                                   *
 * ================================================================== */

head('C. Plan - the stand-in for cat/plan.js');
(function () {
	var p = makePage({ upTo: 'src/saver/plan-random.js', seed: 33 });
	p.run('var Cat = { weather: function () { return Sky.current(); } };');
	var Plan = p.sandbox.Plan, Sky = p.sandbox.Sky;
	Plan.init(function () { return p.sandbox.Episodes.planLibrary(); });
	var cfg = p.run('[saver_gap_min, saver_gap_max, saver_sky_every]');
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

	/* the sky changes on every fifth arming, and only then */
	var emitsAt = [], kinds = [];
	var p2 = makePage({ upTo: 'src/saver/plan-random.js', seed: 34 });
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
	check(st.day === 'saver' && st.total === ids.length && st.done === ids.length && st.missed === 0 &&
		st.substituted === 0 && typeof st.byId === 'object' && st.unique > 0,
		'stats() has the fields the overlay reads', JSON.stringify({ total: st.total, unique: st.unique }));
})();

/* ================================================================== *
 *  D. Contract with shared code                                       *
 * ================================================================== */

head('D. Contract - what the saver leans on in shared code');
var BUILT = exists('saver.html') ? read('saver.html') : null;
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

	/* every bare cat_ / app_ / saver_ name used is declared in the page */
	var declared = {};
	var source = BUILT || CONFIG;
	var dre = /^var ((?:cat|app|saver)_[a-z0-9_]+)\s*=/gm, d;
	while ((d = dre.exec(source))) declared[d[1]] = 1;
	var undeclared = {}, names = {};
	MODULES.forEach(function (m) {
		var code = codeOnly(read(m)), re = /(^|[^\w$.])((?:cat|app|saver)_[a-z0-9_]+)\b/g, x;
		while ((x = re.exec(code))) {
			names[x[2]] = 1;
			if (!declared[x[2]]) undeclared[x[2]] = m;
		}
	});
	var und = Object.keys(undeclared);
	check(!und.length, 'every cat_/app_/saver_ global the bundle uses is declared in ' +
		(BUILT ? 'saver.html' : 'the assembled config'),
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

	/* the shared calls the saver makes */
	var api = ['Cat.init', 'Cat.play', 'Cat.weather', 'Episodes.running', 'Episodes.find', 'Episodes.planLibrary',
	           'Bus.on', 'Bus.emit', 'Guard.run', 'Guard.fault', 'Store.getJSON', 'Store.setJSON',
	           'inClockWindow', 'addClass', 'removeClass', 'byId', 'pad', 'on', 'LOG'];
	var gone = api.filter(function (n) { return p.run('typeof ' + n) !== 'function'; });
	check(!gone.length, 'the shared functions the saver calls all exist', gone.join(', '));

	/* ES5 in everything the saver adds to the page */
	var es6 = [];
	saverModules().forEach(function (m) {
		var code = codeOnly(read(m));
		if (/(^|[^\w$.])(let|const|class)\s/.test(code)) es6.push(m + ': let/const/class');
		if (/=>/.test(code)) es6.push(m + ': arrow function');
		if (/`/.test(code)) es6.push(m + ': template literal');
	});
	check(!es6.length, 'src/saver/*.js is ES5 (no let/const/class, arrows or template literals)', es6.join(', '));
})();

/* ================================================================== *
 *  E. Built artefacts                                                 *
 * ================================================================== */

head('E. Built - saver.html and the Android manifest');
(function () {
	if (!BUILT) {
		note('saver.html is not built - run node tools/build-saver.js to check it');
	} else {
		check(!/yandex/i.test(BUILT), 'saver.html never mentions yandex');
		check(!/^var api(_url)?\s*=/m.test(BUILT), 'saver.html declares no API key config (var api / api_url)');
		check(!/#wx_stale|id="wx_stale"/.test(BUILT), 'saver.html has no #wx_stale badge');
		check(!/<!--INJECT:/.test(BUILT), 'every INJECT marker was filled');
		check(!/<!doctype/i.test(BUILT), 'no doctype - quirks mode, like the informer');
		check(/^var cat_build = '[^']+';$/m.test(BUILT), 'the build stamp is there');
		var banners = MODULES.filter(function (m) { return BUILT.indexOf('/* ==================== ' + m + ' ') === -1; });
		check(!banners.length, 'every module in the saver list is in the page', banners.join(', '));
		var scripts = [], re = /<script>([\s\S]*?)<\/script>/g, m;
		while ((m = re.exec(BUILT))) scripts.push(m[1]);
		var syntax = [];
		scripts.forEach(function (s, i) { try { new vm.Script(s); } catch (e) { syntax.push('script ' + i + ': ' + e.message); } });
		check(scripts.length >= 3 && !syntax.length, scripts.length + ' script blocks, all parse', syntax.join('; '));
		var asset = exists('android-saver/assets/saver.html') ? read('android-saver/assets/saver.html') : null;
		check(asset === BUILT, 'android-saver/assets/saver.html is the same page');
	}

	var man = exists('android-saver/AndroidManifest.xml') ? read('android-saver/AndroidManifest.xml') : null;
	if (!man) { note('android-saver/AndroidManifest.xml not found'); return; }
	var bare = man.replace(/<!--[\s\S]*?-->/g, '');
	check(!/<uses-permission/.test(bare), 'the manifest requests no permissions at all');
	check(/android:permission="android\.permission\.BIND_DREAM_SERVICE"/.test(bare) &&
		/android\.service\.dreams\.DreamService/.test(bare), 'the dream service is declared, bound by BIND_DREAM_SERVICE');
	check(/package="com\.lili\.saver"/.test(bare), 'the manifest\'s package (the Java namespace) is com.lili.saver');
	check(!/versionCode|versionName/.test(bare), 'no version in the manifest - VERSION is injected by the build');
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
	function waitIdle(p, limit) {
		var end = p.now + limit;
		while (p.now < end) { p.advance(p.now + 500); if (!running(p) && p.run('Saver.handedOver()')) return true; }
		return false;
	}
	function pct(t, re) { var m = re.exec(t || ''); return m ? m.slice(1).map(Number) : null; }

	/* ---- by day, with the debug overlay on ---- */
	var p = boot({ seed: 55, start: at(2026, 10, 18, 14, 0).getTime() + 15000, config: 'var cat_debug = true;' });
	p.advance(p.t0 + 1000);
	var firstId = running(p);
	check(!!firstId && p.played.length === 1 && p.played[0].at - p.t0 <= 1000,
		'day: an animation starts within a second of load', firstId || 'nothing running');
	check(p.run('Cat.weather()') === p.run('Sky.current()') && !!p.run('Cat.weather()'),
		'day: the cat received the sky published before it existed (replay)');
	check(/^\d\d:\d\d$/.test(p.els.sv_time.textContent) && p.els.sv_time.textContent === '14:00',
		'day: the clock shows the time, 24-hour in a browser', p.els.sv_time.textContent);
	check(waitIdle(p, 60000), 'day: the first animation ends and the sleep window is handed over',
		p.run('cat_quiet_from + "-" + cat_quiet_to'));
	check(p.run('cat_quiet_from') === '23:00' && p.run('Saver.asleep()') === false,
		'day: 23:00-07:00 is live, and at 14:00 she stays awake');
	p.advance(p.t0 + 5 * 60000);
	var in5 = p.played.length;
	check(in5 >= 2, 'day: more animations in the first five minutes', in5 + ' in all: ' +
		p.played.map(function (x) { return x.id; }).join(', '));
	p.sandbox.__kinds = [];
	p.run('Bus.on("weather", function (w) { __kinds.push(w.code); })');
	p.advance(p.t0 + 40 * 60000);
	var codes = p.sandbox.__kinds.filter(function (c, i, all) { return i === 0 || all[i - 1] !== c; });
	check(codes.length >= 1, 'day: the sky (and so her outfit) changes while she lives on', codes.join(' -> '));
	var reps = 0;
	for (var i = 1; i < p.played.length; i++) if (p.played[i].id === p.played[i - 1].id) reps++;
	check(p.played.length >= 8 && !reps, 'day: ' + p.played.length + ' animations in 40 minutes, none twice in a row',
		p.played.map(function (x) { return x.id; }).join(', '));
	var ct = pct(p.els.sv_clock.style.transform, /translate\(([-\d.]+)%,([-\d.]+)%\)/);
	var st = pct(p.els.cat_stage.style.transform, /translateX\(([-\d.]+)%\)/);
	var sb = p.els.cat_stage_back.style.transform;
	check(!!ct && Math.abs(ct[0]) <= 4 && Math.abs(ct[1]) <= 4 && !!st && Math.abs(st[0]) <= 1.5 &&
		sb === p.els.cat_stage.style.transform &&
		/^translate\([-\d.]+px,[-\d.]+px\) scale/.test(p.els.cat_holder.style.transform || ''),
		'day: the clock and the stage drift within bounds; the holder is left to the rig',
		p.els.sv_clock.style.transform + '  ' + p.els.cat_stage.style.transform);
	var dbg = p.sandbox.document.body.children.filter(function (n) { return n.id === 'cat_debug'; })[0];
	check(!!dbg && /plan saver/.test(dbg.innerHTML) && /next /.test(dbg.innerHTML),
		'day: the debug overlay runs against the stand-in', dbg ? dbg.innerHTML.split('<br>').slice(5, 8).join(' | ') : 'no overlay');
	check(p.els.cat_stage.style.display !== 'none' && !clean(p), 'day: no faults, no uncaught errors, the cat is still on', clean(p));

	/* ---- at night: one animation, then sleep, then morning ---- */
	var n = boot({ seed: 66, start: at(2026, 10, 18, 2, 0).getTime() + 15000, bridge: { is24h: false } });
	n.advance(n.t0 + 1000);
	check(!!running(n), 'night: an animation starts within a second, even at 02:00', running(n) || 'nothing');
	check(n.els.sv_time.textContent === '2:00', 'night: 12-hour clock when the phone says so', n.els.sv_time.textContent);
	waitIdle(n, 60000);
	n.advance(n.now + 3000);
	var cls = n.els.sv_clock.getAttribute('class') || '';
	check(n.run('Saver.asleep()') === true && /\bsleeping\b/.test(cls) &&
		n.bridge.length === 1 && n.bridge[0].on === true,
		'night: after it she sleeps, the clock dims, the backlight is asked down', 'class "' + cls + '", bridge ' + JSON.stringify(n.bridge));
	check(n.run('Anim.tier()') === 'RESTING', 'night: the frame loop rests', n.run('Anim.tier()'));
	var nightPlays = n.played.length;
	n.advance(at(2026, 10, 18, 6, 58).getTime());
	check(n.played.length === nightPlays && !running(n), 'night: nothing more until morning',
		n.played.slice(nightPlays).map(function (x) { return x.id; }).join(', '));
	n.advance(at(2026, 10, 18, 7, 2).getTime());
	check(n.run('Saver.asleep()') === false && !/\bsleeping\b/.test(n.els.sv_clock.getAttribute('class') || '') &&
		n.bridge.length === 2 && n.bridge[1].on === false,
		'night: at 07:00 she wakes, the clock and backlight come back', JSON.stringify(n.bridge));
	n.advance(at(2026, 10, 18, 7, 12).getTime());
	check(n.played.length > nightPlays, 'night: and the animations resume', (n.played.length - nightPlays) + ' since 07:00');
	check(!clean(n), 'night: no faults, no uncaught errors', clean(n));

	/* ---- #ep= ---- */
	var e = boot({ seed: 77, hash: '#ep=snowball' });
	e.advance(e.t0 + 1000);
	check(running(e) === 'snowball', '#ep=snowball plays snowball first', running(e) || 'nothing');
	var e2 = boot({ seed: 78, hash: '#ep=no_such_scene' });
	e2.advance(e2.t0 + 1000);
	check(!!running(e2) && running(e2) !== 'no_such_scene', '#ep= naming nothing falls back to the shuffle', running(e2));
	check(!clean(e) && !clean(e2), '#ep=: no faults', clean(e) + clean(e2));

	/* ---- every dream start a different animation ---- */
	var store = {}, firsts = [];
	for (var k = 0; k < 6; k++) {
		var r = boot({ seed: 100 + k, storage: store, start: at(2026, 10, 18, 10 + k, 7).getTime() });
		r.advance(r.t0 + 1000);
		firsts.push(running(r));
	}
	var dup = firsts.filter(function (x, i) { return !x || firsts.indexOf(x) !== i; });
	check(!dup.length, 'six dream starts in a row, six different first animations', firsts.join(', '));
})();

console.log('\n' + '='.repeat(70));
console.log(pass + ' passed, ' + fail + ' failed' + (notes ? ', ' + notes + ' notes' : ''));
console.log('='.repeat(70) + '\n');
process.exit(fail ? 1 : 0);
