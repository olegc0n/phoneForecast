/* check-plan.js - build Lili's day outside the phone and look at it.
 *
 *   node tools/check-plan.js            5 working days + 5 holidays
 *   node tools/check-plan.js --full     every slot of every day, not just a summary
 *   node tools/check-plan.js --weather rain
 *
 * This loads the REAL scenes.js, episodes.js and plan.js. Nothing about the
 * schedule is reimplemented here - only the browser is faked - so what it
 * prints is what the app will actually do.                                     */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

/* ---- the config the app runs with, taken from the app, not retyped ---- */
var base = read('src/informer.base.html');
var config = base.split('\n').filter(function (l) { return /^var cat_/.test(l); }).join('\n');

/* ---- a sandbox with just enough browser in it ----
 * The episode `run` bodies reference Anim, Rig, Actions and so on, but nothing
 * calls them here: we only need each episode's id, weight, energy and cond.  */
var stub = new Proxy({}, { get: function () { return function () {}; } });

var sandbox = {
	console: console, Math: Math, Date: Date, JSON: JSON,
	Anim: stub, Rig: stub, Actions: stub, Props: stub, Beats: stub,
	Wardrobe: stub, Alive: stub, Bus: stub, Host: stub,
	Guard: { run: function (n, f) { return f(); }, faults: function () { return 0; } },
	Store: (function () {
		var mem = {};
		return {
			getJSON: function (k) { return mem[k] ? JSON.parse(mem[k]) : null; },
			setJSON: function (k, v) { mem[k] = JSON.stringify(v); },
			persistent: function () { return false; }
		};
	})(),
	byId: function () { return null; },
	on: function () {},
	pad: function (n) { return n < 10 ? '0' + n : '' + n; }
};
sandbox.window = sandbox;
sandbox.document = { createElement: function () { return stub; }, body: stub };

var ctx = vm.createContext(sandbox);
function load(src, name) { vm.runInContext(src, ctx, { filename: name }); }

load(config, 'config');
/* The REAL dom.js, not a hand-written hhmm.
 *
 * It used to stub the one helper it needed, and that stub silently went out of
 * date the moment the clock-window test moved into dom.js: every episode with an
 * `hours` window started throwing inside its own cond, compose() swallowed it as
 * "does not fit", and this harness cheerfully reported a schedule with no desk
 * work in it. A stub of the thing you are testing is a way to be told what you
 * expected. dom.js has no top-level side effects, so just load it.           */
load(read('src/core/dom.js'), 'dom.js');
load(read('src/cat/scenes.js'), 'scenes.js');
load(read('src/cat/episodes.js'), 'episodes.js');
load(read('src/cat/plan.js'), 'plan.js');

/* the same library the app hands to the planner */
var LIB = vm.runInContext(
	'(function(){ var out=[]; var l=Episodes.planLibrary ? Episodes.planLibrary() : null;' +
	' return l; })()', ctx);

/* ---- weather presets, same numbers the studio uses ---- */
var WX = {
	clear: { code: 'skc_d', sky: 'skc', precip: null, isThunder: false, isNight: false, temp: 18,
	         wind: 3, windAngle: 180, humidity: 55, pressure: 750, pressureTrend: 0,
	         sunriseMin: 6*60+20, sunsetMin: 20*60+10 },
	hot:   { code: 'skc_d', sky: 'skc', precip: null, isThunder: false, isNight: false, temp: 27,
	         wind: 2, windAngle: 180, humidity: 40, pressure: 752, pressureTrend: 0,
	         sunriseMin: 6*60+20, sunsetMin: 20*60+10 },
	rain:  { code: 'ovc_ra', sky: 'ovc', precip: 'ra', isThunder: false, isNight: false, temp: 9,
	         wind: 6, windAngle: 200, humidity: 92, pressure: 742, pressureTrend: -4,
	         sunriseMin: 6*60+20, sunsetMin: 20*60+10 },
	snow:  { code: 'ovc_sn', sky: 'ovc', precip: 'sn', isThunder: false, isNight: false, temp: -4,
	         wind: 5, windAngle: 200, humidity: 88, pressure: 748, pressureTrend: -1,
	         sunriseMin: 8*60+40, sunsetMin: 16*60+50 },
	none:  null
};

/* ---- run it ---- */
var argv = process.argv.slice(2);
var full = argv.indexOf('--full') !== -1;
var wxName = (function () { var i = argv.indexOf('--weather'); return i === -1 ? 'clear' : argv[i + 1]; })();
var wx = WX[wxName];
if (wx === undefined) { console.error('unknown weather: ' + wxName); process.exit(1); }

var Plan = sandbox.Plan, Episodes = sandbox.Episodes;

function build(date) {
	return Plan.compose(date, Plan.planWeather(wx, date), LIB.cands, LIB.timeFactor);
}

/* local date, not UTC - toISOString() renders local midnight in Minsk as the
 * previous day, which made the birthday check look like it fired on the 6th */
function ymd(d) {
	return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) +
		'-' + ('0' + d.getDate()).slice(-2);
}

var CATALOGUE = {};
Episodes.list().forEach(function (e) { CATALOGUE[e.id] = e.label; });

