/* settings.js - the few things the shelf owner can change without a rebuild.
 *
 * The config block at the top of the page stays the default. Anything changed in
 * the dialog is kept in localStorage and applied over it at boot, so a rebuild
 * that moves a default still loses to a value somebody set on the phone. That is
 * the right way round: the phone is where the person is, and the person standing
 * in front of the shelf should not need a laptop and a cable to change anything.
 *
 * Two things live here:
 *   - the PLACE the forecast is for: a name and its coordinates, chosen by city
 *     search or "use my location". There is no default - a build ships with no
 *     place at all, and with none the app asks for nothing (weather.js).
 *   - the SLEEP hours, cat_quiet_from / cat_quiet_to.
 *
 * It edits the globals in place rather than handing out a config object, because
 * every module already reads those globals and threading a new one through all
 * of them would be a bigger change than the feature is worth.                  */

var Settings = (function () {
	var KEY = 'cfg.v1';
	var base = null;                      /* the build-time values, captured once */

	/* Captured BEFORE the first apply(), or the defaults would be whatever the
	 * user last saved and "reset" would reset to nothing. */
	function capture() {
		if (base) return base;
		base = {
			quiet_from: cat_quiet_from,
			quiet_to:   cat_quiet_to
		};
		return base;
	}

	function stored() { return Store.getJSON(KEY) || {}; }

	/* A stored blank is not a value - it is a field somebody cleared, and the
	 * default is a better answer than an empty one. */
	function pick(a, b) {
		return (typeof a === 'string' && a.length) ? a : b;
	}

	function okPlace(lat, lon) {
		return typeof lat === 'number' && typeof lon === 'number' && lat === lat && lon === lon &&
			isFinite(lat) && isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180;
	}

	/* 4 decimals: about 10 m, more than any forecast resolves. What is SENT is
	 * rounded further (wxsource.js); this is only what the phone keeps. */
	function round4(v) { return Math.round(v * 10000) / 10000; }

	function storedPlace(s) {
		var p = s.place;
		if (!p || !okPlace(p.lat, p.lon)) return null;
		return { name: typeof p.name === 'string' ? p.name : '', lat: round4(p.lat), lon: round4(p.lon) };
	}

	function effective() {
		var d = capture(), s = stored(), p = storedPlace(s);
		return {
			place_name: p ? p.name : '',
			place_lat:  p ? p.lat : null,
			place_lon:  p ? p.lon : null,
			quiet_from: pick(s.quiet_from, d.quiet_from),
			quiet_to:   pick(s.quiet_to, d.quiet_to)
		};
	}

	function apply() {
		var e = effective();
		place_name     = e.place_name;
		place_lat      = e.place_lat;
		place_lon      = e.place_lon;
		cat_quiet_from = e.quiet_from;
		cat_quiet_to   = e.quiet_to;
		return e;
	}

	/* 'HH:MM', and nothing else. inClockWindow() answers "unset" for anything it
	 * cannot parse, which would quietly turn quiet hours off for good. */
	function okTime(v) {
		return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(v || ''));
	}

	/* The sleep hours. Returns the fields that actually changed. */
	function save(next) {
		var before = effective();
		var s = stored();
		var fields = ['quiet_from', 'quiet_to'];
		for (var i = 0; i < fields.length; i++) {
			var f = fields[i];
			s[f] = next.hasOwnProperty(f) ? String(next[f]).trim() : before[f];
		}
		Store.setJSON(KEY, s);
		var after = apply();

		var changed = [];
		for (var j = 0; j < fields.length; j++) {
			if (before[fields[j]] !== after[fields[j]]) changed.push(fields[j]);
		}
		return changed;
	}

	/* The place. True when it really moved (or was renamed): only then is a new
	 * forecast worth asking for. A place without a name is called by its
	 * coordinates. False, and nothing kept, for coordinates that are not a place. */
	function setPlace(name, lat, lon) {
		lat = Number(lat);
		lon = Number(lon);
		if (!okPlace(lat, lon)) return false;
		lat = round4(lat);
		lon = round4(lon);
		name = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
		if (!name) name = lat.toFixed(2) + ', ' + lon.toFixed(2);

		var before = effective();
		var s = stored();
		s.place = { name: name, lat: lat, lon: lon };
		Store.setJSON(KEY, s);
		apply();
		return before.place_lat !== lat || before.place_lon !== lon || before.place_name !== name;
	}

	/* Sleep hours back to what the build shipped. The place stays: losing it
	 * would blank the forecast, and choosing a city is its own button. */
	function reset() {
		var s = stored();
		delete s.quiet_from;
		delete s.quiet_to;
		Store.setJSON(KEY, s);
		return apply();
	}

	return {
		load: apply,
		get: effective,
		defaults: capture,
		save: save,
		setPlace: setPlace,
		reset: reset,
		okTime: okTime,
		okPlace: okPlace
	};
})();
