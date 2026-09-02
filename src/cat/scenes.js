/* scenes.js - animations as DATA.
 *
 * A scene is a list of beats plus the conditions under which it makes sense. No
 * tween calls, no magic delays, no hand-maintained duration - the runner adds up
 * the beats for you. This is the format the studio writes, and it is short enough
 * to write by hand:
 *
 *   Scenes.add('tea_break', {
 *     label:  'Tea break',
 *     energy: 'low',
 *     weight: 7,
 *     when:   { hours: ['09:00', '18:00'], weekdays: true },
 *     beats: [
 *       ['prop', 'desk', 'desk', 24, 76, 52, 4],
 *       ['prop', 'cup', 'mug', 64, 79, 9, 9, 60/54],
 *       ['walkTo', 28], ['sit'], ['look', 66, 81],
 *       ['sip', 'cup'], ['emote', 'happy'], ['groom'],
 *       ['propOut', 'cup'], ['propOut', 'desk']
 *     ]
 *   });
 *
 * `when` fields, all optional:
 *   hours     ['HH:MM','HH:MM']  clock window, wraps past midnight
 *   weekdays  true               Monday to Friday only
 *   precip    'ra' | 'sn' | 'ra_sn'
 *   sky       'skc' | 'bkn' | 'ovc'
 *   night     true | false
 *   thunder   true
 *   tempMin / tempMax / windMin
 */

var Scenes = (function () {
	var LIST = [];
	var running = null;

	function add(id, def) {
		def.id = id;
		LIST.push(def);
		return def;
	}

	/* ---- conditions ---- */

	/* A scene with a malformed `hours` is treated as unrestricted, not as never. */
	function inWindow(date, from, to) { return inClockWindow(date, from, to, true); }

	function matches(when, wx, date) {
		if (!when) return true;

		if (when.hours && !inWindow(date, when.hours[0], when.hours[1])) return false;
		if (when.weekdays) {
			var d = date.getDay();
			if (d === 0 || d === 6) return false;
		}
		/* calendar windows, for the once-a-year ones */
		if (when.dates) {
			var mm = ('0' + (date.getMonth() + 1)).slice(-2);
			var dd = ('0' + date.getDate()).slice(-2);
			if (when.dates.indexOf(mm + '-' + dd) === -1) return false;
		}
		if (when.months && when.months.indexOf(date.getMonth() + 1) === -1) return false;
		if (when.dayMin !== undefined && date.getDate() < when.dayMin) return false;

		if (when.weekend) {
			var wd = date.getDay();
			if (wd !== 0 && wd !== 6) return false;
		}

		/* anything asking about the weather needs the weather */
		var wantsWeather = when.precip !== undefined || when.sky !== undefined ||
			when.night !== undefined || when.thunder !== undefined ||
			when.tempMin !== undefined || when.tempMax !== undefined ||
			when.windMin !== undefined;
		if (wantsWeather && !wx) return false;

		if (when.precip !== undefined && wx.precip !== when.precip) return false;
		if (when.sky !== undefined && wx.sky !== when.sky) return false;
		if (when.night !== undefined && !!wx.isNight !== !!when.night) return false;
		if (when.thunder !== undefined && !!wx.isThunder !== !!when.thunder) return false;
		if (when.tempMin !== undefined && (wx.temp === null || wx.temp < when.tempMin)) return false;
		if (when.tempMax !== undefined && (wx.temp === null || wx.temp > when.tempMax)) return false;
		if (when.windMin !== undefined && wx.wind < when.windMin) return false;
		return true;
	}

	/* ---- running ---- */

	function cancel() {
		if (!running) return;
		for (var i = 0; i < running.timers.length; i++) clearTimeout(running.timers[i]);
		running = null;
	}

	/* Returns the duration, which Episodes uses to size the activity. */
	function run(def, aliveFn) {
		cancel();
		running = Beats.play(def.beats, aliveFn);
		return running.duration;
	}

	/* ---- adapter: scenes look exactly like hand-written activities ---- */

	function activities(aliveFn) {
		var out = [];
		for (var i = 0; i < LIST.length; i++) {
			(function (def) {
				out.push({
					id: def.id,
					label: def.label || def.id,
					dur: def.dur || 12000,          /* replaced by the real length at play time */
					weight: def.weight === undefined ? 5 : def.weight,
					energy: def.energy || 'mid',
					scene: true,
					tags: def.tags || null,
					perDay: def.perDay || 0,
					cond: function (wx, date) { return matches(def.when, wx, date); },
					bias: def.bias || null,
					run: function () { return run(def, aliveFn); }
				});
			})(LIST[i]);
		}
		return out;
	}

	return {
		add: add,
		cancel: cancel,
		matches: matches,
		activities: activities,
		find: function (id) {
			for (var i = 0; i < LIST.length; i++) if (LIST[i].id === id) return LIST[i];
			return null;
		}
	};
})();


