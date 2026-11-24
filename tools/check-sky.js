/* check-sky.js - does the sky block hold together, without a phone?
 *
 *   node tools/check-sky.js
 *
 * Loads the REAL src/core/dom.js, weather.js and sky.js into a sandbox and fakes
 * only the browser: a DOM built from the ids in src/informer.base.html that
 * remembers every attribute it is given, two canvases that remember every call,
 * and a clock that can be wound forward. Nothing here touches the network.
 *
 * What it proves:
 *   - the arc: where the sun or moon is at a given minute, day or night, which
 *     corner says what, before sunrise, after sunset, with no tomorrow
 *   - the moon's lit shape for moon_code 0, 4, 8, 12 (and its side)
 *   - Yandex icon code -> clouds, what falls and how hard, and the forcing rules
 *   - the windsock: finite, bounded, and straight from 7.7 m/s
 *   - no NaN, undefined or Infinity reaches an svg attribute or a canvas call,
 *     even fed nonsense
 *   - the loop: 20 fps while something falls, 12 otherwise, a still frame in
 *     the quiet hours, nothing while hidden or with no data, a preview that
 *     ends by itself, rain that stops on an umbrella
 *   - sky.js never references the cat
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var pass = 0, fail = 0;
function ok(name, cond, detail) {
	console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail !== undefined && detail !== '' ? '   ' + detail : ''));
	if (cond) pass++; else fail++;
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }
function section(s) { console.log('\n' + s); }

/* ------------------------------------------------------------------ *
 *  a clock that can be wound forward                                  *
 * ------------------------------------------------------------------ */

var REAL_NOW = Date.now();
var offset = 0;                 /* wall clock = REAL_NOW + offset */
var mono = 0;                   /* performance.now() */
var timers = [], seq = 0;

function fakeSetTimeout(fn, ms) {
	var id = ++seq;
	timers.push({ id: id, at: mono + Math.max(0, ms || 0), fn: fn });
	return id;
}
function fakeClearTimeout(id) {
	for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; }
}
/* run every timer due in the next `ms`, in order; returns how many ran */
function advance(ms) {
	var to = mono + ms, ran = 0;
	for (;;) {
		var best = -1;
		for (var i = 0; i < timers.length; i++) {
			if (timers[i].at > to) continue;
			if (best === -1 || timers[i].at < timers[best].at) best = i;
		}
		if (best === -1) break;
		var t = timers.splice(best, 1)[0];
		if (t.at > mono) { offset += t.at - mono; mono = t.at; }
		t.fn();
		ran++;
	}
	offset += to - mono;
	mono = to;
	return ran;
}

var RealDate = Date;
function FakeDate(a, b, c, d, e, f, g) {
	var n = arguments.length;
	if (!(this instanceof FakeDate)) return new RealDate(REAL_NOW + offset).toString();
	var x = n === 0 ? new RealDate(REAL_NOW + offset)
		: n === 1 ? new RealDate(a)
		: new RealDate(a, b, c === undefined ? 1 : c, d || 0, e || 0, f || 0, g || 0);
	Object.setPrototypeOf(x, FakeDate.prototype);
	return x;
}
FakeDate.prototype = Object.create(RealDate.prototype);
FakeDate.prototype.constructor = FakeDate;
FakeDate.now = function () { return REAL_NOW + offset; };
FakeDate.UTC = RealDate.UTC;
FakeDate.parse = RealDate.parse;

/* ------------------------------------------------------------------ *
 *  a DOM that remembers what it was told                              *
 * ------------------------------------------------------------------ */

var base = read('src/informer.base.html');
var MARKUP_IDS = {};
base.replace(/\sid="([^"]+)"/g, function (m, id) { MARKUP_IDS[id] = true; return m; });

var badAttrs = [];              /* every attribute write that carried NaN & co */
var missingIds = [];
var SCREEN = { w: 360, h: 640 };          /* px; 1vw = 3.6px */
var VW = SCREEN.w / 100;

function bad(v) { return /NaN|undefined|Infinity|null/.test(String(v)); }

function Node(tag, id) {
	this.tagName = tag;
	this.id = id || '';
	this.attrs = {};
	this.style = {};
	this.children = [];
	this.parentNode = null;
	this.textContent = '';
	this.className = '';
	this.listeners = {};
}
Node.prototype.setAttribute = function (k, v) {
	v = String(v);
	if (bad(v)) badAttrs.push((this.id || this.tagName) + '.' + k + '="' + v + '"');
	this.attrs[k] = v;
	if (k === 'class') this.className = v;
};
Node.prototype.setAttributeNS = function (ns, k, v) { this.setAttribute(k, v); };
Node.prototype.getAttribute = function (k) {
	if (k === 'class') return this.className;
	return this.attrs.hasOwnProperty(k) ? this.attrs[k] : null;
};
Node.prototype.hasAttribute = function (k) { return this.attrs.hasOwnProperty(k); };
Node.prototype.appendChild = function (c) { this.children.push(c); c.parentNode = this; return c; };
Node.prototype.removeChild = function (c) {
	var i = this.children.indexOf(c);
	if (i !== -1) this.children.splice(i, 1);
	c.parentNode = null;
	return c;
};
Object.defineProperty(Node.prototype, 'firstChild', { get: function () { return this.children[0] || null; } });
Node.prototype.addEventListener = function (ev, fn) { (this.listeners[ev] = this.listeners[ev] || []).push(fn); };
Node.prototype.getBoundingClientRect = function () {
	if (this.tagName === 'canvas') return { left: 0, top: 0, width: SCREEN.w, height: SCREEN.h };
	if (this.id === 'sky_svg') return { left: 0, top: 54 * VW, width: 100 * VW, height: 53 * VW };
	return { left: 0, top: 0, width: 0, height: 0 };
};

