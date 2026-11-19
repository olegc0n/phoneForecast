/* check-scenes.js - does every animation hold together, without a phone?
 *
 *   node tools/check-scenes.js            every scene, one line each
 *   node tools/check-scenes.js --only id  one scene, with its timeline of props
 *   node tools/check-scenes.js --json     id, label, when and measured length
 *
 * Loads the REAL rig, frame driver, actions, props, beats, scenes and episodes.
 * Only the browser is faked: a DOM that remembers what it was told, and a clock
 * that can be wound forward. Each scene is then actually played - every timer
 * fired, every frame stepped - and looked at while it runs and when it ends.
 *
 * Written because a data scene fails quietly. A misspelt verb is skipped, a prop
 * name that was never created makes `sip` do nothing, and a prop that is not
 * faded out simply vanishes when the scene is torn down. None of those throw,
 * and all of them are visible on the screen as something slightly wrong.
 *
 * Two kinds of check:
 *
 *   static   read off the data. Unknown verbs, unknown artwork, a prop used
 *            before it exists, garment and outfit names, malformed `when`,
 *            duplicate ids.
 *   played   seen while running. Exceptions, tweens aimed at parts that do not
 *            exist, anything drawn above the 63% line where the clock is,
 *            props, tint or a sunk cat left behind at the end, and the length.
 *
 * The hand-written episodes in episodes.js are played too, but only for
 * exceptions: they clean up by being torn down, which is what they were written
 * to do. The same goes for the leftover-prop check on the scenes that predate
 * `live` - it is reported, not failed.                                         */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

var argv = process.argv.slice(2);
var JSON_OUT = argv.indexOf('--json') !== -1;
var ONLY = (function () { var i = argv.indexOf('--only'); return i === -1 ? null : argv[i + 1]; })();

/* ------------------------------------------------------------------ *
 *  a clock that can be wound forward                                  *
 * ------------------------------------------------------------------ */

var now = 0, timers = [], timerSeq = 0;

function fakeSetTimeout(fn, ms) {
	var id = ++timerSeq;
	timers.push({ id: id, at: now + Math.max(0, ms || 0), fn: fn });
	return id;
}
function fakeClearTimeout(id) {
	for (var i = 0; i < timers.length; i++) if (timers[i].id === id) { timers.splice(i, 1); return; }
}
function advance(to) {
	for (;;) {
		var best = -1;
		for (var i = 0; i < timers.length; i++) {
			if (timers[i].at > to) continue;
			if (best === -1 || timers[i].at < timers[best].at ||
				(timers[i].at === timers[best].at && timers[i].id < timers[best].id)) best = i;
		}
		if (best === -1) break;
		var t = timers.splice(best, 1)[0];
		if (t.at > now) now = t.at;
		t.fn();
	}
	now = to;
}

/* ------------------------------------------------------------------ *
 *  a DOM that remembers what it was told                              *
 * ------------------------------------------------------------------ */

var STAGE_W = 360, STAGE_H = 640;          /* the screen the scenes are drawn for */

