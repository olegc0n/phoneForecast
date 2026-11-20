/* saver-modules.js - the screen saver's load order, derived from the informer's.
 *
 *   node -e "console.log(require('./tools/saver-modules.js').list())"
 *
 * The saver bundles the same cat engine as the informer, so its module list is
 * not typed out here: it is read from `MODULES` in tools/build.js. A scene file
 * added on main (src/cat/scenes-*.js) is therefore bundled by the saver with no
 * change on this branch, which is what keeps the branch merge-free.
 *
 * What is kept, in the informer's order:
 *   src/core/dom.js, store.js, host.js, bus.js     the helpers the cat needs
 *   every src/cat/* entry                          the engine and the scenes
 * What changes:
 *   src/cat/plan.js  ->  src/saver/sky.js, shuffle.js, plan-random.js
 *   appended         ->  src/saver/saver-clock.js, saver.js, saver-boot.js
 * Everything else in src/core (the forecast, the settings dialog, boot.js) is
 * left out.
 *
 * It fails loudly rather than guessing: if build.js is reshaped so that the
 * literal cannot be found, or one of the modules the saver leans on is gone,
 * list() throws and the build stops.                                          */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');

var CORE_KEEP = ['src/core/dom.js', 'src/core/store.js', 'src/core/host.js', 'src/core/bus.js'];
var REQUIRED = ['src/core/dom.js', 'src/core/bus.js', 'src/cat/plan.js',
                'src/cat/episodes.js', 'src/cat/cat.js'];
var PLAN_STANDIN = ['src/saver/sky.js', 'src/saver/shuffle.js', 'src/saver/plan-random.js'];
var SAVER_TAIL = ['src/saver/saver-clock.js', 'src/saver/saver.js', 'src/saver/saver-boot.js'];

/* The informer's MODULES array, as written in tools/build.js. */
function informerModules() {
	var src = fs.readFileSync(path.join(ROOT, 'tools', 'build.js'), 'utf8');
	var m = /var MODULES\s*=\s*\[([\s\S]*?)\];/.exec(src);
	if (!m) throw new Error('saver-modules: "var MODULES = [...]" not found in tools/build.js');
	var out = [], re = /'([^']+)'|"([^"]+)"/g, s;
	while ((s = re.exec(m[1]))) out.push(s[1] || s[2]);
	if (!out.length) throw new Error('saver-modules: MODULES in tools/build.js is empty');
	return out;
}

function list() {
	var all = informerModules();
	REQUIRED.forEach(function (r) {
		if (all.indexOf(r) === -1) throw new Error('saver-modules: ' + r + ' is not in MODULES in tools/build.js');
	});

	var out = [];
	all.forEach(function (m) {
		if (CORE_KEEP.indexOf(m) !== -1) { out.push(m); return; }
		if (m === 'src/cat/plan.js') { out.push.apply(out, PLAN_STANDIN); return; }
		if (m.indexOf('src/cat/') === 0) out.push(m);
	});
	out.push.apply(out, SAVER_TAIL);
	return out;
}

module.exports = { list: list, informerModules: informerModules };
