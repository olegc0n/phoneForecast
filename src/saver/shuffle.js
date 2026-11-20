/* shuffle.js - which animation next, for a screen saver.
 *
 * UNIFORM, NOT WEIGHTED. The `weight` on a scene is how often the day planner
 * should fit it into a day of a hundred and twenty: the desk is 38, the winter
 * scenes are under one. Picked by weight, the saver would open on the desk
 * nearly every time during office hours. Here weight only says yes or no (a
 * zero is never shown); among the scenes that suit the sky and the clock, every
 * one is equally likely.
 *
 * UNSEEN FIRST. The history of what has been shown survives between dream
 * starts, so a short nap on the charger does not keep showing the same three.
 * Anything not shown recently is preferred; once everything that fits has been
 * seen, anything but the last two will do. The history is capped at 60% of the
 * library, so the oldest drop off it and come round again.                     */

var Shuffle = (function () {
	var KEY = 'saver.seen.v1';
	var SHARE = 0.6;
	var seenList = null;          /* ids, oldest first, each at most once */

	function load() {
		if (seenList) return;
		var s = null;
		try { s = Store.getJSON(KEY); } catch (e) { s = null; }
		seenList = (Object.prototype.toString.call(s) === '[object Array]') ? s.slice() : [];
	}

	function save() {
		try { Store.setJSON(KEY, seenList); } catch (e) {}
	}

	function has(list, id) { return list.indexOf(id) !== -1; }

	/* Late at night nothing boisterous, if anything calmer fits. */
	function lateNight(date) {
		var h = date.getHours();
		return h >= 22 || h < 5;
	}

	/* Everything that may be shown now: weight above zero and its conditions met. */
	function eligible(cands, wx, date) {
		var out = [], calm = [], i, c, ok;
		for (i = 0; i < cands.length; i++) {
			c = cands[i];
			if (!(c.weight > 0)) continue;
			ok = false;
			try { ok = !!c.cond(wx, date); } catch (e) { ok = false; }
			if (!ok) continue;
			out.push(c);
			if (c.energy !== 'high') calm.push(c);
		}
		return (lateNight(date) && calm.length) ? calm : out;
	}

	/* how many of those have not been shown lately */
	function fresh(cands, wx, date) {
		load();
		var el = eligible(cands, wx, date), n = 0;
		for (var i = 0; i < el.length; i++) if (!has(seenList, el[i].id)) n++;
		return n;
	}

	function remember(id, librarySize) {
		load();
		var at = seenList.indexOf(id);
		if (at !== -1) seenList.splice(at, 1);
		seenList.push(id);
		var cap = Math.max(2, Math.floor(librarySize * SHARE));
		while (seenList.length > cap) seenList.shift();
		save();
	}

	/* Pick one, record it, return its id - or null if nothing fits at all. */
	function next(cands, wx, date) {
		load();
		var el = eligible(cands, wx, date);
		if (!el.length) return null;

		var pool = [], i;
		for (i = 0; i < el.length; i++) if (!has(seenList, el[i].id)) pool.push(el[i]);
		if (!pool.length) {
			var lastTwo = seenList.slice(-2);
			for (i = 0; i < el.length; i++) if (!has(lastTwo, el[i].id)) pool.push(el[i]);
		}
		if (!pool.length) pool = el;

		var c = pool[Math.floor(Math.random() * pool.length)];
		remember(c.id, cands.length);
		return c.id;
	}

	return {
		next: next,
		eligible: eligible,
		fresh: fresh,
		seen: function () { load(); return seenList.slice(); }
	};
})();
