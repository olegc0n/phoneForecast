/* plan.js - Lili's diary. One day of animations, decided in advance.
 *
 * WHY THIS EXISTS
 *
 * Until now the next activity was chosen at the moment it ran: wait out a
 * random cooldown, then pick whatever the weather and the clock allowed. That
 * is fine on average and hopeless in particular. The lunch scene only matches
 * between 13:00 and 14:00, which is about nine chances in the whole day, and it
 * had to win a weighted lottery against thirty others on each of them. Some
 * days it simply never happened - and there is no way to go and look for it,
 * because there is nothing to look at.
 *
 * So the day is written down at midnight instead. Ten animations an hour, at
 * random times, chosen so that the rare and narrow ones - lunch, the desk, the
 * birthday - get their slot first and cannot be crowded out. The result is a
 * list you can read, which is the real point: a schedule can be checked, and a
 * lottery can only be watched and hoped about.
 *
 * WHAT IT DOES NOT DO
 *
 * It does not decide the weather. A plan built at 00:00 only knows last
 * night's forecast, so every slot is re-checked against the live weather when
 * it comes up; if the plan says "sunbathe" and it is raining by then, the app
 * substitutes on the spot and records that it did. Night and day ARE known in
 * advance - sunrise and sunset come out of the payload - so those are honoured
 * properly at build time.
 */

