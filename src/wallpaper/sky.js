/* sky.js - the sky she lives under: the real forecast when there is one, else
 * an invented one, so the wallpaper needs no network to have weather.
 *
 * Every `when` condition, the wardrobe, her mood and the idle-beat weights are
 * written against the payload weather.js derive() publishes. So rather than
 * teach any of them about a world without weather, this file makes some up and
 * publishes it on the same Bus topic in the same shape. Nothing downstream can
 * tell the difference, and nothing downstream had to change.
 *
 * The sky is drawn from eleven kinds, weighted by the month, so snow scenes do
 * not turn up in July. The hemisphere comes from the timezone name (north unless
 * it is plainly southern), and can be forced with `wall_hemisphere`.
 *
 * Night comes from the local time against a sunrise/sunset table for about
 * 50 degrees north. When it flips, the payload is published again, because the
 * scene conditions and Episodes.pick read `wx.isNight` as it is, not as it
 * would be now.
 *
 * REAL WEATHER WINS. When the user has set a place, the phone fetches a
 * forecast and Wall.forecast() hands Sky a source for it (useReal: Forecast.now,
 * forecast.js). While that source has an answer for the present hour, it is
 * the sky: begin() publishes it, tick() publishes it again only when something
 * she reacts to has changed (material(): the sky, precipitation, thunder,
 * night, the whole degree, the whole m/s, falling pressure), so her clothes do
 * not flicker, and redraw() - the shuffle's every-fifth arming, a show after
 * three hours away, the boot loop looking for unseen scenes - changes nothing.
 * When the source has no answer (no data for this hour, or fetched more than
 * 48 h ago) or is taken away, the invented sky comes back at the next tick.   */

