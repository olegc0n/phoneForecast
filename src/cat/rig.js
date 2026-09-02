/* rig.js - the pose layer.
 *
 * THE IMPORTANT IDEA HERE: every part has two channels.
 *
 *   pose  - authored motion. Actions and scenes tween this.
 *   add   - procedural motion. Weight shift, spring follow-through, blinks and
 *           micro-motion write this, every frame, forever.
 *
 * They are summed at flush time. That is what lets Lili keep blinking, keep
 * swaying and keep her tail trailing WHILE a scene is driving her body scale -
 * in v1 those fought each other over the same value, so the idle layer had to be
 * switched off during episodes, which is exactly why the scenes looked dead.
 *
 * Also here: SVG path morphing, so a shape can actually change instead of only
 * being rotated and scaled.
 *
 * Coordinates: world position is PERCENT OF THE STAGE. window.innerWidth is not
 * trustworthy on this page (a <meta viewport minimum-scale> plus a clock wider
 * than the screen), so the stage element is measured and used as the world.     */

var Rig = (function () {
	var PARTS = [
		'catRoot', 'spine', 'body', 'torso', 'vest', 'charm',
		'pawFL', 'pawFR', 'toesL', 'toesR', 'footL', 'footR',
		'tail', 'tail2', 'tail3',
		'neck', 'head', 'earL', 'earR', 'earInL', 'earInR',
		'eyeL', 'eyeR', 'pupilL', 'pupilR',
		'lidUpL', 'lidUpR', 'lidLoL', 'lidLoR', 'eyeLidL', 'eyeLidR',
		'muzzle', 'nose', 'jaw', 'mouthShape', 'bodyShape', 'cheekL', 'cheekR',
		'foreheadFlush', 'coldTint',
		'whiskerL', 'whiskerR',
		/* wardrobe: authored in the rig, so clothes inherit her motion */
		'wCap', 'wWarmHat', 'wPartyHat', 'wSunglasses', 'wScarf', 'wCoat',
		'wUmbrella', 'wIceCream', 'wSoda'
	];

	var el = {};
	var kind = {};               /* 'svg' | 'dom' */
	var pose = {};               /* authored channel   */
	var add = {};                /* procedural channel */
	var dirty = {};
	var dyn = [];                /* episode props, registered at runtime */

	var morph = {};              /* part -> {tpl, from, to, t, applied} */

	/* The last string actually written to each part.
	 *
	 * The procedural channel changes every single frame - the weight shift is a
	 * sine, the pupils ease exponentially towards their target - so those parts were
	 * marked dirty on every frame forever and rewritten every time. But the
	 * output is rounded to two or three decimals, and most of those frames round
	 * to exactly the same string: a sine at rest and an ease that has converged
	 * both stop moving long before the maths does. Comparing the string is what
	 * turns "always dirty" into "written when something visibly changed", and a
	 * skipped setAttribute is a skipped style recalculation and re-raster of that
	 * whole subtree - every fur shape here has a gradient and four clip paths.  */
	var lastT = {};
	var lastO = {};
	var holder = null, svg = null, stage = null;

	var world = { x: 0, y: 0, face: 1, scale: 1 };
	var worldDirty = true;
	var box = { w: 1, h: 1 };
	var catPx = 1;
	var size = { w: 34, h: 44.5 };

	function blank() { return { rot: 0, x: 0, y: 0, sx: 1, sy: 1, o: null }; }
	function blankAdd() { return { rot: 0, x: 0, y: 0, sx: 0, sy: 0 }; }

	function measure() {
		stage = stage || byId('cat_stage');
		if (!stage || !holder) return;
		box.w = stage.offsetWidth || 1;
		box.h = stage.offsetHeight || 1;
		catPx = holder.offsetWidth || 1;
		size.w = catPx / box.w * 100;
		size.h = (holder.offsetHeight || 1) / box.h * 100;
		worldDirty = true;
	}

	function init() {
		holder = byId('cat_holder');
		if (!holder) throw new Error('no #cat_holder');
		svg = holder.getElementsByTagName('svg')[0];
		if (!svg) throw new Error('no cat svg');

		for (var i = 0; i < PARTS.length; i++) {
			var name = PARTS[i];
			el[name] = svg.querySelector ? svg.querySelector('#' + name) : null;
			kind[name] = 'svg';
			pose[name] = blank();
			add[name] = blankAdd();
			dirty[name] = true;
		}
		measure();
		on(window, 'resize', measure);
		flush(true);
	}

	/* ---- dynamic parts: episode props ---- */

	function register(name, node, asKind) {
		el[name] = node;
		kind[name] = asKind || 'dom';
		pose[name] = blank();
		add[name] = blankAdd();
		dirty[name] = true;
		if (dyn.indexOf(name) === -1) dyn.push(name);
	}

	function unregister(name) {
		var i = dyn.indexOf(name);
		if (i !== -1) dyn.splice(i, 1);
		delete el[name]; delete kind[name];
		delete pose[name]; delete add[name]; delete dirty[name];
		delete lastT[name]; delete lastO[name]; delete morph[name];
	}

	function clearDynamic() { while (dyn.length) unregister(dyn[0]); }

	/* ---- the two channels ---- */

	/* 'world' is a virtual part, so travel and facing tween like anything else */
	function set(part, key, v) {
		/* A single NaN reaching an attribute poisons the whole transform and
		 * Chrome throws for every frame after. Swallow it here instead.        */
		if (v !== v) return;
		if (part === 'world') {
			if (world[key] === v) return;
			world[key] = v; worldDirty = true; return;
		}
		var p = pose[part];
		if (!p || p[key] === v) return;
		p[key] = v; dirty[part] = true;
	}

	function get(part, key) {
		if (part === 'world') return world[key];
		return pose[part] ? pose[part][key] : 0;
	}

	/* procedural channel - summed on top of whatever the scene is doing */
	function bias(part, key, v) {
		if (v !== v) return;
		var a = add[part];
		if (!a || a[key] === v) return;
		a[key] = v; dirty[part] = true;
	}

	function biasOf(part, key) { return add[part] ? add[part][key] : 0; }

	function reset(part) {
		var p = pose[part];
		if (!p) return;
		/* the cache is keyed on the string we last wrote; forget it, so the part
		 * is definitely repainted even if it happens to round back to that value */
		delete lastT[part]; delete lastO[part];
		p.rot = 0; p.x = 0; p.y = 0; p.sx = 1; p.sy = 1;
		dirty[part] = true;
	}

	function resetAll() {
		for (var i = 0; i < PARTS.length; i++) reset(PARTS[i]);
		set('eyeL', 'o', 1); set('eyeR', 'o', 1);
		set('eyeLidL', 'o', 0); set('eyeLidR', 'o', 0);
		set('mouthShape', 'o', 0);
		set('footL', 'o', 1); set('footR', 'o', 1);   /* sleep() hides these */
		/* thunder_hide fades the whole cat out while she is indoors. If an
		 * episode is aborted at that moment - the back button, a fault - she must
		 * not be left invisible for the rest of the day. */
		set('catRoot', 'o', 1);
		set('foreheadFlush', 'o', 0);        /* sunbath reddens her forehead */
		set('coldTint', 'o', 0);             /* shiver_ball turns her blue */
		/* lids parked off the eye */
		set('lidUpL', 'y', 0); set('lidUpR', 'y', 0);
		set('lidLoL', 'y', 0); set('lidLoR', 'y', 0);
	}

	/* ---- morphing: a shape that actually changes ---- */

	/* Shapes must share a command structure; only the numbers are interpolated. */
	function shapeNumbers(d) {
		var out = [], m = d.match(/-?\d*\.?\d+/g);
		if (m) for (var i = 0; i < m.length; i++) out.push(parseFloat(m[i]));
		return out;
	}

	function shapeTemplate(d) {
		return d.split(/-?\d*\.?\d+/);
	}

	/* morphTo(part, fromD, toD) then tween the part's 'morph' key 0 -> 1 */
	function morphTo(part, fromD, toD) {
		if (!pose[part]) {                    /* not a known part: make it one */
			if (!el[part]) return;
			pose[part] = blank(); add[part] = blankAdd(); kind[part] = 'svg';
		}
		morph[part] = {
			tpl: shapeTemplate(toD),
			from: shapeNumbers(fromD),
			to: shapeNumbers(toD),
			applied: -1
		};
		pose[part].morph = 0;
		dirty[part] = true;
	}

	function writeMorph(part) {
		var m = morph[part];
		if (!m) return;
		var t = pose[part].morph || 0;
		if (m.applied === t) return;
		m.applied = t;

		var d = '', n = Math.min(m.from.length, m.to.length);
		for (var i = 0; i < m.tpl.length; i++) {
			d += m.tpl[i];
			if (i < n) d += r2(m.from[i] + (m.to[i] - m.from[i]) * t);
		}
		if (el[part]) el[part].setAttribute('d', d);
	}

	/* ---- world ---- */

	function at(x, y) {
		if (world.x === x && world.y === y) return;
		world.x = x; world.y = y; worldDirty = true;
	}
	function face(dir) { if (world.face !== dir) { world.face = dir; worldDirty = true; } }
	function scale(s) { if (world.scale !== s) { world.scale = s; worldDirty = true; } }

	/* ---- flush: the only place the DOM is written ---- */

	function writePart(name, force) {
		if (!force && !dirty[name]) return;
		var node = el[name];
		if (!node) { dirty[name] = false; return; }
		var p = pose[name], a = add[name];
		var dom = kind[name] === 'dom';

		var rot = p.rot + a.rot;
		var x = p.x + a.x;
		var y = p.y + a.y;
		var sx = p.sx * (1 + a.sx);
		var sy = p.sy * (1 + a.sy);

		var t = dom
			? 'translate(' + r2(x) + 'px,' + r2(y) + 'px) rotate(' + r2(rot) + 'deg) scale(' + r3(sx) + ',' + r3(sy) + ')'
			: 'translate(' + r2(x) + ',' + r2(y) + ') rotate(' + r2(rot) + ') scale(' + r3(sx) + ',' + r3(sy) + ')';

		var o = p.o === null ? null : r2(p.o);

		if (force || lastT[name] !== t) {
			if (dom) node.style.transform = t;
			else node.setAttribute('transform', t);
			lastT[name] = t;
		}
		if (o !== null && (force || lastO[name] !== o)) {
			if (dom) node.style.opacity = o;
			else node.setAttribute('opacity', o);
			lastO[name] = o;
		}
		if (morph[name]) writeMorph(name);
		dirty[name] = false;
	}

	function flush(force) {
		var i;
		for (i = 0; i < PARTS.length; i++) writePart(PARTS[i], force);
		for (i = 0; i < dyn.length; i++) writePart(dyn[i], force);

		if (force || worldDirty) {
			/* transform-origin is 0 0, so a plain scaleX(-1) would mirror her
			 * around the LEFT EDGE and throw her a body-width sideways. Shift by
			 * her own scaled width first, so turning around happens in place.   */
			var flip = world.face < 0;
			var tx = world.x / 100 * box.w + (flip ? catPx * world.scale : 0);
			holder.style.transform =
				'translate(' + r2(tx) + 'px,' + r2(world.y / 100 * box.h) + 'px)' +
				' scale(' + r3(flip ? -world.scale : world.scale) + ',' + r3(world.scale) + ')';
			worldDirty = false;
		}
	}

	function r2(n) { return Math.round(n * 100) / 100; }
	function r3(n) { return Math.round(n * 1000) / 1000; }

	function bounds() {
		return { x: world.x, y: world.y, w: size.w * world.scale, h: size.h * world.scale };
	}

	return {
		init: init,
		measure: measure,
		parts: function () { return PARTS; },
		set: set,
		get: get,
		bias: bias,
		biasOf: biasOf,
		resetAll: resetAll,
		morphTo: morphTo,
		register: register,
		unregister: unregister,
		clearDynamic: clearDynamic,
		at: at,
		face: face,
		facing: function () { return world.face; },
		scale: scale,
		flush: flush,
		bounds: bounds,
		stagePx: function () { return { w: box.w, h: box.h }; },
		size: size,
		hide: function () { if (holder) holder.style.display = 'none'; }
	};
})();
