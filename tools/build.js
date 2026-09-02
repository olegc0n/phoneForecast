/* Build step. No dependencies - run with plain node.
 *
 *   node tools/build.js
 *
 * Produces:
 *   informer.html                          <- the single file the phone runs
 *   android/assets/informer.html  <- same file, for the APK
 *
 * The phone only ever receives one self-contained .html, so every module is
 * inlined here in dependency order.
 */
var fs = require('fs');
var path = require('path');
var root = path.join(__dirname, '..');

/* node tools/build.js --debug   ->  turns on the on-screen fps/state overlay */
var DEBUG  = process.argv.indexOf('--debug')  !== -1;
var TEST   = process.argv.indexOf('--test')   !== -1;   /* on-screen episode menu */
var RANDOM = process.argv.indexOf('--random') !== -1;   /* let episodes fire by themselves */
/* --plandemo -> ignore today's real schedule and run three animations in the
 * next five minutes, to prove the scheduler actually drives the app */
var PLANDEMO = process.argv.indexOf('--plandemo') !== -1;

function read(p) { return fs.readFileSync(path.join(root, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(root, p)); }
function write(p, s) {
	var full = path.join(root, p);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, s, 'utf8');
	console.log('  ' + p + '  (' + (s.length / 1024).toFixed(1) + ' KB)');
}

/* ---- the cat artwork, made to fill whatever box it is dropped into ---- */
var catSvg = read('src/cat/cat.svg')
	.replace(/<\?xml[^>]*\?>\s*/, '')
	.replace(/ width="200" height="262"/, ' width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');

/* ---- JS modules, in load order. Order matters: dom before everything,
       bus before anything that emits, rig before anim, boot last. ---- */
var MODULES = [
	'src/core/dom.js',
	'src/core/store.js',
	'src/core/host.js',
	'src/core/bus.js',
	'src/core/view.js',
	'src/core/weather.js',
	'src/core/clock.js',
	'src/cat/shapes.js',
	'src/cat/rig.js',
	'src/cat/anim.js',
	'src/cat/alive.js',
	'src/cat/wardrobe.js',
	'src/cat/actions.js',
	'src/cat/props.js',
	'src/cat/beats.js',
	'src/cat/scenes.js',
	'src/cat/episodes.js',
	'src/cat/plan.js',
	'src/cat/cat.js',
	'src/core/boot.js'
];

function bundle() {
	var out = [];
	MODULES.forEach(function (m) {
		if (!exists(m)) { console.log('  !! missing module ' + m); return; }
		out.push('/* ==================== ' + m + ' ==================== */');
		out.push(read(m).replace(/\s+$/, ''));
		out.push('');
	});
	return '<script>\n' + out.join('\n') + '\n</script>';
}

console.log('build:');

/* ---- the real key, if this machine has one ----
 *
 * The repository ships a placeholder API key and the coordinates of the city
 * rather than of a building, because it is published. A private
 * .local/config.json - gitignored - overrides both at build time, so the working
 * copy builds against the real thing without the real thing ever being tracked.
 *
 * Missing file, missing key: the placeholder stands, and the app runs with no
 * weather at all, which it is built to survive.                              */
function localConfig() {
	try {
		var raw = fs.readFileSync(path.join(root, '.local', 'config.json'), 'utf8');
		return JSON.parse(raw);
	} catch (e) {
		return null;
	}
}

/* ---- the deploy artifact ---- */
if (exists('src/informer.base.html')) {
	var page = read('src/informer.base.html')
		.split('<!--INJECT:CAT_SVG-->').join(catSvg)
		.split('<!--INJECT:JS-->').join(bundle());

	var local = localConfig();
	if (local) {
		if (local.api) page = page.replace(
			"var api = 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx';",
			"var api = '" + local.api + "';");
		if (local.lat !== undefined) page = page.replace('var lat = 53.9;', 'var lat = ' + local.lat + ';');
		if (local.lon !== undefined) page = page.replace('var lon = 27.56;', 'var lon = ' + local.lon + ';');
		console.log('  (local key and coordinates from .local/config.json)');
	} else {
		console.log('  (no .local/config.json - placeholder key, no weather)');
	}

	/* Stamp the build. The plan is cached for the day, so without this a new APK
	 * installed at noon keeps the schedule the old one wrote and any change to
	 * the shaping only appears after midnight. */
	var stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
	page = page.replace("var cat_build         = 'dev';", "var cat_build         = '" + stamp + "';");

	if (process.argv.indexOf('--noalive') !== -1) {
		/* the cat is there and the loop runs, but the procedural layer writes
		 * nothing - isolates "she is on screen" from "she is moving" */
		page = page.replace('Alive.step(dt);', '/* Alive.step(dt); */');
		console.log('  (ALIVE LAYER OFF - for CPU baselines)');
	}

	if (process.argv.indexOf('--nocat') !== -1) {
		page = page.replace('var cat_enabled       = true;', 'var cat_enabled       = false;');
		console.log('  (CAT DISABLED - forecast only, for CPU baselines)');
	}

	if (DEBUG) {
		page = page.replace('var cat_debug         = false;', 'var cat_debug         = true;');
		console.log('  (debug overlay ON)');
	}
	if (TEST) {
		page = page.replace('var cat_test          = false;', 'var cat_test          = true;');
		console.log('  (episode test menu ON)');
	}
	if (RANDOM) {
		page = page.replace('var cat_episodes_random = false;', 'var cat_episodes_random = true;');
		console.log('  (random episodes ON)');
	}
	if (PLANDEMO) {
		page = page.replace('var cat_plan_demo     = false;', 'var cat_plan_demo     = true;');
		console.log('  (PLAN DEMO: 3 animations in the next 5 minutes)');
	}

	write('informer.html', page);
	write('android/assets/informer.html', page);
} else {
	console.log('  !! src/informer.base.html missing - skipping informer build');
}

/* ---- the studio needs the engine, but not the forecast plumbing ---- */
var STUDIO_MODULES = [
	'src/core/dom.js', 'src/core/store.js', 'src/core/host.js', 'src/core/bus.js',
	'src/cat/shapes.js', 'src/cat/rig.js', 'src/cat/anim.js', 'src/cat/alive.js',
	'src/cat/wardrobe.js', 'src/cat/actions.js', 'src/cat/props.js',
	'src/cat/beats.js', 'src/cat/scenes.js', 'src/cat/plan.js'
];

function bundleOf(list) {
	var out = [];
	list.forEach(function (m) {
		if (!exists(m)) { console.log('  !! missing module ' + m); return; }
		out.push('/* ==================== ' + m + ' ==================== */');
		out.push(read(m).replace(/\s+$/, ''));
		out.push('');
	});
	return '<script>\n' + out.join('\n') + '\n</' + 'script>';
}

if (exists('tools/studio.html')) {
	write('tools/studio.built.html', read('tools/studio.html')
		.split('<!--INJECT:CAT_SVG-->').join(catSvg)
		.split('<!--INJECT:JS_ENGINE-->').join(bundleOf(STUDIO_MODULES)));
}

console.log('done.');