function node(extra) {
	var n = {
		style: {}, attrs: {}, children: [], innerHTML: '',
		setAttribute: function (k, v) { n.attrs[k] = v; },
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
	cat_holder:     node({ offsetWidth: STAGE_W * 0.44, offsetHeight: STAGE_W * 0.576,
	                       getElementsByTagName: function () { return [svg]; } }),
	cat_props:      node(),
	cat_props_back: node()
};

var faults = [];

var sandbox = {
	console: { log: function () {}, warn: function () {}, error: function () {} },
	Math: Math, Date: Date, JSON: JSON, parseFloat: parseFloat, parseInt: parseInt, isNaN: isNaN,
	setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
	performance: { now: function () { return now; } },
	document: {
		createElement: function () { return node(); },
		getElementById: function (id) { return ELS[id] || null; },
		querySelector: function () { return null; },
		querySelectorAll: function () { return []; },
		addEventListener: function () {},
		body: node()
	},
	addEventListener: function () {},
	Guard: {
		run: function (label, fn) {
			try { fn(); return true; } catch (e) { faults.push(label + ': ' + (e && e.message ? e.message : e)); return false; }
		},
		fault: function (label, e) { faults.push(label + ': ' + (e && e.message ? e.message : e)); },
		faults: function () { return faults.length; }
	},
	/* the procedural layer writes the other channel and is not what is on trial */
	Alive: { lookAtStage: function () {}, settle: function () {}, step: function () {},
	         asleep: function () {}, mood: function () {}, wind: function () {} },
	Cat: { weather: function () { return null; } },
	Bus: { on: function () {}, emit: function () {} }
};
sandbox.window = sandbox;

var ctx = vm.createContext(sandbox);
function load(src, name) { vm.runInContext(src, ctx, { filename: name }); }
function inPage(code) { return vm.runInContext(code, ctx); }

var config = read('src/informer.base.html').split('\n')
	.filter(function (l) { return /^var [a-z_]+ *=/.test(l); }).join('\n');
load(config, 'config');

['src/core/dom.js', 'src/cat/shapes.js', 'src/cat/rig.js', 'src/cat/anim.js',
 'src/cat/wardrobe.js', 'src/cat/actions.js', 'src/cat/props.js', 'src/cat/beats.js',
 'src/cat/scenes.js', 'src/cat/scenes-winter.js', 'src/cat/episodes.js'
].forEach(function (m) { load(read(m), m); });

var Rig = sandbox.Rig, Anim = sandbox.Anim, Props = sandbox.Props, Beats = sandbox.Beats;
var Scenes = sandbox.Scenes, Episodes = sandbox.Episodes, Wardrobe = sandbox.Wardrobe;
var Shapes = inPage('Shapes');

/* ------------------------------------------------------------------ *
 *  taps on the real modules, so the harness can see what they did     *
 * ------------------------------------------------------------------ */

/* the artwork's own proportions, read from props.js rather than retyped */
var ART = {};
(function () {
	var src = read('src/cat/props.js');
	var re = /\n\t\t(\w+):\s*\n(?:\t\t\t\/\*[\s\S]*?\*\/\s*\n)?\t\t\t'<svg viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/g, m;
	while ((m = re.exec(src))) ART[m[1]] = parseFloat(m[4]) / parseFloat(m[5]);
})();
var ART_NAMES = Props.names();

var live = {};                 /* prop id -> { art, x, y, w, z } for the scene now playing */
var madeCount = 0;
var issues = [];               /* problems seen while the current scene runs */
var seenIssue = {};

function issue(text) {
	if (seenIssue[text]) return;
	seenIssue[text] = 1;
	issues.push(text);
}

var realPut = Props.put;
Props.put = function (art, x, y, w, z) {
	var id = realPut(art, x, y, w, z);
	if (ART_NAMES.indexOf(art) === -1) issue('Props.put of unknown art "' + art + '"');
	live[id] = { art: art, x: x, y: y, w: w, z: z === undefined ? 4 : z };
	madeCount++;
	return id;
};
var realClear = Props.clear;
Props.clear = function () { realClear(); live = {}; };

var PARTS = {};
Rig.parts().forEach(function (p) { PARTS[p] = 1; });
var KEYS = { rot: 1, x: 1, y: 1, sx: 1, sy: 1, o: 1, morph: 1, face: 1, scale: 1 };

function vetTween(what, part, key, to, dur) {
	if (part !== 'world' && !PARTS[part] && !live[part]) issue(what + ' on unknown part "' + part + '"');
	if (!KEYS[key]) issue(what + ' on unknown key "' + part + '.' + key + '"');
	if (typeof to !== 'number' || to !== to || !isFinite(to)) issue(what + ' of ' + part + '.' + key + ' to ' + to);
	if (dur !== undefined && (typeof dur !== 'number' || dur !== dur || dur < 0)) issue(what + ' of ' + part + '.' + key + ' lasting ' + dur);
}
var realTween = Anim.tween;
Anim.tween = function (part, key, to, dur, ez, delay, done) {
	vetTween('tween', part, key, to, dur);
	return realTween(part, key, to, dur, ez, delay, done);
};
var realPoke = Anim.poke;
Anim.poke = function (part, key, to, delay) {
	vetTween('poke', part, key, to);
	return realPoke(part, key, to, delay);
};

/* looked at on every frame the real loop draws */
var BAND = 63;                 /* nothing may be drawn above this; the clock lives there */
var peakVisible = 0;
var highest = {};             /* art -> the highest it was ever drawn, if too high */
var farthest = null;           /* how far off the stage she got, if she did */
var floorY = 0;
var span = 0;

function propBox(id) {
	var p = live[id];
	var h = p.w * (STAGE_W / STAGE_H) / (ART[p.art] || 1);
	var sy = Math.abs(Rig.get(id, 'sy'));
	var cy = p.y + h / 2 + Rig.get(id, 'y') / STAGE_H * 100;
	return { top: cy - h * sy / 2, bottom: cy + h * sy / 2, o: Rig.get(id, 'o') };
}

var realFlush = Rig.flush;
Rig.flush = function (force) {
	realFlush(force);
	var visible = 0;
	for (var id in live) {
		var b = propBox(id);
		if (!(b.o > 0.05)) continue;
		visible++;
		/* falling snow in the layer behind the forecast is the one thing allowed
		 * up there: the clock draws over it */
		if (live[id].z < 5 && live[id].art === 'flake') continue;
		if (b.top < BAND - 0.5) {
			var art = live[id].art;
			if (highest[art] === undefined || b.top < highest[art]) highest[art] = b.top;
		}
	}
	if (visible > peakVisible) peakVisible = visible;
	var x = Rig.get('world', 'x');
	if (x < -0.5 || x > span + 0.5) {
		if (farthest === null || Math.abs(x - span / 2) > Math.abs(farthest - span / 2)) farthest = x;
	}
};

/* ------------------------------------------------------------------ *
 *  static checks                                                      *
 * ------------------------------------------------------------------ */

var VERBS = Beats.verbs();
var OUTFITS = Wardrobe.names();
var GARMENTS = Rig.parts().filter(function (p) { return /^w[A-Z]/.test(p); });
var SLOTS = ['head', 'eyes', 'neck', 'body', 'hand'];
var MOODS = ['happy', 'sad', 'surprised', 'annoyed', 'sleepy', 'calm', 'neutral'];

/* which argument of which verb names a prop the scene must already have made */
var USES_PROP = { sip: 0, lick: 0, propOut: 0, propTo: 0, nudge: 0, spin: 0, 'throw': 0,
                  propFade: 0, propScale: 0, fall: 0, sway: 0, wiggle: 0, hopProp: 0,
                  propHome: 0, propToCat: 0 };

function staticCheck(def) {
	var bad = [];
	var made = {};
	var beats = def.beats;

	if (!def.label) bad.push('no label');
	if (['low', 'mid', 'high'].indexOf(def.energy || 'mid') === -1) bad.push('energy "' + def.energy + '"');
	if (def.weight !== undefined && !(typeof def.weight === 'number' && def.weight >= 0)) bad.push('weight ' + def.weight);
	if (def.perDay !== undefined && !(typeof def.perDay === 'number' && def.perDay > 0)) bad.push('perDay ' + def.perDay);
	(def.tags || []).forEach(function (t) { if (t !== 'work' && t !== 'play') bad.push('tag "' + t + '"'); });
	if (!Array.isArray(beats) || !beats.length) { bad.push('no beats'); return bad; }

	for (var i = 0; i < beats.length; i++) {
		var b = beats[i];
		if (!Array.isArray(b) || typeof b[0] !== 'string') { bad.push('beat ' + i + ' is not [verb, ...]'); continue; }
		if (b[0] === 'also') b = b.slice(1);
		var verb = b[0], a = b.slice(1);
		var at = 'beat ' + i + ' [' + verb + ']';

		if (VERBS.indexOf(verb) === -1) { bad.push(at + ': unknown verb'); continue; }

		if (verb === 'prop' || verb === 'propOn') {
			if (typeof a[0] !== 'string') bad.push(at + ': no prop name');
			if (ART_NAMES.indexOf(a[1]) === -1) bad.push(at + ': no artwork "' + a[1] + '"');
			for (var k = 2; k <= 4; k++) if (typeof a[k] !== 'number') bad.push(at + ': argument ' + k + ' is not a number');
			if (made[a[0]] === 'on stage') bad.push(at + ': "' + a[0] + '" made twice - the first one is orphaned');
			made[a[0]] = 'on stage';
			continue;
		}
		if (verb === 'trail' && ART_NAMES.indexOf(a[0]) === -1) bad.push(at + ': no artwork "' + a[0] + '"');

		if (USES_PROP.hasOwnProperty(verb)) {
			var name = a[USES_PROP[verb]];
			/* `sip` on a garment name is drinking what she is holding, not a prop */
			var heldGarment = verb === 'sip' && typeof name === 'string' && name.charAt(0) === 'w' && !made[name];
			if (verb === 'lick' && typeof name !== 'string') name = null;      /* ['lick', n] */
			if (name !== null && !heldGarment) {
				if (!made[name]) bad.push(at + ': prop "' + name + '" was never created');
			}
			if (heldGarment && GARMENTS.indexOf(name) === -1) bad.push(at + ': no garment "' + name + '"');
			if (verb === 'propOut' && made[name]) made[name] = 'gone';
		}

		if ((verb === 'wear' || verb === 'hold') && a[0] && GARMENTS.indexOf(a[0]) === -1) bad.push(at + ': no garment "' + a[0] + '"');
		if (verb === 'outfit' && OUTFITS.indexOf(a[0]) === -1) bad.push(at + ': no outfit "' + a[0] + '"');
		if (verb === 'unwear' && SLOTS.indexOf(a[0]) === -1) bad.push(at + ': no slot "' + a[0] + '"');
		if (verb === 'emote' && MOODS.indexOf(a[0]) === -1) bad.push(at + ': no mood "' + a[0] + '"');
		if (verb === 'mouth' && !Shapes.mouth[a[0]]) bad.push(at + ': no mouth shape "' + a[0] + '"');
		if (verb === 'tint' && a[0] !== 'hot' && a[0] !== 'cold') bad.push(at + ': tint is hot or cold');
		if (verb === 'pose') {
			if (a[0] !== 'world' && !PARTS[a[0]]) bad.push(at + ': no rig part "' + a[0] + '"');
			if (!KEYS[a[1]]) bad.push(at + ': no key "' + a[1] + '"');
			if (typeof a[2] !== 'number') bad.push(at + ': value is not a number');
		}
		if ((verb === 'paw' || verb === 'bat' || verb === 'pawTap' || verb === 'shakePaw') &&
			a[0] !== 'L' && a[0] !== 'R') bad.push(at + ': which paw? L or R');
	}
	return bad;
}

var WHEN_KEYS = ['hours', 'weekdays', 'weekend', 'dates', 'months', 'dayMin', 'precip', 'sky',
                 'night', 'thunder', 'tempMin', 'tempMax', 'windMin'];

function whenCheck(w) {
	var bad = [], k;
	if (w === undefined || w === null) return bad;
	if (typeof w !== 'object') return ['when is not an object'];
	for (k in w) if (WHEN_KEYS.indexOf(k) === -1) bad.push('when.' + k + ' is not a field the matcher reads');

	var hm = /^([01]\d|2[0-3]):[0-5]\d$/;
	if (w.hours !== undefined && !(Array.isArray(w.hours) && w.hours.length === 2 && hm.test(w.hours[0]) && hm.test(w.hours[1]))) bad.push('when.hours is not [HH:MM, HH:MM]');
	['weekdays', 'weekend', 'night', 'thunder'].forEach(function (f) {
		if (w[f] !== undefined && typeof w[f] !== 'boolean') bad.push('when.' + f + ' is not true or false');
	});
	/* these are the values weather.js really produces - see splitCode() */
	if (w.precip !== undefined && [null, 'ra', 'sn', 'ra_sn'].indexOf(w.precip) === -1) bad.push('when.precip "' + w.precip + '"');
	if (w.sky !== undefined && ['skc', 'bkn', 'ovc'].indexOf(w.sky) === -1) bad.push('when.sky "' + w.sky + '"');
	['tempMin', 'tempMax', 'windMin', 'dayMin'].forEach(function (f) {
		if (w[f] !== undefined && typeof w[f] !== 'number') bad.push('when.' + f + ' is not a number');
	});
	if (typeof w.tempMin === 'number' && typeof w.tempMax === 'number' && w.tempMin > w.tempMax) bad.push('when.tempMin is above tempMax');
	if (w.months !== undefined && !(Array.isArray(w.months) && w.months.every(function (m) { return m >= 1 && m <= 12; }))) bad.push('when.months');
	if (w.dates !== undefined && !(Array.isArray(w.dates) && w.dates.every(function (d) { return /^\d\d-\d\d$/.test(d); }))) bad.push('when.dates');
	return bad;
}

/* Could this ever be picked? Tried against a grid of plausible weather at every
 * waking hour of a weekday and a Saturday. */
function reachable(def) {
	if (def.when && def.when.dates && !def.when.dates.length) return true;     /* birthday unset */
	var temps = [-15, -8, -4, -1, 0, 1, 3, 5, 7, 10, 16, 20, 24, 28];
	var days = [new Date(2026, 10, 12), new Date(2026, 10, 14), new Date(2026, 11, 24)];
	if (def.when && def.when.dates) def.when.dates.forEach(function (md) {
		days.push(new Date(2026, parseInt(md.slice(0, 2), 10) - 1, parseInt(md.slice(3), 10)));
	});
	for (var d = 0; d < days.length; d++) for (var h = 0; h < 24; h++) {
		var date = new Date(days[d].getTime()); date.setHours(h, 30);
		for (var t = 0; t < temps.length; t++) for (var p = 0; p < 4; p++) for (var s = 0; s < 3; s++)
		for (var n = 0; n < 2; n++) for (var wi = 0; wi < 2; wi++) {
			var wx = { temp: temps[t], precip: [null, 'ra', 'sn', 'ra_sn'][p], sky: ['skc', 'bkn', 'ovc'][s],
			           isNight: !!n, isThunder: false, wind: wi ? 9 : 2 };
			if (Scenes.matches(def.when, wx, date)) return true;
		}
	}
	return false;
}

/* ------------------------------------------------------------------ *
 *  playing one                                                        *
 * ------------------------------------------------------------------ */

function play(id, startX) {
	faults.length = 0; issues = []; seenIssue = {};
	madeCount = 0; peakVisible = 0; highest = {}; farthest = null;

	/* a clean cat on the floor, the way cat.js leaves her between animations */
	if (Episodes.running()) Episodes.abort();
	Anim.clear();
	Props.clear();
	Rig.measure();
	span = 100 - Rig.size.w;
	floorY = 100 - Rig.size.h + 0.6;
	Rig.at(Math.min(span, startX), floorY);
	Wardrobe.bare();
	Wardrobe.sync();

	var finished = false;
	var total = Episodes.play(id, function () { finished = true; });
	if (!total) return { error: 'did not start' };
	var dur = total - 900;                  /* Episodes adds 900 ms of grace */
	var t0 = now;

	/* to the end of the last beat, plus a quarter second for the frame the
	 * final fade lands on - still well inside the grace, before teardown */
	advance(t0 + dur + 250);

	var left = [], id2;
	for (id2 in live) {
		var o = Rig.get(id2, 'o');
		if (o > 0.03 && left.indexOf(live[id2].art) === -1) left.push(live[id2].art);
	}
	var tint = [];
	if (Rig.get('foreheadFlush', 'o') > 0.03) tint.push('hot');
	if (Rig.get('coldTint', 'o') > 0.03) tint.push('cold');
	var sunk = Math.abs(Rig.get('world', 'y') - floorY) > 0.3;
	var hidden = Rig.get('catRoot', 'o') < 0.97;

	advance(t0 + total + 200);

	if (farthest !== null) issue('she gets to x=' + farthest.toFixed(1) + ', off the stage (0..' + span.toFixed(1) + ')');
	for (var art in highest) {
		issue('"' + art + '" is drawn up to ' + highest[art].toFixed(1) + '% - above the ' + BAND + '% line, where the clock is');
	}

	return {
		dur: dur, made: madeCount, peak: peakVisible,
		left: left, tint: tint, sunk: sunk, hidden: hidden, finished: finished,
		faults: faults.slice(), issues: issues.slice()
	};
}

/* ------------------------------------------------------------------ *
 *  the run                                                            *
 * ------------------------------------------------------------------ */

Rig.init();
Props.init();

var pass = 0, fail = 0, notes = 0;
function line(ok, text) {
	if (!JSON_OUT) console.log((ok ? '  PASS  ' : '  FAIL  ') + text);
	if (ok) pass++; else fail++;
}
function note(text) { if (!JSON_OUT) console.log('  note  ' + text); notes++; }
function head(text) { if (!JSON_OUT) console.log('\n' + text); }

var all = Episodes.list();
var out = [];

/* ---- ids ---- */
head('the catalogue');
(function () {
	var seen = {}, dup = [];
	all.forEach(function (e) { if (seen[e.id]) dup.push(e.id); seen[e.id] = 1; });
	line(!dup.length, all.length + ' animations, every id unique' + (dup.length ? '   duplicates: ' + dup.join(', ') : ''));
	var bad = all.filter(function (e) { return !/^[a-z][a-z0-9_]*$/.test(e.id); }).map(function (e) { return e.id; });
	line(!bad.length, 'ids are lower_snake_case, safe for adb -e ep <id>' + (bad.length ? '   ' + bad.join(', ') : ''));
})();

var MIN_MS = 9000, MAX_MS = 27000;         /* a little either side of the 10-25 s brief */
var MAX_NODES = 24;                        /* pooled prop nodes one scene may create */

head('scenes written as data');
all.forEach(function (e) {
	var def = Scenes.find(e.id);
	if (!def) return;
	if (ONLY && e.id !== ONLY) return;

	var isNew = !!def.live;
	var bad = staticCheck(def).concat(whenCheck(def.when));
	if (!reachable(def)) bad.push('no weather, hour or day ever matches its `when`');

	/* three starting places: mid-stage for the length, and both ends to shake
	 * out anything that only works from where it was written */
	var runs = [30, 0, 56].map(function (x) { return play(e.id, x); });
	var r = runs[0];
	var soft = [];

	runs.forEach(function (run, i) {
		var where = i ? ' (starting at x=' + [30, 0, 56][i] + ')' : '';
		if (run.error) { bad.push(run.error + where); return; }
		run.faults.forEach(function (f) { bad.push('threw: ' + f + where); });
		run.issues.forEach(function (f) {
			/* the scenes that predate this harness are reported, not failed */
			if (!isNew) { if (!i) soft.push(f); return; }
			bad.push(f + where);
		});
		if (!run.finished) bad.push('never finished' + where);
		if (run.tint.length) bad.push(run.tint.join(' and ') + ' tint left on her face' + where);
		if (run.hidden) bad.push('she is still invisible at the end' + where);
		if (run.sunk) bad.push('she is still sunk below the floor at the end' + where);
		if (run.made > MAX_NODES) bad.push(run.made + ' prop nodes created, over the ' + MAX_NODES + ' allowed' + where);
		if (run.left.length) {
			var msg = 'left on stage at the end: ' + run.left.join(', ') + where;
			/* the older scenes rely on teardown; say so, do not fail them */
			if (isNew) bad.push(msg); else if (!i) soft.push(msg);
		}
	});

	if (isNew && !r.error) {
		if (r.dur < MIN_MS) bad.push('only ' + (r.dur / 1000).toFixed(1) + ' s long');
		if (r.dur > MAX_MS) bad.push((r.dur / 1000).toFixed(1) + ' s long');
		/* the length the test menu shows is typed in; keep it honest */
		if (!def.dur) bad.push('no dur - the test menu will say 12 s');
		else if (Math.abs(def.dur - r.dur) > 3000) bad.push('dur says ' + (def.dur / 1000).toFixed(1) + ' s, it runs ' + (r.dur / 1000).toFixed(1) + ' s');
	}

	/* de-duplicate: the same fault usually shows from all three starts */
	var uniq = [], seen = {};
	bad.forEach(function (b) {
		var key = b.replace(/ \(starting at x=\d+\)$/, '');
		if (!seen[key]) { seen[key] = 1; uniq.push(key); }
	});

	var tail = r.error ? '' : ('   ' + (r.dur / 1000).toFixed(1) + ' s, ' + r.made + ' props, ' + r.peak + ' at once');
	line(!uniq.length, (isNew ? '' : '(old) ') + e.id + tail);
	uniq.forEach(function (b) { if (!JSON_OUT) console.log('          ' + b); });
	soft.forEach(function (s) { note(e.id + ': ' + s); });

	out.push({ id: e.id, label: def.label, when: def.when || null, durationMs: r.error ? 0 : Math.round(r.dur),
	           energy: def.energy || 'mid', weight: def.weight, tags: def.tags || [], isNew: isNew });
});

/* --only: where each beat falls, so a frame can be found by its time */
if (ONLY && Scenes.find(ONLY) && !JSON_OUT) {
	(function () {
		var def = Scenes.find(ONLY);
		console.log('\n  timeline (starting at x=30)');
		for (var i = 0; i < def.beats.length; i++) {
			Props.clear(); Anim.clear();
			Rig.at(30, floorY);
			var at = Beats.play(def.beats.slice(0, i), function () { return false; }, { live: !!def.live }).duration;
			console.log('    ' + ('      ' + (at / 1000).toFixed(2)).slice(-6) + '  ' + JSON.stringify(def.beats[i]));
		}
		Props.clear(); Anim.clear();
	})();
}

if (!ONLY) {
	head('hand-written episodes (played for exceptions only)');
	all.forEach(function (e) {
		if (Scenes.find(e.id)) return;
		var r = play(e.id, 30);
		var bad = r.error ? [r.error] : r.faults.concat(r.issues.filter(function (s) { return /unknown/.test(s); }));
		if (!r.error && !r.finished) bad.push('never finished');
		line(!bad.length, e.id + (r.error ? '' : '   ' + (r.dur / 1000).toFixed(1) + ' s'));
		bad.forEach(function (b) { if (!JSON_OUT) console.log('          ' + b); });
	});
}

if (JSON_OUT) {
	console.log(JSON.stringify(out, null, 1));
} else {
	var news = out.filter(function (o) { return o.isNew; });
	if (news.length) {
		var ds = news.map(function (o) { return o.durationMs; }).sort(function (a, b) { return a - b; });
		console.log('\n  ' + news.length + ' live scenes, ' + (ds[0] / 1000).toFixed(1) + ' to ' +
			(ds[ds.length - 1] / 1000).toFixed(1) + ' s, median ' + (ds[Math.floor(ds.length / 2)] / 1000).toFixed(1) + ' s');
	}
	console.log('\n  ' + pass + ' passed, ' + fail + ' failed' + (notes ? ', ' + notes + ' notes' : '') + '\n');
}
process.exit(fail ? 1 : 0);