/* ==================================================================== *
 *  Scenes written in the new format. Compare the length of these with
 *  the hand-written activities in episodes.js.
 * ==================================================================== */

Scenes.add('morning_stretch', {
	label: 'Morning - waking up properly',
	energy: 'mid',
	weight: 9,
	/* Must sit AFTER she wakes: with quiet hours running to 10:00 the old
	 * 05:30-09:30 window was entirely inside her sleep, so it never fired. */
	when: { hours: ['10:00', '12:00'] },
	beats: [
		['curl'],
		['wait', 900],
		['lids', 0.8],
		['yawn'],
		['stand'],
		['stretch'],
		['shake'],
		['ears', -8],
		['emote', 'happy'],
		['groom'],
		['lookAhead'],
		['blink']
	]
});

/* No desk: she sits square to the viewer with the tea beside her and a plate of
 * biscuits in front, which is a nicer thing to look at than the back of a
 * monitor. Both props sit at floor level - the desk used to hold them up, and
 * without it they have to stand on the ground like everything else.          */
Scenes.add('tea_break', {
	tags: ['work'],
	label: 'Tea and sweets',
	energy: 'low',
	weight: 7,
	when: { hours: ['09:00', '18:00'], weekdays: true },
	/* THE TEA IS ON A TABLE NOW.
	 *
	 * The mug and the plate used to sit on the floor either side of her, which is
	 * where you put a cat's bowl, not where you have tea. They stand on a table
	 * instead: the table is created first so the crockery draws on top of it, and
	 * its surface sits at about 87% of the stage with the mug and the plate placed
	 * so their bases land on it rather than floating over it.
	 *
	 * The table is in the layer in front of her, so it covers her lower half -
	 * which is exactly what sitting at a table looks like. It is a round side
	 * table, not the work desk that was taken out of this scene: that one had a
	 * monitor on it and covered her face.
	 *
	 * The biscuits are drawn on the plate, so to actually EAT one she needs a
	 * separate biscuit to lift: it appears on the plate, goes to her mouth, and is
	 * taken away before she chews. Which is why there are two of them.          */
	beats: [
		/* Same height as the table she knocks the mug off in push_off: at 84 the
		 * surface crossed her chest and read as a tall table. At 89 it is a low
		 * table down by her feet, and the legs run off the bottom of the screen. */
		['prop', 'table', 'teaTable', 18, 89, 62, 9, 200 / 90],
		['prop', 'cup', 'mug', 30, 89, 10, 9, 60 / 54],
		['prop', 'plate', 'sweets', 49, 89.5, 15, 9, 70 / 40],
		['walkTo', 28],
		['sit'],
		['lookAhead'],

		['look', 34, 91],
		['sip', 'cup'],
		['emote', 'happy'],

		['look', 55, 91],
		['prop', 'bicA', 'biscuit', 53, 88, 6, 9],
		['sip', 'bicA'],
		['propOut', 'bicA'],
		['eat', 5],
		['lookAhead'],

		['sip', 'cup'],
		['emote', 'happy'],

		['look', 58, 91],
		['prop', 'bicB', 'biscuit', 57, 88, 6, 9],
		['sip', 'bicB'],
		['propOut', 'bicB'],
		['eat', 4],

		['lookAhead'],
		['sip', 'cup'],
		['groom'],
		['lookAhead'],
		['propOut', 'cup'],
		['propOut', 'plate'],
		['propOut', 'table']
	]
});

Scenes.add('cold_drink', {
	label: 'Ice cream on a hot day',
	energy: 'low',
	weight: 10,
	when: { tempMin: 23, night: false },
	/* The same flush the sunbathing and the sprawl use, in two steps up and two
	 * steps down: she reddens while she settles, reddens further while she pants,
	 * and then the ice cream cools her off again. Getting hot and cooling down is
	 * the whole point of the scene, so it should be visible on her face.       */
	beats: [
		['prop', 'sun', 'sun', 74, 63, 18, 4],
		/* THE CONE IS DECLARED FIRST, and that is not cosmetic.
		 *
		 * A `prop` beat placed later in the list is created by a timer, while every
		 * verb BODY runs up front during the build. So ['lick','cone'] looked the
		 * cone up before the timer had made it and found nothing - the lift never
		 * happened. Props declared at the top are created synchronously, which is
		 * why the mug in the tea break has always worked. Anything a later beat
		 * refers to by name has to be declared here. */
		['prop', 'cone', 'iceCream', 36, 86, 9, 9, 34 / 54],
		['walkTo', 30],
		/* 'hot' rather than 'treat': treat puts the wardrobe's ice cream in her
		 * paw, and the one she eats is a prop, so she would have had two. */
		['outfit', 'hot'],
		['tint', 'hot', 0.5, 2600],
		['look', 82, 67],
		['sprawl'],
		['pant'],
		['tint', 'hot', 0.92, 3000],
		['lick', 'cone', 5],
		['tint', 'hot', 0.45, 2400],
		['emote', 'happy'],
		['wait', 600],
		['lick', 'cone', 3],
		['tint', 'hot', 0.12, 2200],
		['pant'],
		['lids', 0.7],
		['tint', 'hot', 0, 1800],
		['propOut', 'cone'],
		['propOut', 'sun']
	]
});

