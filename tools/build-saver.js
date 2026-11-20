/* build-saver.js - the screen saver page. No dependencies - run with plain node.
 *
 *   node tools/build-saver.js            saver.html + android-saver/assets/saver.html
 *   node tools/build-saver.js --debug    the same, with the fps/state overlay on
 *
 * The saver shares the informer's cat but none of its forecast, so very little
 * of the page is its own: src/saver.base.html holds the markup, the saver's CSS
 * and config, and four markers that this fills in from the shared sources.
 *
 *   <!--INJECT:CAT_CONFIG-->   the cat_* / app_* lines of src/informer.base.html
 *   <!--INJECT:CAT_CSS-->      every #cat_ rule in src/informer.base.html
 *   <!--INJECT:CAT_SVG-->      src/cat/cat.svg, sized to fill its box
 *   <!--INJECT:JS-->           every module in tools/saver-modules.js, in order
 *
 * Nothing is copied by hand, so a merge from main that changes the cat's config,
 * its CSS or its scene list is picked up with no edit on this branch.
 *
 * No silent replace(): unlike build.js, every substitution here goes through a
 * helper that stops the build when the text it expects is not there. It never
 * reads .local/config.json - the saver has no key and no coordinates - and it
 * refuses to write a page that mentions the forecast API.                     */

var fs = require('fs');
var path = require('path');
var SaverModules = require('./saver-modules.js');

var ROOT = path.join(__dirname, '..');
var MARKERS = ['<!--INJECT:CAT_CONFIG-->', '<!--INJECT:CAT_CSS-->',
               '<!--INJECT:CAT_SVG-->', '<!--INJECT:JS-->'];

function read(p) { return fs.readFileSync(path.join(ROOT, p), 'utf8'); }
function exists(p) { return fs.existsSync(path.join(ROOT, p)); }

function die(msg) {
	var e = new Error(msg);
	e.saverBuild = true;
	throw e;
}

/* The one way text gets substituted: `target` must occur exactly once. */
function inject(page, target, text, what) {
	var parts = page.split(target);
	if (parts.length !== 2) {
		die((what || target) + ': expected exactly one "' + target + '", found ' + (parts.length - 1));
	}
	return parts[0] + text + parts[1];
}

/* ---- the cat's config, as the informer ships it ---- */
function catConfig() {
	var lines = read('src/informer.base.html').split('\n').filter(function (l) {
		return /^var (cat|app)_[a-z_]+ *=/.test(l);
	});
	['cat_enabled', 'cat_quiet_from', 'cat_quiet_to', 'cat_build', 'cat_debug', 'app_log'].forEach(function (n) {
		var re = new RegExp('^var ' + n + ' *=');
		if (!lines.some(function (l) { return re.test(l); })) {
			die('CAT_CONFIG: "var ' + n + '" not found in src/informer.base.html');
		}
	});
	return lines.join('\n');
}

/* ---- the saver's own config block, read from its base page ----
 * Only for the offline harness, which has no built page to read; the build
 * itself simply leaves the block where it is. */
function saverConfig() {
	return read('src/saver.base.html').split('\n').filter(function (l) {
		return /^var [a-z_]+ *=/.test(l);
	}).join('\n');
}

/* ---- every #cat_ rule in the informer's CSS ----
 * The CSS is flat - no media queries, no nesting - so a rule is a selector and
 * one brace pair. Only the <style> blocks are searched. */
function catCss() {
	var html = read('src/informer.base.html');
	var styles = [], re = /<style>([\s\S]*?)<\/style>/g, m;
	while ((m = re.exec(html))) styles.push(m[1]);
	if (!styles.length) die('CAT_CSS: no <style> block in src/informer.base.html');

	var rules = [], selectors = [];
	styles.join('\n').replace(/#cat_[^{}]*\{[^}]*\}/g, function (rule) {
		rules.push(rule);
		selectors.push(rule.slice(0, rule.indexOf('{')).replace(/\s+/g, ' ').trim());
		return rule;
	});
	['#cat_stage', '#cat_holder', '#cat_props div'].forEach(function (s) {
		if (selectors.indexOf(s) === -1) die('CAT_CSS: no "' + s + '" rule in src/informer.base.html');
	});
	return rules.join('\n');
}

/* ---- the artwork: the same two changes build.js makes, checked ---- */
function catSvg() {
	var svg = read('src/cat/cat.svg').replace(/<\?xml[^>]*\?>\s*/, '');
	if (/<\?xml/.test(svg)) die('CAT_SVG: could not strip the <?xml ?> prolog from src/cat/cat.svg');
	var sized = svg.replace(/ width="200" height="262"/,
		' width="100%" height="100%" preserveAspectRatio="xMidYMid meet"');
	if (sized === svg) die('CAT_SVG: \' width="200" height="262"\' not found in src/cat/cat.svg');
	return sized;
}

/* ---- the scripts ---- */
function bundle() {
	var out = [];
	SaverModules.list().forEach(function (m) {
		if (!exists(m)) die('JS: missing module ' + m);
		out.push('/* ==================== ' + m + ' ==================== */');
		out.push(read(m).replace(/\s+$/, ''));
		out.push('');
	});
	return '<script>\n' + out.join('\n') + '\n</' + 'script>';
}

/* The whole page, as a string. `opts.debug` turns the overlay on; `opts.stamp`
 * overrides the build stamp (the harness uses a fixed one). */
function page(opts) {
	opts = opts || {};
	var html = read('src/saver.base.html');
	MARKERS.forEach(function (mk) {
		if (html.split(mk).length !== 2) die('src/saver.base.html: expected exactly one ' + mk);
	});

	var stamp = opts.stamp || new Date().toISOString().slice(0, 16).replace('T', ' ');
	var config = catConfig() +
		'\n/* stamped by tools/build-saver.js */' +
		"\nvar cat_build = '" + stamp + "';" +
		(opts.debug ? '\nvar cat_debug = true;' : '');

	html = inject(html, MARKERS[0], config, 'CAT_CONFIG');
	html = inject(html, MARKERS[1], catCss(), 'CAT_CSS');
	html = inject(html, MARKERS[2], catSvg(), 'CAT_SVG');
	html = inject(html, MARKERS[3], bundle(), 'JS');

	/* The forecast must not have come along with the cat. */
	if (/yandex/i.test(html)) die('the page mentions yandex - forecast code has leaked into the saver');
	if (/^var api(_url)?\s*=/m.test(html)) die('the page declares the API key config (var api)');
	if (/#wx_stale|id="wx_stale"/.test(html)) die('the page has the forecast\'s #wx_stale badge');
	if (/<!--INJECT:/.test(html)) die('an INJECT marker was left in the page');
	return html;
}

function write(p, s) {
	var full = path.join(ROOT, p);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, s, 'utf8');
	console.log('  ' + p + '  (' + (s.length / 1024).toFixed(1) + ' KB)');
}

function main() {
	var debug = process.argv.indexOf('--debug') !== -1;
	console.log('build-saver:');
	var html;
	try {
		html = page({ debug: debug });
	} catch (e) {
		console.error('  !! ' + (e.saverBuild ? e.message : (e.stack || e)));
		console.error('build-saver FAILED - nothing written.');
		process.exit(1);
	}
	if (debug) console.log('  (debug overlay ON)');
	console.log('  ' + SaverModules.list().length + ' modules');
	write('saver.html', html);
	write('android-saver/assets/saver.html', html);
	console.log('done.');
}

module.exports = { page: page, catConfig: catConfig, saverConfig: saverConfig,
                   catCss: catCss, catSvg: catSvg, MARKERS: MARKERS };

if (require.main === module) main();