/* a 2D context that counts what it is asked to do */
function Ctx(name) {
	this.name = name;
	this.calls = {};
	this.badArgs = [];
	this.fillStyle = ''; this.strokeStyle = ''; this.lineWidth = 1; this.globalAlpha = 1; this.lineCap = 'butt';
}
['clearRect', 'beginPath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'stroke', 'fill', 'closePath'].forEach(function (m) {
	Ctx.prototype[m] = function () {
		this.calls[m] = (this.calls[m] || 0) + 1;
		for (var i = 0; i < arguments.length; i++) {
			var a = arguments[i];
			if (typeof a !== 'number' || a !== a || !isFinite(a)) { this.badArgs.push(m + '(' + Array.prototype.join.call(arguments, ',') + ')'); break; }
		}
		if (this.lineWidth !== this.lineWidth || this.globalAlpha !== this.globalAlpha) this.badArgs.push(m + ' with NaN style');
	};
});
Ctx.prototype.reset = function () { this.calls = {}; };

var ELS = {};
function byIdFake(id) {
	if (ELS[id]) return ELS[id];
	if (!MARKUP_IDS[id]) { missingIds.push(id); return null; }
	var tag = /^sky_(back|front)$/.test(id) ? 'canvas' : (id === 'sky_svg' ? 'svg' : 'node');
	var n = new Node(tag, id);
	if (tag === 'canvas') {
		n.width = 300; n.height = 150;
		var ctx = new Ctx(id);
		n.getContext = function () { return ctx; };
		n.ctx = ctx;
	}
	ELS[id] = n;
	return n;
}

var docListeners = {};
var document = {
	hidden: false,
	body: new Node('body', 'body'),
	getElementById: byIdFake,
	createElementNS: function (ns, tag) { return new Node(tag); },
	createElement: function (tag) { return new Node(tag); },
	querySelector: function () { return null; },
	querySelectorAll: function () { return []; },
	addEventListener: function (ev, fn) { (docListeners[ev] = docListeners[ev] || []).push(fn); }
};
function fireDoc(ev) { (docListeners[ev] || []).forEach(function (fn) { fn({}); }); }

var logs = [];
var sandbox = {
	console: { log: function (s) { logs.push(String(s)); }, warn: function () {}, error: function () {} },
	Math: Math, Date: FakeDate, JSON: JSON, Number: Number, String: String, Object: Object,
	isFinite: isFinite, isNaN: isNaN, parseFloat: parseFloat,
	setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
	performance: { now: function () { return mono; } },
	devicePixelRatio: 3,
	document: document,
	addEventListener: function () {},
	/* what weather.js talks to besides the sky */
	View: { update: function () {}, data: function () { return null; } },
	Bus: { emit: function () {}, on: function () {} },
	Store: (function () {
		var m = {};
		return {
			getJSON: function (k) { return m[k] ? JSON.parse(m[k]) : null; },
			setJSON: function (k, v) { m[k] = JSON.stringify(v); },
			get: function (k) { return m[k] || null; }, set: function (k, v) { m[k] = v; }
		};
	})(),
	getJSON: function () { throw new Error('no network in here'); }
};
sandbox.window = sandbox;

var ctx = vm.createContext(sandbox);
var config = base.split('\n').filter(function (l) { return /^var [a-z_]+ *=/.test(l); }).join('\n');
vm.runInContext(config, ctx, { filename: 'config' });
['src/core/dom.js', 'src/core/weather.js', 'src/core/sky.js'].forEach(function (m) {
	vm.runInContext(read(m), ctx, { filename: m });
});
var Sky = sandbox.Sky, Weather = sandbox.Weather;

console.log('\n' + '='.repeat(66));
console.log('the sky block - src/core/sky.js');
console.log('='.repeat(66));

/* ================================================================== *
 *  the arc                                                           *
 * ================================================================== */

section('the arc: sun and moon, day and night, the corners');

var RISE = 8 * 60 + 41, SET = 16 * 60 + 52, RISE_TOM = 8 * 60 + 43, SET_YEST = 16 * 60 + 53;
var days3 = { prev: { rise: 8 * 60 + 39, set: SET_YEST }, today: { rise: RISE, set: SET, moon: 13 }, next: { rise: RISE_TOM, set: 16 * 60 + 51 } };

var w = Sky.where(12 * 60, days3);
ok('12:00 is day', w && w.day === true);
ok('  f = (now - rise) / (set - rise)', w && near(w.f, (720 - RISE) / (SET - RISE)), w && w.f.toFixed(4));
ok('  left corner sunrise 08:41, right sunset 16:52',
	w && w.left === 'rise' && w.right === 'set' && Sky.clockStr(w.leftM) === '08:41' && Sky.clockStr(w.rightM) === '16:52');

w = Sky.where(RISE, days3);
ok('at sunrise f = 0, on the left foot of the arc', w && w.day && near(w.f, 0));
var p0 = Sky.onArc(0), pm = Sky.onArc(0.5), p1 = Sky.onArc(1);
ok('  onArc(0) = (5, 43), onArc(0.5) = (50, 6), onArc(1) = (95, 43)',
	near(p0.x, 5) && near(p0.y, 43) && near(pm.x, 50) && near(pm.y, 6) && near(p1.x, 95) && near(p1.y, 43),
	'(' + p0.x.toFixed(1) + ',' + p0.y.toFixed(1) + ') (' + pm.x.toFixed(1) + ',' + pm.y.toFixed(1) + ') (' + p1.x.toFixed(1) + ',' + p1.y.toFixed(1) + ')');

