/* Build step. No dependencies - run with plain node.
 *
 *   node tools/build.js
 *
 * Produces:
 *   informer.html                 <- the single file the phone runs
 *   android/assets/informer.html  <- same file, for the APK
 *   tools/studio.built.html       <- the animation studio
 *
 * The phone only ever receives one self-contained .html, so every module is
 * inlined here in dependency order.
 *
 * THIS BUILD READS NOTHING PRIVATE. The forecast is free and keyless and the
 * place is chosen on the phone, so there is no key and no coordinates to
 * substitute - and .local/ is never opened (check-settings.js asserts it). As
 * a last line, every output is refused (exit 1, nothing written) if it
 * mentions yandex or holds anything shaped like a 36-character key.
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

/* ---- what may not ship ---- */
var FORBIDDEN = [
	[/yandex/i, 'mentions yandex'],
	[/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, 'holds a 36-character key-shaped string']
];

var outputs = [];          /* [path, content], written only once all pass */

function emit(p, s) { outputs.push([p, s]); }

function guard() {
	var bad = [];
	outputs.forEach(function (o) {
		FORBIDDEN.forEach(function (f) {
			var m = f[0].exec(o[1]);
			if (m) bad.push(o[0] + ' ' + f[1] + ' at offset ' + m.index);
		});
	});
	if (bad.length) {
		bad.forEach(function (b) { console.log('  !! ' + b); });
		console.log('FAILED: nothing written.');
		process.exit(1);
	}
}

function writeAll() {
	outputs.forEach(function (o) {
		var full = path.join(root, o[0]);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, o[1], 'utf8');
		console.log('  ' + o[0] + '  (' + (o[1].length / 1024).toFixed(1) + ' KB)');
	});
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
	'src/core/settings.js',
	'src/core/host.js',
	'src/core/i18n.js',
	'src/core/places.js',
	'src/core/bus.js',
	'src/core/view.js',
	'src/core/wxsource.js',
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
	'src/cat/scenes-winter.js',
	'src/cat/episodes.js',
	'src/cat/plan.js',
	'src/cat/cat.js',
	'src/core/settings-ui.js',
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

/* ---- the deploy artifact ---- */
if (exists('src/informer.base.html')) {
	var page = read('src/informer.base.html')
		.split('<!--INJECT:CAT_SVG-->').join(catSvg)
		.split('<!--INJECT:JS-->').join(bundle());

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

	emit('informer.html', page);
	emit('android/assets/informer.html', page);
} else {
	console.log('  !! src/informer.base.html missing - skipping informer build');
}

/* ---- the studio needs the engine, but not the forecast plumbing ---- */
var STUDIO_MODULES = [
	'src/core/dom.js', 'src/core/store.js', 'src/core/host.js', 'src/core/bus.js',
	'src/cat/shapes.js', 'src/cat/rig.js', 'src/cat/anim.js', 'src/cat/alive.js',
	'src/cat/wardrobe.js', 'src/cat/actions.js', 'src/cat/props.js',
	'src/cat/beats.js', 'src/cat/scenes.js', 'src/cat/scenes-winter.js', 'src/cat/plan.js'
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
	emit('tools/studio.built.html', read('tools/studio.html')
		.split('<!--INJECT:CAT_SVG-->').join(catSvg)
		.split('<!--INJECT:JS_ENGINE-->').join(bundleOf(STUDIO_MODULES)));
}

guard();
writeAll();
console.log('done.');