Scenes.add('window_watch', {
	label: 'Watching out of the window',
	energy: 'low',
	weight: 6,
	when: { sky: 'ovc', night: false },
	beats: [
		['prop', 'win', 'window', 5, 65, 22, 4],
		['walkTo', 34],
		['face', -1],
		['sit'],
		['look', 14, 75],
		['tail', -14],
		['slowBlink'],
		['wait', 1200],
		['ears', 8],
		['slowBlink'],
		['wait', 1400],
		['emote', 'sleepy'],
		['wait', 1600],
		['lookAhead'],
		['face', 1],
		['propOut', 'win']
	]
});

/* ==================================================================== *
 *  The rest of what we discussed, now built. All data - no tween code.
 * ==================================================================== */

Scenes.add('chase_tail', {
	tags: ['play'],
	label: 'Chasing her own tail',
	energy: 'high',
	weight: 6,
	beats: [
		['stand'],
		['look', 78, 92],
		['ears', -10],
		['chaseTail', 3],
		['dizzy'],
		['sit'],
		['emote', 'surprised'],
		['wait', 900],
		['groom'],
		['lookAhead']
	]
});

Scenes.add('hunt', {
	tags: ['play'],
	label: 'The hunt - stalk, pounce, miss',
	energy: 'high',
	weight: 7,
	when: { night: false },
	/* THE TOY IS A TEASER WAND NOW, not a dot on the floor.
	 *
	 * A 5% dot was a full stop she was hunting. The wand has a rod, a string and
	 * three things dangling - a feather, a pom-pom and a mouse - so there is
	 * something to see her miss. It is declared first because later beats refer to
	 * it by name, and a prop declared later is created by a timer that has not run
	 * by the time the beat list is built.
	 *
	 * It dangles at her chest height rather than on the floor, which is where a
	 * teaser actually hangs, and it jerks about between her attempts.          */
	beats: [
		['prop', 'wand', 'teaser', 10, 64, 22, 9, 110 / 150],
		['walkTo', 52],
		['stand'],
		['look', 26, 78],
		['ears', -12],
		['propTo', 'wand', 16, 62, 600],
		['stalk'],
		['pounce', -16],
		['propTo', 'wand', -6, 60, 420],
		['propOut', 'wand'],
		['emote', 'surprised'],
		['wait', 800],
		['look', 8, 92],
		['emote', 'annoyed'],
		['wait', 900],
		['groom'],
		['lookAhead']
	]
});

Scenes.add('push_off', {
	tags: ['play'],
	label: 'Pushing something off the edge',
	energy: 'mid',
	weight: 5,
	/* THE MUG STANDS ON A TABLE NOW.
	 *
	 * It used to hang at 84% of the stage with nothing underneath it, so she was
	 * pushing a mug out of thin air - and the joke only works if there is an edge
	 * to push it off.
	 *
	 * The table is declared before the mug so the mug draws on top of it, and the
	 * mug is placed so its base lands on the table's surface at about 84% rather
	 * than hovering over it. She sits at 26, which puts her right edge at 70 and
	 * the mug two percent beyond it - within a lean, because the paw only reaches
	 * about as far as her own outline. At her old spot the mug would have been
	 * outside her reach entirely.
	 *
	 * `nudge` already does the rest: the paw goes out, the mug slides, then falls
	 * thirty percent of the screen while spinning, and she watches it go and then
	 * looks away, unbothered.                                                  */
	beats: [
		/* the table and the mug placed exactly as in the tea break, so the two
		 * scenes read as the same table in the same room */
		/* LOWER. At y = 84 the top of the table crossed her chest, so it read as
		 * a tall table she was standing behind. Dropped to 89 the surface sits at
		 * about 90 to 96 - down by her feet, like a low table - and the legs run
		 * off the bottom of the screen, which is what legs do. */
		['prop', 'table', 'teaTable', 18, 89, 62, 9, 200 / 90],
		['prop', 'cup', 'mug', 58, 89, 10, 9, 60 / 54],
		['walkTo', 28],
		['sit'],
		['lookAhead'],
		['look', 63, 91],
		['wait', 600],

		/* SHE PICKS IT UP FIRST, the way she lifts the bowl in the meal: `sip`
		 * asks Rig.bounds() where her mouth is and brings the mug there, then sets
		 * it back down. This only started working today - until the prop-timing
		 * fix, `sip` on any prop but the first silently did nothing. */
		['sip', 'cup'],
		['emote', 'happy'],
		['wait', 500],

		/* and THEN knocks it off the edge, which is what the scene is for */
		['look', 63, 91],
		['nudge', 'cup'],
		['emote', 'happy'],
		['wait', 700],
		['lookAhead'],
		['blink'],
		['propOut', 'table']
	]
});