w = Sky.where(SET - 1, days3);
ok('a minute before sunset is still day, f near 1', w && w.day && w.f > 0.99 && w.f < 1);

w = Sky.where(SET, days3);
ok('at sunset it is night, f = 0', w && !w.day && near(w.f, 0));
ok('  corners swap: left sunset 16:52, right TOMORROW\'s sunrise 08:43',
	w && w.left === 'set' && w.right === 'rise' && Sky.clockStr(w.leftM) === '16:52' && Sky.clockStr(w.rightM) === '08:43');

w = Sky.where(23 * 60, days3);
var nightLen = 1440 - SET + RISE_TOM;
ok('23:00 is night, f = (now - sunset) / (night length)', w && !w.day && near(w.f, (1380 - SET) / nightLen), w && w.f.toFixed(4));

w = Sky.where(3 * 60, days3);
var lenB = 1440 - SET_YEST + RISE;
ok('03:00 is night, measured from YESTERDAY\'s sunset', w && !w.day && near(w.f, (180 + 1440 - SET_YEST) / lenB), w && w.f.toFixed(4));
ok('  left corner yesterday\'s sunset 16:53, right today\'s sunrise 08:41',
	w && w.left === 'set' && Sky.clockStr(w.leftM) === '16:53' && w.right === 'rise' && Sky.clockStr(w.rightM) === '08:41');

w = Sky.where(RISE - 1, days3);
ok('a minute before sunrise f is near 1', w && !w.day && w.f > 0.99 && w.f <= 1);

var noTomorrow = { prev: null, today: { rise: RISE, set: SET }, next: null };
w = Sky.where(22 * 60, noTomorrow);
ok('no tomorrow in the file: the night ends at today\'s sunrise', w && !w.day && Sky.clockStr(w.rightM) === '08:41' &&
	near(w.f, (1320 - SET) / (1440 - SET + RISE)));
w = Sky.where(2 * 60, noTomorrow);
ok('no yesterday in the file: the night began at today\'s sunset', w && !w.day && Sky.clockStr(w.leftM) === '16:52' &&
	near(w.f, (120 + 1440 - SET) / (1440 - SET + RISE)));

ok('no sunrise or sunset: nothing to place', Sky.where(600, { today: { rise: -1, set: -1 } }) === null &&
	Sky.where(600, { today: null }) === null);

var mono2 = true;
for (var m = 0; m < 1440; m += 7) {
	var ww = Sky.where(m, days3);
	if (!ww || !(ww.f >= 0 && ww.f <= 1)) mono2 = false;
}
ok('every minute of the day gives 0 <= f <= 1', mono2);

/* the day is found by its date, not by its place in the file */
var dd = [{ date: '2026-11-23', rise: 520, set: 1013 }, { date: '2026-11-24', rise: RISE, set: SET }, { date: '2026-11-25', rise: RISE_TOM, set: 1011 }];
var pick = Sky.pickDays(dd, new RealDate(2026, 10, 24, 12, 0));
ok('pickDays finds today by date, with yesterday and tomorrow', pick.today === dd[1] && pick.prev === dd[0] && pick.next === dd[2]);
pick = Sky.pickDays(dd, new RealDate(2026, 11, 30, 12, 0));
ok('  a file that does not reach today falls back to its first day', pick.today === dd[0] && pick.prev === null);

/* ================================================================== *
 *  the moon                                                          *
 * ================================================================== */

section('the moon (moon_code: 0 full, 4 last quarter, 8 new, 12 first quarter)');

/* The lit shape is two half-ellipse arcs between the poles. Read them back and
 * integrate the lit width over the height: its area and where its middle is. */
function moonShape(d, r) {
	if (!d) return { area: 0, cx: 0 };
	var m = d.match(/A([\d.]+),([\d.]+) 0 0 ([01]) 0,(-?[\d.]+)/g);
	if (!m || m.length !== 2) return null;
	var arcs = m.map(function (s) {
		var q = s.match(/A([\d.]+),([\d.]+) 0 0 ([01]) 0,(-?[\d.]+)/);
		var rx = +q[1], sweep = +q[3], toY = +q[4];
		/* top->bottom with sweep 1 goes round the right; bottom->top with sweep 1 round the left */
		var down = toY > 0;
		var side = (down ? (sweep ? 1 : -1) : (sweep ? -1 : 1));
		return { rx: rx, side: side };
	});
	var area = 0, mom = 0, N = 400;
	for (var i = 0; i < N; i++) {
		var y = -r + (i + 0.5) * 2 * r / N;
		var k = Math.sqrt(Math.max(0, 1 - (y / r) * (y / r)));
		var x1 = arcs[0].side * arcs[0].rx * k, x2 = arcs[1].side * arcs[1].rx * k;
		var wdt = Math.abs(x1 - x2);
		area += wdt * 2 * r / N;
		mom += wdt * (x1 + x2) / 2 * 2 * r / N;
	}
	return { area: area, cx: area ? mom / area : 0 };
}
var R = 4.3, DISC = Math.PI * R * R;
var full = moonShape(Sky.moonPath(R, 0), R);
ok('0 full: the whole disc lit', full && near(full.area / DISC, 1, 0.02) && near(full.cx, 0, 0.05),
	full && (full.area / DISC * 100).toFixed(1) + '% lit');
