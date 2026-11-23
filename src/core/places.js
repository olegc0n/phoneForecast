/* places.js - finding the place the forecast is for.
 *
 * Two ways, both started from the settings dialog:
 *
 *   search(name, cb)   Open-Meteo's geocoding (built on GeoNames): the typed
 *                      name is the only thing sent. Asked in the screen's
 *                      language (i18n.js), except that a name typed in Cyrillic
 *                      always asks in Russian, so the results come back in the
 *                      script the person typed.
 *                      cb(error | null, [{ name, region, country, lat, lon }])
 *
 *   locate(cb)         "Use my location", in the APK only: MainActivity asks for
 *                      ACCESS_COARSE_LOCATION when it is tapped, takes a fix from
 *                      the framework LocationManager's network provider (no
 *                      Google services needed - Huawei has none), names it with
 *                      the platform Geocoder where there is one, and calls
 *                      Places.located({ ok, lat, lon, name } | { ok: false, error })
 *                      - keep that name, MainActivity uses it.
 *                      cb(error | null, { name, lat, lon })
 *
 * Neither sets anything: the dialog hands the answer to Settings.setPlace().
 * Searches do not count against the forecast's daily ceiling - they are a
 * different service, and only ever one tap each.                             */

var Places = (function () {
	var GEOCODING = 'https://geocoding-api.open-meteo.com/v1/search';
	var LOCATE_PATIENCE = 60 * 1000;      /* a second tap after this starts again */

	var pending = null;                   /* the locate() callback waiting for Java */
	var pendingAt = 0;

	/* Cyrillic typed: Russian results, whatever the screen says; else the screen's language */
	function language(name) {
		if (/[\u0400-\u04FF]/.test(name)) return 'ru';
		return (typeof I18n !== 'undefined' && I18n.lang() === 'ru') ? 'ru' : 'en';
	}

	function searchUrl(name) {
		return GEOCODING + '?name=' + encodeURIComponent(name) + '&count=8&language=' +
			language(name) + '&format=json';
	}

	function num(v) { return (typeof v === 'number' && isFinite(v)) ? v : null; }

	function results(body) {
		var a = body && body.results, out = [];
		if (!a || typeof a.length !== 'number') return out;
		for (var i = 0; i < a.length; i++) {
			var r = a[i] || {};
			var lat = num(r.latitude), lon = num(r.longitude);
			if (lat === null || lon === null) continue;
			out.push({
				name: String(r.name || ''),
				region: String(r.admin1 || ''),
				country: String(r.country || ''),
				lat: lat,
				lon: lon
			});
		}
		return out;
	}

	function search(name, cb) {
		var q = String(name || '').replace(/\s+/g, ' ').trim();
		if (!q) { cb('empty', []); return; }
		getJSON(searchUrl(q), {}, 15000,
			function (body) { cb(null, results(body)); },
			function (why) { cb(why, []); });
	}

	/* "Minsk" + "Belarus" -> "Minsk, Belarus"; what the dialog and the place line show */
	function join(a, b) {
		if (!a) return b || '';
		if (!b) return a;
		return a + ', ' + b;
	}

	/* the second line of a result: its region and country, the region left out
	 * when it is only the name again */
	function where(r) { return join(r.region === r.name ? '' : r.region, r.country); }

	function canLocate() { return Host.canLocate(); }

	function locate(cb) {
		if (pending && Date.now() - pendingAt < LOCATE_PATIENCE) return false;
		pending = cb;
		pendingAt = Date.now();
		if (!Host.locate()) {
			pending = null;
			cb('unavailable', null);
			return false;
		}
		return true;
	}

	/* MainActivity's answer. */
	function located(r) {
		var cb = pending;
		pending = null;
		LOG('Places.located ' + (r && r.ok ? 'ok' : 'failed: ' + (r && r.error)));
		if (!cb) return;
		if (!r || !r.ok || num(r.lat) === null || num(r.lon) === null) {
			cb((r && r.error) || 'failed', null);
			return;
		}
		cb(null, { name: String(r.name || ''), lat: r.lat, lon: r.lon });
	}

	return {
		search: search,
		searchUrl: searchUrl,
		results: results,
		join: join,
		where: where,
		canLocate: canLocate,
		locate: locate,
		located: located
	};
})();