Scenes.add('loaf_still', {
	label: 'The loaf - doing nothing, well',
	energy: 'low',
	weight: 5,
	beats: [
		['walkTo', 34],
		['circle'],
		['loaf'],
		['emote', 'sleepy'],
		['wait', 3000],
		['slowBlink'],
		['wait', 3500],
		['ears', 6],
		['wait', 2500],
		['slowBlink'],
		['wait', 3000],
		['blink']
	]
});

Scenes.add('sleet_grump', {
	label: 'Sleet - stepping around the puddle',
	energy: 'mid',
	weight: 9,
	when: { precip: 'ra_sn' },
	beats: [
		['prop', 'pool', 'puddle', 46, 92, 26, 9],
		['walkTo', 18],
		['outfit', 'rain'],
		['look', 58, 94],
		['emote', 'annoyed'],
		['shake'],
		['wait', 600],
		['walkTo', 30],
		['head', 14],
		['wait', 700],
		['ears', 28],
		['hop'],
		['walkTo', 58],
		['shake'],
		['emote', 'annoyed'],
		['propOut', 'pool'],
		['lookAhead']
	]
});

Scenes.add('sunset_settle', {
	label: 'Settling down at sunset',
	energy: 'low',
	weight: 8,
	when: { hours: ['19:30', '22:30'] },
	beats: [
		['prop', 'sun', 'sun', 76, 66, 15, 4],
		['walkTo', 32],
		['look', 82, 70],
		['wait', 1200],
		['propTo', 'sun', 76, 82, 6000],
		['emote', 'sleepy'],
		['circle'],
		['curl'],
		['tail', -34],
		['slowBlink'],
		['wait', 1800],
		['lids', 1],
		['propOut', 'sun']
	]
});

Scenes.add('weekend_nap', {
	label: 'Weekend - a very long nap',
	energy: 'low',
	weight: 10,
	when: { weekend: true },
	beats: [
		['walkTo', 30],
		['yawn'],
		['circle'],
		['curl'],
		['lids', 1],
		['wait', 4000],
		['prop', 'z1', 'zzz', 52, 74, 7, 9],
		['propTo', 'z1', 60, 64, 2600],
		['propOut', 'z1'],
		['wait', 2000],
		['prop', 'z2', 'zzz', 54, 74, 6, 9],
		['propTo', 'z2', 63, 63, 2600],
		['propOut', 'z2'],
		['wait', 2400],
		['stretch'],
		['lids', 0.8],
		['wait', 1500]
	]
});

Scenes.add('gift_leaf', {
	tags: ['play'],
	label: 'Brings a leaf as a gift',
	energy: 'mid',
	weight: 3,
	when: { night: false },
	beats: [
		['prop', 'leaf', 'leaf', 92, 88, 10, 9],
		['walkTo', 66],
		['look', 95, 90],
		['stand'],
		['paw', 'R', -44, 400],
		['pawsDown'],
		['propTo', 'leaf', 66, 90, 700],
		['walkTo', 30],
		['propTo', 'leaf', 30, 90, 1400],
		['sit'],
		['lookAhead'],
		['emote', 'happy'],
		['wait', 1400],
		['head', 12],
		['wait', 1200],
		['propOut', 'leaf'],
		['blink']
	]
});