var lq = moonShape(Sky.moonPath(R, 4), R);
ok('4 last quarter: half lit, on the LEFT', lq && near(lq.area / DISC, 0.5, 0.02) && lq.cx < -1,
	lq && (lq.area / DISC * 100).toFixed(1) + '% lit, centre x ' + lq.cx.toFixed(2));
ok('8 new: nothing lit (empty path)', Sky.moonPath(R, 8) === '');
var fq = moonShape(Sky.moonPath(R, 12), R);
ok('12 first quarter: half lit, on the RIGHT', fq && near(fq.area / DISC, 0.5, 0.02) && fq.cx > 1,
	fq && (fq.area / DISC * 100).toFixed(1) + '% lit, centre x ' + fq.cx.toFixed(2));
var wc = moonShape(Sky.moonPath(R, 10), R), wg = moonShape(Sky.moonPath(R, 14), R);
ok('10 waxing crescent is a thin right-hand sliver, 14 waxing gibbous most of the disc',
	wc && wg && wc.cx > 0 && wc.area < 0.5 * DISC && wg.area > 0.5 * DISC,
	wc && wg && (wc.area / DISC * 100).toFixed(0) + '% / ' + (wg.area / DISC * 100).toFixed(0) + '%');
var allOk = true;
for (var c = 0; c < 16; c++) { var d = Sky.moonPath(R, c); if (bad(d)) allOk = false; }
ok('all 16 codes give a clean path', allOk);
ok('no code, or nonsense: no lit part', Sky.moonPath(R, -1) === '' && Sky.moonPath(R, NaN) === '' && Sky.moonPath(R, undefined) === '');

/* ================================================================== *
 *  icon code -> sky                                                  *
 * ================================================================== */

section('Yandex icon code -> clouds, what falls, how hard');

function sc(code, cl) { var s = Sky.scene(code, cl); return s.cover + '/' + s.precip + '/' + s.level + (s.storm ? '/storm' : '') + (s.grey ? '/grey' : ''); }
var CASES = [
	['skc_d', null, 'clear/none/0'],
	['skc_n', null, 'clear/none/0'],
	['bkn_d', 0.25, 'few/none/0'],
	['bkn_n', 0.5, 'some/none/0'],
	['bkn_d', null, 'some/none/0'],
	['ovc', 1, 'ovc/none/0/grey'],
	['bkn_-ra_d', 0.25, 'some/rain/0/grey'],       /* rain from one cloud gets two */
	['bkn_ra_d', 0.5, 'some/rain/1/grey'],
	['bkn_+ra_d', 0.5, 'ovc/rain/2/grey'],         /* heavy forces overcast */
	['ovc_-ra', 1, 'ovc/rain/0/grey'],
	['ovc_ra', 1, 'ovc/rain/1/grey'],
	['ovc_+ra', 1, 'ovc/rain/2/grey'],
	['bkn_-sn_d', 0.5, 'some/snow/0/grey'],
	['ovc_sn', 1, 'ovc/snow/1/grey'],
	['ovc_+sn', 1, 'ovc/snow/2/grey'],
	['bkn_+sn_n', 0.75, 'ovc/snow/2/grey'],
	['ovc_ra_sn', 1, 'ovc/sleet/1/grey'],
	['ovc_ts', 1, 'ovc/rain/2/storm/grey'],        /* a storm is heavy rain */
	['ovc_ts_ra', 1, 'ovc/rain/2/storm/grey'],
	['', null, 'clear/none/0']
];
CASES.forEach(function (k) {
	var got = sc(k[0], k[1]);
	ok((k[0] || '(none)') + (k[1] !== null ? ' cloudness ' + k[1] : '') + ' -> ' + k[2], got === k[2], got === k[2] ? '' : 'got ' + got);
});

var cnt = Sky.counts;
ok('how much falls: rain 40/95/170, snow 60/120/220',
	cnt('rain', 0).rain === 40 && cnt('rain', 1).rain === 95 && cnt('rain', 2).rain === 170 &&
	cnt('snow', 0).snow === 60 && cnt('snow', 1).snow === 120 && cnt('snow', 2).snow === 220);
var sl = cnt('sleet', 1);
ok('  sleet is 55% of the rain and 40% of the snow', sl.rain === Math.round(95 * 0.55) && sl.snow === Math.round(120 * 0.4),
	sl.rain + ' drops + ' + sl.snow + ' flakes');
ok('  nothing falls for none', cnt('none', 1).rain === 0 && cnt('none', 1).snow === 0);

/* ================================================================== *
 *  the windsock                                                      *
 * ================================================================== */

section('the windsock');

var finite = true, bounded = true, widths = true, worst = 0;
for (var v = 0; v <= 25.001; v += 0.25) {
	for (var tt = 0; tt < 20; tt += 0.37) {
		var s = Sky.sock(tt, v, false);
		for (var i = 0; i < s.length; i++) {
			if (!isFinite(s[i].abs) || !isFinite(s[i].rel) || !isFinite(s[i].a) || !isFinite(s[i].b)) finite = false;
			if (s[i].abs < -60 || s[i].abs > 95) bounded = false;
			if (Math.abs(s[i].abs) > Math.abs(worst)) worst = s[i].abs;
			if (!(s[i].a > 0 && s[i].b > 0)) widths = false;
		}
	}
}
ok('every angle finite for v = 0..25 m/s', finite);
ok('every stripe between 60 deg up and 95 deg down', bounded, 'widest swing ' + worst.toFixed(1) + ' deg');
ok('every stripe has a positive width', widths);
ok('nonsense wind (NaN, -3, undefined) gives a hanging sock, not NaN',
	[NaN, -3, undefined, null].every(function (x) { return Sky.sock(1, x, false).every(function (q) { return isFinite(q.abs); }); }));

