/* plan-random.js - the wallpaper's stand-in for cat/plan.js.
 *
 * cat.js asks `Plan` what to do next and reports back what it did. The informer
 * answers from a diary written at midnight; a wallpaper is seen for seconds at a
 * time, so this answers from a timer and the shuffle instead.
 * It keeps the interface cat.js calls - group D of tools/check-wallpaper.js checks
 * that every Plan.<name> the bundled cat code uses exists here - and the parts
 * that only make sense for a diary are harmless no-ops.
 *
 * cat.js only asks (`due`) when nothing is playing. The first question after an
 * animation arms a timer of wall_gap_min..wall_gap_max seconds of idle life,
 * and the answer is "nothing yet" until it runs out. Every wall_sky_every-th
 * arming redraws the sky, so she changes clothes in the gap between animations
 * rather than in the middle of one.
 *
 * hurry() is for a wallpaper that comes back into view after a while to find
 * an animation frozen half-way: it arms the next slot 1.5 s from now instead
 * of waiting for the idle gap. cat.js only asks between animations - 1.8 s
 * after one ends - so the next follows the frozen one as soon as cat.js asks.
 * Arming 1.5 s at that first question instead would add an idle beat of up
 * to ten seconds before it.                                                  */

var Plan = (function () {
	var library = null;           /* () -> { cands, timeFactor }, from cat.js */
	var dueAt = 0;                /* ms; 0 = not armed */
	var armings = 0;
	var done = 0;
	var byId = {};

	function num(v, fallback) { return (typeof v === 'number' && v >= 0) ? v : fallback; }

	function gapMs() {
		var lo = num(typeof wall_gap_min === 'undefined' ? null : wall_gap_min, 45);
		var hi = num(typeof wall_gap_max === 'undefined' ? null : wall_gap_max, 150);
		if (hi < lo) hi = lo;
		return Math.round((lo + Math.random() * (hi - lo)) * 1000);
	}

	function skyEvery() {
		return num(typeof wall_sky_every === 'undefined' ? null : wall_sky_every, 5);
	}

	function clock(m) {
		m = ((Math.floor(m) % 1440) + 1440) % 1440;
		return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
	}

	function keys(o) { var r = []; for (var k in o) if (o.hasOwnProperty(k)) r.push(k); return r; }

	function init(fn) { library = fn; }

	/* The slot owed now, or null. Only ever reached between animations. */
	function due(date) {
		var t = date.getTime();
		if (!dueAt) {
			dueAt = t + gapMs();
			armings++;
			var every = skyEvery();
			if (every > 0 && armings % every === 0) {
				Guard.run('sky-redraw', function () { Sky.redraw(date); });
			}
			LOG('wall: next animation in ' + Math.round((dueAt - t) / 1000) + ' s');
			return null;
		}
		if (t < dueAt) return null;

		var lib = library ? library() : null;
		var id = lib ? Shuffle.next(lib.cands, Cat.weather(), date) : null;
		if (!id) { dueAt = 0; return null; }      /* nothing fits: wait another gap */
		LOG('wall: animation ' + id);
		return { m: date.getHours() * 60 + date.getMinutes(), id: id, done: 0, sub: null };
	}

	function markDone(slot, actualId) {
		dueAt = 0;
		if (!slot) return;
		var id = actualId || slot.id;
		done++;
		byId[id] = (byId[id] || 0) + 1;
	}

	function skip() { dueAt = 0; }

	/* once: the next slot is owed 1.5 s from now, not after a random gap */
	function hurry() {
		dueAt = Date.now() + 1500;
		LOG('wall: next animation as soon as this one ends');
	}

	function stats() {
		return { day: 'wall', total: done, done: done, unique: keys(byId).length,
		         missed: 0, substituted: 0, byId: byId, builds: 0 };
	}

	/* cat.js joins this for the debug overlay, so it is a list like the real
	 * one's: the time to the next animation, or nothing while one plays. */
	function upcoming(date) {
		if (!dueAt) return [];
		var s = Math.max(0, Math.round((dueAt - date.getTime()) / 1000));
		return ['in ' + s + ' s'];
	}

	return {
		init: init,
		due: due,
		markDone: markDone,
		skip: skip,
		hurry: hurry,
		ensure: function () { return false; },
		rebuildRest: function () { return []; },
		stats: stats,
		slots: function () { return []; },
		lines: function () { return []; },
		upcoming: upcoming,
		day: function () { return 'wall'; },
		clock: clock,
		/* for the offline harness */
		armed: function () { return dueAt; },
		armings: function () { return armings; }
	};
})();