function report(title, dates) {
	console.log('\n' + '='.repeat(74));
	console.log(title + '   weather: ' + wxName);
	console.log('='.repeat(74));

	var seen = {}, totals = [];

	dates.forEach(function (d, n) {
		var slots = build(d);
		totals.push(slots.length);
		var counts = {};
		slots.forEach(function (s) { counts[s.id] = (counts[s.id] || 0) + 1; seen[s.id] = 1; });

		var names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		var head = '\n  #' + (n + 1) + '  ' + names[d.getDay()] + ' ' + ymd(d) +
			'   ' + slots.length + ' animations, ' + Object.keys(counts).length + ' distinct' +
			'   ' + Plan.clock(slots[0].m) + '-' + Plan.clock(slots[slots.length - 1].m);
		console.log(head);

		/* the checks that matter */
		var gaps = [];
		for (var i = 1; i < slots.length; i++) gaps.push(slots[i].m - slots[i - 1].m);
		gaps.sort(function (a, b) { return a - b; });
		console.log('      gap min/med/max: ' + gaps[0] + ' / ' +
			gaps[Math.floor(gaps.length / 2)] + ' / ' + gaps[gaps.length - 1] + ' min');

		var perHour = {};
		slots.forEach(function (s) { var h = Math.floor(s.m / 60); perHour[h] = (perHour[h] || 0) + 1; });
		var hrs = Object.keys(perHour).sort(function (a, b) { return a - b; });
		console.log('      per hour: ' + hrs.map(function (h) {
			return Plan.clock(h * 60).slice(0, 2) + ':' + perHour[h];
		}).join(' '));

		/* the time-bound ones - the whole reason this file exists */
		['lunch', 'desk_work', 'tea_break', 'morning_stretch', 'moongaze', 'sunset_settle']
			.forEach(function (id) {
				if (!CATALOGUE[id]) return;
				var at = slots.filter(function (s) { return s.id === id; }).map(function (s) { return Plan.clock(s.m); });
				console.log('      ' + (at.length ? 'OK  ' : '--  ') + id +
					(at.length ? ': ' + at.join(', ') : ': not today'));
			});

		if (full) slots.forEach(function (s) { console.log('        ' + Plan.clock(s.m) + '  ' + s.id); });
		else {
			var top = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
			console.log('      most: ' + top.slice(0, 6).map(function (k) {
				return k + ' x' + counts[k];
			}).join(', '));
		}
	});

	var avg = totals.reduce(function (a, b) { return a + b; }, 0) / totals.length;
	console.log('\n  ' + dates.length + ' days: ' + Math.round(avg) + ' animations/day average, ' +
		Object.keys(seen).length + ' of ' + Episodes.list().length + ' episodes used across them');

	var never = Episodes.list().filter(function (e) { return !seen[e.id]; }).map(function (e) { return e.id; });
	if (never.length) console.log('  never scheduled: ' + never.join(', '));
	return seen;
}

/* Mondays and Saturdays, five of each, all in 2026 */
function pick(dow, n) {
	var out = [], d = new Date(2026, 8, 1);
	while (out.length < n) {
		if (d.getDay() === dow) out.push(new Date(d.getTime()));
		d.setDate(d.getDate() + 1);
	}
	return out;
}

/* --json  ->  the whole thing as data, for the review page */
if (argv.indexOf('--json') !== -1) {
	var out = { weather: wxName, catalogue: {}, days: [],
	            sunrise: wx ? Plan.clock(wx.sunriseMin) : null,
	            sunset: wx ? Plan.clock(wx.sunsetMin) : null,
	            perHour: sandbox.cat_plan_per_hour,
	            quiet: [sandbox.cat_quiet_from, sandbox.cat_quiet_to],
	            work: [sandbox.cat_work_from, sandbox.cat_work_to],
	            lunchWin: [sandbox.cat_lunch_from, sandbox.cat_lunch_to] };
	Episodes.list().forEach(function (e) { out.catalogue[e.id] = { label: e.label, dur: e.dur }; });
	[[1, 'working day'], [6, 'holiday']].forEach(function (kind) {
		pick(kind[0], 5).forEach(function (d) {
			var slots = build(d);
			out.days.push({
				kind: kind[1],
				date: ymd(d),
				dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()],
				slots: slots.map(function (s) { return { at: Plan.clock(s.m), id: s.id }; })
			});
		});
	});
	console.log(JSON.stringify(out));
	process.exit(0);
}

/* The once-a-year ones. If these are not on the schedule for their own day
 * they will never be seen at all, so they are worth checking by name.        */
if (argv.indexOf('--special') !== -1) {
	[['birthday', new Date(2026, 10, 7)], ['new year', new Date(2026, 11, 31)],
	 ['new year eve', new Date(2026, 11, 24)]].forEach(function (pair) {
		var slots = build(pair[1]);
		var special = slots.filter(function (s) {
			return ['birthday', 'newyear', 'gift_leaf'].indexOf(s.id) !== -1;
		});
		console.log('  ' + ymd(pair[1]) + '  ' + pair[0] +
			': ' + (special.length
				? special.map(function (s) { return s.id + ' @ ' + Plan.clock(s.m); }).join(', ')
				: 'NOTHING SPECIAL'));
	});
	process.exit(0);
}

var a = report('FIVE WORKING DAYS (Mondays)', pick(1, 5));
var b = report('FIVE HOLIDAYS (Saturdays)', pick(6, 5));

console.log('\n' + '='.repeat(74));
console.log('WORKING DAY vs HOLIDAY');
console.log('='.repeat(74));
var onlyWork = Object.keys(a).filter(function (k) { return !b[k]; });
var onlyRest = Object.keys(b).filter(function (k) { return !a[k]; });
console.log('  weekdays only : ' + (onlyWork.join(', ') || '(none)'));
console.log('  weekends only : ' + (onlyRest.join(', ') || '(none)'));
console.log('');
