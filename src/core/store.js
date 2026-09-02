/* store.js - localStorage that cannot throw.
 *
 * On a file:// origin Chrome hands out an opaque origin and every localStorage
 * access can raise SecurityError. In a WebView it works, but only if the host
 * app enabled DOM storage. So: probe once, fall back to an in-memory object,
 * and never let a storage problem reach the caller.                            */

var Store = (function () {
	var mem = {};
	var live = false;

	try {
		localStorage.setItem('__probe', '1');
		localStorage.removeItem('__probe');
		live = true;
	} catch (e) {
		live = false;
	}

	function get(k) {
		try { return live ? localStorage.getItem(k) : (mem.hasOwnProperty(k) ? mem[k] : null); }
		catch (e) { return mem.hasOwnProperty(k) ? mem[k] : null; }
	}

	function set(k, v) {
		mem[k] = v;                                   /* always keep the session copy */
		if (!live) return;
		try { localStorage.setItem(k, v); } catch (e) { live = false; }
	}

	return {
		persistent: function () { return live; },
		get: get,
		set: set,
		getJSON: function (k) {
			var raw = get(k);
			if (!raw) return null;
			try { return JSON.parse(raw); } catch (e) { return null; }
		},
		setJSON: function (k, obj) {
			try { set(k, JSON.stringify(obj)); } catch (e) {}
		}
	};
})();
