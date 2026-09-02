/* check-wardrobe.js - can Lili get stuck in the wrong clothes?
 *
 *   node tools/check-wardrobe.js
 *
 * Loads the REAL src/cat/wardrobe.js and records what it makes visible, so the
 * answers are the app's own. Written after she was seen wearing sunglasses after
 * sunset and then taking them to bed.
 *
 * Two separate faults produced that, and both are checked here:
 *   - the outfit only changed when a new forecast arrived, so sunset passed
 *     unnoticed. That fix lives in cat.js (dress() on the minute tick) and shows
 *     up here as "night never wears sunglasses" for every temperature.
 *   - Wardrobe.set() returned early when the outfit NAME was unchanged, so
 *     anything a scene had put in her hands stayed there.
 */

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..');
var read = function (p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); };

/* ---- record what is visible, rather than pretending to animate it ---- */
var visible = {};

/* A tween QUEUE, not an instant write.
 *
 * The interesting bug in this file needs tweens that can be thrown away
 * half-finished, which is what Anim.clear() does - so the stub has to model the
 * queue rather than pretend a fade completes the moment it is asked for. */
var queue = [];

var sandbox = {
	console: console, Math: Math, Date: Date,
	Anim: {
		tween: function (part, key, to) {
			if (key === 'o') queue.push([part, to > 0.5]);
		}
	},
	/* Rig.set is the direct write - no tween, cannot be cancelled */
	Rig: {
		set: function (part, key, to) {
			if (key === 'o') visible[part] = to > 0.5;
		}
	}
};

function flush() {
	for (var i = 0; i < queue.length; i++) visible[queue[i][0]] = queue[i][1];
	queue = [];
}
function animClear() { queue = []; }        /* exactly what Anim.clear() does */
sandbox.window = sandbox;

var ctx = vm.createContext(sandbox);
vm.runInContext(read('src/cat/wardrobe.js'), ctx, { filename: 'wardrobe.js' });
var W = sandbox.Wardrobe;

function on(g) { flush(); return visible[g] === true; }
function wornList() {
	flush();
	var out = [];
	for (var k in visible) if (visible[k]) out.push(k.replace(/^w/, ''));
	return out.length ? out.join(' + ') : 'nothing';
}

var pass = 0, fail = 0;
function check(name, cond, detail) {
	console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : ''));
	if (cond) pass++; else fail++;
}

function wx(o) {
	var base = { temp: 15, sky: 'ovc', precip: null, isNight: false,
	             isThunder: false, wind: 3 };
	for (var k in o) base[k] = o[k];
	return base;
}

console.log('\n' + '='.repeat(70));
console.log('WARDROBE');
console.log('='.repeat(70));

/* ---------------------------------------------------------- the day ladder */
console.log('\nwhat she wears, by weather (daytime)');
[
	['freezing -10',      wx({ temp: -10 }),                        'WarmHat + Scarf'],
	['zero',              wx({ temp: 0 }),                          'WarmHat + Scarf'],
	['cool 10, overcast', wx({ temp: 10 }),                         'nothing'],
	['17 and clear',      wx({ temp: 17, sky: 'skc' }),             'Cap + Sunglasses'],
	['17 and overcast',   wx({ temp: 17, sky: 'ovc' }),             'nothing'],
	['20 warm',           wx({ temp: 20, sky: 'skc' }),             'Cap + Sunglasses + Soda'],
	['24 hot',            wx({ temp: 24, sky: 'skc' }),             'Cap + Sunglasses + IceCream'],
	['raining',           wx({ temp: 9, precip: 'ra' }),            'Coat + Umbrella'],
	['snowing',           wx({ temp: -3, precip: 'sn' }),           'WarmHat + Scarf'],
	['windy 14',          wx({ temp: 12, wind: 14 }),               'Scarf']
].forEach(function (row) {
	visible = {}; W.bare();
	visible = {};
	W.forWeather(row[1]);
	check(row[0], wornList() === row[2], wornList() + '  (' + W.current() + ')');
});

/* ------------------------------------------------- the night, every temperature */
console.log('\nafter sunset, nothing sun-related survives');
var sunAccessories = ['wSunglasses', 'wCap'];
[-10, 0, 5, 10, 15, 17, 19, 20, 22, 24, 27].forEach(function (t) {
	visible = {}; W.bare();
	/* dress her for a hot clear day first, so there is something to take off */
	W.forWeather(wx({ temp: 24, sky: 'skc' }));
	var before = wornList();
	/* then the sun goes down at the same temperature */
	W.forWeather(wx({ temp: t, sky: 'skc', isNight: true }));
	var bad = sunAccessories.filter(on).map(function (g) { return g.replace(/^w/, ''); });
	check('night at ' + (t > 0 ? '+' : '') + t, bad.length === 0,
		before + '  ->  ' + wornList() + (bad.length ? '   STUCK: ' + bad.join(', ') : ''));
});

