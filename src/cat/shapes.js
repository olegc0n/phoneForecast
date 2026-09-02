/* shapes.js - authored key shapes for morphing.
 *
 * Every shape in a set MUST use the same path commands in the same order; only
 * the numbers differ, and those are what get interpolated. That is the whole
 * trick behind her silhouette actually changing rather than just being scaled:
 * a loaf is genuinely a different outline from a stretch, not the same outline
 * squashed.                                                                    */

var Shapes = {

	/* mouth: M + 4 cubics. 26 numbers. */
	mouth: {
		closed: 'M-5,0 C-5,0 -2,0 0,0 C2,0 5,0 5,0 C5,0 2,0 0,0 C-2,0 -5,0 -5,0 Z',
		small:  'M-4,0 C-4,-2 -2,-3 0,-3 C2,-3 4,-2 4,0 C4,2 2,3 0,3 C-2,3 -4,2 -4,0 Z',
		wide:   'M-6,0 C-6,-4 -3,-7 0,-7 C3,-7 6,-4 6,0 C6,5 3,8 0,8 C-3,8 -6,5 -6,0 Z',
		pant:   'M-5,0 C-5,-2 -2,-4 0,-4 C2,-4 5,-2 5,0 C5,4 2,6 0,6 C-2,6 -5,4 -5,0 Z',
		smile:  'M-6,-1 C-6,1 -3,3 0,3 C3,3 6,1 6,-1 C6,-1 3,-1 0,-1 C-3,-1 -6,-1 -6,-1 Z',
		frown:  'M-6,2 C-6,0 -3,-2 0,-2 C3,-2 6,0 6,2 C6,2 3,2 0,2 C-3,2 -6,2 -6,2 Z'
	},

	/* body silhouette: M + 6 cubics. 38 numbers. */
	body: {
		normal:  'M0,-118 C34,-118 56,-104 62,-84 C68,-64 74,-44 74,-26 C74,-6 52,6 0,6 C-52,6 -74,-6 -74,-26 C-74,-44 -68,-64 -62,-84 C-56,-104 -34,-118 0,-118 Z',
		loaf:    'M0,-98 C32,-98 54,-88 60,-70 C66,-52 80,-40 80,-24 C80,-6 56,8 0,8 C-56,8 -80,-6 -80,-24 C-80,-40 -66,-52 -60,-70 C-54,-88 -32,-98 0,-98 Z',
		ball:    'M0,-104 C38,-104 62,-88 68,-66 C74,-46 86,-34 86,-20 C86,-2 58,10 0,10 C-58,10 -86,-2 -86,-20 C-86,-34 -74,-46 -68,-66 C-62,-88 -38,-104 0,-104 Z',
		stretch: 'M0,-132 C30,-132 50,-116 56,-94 C62,-72 66,-48 66,-28 C66,-6 48,6 0,6 C-48,6 -66,-6 -66,-28 C-66,-48 -62,-72 -56,-94 C-50,-116 -30,-132 0,-132 Z',
		crouch:  'M0,-100 C36,-100 58,-88 64,-72 C70,-56 78,-42 78,-26 C78,-6 54,6 0,6 C-54,6 -78,-6 -78,-26 C-78,-42 -70,-56 -64,-72 C-58,-88 -36,-100 0,-100 Z',
		/* asleep: a wide low mound, so that head-on she reads as a curled cat
		 * rather than a standing one with its eyes shut */
		sleep:   'M0,-64 C46,-64 76,-54 84,-40 C92,-26 98,-18 98,-8 C98,6 62,16 0,16 C-62,16 -98,6 -98,-8 C-98,-18 -92,-26 -84,-40 C-76,-54 -46,-64 0,-64 Z'
	}
};