var hang = Sky.sock(0, 0, true);
ok('calm: the sock hangs (first stripe 84 deg, the rest 88)', near(hang[0].abs, 84, 1e-9) && hang.slice(1).every(function (q) { return near(q.abs, 88, 1e-9); }));
var straight = Sky.sock(0, 7.7, true);
ok('7.7 m/s: straight out, every stripe at 0 deg', straight.every(function (q) { return near(q.abs, 0, 1e-9); }),
	straight.map(function (q) { return q.abs.toFixed(2); }).join(' '));
ok('  and still straight at 12 and 25 m/s', [12, 25].every(function (x) { return Sky.sock(0, x, true).every(function (q) { return near(q.abs, 0, 1e-9); }); }));
var mono3 = true, prevA = 999;
for (v = 0; v <= 7.7; v += 0.1) { var a0 = Sky.sock(0, v, true)[0].abs; if (a0 > prevA + 1e-9) mono3 = false; prevA = a0; }
ok('  the first stripe rises steadily as the wind grows', mono3);
var stripesOk = true;
for (var k = 0; k <= 5; k++) {
	var sk = Sky.sock(0, 1.54 * k, true);
	var filled = sk.filter(function (q) { return near(q.inf, 1, 1e-9); }).length;
	if (filled !== k) stripesOk = false;
}
ok('  at 1.54*k m/s exactly k stripes are full (3 knots a stripe)', stripesOk);

/* ================================================================== *
 *  the loop, on a fake page                                          *
 * ================================================================== */

section('on a page: data, frames, fps, quiet hours, hidden, previews');

var back = byIdFake('sky_back'), front = byIdFake('sky_front'), box = byIdFake('sky');
offset = new RealDate(2026, 10, 24, 12, 0, 0).getTime() - REAL_NOW;    /* Tuesday noon */
sandbox.cat_quiet_from = '23:00';
sandbox.cat_quiet_to = '10:00';

Sky.init();
ok('init finds every id it needs in the markup', missingIds.length === 0, missingIds.join(', '));
ok('  builds 26 stars, 8 rays and a five-stripe sock',
	ELS.sky_stars.children.length === 26 && ELS.sky_rays.children.length === 8 && countDeep(ELS.sky_sock, 'path') === 5);
function countDeep(n, tag) { var c = 0; (function walk(x) { x.children.forEach(function (y) { if (y.tagName === tag) c++; walk(y); }); })(n); return c; }

ok('no data: the loop is off', Sky.status().mode === 'off');
advance(1000);
ok('  and nothing was scheduled', timers.length === 0);

/* a Yandex-shaped response through the real weather.js */
function response(code, cloudness, wind) {
	var today = new FakeDate(), tom = new FakeDate(today.getTime() + 86400000);
	function ymd(x) { return x.getFullYear() + '-' + ('0' + (x.getMonth() + 1)).slice(-2) + '-' + ('0' + x.getDate()).slice(-2); }
	return {
		fact: { temp: 4, icon: code, cloudness: cloudness, wind_speed: wind, wind_angle: 250, humidity: 80, pressure_mm: 750 },
		forecasts: [
			{ date: ymd(today), sunrise: '08:41', sunset: '16:52', moon_code: 13, parts: {} },
			{ date: ymd(tom), sunrise: '08:43', sunset: '16:51', moon_code: 13, parts: {} }
		]
	};
}
function paint(code, cloudness, wind) {
	sandbox.Store.setJSON('wx.raw.v1', { t: FakeDate.now(), raw: JSON.stringify(response(code, cloudness, wind)) });
	Weather.restore(new FakeDate(), FakeDate.now());
}

paint('bkn_d', 0.5, 4.2);
var st = Sky.status();
ok('weather.js feeds the sky: 2 clouds, nothing falling, wind 4.2', st.cover === 'some' && st.precip === 'none' && st.wind === 4.2,
	st.cover + ' ' + st.precip + ' ' + st.wind);
ok('  Weather.sky() keeps the state, with both days', Weather.sky() && Weather.sky().days.length === 2 && Weather.sky().days[0].rise === RISE);
ok('  the loop runs at 12 fps when nothing falls', st.mode === 'run' && st.fps === 12, st.mode + ' ' + st.fps);
var ran = advance(3000);
ok('  ~36 frames in 3 s', ran >= 33 && ran <= 38, ran + ' timer runs');
ok('  sun on the arc, left corner sunrise, right sunset',
	ELS.sky_sun.style.display === '' && ELS.sky_moon.style.display === 'none' &&
	ELS.sky_lt.textContent === '08:41' && ELS.sky_rt.textContent === '16:52' &&
	ELS.sky_li.className === 'ci rise' && ELS.sky_ri.className === 'ci set');
var sunT = ELS.sky_sun.attrs.transform, fNoon = (720 - RISE) / (SET - RISE), pN = Sky.onArc(fNoon);
ok('  the sun sits where where() says', sunT === 'translate(' + pN.x.toFixed(2) + ',' + pN.y.toFixed(2) + ')', sunT);
ok('  two clouds in the svg, drifting', ELS.sky_clouds.children.length === 2);
ok('  the canvases stay hidden: nothing to draw', back.style.display !== 'block' && front.style.display !== 'block');

