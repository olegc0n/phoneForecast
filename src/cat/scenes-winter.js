/* scenes-winter.js - what Lili does when it is cold.
 *
 * Fifty scenes for the months when the forecast reads +5 and overcast, or snow.
 * All of them are data: lists of beats, the same format as scenes.js, picked by
 * the same matcher. Nothing here issues a tween.
 *
 * FOUR KINDS OF DAY
 *
 *   cold and dry     no precipitation, up to +8. Grey November: her breath shows,
 *                    the birds are at the feeder, and it smells of snow.
 *   snow             precip 'sn'. The first flake, playing in it, and coming
 *                    back indoors afterwards.
 *   sleet and ice    precip 'ra_sn', or dry and around freezing.
 *   cosy             nothing but the temperature: at +7 or below there is cocoa,
 *                    a radiator, a blanket - whatever is falling outside.
 *
 * The values in `when` are the ones weather.js really produces (splitCode and
 * derive): precip is null, 'ra', 'sn' or 'ra_sn'; sky is 'skc', 'bkn' or 'ovc'.
 * `precip: null` therefore means DRY, which is not the same as leaving it out.
 *
 * WHERE THINGS ARE
 *
 * Everything is percent of the stage. She is 44 wide and about 32 tall and
 * stands on the bottom edge, so with ['walkTo', 28] she occupies 28 to 72 across
 * and 68 to 100 down, her nose at (50, 77). Nothing is placed above 63 - that
 * is where the clock is - except falling snow in the layer behind the forecast,
 * which the clock draws over. Where a prop has to sit ON her (snow on her head,
 * a blanket) it is placed with `propOn` / `propToCat`, as a fraction of her own
 * box, instead of a number that is only right on one screen.
 *
 * HOW OFTEN
 *
 * On a snowy day thirty-odd of these are eligible at once, and the day has 780
 * slots in it. Two numbers keep that in proportion, and they do different jobs:
 *
 *   weight   is LOW - between 0.5 and 0.8, where an everyday scene has 5 to 10.
 *            The planner fills the day in order, so a scene with a normal
 *            weight and a cap is used up by noon and never seen again. A low
 *            weight is what spreads these across the whole day instead.
 *   perDay   is a ceiling, not a target: 2, which the planner scales by the
 *            real rate to twelve showings. Most scenes settle at eight to twelve.
 *
 * Together they give the winter scenes about a third of a snowy or a cold dry
 * day and a fifth of a sleety one, with the desk still by far the most frequent
 * thing on a working day (about 120 to 145 sessions) and lunch untouched.
 * `node tools/check-plan.js --weather snow --counts` (or cold, or sleet) prints
 * the day they produce.
 *
 * Nobody is ever sent to x = 0 exactly: cat.js reads a zero position as "not
 * placed yet" and puts her back at 60 the next time it lays the stage out,
 * which is at the end of every scene. 1 is as far left as these go.
 *
 * `dur` is only what the test menu prints beside the name. The runner adds up
 * the beats and uses the real length; tools/check-scenes.js fails if the two
 * drift more than three seconds apart.
 *
 * Every scene sets `live: true` (see L() in beats.js), which is what lets a
 * prop move twice in a row and a fade actually fade. `add` below does it.     */

