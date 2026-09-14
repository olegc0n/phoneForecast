/* settings.js - the few things the shelf owner can change without a rebuild.
 *
 * The config block at the top of the page stays the default. Anything changed in
 * the dialog is kept in localStorage and applied over it at boot, so a rebuild
 * that moves a default still loses to a value somebody set on the phone. That is
 * the right way round: the phone is where the person is, and the person standing
 * in front of the shelf should not need a laptop and a cable to change a key.
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
			api:        api,
			api_url:    api_url,
			quiet_from: cat_quiet_from,
			quiet_to:   cat_quiet_to
		};
		return base;
	}

	function stored() { return Store.getJSON(KEY) || {}; }

	/* A stored blank is not a value - it is a field somebody cleared, and the
	 * default is a better answer than an empty key that fails every call. */
	function pick(a, b) {
		return (typeof a === 'string' && a.length) ? a : b;
	}

	function effective() {
		var d = capture(), s = stored();
		return {
			api:        pick(s.api, d.api),
			api_url:    pick(s.api_url, d.api_url),
			quiet_from: pick(s.quiet_from, d.quiet_from),
			quiet_to:   pick(s.quiet_to, d.quiet_to)
		};
	}

	function apply() {
		var e = effective();
		api            = e.api;
		api_url        = e.api_url;
		cat_quiet_from = e.quiet_from;
		cat_quiet_to   = e.quiet_to;
		return e;
	}

	/* 'HH:MM', and nothing else. inClockWindow() answers "unset" for anything it
	 * cannot parse, which would quietly turn quiet hours off for good. */
	function okTime(v) {
		return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(String(v || ''));
	}

	function okUrl(v) {
		return /^https?:\/\/[^\s]+$/i.test(String(v || ''));
	}

	/* Returns the list of fields that actually changed, so the caller can decide
	 * whether anything is worth acting on - a key edit costs an API call and the
	 * allowance is thirty a day, so it must not be spent re-saving the same key. */
	function save(next) {
		var before = effective();
		var keep = {};
		var fields = ['api', 'api_url', 'quiet_from', 'quiet_to'];
		for (var i = 0; i < fields.length; i++) {
			var f = fields[i];
			var v = next.hasOwnProperty(f) ? String(next[f]).trim() : before[f];
			keep[f] = v;
		}
		Store.setJSON(KEY, keep);
		var after = apply();

		var changed = [];
		for (var j = 0; j < fields.length; j++) {
			if (before[fields[j]] !== after[fields[j]]) changed.push(fields[j]);
		}
		return changed;
	}

	function reset() {
		Store.setJSON(KEY, {});
		return apply();
	}

	return {
		load: apply,
		get: effective,
		defaults: capture,
		save: save,
		reset: reset,
		okTime: okTime,
		okUrl: okUrl
	};
})();