var Sky = (function () {

	/* name, sky, precip, temp C, wind m/s, thunder, weights January..December
	 * for the north. A zero keeps the kind out of that month entirely.        */
	var TABLE = [
		['mild',     'skc', null,     18,  3, false, [1, 1, 2, 3, 3, 3, 3, 3, 3, 2, 1, 1]],
		['hot',      'skc', null,     26,  2, false, [0, 0, 0, 0, 1, 3, 3, 3, 1, 0, 0, 0]],
		['grey',     'ovc', null,     13,  4, false, [1, 1, 2, 2, 2, 1, 1, 1, 2, 3, 2, 1]],
		['rain',     'ovc', 'ra',     10,  6, false, [0, 0, 1, 2, 2, 1, 1, 1, 2, 2, 1, 0]],
		['storm',    'ovc', 'ra',     20,  7, true,  [0, 0, 0, 0, 1, 2, 2, 2, 1, 0, 0, 0]],
		['windy',    'bkn', null,     12, 10, false, [1, 1, 2, 2, 1, 1, 1, 1, 2, 2, 2, 1]],
		['chill',    'ovc', null,      3,  4, false, [2, 2, 2, 1, 0, 0, 0, 0, 0, 1, 3, 2]],
		['frost',    'skc', null,     -8,  2, false, [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 1, 3]],
		['snow',     'ovc', 'sn',     -3,  3, false, [3, 3, 1, 0, 0, 0, 0, 0, 0, 0, 1, 3]],
		['blizzard', 'ovc', 'sn',     -5,  7, false, [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]],
		['sleet',    'ovc', 'ra_sn',   1,  6, false, [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 2, 1]]
	];

	/* sunrise and sunset by month, about 50 N, as clock minutes */
	var SUN = [
		[8 * 60 + 10, 16 * 60 + 40], [7 * 60 + 30, 17 * 60 + 30], [6 * 60 + 30, 18 * 60 + 20],
		[6 * 60 + 20, 20 * 60 + 10], [5 * 60 + 30, 21 * 60],      [5 * 60,      21 * 60 + 30],
		[5 * 60 + 20, 21 * 60 + 20], [6 * 60,      20 * 60 + 30], [6 * 60 + 50, 19 * 60 + 20],
		[7 * 60 + 40, 18 * 60 + 15], [7 * 60 + 30, 16 * 60 + 30], [8 * 60 + 10, 16 * 60 + 10]
	];
	/* no seasons at all: an equatorial day */
	var SUN_FLAT = [6 * 60 + 30, 18 * 60 + 30];

	/* The southern timezones worth knowing about. Anything else is north, which
	 * is where nearly everybody lives. */
	var SOUTH_PREFIX = ['Australia/', 'Antarctica/', 'America/Argentina/'];
	var SOUTH_ZONES = [
		'Pacific/Auckland', 'Pacific/Chatham', 'Pacific/Fiji', 'Pacific/Noumea', 'Pacific/Tongatapu',
		'America/Sao_Paulo', 'America/Buenos_Aires', 'America/Santiago', 'America/Punta_Arenas',
		'America/Montevideo', 'America/Asuncion', 'Atlantic/Stanley',
		'Africa/Johannesburg', 'Africa/Maputo', 'Africa/Windhoek', 'Africa/Harare', 'Africa/Lusaka',
		'Africa/Gaborone', 'Africa/Maseru', 'Africa/Mbabane',
		'Indian/Mauritius', 'Indian/Reunion', 'Indian/Antananarivo'
	];

	var cur = null;               /* { kind: index into TABLE (-1 for real), real, wx: payload } */
	var real = null;              /* (date) -> the real payload or null; null: invented only */

	function hemisphere() {
		var h = (typeof wall_hemisphere === 'string') ? wall_hemisphere : 'auto';
		if (h === 'north' || h === 'south' || h === 'none') return h;
		var tz = '';
		try { tz = String(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) { tz = ''; }
		for (var i = 0; i < SOUTH_PREFIX.length; i++) if (tz.indexOf(SOUTH_PREFIX[i]) === 0) return 'south';
		return SOUTH_ZONES.indexOf(tz) !== -1 ? 'south' : 'north';
	}

	/* the north's month that matches this one: the south is six months out */
	function season(month, hemi) {
		return hemi === 'south' ? (month + 6) % 12 : month;
	}

	/* { name: weight } for a JS month, 0 = January */
	function weightsFor(month) {
		var hemi = hemisphere(), out = {};
		for (var i = 0; i < TABLE.length; i++) {
			out[TABLE[i][0]] = hemi === 'none' ? 1 : TABLE[i][6][season(month, hemi)];
		}
		return out;
	}

	function sunFor(date) {
		var hemi = hemisphere();
		return hemi === 'none' ? SUN_FLAT : SUN[season(date.getMonth(), hemi)];
	}

	function indexOf(name) {
		for (var i = 0; i < TABLE.length; i++) if (TABLE[i][0] === name) return i;
		return -1;
	}

	/* A weighted draw for the month, never `not`. If the month's table leaves
	 * nothing else, any other kind will do: a redraw must change something. */
	function draw(month, not) {
		var w = weightsFor(month), pool = [], weights = [], total = 0, i, n;
		for (i = 0; i < TABLE.length; i++) {
			if (i === not) continue;
			n = w[TABLE[i][0]];
			if (!(n > 0)) continue;
			pool.push(i); weights.push(n); total += n;
		}
		if (!pool.length) {
			for (i = 0; i < TABLE.length; i++) if (i !== not) { pool.push(i); weights.push(1); total += 1; }
		}
		var r = Math.random() * total;
		for (i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) return pool[i]; }
		return pool[pool.length - 1];
	}

	/* The payload, in exactly the shape weather.js derive() produces. */
	function make(kind, date) {
		var k = TABLE[typeof kind === 'string' ? indexOf(kind) : kind];
		if (!k) return null;
		var sun = sunFor(date);
		var m = date.getHours() * 60 + date.getMinutes();
		var wet = k[0] === 'rain' || k[0] === 'storm';
		return {
			code: 'wall:' + k[0],
			sky: k[1],
			precip: k[2],
			intensity: 0,
			isThunder: k[5],
			isNight: m < sun[0] || m > sun[1],
			temp: k[3],
			wind: k[4],
			windAngle: 200,
			humidity: 60,
			pressure: null,
			pressureTrend: wet ? -4 : 0,
			moonCode: null,
			minutesToSunrise: sun[0] - m,
			minutesToSunset: sun[1] - m,
			sunriseMin: sun[0],
			sunsetMin: sun[1]
		};
	}

	function publish(kind, date) {
		cur = { kind: kind, real: false, wx: make(kind, date) };
		LOG('sky ' + TABLE[kind][0] + ' ' + cur.wx.temp + 'C' + (cur.wx.isNight ? ' night' : ' day') +
			' (' + hemisphere() + ')');
		Bus.emit('weather', cur.wx);
		return TABLE[kind][0];
	}

	/* ---- real weather ---- */

	/* What she reacts to, as one string: two payloads with the same key are the
	 * same weather to her. Not the minutes to sunrise, the humidity, the exact
	 * pressure or the wind's direction. */
	function material(wx) {
		if (!wx) return '';
		return [wx.sky, wx.precip, wx.intensity, !!wx.isThunder, !!wx.isNight,
		        wx.temp === null ? 'null' : Math.round(wx.temp), Math.round(wx.wind || 0),
		        wx.pressureTrend < -3].join('|');
	}

	function realNow(date) {
		if (!real) return null;
		try {
			return real(date) || null;
		} catch (e) {
			Guard.fault('sky-real', e);
			return null;
		}
	}

	function publishReal(wx) {
		cur = { kind: -1, real: true, wx: wx };
		LOG('sky real ' + wx.code + ' ' + wx.temp + 'C' + (wx.isNight ? ' night' : ' day'));
		Bus.emit('weather', wx);
		return 'real';
	}

	/* The forecast's answer for `date`, or null for the invented sky only. It
	 * takes effect at the next begin(), tick() or redraw(). */
	function useReal(fn) {
		real = typeof fn === 'function' ? fn : null;
	}

	/* a fresh sky for this start: the real one if there is one */
	function begin(date) {
		var wx = realNow(date);
		if (wx) return publishReal(wx);
		return publish(draw(date.getMonth(), -1), date);
	}

	/* A different invented sky - never the one she has now. Real weather is not
	 * redrawn: while it has an answer, this publishes it only if it is new. */
	function redraw(date) {
		var wx = realNow(date);
		if (wx) {
			if (cur && cur.real && material(wx) === material(cur.wx)) return 'real';
			return publishReal(wx);
		}
		return publish(draw(date.getMonth(), cur && !cur.real ? cur.kind : -1), date);
	}

	/* Every minute: publish again if night has come or gone - or, with real
	 * weather, if anything material changed; and back to an invented sky when
	 * the forecast runs out. Returns whether it published, so the harness can
	 * count. */
	function tick(date) {
		if (!cur) return false;
		var wx = realNow(date);
		if (wx) {
			if (cur.real && material(wx) === material(cur.wx)) return false;
			publishReal(wx);
			return true;
		}
		if (cur.real) {
			LOG('sky: no real weather for now - an invented sky again');
			publish(draw(date.getMonth(), -1), date);
			return true;
		}
		var sun = sunFor(date);
		var m = date.getHours() * 60 + date.getMinutes();
		var night = m < sun[0] || m > sun[1];
		if (night === !!cur.wx.isNight) return false;
		publish(cur.kind, date);
		return true;
	}

	return {
		begin: begin,
		redraw: redraw,
		tick: tick,
		useReal: useReal,
		current: function () { return cur ? cur.wx : null; },
		kind: function () { return cur ? (cur.real ? 'real' : TABLE[cur.kind][0]) : null; },
		isReal: function () { return !!(cur && cur.real); },
		material: material,
		kinds: function () {
			var out = [];
			for (var i = 0; i < TABLE.length; i++) out.push(TABLE[i][0]);
			return out;
		},
		weightsFor: weightsFor,
		hemisphere: hemisphere,
		/* exposed for the offline harness */
		make: make,
		sunFor: sunFor
	};
})();