(function () {

	var DRY = null;                        /* wx.precip when nothing is falling */

	function add(id, def) {
		def.live = true;
		if (def.perDay === undefined) def.perDay = 2;
		Scenes.add(id, def);
	}

	/* the snow lying on the ground: a low strip, and a deep field of it */
	var GROUND = ['prop', 'gr', 'snowGround', 0, 93.6, 100, 3, 200 / 24];
	var FIELD  = ['prop', 'gr', 'drift', -4, 84, 108, 3, 200 / 60];

	/* ================================================================== *
	 *  COLD AND DRY                                                      *
	 * ================================================================== */

	/* She yawns, and something comes out. Then she does it on purpose. */
	add('breath_clouds', {
		label: 'Her breath shows - and she notices',
		dur: 15500,
		energy: 'low',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8 },
		beats: [
			['walkTo', 26], ['sit'], ['lookAhead'], ['wait', 400],
			['also', 'yawn'], ['wait', 700], ['breath', 1], ['wait', 200],
			['emote', 'surprised'], ['look', 68, 76], ['wait', 400],
			['relax'],
			/* on purpose this time */
			['mouth', 'small'], ['also', 'breath', 1], ['wait', 500], ['mouth', 'closed'],
			['look', 68, 76], ['also', 'bat', 'R'], ['wait', 700],
			['emote', 'happy'], ['relax'],
			/* a big one, both ways, and a jump after it */
			['stand'], ['mouth', 'wide'], ['pose', 'head', 'y', -4, 300],
			['also', 'breath', -1], ['breath', 1], ['mouth', 'closed'],
			['jump', 16], ['relax'], ['slowBlink']
		]
	});

	/* It is not snowing. It is about to. A cat knows. */
	add('sky_sniff', {
		label: 'Smells snow coming',
		dur: 17000,
		energy: 'low',
		weight: 0.6,
		when: { precip: DRY, sky: 'ovc', tempMax: 4 },
		beats: [
			['prop', 'cloud', 'cloud', 66, 63.5, 36, 4],
			['also', 'propTo', 'cloud', 4, 63.5, 16000, 'lin'],
			['walkTo', 30], ['look', 62, 64], ['pose', 'head', 'y', -4, 400], ['wait', 700],
			['sniff'], ['ears', -10], ['wait', 300], ['sniff'],
			['tailSwish', 4],
			['emote', 'surprised'], ['wait', 500],
			/* so she gets ready for it */
			['outfit', 'cold'], ['wait', 600],
			['relax'], ['sit'],
			['look', 40, 64], ['pose', 'head', 'y', -3, 400],
			['tailSwish', 3], ['slowBlink'], ['wait', 500],
			['breath', -1], ['wait', 400],
			['propOut', 'cloud'], ['relax']
		]
	});

	/* A bullfinch on the rowan. She cannot reach it and says so. */
	add('rowan_bullfinch', {
		tags: ['play'],
		label: 'A bullfinch on the rowan',
		dur: 19500,
		energy: 'high',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8, night: false },
		beats: [
			['prop', 'twig', 'branch', -4, 66, 36, 9, 160 / 60],
			['prop', 'bird', 'bullfinch', -12, 63.6, 9, 9, 52 / 46, 'hidden'],
			['walkTo', 44], ['face', -1], ['sit'], ['wait', 300],
			/* it lands, and the branch dips */
			['also', 'propFade', 'bird', 1, 250],
			['propTo', 'bird', 13, 63.6, 1100, 'out'],
			['also', 'wiggle', 'twig', 3, 3, 170],
			['look', 16, 66], ['ears', -12], ['wait', 400],
			['wiggle', 'bird', 14, 4, 150],
			/* the chatter */
			['stand'], ['stalk'],
			['also', 'tailSwish', 4], ['chatter', 10],
			['wiggle', 'bird', 14, 4, 150],
			['chatter', 8],
			/* she goes; so does it */
			['also', 'leap', -16, 26], ['wait', 260],
			['also', 'propScale', 'bird', -1, 1, 100],
			['also', 'wiggle', 'twig', 5, 5, 150],
			['propTo', 'bird', -14, 63.6, 700, 'in'],
			['wait', 300],
			['look', 4, 70], ['emote', 'annoyed'], ['wait', 900],
			/* she meant to do that */
			['relax'], ['face', 1], ['groom'], ['lookAhead'],
			['propOut', 'bird'], ['propOut', 'twig']
		]
	});

	/* She reads the thermometer, feels it, and dresses accordingly. */
	add('thermo_check', {
		label: 'Reads the thermometer, dresses for it',
		dur: 17000,
		energy: 'mid',
		weight: 0.5,
		/* above zero only: at zero and below the weather has already put the hat
		 * on her, and there would be nothing left for the scene to do */
		when: { precip: DRY, tempMin: 1, tempMax: 7 },
		beats: [
			['prop', 'th', 'thermoCold', 82, 70, 7, 9],
			['walkTo', 34], ['look', 86, 78], ['wait', 600], ['tilt'],
			['tint', 'cold', 0.4, 1500], ['shiver', 2],
			['emote', 'annoyed'], ['wait', 400],
			['outfit', 'cold'], ['wait', 800],
			['tint', 'cold', 0, 1200],
			['relax'], ['emote', 'happy'], ['purr'],
			/* a flick of the tail at it, and done */
			['look', 86, 78], ['pose', 'tail', 'rot', -28, 250], ['wait', 600],
			['relax'], ['propOut', 'th']
		]
	});

	/* Three times it comes off. The third time she gives in and sleeps on it. */
	add('scarf_slip', {
		label: 'The scarf that will not stay on',
		dur: 22500,
		energy: 'mid',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8 },
		beats: [
			['walkTo', 28], ['outfit', 'cold'], ['lookAhead'],
			['propOn', 'sc', 'tossScarf', 0.5, 0.42, 16, 9, 2, 'hidden'],
			['emote', 'happy'], ['relax'],

			/* once */
			['unwear', 'neck'], ['also', 'propFade', 'sc', 1, 200], ['fall', 'sc', 95, 600, 'in'],
			['look', 50, 97], ['emote', 'surprised'],
			['paw', 'R', -50, 350], ['propHome', 'sc', 500, 'out'],
			['also', 'propFade', 'sc', 0, 250], ['wear', 'wScarf'], ['pawsDown'], ['relax'],

			/* twice, and a look at us about it */
			['unwear', 'neck'], ['also', 'propFade', 'sc', 1, 200], ['fall', 'sc', 95, 500, 'in'],
			['lookAhead'], ['lids', 0.5], ['wait', 900],
			['look', 50, 97], ['paw', 'R', -50, 300], ['propHome', 'sc', 450, 'out'],
			['also', 'propFade', 'sc', 0, 250], ['wear', 'wScarf'],
			/* held on, this time */
			['paw', 'R', -40, 300], ['emote', 'happy'], ['wait', 600],

			/* and then she sneezes */
			['also', 'pawsDown'], ['sneeze'],
			['unwear', 'neck'], ['also', 'propFade', 'sc', 1, 200], ['fall', 'sc', 95, 500, 'in'],
			['relax'], ['look', 50, 97], ['wait', 700],
			['emote', 'annoyed'],

			/* fine. It is a bed. */
			['relax'], ['curl'], ['wait', 1300],
			['propOut', 'sc']
		]
	});

	/* Somebody lost a mitten. For a while it is a hat. */
	add('mitten_find', {
		label: 'A lost mitten',
		dur: 20000,
		energy: 'mid',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8 },
		beats: [
			['prop', 'mit', 'mitten', 80, 91.6, 11, 9, 52 / 58],
			['walkTo', 30], ['look', 85, 95], ['emote', 'surprised'], ['relax'],
			['walkTo', 42], ['look', 85, 95], ['sniff'],
			['also', 'wiggle', 'mit', 12, 4, 160], ['pawTap', 'R', 2],
			['tilt'],
			/* onto her head it goes */
			['paw', 'R', -70, 400], ['propToCat', 'mit', 0.5, 0.055, 700],
			['pawsDown'], ['lookAhead'], ['emote', 'happy'], ['wait', 1300],
			['relax'],
			/* until she sneezes */
			['also', 'fall', 'mit', 92.6, 650, 'in'], ['also', 'spin', 'mit', 200, 650], ['sneeze'],
			['look', 64, 96], ['wait', 500], ['relax'],
			['curl'], ['wait', 1000],
			['propOut', 'mit']
		]
	});

	/* The last leaf comes down, and is not what it looked like. */
	add('last_leaf', {
		label: 'The last leaf of autumn',
		dur: 20000,
		energy: 'low',
		weight: 0.5,
		when: { precip: DRY, tempMin: -2, tempMax: 8 },
		beats: [
			['prop', 'leaf', 'leaf', 58, 63.5, 9, 9],
			['walkTo', 12], ['lookAhead'],
			['also', 'fall', 'leaf', 93.5, 5200, 'lin'],
			['also', 'sway', 'leaf', 9, 5, 5200],
			['also', 'spin', 'leaf', 150, 5200],
			['look', 62, 66], ['wait', 1100],
			['look', 66, 76], ['wait', 1200],
			['look', 60, 86], ['wait', 1100],
			['look', 62, 95], ['wait', 300],
			['walkTo', 26],
			['look', 62, 96], ['sniff'],
			['also', 'wiggle', 'leaf', 8, 3, 160], ['pawTap', 'R', 2],
			/* one more pat - and it is frozen stiff, and goes to bits */
			['pawTap', 'R', 1],
			['also', 'propScale', 'leaf', 1.5, 0.3, 300], ['propFade', 'leaf', 0, 450],
			['emote', 'surprised'], ['wait', 500],
			['shakePaw', 'R'], ['relax'],
			['look', 62, 64], ['wait', 700], ['lookAhead']
		]
	});

	/* A tit at the feeder, which leaves when she looks and returns when she doesn't. */
	add('feeder_tits', {
		label: 'The bird table',
		dur: 20500,
		energy: 'mid',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8, night: false },
		beats: [
			['prop', 'fd', 'feeder', 4, 63.5, 17, 9, 80 / 84],
			['prop', 'tit', 'tit', -12, 67, 8, 9, 52 / 46, 'hidden'],
			['walkTo', 46], ['face', -1], ['sit'],
			['also', 'propFade', 'tit', 1, 250],
			['propTo', 'tit', 9, 67, 900, 'out'], ['also', 'wiggle', 'fd', 4, 3, 200],
			['look', 12, 70], ['ears', -12], ['wait', 300],
			['wiggle', 'tit', 16, 4, 140],
			['also', 'tailSwish', 5], ['chatter', 10],
			/* closer... */
			['stand'], ['walkTo', 34],
			['also', 'propScale', 'tit', -1, 1, 100], ['propTo', 'tit', -12, 64.5, 600, 'in'],
			['look', 2, 66], ['wait', 500], ['emote', 'annoyed'], ['wait', 400],
			/* she turns her back on the whole business */
			['relax'], ['face', 1], ['sit'], ['also', 'groom'], ['wait', 700],
			['also', 'propScale', 'tit', 1, 1, 100], ['propTo', 'tit', 9, 67, 800, 'out'],
			['wiggle', 'tit', 16, 4, 140],
			['earTwitch'],
			/* and whips round */
			['face', -1], ['emote', 'surprised'],
			['also', 'propScale', 'tit', -1, 1, 100], ['propTo', 'tit', -12, 64.5, 450, 'in'],
			['wait', 600], ['relax'], ['face', 1], ['lookAhead'], ['slowBlink'],
			['propOut', 'tit'], ['propOut', 'fd']
		]
	});

	/* Cold, so she does something about it. */
	add('warm_up', {
		tags: ['play'],
		label: 'Warming up - the exercises',
		dur: 13500,
		energy: 'high',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8, night: false },
		beats: [
			['walkTo', 28], ['shiver', 1],
			['stretch'], ['jump', 12], ['jump', 18],
			['slide', 4, 700], ['slide', 50, 900],
			['twirl', 2], ['jump', 20],
			['also', 'pant'], ['wait', 500], ['breath', 1],
			['emote', 'happy'], ['relax']
		]
	});

	/* There is something on top of her head and she is going to get it. */
	add('hat_pompom', {
		tags: ['play'],
		label: 'The pom-pom on her own hat',
		dur: 23000,
		energy: 'high',
		weight: 0.5,
		when: { precip: DRY, tempMax: 8 },
		beats: [
			['walkTo', 28], ['outfit', 'cold'], ['wait', 600],
			/* the same drawing as the hat she is wearing, laid exactly over it */
			['propOn', 'hat', 'warmHat', 0.5, 0.084, 17.6, 9, 80 / 60, 'hidden'],
			['look', 51, 62], ['crossEyes', 0.6], ['wait', 500],
			['bat', 'R'], ['bat', 'L'], ['wait', 250], ['bat', 'R'],
			['crossEyes', 0],
			/* round and round after it */
			['twirl', 2], ['dizzy'],
			/* a jump - and it comes off */
			['also', 'jump', 18], ['wait', 340],
			['also', 'unwear', 'head'], ['also', 'propFade', 'hat', 1, 120],
			['also', 'spin', 'hat', 160, 700], ['propTo', 'hat', 74, 92, 700, 'in'],
			['look', 82, 95], ['emote', 'surprised'], ['relax'],
			['stalk'], ['leap', 12, 22],
			['also', 'propScale', 'hat', 1.1, 0.8, 150], ['wait', 200],
			['propScale', 'hat', 1, 1, 200],
			['emote', 'happy'], ['wait', 500], ['relax'],
			/* back on, slightly smug */
			['paw', 'R', -64, 300], ['propToCat', 'hat', 0.5, 0.084, 500, 'out'],
			['also', 'propFade', 'hat', 0, 300], ['wear', 'wWarmHat'], ['pawsDown'],
			['lookAhead'], ['slowBlink']
		]
	});

	/* The floor is cold. There are felt boots. She gets in. */
	add('valenki', {
		label: 'Cold paws - the felt boots',
		dur: 21500,
		energy: 'mid',
		weight: 0.5,
		when: { precip: DRY, tempMax: 6 },
		beats: [
			['prop', 'boots', 'valenki', 62, 86.6, 30, 9, 110 / 76, 'hidden'],
			['walkTo', 8], ['also', 'propFade', 'boots', 1, 500],
			['shakePaw', 'L'], ['shakePaw', 'R'], ['jump', 8],
			['emote', 'annoyed'], ['look', 30, 99], ['wait', 300], ['relax'],
			['look', 76, 92], ['emote', 'surprised'], ['relax'],
			['walkTo', 55],
			['look', 77, 96], ['sniff'],
			['jump', 10], ['sit'],
			['emote', 'happy'], ['purr'],
			['pose', 'tail', 'rot', -22, 400], ['wait', 500], ['relax'],
			['propOut', 'boots']
		]
	});

	/* Her nose is cold. The scarf goes up over it. */
	add('muffler_up', {
		label: 'Cold nose - scarf up to the eyes',
		dur: 16000,
		energy: 'low',
		weight: 0.5,
		when: { precip: DRY, tempMax: 4 },
		beats: [
			['walkTo', 28], ['outfit', 'cold'], ['sit'], ['lookAhead'], ['wait', 400],
			['tint', 'cold', 0.4, 1400], ['sniff'],
			['paw', 'R', -72, 400], ['wait', 400], ['pawsDown'],
			['sneeze'],
			/* both paws to it, and up it comes */
			['pose', 'pawFL', 'rot', -58, 350], ['pose', 'pawFR', 'rot', -58, 350], ['wait', 300],
			['propOn', 'muf', 'muffler', 0.5, 0.395, 25, 9, 90 / 36],
			['pawsDown'], ['tint', 'cold', 0, 1400],
			/* just her eyes, going from side to side */
			['pose', 'pupilL', 'x', -2.4, 300], ['pose', 'pupilR', 'x', -2.4, 300], ['wait', 800],
			['pose', 'pupilL', 'x', 2.4, 400], ['pose', 'pupilR', 'x', 2.4, 400], ['wait', 800],
			['pose', 'pupilL', 'x', 0, 300], ['pose', 'pupilR', 'x', 0, 300], ['wait', 300],
			['slowBlink'], ['pose', 'tail', 'rot', -24, 500], ['eyesShut'], ['wait', 1200],
			['eyesOpen'], ['propOut', 'muf'],
			['emote', 'happy'], ['wait', 500], ['relax']
		]
	});

	/* After dark, under the lamp, with her breath lit up. */
	add('dusk_lamp', {
		label: 'Under the street lamp',
		dur: 19500,
		energy: 'low',
		weight: 0.6,
		when: { precip: DRY, tempMax: 8, night: true },
		beats: [
			['prop', 'lamp', 'streetLamp', 52, 63.4, 26, 3, 80 / 200],
			['prop', 'leaf', 'leaf', 70, 64, 7, 9, 40 / 30, 'hidden'],
			['walkTo', 4], ['walkTo', 30],
			['look', 65, 65], ['wait', 700],
			['breath', 1], ['wait', 300], ['sit'],
			['look', 65, 65], ['slowBlink'],
			/* one leaf through the light */
			['also', 'propFade', 'leaf', 1, 300],
			['also', 'fall', 'leaf', 94, 4200, 'lin'],
			['also', 'sway', 'leaf', 7, 4, 4200],
			['also', 'spin', 'leaf', -160, 4200],
			['look', 74, 70], ['wait', 900],
			['look', 76, 82], ['wait', 900],
			['look', 74, 94], ['wait', 800],
			['propOut', 'leaf'],
			['lookAhead'], ['also', 'yawn'], ['wait', 700], ['breath', -1], ['wait', 300],
			['emote', 'sleepy'], ['wait', 900], ['relax'],
			['propOut', 'lamp']
		]
	});

	/* She huffs a hole in the frost, looks out, and signs the glass. */
	add('frost_window', {
		label: 'Frost on the window',
		dur: 20000,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 1 },
		beats: [
			['prop', 'win', 'window', 5, 65, 22, 2, 120 / 150],
			['prop', 'fr', 'frost', 5, 65, 22, 3, 120 / 150],
			['prop', 'pp', 'pawprints', 12, 73, 7, 4, 34 / 24, 'hidden'],
			['walkTo', 30], ['face', -1], ['look', 14, 72], ['wait', 500], ['tilt'],
			['walkTo', 26],
			/* a breath on the glass clears it */
			['also', 'propFade', 'fr', 0.3, 900], ['breath', -1],
			['pose', 'head', 'x', -5, 400], ['look', 12, 72], ['wait', 1200],
			/* and it grows back */
			['propFade', 'fr', 1, 1500],
			['pose', 'head', 'x', 0, 300], ['emote', 'annoyed'], ['wait', 400], ['relax'],
			/* so she leaves her mark on it instead */
			['look', 14, 76], ['pawTap', 'R', 2],
			['propFade', 'pp', 1, 300],
			['emote', 'happy'], ['wait', 1300],
			['relax'], ['face', 1], ['slowBlink'],
			['propOut', 'pp'], ['propOut', 'fr'], ['propOut', 'win']
		]
	});

	/* No sun today, so she switches one on and lies in it. */
	add('lamp_sun', {
		label: 'A grey day - making her own sunshine',
		dur: 24000,
		energy: 'low',
		weight: 0.6,
		when: { precip: DRY, sky: 'ovc', tempMax: 8, night: false },
		beats: [
			['prop', 'lamp', 'deskLamp', 4, 85.6, 16, 9, 70 / 96],
			['prop', 'glow', 'sunpatch', 14, 81, 66, 4, 160 / 90, 'hidden'],
			['walkTo', 22], ['look', 60, 64], ['wait', 500],
			['emote', 'sad'], ['wait', 900], ['relax'],
			['look', 12, 90], ['tilt'],
			/* click */
			['pawTap', 'L', 1], ['propFade', 'glow', 1, 250],
			['emote', 'surprised'], ['wait', 300], ['relax'],
			['walkTo', 26], ['circle'], ['sprawl'],
			['purr'], ['pose', 'tail', 'rot', -24, 600], ['slowBlink'], ['wait', 900],
			['getUp'], ['stretch'],
			['propOut', 'glow'], ['propOut', 'lamp']
		]
	});

	/* ================================================================== *
	 *  SNOW                                                              *
	 * ================================================================== */

	/* One flake, all the way down, onto her nose. Then she looks up. */
	add('first_flake', {
		label: 'The first snowflake',
		dur: 22000,
		energy: 'low',
		weight: 0.7,
		when: { precip: 'sn' },
		beats: [
			['prop', 'fl', 'flakeBig', 58, 63.4, 7.5, 9, 1],
			['walkTo', 28], ['lookAhead'],
			['also', 'fall', 'fl', 71.5, 3800, 'lin'],
			['also', 'sway', 'fl', 6, 4, 3800],
			['also', 'spin', 'fl', 120, 3800],
			['look', 62, 64], ['ears', -10], ['wait', 800],
			['look', 64, 68], ['wait', 900],
			['look', 58, 71], ['wait', 500],
			/* and it settles */
			['also', 'spin', 'fl', 200, 1500], ['propToCat', 'fl', 0.5, 0.275, 1500, 'io'],
			['lookAhead'], ['crossEyes', 1], ['wait', 1200],
			['sniff'],
			/* gone - it was only water */
			['also', 'propScale', 'fl', 0.2, 0.2, 900], ['propFade', 'fl', 0, 900],
			['crossEyes', 0], ['sneeze'],
			/* and then she looks up, and there are more */
			['also', 'snowfall', 8], ['also', 'snowfall', 3, 0, 'near'],
			['look', 50, 62], ['pose', 'head', 'y', -4, 400], ['wait', 1300],
			['emote', 'surprised'], ['emote', 'happy'],
			['jump', 16], ['twirl', 1], ['relax'],
			['look', 40, 64], ['wait', 700], ['lookAhead']
		]
	});

	/* Mouth open, head back. The first misses, the second gets her in the eye. */
	add('tongue_catch', {
		tags: ['play'],
		label: 'Catching flakes on her tongue',
		dur: 18500,
		energy: 'mid',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 6],
			['prop', 'f1', 'flakeBig', 37, 63.4, 6.5, 9, 1, 'hidden'],
			['prop', 'f2', 'flakeBig', 54, 63.4, 6.5, 9, 1, 'hidden'],
			['prop', 'f3', 'flakeBig', 47, 63.4, 6.5, 9, 1, 'hidden'],
			['walkTo', 28], ['look', 50, 62], ['pose', 'head', 'y', -5, 400], ['wait', 400],
			['mouth', 'wide'],
			/* wide of her */
			['also', 'propFade', 'f1', 1, 200], ['also', 'sway', 'f1', 3, 2, 1800],
			['fall', 'f1', 82, 1800, 'lin'],
			['also', 'propOut', 'f1'], ['look', 40, 84], ['wait', 300],
			['mouth', 'closed'], ['tailFlick'],
			/* in the eye */
			['look', 50, 62], ['mouth', 'wide'],
			['also', 'propFade', 'f2', 1, 200], ['propToCat', 'f2', 0.6, 0.25, 1500, 'lin'],
			['also', 'propFade', 'f2', 0, 300], ['mouth', 'closed'], ['shake'],
			/* got it */
			['look', 50, 62], ['pose', 'head', 'y', -5, 400], ['mouth', 'wide'],
			['also', 'tailSwish', 3],
			['also', 'propFade', 'f3', 1, 200], ['propToCat', 'f3', 0.5, 0.3, 1600, 'lin'],
			['also', 'propFade', 'f3', 0, 200], ['mouth', 'closed'],
			['eat', 3],
			['emote', 'happy'], ['jump', 14], ['relax'], ['slowBlink']
		]
	});

	/* She lies down in it and leaves the shape of herself behind. */
	add('snow_angel', {
		tags: ['play'],
		label: 'A snow angel',
		dur: 19000,
		energy: 'mid',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			FIELD,
			['prop', 'an', 'snowAngel', 39, 85.5, 46, 4, 160 / 76, 'hidden'],
			['walkTo', 40], ['look', 62, 98], ['wait', 400],
			['emote', 'happy'], ['jump', 12], ['relax'],
			['sprawl'], ['angel', 3], ['wait', 300],
			['also', 'propFade', 'an', 1, 700], ['getUp'],
			['walkTo', 1], ['face', 1],
			['look', 62, 92], ['wait', 300],
			['emote', 'happy'], ['tailSwish', 4], ['wait', 500],
			['relax'], ['slowBlink'],
			['propOut', 'an'], ['propOut', 'gr']
		]
	});

	/* A snowman: a ball rolled up, a head patted on - and her own hat on top. */
	add('snowman', {
		tags: ['play'],
		label: 'Builds a snowman, and gives it her hat',
		dur: 25000,
		energy: 'mid',
		weight: 0.7,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			GROUND,
			['prop', 'base', 'snowball', 62, 94.4, 6, 9, 1],
			['prop', 'head', 'snowball', 60, 93.6, 7, 9, 1, 'hidden'],
			['prop', 'face', 'snowFace', 78.4, 82.55, 12.3, 9, 44 / 40, 'hidden'],
			['walkTo', 16], ['outfit', 'snow'], ['look', 66, 96], ['wait', 300],
			/* roll it up: it grows as it goes, and she goes after it */
			['also', 'propTo', 'base', 81, 90.6, 2200, 'io'],
			['also', 'propScale', 'base', 3.3, 3.3, 2200],
			['also', 'spin', 'base', 540, 2200],
			['walkTo', 30], ['look', 84, 92], ['wait', 800],
			['pawTap', 'R', 2],
			/* the head, made at her feet and lifted on */
			['propFade', 'head', 1, 400], ['look', 63, 96], ['knead'],
			['propScale', 'head', 1.6, 1.6, 500],
			['paw', 'R', -58, 300], ['propTo', 'head', 80.5, 83.7, 800, 'io'], ['pawsDown'],
			/* a face */
			['pawTap', 'R', 2],
			['also', 'propFade', 'head', 0, 500], ['propFade', 'face', 1, 400],
			['emote', 'happy'], ['look', 84, 84], ['wait', 300],
			/* something is missing. Her hat. */
			['relax'], ['paw', 'R', -70, 350],
			['propOn', 'hat', 'warmHat', 0.5, 0.084, 17.6, 9, 80 / 60, 'hidden'],
			['also', 'unwear', 'head'], ['also', 'propFade', 'hat', 1, 150],
			['also', 'propScale', 'hat', 0.55, 0.55, 900],
			['propTo', 'hat', 75.2, 78.65, 900, 'io'], ['pawsDown'],
			['pose', 'earL', 'rot', 20, 300], ['pose', 'earR', 'rot', 20, 300], ['wait', 600],
			['emote', 'happy'], ['purr'], ['relax'],
			['propOut', 'hat'], ['propOut', 'face'], ['propOut', 'base'], ['propOut', 'gr']
		]
	});

	/* A cat made of snow. Then two cats, sitting the same way. */
	add('snow_cat', {
		label: 'Makes a small snow-cat',
		dur: 20500,
		energy: 'low',
		weight: 0.7,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			GROUND,
			['prop', 'sc', 'snowCat', 60, 86.5, 20, 9, 1, 'hidden'],
			['walkTo', 16], ['look', 68, 96], ['wait', 300],
			['pose', 'head', 'rot', 14, 400], ['pose', 'head', 'y', 5, 400],
			['knead'], ['pawTap', 'R', 3],
			['also', 'propFade', 'sc', 1, 1400], ['knead'], ['pawTap', 'R', 2],
			['relax'], ['look', 70, 88], ['tilt'],
			/* nose to nose */
			['pose', 'head', 'x', 6, 400], ['pose', 'head', 'rot', 10, 400], ['wait', 900],
			['relax'], ['emote', 'happy'], ['wait', 400],
			/* and then the same pose, side by side */
			['relax'], ['sit'], ['pose', 'tail', 'rot', -30, 500], ['lookAhead'], ['wait', 1200],
			['slowBlink'], ['wait', 600],
			['propOut', 'sc'], ['propOut', 'gr']
		]
	});

	/* She looks round and something has been following her. */
	add('footprints', {
		label: 'Footprints in fresh snow',
		dur: 21000,
		energy: 'mid',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 6],
			FIELD,
			['prop', 'one', 'pawprints', 44, 95.6, 7, 4, 34 / 24, 'hidden'],
			['walkTo', 1],
			/* laid down under her as she goes, so they show once she has passed */
			['also', 'trail', 'pawprints', 5, 42, 95.4, 6, 7, 440, 6800, 4],
			['walkTo', 50],
			['face', -1], ['look', 20, 97], ['emote', 'surprised'], ['wait', 900], ['relax'],
			/* one more, on purpose, to be sure */
			['look', 47, 98], ['pawTap', 'R', 1], ['propFade', 'one', 1, 250],
			['look', 47, 98], ['emote', 'happy'], ['wait', 700], ['relax'],
			/* and the snow fills them in again */
			['look', 20, 97], ['wait', 1600], ['tilt'],
			['propOut', 'one'],
			['face', 1], ['look', 50, 62], ['wait', 600], ['lookAhead'],
			['propOut', 'gr']
		]
	});

	/* In she goes. Ears, then eyes, then all of her, wearing some of it. */
	add('drift_dive', {
		tags: ['play'],
		label: 'Diving into a snowdrift',
		dur: 17000,
		energy: 'high',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			['prop', 'dr', 'drift', 22, 88.6, 56, 9, 200 / 60, 'hidden'],
			['walkTo', 1], ['propFade', 'dr', 1, 500],
			['look', 60, 92], ['stalk'],
			['also', 'tailSwish', 3], ['wait', 600],
			['leap', 28, 34],
			['also', 'wiggle', 'dr', 2, 3, 120], ['sink', 15, 300],
			['propOn', 'cap', 'snowCap', 0.5, 0.085, 18, 9, 60 / 26, 'hidden'],
			['wait', 800],
			['pose', 'earL', 'rot', -16, 150], ['wait', 300],
			['pose', 'earR', 'rot', -16, 150], ['wait', 500],
			/* eyes over the top */
			['also', 'propFade', 'cap', 1, 300], ['sink', 8, 400], ['wait', 300],
			['look', 20, 80], ['wait', 300], ['look', 80, 80], ['wait', 300],
			['sink', 0, 350],
			['lookAhead'], ['emote', 'happy'], ['wait', 900],
			['relax'],
			['also', 'fall', 'cap', 96, 700, 'in'], ['also', 'spin', 'cap', 120, 700],
			['also', 'propFade', 'cap', 0, 700], ['shake'],
			['jump', 12], ['relax'],
			['propOut', 'dr']
		]
	});

	/* She sat still for too long. */
	add('snow_hat', {
		label: 'Sat still too long - a hat of snow',
		dur: 18500,
		energy: 'low',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 7],
			['also', 'snowfall', 3, 0, 'near'],
			['prop', 'z', 'zzz', 60, 71, 6, 9, 1, 'hidden'],
			['walkTo', 28], ['sit'], ['look', 50, 62], ['wait', 500],
			['lookAhead'], ['emote', 'sleepy'], ['wait', 600],
			['propOn', 'cap', 'snowCap', 0.5, 0.155, 13, 9, 60 / 26],
			['also', 'propScale', 'cap', 1.45, 1.5, 5200],
			['eyesShut'], ['wait', 1300], ['earTwitch'], ['wait', 900],
			['also', 'propFade', 'z', 0.9, 400], ['propTo', 'z', 66, 64, 2000],
			['also', 'propOut', 'z'], ['wait', 700],
			/* one eye opens */
			['eyesOpen'], ['crossEyes', 0.5], ['wait', 700],
			['emote', 'surprised'], ['crossEyes', 0],
			['also', 'propTo', 'cap', 78, 93, 800, 'in'], ['also', 'spin', 'cap', 240, 800],
			['shake'], ['propFade', 'cap', 0, 300],
			['relax'], ['sneeze'], ['stand'], ['stretch'], ['lookAhead']
		]
	});

	/* Down the slope, back up with the sled, and down again rather faster. */
	add('sled_ride', {
		tags: ['play'],
		label: 'Sledging',
		dur: 22500,
		energy: 'high',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			GROUND,
			['prop', 'sl', 'sled', 0, 89.6, 44, 9, 130 / 52],
			['walkTo', 1], ['face', 1], ['sit'], ['emote', 'happy'],
			['pose', 'earL', 'rot', 22, 300], ['pose', 'earR', 'rot', 22, 300], ['mouth', 'wide'],
			['also', 'propTo', 'sl', 56, 89.6, 1300, 'out'], ['slide', 56, 1300],
			['mouth', 'closed'], ['relax'], ['jump', 10],
			/* dragging it back up: the sled keeps pace with the walk */
			['also', 'propTo', 'sl', 0, 89.6, 2940, 'io'], ['walkTo', 1],
			['face', 1], ['sit'], ['wait', 300],
			/* again - and this time the sled does not stop */
			['pose', 'earL', 'rot', 22, 300], ['pose', 'earR', 'rot', 22, 300], ['mouth', 'wide'],
			['also', 'propTo', 'sl', 116, 89.6, 1200, 'lin'], ['slide', 56, 900],
			['mouth', 'closed'], ['twirl', 1], ['dizzy'],
			['sit'], ['emote', 'happy'], ['wait', 600], ['relax'],
			['propOut', 'sl'], ['propOut', 'gr']
		]
	});

	/* She shakes the tree. The tree answers. She moves; it answers again. */
	add('fir_snow', {
		label: 'The fir tree drops its snow on her',
		dur: 21000,
		energy: 'mid',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			['prop', 'fir', 'firSnow', 54, 63.2, 44, 4, 100 / 130],
			['walkTo', 44], ['look', 76, 66], ['wait', 500],
			['propOn', 'c1', 'snowCap', 0.5, -0.09, 16, 9, 60 / 26, 'hidden'],
			['also', 'wiggle', 'fir', 2.5, 4, 140], ['bat', 'R'],
			['also', 'wiggle', 'fir', 3, 4, 140], ['bat', 'R'],
			/* down it comes */
			['also', 'propFade', 'c1', 1, 150], ['propToCat', 'c1', 0.5, 0.075, 420, 'in'],
			['also', 'propScale', 'c1', 1.25, 0.8, 150], ['pose', 'body', 'sy', 0.93, 120],
			['emote', 'surprised'], ['pose', 'body', 'sy', 1, 300],
			['lookAhead'], ['lids', 0.5], ['wait', 900],
			['also', 'fall', 'c1', 96, 600, 'in'], ['also', 'propFade', 'c1', 0, 600], ['shake'],
			['relax'], ['look', 76, 66], ['emote', 'annoyed'], ['wait', 500],
			/* well clear of it now */
			['relax'], ['walkTo', 12], ['face', 1],
			['propOn', 'c2', 'snowCap', 0.5, -0.09, 16, 9, 60 / 26, 'hidden'],
			['look', 76, 66], ['wait', 500], ['lookAhead'], ['emote', 'happy'], ['wait', 600],
			/* ...and */
			['also', 'propFade', 'c2', 1, 150], ['propToCat', 'c2', 0.5, 0.075, 420, 'in'],
			['also', 'propScale', 'c2', 1.25, 0.8, 150],
			['emote', 'surprised'], ['relax'], ['lids', 0.6], ['wait', 900],
			['also', 'fall', 'c2', 96, 600, 'in'], ['also', 'propFade', 'c2', 0, 600], ['shake'],
			['relax'],
			['propOut', 'fir']
		]
	});

	/* Evening snow, lit from above. She only watches. */
	add('snow_lamp', {
		label: 'Snow in the lamplight',
		dur: 21000,
		energy: 'low',
		weight: 0.8,
		when: { precip: 'sn', night: true },
		beats: [
			['also', 'snowfall', 7],
			['also', 'snowfall', 3, 0, 'near'],
			['prop', 'lamp', 'streetLamp', 52, 63.4, 26, 3, 80 / 200],
			['prop', 'gr', 'snowGround', 0, 93.6, 100, 2, 200 / 24],
			['prop', 'fl', 'flakeBig', 49, 63.5, 6.5, 9, 1, 'hidden'],
			['walkTo', 30], ['look', 65, 65], ['wait', 700], ['sit'],
			['look', 40, 66], ['wait', 1100],
			['look', 60, 78], ['wait', 1100],
			['look', 34, 88], ['wait', 900],
			['lookAhead'], ['slowBlink'],
			/* one of them picks her */
			['also', 'propFade', 'fl', 1, 300], ['propToCat', 'fl', 0.5, 0.35, 2400, 'lin'],
			['crossEyes', 1], ['wait', 900],
			['propFade', 'fl', 0, 700], ['crossEyes', 0],
			['emote', 'happy'], ['purr'], ['relax'], ['wait', 600],
			['propOut', 'gr'], ['propOut', 'lamp']
		]
	});

	/* Down, and a good roll in it. */
	add('snow_bath', {
		tags: ['play'],
		label: 'A roll in the powder',
		dur: 14500,
		energy: 'high',
		weight: 0.5,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			GROUND,
			['walkTo', 28], ['look', 50, 98], ['sniff'], ['jump', 10],
			['sprawl'], ['wriggle', 3], ['wait', 200], ['wriggle', 2],
			['propOn', 'cap', 'snowCap', 0.5, 0.085, 16, 9, 60 / 26, 'hidden'],
			['also', 'propFade', 'cap', 1, 500], ['getUp'],
			['lookAhead'], ['emote', 'happy'], ['wait', 800], ['relax'],
			['also', 'fall', 'cap', 96, 600, 'in'], ['also', 'propFade', 'cap', 0, 600], ['shake'],
			['sneeze'], ['lookAhead'],
			['propOut', 'gr']
		]
	});

	/* A snowball, licked like an ice cream. It goes about as well as that does. */
	add('snow_cone', {
		label: 'Tasting the snow - brain freeze',
		dur: 22500,
		energy: 'mid',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			['prop', 'ball', 'snowball', 60, 93, 8, 9, 1],
			['walkTo', 26], ['look', 64, 96], ['sniff'],
			['lick', 'ball', 4],
			['emote', 'happy'], ['relax'],
			['lick', 'ball', 2],
			/* and there it is */
			['tint', 'cold', 0.7, 500], ['emote', 'surprised'],
			['shiver', 2], ['shake'],
			['tint', 'cold', 0, 1500], ['relax'],
			['look', 64, 96], ['emote', 'annoyed'], ['wait', 400],
			['nudge', 'ball'],
			['relax'], ['lookAhead'], ['slowBlink']
		]
	});

	/* Something under the snow. She listens, pounces - and it is a fish. */
	add('snow_fish', {
		tags: ['play'],
		label: 'Something under the snow',
		dur: 17500,
		energy: 'high',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			['prop', 'dr', 'drift', 24, 89, 54, 9, 200 / 60, 'hidden'],
			['walkTo', 1], ['propFade', 'dr', 1, 500], ['earTwitch'],
			['look', 52, 94], ['pose', 'earL', 'rot', -12, 200], ['pose', 'earR', 'rot', -12, 200], ['wait', 500],
			['stalk'], ['also', 'tailSwish', 4], ['wait', 900],
			['leap', 28, 40],
			['also', 'wiggle', 'dr', 2, 3, 120], ['sink', 13, 250],
			['propOn', 'fish', 'fish', 0.5, 0.335, 14, 9, 60 / 34, 'hidden'],
			['propOn', 'cap', 'snowCap', 0.5, 0.085, 16, 9, 60 / 26, 'hidden'],
			['wriggle', 2],
			/* up she comes, with it */
			['also', 'propFade', 'fish', 1, 300], ['also', 'propFade', 'cap', 1, 300],
			['sink', 0, 400],
			['lookAhead'], ['emote', 'happy'], ['wait', 1000],
			['also', 'fall', 'cap', 96, 600, 'in'], ['also', 'propFade', 'cap', 0, 600],
			['also', 'wiggle', 'fish', 8, 6, 80], ['shake'],
			['also', 'propFade', 'fish', 0, 1500], ['eat', 5],
			['emote', 'happy'], ['wait', 500], ['relax'],
			['propOut', 'dr']
		]
	});

	/* A tit comes hopping over the snow, and keeps coming. */
	add('tit_visit', {
		label: 'A tit lands on her head',
		dur: 21500,
		energy: 'low',
		weight: 0.7,
		when: { precip: 'sn', night: false },
		beats: [
			['also', 'snowfall', 5],
			GROUND,
			['prop', 'tit', 'tit', 104, 92.4, 8, 9, 52 / 46],
			['also', 'propScale', 'tit', -1, 1, 1],
			['walkTo', 20], ['sit'], ['lookAhead'], ['wait', 300],
			['hopProp', 'tit', 86, 4, 240],
			['look', 88, 95], ['pose', 'earL', 'rot', -12, 200], ['pose', 'earR', 'rot', -12, 200], ['wait', 400],
			['wiggle', 'tit', 14, 3, 140],
			['hopProp', 'tit', 72, 3, 240],
			/* she does not move a whisker */
			['also', 'tailSwish', 3], ['look', 74, 95], ['wait', 700],
			['wiggle', 'tit', 14, 3, 140],
			/* and up it goes */
			['lookAhead'],
			['propToCat', 'tit', 0.5, 0.115, 700, 'out'],
			['pose', 'pupilL', 'y', -2.4, 300], ['pose', 'pupilR', 'y', -2.4, 300],
			['emote', 'surprised'], ['wait', 700],
			['wiggle', 'tit', 12, 4, 140],
			['pose', 'earL', 'rot', -24, 120], ['wait', 200], ['pose', 'earL', 'rot', -14, 200],
			['wait', 800],
			['also', 'propScale', 'tit', 1, 1, 100], ['propTo', 'tit', 108, 65, 900, 'in'],
			['pose', 'pupilL', 'y', 0, 300], ['pose', 'pupilR', 'y', 0, 300],
			['look', 96, 68], ['wait', 500],
			['relax'], ['breath', 1], ['slowBlink'],
			['emote', 'happy'], ['wait', 500], ['relax'],
			['propOut', 'tit'], ['propOut', 'gr']
		]
	});

	/* Into the wind, back with the wind, and finally her back to the wind. */
	add('wind_snow', {
		label: 'Snow on the wind',
		dur: 17000,
		energy: 'mid',
		weight: 0.8,
		when: { precip: 'sn', windMin: 5 },
		beats: [
			['also', 'snowfall', 4],
			['walkTo', 8], ['outfit', 'snow'], ['face', 1],
			['also', 'gust', 5, 1300],
			['pose', 'spine', 'rot', 5, 300], ['pose', 'earL', 'rot', 26, 250], ['pose', 'earR', 'rot', 26, 250],
			['lids', 0.6],
			['walkTo', 40],
			['also', 'gust', 6, 1100], ['slide', 22, 900, 'keep'],
			['pose', 'earL', 'rot', 26, 250], ['pose', 'earR', 'rot', 26, 250], ['wait', 300],
			['walkTo', 36],
			['also', 'gust', 6, 1100], ['slide', 16, 800, 'keep'],
			['emote', 'annoyed'], ['wait', 300],
			/* enough: back to it, and wait */
			['face', -1], ['sit'],
			['pose', 'earL', 'rot', 30, 300], ['pose', 'earR', 'rot', 30, 300], ['eyesShut'],
			['also', 'gust', 5, 1300], ['wait', 1500],
			['propOn', 'cap', 'snowCap', 0.5, 0.155, 15, 9, 60 / 26],
			['also', 'gust', 4, 1300], ['wait', 1600],
			['eyesOpen'], ['wait', 300],
			['also', 'fall', 'cap', 96, 600, 'in'], ['also', 'propFade', 'cap', 0, 600], ['shake'],
			['relax'], ['face', 1], ['lookAhead']
		]
	});

	/* Snow! */
	add('snow_zoomies', {
		tags: ['play'],
		label: 'Snow zoomies',
		dur: 13000,
		energy: 'high',
		weight: 0.5,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 6], ['also', 'snowfall', 3, 0, 'near'],
			GROUND,
			['walkTo', 26], ['look', 50, 62], ['emote', 'happy'], ['jump', 14],
			['slide', 54, 800], ['slide', 2, 900], ['slide', 30, 700],
			['twirl', 2], ['jump', 20],
			['sit'], ['also', 'pant'], ['wait', 600], ['breath', 1],
			['relax'],
			['propOut', 'gr']
		]
	});

	/* She treads about for a while. Then she steps back, and it was a heart. */
	add('print_heart', {
		label: 'A heart, trodden in the snow',
		dur: 22000,
		energy: 'low',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 5],
			FIELD,
			['prop', 'ph', 'printHeart', 59, 85, 23, 4, 100 / 86, 'hidden'],
			['prop', 'h', 'heart', 24, 67, 6, 9, 30 / 28, 'hidden'],
			['walkTo', 44], ['look', 66, 96], ['wait', 300],
			['walkTo', 52], ['pawTap', 'R', 2],
			['walkTo', 42], ['pawTap', 'L', 2],
			['walkTo', 48], ['knead'],
			/* and away, to see it */
			['also', 'propFade', 'ph', 1, 900], ['walkTo', 4], ['face', 1],
			['look', 70, 92], ['wait', 900],
			['lookAhead'], ['slowBlink'],
			['also', 'propFade', 'h', 0.95, 300], ['propTo', 'h', 27, 63.6, 1500, 'out'],
			['also', 'propOut', 'h'],
			['emote', 'happy'], ['purr'], ['relax'],
			['propOut', 'ph'], ['propOut', 'gr']
		]
	});

	/* Cocoa out in the snow. Two flakes land in it. She drinks it anyway. */
	add('cocoa_snow', {
		label: 'Snow in the cocoa',
		dur: 22500,
		energy: 'low',
		weight: 0.6,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 6],
			['prop', 'cup', 'cocoa', 58, 92.6, 10, 9, 1],
			['prop', 'f1', 'flakeBig', 60, 63.5, 5.5, 9, 1, 'hidden'],
			['prop', 'f2', 'flakeBig', 61.5, 63.5, 6.5, 9, 1, 'hidden'],
			['walkTo', 26], ['outfit', 'snow'], ['look', 63, 95],
			['sip', 'cup'], ['emote', 'happy'], ['wait', 400], ['relax'],
			/* plop */
			['look', 62, 64],
			['also', 'propFade', 'f1', 1, 200], ['fall', 'f1', 90.5, 1500, 'lin'], ['also', 'propFade', 'f1', 0, 250],
			['also', 'propFade', 'f2', 1, 200], ['fall', 'f2', 90.5, 1300, 'lin'], ['also', 'propFade', 'f2', 0, 250],
			['look', 63, 95], ['emote', 'surprised'], ['relax'],
			['sip', 'cup'],
			['tint', 'cold', 0.5, 400], ['shiver', 1], ['tint', 'cold', 0, 1200],
			['look', 63, 95], ['emote', 'annoyed'], ['wait', 600], ['relax'],
			/* and a long look at the sky that did it */
			['look', 50, 62], ['wait', 500], ['lookAhead'], ['lids', 0.5], ['wait', 900], ['relax'],
			['propOut', 'cup']
		]
	});

	/* In from the snow: shake, hat off, scarf off, and something hot. */
	add('come_inside', {
		label: 'Coming in from the snow',
		dur: 21500,
		energy: 'low',
		weight: 0.7,
		when: { precip: 'sn' },
		beats: [
			['also', 'snowfall', 4, 5200],
			['prop', 'table', 'teaTable', 18, 89, 62, 9, 200 / 90, 'hidden'],
			['prop', 'cup', 'cocoa', 57, 88.4, 10, 9, 1, 'hidden'],
			['walkTo', 1], ['outfit', 'snow'], ['walkTo', 28], ['lookAhead'],
			['propOn', 'cap', 'snowCap', 0.5, -0.005, 15, 9, 60 / 26],
			['propOn', 'hat', 'warmHat', 0.5, 0.084, 17.6, 9, 80 / 60, 'hidden'],
			['propOn', 'sc', 'tossScarf', 0.5, 0.42, 16, 9, 2, 'hidden'],
			['shiver', 1],
			['also', 'fall', 'cap', 96, 600, 'in'], ['also', 'propFade', 'cap', 0, 600], ['shake'],
			/* off with the hat, off with the scarf */
			['also', 'unwear', 'head'], ['also', 'propFade', 'hat', 1, 150],
			['also', 'spin', 'hat', -120, 600], ['propTo', 'hat', 1, 91, 600, 'in'],
			['also', 'unwear', 'neck'], ['also', 'propFade', 'sc', 1, 150],
			['also', 'spin', 'sc', 50, 600], ['propTo', 'sc', 8, 95, 600, 'in'],
			['stretch'],
			/* and there is cocoa */
			['also', 'propFade', 'table', 1, 500], ['propFade', 'cup', 1, 500],
			['look', 62, 91], ['emote', 'happy'], ['relax'],
			['sit'], ['sip', 'cup'], ['purr'], ['relax'],
			['propOut', 'cup'], ['propOut', 'table'], ['propOut', 'sc'], ['propOut', 'hat']
		]
	});

	/* ================================================================== *
	 *  SLEET AND ICE                                                     *
	 * ================================================================== */

	/* She walks straight into it. */
	add('slush_paw', {
		label: 'Slush - the wet paw',
		dur: 17000,
		energy: 'mid',
		weight: 0.8,
		when: { precip: 'ra_sn' },
		beats: [
			['prop', 'sl', 'slush', 34, 92.4, 32, 9, 3],
			['walkTo', 1], ['outfit', 'rain'], ['walkTo', 26],
			['look', 50, 98], ['emote', 'surprised'], ['wait', 300],
			/* the right one: the left is holding the umbrella */
			['shakePaw', 'R'], ['emote', 'annoyed'], ['shakePaw', 'R'],
			['leap', -24, 20],
			['face', 1], ['look', 50, 96], ['wait', 500],
			['groom'], ['relax'],
			['look', 50, 96], ['pose', 'tail', 'rot', -28, 250], ['wait', 600],
			['relax'], ['propOut', 'sl']
		]
	});

	/* A drop. A flake. A drop. Then both at once. */
	add('sleet_undecided', {
		label: 'Sleet - rain or snow, make up your mind',
		dur: 16000,
		energy: 'low',
		weight: 0.8,
		when: { precip: 'ra_sn' },
		beats: [
			['prop', 'd1', 'drop', 49, 63.4, 4.4, 9, 20 / 34, 'hidden'],
			['prop', 'f1', 'flakeBig', 55, 63.4, 6.5, 9, 1, 'hidden'],
			['prop', 'd2', 'drop', 52, 63.4, 4.4, 9, 20 / 34, 'hidden'],
			['prop', 'f2', 'flakeBig', 38, 63.4, 6.5, 9, 1, 'hidden'],
			['prop', 'd3', 'drop', 58, 63.4, 4.4, 9, 20 / 34, 'hidden'],
			['walkTo', 28], ['outfit', 'rain'], ['look', 50, 62], ['wait', 300],
			/* rain */
			['also', 'propFade', 'd1', 1, 120], ['propToCat', 'd1', 0.5, 0.2, 700, 'in'],
			['also', 'propFade', 'd1', 0, 150], ['emote', 'annoyed'], ['wait', 300],
			/* no - snow */
			['also', 'propFade', 'f1', 1, 200], ['also', 'sway', 'f1', 4, 2, 1500],
			['fall', 'f1', 75, 1500, 'lin'], ['also', 'propFade', 'f1', 0, 300],
			['relax'], ['emote', 'happy'], ['wait', 300],
			/* no - rain */
			['also', 'propFade', 'd2', 1, 120], ['propToCat', 'd2', 0.53, 0.2, 600, 'in'],
			['also', 'propFade', 'd2', 0, 150], ['emote', 'annoyed'], ['wait', 300],
			/* both */
			['also', 'propFade', 'f2', 1, 200], ['also', 'fall', 'f2', 78, 1400, 'lin'],
			['also', 'propFade', 'd3', 1, 120], ['propToCat', 'd3', 0.62, 0.2, 650, 'in'],
			['also', 'propFade', 'd3', 0, 150], ['wait', 700], ['propFade', 'f2', 0, 300],
			['relax'], ['lookAhead'], ['lids', 0.55], ['wait', 1000],
			/* a sigh */
			['pose', 'body', 'sy', 0.93, 500], ['wait', 600], ['pose', 'body', 'sy', 1, 600], ['wait', 500],
			['relax'], ['shake'], ['lookAhead']
		]
	});

	/* Indoors, and under a towel, and out again twice the size. */
	add('towel_dry', {
		label: 'Towelled dry - and fluffed',
		dur: 16500,
		energy: 'mid',
		weight: 0.8,
		when: { precip: 'ra_sn' },
		beats: [
			['walkTo', 28], ['outfit', 'rain'], ['shake'], ['emote', 'annoyed'], ['wait', 300],
			['undress'], ['relax'],
			['propOn', 'tw', 'bathTowel', 0.5, 0.13, 32, 9, 84 / 54],
			['also', 'wiggle', 'tw', 10, 8, 150], ['wriggle', 3],
			['wait', 200],
			['also', 'wiggle', 'tw', 10, 6, 150], ['wriggle', 2],
			['also', 'spin', 'tw', -30, 600], ['propTo', 'tw', 2, 89, 600, 'in'],
			/* every hair on end */
			['pose', 'body', 'sx', 1.12, 250], ['pose', 'tail', 'sx', 1.5, 250], ['pose', 'tail', 'sy', 1.5, 250],
			['emote', 'surprised'], ['wait', 600],
			['lookAhead'], ['lids', 0.5], ['wait', 800],
			['pose', 'body', 'sx', 1, 1800], ['pose', 'tail', 'sx', 1, 1800], ['pose', 'tail', 'sy', 1, 1800],
			['groom'],
			['relax'], ['emote', 'happy'], ['wait', 500], ['relax'],
			['propOut', 'tw']
		]
	});

	/* The puddle froze overnight. She finds out by walking onto it. */
	add('ice_skid', {
		tags: ['play'],
		label: 'The frozen puddle',
		dur: 21500,
		energy: 'high',
		weight: 0.7,
		when: { precip: DRY, tempMax: 1 },
		beats: [
			['prop', 'ice', 'icePatch', 18, 92, 70, 4, 140 / 30],
			['walkTo', 1], ['wait', 200], ['walkTo', 8],
			['slide', 44, 1100],
			['emote', 'surprised'], ['relax'],
			['look', 50, 98], ['pawTap', 'R', 2],
			/* one careful step - and round she goes */
			['twirl', 1], ['sit'],
			['emote', 'annoyed'], ['relax'],
			/* carried off the far side, still sitting */
			['slide', 56, 1700],
			['stand'], ['face', -1], ['look', 40, 98], ['wait', 600],
			/* and now on purpose */
			['stalk'], ['also', 'pose', 'earL', 'rot', 18, 300], ['also', 'pose', 'earR', 'rot', 18, 300],
			['slide', 1, 1300],
			['jump', 14], ['emote', 'happy'], ['relax'], ['face', 1],
			['propOut', 'ice']
		]
	});

	/* Drip. Drip. She works out what to do about the drip. Then the icicle goes. */
	add('icicle_drip', {
		label: 'Under the icicles',
		dur: 21000,
		energy: 'mid',
		weight: 0.7,
		when: { tempMin: -4, tempMax: 3, night: false },
		beats: [
			['prop', 'ev', 'eave', 0, 63, 100, 3, 200 / 36],
			['prop', 'd1', 'drop', 65.6, 71.5, 2.8, 9, 20 / 34, 'hidden'],
			['prop', 'd2', 'drop', 65.6, 71.5, 2.8, 9, 20 / 34, 'hidden'],
			['prop', 'd3', 'drop', 65.6, 71.5, 2.8, 9, 20 / 34, 'hidden'],
			['prop', 'ic', 'icicle', 65.5, 67.6, 3, 9, 16 / 50, 'hidden'],
			['walkTo', 44], ['look', 67, 66], ['wait', 400], ['sit'],
			/* on the head */
			['also', 'propFade', 'd1', 1, 100], ['fall', 'd1', 78, 500, 'in'], ['also', 'propFade', 'd1', 0, 120],
			['blink'], ['emote', 'surprised'],
			['look', 67, 66], ['pose', 'head', 'y', -4, 300], ['wait', 600],
			/* on the nose */
			['also', 'propFade', 'd2', 1, 100], ['fall', 'd2', 79.5, 500, 'in'], ['also', 'propFade', 'd2', 0, 120],
			['shake'], ['relax'],
			/* so: mouth open */
			['look', 67, 66], ['pose', 'head', 'y', -4, 300], ['mouth', 'wide'], ['wait', 500],
			['also', 'propFade', 'd3', 1, 100], ['fall', 'd3', 80.5, 550, 'in'], ['also', 'propFade', 'd3', 0, 120],
			['mouth', 'closed'], ['emote', 'happy'], ['wait', 400], ['relax'],
			/* and then the whole thing lets go */
			['propFade', 'ic', 1, 200], ['also', 'wiggle', 'ic', 6, 4, 110],
			['look', 67, 68], ['emote', 'surprised'], ['stand'],
			['also', 'leap', -24, 22], ['wait', 200], ['fall', 'ic', 93.6, 450, 'in'],
			['also', 'propScale', 'ic', 1.8, 0.3, 200], ['propFade', 'ic', 0, 500],
			['face', 1], ['look', 67, 96],
			['pose', 'tail', 'sx', 1.4, 200], ['pose', 'tail', 'sy', 1.4, 200], ['wait', 800],
			['relax'], ['pose', 'tail', 'sx', 1, 600], ['pose', 'tail', 'sy', 1, 600],
			['groom'], ['lookAhead'],
			['propOut', 'ev']
		]
	});

	/* ================================================================== *
	 *  COSY - it is cold out, whatever else it is doing                  *
	 * ================================================================== */

	/* Cocoa: blown on, drunk, and worn on the nose for a moment. */
	add('cocoa_paws', {
		label: 'Cocoa, to warm the paws',
		dur: 20500,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'table', 'teaTable', 18, 89, 62, 9, 200 / 90],
			['prop', 'cup', 'cocoa', 44, 88.2, 11, 9, 1],
			['walkTo', 28], ['sit'], ['lookAhead'],
			['propOn', 'mm', 'cocoaStache', 0.5, 0.385, 9, 9, 40 / 16, 'hidden'],
			['look', 50, 92], ['sniff'],
			['sip', 'cup'],
			/* and she comes up wearing some of it */
			['also', 'propFade', 'mm', 1, 200], ['lookAhead'],
			['emote', 'happy'], ['crossEyes', 1], ['wait', 900],
			['crossEyes', 0], ['also', 'propFade', 'mm', 0, 700], ['groom'],
			/* both paws round the mug */
			['relax'],
			['pose', 'pawFL', 'rot', -42, 500], ['pose', 'pawFR', 'rot', -42, 500],
			['lids', 0.7], ['wait', 1500],
			['pawsDown'], ['purr'], ['relax'],
			['propOut', 'cup'], ['propOut', 'table']
		]
	});

	/* Knead it, turn round, lie down, pull it up. Two eyes over the top. */
	add('blanket_burrow', {
		label: 'The blanket burrow',
		dur: 20500,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'z1', 'zzz', 62, 76, 6, 9, 1, 'hidden'],
			['prop', 'z2', 'zzz', 63, 76, 5, 9, 1, 'hidden'],
			['walkTo', 28],
			['propOn', 'bl', 'blanket', 0.5, 1.06, 56, 9, 160 / 100],
			['look', 50, 98], ['knead'], ['knead'], ['circle'], ['lieDown'],
			['propToCat', 'bl', 0.5, 0.86, 900, 'io'],
			/* just her eyes, checking the room */
			['eyesOpen'],
			['pose', 'pupilL', 'x', -2.4, 300], ['pose', 'pupilR', 'x', -2.4, 300], ['wait', 700],
			['pose', 'pupilL', 'x', 2.4, 400], ['pose', 'pupilR', 'x', 2.4, 400], ['wait', 700],
			['pose', 'pupilL', 'x', 0, 300], ['pose', 'pupilR', 'x', 0, 300],
			['slowBlink'], ['eyesShut'],
			['also', 'propFade', 'z1', 0.9, 400], ['propTo', 'z1', 68, 68, 2200],
			['also', 'propOut', 'z1'], ['wait', 300],
			['also', 'propFade', 'z2', 0.9, 400], ['propTo', 'z2', 70, 67, 2200],
			['also', 'propOut', 'z2'], ['wait', 700],
			['also', 'propToCat', 'bl', 0.5, 1.06, 800], ['getUp'], ['stretch'],
			['propOut', 'bl']
		]
	});

	/* The warmest place in the house, until it is too warm. */
	add('radiator_nap', {
		label: 'The radiator spot',
		dur: 24000,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'rad', 'radiator', 40, 74.6, 56, 4, 130 / 92],
			['prop', 'h1', 'heat', 42, 67.5, 6, 9, 40 / 50, 'hidden'],
			['prop', 'h2', 'heat', 90, 67.5, 6, 9, 40 / 50, 'hidden'],
			['prop', 'z1', 'zzz', 80, 78, 6, 9, 1, 'hidden'],
			['walkTo', 10], ['look', 66, 84], ['wait', 300],
			['walkTo', 46], ['rub', 1, 2],
			['also', 'propFade', 'h1', 0.9, 800], ['also', 'propFade', 'h2', 0.9, 800],
			['also', 'wiggle', 'h1', 7, 34, 400], ['also', 'wiggle', 'h2', -7, 34, 400],
			['circle'], ['lieDown'], ['wait', 900],
			['also', 'propFade', 'z1', 0.9, 400], ['propTo', 'z1', 86, 70, 2200],
			['also', 'propOut', 'z1'], ['wait', 400],
			['earTwitch'],
			/* a little too warm now */
			['tint', 'hot', 0.5, 2000], ['wait', 1800],
			['eyesOpen'], ['pant'],
			['getUp'], ['walkTo', 30], ['face', 1], ['sit'],
			['tint', 'hot', 0, 1600], ['emote', 'happy'], ['wait', 500], ['relax'],
			['propOut', 'h1'], ['propOut', 'h2'], ['propOut', 'rad']
		]
	});

	/* Hot. Still hot. Less hot. Hers. */
	add('hot_bottle', {
		label: 'The hot-water bottle',
		dur: 21500,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'hb', 'hotBottle', 58, 88.6, 11, 9, 52 / 74],
			['walkTo', 18], ['look', 63, 93], ['sniff'],
			['pawTap', 'R', 1], ['shakePaw', 'R'], ['emote', 'surprised'], ['relax'],
			['wait', 400], ['look', 63, 93], ['pawTap', 'R', 2], ['tilt'],
			['walkTo', 36],
			['circle'], ['curl'],
			['also', 'propToCat', 'hb', 0.5, 0.78, 600], ['tint', 'hot', 0.25, 2500],
			['wait', 1500], ['pose', 'tail', 'rot', -42, 600], ['wait', 1800],
			['tint', 'hot', 0, 1200], ['wait', 600],
			['propOut', 'hb']
		]
	});

	/* She knits. It takes a while. It is a scarf, and she puts it on. */
	add('knitting', {
		label: 'Knitting herself a scarf',
		dur: 21500,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'yb', 'yarn', 70, 92, 10, 9, 1],
			['walkTo', 26], ['unwear', 'neck'], ['sit'], ['lookAhead'],
			['propOn', 'kn', 'knit', 0.5, 0.64, 23, 9, 72 / 64],
			['also', 'spin', 'yb', 300, 6600], ['also', 'propScale', 'yb', 0.8, 0.8, 6600],
			['type', 2],
			['look', 74, 95], ['wait', 300], ['lookAhead'],
			['also', 'spin', 'yb', 520, 3400], ['also', 'propScale', 'yb', 0.62, 0.62, 3400],
			['type', 1],
			['pawsDown'], ['propFade', 'kn', 0, 400], ['wear', 'wScarf'],
			/* this side, that side */
			['emote', 'happy'],
			['pose', 'head', 'rot', -9, 400], ['wait', 700],
			['pose', 'head', 'rot', 9, 500], ['wait', 700],
			['relax'], ['slowBlink'],
			['propOut', 'yb']
		]
	});

	/* The ball goes round her once too often. */
	add('yarn_tangle', {
		tags: ['play'],
		label: 'Tangled in the yarn',
		dur: 22000,
		energy: 'mid',
		weight: 0.5,
		when: { tempMax: 7 },
		beats: [
			['prop', 'yb', 'yarn', 62, 91.4, 11, 9, 1],
			['walkTo', 22], ['look', 67, 95],
			['also', 'bat', 'R'], ['wait', 240],
			['also', 'spin', 'yb', 400, 900], ['propTo', 'yb', 84, 91.4, 900, 'out'],
			['look', 88, 95], ['walkTo', 34],
			['also', 'bat', 'R'], ['wait', 240],
			['also', 'spin', 'yb', 60, 1100], ['propTo', 'yb', 30, 91.4, 1100, 'io'],
			['look', 34, 95], ['also', 'bat', 'L'], ['wait', 240],
			['also', 'spin', 'yb', 420, 1100], ['propTo', 'yb', 74, 91.4, 1100, 'io'],
			['twirl', 1],
			/* and that is her, wound up in it */
			['propOn', 'tg', 'yarnTangle', 0.5, 0.62, 42, 9, 120 / 80],
			['also', 'propScale', 'yb', 0.55, 0.55, 500],
			['look', 50, 90], ['emote', 'surprised'],
			['also', 'wiggle', 'tg', 5, 6, 190], ['wriggle', 3],
			['relax'], ['lookAhead'], ['mouth', 'wide'], ['wait', 700], ['mouth', 'closed'],
			['emote', 'sad'], ['wait', 700], ['relax'],
			/* this is how she lives now */
			['loaf'], ['lids', 0.6], ['wait', 1300],
			['also', 'propFade', 'tg', 0, 700], ['shake'],
			['stand'], ['relax'],
			['propOut', 'yb']
		]
	});

	/* The front of her, then the back of her. */
	add('stove_warm', {
		label: 'Warming up at the stove',
		dur: 20000,
		energy: 'low',
		weight: 0.6,
		when: { tempMax: 7 },
		beats: [
			['prop', 'st', 'stove', 66, 77.4, 30, 9, 100 / 124, 'hidden'],
			['prop', 'fl', 'flame', 78.5, 88.4, 5, 9, 24 / 34, 'hidden'],
			['also', 'wiggle', 'fl', 9, 110, 170],
			['walkTo', 1],
			['also', 'propFade', 'st', 1, 500], ['also', 'propFade', 'fl', 1, 500],
			['shiver', 1], ['look', 80, 90], ['wait', 300],
			['walkTo', 24],
			['pose', 'pawFL', 'rot', -44, 500], ['pose', 'pawFR', 'rot', -44, 500],
			['lids', 0.5], ['wait', 1500],
			['pawsDown'], ['knead'],
			/* and now the other side */
			['relax'], ['face', -1], ['pose', 'tail', 'rot', 24, 500],
			['emote', 'happy'], ['wait', 1300],
			['relax'], ['face', 1], ['sit'], ['yawn'],
			['emote', 'sleepy'], ['purr'], ['relax'],
			['propOut', 'fl'], ['propOut', 'st']
		]
	});

	/* A roll on the wool blanket, a paw towards the lamp, and a spark. */
	add('static_spark', {
		label: 'Wool blanket - static',
		dur: 21000,
		energy: 'mid',
		weight: 0.5,
		when: { tempMax: 7 },
		beats: [
			['prop', 'bl', 'blanket', 10, 85, 46, 4, 160 / 100],
			['prop', 'lamp', 'deskLamp', 82, 85.6, 16, 9, 70 / 96, 'hidden'],
			['prop', 'sp', 'spark', 77, 84.5, 6, 9, 1, 'hidden'],
			['walkTo', 12], ['also', 'propFade', 'lamp', 1, 500],
			['look', 34, 94], ['knead'],
			['sprawl'], ['wriggle', 3], ['purr'],
			['getUp'],
			/* fur on end, and she has not noticed */
			['pose', 'body', 'sx', 1.1, 300], ['pose', 'tail', 'sx', 1.45, 300], ['pose', 'tail', 'sy', 1.45, 300],
			['pose', 'earL', 'rot', -16, 300], ['pose', 'earR', 'rot', -16, 300],
			['lookAhead'], ['wait', 700],
			['walkTo', 40],
			['look', 88, 90], ['pose', 'head', 'x', 5, 300], ['paw', 'R', -50, 350],
			/* zap */
			['also', 'propFade', 'sp', 1, 60], ['also', 'propScale', 'sp', 1.8, 1.8, 180],
			['also', 'jump', 14], ['also', 'startle'], ['wait', 260],
			['propFade', 'sp', 0, 200],
			['pose', 'body', 'sx', 1, 500], ['pose', 'earL', 'rot', 0, 400], ['pose', 'earR', 'rot', 0, 400],
			['pawsDown'], ['wait', 700], ['relax'],
			['face', -1], ['look', 30, 94], ['emote', 'annoyed'], ['wait', 800],
			['relax'], ['face', 1], ['shake'],
			['propOut', 'lamp'], ['propOut', 'bl']
		]
	});

	/* A sock is missing. It is in her bed. */
	add('sock_thief', {
		tags: ['play'],
		label: 'Steals a wool sock for her bed',
		dur: 20000,
		energy: 'mid',
		weight: 0.5,
		when: { tempMax: 7 },
		beats: [
			['prop', 'bb', 'bedBack', 0, 84, 51, 4, 200 / 80],
			['prop', 'sk', 'sock', 84, 93, 9, 8, 54 / 52],
			['prop', 'bf', 'bedFront', 0, 93, 51, 9, 200 / 60],
			['walkTo', 30], ['look', 88, 96],
			['pose', 'earL', 'rot', -12, 200], ['pose', 'earR', 'rot', -12, 200], ['wait', 400],
			['stalk'], ['also', 'tailSwish', 3], ['wait', 700],
			['leap', 20, 22],
			['look', 88, 96], ['propToCat', 'sk', 0.5, 0.33, 500, 'out'],
			['lookAhead'], ['wait', 400],
			/* carried home in her mouth, at the pace she walks */
			['also', 'propTo', 'sk', 21, 76.5, 2520, 'io'], ['walkTo', 3.5],
			['face', 1], ['propTo', 'sk', 30, 90.5, 500, 'in'],
			['look', 34, 94], ['emote', 'happy'], ['relax'],
			['circle'], ['curl'], ['wait', 1600],
			['propOut', 'sk'], ['propOut', 'bf'], ['propOut', 'bb']
		]
	});

	/* An evening with a candle. She yawns at it, and nearly puts it out. */
	add('candle_evening', {
		label: 'An evening by the candle',
		dur: 20500,
		energy: 'low',
		weight: 0.8,
		when: { tempMax: 7, night: true },
		beats: [
			['prop', 'glow', 'sunpatch', 46, 79, 48, 3, 160 / 90],
			['prop', 'cd', 'candle', 66, 90.4, 8, 9, 44 / 70],
			['prop', 'fl', 'flame', 68.2, 88.2, 3.6, 9, 24 / 34],
			['also', 'wiggle', 'fl', 7, 60, 180],
			['walkTo', 14], ['look', 70, 89], ['wait', 400],
			['walkTo', 22], ['sit'],
			['look', 70, 89], ['slowBlink'], ['wait', 600],
			['pose', 'head', 'x', 4, 600], ['sniff'], ['pose', 'head', 'x', 0, 400],
			/* the yawn */
			['also', 'yawn'], ['wait', 500],
			['also', 'propFade', 'fl', 0.3, 200], ['propScale', 'fl', 1.7, 0.4, 250],
			['wait', 600],
			['also', 'propFade', 'fl', 1, 700], ['propScale', 'fl', 1, 1, 700],
			['emote', 'surprised'], ['relax'],
			['pose', 'earL', 'rot', 24, 300], ['pose', 'earR', 'rot', 24, 300], ['wait', 800],
			/* and she settles, a bit further off */
			['relax'], ['loaf'], ['lids', 0.6], ['pose', 'tail', 'rot', -30, 600],
			['wait', 1600], ['slowBlink'], ['relax'],
			['propOut', 'fl'], ['propOut', 'cd'], ['propOut', 'glow']
		]
	});

})();
