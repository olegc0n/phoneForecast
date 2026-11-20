/* timers.js - the page's timer gate. Loaded FIRST, before any other module.
 *
 * A wallpaper is out of sight most of the day: behind an app, or with the screen
 * off. Then the page must cost nothing, and "nothing" means no wake-ups at all.
 * cat.js alone does not get there: its visibility handler only parks the frame
 * loop, while its beat timer, a running scene's timers and the minute tick keep
 * firing - and every beat issues a tween that starts the loop again.
 *
 * WebView.pauseTimers() would stop them, but it is process-wide: the picker's
 * preview engine, the real engine and the preview activity all live in one
 * process, and pausing one would pause them all. So the gate is per page.
 *
 * Every timer in the bundled code is a bare setTimeout/clearTimeout (or
 * setInterval) call that resolves to window's at call time, and nothing keeps
 * a private reference to the native functions (group D of
 * tools/check-wallpaper.js checks both). So this replaces the four functions on
 * window with wrappers that keep a table of what is pending:
 *
 *   Timers.freeze()   cancel every native timer, remember how long each had left
 *   Timers.thaw()     arm them again with that time, in their original order
 *
 * Frozen, the page has zero wake-ups; thawed, it carries on exactly where it
 * stopped (anim.js clamps the first frame's dt to 250 ms, so nothing jumps).
 * A timer set while frozen is stored and armed at the next thaw. Time does not
 * pass for the page while it is frozen.
 *
 * The wrappers issue their own integer ids. A non-function first argument
 * (code as a string) goes to the native function untouched, and so does a
 * clear of an id this table does not know - which is a no-op for anything the
 * gate issued.                                                                */

var Timers = (function () {
	var W = window;
	var nativeSet = W.setTimeout;
	var nativeClear = W.clearTimeout;
	var nativeInterval = W.setInterval;

	var table = {};               /* id -> { id, fn, args, at, left, every, real } */
	var seq = 0;
	var isFrozen = false;
	var firedCount = 0;

	/* monotonic where there is one: a clock set by hand must not stretch a delay */
	function now() {
		return (W.performance && W.performance.now) ? W.performance.now() : Date.now();
	}

	function arm(r) {
		r.at = now() + r.left;
		r.real = nativeSet.call(W, function () { run(r.id); }, r.left);
	}

	function disarm(r) {
		if (r.real !== null) {
			nativeClear.call(W, r.real);
			r.real = null;
		}
	}

	function run(id) {
		var r = table[id];
		if (!r) return;
		r.real = null;
		if (isFrozen) return;                     /* cannot happen: freeze() clears every native */
		if (r.every) {
			r.left = r.every;
			arm(r);                               /* re-armed before the call, as a browser does */
		} else {
			delete table[id];
		}
		firedCount++;
		r.fn.apply(W, r.args);
	}

	function add(fn, ms, rest, every) {
		var delay = +ms;
		if (!(delay > 0)) delay = 0;
		var r = {
			id: ++seq,
			fn: fn,
			args: rest,
			at: 0,
			left: delay,
			every: every ? Math.max(1, delay) : 0,
			real: null
		};
		if (every) r.left = r.every;
		table[r.id] = r;
		if (isFrozen) r.at = now() + r.left;      /* stored, armed at thaw */
		else arm(r);
		return r.id;
	}

	function extra(args) {
		var out = [];
		for (var i = 2; i < args.length; i++) out.push(args[i]);
		return out;
	}

	function clear(id) {
		var r = table[id];
		if (!r) {
			/* a native id from a string timer, or nothing at all */
			if (id !== undefined && id !== null) nativeClear.call(W, id);
			return;
		}
		disarm(r);
		delete table[id];
	}

	W.setTimeout = function (fn, ms) {
		if (typeof fn !== 'function') return nativeSet.apply(W, arguments);
		return add(fn, ms, extra(arguments), false);
	};
	W.setInterval = function (fn, ms) {
		if (typeof fn !== 'function') return nativeInterval.apply(W, arguments);
		return add(fn, ms, extra(arguments), true);
	};
	W.clearTimeout = clear;
	W.clearInterval = clear;

	/* in the order they would have fired: due time, then creation */
	function ordered() {
		var list = [];
		for (var k in table) if (table.hasOwnProperty(k)) list.push(table[k]);
		list.sort(function (a, b) { return (a.left - b.left) || (a.id - b.id); });
		return list;
	}

	function freeze() {
		if (isFrozen) return;
		isFrozen = true;
		var t = now();
		for (var k in table) {
			if (!table.hasOwnProperty(k)) continue;
			var r = table[k];
			disarm(r);
			r.left = Math.max(0, r.at - t);
		}
	}

	function thaw() {
		if (!isFrozen) return;
		isFrozen = false;
		var list = ordered();
		for (var i = 0; i < list.length; i++) arm(list[i]);
	}

	function pending() {
		var n = 0;
		for (var k in table) if (table.hasOwnProperty(k)) n++;
		return n;
	}

	return {
		freeze: freeze,
		thaw: thaw,
		frozen: function () { return isFrozen; },
		pending: pending,
		fired: function () { return firedCount; }
	};
})();