paint('ovc_ra', 1, 6);
advance(2000);
st = Sky.status();
ok('rain: overcast, 95 drops, 20 fps', st.cover === 'ovc' && st.precip === 'rain' && st.level === 1 && st.drops === 95 && st.fps === 20,
	st.cover + ' ' + st.precip + st.level + ' n' + st.drops + ' ' + st.fps + 'fps');
ok('  ten clouds, the sun dimmed to 0.16 behind them, the ring shown',
	ELS.sky_clouds.children.length === 10 && ELS.sky_sun.attrs.opacity === '0.16' && ELS.sky_ring.style.display === '');
ok('  the canvases are shown and drawn on', back.style.display === 'block' && front.style.display === 'block' && (back.ctx.calls.stroke || 0) > 0);
ok('  backing store from the canvas\'s own rect, devicePixelRatio 3 capped at 2', back.width === 720 && back.height === 1280,
	back.width + 'x' + back.height);
var dbg = Sky.debug();
ok('  sky units measured off the svg: 100 across, the sky at 54', near(dbg.geo.W, 100) && near(dbg.geo.oy, 54) && near(dbg.geo.H, 640 / 3.6),
	'W ' + dbg.geo.W.toFixed(1) + ' oy ' + dbg.geo.oy.toFixed(1) + ' H ' + dbg.geo.H.toFixed(1));
ok('  with no cat, things land 3 units above the bottom', near(dbg.floor, 640 / 3.6 - 3), dbg.floor.toFixed(2));
var under = dbg.parts.filter(function (q) { return q.y > dbg.floor + 0.01; }).length;
ok('  no drop below the floor', under === 0, under + ' below');

/* ---- an umbrella ---- */
var FLOOR_PX = 630;
var UMB = { cx: 120, rimY: 470, rx: 40, ry: 36 };          /* px */
function outline() {
	var pts = [];
	for (var i = 0; i <= 20; i++) {
		var ux = -40 + 4 * i, uy = -36 * Math.sqrt(Math.max(0, 1 - (ux / 40) * (ux / 40)));
		pts.push([UMB.cx + ux * UMB.rx / 40, UMB.rimY + uy * UMB.ry / 36]);
	}
	return pts;
}
Sky.shelter(function () { return { outline: outline(), floor: FLOOR_PX }; });
front.ctx.reset();
advance(3000);
dbg = Sky.debug();
ok('the shelter hook gives her floor', near(dbg.floor, FLOOR_PX / VW), dbg.floor.toFixed(2) + ' units');
ok('  and the canopy as a height map', !!dbg.canopy && dbg.canopy.top.length > 80);
var topMid = dbg.canopyTop(UMB.cx / VW), wantTop = (UMB.rimY - UMB.ry) / VW;
ok('  the top of the dome is where the outline says', near(topMid, wantTop, 0.05), topMid.toFixed(2) + ' vs ' + wantTop.toFixed(2));
ok('  outside the canopy nothing stops a drop', dbg.canopyTop(UMB.cx / VW + 20) === Infinity);
var through = dbg.parts.filter(function (q) { return q.rain && q.y > dbg.canopyTop(q.x) + 0.01; }).length;
ok('  no drop is inside or under the canopy', through === 0, through + ' through');
ok('  drops splash on it, on the front canvas', (front.ctx.calls.arc || 0) > 0, (front.ctx.calls.arc || 0) + ' droplets drawn');
var dripSeen = 0, dripFromRim = false;
for (var dn = 0; dn < 60; dn++) {
	advance(50);
	var dl = Sky.debug().drips;
	if (dl.length) {
		dripSeen++;
		var lowEnd = Sky.debug().canopy.low;
		dl.forEach(function (q) { if (near(q.x, lowEnd[0], 0.01) || near(q.x, Sky.debug().canopy.high[0], 0.01)) dripFromRim = true; });
	}
}
ok('  water drips off a rim end', dripSeen > 0 && dripFromRim, dripSeen + ' frames of 60 with a drip in the air');
ok('  the puddles come in', dbg.gWet > 0.5, 'wet ' + dbg.gWet.toFixed(2));
Sky.shelter(function () { throw new Error('a broken hook'); });
advance(500);
ok('a hook that throws is ignored, not counted as a sky fault', Sky.status().faults === 0 && Sky.debug().canopy === null);
Sky.shelter(null);

/* ---- snow ---- */
paint('ovc_+sn', 1, 3);
advance(30000);
st = Sky.status(); dbg = Sky.debug();
ok('heavy snow: 220 flakes', st.precip === 'snow' && st.level === 2 && st.drops === 220);
var crystalsFront = dbg.parts.filter(function (q) { return q.big && q.front; }).length, crystals = dbg.parts.filter(function (q) { return q.big; }).length;
ok('  about 60% of the crystals in front of her', crystals > 0 && crystalsFront / crystals > 0.35 && crystalsFront / crystals < 0.85,
	crystalsFront + ' of ' + crystals);
ok('  snow settles, growing 0.08/s', dbg.gSnow > 2.3 && dbg.gSnow <= 2.8, 'depth ' + dbg.gSnow.toFixed(2));
ok('  and the puddles dry', dbg.gWet < 0.2, 'wet ' + dbg.gWet.toFixed(2));
paint('skc_d', null, 3);
advance(30000);
dbg = Sky.debug();
ok('after the snow stops it melts at 0.15/s, and nothing falls', dbg.parts.length === 0 && dbg.gSnow < 0.01, 'depth ' + dbg.gSnow.toFixed(2));
advance(1000);
ok('  and with nothing left to draw the canvases hide', back.style.display === 'none' && Sky.status().fps === 12);

