/* wardrobe.js - what Lili is wearing, decided by the actual weather.
 *
 * Every garment is already authored inside the rig at opacity 0, which is the
 * whole trick: clothes hang off the same pivots as her body, so they inherit her
 * motion and the spring layer for nothing. The scarf trails when she walks and
 * the cap tips when she tilts her head without a single line of animation code.
 *
 * Slots are exclusive - one hat at a time - so putting on a warm hat takes the
 * cap off by itself.                                                           */

var Wardrobe = (function () {
	var SLOTS = {
		/* one hat at a time, so the party hat takes the cap off by itself */
		head:  ['wCap', 'wWarmHat', 'wPartyHat'],
		eyes:  ['wSunglasses'],
		neck:  ['wScarf'],
		body:  ['wCoat'],
		hand:  ['wUmbrella', 'wIceCream', 'wSoda']
	};

	var worn = { head: null, eyes: null, neck: null, body: null, hand: null };
	var current = '';

	/* ---- the outfits ---- */

	var OUTFITS = {
		/* nothing but her own mint vest */
		plain:   {},
		hot:     { head: 'wCap',     eyes: 'wSunglasses' },
		treat:   { head: 'wCap',     eyes: 'wSunglasses', hand: 'wIceCream' },
		soda:    { head: 'wCap',     eyes: 'wSunglasses', hand: 'wSoda' },
		rain:    { body: 'wCoat',    hand: 'wUmbrella' },
		cold:    { head: 'wWarmHat', neck: 'wScarf' },
		snow:    { head: 'wWarmHat', neck: 'wScarf' },
		windy:   { neck: 'wScarf' }
	};

	/* Which outfit does this weather call for?
	 *
	 * Scaled for BELARUS, not for a hot climate: a summer maximum here is 23-25,
	 * so 23 is genuinely hot and the thresholds above that would simply never
	 * have been reached. Winter reaches -10 to -20, so the cold end is real.     */
	var HOT = 23;      /* ice cream weather        */
	var WARM = 19;     /* soda weather             */
	var SUNNY = 16;    /* cap and sunglasses       */
	var COLD = 0;      /* hat and scarf            */

	function outfitFor(wx) {
		if (!wx) return 'plain';

		/* precipitation wins over temperature: wet is wet */
		if (wx.precip === 'ra' || wx.precip === 'ra_sn') return 'rain';
		if (wx.precip === 'sn') return 'snow';

		if (wx.temp !== null && wx.temp <= COLD) return 'cold';

		if (!wx.isNight && wx.temp !== null) {
			if (wx.temp >= HOT) return 'treat';                          /* + ice cream */
			if (wx.temp >= WARM) return 'soda';                          /* + soda      */
			if (wx.temp >= SUNNY && wx.sky === 'skc') return 'hot';      /* cap + shades */
		}
		if (wx.wind > 11) return 'windy';
		return 'plain';
	}

	/* ---- wearing things ---- */

	function slotOf(garment) {
		for (var slot in SLOTS) {
			if (SLOTS[slot].indexOf(garment) !== -1) return slot;
		}
		return null;
	}

	function show(garment, on, dur, delay) {
		Anim.tween(garment, 'o', on ? 1 : 0, dur || 500, 'io', delay || 0);
	}

	/* Put one thing on or take it off, honouring the slot. */
	function wear(garment, dur, delay) {
		var slot = slotOf(garment);
		if (!slot || worn[slot] === garment) return;
		if (worn[slot]) show(worn[slot], false, 260, delay || 0);
		worn[slot] = garment;
		/* a garment drops in from slightly above, so it reads as being put on */
		Rig.set(garment, 'y', -7);
		Anim.tween(garment, 'y', 0, dur || 520, 'out', (delay || 0) + 120);
		show(garment, true, dur || 420, (delay || 0) + 120);
	}

	function remove(slot, delay) {
		if (!worn[slot]) return;
		show(worn[slot], false, 320, delay || 0);
		worn[slot] = null;
	}

	/* Hand items are also used by scenes directly - an ice cream on a hot day
	 * regardless of what she is otherwise wearing.                             */
	function hold(garment, dur, delay) {
		if (!garment) { remove('hand', delay); return; }
		wear(garment, dur, delay);
	}

	/* Reconcile every slot against the named outfit.
	 *
	 * This used to return early when the outfit name had not changed, which left
	 * anything a scene had put in her hands there for good: the ice-cream scene
	 * calls hold() directly, so `worn.hand` changes while `current` does not, and
	 * the next weather update saw the same name and did nothing. She kept the
	 * soda. The per-slot loop below already skips whatever is unchanged, so the
	 * name check bought nothing and cost that.                                 */
	function set(name, delay) {
		var outfit = OUTFITS[name];
		if (!outfit) return;
		current = name;

		for (var slot in worn) {
			var want = outfit[slot] || null;
			if (worn[slot] === want) continue;
			if (!want) remove(slot, delay);
			else wear(want, 520, delay);
		}
	}

	function forWeather(wx) {
		set(outfitFor(wx));
	}

	/* ASSERT WHAT IS WORN, WITHOUT A TWEEN.
	 *
	 * This is the fix for a cat in a raincoat AND an umbrella AND a cap AND
	 * sunglasses at the same time.
	 *
	 * Taking a garment off is a tween on its opacity, and Anim.clear() throws
	 * pending tweens away outright. It is called in seven places - the start and
	 * the end of every animation, a touch, the back button, bedtime, shutdown -
	 * while the bookkeeping in `worn` is updated synchronously. So a fade-out
	 * cancelled a few hundred milliseconds after it started leaves the garment on
	 * screen at full opacity with nothing left that will ever remove it: the slot
	 * it belonged to is already null, so no later reconcile touches it.
	 *
	 * Hence the intermittence - it needed an outfit change within the length of a
	 * fade of an animation boundary, which is why it took a long test to see.
	 *
	 * Rather than make the tweens uncancellable, the truth is re-asserted: every
	 * garment's opacity is written directly from `worn`. Cheap, idempotent, and
	 * it repairs any state however it got there.                              */
	function sync() {
		for (var slot in SLOTS) {
			var list = SLOTS[slot];
			for (var i = 0; i < list.length; i++) {
				Rig.set(list[i], 'o', worn[slot] === list[i] ? 1 : 0);
			}
		}
	}

	function bare(delay) {
		for (var slot in worn) remove(slot, delay);
		current = '';
	}

	return {
		set: set,
		wear: wear,
		hold: hold,
		remove: remove,
		bare: bare,
		sync: sync,
		forWeather: forWeather,
		outfitFor: outfitFor,
		current: function () { return current; },
		wearing: function (slot) { return worn[slot]; },
		names: function () { var k = [], n; for (n in OUTFITS) k.push(n); return k; }
	};
})();
