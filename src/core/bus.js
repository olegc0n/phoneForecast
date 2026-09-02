/* bus.js - the only thing connecting the forecast to the cat.
 *
 * The forecast never calls into the cat directly, and the cat never reads the
 * forecast's DOM state. That is what lets the cat be switched off, or crash,
 * without the clock noticing.                                                  */

var Bus = (function () {
	var subs = {};
	var last = {};                /* the most recent payload per topic */

	return {
		/* `replay` hands a late subscriber the payload it missed.
		 *
		 * The weather is STATE, not an event, and it was being published as an
		 * event. boot.js paints the stored forecast before starting the cat -
		 * deliberately, so the clock never waits for her - which means
		 * Weather.restore() emits before Cat.init() has subscribed, and that
		 * payload went nowhere. It used to be papered over: restore() cleared
		 * `lastcall`, so a fresh call fired a second later and emitted again.
		 * Once restarts stopped costing an API call there was no second emit, and
		 * the cat began every restart blind - not knowing the weather until the
		 * file went stale an hour later, or for ever with the API down. She would
		 * be undressed in the rain and her whole day planned as though the sky
		 * were unknown.
		 *
		 * Retaining the last payload fixes the class of it rather than the
		 * instance: any subscriber that arrives late can ask for what it missed,
		 * and the boot order stays free to put the forecast first.            */
		on: function (topic, fn, replay) {
			if (!subs[topic]) subs[topic] = [];
			subs[topic].push(fn);
			if (replay && last.hasOwnProperty(topic)) {
				try { fn(last[topic]); }
				catch (e) { if (typeof Guard !== 'undefined') Guard.fault(topic + ':replay', e); }
			}
		},

		/* what a topic last published, or undefined */
		last: function (topic) { return last[topic]; },

		/* A throwing subscriber must never break the publisher. Each one is
		 * isolated, and the error is handed to Guard so the cat can be
		 * disabled after repeated failures.                                    */
		emit: function (topic, payload) {
			last[topic] = payload;
			var list = subs[topic];
			if (!list) return;
			for (var i = 0; i < list.length; i++) {
				try { list[i](payload); }
				catch (e) { if (typeof Guard !== 'undefined') Guard.fault(topic, e); }
			}
		}
	};
})();


/* Guard - the error firewall around everything optional.
 *
 * Three uncaught faults and the cat is switched off for the rest of the
 * session: the stage is emptied, the frame loop stops, and the forecast
 * carries on exactly as it did before the cat existed.                         */

var Guard = (function () {
	/* THE LIMIT IS A RATE, NOT A LIFETIME TOTAL.
	 *
	 * It used to be three faults ever. This thing runs for weeks on a shelf, so
	 * three unrelated hiccups a fortnight apart - one bad prop, one arithmetic
	 * slip - would switch the cat off permanently until somebody power-cycled
	 * the phone. Three faults inside a minute still means she is genuinely
	 * broken and gets switched off; three faults inside a month means nothing at
	 * all and should be survived.                                              */
	var LIMIT = 3;
	var WINDOW = 60000;

	var recent = [];              /* timestamps inside the window */
	var faults = 0;               /* lifetime total, for the overlay */
	var dead = false;
	var lastMessage = '';

	function kill(reason) {
		dead = true;
		lastMessage = reason;
		try { if (typeof Cat !== 'undefined' && Cat.disable) Cat.disable(); } catch (e) {}
	}

	var api = {
		faults: function () { return faults; },
		message: function () { return lastMessage; },

		/* wrap any optional work; returns false if it was skipped or failed */
		run: function (label, fn) {
			if (dead) return false;
			try { fn(); return true; }
			catch (e) { api.fault(label, e); return false; }
		},

		fault: function (label, e) {
			if (dead) return;
			faults++;
			lastMessage = label + ': ' + (e && e.message ? e.message : e);
			if (window.console && console.warn) console.warn('[cat fault ' + faults + '] ' + lastMessage);

			var now = Date.now();
			recent.push(now);
			while (recent.length && recent[0] < now - WINDOW) recent.shift();
			if (recent.length >= LIMIT) {
				kill(LIMIT + ' faults in a minute - ' + lastMessage);
			}
		}
	};

	return api;
})();
