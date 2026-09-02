/* host.js - the optional native bridge.
 *
 * The page runs identically in a browser tab and inside the APK; the only
 * difference is that the APK can do things a tab cannot. Everything here is
 * feature-detected and wrapped, so nothing changes when the bridge is absent. */

var Host = (function () {
	var api = null;
	try { api = (typeof window.PhoneForecast !== 'undefined') ? window.PhoneForecast : null; } catch (e) { api = null; }

	return {
		native: function () { return !!api; },

		name: function () {
			try { return api && api.host ? api.host() : 'browser'; } catch (e) { return 'browser'; }
		},

		sdk: function () {
			try { return api && api.sdk ? api.sdk() : 0; } catch (e) { return 0; }
		}

		/* No brightness control. There was one, dimming the screen during quiet
		 * hours, and it was worse than what it replaced: Android's automatic
		 * brightness already measures the room and gets it right, and an app
		 * overriding it with a fixed fraction only gets it wrong differently.
		 * The system owns the backlight.                                       */
	};
})();