/* ------------------------------------------------- a scene leaving things behind */
console.log('\nthings a scene put on her come back off');
var scenarios = [
	['ice cream, same weather afterwards', 'wIceCream', wx({ temp: 17, sky: 'skc' })],
	['soda, then rain',                    'wSoda',     wx({ temp: 9, precip: 'ra' })],
	['umbrella, then a clear day',         'wUmbrella', wx({ temp: 17, sky: 'skc' })],
	['warm hat, then a hot day',           'wWarmHat',  wx({ temp: 24, sky: 'skc' })],
	['scarf, then a mild day',             'wScarf',    wx({ temp: 12 })]
];
scenarios.forEach(function (row) {
	var garment = row[1], weather = row[2];

	/* does this weather's own outfit include the garment? if so, it staying on
	 * is correct rather than stuck, and the check has to allow for it */
	visible = {}; W.bare(); visible = {};
	W.forWeather(weather);
	var belongs = on(garment);

	/* settle into the outfit, let a scene add something, then let the SAME
	 * weather come round again - which is the case that used to do nothing */
	visible = {}; W.bare(); visible = {};
	W.forWeather(weather);
	W.wear(garment);
	var mid = wornList();
	W.forWeather(weather);

	check(row[0], on(garment) === belongs, mid + '  ->  ' + wornList());
});

/* ------------------------------------------------------------------ bedtime */
console.log('\nbedtime');
visible = {}; W.bare(); visible = {};
W.forWeather(wx({ temp: 24, sky: 'skc' }));
check('dressed for a hot day', wornList() === 'Cap + Sunglasses + IceCream', wornList());
W.bare();
check('bare() leaves nothing on', wornList() === 'nothing', wornList());

/* ------------------------------------- a fade cancelled mid-flight -------------
 *
 * THE RAINCOAT-AND-SUNGLASSES BUG, reproduced.
 *
 * Reported after a long test on the phone: she was seen in a raincoat and an
 * umbrella AND a cap and sunglasses at the same time.
 *
 * Taking a garment off is a tween on its opacity, and Anim.clear() bins pending
 * tweens - it runs at the start and the end of every animation, on a touch, on
 * the back button and at bedtime. The bookkeeping in `worn` is updated
 * synchronously, so a fade-out cancelled a few hundred milliseconds in leaves
 * the garment on screen with nothing that will ever remove it: its slot is
 * already empty, so no later reconcile touches it.
 *
 * That is why it was intermittent, and why it took a long run to see it. */
console.log('\na fade cancelled by Anim.clear()');

visible = {}; queue = [];
W.bare(); flush();
W.forWeather(wx({ temp: 24, sky: 'skc' })); flush();
check('dressed for a hot clear day', wornList() === 'Cap + Sunglasses + IceCream', wornList());

/* the weather turns, and an animation starts before the fades finish */
W.forWeather(wx({ temp: 9, precip: 'ra' }));
animClear();
var stranded = ['wCap', 'wSunglasses', 'wIceCream'].filter(function (g) { return visible[g]; });
check('without the fix the old outfit is stranded on screen', stranded.length === 3,
	stranded.map(function (g) { return g.replace(/^w/, ''); }).join(' + ') + ' left behind');

/* which is what Wardrobe.sync() repairs */
W.sync();
check('sync() puts her in the raincoat and nothing else',
	wornList() === 'Coat + Umbrella', wornList());

/* and it is idempotent - calling it when nothing is wrong changes nothing */
var before = wornList();
W.sync(); W.sync();
check('sync() is idempotent', wornList() === before, wornList());

/* --------------------------------------------------- every garment is reachable */
console.log('\ncoverage');
var all = ['wCap', 'wWarmHat', 'wSunglasses', 'wScarf', 'wCoat',
           'wUmbrella', 'wIceCream', 'wSoda'];
var reachable = {};
W.names().forEach(function (n) {
	visible = {}; W.bare(); visible = {};
	W.set(n);
	all.forEach(function (g) { if (on(g)) reachable[g] = n; });
});
all.forEach(function (g) {
	check('reachable: ' + g.replace(/^w/, ''), !!reachable[g], reachable[g] || 'NO OUTFIT USES IT');
});

console.log('\n' + '='.repeat(70));
console.log(pass + ' passed, ' + fail + ' failed');
console.log('='.repeat(70) + '\n');
process.exit(fail ? 1 : 0);
