/* wallpaper-modules.js - the live wallpaper's load order, derived from the informer's.
 *
 *   node -e "console.log(require('./tools/wallpaper-modules.js').list())"
 *
 * The wallpaper bundles the same cat engine as the informer, so its module list is
 * not typed out here: it is read from `MODULES` in tools/build.js. A scene file
 * added on main (src/cat/scenes-*.js) is therefore bundled by the wallpaper with no
 * change on this branch, which is what keeps the branch merge-free.
 *
 * First of all, before anything else can capture the native timer functions:
 *   src/wallpaper/timers.js                        the per-page timer gate
 * What is kept, in the informer's order:
 *   src/core/dom.js, store.js, host.js, bus.js     the helpers the cat needs
 *   every src/cat/* entry                          the engine and the scenes
 * What changes:
 *   src/cat/plan.js  ->  src/wallpaper/sky.js, shuffle.js, plan-random.js
 *   appended         ->  src/wallpaper/wall-tick.js, still.js, wall.js, wall-boot.js
 * Everything else in src/core (the forecast, the settings dialog, boot.js) is
 * left out.
 *
 * It fails loudly rather than guessing: if build.js is reshaped so that the
 * literal cannot be found, or one of the modules the wallpaper leans on is gone,
 * list() throws and the build stops.                                          */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

var CORE_KEEP = ['src/core/dom.js', 'src/core/store.js', 'src/core/host.js', 'src/core/bus.js'];
var REQUIRED = ['src/core/dom.js', 'src/core/bus.js', 'src/cat/plan.js',
                'src/cat/episodes.js', 'src/cat/cat.js'];
var HEAD = ['src/wallpaper/timers.js'];
var PLAN_STANDIN = ['src/wallpaper/sky.js', 'src/wallpaper/shuffle.js', 'src/wallpaper/plan-random.js'];
var WALL_TAIL = ['src/wallpaper/wall-tick.js', 'src/wallpaper/still.js', 'src/wallpaper/wall.js',
                 'src/wallpaper/wall-boot.js'];

/* The informer's MODULES array, as written in tools/build.js. */
function informerModules() {
	var src = fs.readFileSync(path.join(ROOT, 'tools', 'build.js'), 'utf8');
	var m = /var MODULES\s*=\s*\[([\s\S]*?)\];/.exec(src);
	if (!m) throw new Error('wallpaper-modules: "var MODULES = [...]" not found in tools/build.js');
	var out = [], re = /'([^']+)'|"([^"]+)"/g, s;
	while ((s = re.exec(m[1]))) out.push(s[1] || s[2]);
	if (!out.length) throw new Error('wallpaper-modules: MODULES in tools/build.js is empty');
	return out;
}

function list() {
	var all = informerModules();
	REQUIRED.forEach(function (r) {
		if (all.indexOf(r) === -1) throw new Error('wallpaper-modules: ' + r + ' is not in MODULES in tools/build.js');
	});

	var out = HEAD.slice();
	all.forEach(function (m) {
		if (CORE_KEEP.indexOf(m) !== -1) { out.push(m); return; }
		if (m === 'src/cat/plan.js') { out.push.apply(out, PLAN_STANDIN); return; }
		if (m.indexOf('src/cat/') === 0) out.push(m);
	});
	out.push.apply(out, WALL_TAIL);
	return out;
}

module.exports = { list: list, informerModules: informerModules, HEAD: HEAD };
