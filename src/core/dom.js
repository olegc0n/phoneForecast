/* dom.js - the handful of jQuery calls the old page used, in plain ES5.
 * Deliberately tiny: this exists so the page has no CDN dependency and can
 * boot with no network at all. Everything here is Android-4.4-safe.               */

function qs(sel)  { return document.querySelector(sel); }
function qsa(sel) { return document.querySelectorAll(sel); }
function byId(id) { return document.getElementById(id); }

function each(list, fn) {
	for (var i = 0; i < list.length; i++) fn(list[i], i);
}

function addClass(el, cls) {
	if (!el || !cls) return;
	var cur = ' ' + (el.getAttribute('class') || '') + ' ';
	if (cur.indexOf(' ' + cls + ' ') === -1) el.setAttribute('class', (cur + cls).replace(/^\s+/, ''));
}

function removeClass(el, cls) {
	if (!el || !cls) return;
	var cur = ' ' + (el.getAttribute('class') || '') + ' ';
	el.setAttribute('class', cur.split(' ' + cls + ' ').join(' ').replace(/^\s+|\s+$/g, ''));
}

/* class helpers take a selector because the old code did $('.sector_x').addClass() */
function addClassAll(sel, cls)    { each(qsa(sel), function (el) { addClass(el, cls); }); }
function removeClassAll(sel, cls) { each(qsa(sel), function (el) { removeClass(el, cls); }); }

function on(el, ev, fn) {
	if (!el) return;
	if (el.addEventListener) el.addEventListener(ev, fn, false);
	else el.attachEvent('on' + ev, fn);
}

/* getJSON - replaces $.ajax. onFail is called for timeout, network error and
 * any non-2xx, so the retry logic upstream has exactly one path to handle.     */
function getJSON(url, headers, timeoutMs, onOk, onFail) {
	var xhr = new XMLHttpRequest();
	var done = false;
	function fail(why) { if (!done) { done = true; onFail(why); } }

	try { xhr.open('GET', url, true); } catch (e) { fail('open'); return; }
	for (var h in headers) { try { xhr.setRequestHeader(h, headers[h]); } catch (e) {} }

	xhr.timeout = timeoutMs;
	xhr.ontimeout = function () { fail('timeout'); };
	xhr.onerror   = function () { fail('network'); };
	xhr.onreadystatechange = function () {
		if (xhr.readyState !== 4 || done) return;
		if (xhr.status >= 200 && xhr.status < 300) {
			var data = null;
			try { data = JSON.parse(xhr.responseText); } catch (e) { fail('parse'); return; }
			done = true;
			onOk(data, xhr.responseText);
		} else {
			fail('http ' + xhr.status);
		}
	};
	try { xhr.send(null); } catch (e) { fail('send'); }
}

function pad(n) { return n < 10 ? '0' + n : '' + n; }

/* Is the clock inside a HH:MM..HH:MM window? Wraps past midnight, so
 * ('23:00','10:00') is the night rather than an empty range.
 *
 * `unset` is what to answer when either end is missing, and it is the whole
 * reason this lives here: episodes.js and scenes.js each had their own copy of
 * this function, identical except that one returned false for an unset window
 * and the other returned true. Two functions that differ only in an invisible
 * default are exactly the pair that eventually gets used the wrong way round. */
function inClockWindow(date, from, to, unset) {
	var a = hhmm(from), b = hhmm(to);
	if (a < 0 || b < 0) return !!unset;
	var m = date.getHours() * 60 + date.getMinutes();
	return a <= b ? (m >= a && m < b) : (m >= a || m < b);
}

/* 'HH:MM' -> minutes since midnight, or -1 */
function hhmm(str) {
	if (!str) return -1;
	var p = String(str).split(':');
	if (p.length < 2) return -1;
	return Number(p[0]) * 60 + Number(p[1]);
}