Scenes.add('laser', {
	tags: ['play'],
	label: 'Chasing the teaser wand',
	energy: 'high',
	weight: 2,
	when: { night: false },
	/* Also the wand, and the same reasoning: something with parts to it, dangling
	 * at the height a teaser dangles, snatched away each time she commits.     */
	beats: [
		['prop', 'wand', 'teaser', 8, 64, 22, 9, 110 / 150],
		['walkTo', 46],
		['look', 24, 78],
		['stalk'],
		['pounce', -20],
		['propTo', 'wand', 62, 62, 520],
		['look', 78, 76],
		['walkTo', 62],
		['stalk'],
		['pounce', 12],
		['propTo', 'wand', 30, 58, 460],
		['look', 46, 72],
		['head', -18],
		['hop'],
		['propTo', 'wand', 34, 50, 380],
		['propOut', 'wand'],
		['emote', 'annoyed'],
		['wait', 900],
		['groom'],
		['lookAhead']
	]
});

Scenes.add('birthday', {
	label: 'Birthday',
	energy: 'mid',
	weight: 40,
	when: { dates: [] },          /* filled from cat_birthday at load */
	beats: [
		/* THE CAKE STANDS ON THE TABLE, the same table as the tea break and the
		 * one she pushes the mug off, at the same height.
		 *
		 * The table is declared first so the cake draws on top of it. The cake is
		 * 26% wide, its art is 100x110, and its base sits at 100 of 110 - so
		 * y = 79.5 lands the base at about 94, which is on the table's surface
		 * rather than hovering over it. The candles then reach up to about 83,
		 * well clear of the clock.                                              */
		['prop', 'table', 'teaTable', 18, 89, 62, 9, 200 / 90],
		['prop', 'cake', 'cake', 46, 79.5, 26, 9, 100 / 110],
		['walkTo', 28],
		/* worn now, not parked next to her */
		['wear', 'wPartyHat'],
		['sit'],
		['look', 59, 85],
		['emote', 'surprised'],
		['wait', 900],
		['emote', 'happy'],
		['wait', 800],
		['head', 12],
		['mouth', 'wide'],
		['wait', 700],
		['mouth', 'closed'],
		['propOut', 'cake'],
		['emote', 'happy'],
		['wait', 1200],
		['lookAhead'],
		['propOut', 'table']
	]
});

Scenes.add('newyear', {
	label: 'New Year',
	energy: 'mid',
	weight: 20,
	when: { months: [12], dayMin: 20 },
	beats: [
		/* THE TREE IS BIGGER, there are presents under it, and she has a table with
		 * a fish on it - the same table as the tea break, the mug and the cake.
		 *
		 * Laid out so the three things do not fight: the tree and the presents on
		 * the left, her in the middle, the table across her right. The tree is
		 * scenery (z 4) so it stands behind everything and may be tall; the
		 * presents and the table are in front, and the presents stop where the
		 * table starts so neither hides the other.
		 *
		 * The tree art is 100x130, so at 34% wide it is 32% of the stage tall -
		 * from 52 down to 84, with the presents filling in below it.            */
		/* LOWER. At y = 52 the tree ended at about 77 while the presents start at
		 * 86, leaving nine percent of screen between them - the tree looked like it
		 * was hovering over its own presents. At 63 its base lands at about 88,
		 * just inside the top of the pile, and since the tree is scenery it draws
		 * behind them: the presents sit in front of the trunk, which is where
		 * presents sit. */
		['prop', 'tree', 'tree', 2, 63, 34, 4],
		['prop', 'gifts', 'gifts', 3, 86, 28, 9, 130 / 70],
		['prop', 'table', 'teaTable', 40, 89, 58, 9, 200 / 90],
		['prop', 'fish', 'fish', 58, 89, 14, 9, 60 / 34],
		['walkTo', 30],
		/* the scarf FIRST, then the hat: both live in the head slot, and an outfit
		 * reconciles every slot - so a party hat put on before `outfit` would be
		 * taken straight off again by the warm hat the cold outfit brings. */
		['outfit', 'cold'],
		['wear', 'wPartyHat'],

		/* the tree first */
		['look', 16, 72],
		['emote', 'happy'],
		['wait', 1000],
		['hop'],

		/* then the presents */
		['look', 14, 90],
		['head', 14],
		['emote', 'surprised'],
		['wait', 900],

		/* and then the fish, which is the part that matters to a cat */
		['look', 64, 91],
		['emote', 'happy'],
		['sip', 'fish'],
		['eat', 5],
		['wait', 600],
		['slowBlink'],
		['wait', 1000],
		['lookAhead'],
		['propOut', 'fish'],
		['propOut', 'table'],
		['propOut', 'gifts'],
		['propOut', 'tree']
	]
});

/* the birthday only exists if one has been configured */
(function () {
	var b = Scenes.find('birthday');
	if (b) b.when.dates = (typeof cat_birthday === 'string' && cat_birthday) ? [cat_birthday] : [];
})();