/* ---- a storm ---- */
paint('ovc_ts_ra', 1, 11);
var seenBolt = false, seenFlash = false;
for (var n = 0; n < 400; n++) {
	advance(50);
	if (ELS.sky_bolt.attrs.opacity === '1') seenBolt = true;
	if (+ELS.sky_flash.attrs.opacity > 0) seenFlash = true;
}
ok('storm: a bolt flickers and the sky flashes within 20 s', seenBolt && seenFlash);
ok('  heavy rain, 170 drops, overcast', Sky.status().drops === 170 && Sky.status().cover === 'ovc');

/* ---- the clock: night, the corners swap ---- */
Sky.minute(new FakeDate(2026, 10, 24, 22, 0, 0));
advance(200);
ok('22:00: the moon instead of the sun', ELS.sky_moon.style.display === '' && ELS.sky_sun.style.display === 'none');
ok('  corners: sunset 16:52 on the left, tomorrow\'s sunrise 08:43 on the right',
	ELS.sky_lt.textContent === '16:52' && ELS.sky_li.className === 'ci set' && ELS.sky_rt.textContent === '08:43' && ELS.sky_ri.className === 'ci rise');
ok('  moon_code 13 draws a lit shape', !!ELS.sky_moon_lit.attrs.d && ELS.sky_moon_lit.attrs.d.length > 10);
ok('  no stars under overcast', ELS.sky_stars.style.display === 'none');
paint('skc_n', null, 2);
Sky.minute(new FakeDate(2026, 10, 24, 22, 1, 0));
advance(500);
ok('  clear night: the stars are out, and twinkle', ELS.sky_stars.style.display === '' &&
	ELS.sky_stars.children.some(function (s) { return s.attrs.opacity !== undefined; }));

/* ---- quiet hours ---- */
offset = new RealDate(2026, 10, 24, 23, 30, 0).getTime() - REAL_NOW;
paint('ovc_ra', 1, 5);
Sky.minute(new FakeDate());
st = Sky.status();
ok('23:30 is quiet: a still frame, no loop', st.mode === 'still' && timers.filter(function (x) { return x.fn.name === 'frame'; }).length === 0, st.mode);
back.ctx.reset();
var ranQ = advance(30000);
ok('  nothing runs between minutes', ranQ === 0 && !back.ctx.calls.clearRect, ranQ + ' timer runs');
Sky.minute(new FakeDate());
ok('  the minute tick redraws it once', (back.ctx.calls.clearRect || 0) === 1);
ok('  the rain is drawn, standing still', back.style.display === 'block' && (back.ctx.calls.stroke || 0) > 0);

/* ---- a preview overrides the quiet hours, and ends by itself ---- */
Sky.preview('+sn');
st = Sky.status();
ok('a preview runs even in the quiet hours', st.mode === 'run' && st.preview === '+sn' && st.precip === 'snow' && st.level === 2);
ok('  Sky.previewing() tells the cat side what falls', Sky.previewing() && Sky.previewing().precip === 'snow');
Sky.preview('w10');
ok('  previews add up: heavy snow AND wind 10', Sky.status().precip === 'snow' && Sky.status().wind === 10);
Sky.preview('clear');
ok('  a cover button stops what falls', Sky.status().cover === 'clear' && Sky.status().precip === 'none');
Sky.preview('-ra');
ok('  light rain out of a clear sky gets two clouds', Sky.status().cover === 'some' && Sky.status().precip === 'rain' && Sky.status().level === 0);
document.hidden = true; fireDoc('visibilitychange');
ok('hidden: the loop stops', Sky.status().mode === 'off');
var before = timers.length;
advance(10 * 60 * 1000 + 500);
ok('  ten minutes later the preview has ended by itself', Sky.status().preview === '' && Sky.previewing() === null);
ok('  and nothing ran while hidden but that one timer', timers.length === 0, before + ' timers were pending');
document.hidden = false; fireDoc('visibilitychange');
ok('visible again: back to the real weather, still the quiet hours', Sky.status().mode === 'still' && Sky.status().cover === 'ovc');
Sky.preview('play');
advance(1000);
ok('"play a day" runs the sky\'s clock an hour a second', Sky.status().mode === 'run');
var lt1 = ELS.sky_lt.textContent, day1 = Sky.status().day;
advance(12000);
ok('  twelve seconds later day and night have changed over', Sky.status().day !== day1, (day1 ? 'day' : 'night') + ' -> ' + (Sky.status().day ? 'day' : 'night'));
Sky.preview('real');
ok('"Real weather" ends the preview at once', Sky.status().preview === '' && Sky.status().mode === 'still');

/* ---- expiry: the data goes stale ---- */
offset = new RealDate(2026, 10, 24, 12, 0, 0).getTime() - REAL_NOW;
paint('ovc_ra', 1, 5);
Sky.minute(new FakeDate());
ok('fresh data at noon runs', Sky.status().mode === 'run');
offset += (sandbox.expire + 120) * 1000;
Sky.minute(new FakeDate());
ok('  data older than `expire` (12 h): off, canvases hidden', Sky.status().mode === 'off' && back.style.display === 'none');

/* ---- the forecast is not hidden behind an episode ---- */
offset = new RealDate(2026, 10, 24, 12, 0, 0).getTime() - REAL_NOW;
paint('ovc_ra', 1, 5);
Sky.minute(new FakeDate());
advance(500);
ELS.wrapper = ELS.wrapper || byIdFake('wrapper');
ELS.wrapper.className = 'hidden';
advance(500);
ok('#wrapper hidden: the rain canvases hide too', back.style.display === 'none');
ELS.wrapper.className = '';
advance(500);
ok('  and come back with it', back.style.display === 'block');