var Plan = (function () {

	/* v3: the record now carries which mode built it. A v2 plan has no such
	 * field, and !!undefined matches a production build, so a demo plan saved by
	 * an older build would be loaded back as if it were a real day.           */
	var KEY = 'lili.plan.v3';

	/* animations per awake hour - the app's own setting, so the rate can be
	 * changed without touching the scheduler */
	function perHour() {
		return (typeof cat_plan_per_hour === 'number' && cat_plan_per_hour > 0)
			? cat_plan_per_hour : 10;
	}
	/* One minute, not three. The gap used to cap the rate at twenty an hour
	 * however high cat_plan_per_hour was set: sixty an hour is one a minute, so
	 * three minutes apart is arithmetically impossible and the extra slots were
	 * silently dropped on the floor.                                          */
	var MIN_GAP = 1;

	/* And two minutes, not nine. A slot missed by more than this is written off
	 * rather than fired late - at one a minute, a nine minute grace period let a
	 * backlog build up and then run several animations back to back. */
	var LATE = 2;

	var day = null;            /* 'YYYY-MM-DD' the current plan is for */
	var slots = [];            /* [{ m, id, done, sub }] sorted by m */
	var built = 0;             /* how many days this process has planned */

	/* ------------------------------------------------------------------ *
	 *  small helpers                                                      *
	 * ------------------------------------------------------------------ */

	function stamp(date) {
		return date.getFullYear() + '-' +
			('0' + (date.getMonth() + 1)).slice(-2) + '-' +
			('0' + date.getDate()).slice(-2);
	}

	function clock(m) {
		m = ((m % 1440) + 1440) % 1440;
		return ('0' + Math.floor(m / 60)).slice(-2) + ':' + ('0' + (m % 60)).slice(-2);
	}

	/* Minutes she is awake for, as a list of [from, to) ranges within the day.
	 * Quiet hours wrap past midnight, so this is usually one range in the
	 * middle of the day rather than the two you might expect.                */
	function awakeRanges() {
		var from = hhmm(cat_quiet_from), to = hhmm(cat_quiet_to);
		if (from < 0 || to < 0) return [[0, 1440]];
		if (from === to) return [[0, 1440]];
		/* quiet 23:00 -> 10:00 wraps, so awake is the single span between them */
		if (from > to) return [[to, from]];
		/* quiet does not wrap, so awake is what is left on either side */
		var out = [];
		if (to < 1440) out.push([to, 1440]);
		if (from > 0) out.push([0, from]);
		return out;
	}

	/* ------------------------------------------------------------------ *
	 *  when things happen                                                 *
	 * ------------------------------------------------------------------ */

	/* Stratified, not uniform. Ten uniform draws across an hour clump - you get
	 * three in one minute and then a twenty minute hole. One draw per equal
	 * bucket keeps them apart while every individual time stays random.      */
	function slotTimes() {
		var out = [], ranges = awakeRanges(), r, i;

		for (r = 0; r < ranges.length; r++) {
			var lo = ranges[r][0], hi = ranges[r][1];
			var span = hi - lo;
			if (span <= 0) continue;

			var n = Math.max(1, Math.round(span / 60 * perHour()));
			var width = span / n;
			for (i = 0; i < n; i++) {
				var at = lo + i * width + Math.random() * width;
				out.push(Math.floor(at));
			}
		}

		out.sort(function (a, b) { return a - b; });

		/* enforce the gap, dropping rather than shoving, so the last slot of a
		 * range never walks out past the end of it */
		var keep = [];
		for (i = 0; i < out.length; i++) {
			if (!keep.length || out[i] - keep[keep.length - 1] >= MIN_GAP) keep.push(out[i]);
		}
		return keep;
	}

	/* ------------------------------------------------------------------ *
	 *  the shape of a day                                                 *
	 * ------------------------------------------------------------------ */

	/* A working day and a holiday should not look the same.
	 *
	 * Each episode may carry a tag - 'work' for the desk and the tea that goes
	 * with it, 'play' for the games - and the day it lands on decides what that
	 * tag is worth. On a weekday the desk dominates its own hours; on a holiday
	 * work is worth nothing at all and the games take over.
	 *
	 * A zero is a hard exclusion, not a small number: a work-tagged episode
	 * cannot be placed on a holiday even by the guarantee pass. The scenes also
	 * check the weekday themselves, so this is the second lock on the same door -
	 * deliberately, because "no work on my day off" is a rule about the day, not
	 * a property of any one scene, and it should not quietly stop being true if
	 * somebody adds a new desk animation and forgets the weekday check.       */
	var SHAPE = {
		weekday: { work: 3.4, play: 0.75 },
		holiday: { work: 0,   play: 2.3 }
	};

	function shapeFactor(c, date) {
		if (!c.tags || !c.tags.length) return 1;
		var d = date.getDay();
		var profile = (d === 0 || d === 6) ? SHAPE.holiday : SHAPE.weekday;
		var f = 1;
		for (var i = 0; i < c.tags.length; i++) {
			var v = profile[c.tags[i]];
			if (v !== undefined) f *= v;
		}
		return f;
	}

	/* ------------------------------------------------------------------ *
	 *  what happens at each time                                          *
	 * ------------------------------------------------------------------ */

	/* The weather as it will be at minute m. Only the day/night part is really
	 * knowable in advance, and it is the part that matters most for choosing:
	 * without this every slot inherits midnight's isNight and she would be
	 * moon-gazing at two in the afternoon.                                   */
	function weatherAt(wx, m) {
		if (!wx) return null;
		var view = {}, k;
		for (k in wx) if (wx.hasOwnProperty(k)) view[k] = wx[k];

		if (typeof wx.sunriseMin === 'number' && typeof wx.sunsetMin === 'number') {
			view.isNight = (m < wx.sunriseMin || m > wx.sunsetMin);
			view.minutesToSunrise = wx.sunriseMin - m;
			view.minutesToSunset = wx.sunsetMin - m;
		}
		return view;
	}

	function dateAt(base, m) {
		var d = new Date(base.getFullYear(), base.getMonth(), base.getDate(), 0, 0, 0, 0);
		d.setMinutes(m);
		return d;
	}

	/* Build one day. `cands` is [{id, weight, cond, bias, energy}] - whatever
	 * the episode library offers; passing it in keeps this file testable
	 * without a browser, which is how the schedule below got checked.        */
	function compose(date, wx, cands, timeFactor, times) {
		times = times || slotTimes();
		var i, j, c;

		/* every slot's date and weather, computed once */
		var ctx = [];
		for (i = 0; i < times.length; i++) {
			ctx.push({ m: times[i], date: dateAt(date, times[i]), wx: weatherAt(wx, times[i]) });
		}

		/* who could go where */
		var fit = [];
		for (j = 0; j < cands.length; j++) {
			c = cands[j];
			var where = [];
			if (c.weight > 0) {
				for (i = 0; i < ctx.length; i++) {
					var ok = false;
					try { ok = !!c.cond(ctx[i].wx, ctx[i].date); } catch (e) { ok = false; }
					if (ok) where.push(i);
				}
			}
			fit.push({ c: c, where: where, shape: shapeFactor(c, date) });
		}

		var taken = [];                 /* slot index -> id */
		var used = {};                  /* id -> times scheduled today */

		/* PASS 1 - the scarce go first.
		 *
		 * Sorted by how few places they can go, so the once-a-day, one-hour,
		 * weekday-only ones claim their slot before anything with a free run of
		 * the whole day gets a look in. This is the guarantee: if lunch fits
		 * anywhere today, lunch is on the schedule.                          */
		var order = fit.slice();
		order.sort(function (a, b) {
			if (a.where.length !== b.where.length) return a.where.length - b.where.length;
			return (b.c.weight || 0) - (a.c.weight || 0);
		});

		for (j = 0; j < order.length; j++) {
			var e = order[j];
			if (!e.where.length || e.shape === 0) continue;
			var free = [];
			for (i = 0; i < e.where.length; i++) if (!taken[e.where[i]]) free.push(e.where[i]);
			if (!free.length) continue;
			var at = free[Math.floor(Math.random() * free.length)];
			taken[at] = e.c.id;
			used[e.c.id] = 1;
		}

		/* A share of the day proportional to how much of the day it fits, with a
		 * floor of three.
		 *
		 * The floor is deliberate. A narrow scene like lunch only matches for one
		 * hour - nine slots out of a hundred and thirty - and the proportional
		 * rule alone would allow it exactly once. Three lunches is funnier, and
		 * at ten animations an hour nobody is watching all of them anyway; the
		 * point of the cap is to stop one scene eating a whole afternoon, not to
		 * ration the jokes.                                                    */
		/* A declared perDay is a share of the day, not a headcount.
		 *
		 * It is written for the default ten animations an hour, so at sixty it has
		 * to scale with the rate or it means something entirely different: the desk
		 * declares thirty, and at sixty an hour that was spent by twenty past
		 * eleven - she worked solidly all morning and then never again. The
		 * automatic branch below needs no scaling, because `where.length` is a
		 * count of real slots and grows with the rate by itself.               */
		var rateScale = perHour() / 10;

		function cap(e) {
			if (e.c.perDay) return Math.max(1, Math.round(e.c.perDay * rateScale));
			return Math.max(3, Math.round(e.where.length / 10));
		}

		/* PASS 2 - fill the rest by weight.
		 *
		 * Weight is divided by how often she has already done it today, so the
		 * fourth helping of the same scene is worth a quarter of the first.   */
		for (i = 0; i < ctx.length; i++) {
			if (taken[i]) continue;
			var pool = [], w = [], total = 0;
			for (j = 0; j < fit.length; j++) {
				if (fit[j].where.indexOf(i) === -1) continue;
				c = fit[j].c;
				/* The spacing rule is what really limits a scene: no repeat inside
				 * three slots means nothing can hold more than a quarter of its
				 * window. For the desk that is simply wrong - two sessions six
				 * minutes apart is what working looks like - so an episode that
				 * declares a perDay gets a shorter exclusion.                  */
				if (recentlyPlanned(taken, i, c.id, c.perDay ? 1 : 3)) continue;
				if (fit[j].shape === 0) continue;
				if ((used[c.id] || 0) >= cap(fit[j])) continue;
				/* The anti-repeat penalty is scaled to what the episode says it
				 * wants. Declaring perDay: 26 is a statement of intent - "this is
				 * her job, it happens all day" - and it should not be flattened by
				 * the same curve that stops a once-a-day scene running four times.
				 * Without this the desk stalled at twelve sessions however heavy
				 * its weight, because the penalty outran it long before the cap. */
				var soft = c.perDay ? Math.max(1, c.perDay / 5) : 1;
				var weight = c.weight * fit[j].shape / (1 + (used[c.id] || 0) / soft);
				if (timeFactor) weight *= timeFactor(c.energy, ctx[i].date.getHours());
				if (c.bias) { try { weight *= c.bias(ctx[i].wx, ctx[i].date); } catch (er) {} }
				if (weight <= 0) continue;
				pool.push(c); w.push(weight); total += weight;
			}
			if (!pool.length) continue;
			var r = Math.random() * total, chosen = pool[pool.length - 1];
			for (j = 0; j < pool.length; j++) { r -= w[j]; if (r <= 0) { chosen = pool[j]; break; } }
			taken[i] = chosen.id;
			used[chosen.id] = (used[chosen.id] || 0) + 1;
		}

		var out = [];
		for (i = 0; i < ctx.length; i++) {
			if (!taken[i]) continue;
			out.push({ m: ctx[i].m, id: taken[i], done: 0, sub: null });
		}
		return out;
	}

	function recentlyPlanned(taken, at, id, span) {
		for (var k = Math.max(0, at - (span || 3)); k < at; k++) if (taken[k] === id) return true;
		return false;
	}

	/* ------------------------------------------------------------------ *
	 *  the day in the app                                                 *
	 * ------------------------------------------------------------------ */

	var library = null;        /* set by init, so compose() stays pure */

	function init(fn) { library = fn; }

	function build(date, wx) {
		if (!library) return [];
		var lib = library();
		day = stamp(date);
		slots = cat_plan_demo
			? compose(date, planWeather(wx, date), lib.cands, lib.timeFactor, demoTimes(date))
			: compose(date, planWeather(wx, date), lib.cands, lib.timeFactor);
		built++;
		save();
		return slots;
	}

	/* THE DEMO SCHEDULE - three animations in the next five minutes.
	 *
	 * Only for checking that the schedule is what actually drives the app; a
	 * real day is a hundred and twenty animations spread over thirteen hours,
	 * which is not something you can sit and watch. Everything else about it is
	 * genuine: same library, same conditions, same code path - only the times
	 * are contrived. Turned on by `node tools/build.js --plandemo`, and off in
	 * every normal build.
	 *
	 * One caveat: it obeys quiet hours like anything else, so between 23:00 and
	 * 10:00 she stays asleep and nothing runs.                                */
	function demoTimes(date) {
		var now = date.getHours() * 60 + date.getMinutes();
		return [now + 1, now + 3, now + 5];
	}

	/* If the forecast never reported a sunrise, fall back to the quiet window -
	 * she is asleep in the dark anyway, so it is close enough to be useful and
	 * far better than treating the whole day as night.                        */
	function planWeather(wx, date) {
		if (!wx) return null;
		var v = {}, k;
		for (k in wx) if (wx.hasOwnProperty(k)) v[k] = wx[k];
		if (typeof v.sunriseMin !== 'number' || typeof v.sunsetMin !== 'number') {
			v.sunriseMin = 6 * 60;
			v.sunsetMin = 21 * 60;
		}
		return v;
	}

	/* The plan built at boot had no forecast at all - the app starts before the
	 * first fetch lands, and on a bad day the fetch fails entirely. So when
	 * weather finally arrives, rewrite only what has not happened yet: the
	 * morning's record stays intact, the rest of the day gets the real sky.  */
	function rebuildRest(date, wx) {
		if (cat_plan_demo) return slots;      /* leave the demo's five minutes alone */
		if (!library || !slots.length) { build(date, wx); return; }
		var now = date.getHours() * 60 + date.getMinutes();
		var keep = [], i;
		for (i = 0; i < slots.length; i++) if (slots[i].m <= now) keep.push(slots[i]);
		var lib = library();
		var fresh = compose(date, planWeather(wx, date), lib.cands, lib.timeFactor);
		for (i = 0; i < fresh.length; i++) if (fresh[i].m > now) keep.push(fresh[i]);
		slots = keep;
		day = stamp(date);
		save();
		return slots;
	}

	/* Rebuild when the date rolls over - which is the 00:00 call - and on the
	 * first minute after a launch if we have nothing for today.              */
	function ensure(date, wx) {
		var today = stamp(date);
		if (day === today && slots.length && !cat_plan_demo) return false;
		if (day === today && slots.length && cat_plan_demo && built) return false;
		if (day !== today && load(today)) return false;
		build(date, wx);
		return true;
	}

	/* The slot that is owed right now, or null. Anything missed by more than
	 * LATE minutes is written off rather than fired late - she should not run
	 * through four animations back to back because the screen was off.       */
	function due(date) {
		var now = date.getHours() * 60 + date.getMinutes();
		for (var i = 0; i < slots.length; i++) {
			var s = slots[i];
			if (s.done) continue;
			if (s.m > now) return null;
			if (now - s.m > LATE) { s.done = 2; continue; }   /* 2 = missed */
			return s;
		}
		return null;
	}

	/* Nothing could run in this slot - the weather turned and there was no
	 * substitute. Written off, not retried, or she would try again every few
	 * seconds for the rest of the hour.                                      */
	function skip(slot) { if (slot) { slot.done = 2; save(); } }

	function markDone(slot, actualId) {
		if (!slot) return;
		slot.done = 1;
		if (actualId && actualId !== slot.id) slot.sub = actualId;
		save();
	}

	/* ------------------------------------------------------------------ *
	 *  keeping it across a restart                                        *
	 * ------------------------------------------------------------------ */

	/* This thing lives on a shelf and reboots after every power cut. Without
	 * this it would replay the whole morning each time the lights flicker.   */
	function save() {
		try {
			Store.setJSON(KEY, { day: day, demo: !!cat_plan_demo,
			                     build: cat_build, slots: slots });
		} catch (e) {}
	}

	/* The saved plan records which mode built it. Without that, switching off the
	 * demo and reinstalling loads the demo's three finished slots back off disk -
	 * same day, so it looks valid - and she has nothing left to do until midnight.
	 * Anything built in the other mode is discarded rather than trusted.       */
	function load(today) {
		var d = null;
		try { d = Store.getJSON(KEY); } catch (e) { return false; }
		if (!d || d.day !== today || !d.slots || !d.slots.length) return false;
		if (!!d.demo !== !!cat_plan_demo) return false;
		/* a different build may shape the day differently - replan rather than
		 * carry the old one to midnight */
		if (d.build !== cat_build) return false;
		day = d.day;
		slots = d.slots;
		return true;
	}

	/* ------------------------------------------------------------------ *
	 *  looking at it                                                      *
	 * ------------------------------------------------------------------ */

	function stats() {
		var byId = {}, done = 0, missed = 0, subbed = 0;
		for (var i = 0; i < slots.length; i++) {
			var s = slots[i];
			byId[s.id] = (byId[s.id] || 0) + 1;
			if (s.done === 1) done++;
			else if (s.done === 2) missed++;
			if (s.sub) subbed++;
		}
		return { day: day, total: slots.length, done: done, missed: missed,
		         substituted: subbed, unique: keys(byId).length, byId: byId, builds: built };
	}

	function keys(o) { var r = []; for (var k in o) if (o.hasOwnProperty(k)) r.push(k); return r; }

	/* One line per slot - this is what makes the schedule checkable. */
	function lines() {
		var out = [];
		for (var i = 0; i < slots.length; i++) {
			var s = slots[i];
			out.push(clock(s.m) + '  ' + s.id +
				(s.sub ? ' -> ' + s.sub : '') +
				(s.done === 1 ? '  [done]' : s.done === 2 ? '  [missed]' : ''));
		}
		return out;
	}

	/* what is coming, for the debug overlay */
	function upcoming(date, n) {
		var now = date.getHours() * 60 + date.getMinutes();
		var out = [];
		for (var i = 0; i < slots.length && out.length < (n || 3); i++) {
			if (slots[i].done || slots[i].m < now) continue;
			out.push(clock(slots[i].m) + ' ' + slots[i].id);
		}
		return out;
	}

	return {
		init: init,
		build: build,
		ensure: ensure,
		rebuildRest: rebuildRest,
		due: due,
		skip: skip,
		markDone: markDone,
		stats: stats,
		lines: lines,
		upcoming: upcoming,
		day: function () { return day; },
		slots: function () { return slots; },
		/* exposed for the offline harness, which has no Store and no browser */
		compose: compose,
		planWeather: planWeather,
		clock: clock,
		awakeRanges: awakeRanges
	};
})();
