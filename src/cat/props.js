/* props.js - the things the cat interacts with during an episode.
 *
 * Each prop is a pooled <div> in #cat_props holding a small inline SVG, drawn
 * flat in the same language as the cat. Nodes are reused across episodes and
 * registered with the Rig, so the tween engine animates a rolling yarn ball
 * with exactly the call it uses for an ear twitch.
 *
 * Placement is in stage percent: put(name, xPct, yPct, widthPct).             */

var Props = (function () {
	var box = null;              /* foreground: in front of the forecast */
	var backBox = null;          /* scenery: behind the forecast text     */
	var pool = [];
	var backPool = [];
	var live = {};
	var seq = 0;

	var ART = {

		bowl:
			'<svg viewBox="0 0 100 60">' +
			'<ellipse cx="50" cy="20" rx="34" ry="11" fill="#E8B4A0"/>' +
			'<path d="M16,20 C18,42 30,54 50,54 C70,54 82,42 84,20 Z" fill="#F2C7B4" stroke="#D79A85" stroke-width="2"/>' +
			'<ellipse cx="50" cy="20" rx="27" ry="8" fill="#8A5A3C"/>' +
			'<ellipse cx="43" cy="18" rx="7" ry="3" fill="#A97050"/>' +
			'</svg>',

		/* Seen from OUTSIDE, so the cover is what faces you.
		 *
		 * It used to be two cream pages with grey lines across them, which from
		 * the front is a newspaper, not a book: no colour and no cover anywhere.
		 * Turning it round solves both at once - the coloured cover is what we
		 * see, the pages peek along the top edge, and she is still plainly
		 * reading, because the pages face her and the cover faces us. Which is
		 * how holding a book actually looks from the other side.               */
		book:
			'<svg viewBox="0 0 120 80">' +
			/* pages, drawn first so only the top sliver shows above the covers */
			'<path d="M60,23 C45,15 25,15 10,21 L10,29 C25,23 45,23 60,31 Z" fill="#FBF6EC" stroke="#DCD2C0" stroke-width="1.5"/>' +
			'<path d="M60,23 C75,15 95,15 110,21 L110,29 C95,23 75,23 60,31 Z" fill="#FFFDF7" stroke="#DCD2C0" stroke-width="1.5"/>' +
			/* the two halves of the cover */
			'<path d="M60,27 C45,19 25,19 9,25 L9,73 C25,67 45,67 60,75 Z" fill="#C9524A" stroke="#96382F" stroke-width="2"/>' +
			'<path d="M60,27 C75,19 95,19 111,25 L111,73 C95,67 75,67 60,75 Z" fill="#DB6055" stroke="#96382F" stroke-width="2"/>' +
			/* spine */
			'<path d="M57,26 H63 V75 H57 Z" fill="#96382F"/>' +
			/* a title label, big enough to read as one at 90 px wide */
			'<rect x="72" y="38" width="31" height="19" rx="3" fill="#FBF3E2" opacity="0.95"/>' +
			'<path d="M77,45 H98 M77,51 H93" stroke="#C0705F" stroke-width="2" stroke-linecap="round"/>' +
			/* and a fish on the cover, because it is her book */
			'<path d="M25,47 C29,42 37,42 41,47 C37,52 29,52 25,47 Z" fill="#FBF3E2"/>' +
			'<path d="M23,47 L17,43 L17,51 Z" fill="#FBF3E2"/>' +
			'<circle cx="34" cy="46" r="1.4" fill="#96382F"/>' +
			'</svg>',

		window:
			'<svg viewBox="0 0 120 150">' +
			'<rect x="6" y="6" width="108" height="138" rx="5" fill="#16202E" stroke="#5E6B7C" stroke-width="5"/>' +
			'<path d="M60,10 V140 M10,75 H110" stroke="#5E6B7C" stroke-width="5"/>' +
			'<path d="M18,18 H52 V68 H18 Z" fill="#243449" opacity="0.85"/>' +
			'<path d="M68,18 H102 V68 H68 Z" fill="#243449" opacity="0.85"/>' +
			'<path d="M18,82 H52 V132 H18 Z" fill="#243449" opacity="0.85"/>' +
			'<path d="M68,82 H102 V132 H68 Z" fill="#243449" opacity="0.85"/>' +
			'</svg>',

		drop:
			'<svg viewBox="0 0 20 34">' +
			'<path d="M10,2 C15,12 18,19 18,24 A8,8 0 0,1 2,24 C2,19 5,12 10,2 Z" fill="#7FB6E8" opacity="0.85"/>' +
			'<ellipse cx="7.5" cy="22" rx="2.4" ry="3.4" fill="#CFE6FA" opacity="0.8"/>' +
			'</svg>',

		flake:
			'<svg viewBox="0 0 30 30">' +
			'<g stroke="#EAF4FF" stroke-width="2.4" stroke-linecap="round">' +
			'<path d="M15,3 V27 M4.6,9 L25.4,21 M4.6,21 L25.4,9"/>' +
			'<path d="M15,8 L11,5 M15,8 L19,5 M15,22 L11,25 M15,22 L19,25"/>' +
			'</g></svg>',

		box:
			'<svg viewBox="0 0 130 90">' +
			'<path d="M10,30 H120 V84 H10 Z" fill="#C9975C" stroke="#A2743F" stroke-width="3"/>' +
			'<path d="M10,30 L28,12 H112 L120,30 Z" fill="#E0B276" stroke="#A2743F" stroke-width="3"/>' +
			'<path d="M42,30 V84 M88,30 V84" stroke="#A2743F" stroke-width="2" opacity="0.5"/>' +
			'</svg>',

		leaf:
			'<svg viewBox="0 0 40 30">' +
			'<path d="M4,22 C10,4 28,2 37,7 C33,22 18,29 4,22 Z" fill="#D08A3C"/>' +
			'<path d="M6,21 C16,16 27,11 36,8" stroke="#A9682A" stroke-width="1.8" fill="none"/>' +
			'</svg>',

		yarn:
			'<svg viewBox="0 0 60 60">' +
			'<circle cx="30" cy="30" r="24" fill="#E58BA8" stroke="#C86C8B" stroke-width="2"/>' +
			'<path d="M10,22 C24,16 40,20 50,32 M8,34 C22,28 40,32 52,42 M14,48 C22,34 34,24 48,18" ' +
			'stroke="#F6B8CC" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
			'<path d="M52,36 C58,44 54,52 46,54" stroke="#E58BA8" stroke-width="2.6" fill="none" stroke-linecap="round"/>' +
			'</svg>',

		moon:
			'<svg viewBox="0 0 60 60">' +
			'<circle cx="30" cy="30" r="22" fill="#FFE79A"/>' +
			'<circle cx="22" cy="24" r="4" fill="#F2D183" opacity="0.7"/>' +
			'<circle cx="36" cy="36" r="5.5" fill="#F2D183" opacity="0.6"/>' +
			'</svg>',

		sunpatch:
			'<svg viewBox="0 0 160 90">' +
			'<ellipse cx="80" cy="45" rx="76" ry="40" fill="#FFE79A" opacity="0.16"/>' +
			'<ellipse cx="80" cy="45" rx="54" ry="27" fill="#FFEFB8" opacity="0.2"/>' +
			'</svg>',

		fish:
			'<svg viewBox="0 0 60 34">' +
			'<path d="M38,17 C30,5 14,4 6,12 C2,15 2,19 6,22 C14,30 30,29 38,17 Z" fill="#8FC7E8" stroke="#6BA9CE" stroke-width="2"/>' +
			'<path d="M38,17 L54,7 L52,17 L54,27 Z" fill="#7FB6D8"/>' +
			'<circle cx="13" cy="15" r="2.4" fill="#243449"/>' +
			'</svg>',

		butterfly:
			'<svg viewBox="0 0 50 40">' +
			'<path d="M25,20 C16,4 4,6 6,16 C7,24 17,25 25,20 Z" fill="#F0A8C8" stroke="#D8809F" stroke-width="1.6"/>' +
			'<path d="M25,20 C34,4 46,6 44,16 C43,24 33,25 25,20 Z" fill="#F0A8C8" stroke="#D8809F" stroke-width="1.6"/>' +
			'<path d="M25,20 C18,30 8,32 10,26 C12,21 20,21 25,20 Z" fill="#F8C6DC" stroke="#D8809F" stroke-width="1.4"/>' +
			'<path d="M25,20 C32,30 42,32 40,26 C38,21 30,21 25,20 Z" fill="#F8C6DC" stroke="#D8809F" stroke-width="1.4"/>' +
			'<ellipse cx="25" cy="21" rx="2.2" ry="8" fill="#4A3B33"/>' +
			'</svg>',


		zzz:
			'<svg viewBox="0 0 40 40">' +
			'<text x="4" y="30" font-family="Verdana,Arial,sans-serif" font-size="30" fill="#BFD4E8">Z</text>' +
			'</svg>',

		bubble:
			'<svg viewBox="0 0 120 90">' +
			'<ellipse cx="64" cy="38" rx="52" ry="32" fill="#F3F7FB" opacity="0.94"/>' +
			'<circle cx="22" cy="70" r="8" fill="#F3F7FB" opacity="0.9"/>' +
			'<circle cx="12" cy="82" r="4.5" fill="#F3F7FB" opacity="0.85"/>' +
			'</svg>',

		/* Presents for under the tree: three boxes, each a different colour, each
		 * with a ribbon and a bow, and one lying on its side so the pile does not
		 * look like a shop display. Drawn as one prop because they are always put
		 * down together and never move separately.                             */
		gifts:
			'<svg viewBox="0 0 130 70">' +
			/* the big red one at the back */
			'<path d="M6,30 H54 V64 H6 Z" fill="#D8574A" stroke="#A33A30" stroke-width="2"/>' +
			'<path d="M26,30 H34 V64 H26 Z" fill="#FFD75E" stroke="#D8A32F" stroke-width="1.6"/>' +
			'<path d="M6,42 H54" stroke="#FFD75E" stroke-width="4"/>' +
			'<path d="M30,30 C22,22 14,26 20,31 C24,34 30,32 30,30 Z" fill="#FFD75E" stroke="#D8A32F" stroke-width="1.6"/>' +
			'<path d="M30,30 C38,22 46,26 40,31 C36,34 30,32 30,30 Z" fill="#FFD75E" stroke="#D8A32F" stroke-width="1.6"/>' +
			/* a green one in front, smaller */
			'<path d="M56,44 H92 V64 H56 Z" fill="#5FA86A" stroke="#3E7A48" stroke-width="2"/>' +
			'<path d="M70,44 H78 V64 H70 Z" fill="#EAF3FA" stroke="#B9CBD8" stroke-width="1.6"/>' +
			'<path d="M56,53 H92" stroke="#EAF3FA" stroke-width="3.4"/>' +
			'<path d="M74,44 C67,38 61,41 66,45 C69,47 74,46 74,44 Z" fill="#EAF3FA" stroke="#B9CBD8" stroke-width="1.4"/>' +
			'<path d="M74,44 C81,38 87,41 82,45 C79,47 74,46 74,44 Z" fill="#EAF3FA" stroke="#B9CBD8" stroke-width="1.4"/>' +
			/* and a blue one on its side */
			'<path d="M94,48 H126 V64 H94 Z" fill="#5C93D2" stroke="#3A6699" stroke-width="2"/>' +
			'<path d="M94,55 H126" stroke="#F2A93B" stroke-width="3.4"/>' +
			'<path d="M108,48 H114 V64 H108 Z" fill="#F2A93B" stroke="#C9832A" stroke-width="1.4"/>' +
			'</svg>',

		/* A birthday cake with five candles on it, and rather bigger than it was.
		 * The old one was a single slab with one candle in a 90x80 box; this one is
		 * 100x110 so the candles have room above the cake instead of being crammed
		 * into the same height as it.
		 *
		 * The base of the cake sits at 100 of 110, which is what the scene uses to
		 * stand it on the table: put the base on the surface, not the box. */
		cake:
			'<svg viewBox="0 0 100 110">' +
			/* stand */
			'<ellipse cx="50" cy="101" rx="45" ry="7" fill="#D8CFC2" stroke="#B4A897" stroke-width="2"/>' +
			'<path d="M8,96 C8,101 27,105 50,105 C73,105 92,101 92,96 Z" fill="#C7BCAB"/>' +
			/* the cake itself */
			'<path d="M14,62 H86 V96 C86,100 70,102 50,102 C30,102 14,100 14,96 Z" ' +
			'fill="#F6D8B8" stroke="#D9AE86" stroke-width="2"/>' +
			'<path d="M14,78 C28,82 72,82 86,78" fill="none" stroke="#E2B98F" stroke-width="2" opacity="0.7"/>' +
			/* frosting with drips */
			'<path d="M14,62 C14,55 30,50 50,50 C70,50 86,55 86,62 C78,66 72,60 64,64 ' +
			'C56,68 50,60 42,64 C34,68 26,60 14,62 Z" fill="#F8B8C8" stroke="#DE8FA4" stroke-width="2"/>' +
			/* sprinkles */
			'<path d="M26,70 L29,73 M46,72 L49,69 M66,71 L69,74" stroke="#8FC98F" stroke-width="2.2" stroke-linecap="round"/>' +
			'<circle cx="36" cy="86" r="2.2" fill="#E9738A"/>' +
			'<circle cx="58" cy="88" r="2.2" fill="#7FB6E8"/>' +
			'<circle cx="74" cy="85" r="2.2" fill="#8FC98F"/>' +
			/* five candles, alternating, each with a flame */
			'<path d="M23,56 H28 V32 H23 Z" fill="#E9738A" stroke="#C4566C" stroke-width="1.4"/>' +
			'<path d="M23,38 H28 M23,46 H28" stroke="#C4566C" stroke-width="1.2" opacity="0.55"/>' +
			'<path d="M26,32 V27" stroke="#8A7A62" stroke-width="1.4" stroke-linecap="round"/>' +
			'<path d="M26,14 C30,20 29,24 26,26 C23,24 22,20 26,14 Z" fill="#FFC24A"/>' +
			'<path d="M26,19 C28,23 27,25 26,26 C24,25 24,23 26,19 Z" fill="#FFF0B8"/>' +
			'<path d="M37,56 H42 V32 H37 Z" fill="#7FB6E8" stroke="#5C93C9" stroke-width="1.4"/>' +
			'<path d="M37,38 H42 M37,46 H42" stroke="#5C93C9" stroke-width="1.2" opacity="0.55"/>' +
			'<path d="M40,32 V27" stroke="#8A7A62" stroke-width="1.4" stroke-linecap="round"/>' +
			'<path d="M40,14 C44,20 43,24 40,26 C37,24 36,20 40,14 Z" fill="#FFC24A"/>' +
			'<path d="M40,19 C42,23 41,25 40,26 C38,25 38,23 40,19 Z" fill="#FFF0B8"/>' +
			'<path d="M51,56 H56 V32 H51 Z" fill="#E9738A" stroke="#C4566C" stroke-width="1.4"/>' +
			'<path d="M51,38 H56 M51,46 H56" stroke="#C4566C" stroke-width="1.2" opacity="0.55"/>' +
			'<path d="M54,32 V27" stroke="#8A7A62" stroke-width="1.4" stroke-linecap="round"/>' +
			'<path d="M54,14 C58,20 57,24 54,26 C51,24 50,20 54,14 Z" fill="#FFC24A"/>' +
			'<path d="M54,19 C56,23 55,25 54,26 C52,25 52,23 54,19 Z" fill="#FFF0B8"/>' +
			'<path d="M65,56 H70 V32 H65 Z" fill="#7FB6E8" stroke="#5C93C9" stroke-width="1.4"/>' +
			'<path d="M65,38 H70 M65,46 H70" stroke="#5C93C9" stroke-width="1.2" opacity="0.55"/>' +
			'<path d="M68,32 V27" stroke="#8A7A62" stroke-width="1.4" stroke-linecap="round"/>' +
			'<path d="M68,14 C72,20 71,24 68,26 C65,24 64,20 68,14 Z" fill="#FFC24A"/>' +
			'<path d="M68,19 C70,23 69,25 68,26 C66,25 66,23 68,19 Z" fill="#FFF0B8"/>' +
			'<path d="M79,56 H84 V32 H79 Z" fill="#E9738A" stroke="#C4566C" stroke-width="1.4"/>' +
			'<path d="M79,38 H84 M79,46 H84" stroke="#C4566C" stroke-width="1.2" opacity="0.55"/>' +
			'<path d="M82,32 V27" stroke="#8A7A62" stroke-width="1.4" stroke-linecap="round"/>' +
			'<path d="M82,14 C86,20 85,24 82,26 C79,24 78,20 82,14 Z" fill="#FFC24A"/>' +
			'<path d="M82,19 C84,23 83,25 82,26 C80,25 80,23 82,19 Z" fill="#FFF0B8"/>' +
			'</svg>',

		/* a small plate with two biscuits, for tea */
		sweets:
			'<svg viewBox="0 0 70 40">' +
			'<path d="M3,27 C3,33 17,37 35,37 C53,37 67,33 67,27 C67,24 53,22 35,22 C17,22 3,24 3,27 Z" fill="#EFF3F6" stroke="#9AA5AB" stroke-width="2"/>' +
			'<path d="M11,27 C14,30 23,32 35,32 C47,32 56,30 59,27" fill="none" stroke="#CBD6DC" stroke-width="1.6"/>' +
			'<circle cx="45" cy="20" r="8" fill="#E8B87C" stroke="#B07F49" stroke-width="2"/>' +
			'<circle cx="43" cy="18" r="1.5" fill="#7A4B2A"/>' +
			'<circle cx="48" cy="22" r="1.5" fill="#7A4B2A"/>' +
			'<circle cx="24" cy="19" r="9" fill="#D9A469" stroke="#B07F49" stroke-width="2"/>' +
			'<circle cx="20" cy="17" r="1.7" fill="#7A4B2A"/>' +
			'<circle cx="27" cy="20" r="1.7" fill="#7A4B2A"/>' +
			'<circle cx="23" cy="24" r="1.5" fill="#7A4B2A"/>' +
			'</svg>',

		desk:
			'<svg viewBox="0 0 160 110">' +
			'<path d="M6,44 H154 V56 H6 Z" fill="#C9975C" stroke="#A2743F" stroke-width="2"/>' +
			'<path d="M16,56 V104 M144,56 V104" stroke="#A2743F" stroke-width="7" stroke-linecap="round"/>' +
			'<path d="M10,8 H74 V40 H10 Z" fill="#2B3540" stroke="#1A2028" stroke-width="2"/>' +
			'<path d="M16,14 H68 V34 H16 Z" fill="#5B8FB0" opacity="0.9"/>' +
			'<path d="M22,19 H60 M22,24 H52 M22,29 H62" stroke="#CFE6F5" stroke-width="2" opacity="0.75"/>' +
			'<path d="M34,40 H50 V44 H34 Z" fill="#1A2028"/>' +
			'<path d="M92,34 H132 V44 H92 Z" fill="#E8E2D2" stroke="#C4BCA6" stroke-width="1.6"/>' +
			'<path d="M98,38 H126 M98,41 H120" stroke="#BFB6A2" stroke-width="1.4"/>' +
			'</svg>',

		mug:
			'<svg viewBox="0 0 60 54">' +
			'<path d="M6,10 H44 V38 C44,45 38,49 25,49 C12,49 6,45 6,38 Z" fill="#EFF3F6" stroke="#9AA5AB" stroke-width="2"/>' +
			'<path d="M10,16 H40 V22 H10 Z" fill="#8A5A3C" opacity="0.85"/>' +
			'<path d="M44,18 C54,18 56,24 56,28 C56,33 52,37 44,37" fill="none" stroke="#9AA5AB" stroke-width="4"/>' +
			'<path d="M16,6 C18,1 20,1 22,6 M28,5 C30,0 32,0 34,5" fill="none" stroke="#DCE8F4" stroke-width="2" stroke-linecap="round" opacity="0.8"/>' +
			'</svg>',

		snowball:
			'<svg viewBox="0 0 40 40">' +
			'<circle cx="20" cy="20" r="17" fill="#F4FAFF" stroke="#CBDDE9" stroke-width="2"/>' +
			'<circle cx="14" cy="14" r="5" fill="#FFFFFF" opacity="0.9"/>' +
			'<circle cx="26" cy="25" r="3.4" fill="#DCEAF4" opacity="0.9"/>' +
			'</svg>',

		puddle:
			'<svg viewBox="0 0 120 40">' +
			'<ellipse cx="60" cy="24" rx="54" ry="14" fill="#5B8FB0" opacity="0.55"/>' +
			'<ellipse cx="60" cy="22" rx="44" ry="10" fill="#7FB6E8" opacity="0.5"/>' +
			'<ellipse cx="44" cy="19" rx="12" ry="3.4" fill="#CFE6FA" opacity="0.7"/>' +
			'</svg>',

		tree:
			'<svg viewBox="0 0 100 130">' +
			'<path d="M50,8 L74,44 H26 Z" fill="#3F7A46" stroke="#2E5C34" stroke-width="2"/>' +
			'<path d="M50,30 L82,74 H18 Z" fill="#478A4E" stroke="#2E5C34" stroke-width="2"/>' +
			'<path d="M50,56 L90,108 H10 Z" fill="#4F9557" stroke="#2E5C34" stroke-width="2"/>' +
			'<path d="M42,108 H58 V122 H42 Z" fill="#8A5A3C" stroke="#6B4429" stroke-width="2"/>' +
			'<circle cx="38" cy="66" r="4.4" fill="#F2857F"/><circle cx="64" cy="84" r="4.4" fill="#FFD75E"/>' +
			'<circle cx="50" cy="48" r="3.8" fill="#9BE0DE"/><circle cx="30" cy="96" r="4" fill="#F8C6DC"/>' +
			'<path d="M50,2 L53,9 L60,10 L54,15 L56,22 L50,18 L44,22 L46,15 L40,10 L47,9 Z" fill="#FFD75E" stroke="#E8B62E" stroke-width="1.2"/>' +
			'</svg>',


		dot:
			'<svg viewBox="0 0 24 24">' +
			'<circle cx="12" cy="12" r="9" fill="#FF4A4A" opacity="0.25"/>' +
			'<circle cx="12" cy="12" r="4.6" fill="#FF3B3B"/>' +
			'<circle cx="10.4" cy="10.4" r="1.6" fill="#FFD3D3"/>' +
			'</svg>',

		sun:
			'<svg viewBox="0 0 100 100">' +
			'<g stroke="#FFC24A" stroke-width="6" stroke-linecap="round">' +
			'<path d="M50,6 V18 M50,82 V94 M6,50 H18 M82,50 H94"/>' +
			'<path d="M19,19 L28,28 M72,72 L81,81 M81,19 L72,28 M28,72 L19,81"/>' +
			'</g>' +
			'<circle cx="50" cy="50" r="26" fill="#FFD75E" stroke="#F0B429" stroke-width="2"/>' +
			'<circle cx="42" cy="42" r="8" fill="#FFE79A" opacity="0.8"/>' +
			'</svg>',

		/* Redrawn with a much LONGER pole, and that is the whole point of it.
		 *
		 * To actually shade her the canopy has to be wider than she is, and she is
		 * about 44% of the screen wide. The canopy also has to clear her head
		 * while the pole still reaches the ground - about 31% of the screen apart.
		 * With the old proportions (canopy ending 40% down, pole 94% down) only
		 * 54% of the height sat between those two points, so the parasol would
		 * have had to be around 95% of the screen WIDE to bridge it. Stretching
		 * the pole down to 96% of a taller box puts 70% of the height between
		 * them, and 54% width is enough.
		 *
		 * Which is the same trick as a real beach parasol: it is mostly pole.    */
		parasol:
			'<svg viewBox="0 0 120 200">' +
			'<path d="M2,54 C2,24 30,4 60,4 C90,4 118,24 118,54 Z" fill="#F2857F" stroke="#D96A64" stroke-width="2"/>' +
			'<path d="M36,54 C36,28 46,6 60,4 C74,6 84,28 84,54" fill="#FBEAE3" opacity="0.85"/>' +
			'<path d="M2,54 C9.5,47 21.5,47 31,54 C38.5,47 50.5,47 60,54 ' +
			'C67.5,47 79.5,47 89,54 C96.5,47 108.5,47 118,54" ' +
			'fill="none" stroke="#D96A64" stroke-width="2"/>' +
			/* two ribs, so the canopy has some structure */
			'<path d="M31,53 C34,32 46,10 60,5 M89,53 C86,32 74,10 60,5" ' +
			'fill="none" stroke="#D96A64" stroke-width="1.4" opacity="0.7"/>' +
			'<path d="M60,4 V192" stroke="#C9975C" stroke-width="5" stroke-linecap="round"/>' +
			'<path d="M60,192 C60,198 66,198 66,192" fill="none" stroke="#C9975C" stroke-width="5" stroke-linecap="round"/>' +
			'</svg>',

		cactus:
			'<svg viewBox="0 0 90 120">' +
			'<path d="M38,116 V50 C38,42 44,36 52,36 C60,36 66,42 66,50 V116 Z" fill="#6FA85A" stroke="#548543" stroke-width="2"/>' +
			'<path d="M38,74 H26 C18,74 12,68 12,60 V50 C12,44 20,44 20,50 V58 C20,62 24,64 28,64 H38 Z" fill="#6FA85A" stroke="#548543" stroke-width="2"/>' +
			'<path d="M66,66 H76 C82,66 86,62 86,56 V48 C86,42 78,42 78,48 V54 C78,56 76,58 74,58 H66 Z" fill="#7CB566" stroke="#548543" stroke-width="2"/>' +
			'<path d="M46,52 V106 M58,54 V106" stroke="#548543" stroke-width="1.6" opacity="0.6"/>' +
			'<path d="M22,112 H72 C78,112 80,116 80,118 H14 C14,116 16,112 22,112 Z" fill="#C98A5C" stroke="#A56C43" stroke-width="2"/>' +
			'</svg>',

		thermometer:
			'<svg viewBox="0 0 44 130">' +
			'<rect x="13" y="6" width="18" height="98" rx="9" fill="#EFF3F6" stroke="#9AA5AB" stroke-width="2"/>' +
			'<circle cx="22" cy="110" r="14" fill="#EFF3F6" stroke="#9AA5AB" stroke-width="2"/>' +
			'<rect x="18" y="26" width="8" height="80" rx="4" fill="#E8514B"/>' +
			'<circle cx="22" cy="110" r="9" fill="#E8514B"/>' +
			'<path d="M31,36 H37 M31,50 H37 M31,64 H37 M31,78 H37" stroke="#9AA5AB" stroke-width="2" stroke-linecap="round"/>' +
			'</svg>',

		sweat:
			'<svg viewBox="0 0 22 30">' +
			'<path d="M11,2 C16,11 19,17 19,21 A8,8 0 0,1 3,21 C3,17 6,11 11,2 Z" fill="#9FD4F2" opacity="0.9"/>' +
			'<ellipse cx="8" cy="19" rx="2.4" ry="3.2" fill="#E4F3FD" opacity="0.9"/>' +
			'</svg>',

		zombie:
			'<svg viewBox="0 0 70 110">' +
			'<path d="M26,104 V64 H44 V104 Z" fill="#7C8B6A" stroke="#5C6A4E" stroke-width="2"/>' +
			'<path d="M26,70 L8,58 M44,70 L62,58" stroke="#7C8B6A" stroke-width="7" stroke-linecap="round"/>' +
			'<circle cx="35" cy="40" r="22" fill="#93A47E" stroke="#5C6A4E" stroke-width="2"/>' +
			'<circle cx="27" cy="36" r="4" fill="#2B3325"/><circle cx="43" cy="36" r="4" fill="#2B3325"/>' +
			'<path d="M26,50 Q35,56 44,50" fill="none" stroke="#2B3325" stroke-width="2.4" stroke-linecap="round"/>' +
			'<path d="M22,22 C26,16 34,16 38,20" fill="none" stroke="#5C6A4E" stroke-width="2.4" stroke-linecap="round"/>' +
			'</svg>',

		flash:
			'<svg viewBox="0 0 10 10" preserveAspectRatio="none">' +
			'<rect width="10" height="10" fill="#FFFFFF"/>' +
			'</svg>',

		/* An actual forked bolt. The `flash` above is only the white sheet that
		 * lights the whole sky - on its own there was no lightning in the
		 * lightning, just the room going white for a moment.
		 *
		 * Four layers, outside in: a wide soft glow, a blue-white halo, the body
		 * of the bolt, and a thin brilliant core. That is what makes it read as
		 * light rather than as a yellow arrow.                                  */
		bolt:
			'<svg viewBox="0 0 40 140">' +
			'<g opacity="0.35">' +
			'<path d="M24,0 L6,62 L19,62 L2,140 L34,66 L20,66 L38,0 Z" fill="#BFE4FF" ' +
			'stroke="#BFE4FF" stroke-width="7" stroke-linejoin="round"/>' +
			'</g>' +
			'<path d="M24,0 L6,62 L19,62 L2,140 L34,66 L20,66 L38,0 Z" fill="#EAF6FF" ' +
			'stroke="#9CD2F5" stroke-width="3" stroke-linejoin="round"/>' +
			'<path d="M24,0 L6,62 L19,62 L2,140 L34,66 L20,66 L38,0 Z" fill="#FFFFFF"/>' +
			/* the fork, branching off halfway down */
			'<path d="M20,64 L33,96 L25,97 L35,127 L26,99 L33,98 Z" fill="#FFFFFF" ' +
			'stroke="#BFE4FF" stroke-width="2.5" stroke-linejoin="round" opacity="0.95"/>' +
			/* and the hot core */
			'<path d="M25,6 L14,58 L22,58 L11,120 L28,66 L21,66 L33,6 Z" fill="#FFFFFF" opacity="0.9"/>' +
			'</svg>',

		/* A small tea table. Not the work desk that used to be in this scene - that
		 * one had a monitor and covered her face. This is a round side table seen
		 * slightly from above, so the top reads as a surface things can stand on:
		 * an ellipse for the top, a band under it for the thickness of the wood,
		 * and three legs with the back one darker so it sits behind.            */
		teaTable:
			'<svg viewBox="0 0 200 90">' +
			'<path d="M96,44 H104 V76 H96 Z" fill="#8E6636"/>' +
			'<path d="M32,40 L24,86 L36,86 L42,40 Z" fill="#A87B47" stroke="#8E6636" stroke-width="1.6"/>' +
			'<path d="M168,40 L176,86 L164,86 L158,40 Z" fill="#A87B47" stroke="#8E6636" stroke-width="1.6"/>' +
			'<path d="M6,22 C6,33 48,42 100,42 C152,42 194,33 194,22 L194,31 ' +
			'C194,42 152,51 100,51 C48,51 6,42 6,31 Z" fill="#A87B47" stroke="#8E6636" stroke-width="2"/>' +
			'<ellipse cx="100" cy="22" rx="94" ry="17" fill="#C79A66" stroke="#9A6F42" stroke-width="2.5"/>' +
			'<ellipse cx="100" cy="19" rx="78" ry="11" fill="#D6AD77" opacity="0.55"/>' +
			'</svg>',

		/* A teaser wand: a rod, a string, and things dangling off it.
		 *
		 * One prop rather than several, and that is deliberate - a wand waves as a
		 * whole. Moving the prop moves rod, string and toys together, which is
		 * exactly what happens when somebody dangles one, and a stick that stayed
		 * still while its own string flew about would look wrong.
		 *
		 * The rod runs off the top-left corner, so it reads as held by someone
		 * just out of frame instead of floating on its own.                     */
		teaser:
			'<svg viewBox="0 0 110 150">' +
			/* the rod, and a wrapped grip at the near end */
			'<path d="M2,6 L80,36" stroke="#A9764A" stroke-width="6" stroke-linecap="round"/>' +
			'<path d="M2,6 L26,15" stroke="#5E4632" stroke-width="8" stroke-linecap="round"/>' +
			'<path d="M8,8 L10,14 M15,11 L17,17" stroke="#8A6A48" stroke-width="1.6"/>' +
			/* the string */
			'<path d="M80,36 C84,62 76,84 79,104 C81,116 78,122 79,128" fill="none" ' +
			'stroke="#D8D2C4" stroke-width="2.2" stroke-linecap="round"/>' +
			/* a feather part way down */
			'<path d="M79,52 C90,50 96,58 92,66 C86,72 78,66 79,52 Z" fill="#6FC0DE" ' +
			'stroke="#4A9BB8" stroke-width="1.6"/>' +
			'<path d="M80,54 C86,57 89,61 91,65" fill="none" stroke="#4A9BB8" stroke-width="1.2" opacity="0.7"/>' +
			/* a pom-pom */
			'<circle cx="77" cy="86" r="8.5" fill="#F2A93B" stroke="#C9832A" stroke-width="1.8"/>' +
			'<path d="M70,82 L84,90 M70,90 L84,82" stroke="#C9832A" stroke-width="1.4" opacity="0.6"/>' +
			/* and the mouse on the end */
			'<path d="M62,130 C62,120 70,114 79,114 C90,114 98,121 98,130 C98,137 90,141 79,141 ' +
			'C68,141 62,137 62,130 Z" fill="#A9A6A0" stroke="#7E7B76" stroke-width="1.8"/>' +
			'<circle cx="68" cy="120" r="5.5" fill="#C3BFB8" stroke="#7E7B76" stroke-width="1.6"/>' +
			'<circle cx="79" cy="115" r="5" fill="#C3BFB8" stroke="#7E7B76" stroke-width="1.6"/>' +
			'<circle cx="70" cy="127" r="1.9" fill="#3A3733"/>' +
			'<path d="M63,131 C56,133 54,139 58,143" fill="none" stroke="#7E7B76" ' +
			'stroke-width="2.2" stroke-linecap="round"/>' +
			'<path d="M96,127 L104,124 M96,131 L104,132" stroke="#7E7B76" stroke-width="1.4" stroke-linecap="round"/>' +
			'</svg>',

		/* An ice cream as a PROP, not as a garment.
		 *
		 * There is one in the wardrobe already, held in her paw - and that is
		 * exactly why this exists. A garment lives inside pawFL, behind a pivot at
		 * (-62,-78) and a rotate(-26) before the rig's own rotation, so bringing
		 * it to her mouth means guessing an offset in a rotated frame. Three
		 * rounds of guessing still left it a tenth of the screen out.
		 *
		 * A prop can be lifted by the same code that lifts the mug and the bowl,
		 * which asks Rig.bounds() where her mouth is and puts the thing there. So
		 * for eating, this is the one to use; the garment is for carrying.      */
		iceCream:
			'<svg viewBox="0 0 34 54">' +
			'<path d="M8,26 L15,50 L22,26 Z" fill="#E0B276" stroke="#B98A4E" stroke-width="1.6"/>' +
			'<path d="M10,31 H20 M11.5,36 H18.5" stroke="#B98A4E" stroke-width="1.2" opacity="0.7"/>' +
			'<circle cx="12" cy="21" r="8" fill="#F8C6DC" stroke="#DE9CBA" stroke-width="1.4"/>' +
			'<circle cx="21" cy="19" r="7" fill="#FBEAC0" stroke="#DFC694" stroke-width="1.4"/>' +
			'<circle cx="16" cy="10" r="6.5" fill="#A8DCC0" stroke="#7FBFA0" stroke-width="1.4"/>' +
			'</svg>',

		/* one biscuit, so she can take one off the plate and eat it */
		biscuit:
			'<svg viewBox="0 0 30 30">' +
			'<circle cx="15" cy="15" r="12" fill="#D9A469" stroke="#B07F49" stroke-width="2"/>' +
			'<circle cx="11" cy="12" r="2.1" fill="#7A4B2A"/>' +
			'<circle cx="19.5" cy="16" r="2.1" fill="#7A4B2A"/>' +
			'<circle cx="14" cy="20.5" r="1.8" fill="#7A4B2A"/>' +
			'</svg>',

		/* HER WARDROBE, drawn twice: shut and open.
		 *
		 * Swinging real doors is not available - a prop rotates as a single lump
		 * about its own centre, so a door would spin rather than hinge. Two
		 * drawings cross-faded, with a small widening as it goes, reads as opening
		 * and cannot go wrong. The open one has the doors swung out to the sides in
		 * perspective and her things on a rail inside.                          */
		closetShut:
			'<svg viewBox="0 0 100 150">' +
			'<path d="M8,144 H20 V150 H8 Z M80,144 H92 V150 H80 Z" fill="#6B4628"/>' +
			'<path d="M6,12 H94 V146 H6 Z" fill="#A9764A" stroke="#7C5433" stroke-width="2.5"/>' +
			'<path d="M2,4 H98 V14 H2 Z" fill="#8E5F38" stroke="#6B4628" stroke-width="2"/>' +
			'<path d="M10,18 H48 V142 H10 Z" fill="#BE8757" stroke="#7C5433" stroke-width="2"/>' +
			'<path d="M52,18 H90 V142 H52 Z" fill="#BE8757" stroke="#7C5433" stroke-width="2"/>' +
			'<path d="M16,26 H42 V80 H16 Z M16,88 H42 V134 H16 Z" fill="none" ' +
			'stroke="#9A6C42" stroke-width="1.8"/>' +
			'<path d="M58,26 H84 V80 H58 Z M58,88 H84 V134 H58 Z" fill="none" ' +
			'stroke="#9A6C42" stroke-width="1.8"/>' +
			'<circle cx="45" cy="80" r="2.8" fill="#E8CB8E" stroke="#A98A4F" stroke-width="1"/>' +
			'<circle cx="55" cy="80" r="2.8" fill="#E8CB8E" stroke="#A98A4F" stroke-width="1"/>' +
			'</svg>',

		closetOpen:
			'<svg viewBox="0 0 100 150">' +
			'<path d="M8,144 H20 V150 H8 Z M80,144 H92 V150 H80 Z" fill="#6B4628"/>' +
			'<path d="M6,12 H94 V146 H6 Z" fill="#A9764A" stroke="#7C5433" stroke-width="2.5"/>' +
			/* the inside */
			'<path d="M16,20 H84 V142 H16 Z" fill="#4A3524"/>' +
			'<path d="M16,20 H84 V30 H16 Z" fill="#3B2A1C"/>' +
			'<path d="M19,34 H81" stroke="#C9B08A" stroke-width="2.6" stroke-linecap="round"/>' +
			/* three things hanging on the rail */
			'<path d="M30,34 L26,44 C22,54 24,66 30,68 C36,66 38,54 34,44 Z" fill="#4E86C6" stroke="#3A6699" stroke-width="1.6"/>' +
			'<path d="M50,34 L46,46 C42,60 45,76 50,78 C55,76 58,60 54,46 Z" fill="#C85A6E" stroke="#A64354" stroke-width="1.6"/>' +
			'<path d="M70,34 L65,48 C60,66 64,86 70,88 C76,86 80,66 75,48 Z" fill="#F2C14E" stroke="#D8A32F" stroke-width="1.6"/>' +
			'<path d="M28,32 C28,28 32,28 32,32 M48,32 C48,28 52,28 52,32 M68,32 C68,28 72,28 72,32" ' +
			'fill="none" stroke="#C9B08A" stroke-width="1.6"/>' +
			/* the doors, swung out to the sides */
			'<path d="M6,12 L0,20 V138 L6,146 Z" fill="#A97A4E" stroke="#7C5433" stroke-width="2"/>' +
			'<path d="M94,12 L100,20 V138 L94,146 Z" fill="#CE9463" stroke="#7C5433" stroke-width="2"/>' +
			'<path d="M2,4 H98 V14 H2 Z" fill="#8E5F38" stroke="#6B4628" stroke-width="2"/>' +
			'</svg>',

		/* Things she has finished with, for the floor. Drawn separately so you can
		 * see WHICH thing she threw down, which one generic bundle would not give. */
		tossCap:
			'<svg viewBox="0 0 44 26">' +
			'<path d="M6,18 C6,8 16,3 24,4 C33,5 38,11 38,18 Z" fill="#4E86C6" stroke="#3A6699" stroke-width="2"/>' +
			'<path d="M38,18 C42,18 43,21 40,22 L8,22 C4,22 4,18 8,18 Z" fill="#3A6699"/>' +
			'</svg>',

		tossScarf:
			'<svg viewBox="0 0 48 24">' +
			'<path d="M4,10 C14,2 24,16 34,8 C40,3 45,7 44,13 C42,19 34,14 28,18 ' +
			'C20,23 10,19 4,16 Z" fill="#C85A6E" stroke="#A64354" stroke-width="2"/>' +
			'<path d="M10,9 V15 M20,12 V19 M32,10 V16" stroke="#A64354" stroke-width="1.4" opacity="0.5"/>' +
			'</svg>',

		tossCoat:
			'<svg viewBox="0 0 48 32">' +
			'<path d="M6,22 C4,12 12,6 22,7 C33,8 42,13 43,22 C43,27 36,29 24,29 ' +
			'C12,29 7,27 6,22 Z" fill="#F2C14E" stroke="#D8A32F" stroke-width="2"/>' +
			'<path d="M16,10 C18,18 20,24 22,28 M30,9 C30,17 29,24 27,28" ' +
			'fill="none" stroke="#D8A32F" stroke-width="1.6" opacity="0.6"/>' +
			'<circle cx="20" cy="17" r="2" fill="#D8A32F"/>' +
			'</svg>',

		/* A desk fan, in two pieces: the body stands still and the blades spin.
		 * One prop could not do both - a prop rotates as a whole, so the stand
		 * would have gone round with them. Props turn about their own centre, so
		 * the blades only have to be placed with their middle on the hub.       */
		fan:
			'<svg viewBox="0 0 100 130">' +
			'<path d="M20,126 H80 L70,112 H30 Z" fill="#6B7480" stroke="#4E5661" stroke-width="2.5"/>' +
			'<path d="M43,113 H57 V80 H43 Z" fill="#7C8794" stroke="#4E5661" stroke-width="2"/>' +
			'<circle cx="34" cy="119" r="3.4" fill="#C4525A" stroke="#8E3B41" stroke-width="1.4"/>' +
			'<circle cx="50" cy="46" r="40" fill="#D7E1EA" opacity="0.22"/>' +
			'<circle cx="50" cy="46" r="40" fill="none" stroke="#8C97A4" stroke-width="3.2"/>' +
			'<circle cx="50" cy="46" r="29" fill="none" stroke="#8C97A4" stroke-width="1.8" opacity="0.6"/>' +
			'<circle cx="50" cy="46" r="18" fill="none" stroke="#8C97A4" stroke-width="1.8" opacity="0.6"/>' +
			'<path d="M50,6 V86 M10,46 H90 M22,18 L78,74 M78,18 L22,74" ' +
			'stroke="#8C97A4" stroke-width="1.4" opacity="0.35"/>' +
			'</svg>',

		/* three blades, written out at 0, 120 and 240 degrees rather than reused
		 * through <use>, so there is no xlink to go wrong in an old WebView */
		fanBlades:
			'<svg viewBox="0 0 100 100">' +
			'<g fill="#BFCAD6" stroke="#8C97A4" stroke-width="1.6">' +
			'<g transform="rotate(0 50 50)"><path d="M50,50 C61,33 57,15 47,7 C37,17 39,37 50,50 Z"/></g>' +
			'<g transform="rotate(120 50 50)"><path d="M50,50 C61,33 57,15 47,7 C37,17 39,37 50,50 Z"/></g>' +
			'<g transform="rotate(240 50 50)"><path d="M50,50 C61,33 57,15 47,7 C37,17 39,37 50,50 Z"/></g>' +
			'</g>' +
			'<circle cx="50" cy="50" r="7" fill="#7C8794" stroke="#4E5661" stroke-width="1.4"/>' +
			'</svg>',

		/* moving air: three wavy lines to drift across her */
		breeze:
			'<svg viewBox="0 0 90 60">' +
			'<path d="M4,12 C22,4 38,20 56,12 C68,7 78,10 86,14" fill="none" ' +
			'stroke="#CBE7F8" stroke-width="4.2" stroke-linecap="round" opacity="0.9"/>' +
			'<path d="M2,31 C20,23 36,39 54,31 C66,26 78,29 88,33" fill="none" ' +
			'stroke="#B4DAF2" stroke-width="3.6" stroke-linecap="round" opacity="0.75"/>' +
			'<path d="M6,49 C24,41 40,57 58,49 C70,44 80,47 85,51" fill="none" ' +
			'stroke="#9FCDEC" stroke-width="3" stroke-linecap="round" opacity="0.6"/>' +
			'</svg>',

		/* Vibration marks, the comic-book kind: three blue arcs that flash beside
		 * her while she shudders. The shake alone is only a few pixels; these are
		 * what make it read across the room.                                    */
		shiverMark:
			'<svg viewBox="0 0 40 70">' +
			'<path d="M30,10 C18,20 18,50 30,60" fill="none" stroke="#9FD2F2" ' +
			'stroke-width="5" stroke-linecap="round" opacity="0.95"/>' +
			'<path d="M20,16 C10,24 10,46 20,54" fill="none" stroke="#7FBEEA" ' +
			'stroke-width="4.2" stroke-linecap="round" opacity="0.8"/>' +
			'<path d="M11,23 C4,29 4,41 11,47" fill="none" stroke="#5FA8DF" ' +
			'stroke-width="3.4" stroke-linecap="round" opacity="0.6"/>' +
			'</svg>',

		/* A cat bed, in two halves.
		 *
		 * The back rim goes behind her and the front rim in front, so she sits
		 * INSIDE it rather than next to it. One piece could only ever be one or
		 * the other. They overlap by a couple of percent so the rim reads as
		 * continuous around her.
		 *
		 * Lavender on purpose: her fur is cream with ginger patches, so a bed in
		 * any warm pale colour would disappear into her. This is different in hue
		 * and darker as well, and it is not the turquoise of the towel, the red of
		 * the book or the green of her vest.                                    */
		bedBack:
			'<svg viewBox="0 0 200 80">' +
			'<path d="M4,66 C4,26 48,6 100,6 C152,6 196,26 196,66 Z" fill="#8E86C8" ' +
			'stroke="#645C9E" stroke-width="2.5"/>' +
			'<path d="M28,72 C28,42 62,24 100,24 C138,24 172,42 172,72 Z" fill="#655EA0"/>' +
			'<path d="M14,52 C22,28 58,14 100,14 C142,14 178,28 186,52" fill="none" ' +
			'stroke="#B3ACE4" stroke-width="4" stroke-linecap="round" opacity="0.65"/>' +
			/* stitching round the rim */
			'<path d="M22,44 L26,50 M44,26 L47,33 M72,15 L74,23 M100,11 L100,19 ' +
			'M128,15 L126,23 M156,26 L153,33 M178,44 L174,50" ' +
			'stroke="#5A5391" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/>' +
			'</svg>',

		bedFront:
			'<svg viewBox="0 0 200 60">' +
			'<path d="M4,4 C4,44 48,56 100,56 C152,56 196,44 196,4 Z" fill="#8E86C8" ' +
			'stroke="#645C9E" stroke-width="2.5"/>' +
			'<path d="M4,6 C40,18 160,18 196,6" fill="none" stroke="#5A5391" ' +
			'stroke-width="2.5" opacity="0.5"/>' +
			'<path d="M20,32 C36,46 66,52 100,52 C134,52 164,46 180,32" fill="none" ' +
			'stroke="#B3ACE4" stroke-width="4" stroke-linecap="round" opacity="0.6"/>' +
			'<path d="M26,22 L23,28 M56,32 L54,38 M100,38 L100,44 M144,32 L146,38 ' +
			'M174,22 L177,28" stroke="#5A5391" stroke-width="1.8" stroke-linecap="round" opacity="0.55"/>' +
			'</svg>',

		/* A beach towel, drawn with a little perspective - the front edge is wider
		 * than the back one - so she reads as lying ON it rather than in front of
		 * it. Turquoise and cream, which nothing else on the screen is.        */
		towel:
			'<svg viewBox="0 0 160 62">' +
			'<path d="M12,10 L148,10 L150,18 L10,18 Z" fill="#4FB3A5"/>' +
			'<path d="M10,18 L150,18 L152,26 L8,26 Z" fill="#FDF3E3"/>' +
			'<path d="M8,26 L152,26 L154,34 L6,34 Z" fill="#4FB3A5"/>' +
			'<path d="M6,34 L154,34 L156,42 L4,42 Z" fill="#FDF3E3"/>' +
			'<path d="M4,42 L156,42 L158,50 L2,50 Z" fill="#4FB3A5"/>' +
			'<path d="M12,10 L148,10 L158,50 L2,50 Z" fill="none" stroke="#2E8A7E" stroke-width="2.5"/>' +
			/* fringe along the front edge */
			'<path d="M10,50 V57 M22,50 V58 M34,50 V56 M46,50 V58 M58,50 V57 M70,50 V58 ' +
			'M82,50 V56 M94,50 V58 M106,50 V57 M118,50 V58 M130,50 V56 M142,50 V58 M152,50 V57" ' +
			'stroke="#FDF3E3" stroke-width="2.4" stroke-linecap="round"/>' +
			'</svg>',

		/* Her house. Scenery, so it goes in the layer behind the forecast and may
		 * be tall - the doorway has to be big enough to hide a cat in.
		 * The doorway is centred on the art, which is how the scene knows where
		 * to walk her: door centre = houseX + houseW / 2.                       */
		house:
			'<svg viewBox="0 0 100 130">' +
			'<path d="M14,48 H86 V127 H14 Z" fill="#6E8290" stroke="#4A5B67" stroke-width="2.5"/>' +
			/* plank lines */
			'<path d="M14,62 H86 M14,78 H86 M14,94 H86 M14,110 H86" stroke="#61737F" stroke-width="1.6"/>' +
			/* roof, overhanging on both sides */
			'<path d="M0,52 L50,8 L100,52 Z" fill="#B85A4E" stroke="#8A3A31" stroke-width="2.5" stroke-linejoin="round"/>' +
			'<path d="M0,52 H100" stroke="#8A3A31" stroke-width="3"/>' +
			/* chimney with a curl of smoke */
			'<path d="M68,20 H80 V40 H68 Z" fill="#8A5A4C" stroke="#634036" stroke-width="2"/>' +
			'<path d="M74,18 C79,12 69,9 74,3" fill="none" stroke="#C9D6DD" stroke-width="2.6" ' +
			'stroke-linecap="round" opacity="0.55"/>' +
			/* two lit windows */
			'<path d="M20,60 H38 V78 H20 Z" fill="#FFD583" stroke="#B98B3E" stroke-width="2"/>' +
			'<path d="M29,60 V78 M20,69 H38" stroke="#B98B3E" stroke-width="1.6"/>' +
			'<path d="M62,60 H80 V78 H62 Z" fill="#FFD583" stroke="#B98B3E" stroke-width="2"/>' +
			'<path d="M71,60 V78 M62,69 H80" stroke="#B98B3E" stroke-width="1.6"/>' +
			/* the doorway - deliberately very dark, so eyes show up in it */
			'<path d="M34,127 V96 C34,80 66,80 66,96 V127 Z" fill="#141A1E" ' +
			'stroke="#4A5B67" stroke-width="2.5"/>' +
			'<path d="M38,127 V97 C38,85 62,85 62,97 V127 Z" fill="#0C1012"/>' +
			'</svg>',

		/* Two eyes in the dark, for when she is inside and the door is black. */
		catEyes:
			'<svg viewBox="0 0 60 26">' +
			'<ellipse cx="16" cy="13" rx="12" ry="9" fill="#D9F27A" opacity="0.22"/>' +
			'<ellipse cx="44" cy="13" rx="12" ry="9" fill="#D9F27A" opacity="0.22"/>' +
			'<ellipse cx="16" cy="13" rx="8" ry="6" fill="#E9F79B"/>' +
			'<ellipse cx="44" cy="13" rx="8" ry="6" fill="#E9F79B"/>' +
			'<ellipse cx="16" cy="13" rx="2.4" ry="5.4" fill="#26301A"/>' +
			'<ellipse cx="44" cy="13" rx="2.4" ry="5.4" fill="#26301A"/>' +
			'<circle cx="13" cy="10" r="1.5" fill="#FFFFFF" opacity="0.85"/>' +
			'<circle cx="41" cy="10" r="1.5" fill="#FFFFFF" opacity="0.85"/>' +
			'</svg>',

		puff:
			'<svg viewBox="0 0 40 30">' +
			'<ellipse cx="14" cy="16" rx="12" ry="9" fill="#DCE8F4" opacity="0.55"/>' +
			'<ellipse cx="27" cy="13" rx="8" ry="6" fill="#DCE8F4" opacity="0.4"/>' +
			'</svg>',

		heart:
			'<svg viewBox="0 0 30 28">' +
			'<path d="M15,26 C4,17 1,11 4,6 C7,1 13,3 15,8 C17,3 23,1 26,6 C29,11 26,17 15,26 Z" fill="#FF8FA8"/>' +
			'</svg>'
	};

	function init() {
		box = byId('cat_props');
		backBox = byId('cat_props_back');
	}

	function grab(back) {
		var list = back ? backPool : pool;
		var parent = back ? backBox : box;
		for (var i = 0; i < list.length; i++) {
			if (!list[i].busy) { list[i].busy = true; return list[i]; }
		}
		var d = document.createElement('div');
		d.style.position = 'absolute';
		d.style.opacity = '0';
		if (parent) parent.appendChild(d);
		var rec = { node: d, busy: true };
		list.push(rec);
		return rec;
	}

	/* put(art, xPct, yPct, wPct, z) -> rig part name to animate.
	 * z below 5 puts the prop behind the cat, above 5 puts it in front.        */
	function put(art, x, y, w, z) {
		if (!box) init();
		/* z below 5 is scenery: it goes in the layer behind the forecast */
		var rec = grab(z !== undefined && z < 5);
		var name = 'p' + (++seq);

		rec.node.innerHTML = ART[art] || '';
		rec.node.style.left = x + '%';
		rec.node.style.top = y + '%';
		rec.node.style.width = w + '%';
		rec.node.style.height = 'auto';
		rec.node.style.transform = 'none';
		rec.node.style.opacity = '0';
		rec.node.style.zIndex = (z === undefined ? 4 : z);
		rec.node.setAttribute('data-prop', name);

		live[name] = rec;
		Rig.register(name, rec.node, 'dom');
		Rig.set(name, 'o', 0);
		return name;
	}

	/* move a live prop to a new anchor without disturbing its tweened transform */
	function anchor(name, x, y) {
		var rec = live[name];
		if (!rec) return;
		if (x !== null && x !== undefined) rec.node.style.left = x + '%';
		if (y !== null && y !== undefined) rec.node.style.top = y + '%';
	}

	function drop(name) {
		var rec = live[name];
		if (!rec) return;
		rec.node.style.opacity = '0';
		rec.node.innerHTML = '';
		rec.busy = false;
		Rig.unregister(name);
		delete live[name];
	}

	function clear() {
		var i;
		for (var name in live) drop(name);
		for (i = 0; i < pool.length; i++) {
			pool[i].busy = false;
			pool[i].node.style.opacity = '0';
			pool[i].node.innerHTML = '';
		}
		for (i = 0; i < backPool.length; i++) {
			backPool[i].busy = false;
			backPool[i].node.style.opacity = '0';
			backPool[i].node.innerHTML = '';
		}
		Rig.clearDynamic();
	}

	return {
		init: init,
		put: put,
		anchor: anchor,
		drop: drop,
		clear: clear,
		names: function () { var k = [], n; for (n in ART) k.push(n); return k; }
	};
})();