/* ---- nonsense in, no NaN out ---- */
badAttrs.length = 0;
[back.ctx, front.ctx].forEach(function (c) { c.badArgs.length = 0; });
var junk = [
	{ code: 'bkn_+ra_d', cloudness: 'lots', wind: NaN, days: [{ date: 'x', rise: -1, set: -1, moon: -1 }] },
	{ code: undefined, cloudness: undefined, wind: undefined, days: undefined },
	{ code: 'ovc_ts_ra', cloudness: null, wind: Infinity, days: [{ date: '', rise: 1000, set: 200, moon: 99 }] },
	{ code: 'skc_n', cloudness: 0, wind: -5, days: [{ date: '', rise: 500, set: 1000, moon: NaN }] },
	null
];
junk.forEach(function (j) { Sky.feed(j, FakeDate.now()); advance(1000); Sky.minute(new FakeDate()); advance(500); });
for (var pk = 0; pk < Sky.previews().length; pk++) { Sky.preview(Sky.previews()[pk][0]); advance(300); }
Sky.preview('real');
paint('ovc_ra_sn', 1, 25);
Sky.shelter(function () { return { outline: [[NaN, 1], [2, 3], [4, 5]], floor: NaN }; });
advance(2000);
Sky.shelter(function () { return { outline: outline(), floor: FLOOR_PX }; });
advance(2000);
ok('no NaN, undefined or Infinity in any svg attribute, fed nonsense', badAttrs.length === 0, badAttrs.slice(0, 4).join('  '));
ok('no NaN in any canvas call', back.ctx.badArgs.length === 0 && front.ctx.badArgs.length === 0,
	back.ctx.badArgs.concat(front.ctx.badArgs).slice(0, 3).join('  '));
ok('and not one fault on the way', Sky.status().faults === 0, Sky.status().lastFault);

/* ---- three faults in a minute stop it, and only it ---- */
var savedSet = Node.prototype.setAttribute;
Node.prototype.setAttribute = function (k, v) { if (k === 'transform' && this.tagName === 'use') throw new Error('boom'); return savedSet.call(this, k, v); };
advance(1000);
Node.prototype.setAttribute = savedSet;
st = Sky.status();
ok('three faults in a minute: the sky stops animating', st.dead && st.mode === 'off' && timers.length === 0, st.faults + ' faults');
ok('  and the canvases are cleared away', back.style.display === 'none');
var threw = false;
try { Sky.minute(new FakeDate()); Sky.feed(Weather.sky(), FakeDate.now()); Sky.preview('ts'); } catch (e) { threw = true; }
ok('  after which every way in is a quiet no-op', !threw && Sky.status().mode === 'off');

/* ================================================================== *
 *  the rules                                                         *
 * ================================================================== */

section('the rules');

/* comments out, then look for any of the cat's names */
var code = read('src/core/sky.js').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
var CAT = ['Cat', 'Rig', 'Anim', 'Alive', 'Wardrobe', 'Actions', 'Props', 'Beats', 'Scenes', 'Episodes', 'Plan', 'Shapes', 'Guard'];
var hits = CAT.filter(function (n) { return new RegExp('\\b' + n + '\\s*\\.').test(code) || new RegExp('\\b' + n + '\\b\\s*\\(').test(code); });
ok('sky.js calls nothing of the cat\'s (nor Guard: its faults are its own)', hits.length === 0, hits.join(', '));
var catIds = ['wUmbrella', 'cat_holder', 'cat_stage', 'catRoot', 'cat_hit'].filter(function (n) { return code.indexOf(n) !== -1; });
ok('  and looks up none of her elements', catIds.length === 0, catIds.join(', '));
var cfg = (code.match(/\bcat_[a-z_]+/g) || []).filter(function (n) { return n !== 'cat_quiet_from' && n !== 'cat_quiet_to'; });
ok('  the only cat_ globals it reads are the quiet hours (settings.js overlays them)', cfg.length === 0, cfg.join(', '));

var es6 = [/\blet\s/, /\bconst\s/, /=>/, /`/, /\bclass\s+[A-Z]/];
var es6hit = es6.filter(function (re) { return re.test(code); });
ok('sky.js is ES5: no let, const, arrows, template literals or classes', es6hit.length === 0, es6hit.join(' '));

var build = read('tools/build.js');
var iw = build.indexOf("'src/core/weather.js'"), is = build.indexOf("'src/core/sky.js'"), ic = build.indexOf("'src/core/clock.js'");
ok('build.js loads sky.js after weather.js and before clock.js', iw !== -1 && is > iw && ic > is);

var clockSrc = read('src/core/clock.js'), weatherSrc = read('src/core/weather.js');
ok('the clock moves the sky every minute; the old daylight bar is gone',
	/Sky\.minute\(/.test(clockSrc) && !/riseset/.test(clockSrc) && !/function riseset/.test(weatherSrc));
['icon', 'temperature_sub', 'riseset', 'duration_bar', 'wind_progress', 'moon"'].forEach(function (id) {
	ok('  #' + id.replace('"', '') + ' is gone from the markup', base.indexOf('id="' + id.replace('"', '') + '"') === -1);
});
['temperature', 'wind', 'wind_icon', 'humidity', 'pressure', 'forecast', 'sky'].forEach(function (id) {
	ok('  #' + id + ' is there', base.indexOf('id="' + id + '"') !== -1);
});

console.log('\n' + '='.repeat(66));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(66) + '\n');
process.exit(fail ? 1 : 0);
