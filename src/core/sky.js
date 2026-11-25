/* sky.js - the current weather, drawn as a sky.
 *
 * The block between the date and the evening forecast. Instead of an icon, a
 * row of bars and a sunrise row at the bottom of the screen, there is an arc
 * the sun walks from sunrise to sunset - and the moon, in today's phase, from
 * sunset to the next sunrise - with the clouds of the hour, a windsock, and,
 * when it rains or snows, the rain or snow itself, over the whole screen down
 * to the floor Lili stands on.
 *
 * Layers, bottom up:
 *
 *   #sky_back    canvas, whole screen, behind the forecast and behind her:
 *                rain, small flakes, splashes and puddles, lying snow
 *   #sky_svg     the arc, sun or moon, stars, clouds, lightning, the windsock
 *   numbers      #temperature and the three stats, HTML over the svg. View
 *                writes them, exactly as before; this file never touches them
 *   (her stage)
 *   #sky_front   canvas, whole screen, in front of her: the near snow crystals
 *                and the drops that splash off her umbrella
 *
 * Units are the svg's viewBox, 100 across the screen, so 1 unit = 1vw. The
 * canvases work in the same units, measured off the svg itself.
 *
 * This is core, and it is decoration. It must never stop the clock: every way
 * in is fenced (guard), three faults in a minute stop the animation for the
 * session, and the numbers carry on because View owns them. It never looks at
 * the cat either. The one thing it needs from her side - where her umbrella is,
 * so the rain can stop on it - it asks through a hook that side registers
 * (Sky.shelter). With nothing registered the rain simply reaches the floor.
 *
 * The loop is a timer, not requestAnimationFrame, for the reason anim.js gives:
 * rAF would wake the phone sixty times a second to draw twelve frames. 20 fps
 * while something falls, 12 otherwise; stopped while the page is hidden; and
 * during the quiet hours one still frame a minute.                            */

var Sky = (function () {
	var NS = 'http://www.w3.org/2000/svg';
	var XLINK = 'http://www.w3.org/1999/xlink';

	/* the arc: the top half of an ellipse standing on the horizon at y = 43 */
	var CX = 50, CY = 43, RX = 45, RY = 37;

	var FPS_WET = 20;              /* rain, snow, sleet or a storm on screen */
	var FPS_DRY = 12;              /* clouds, the sock, the rays, the stars */
	var MIN_GAP = 8;               /* ms; leave the main thread some air, as anim.js does */
	var PREVIEW_MS = 10 * 60 * 1000;
	var FAULT_LIMIT = 3, FAULT_WINDOW = 60000;
	/* The canvases are the whole screen. The G4 is a 3x screen; thin rain at 3x
	 * is a 1080x1920 surface cleared twice a frame, and at 2x it looks the same. */
	var DPR_MAX = 2;
	var TAU = 6.2832;

	/* ================================================================== *
	 *  pure geometry and mapping - no DOM, exported for tools/check-sky   *
	 * ================================================================== */

	function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
	function num(v, d) { return (typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity) ? v : d; }

	/* Every number that reaches an attribute goes through here. One NaN in a
	 * transform and the browser throws on every frame after it (see Rig.set). */
	function fx(n, d) { return num(n, 0).toFixed(d); }

	function clockStr(m) {
		m = ((Math.round(num(m, 0)) % 1440) + 1440) % 1440;
		return pad(Math.floor(m / 60)) + ':' + pad(m % 60);
	}

	function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }

	function onArc(f) {
		var th = Math.PI * (1 - f);
		return { x: CX + RX * Math.cos(th), y: CY - RY * Math.sin(th), e: Math.sin(th) };
	}

	function arcPath(f0, f1) {
		var a = onArc(f0), b = onArc(f1);
		return 'M' + fx(a.x, 2) + ',' + fx(a.y, 2) + ' A' + RX + ',' + RY + ' 0 0 1 ' + fx(b.x, 2) + ',' + fx(b.y, 2);
	}

	/* Yesterday, today and tomorrow out of the days the file covers. Today is
	 * found by its date, so a file written yesterday still gives today's sun;
	 * a file that does not reach today falls back to its first day. */
	function pickDays(days, date) {
		var out = { prev: null, today: null, next: null };
		if (!days || !days.length || !date) return out;
		var key = ymd(date), idx = 0, i;
		for (i = 0; i < days.length; i++) if (days[i] && days[i].date === key) { idx = i; break; }
		out.prev = idx > 0 ? days[idx - 1] || null : null;
		out.today = days[idx] || null;
		out.next = days[idx + 1] || null;
		return out;
	}

	function okMin(m) { return typeof m === 'number' && m >= 0 && m < 1440; }

	/* Where on the arc, and what the two corners say, at clock minute `mins`.
	 *
	 *   day     sunrise -> sunset; left corner sunrise, right corner sunset
	 *   night   sunset -> the next sunrise; the corners swap, so the left one
	 *           always says where the arc began and the right one where it ends
	 *
	 * After sunset the next sunrise is tomorrow's if the file has tomorrow, else
	 * today's (a minute or two out). Before sunrise the night began at
	 * yesterday's sunset, or at today's if the file has no yesterday.
	 * null when today's sunrise and sunset are unknown. */
	function where(mins, d) {
		var today = d && d.today;
		if (!today || !okMin(today.rise) || !okMin(today.set) || today.set <= today.rise) return null;
		var r = today.rise, s = today.set;
		if (mins >= r && mins < s) {
			return { day: true, f: (mins - r) / (s - r), left: 'rise', leftM: r, right: 'set', rightM: s };
		}
		if (mins >= s) {
			var rn = d.next && okMin(d.next.rise) ? d.next.rise : r;
			return { day: false, f: clamp((mins - s) / (1440 - s + rn), 0, 1),
				left: 'set', leftM: s, right: 'rise', rightM: rn };
		}
		var ps = d.prev && okMin(d.prev.set) ? d.prev.set : s;
		return { day: false, f: clamp((mins + 1440 - ps) / (1440 - ps + r), 0, 1),
			left: 'set', leftM: ps, right: 'rise', rightM: r };
	}

	/* The lit part of the moon, radius r, for Yandex's moon_code: 0 full,
	 * 4 last quarter (left half lit), 8 new, 12 first quarter (right half lit).
	 * Two half-ellipse arcs between the poles. '' for a new moon or no code. */
	function moonPath(r, code) {
		if (typeof code !== 'number' || code !== code || code < 0 || code > 15) return '';
		code = Math.round(code);
		var p = ((code + 8) % 16) / 16;          /* 0 new .. 0.5 full */
		if (p === 0) return '';
		var c = Math.cos(2 * Math.PI * p);
		var rx = fx(Math.abs(c) * r, 3);
		var top = '0,' + (-r), bot = '0,' + r;
		if (p < 0.5) return 'M' + top + ' A' + r + ',' + r + ' 0 0 1 ' + bot + ' A' + rx + ',' + r + ' 0 0 ' + (c > 0 ? 0 : 1) + ' ' + top + 'Z';
		return 'M' + top + ' A' + r + ',' + r + ' 0 0 0 ' + bot + ' A' + rx + ',' + r + ' 0 0 ' + (c < 0 ? 0 : 1) + ' ' + top + 'Z';
	}

	/* ---------------- what the sky is doing ----------------
	 *
	 * Read off the icon code with the parser the cat already uses
	 * (Weather.splitCode: sky skc|bkn|ovc, precip ra|sn|ra_sn, intensity -1|0|1,
	 * thunder) and Yandex's cloudness (0, 0.25 .. 1).                          */
	function bitsOf(code, cloudness) {
		var b = (typeof Weather !== 'undefined' && Weather.splitCode)
			? Weather.splitCode(code || '')
			: { sky: 'skc', precip: null, intensity: 0, thunder: false };
		var cover = b.sky === 'ovc' ? 'ovc'
			: b.sky === 'bkn' ? (typeof cloudness === 'number' && cloudness <= 0.25 ? 'few' : 'some')
			: 'clear';
		var precip = b.precip === 'ra' ? 'rain' : b.precip === 'sn' ? 'snow' : b.precip === 'ra_sn' ? 'sleet' : 'none';
		return { cover: cover, precip: precip, level: clamp(num(b.intensity, 0) + 1, 0, 2), storm: !!b.thunder };
	}

	/* The rules that make it read. A storm is heavy rain with lightning. Heavy
	 * rain or snow, or a storm, is overcast whatever the code said; rain out of
	 * a clear sky or one small cloud gets two clouds to fall from. Anything
	 * falling turns the clouds grey. */
	function force(b) {
		var s = { cover: b.cover, precip: b.precip, level: b.level, storm: !!b.storm };
		if (s.storm) { s.precip = 'rain'; s.level = 2; }
		if (s.precip === 'none') s.level = 0;
		if (s.storm || (s.precip !== 'none' && s.level === 2)) s.cover = 'ovc';
		else if (s.precip !== 'none' && (s.cover === 'clear' || s.cover === 'few')) s.cover = 'some';
		s.grey = s.cover === 'ovc' || s.precip !== 'none';
		return s;
	}

	function scene(code, cloudness) { return force(bitsOf(code, cloudness)); }

	/* How much falls, light / moderate / heavy. Sleet is both, thinner. */
	var COUNT = { rain: [40, 95, 170], snow: [60, 120, 220] };

	function counts(kind, level) {
		var l = clamp(Math.round(num(level, 1)), 0, 2), r = 0, s = 0;
		if (kind === 'rain') r = COUNT.rain[l];
		if (kind === 'snow') s = COUNT.snow[l];
		if (kind === 'sleet') { r = Math.round(COUNT.rain[l] * 0.55); s = Math.round(COUNT.snow[l] * 0.4); }
		return { rain: r, snow: s };
	}

	/* ---------------- the windsock ----------------
	 *
	 * Five stripes, orange first. Like the real thing, stripe i fills between
	 * 1.54*i and 1.54*(i+1) m/s (3 knots a stripe), so the sock is straight from
	 * 7.7 m/s (15 knots), and harder wind only makes it flap harder. It always
	 * streams to the right, into open sky; the arrow by the number gives the
	 * real direction. Each stripe is a nested group - translate to the end of
	 * the one before, then rotate - so the angles add up down the sock.
	 *
	 * Returns, per stripe, the absolute angle (degrees down from horizontal),
	 * the angle relative to the stripe before, how full it is, and its half
	 * widths at either end. `still` drops the gusts and the flutter, which is
	 * the pose the wind alone asks for.                                        */
	var SEG = 5, SL = 2.66;
	var WID = [3.8, 3.4, 3.0, 2.6, 2.25, 1.9];

	function sock(t, v, still) {
		v = Math.max(0, num(v, 0));
		t = num(t, 0);
		var ve = (!still && v > 0.3) ? v * (1 + 0.07 * Math.sin(t * 0.9) + 0.05 * Math.sin(t * 2.3 + 1.3)) : v;
		var fill = clamp(ve / 7.7, 0, 1);
		var over = Math.max(0, ve - 7.7);
		var amp = still ? 0 : (ve < 0.3 ? 0.7 : 1.4 + 4.2 * fill + Math.min(over * 0.7, 5));
		var w = 2 * Math.PI * (0.35 + 0.2 * ve);
		var base = 84 * Math.pow(1 - fill, 1.25) + amp * 0.35 * Math.sin(w * t * 0.5);
		var out = [], prev = 0;
		for (var i = 0; i < SEG; i++) {
			var inf = clamp((ve - 1.54 * i) / 1.54, 0, 1);
			var want = i === 0 ? base : Math.min(88, prev + (1 - inf) * 12);
			var abs = want + amp * (0.35 + 0.22 * i) * Math.sin(w * t - i * 0.95);
			var k = 0.55 + 0.45 * inf;
			out.push({ abs: abs, rel: abs - (i === 0 ? 0 : prev), inf: inf, a: WID[i] * k / 2, b: WID[i + 1] * k / 2 });
			prev = abs;
		}
		return out;
	}

	/* ---------------- cloud layouts ----------------
	 * In sky units, at their starting places. k is the drift speed relative to
	 * the wind. Overcast is three rows - a dim back row of four, a row of four,
	 * and two low ones - spaced so that the rows wrap with no gap.             */
	var LAYOUTS = {
		clear: [],
		few:   [{ x: 16, y: 5, s: 0.6, k: 1 }],
		some:  [{ x: 12, y: 4, s: 0.6, k: 1 }, { x: 62, y: 15, s: 0.46, k: 0.72 }],
		ovc:   [
			{ x: -12, y: -4, s: 0.86, k: 0.55, back: 1 }, { x: 22, y: -2, s: 0.86, k: 0.55, back: 1 },
			{ x: 55, y: -5, s: 0.86, k: 0.55, back: 1 }, { x: 89, y: -3, s: 0.86, k: 0.55, back: 1 },
			{ x: -2, y: 5, s: 0.8, k: 0.8 }, { x: 31, y: 7, s: 0.8, k: 0.8 },
			{ x: 64, y: 4, s: 0.8, k: 0.8 }, { x: 97, y: 6, s: 0.8, k: 0.8 },
			{ x: 14, y: 15, s: 0.5, k: 1.05 }, { x: 60, y: 16, s: 0.5, k: 1.05 }
		]
	};
	var OVC_SPAN = 4 * 33.5;
	/* Partly cloudy: every cloud has a twin one screen-width behind it, so the
	 * next one starts in on the left the moment this one starts out on the right
	 * and there is always a whole cloud's worth on screen - never a stretch of
	 * clear sky with one cloud. Once a cloud is fully off the right edge it takes
	 * its twin's place and the twin drops back a screen. */
	var LANE = 100;

	/* ================================================================== *
	 *  state                                                             *
	 * ================================================================== */

	var el = {};
	var IDS = {
		box: 'sky', svg: 'sky_svg', stars: 'sky_stars', arcRest: 'sky_arc_rest', arcDone: 'sky_arc_done',
		sun: 'sky_sun', rays: 'sky_rays', moon: 'sky_moon', moonLit: 'sky_moon_lit',
		land: 'sky_land', turfFx: 'sky_turf_fx', turfA: 'sky_turf_a', turfB: 'sky_turf_b',
		clouds: 'sky_clouds', halo: 'sky_halo', ring: 'sky_ring', flash: 'sky_flash', bolt: 'sky_bolt', sock: 'sky_sock',
		cl: 'sky_cl', li: 'sky_li', lt: 'sky_lt', cr: 'sky_cr', ri: 'sky_ri', rt: 'sky_rt',
		back: 'sky_back', front: 'sky_front', wrapper: 'wrapper'
	};

	var ready = false, dead = false;
	var data = null, asOf = 0;                /* what weather.js last gave, and how current */
	var curDate = new Date();                 /* the clock, as of the last minute tick */
	var cur = force(bitsOf('', null));        /* the scene in effect, preview included */
	var wind = 0;

	var mode = 'off';                         /* off | still | run */
	var timer = null, lastTs = 0, lastStill = 0;
	var interval = 1000 / FPS_DRY;
	var t = 0, frameNo = 0;                   /* animation time, seconds */
	var shownMin = -1, layoutDirty = true;
	var isDay = true;

	var cloudList = [], builtCover = null, cloudPaint = '';
	var stars = [];
	var sockG = [], sockP = [], sockMouth = null;

	var seed = 7;
	function srnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }
	function rnd() { return Math.random(); }

	/* without data, a preview still needs a sun to walk */
	var FALLBACK_DAY = { rise: 8 * 60, set: 17 * 60, moon: 13 };

	/* ================================================================== *
	 *  faults                                                            *
	 * ================================================================== */

	var faultsAt = [], faultCount = 0, lastFault = '';

	/* The sky's own Guard. Not the cat's: a fault here must not count against
	 * her, and core cannot lean on the cat's machinery anyway. */
	function guard(label, fn) {
		if (dead) return false;
		try { fn(); return true; }
		catch (e) {
			faultCount++;
			lastFault = label + ': ' + (e && e.message ? e.message : e);
			LOG('sky fault ' + faultCount + ' - ' + lastFault);
			var now = Date.now();
			faultsAt.push(now);
			while (faultsAt.length && faultsAt[0] < now - FAULT_WINDOW) faultsAt.shift();
			if (faultsAt.length >= FAULT_LIMIT) die();
			return false;
		}
	}

	/* Stop animating for the session. What is drawn stays drawn, and the
	 * numbers are View's, so the forecast is untouched. */
	function die() {
		dead = true;
		mode = 'off';
		stopLoop();
		try { canvasShow(false); } catch (e) {}
		LOG('sky: ' + FAULT_LIMIT + ' faults in a minute, animation stopped - ' + lastFault);
	}

	/* ================================================================== *
	 *  DOM writes - only when the value changed                          *
	 * ================================================================== */

	function mk(tag, attrs, parent) {
		var e = document.createElementNS(NS, tag);
		for (var k in attrs) if (attrs.hasOwnProperty(k)) e.setAttribute(k, String(attrs[k]));
		if (parent) parent.appendChild(e);
		return e;
	}

	function put(e, k, v) {
		if (!e) return;
		var c = e._sky || (e._sky = {});
		v = String(v);
		if (c[k] === v) return;
		c[k] = v;
		e.setAttribute(k, v);
	}

	function shown(e, on) {
		if (!e) return;
		var v = on ? '' : 'none';
		if (e._skyD === v) return;
		e._skyD = v;
		e.style.display = v;
	}

	function setText(e, v) {
		if (!e || e._skyT === v) return;
		e._skyT = v;
		e.textContent = v;
	}

	function setClass(e, v) {
		if (!e || e._skyC === v) return;
		e._skyC = v;
		e.className = v;
	}

	/* ================================================================== *
	 *  building the svg's moving parts                                   *
	 * ================================================================== */

	function buildStars() {
		if (!el.stars) return;
		seed = 7;                             /* the same sky every night */
		var n = 0, tries = 0;
		while (n < 26 && tries++ < 4000) {
			var x = 6 + srnd() * 88, y = 2 + srnd() * 36;
			var dx = (x - CX) / RX, dy = (y - CY) / RY;
			if (dx * dx + dy * dy > 0.92) continue;          /* inside the arc */
			if (x > 10 && x < 84 && y > 12) continue;        /* not behind the numbers or the sock */
			stars.push({
				el: mk('circle', { cx: fx(x, 2), cy: fx(y, 2), r: fx(0.22 + srnd() * 0.25, 2), fill: '#ffffff' }, el.stars),
				ph: srnd() * 6.28, sp: 0.6 + srnd() * 1.4
			});
			n++;
		}
	}

	function buildRays() {
		if (!el.rays) return;
		for (var i = 0; i < 8; i++) {
			var a = i * Math.PI / 4;
			mk('line', { x1: fx(Math.cos(a) * 5.8, 2), y1: fx(Math.sin(a) * 5.8, 2),
			             x2: fx(Math.cos(a) * 7.4, 2), y2: fx(Math.sin(a) * 7.4, 2) }, el.rays);
		}
	}

	function buildSock() {
		var root = el.sock;
		if (!root) return;
		mk('line', { x1: 0, y1: 0, x2: 0.7, y2: 0, stroke: '#c3c9d2', 'stroke-width': 0.5 }, root);
		var parent = root;
		for (var i = 0; i < SEG; i++) {
			var g = mk('g', {}, parent);
			sockP.push(mk('path', { fill: i % 2 ? '#f3f2ec' : '#ff6a13' }, g));
			if (i === 0) sockMouth = mk('ellipse', { cx: 0, cy: 0, rx: 0.45, ry: 2, fill: '#b9470c', stroke: '#e6e6e1', 'stroke-width': 0.3 }, g);
			sockG.push(g);
			parent = g;
		}
	}

	function buildClouds(cover) {
		var g = el.clouds;
		builtCover = cover;
		cloudPaint = '';
		cloudList = [];
		if (!g) return;
		while (g.firstChild) g.removeChild(g.firstChild);
		var L = LAYOUTS[cover] || [];
		for (var i = 0; i < L.length; i++) {
			var c = L[i];
			cloudList.push({ el: cloudUse(g), twin: cover === 'ovc' ? null : cloudUse(g),
				x: c.x, y: c.y, s: c.s, k: c.k, back: !!c.back, w: 40 * c.s, h: 20 * c.s });
		}
		moveClouds(0);
	}
	function cloudUse(g) {
		var u = mk('use', {}, g);
		try { u.setAttributeNS(XLINK, 'xlink:href', '#sky_cloud'); } catch (e) {}
		u.setAttribute('href', '#sky_cloud');
		return u;
	}

	/* ================================================================== *
	 *  drawing the svg                                                   *
	 * ================================================================== */

	function paintClouds(day) {
		var ovc = builtCover === 'ovc', grey = cur.grey;
		var fill = day ? (grey ? 'skyCloudGrey' : 'skyCloudDay') : (grey ? 'skyCloudNightGrey' : 'skyCloudNight');
		var key = fill + (ovc ? 'o' : '') + cloudList.length;
		if (key === cloudPaint) return;
		cloudPaint = key;
		for (var i = 0; i < cloudList.length; i++) {
			var c = cloudList[i];
			put(c.el, 'fill', 'url(#' + fill + ')');
			put(c.el, 'opacity', ovc ? (c.back ? 0.82 : 0.95) : 0.96);
			if (c.twin) {
				put(c.twin, 'fill', 'url(#' + fill + ')');
				put(c.twin, 'opacity', 0.96);
			}
		}
	}

	/* They drift right, with the sock. Rounded to a tenth of a unit, so a slow
	 * cloud is rewritten a few times a second rather than every frame. */
	function moveClouds(dt) {
		var sp = 0.6 + clamp(wind, 0, 40) * 0.25, ovc = builtCover === 'ovc';
		for (var i = 0; i < cloudList.length; i++) {
			var c = cloudList[i];
			c.x += sp * c.k * dt;
			if (ovc) { if (c.x > 100) c.x -= OVC_SPAN; }
			else if (c.x >= LANE) c.x -= LANE;
			put(c.el, 'transform', 'translate(' + fx(c.x, 1) + ',' + fx(c.y, 1) + ') scale(' + c.s + ')');
			if (c.twin) put(c.twin, 'transform', 'translate(' + fx(c.x - LANE, 1) + ',' + fx(c.y, 1) + ') scale(' + c.s + ')');
		}
	}

	function daysNow() {
		if (data && data.days && data.days.length) return pickDays(data.days, curDate);
		if (pv) return { prev: null, today: FALLBACK_DAY, next: null };
		return { prev: null, today: null, next: null };
	}

	/* The parts that only move with the clock: the arc, the sun or the moon,
	 * the corners. Once a minute, or once a frame while a day is being played. */
	function placeSky(m) {
		var d = daysNow();
		var w = where(m, d);
		var ovc = cur.cover === 'ovc';
		var day;

		if (w) {
			day = w.day;
			var p = onArc(w.f);
			var px = fx(p.x, 2), py = fx(p.y, 2);
			put(el.arcDone, 'd', w.f > 0.002 ? arcPath(0, w.f) : '');
			put(el.arcDone, 'stroke', day ? '#ffd76c' : '#a7bde6');
			put(el.arcDone, 'stroke-opacity', day ? 0.7 : 0.6);
			put(el.arcRest, 'd', w.f < 0.998 ? arcPath(w.f, 1) : '');

			shown(el.cl, true);
			shown(el.cr, true);
			setClass(el.li, 'ci ' + w.left);
			setText(el.lt, clockStr(w.leftM));
			setClass(el.ri, 'ci ' + w.right);
			setText(el.rt, clockStr(w.rightM));

			shown(el.sun, day);
			shown(el.moon, !day);
			var body = day ? el.sun : el.moon;
			put(body, 'transform', 'translate(' + px + ',' + py + ')');
			put(body, 'opacity', ovc ? 0.4 : 1);
			if (!day) put(el.moonLit, 'd', moonPath(4.3, d.today ? d.today.moon : -1));
			else {
				/* a low sun goes orange */
				var low = clamp((0.35 - p.e) / 0.35, 0, 1);
				put(el.rays, 'stroke', low > 0.5 ? '#ff9f3a' : '#ffc93c');
			}

			/* Under overcast the disc is dimmed behind the clouds, and over them a
			 * glow and a dashed outline show where it is - bright enough to find
			 * across the room. */
			shown(el.halo, ovc);
			put(el.halo, 'cx', px);
			put(el.halo, 'cy', py);
			put(el.halo, 'fill', day ? 'url(#skyGHaloSun)' : 'url(#skyGHaloMoon)');
			shown(el.ring, ovc);
			put(el.ring, 'cx', px);
			put(el.ring, 'cy', py);
			put(el.ring, 'stroke', day ? '#ffe08a' : '#f3ecc8');
			put(el.ring, 'stroke-opacity', day ? 1 : 0.92);
		} else {
			/* no sunrise or sunset in the file: the arc, and nothing on it */
			day = !(data && String(data.code || '').indexOf('_n') !== -1);
			put(el.arcDone, 'd', '');
			put(el.arcRest, 'd', arcPath(0, 1));
			shown(el.sun, false);
			shown(el.moon, false);
			shown(el.halo, false);
			shown(el.ring, false);
			shown(el.cl, false);
			shown(el.cr, false);
		}

		isDay = day;
		shown(el.stars, !day && !ovc);
		paintClouds(day);
	}

	function drawSock(tt, still) {
		if (!sockG.length) return;
		var s = sock(tt, wind, still), e = fx(SL + 0.18, 2);
		for (var i = 0; i < SEG; i++) {
			put(sockG[i], 'transform', 'translate(' + (i === 0 ? 0.7 : SL) + ',0) rotate(' + fx(s[i].rel, 1) + ')');
			put(sockP[i], 'd', 'M0,' + fx(-s[i].a, 2) + ' L' + e + ',' + fx(-s[i].b, 2) +
				' L' + e + ',' + fx(s[i].b, 2) + ' L0,' + fx(s[i].a, 2) + 'Z');
			if (i === 0) put(sockMouth, 'ry', fx(s[i].a, 2));
		}
	}

	function twinkle() {
		for (var i = 0; i < stars.length; i++) {
			var s = stars[i];
			put(s.el, 'opacity', fx(0.45 + 0.4 * Math.sin(t * s.sp + s.ph), 1));
		}
	}

	/* ---- a storm: a bolt under one of the low clouds, and a faint flash ---- */
	var nextBolt = 2, boltAge = 99, boltX = 50, boltY = 20, boltOn = false;

	function lightning(dt, on) {
		if (!on) {
			if (boltOn) { put(el.bolt, 'opacity', 0); put(el.flash, 'opacity', 0); boltOn = false; }
			return;
		}
		boltOn = true;
		nextBolt -= dt;
		boltAge += dt;
		if (nextBolt <= 0) {
			var c = cloudList[4 + Math.floor(rnd() * 6)] || cloudList[0];
			if (c) {
				boltX = clamp(c.x + c.w * (0.3 + rnd() * 0.4), 12, 88);
				boltY = c.y + c.h * 0.8;
			}
			boltAge = 0;
			nextBolt = 4 + rnd() * 5;
		}
		var vis = (boltAge < 0.12) || (boltAge > 0.2 && boltAge < 0.28);
		put(el.bolt, 'opacity', vis ? 1 : 0);
		put(el.bolt, 'transform', 'translate(' + fx(boltX, 2) + ',' + fx(boltY, 2) + ')');
		put(el.flash, 'opacity', boltAge < 0.5 ? fx(0.16 * (1 - boltAge / 0.5), 3) : 0);
	}

	/* ================================================================== *
	 *  rain, snow, sleet - the whole screen, down to her floor            *
	 * ================================================================== */

	var cv = null, cf = null, gb = null, gf = null;     /* back/front canvas and context */
	var canvasLive = false;
	var fitDirty = true;

	/* Canvas units are sky units: measured off the svg, not window.innerWidth,
	 * which is wrong on this page. ox/oy is where the svg's origin falls on the
	 * canvas, W/H the canvas in units, U backing pixels per unit. */
	var geo = { ok: false, ux: 1, W: 100, H: 178, ox: 0, oy: 54, left: 0, top: 0, U: 1 };

	var parts = [], splashes = [], drips = [];
	var precKind = 'none', precLevel = 0, builtPrec = 'none0';
	var gSnow = 0, gWet = 0, dripIn = 0.5;
	var canopy = null, floorY = null;
	var shelterFn = null, shelterWarned = false;

	function canvasInit() {
		var b = el.back, f = el.front;
		if (!b || !f || !b.getContext || !f.getContext) return;
		var x = null, y = null;
		try { x = b.getContext('2d'); y = f.getContext('2d'); } catch (e) { x = y = null; }
		if (!x || !y) return;
		cv = b; cf = f; gb = x; gf = y;
	}

	function fit() {
		fitDirty = false;
		geo.ok = false;
		if (!cv || !el.svg || !cv.getBoundingClientRect || !el.svg.getBoundingClientRect) return;
		var r = cv.getBoundingClientRect(), s = el.svg.getBoundingClientRect();
		if (!r || !s || !(r.width > 0) || !(r.height > 0) || !(s.width > 0)) return;
		var ux = s.width / 100;
		var dpr = clamp(num(window.devicePixelRatio, 1), 1, DPR_MAX);
		var bw = Math.max(1, Math.round(r.width * dpr)), bh = Math.max(1, Math.round(r.height * dpr));
		if (cv.width !== bw || cv.height !== bh) { cv.width = bw; cv.height = bh; }
		if (cf.width !== bw || cf.height !== bh) { cf.width = bw; cf.height = bh; }
		geo.ux = ux;
		geo.W = r.width / ux;
		geo.H = r.height / ux;
		geo.ox = (s.left - r.left) / ux;
		geo.oy = (s.top - r.top) / ux;
		geo.left = r.left;
		geo.top = r.top;
		geo.U = bw / geo.W;
		geo.ok = true;
	}

	function canvasShow(on) {
		if (!cv || on === canvasLive) return;
		canvasLive = on;
		if (!on) {
			try { gb.clearRect(0, 0, cv.width, cv.height); gf.clearRect(0, 0, cf.width, cf.height); } catch (e) {}
		}
		cv.style.display = on ? 'block' : 'none';
		cf.style.display = on ? 'block' : 'none';
		if (on) fitDirty = true;              /* a hidden canvas measures 0x0 */
	}

	/* #wrapper hidden outright during an episode means the forecast is not on
	 * screen, so neither is its weather. A class read, not a layout read. */
	function wrapperHidden() {
		var w = el.wrapper;
		return !!(w && (' ' + (w.className || '') + ' ').indexOf(' hidden ') !== -1);
	}

	/* where things land: her floor if the cat side says, else near the bottom */
	function floor() {
		if (typeof floorY === 'number' && floorY === floorY && floorY > geo.oy && floorY < geo.H + 5) return floorY;
		return geo.H - 3;
	}

	/* Ask the cat side where her umbrella is (Sky.shelter). It answers in screen
	 * px - {outline: [[x, y] ... rim end to rim end over the dome], floor: y} or
	 * null - and this turns it into a height map in canvas units. Her fault is
	 * not ours to count: a hook that throws is ignored, and said so once. */
	function readShelter() {
		canopy = null;
		floorY = null;
		if (!shelterFn) return;
		var s = null;
		try { s = shelterFn(); }
		catch (e) {
			if (!shelterWarned) { shelterWarned = true; LOG('sky: the shelter hook threw, ignoring it - ' + (e && e.message ? e.message : e)); }
			s = null;
		}
		if (!s) return;
		if (typeof s.floor === 'number' && s.floor === s.floor) floorY = (s.floor - geo.top) / geo.ux;
		if (s.outline && s.outline.length > 2) canopy = canopyFrom(s.outline);
	}

	/* The top of the canopy as a height map: for each 0.25 unit of x, the
	 * highest point of the closed outline (dome, then the rim back). Plus the
	 * two rim ends, lower one first: that is where the water runs off. */
	function canopyFrom(outline) {
		var pts = [], n = outline.length, i;
		for (i = 0; i < n; i++) {
			var o = outline[i];
			if (!o) return null;
			var px = (o[0] - geo.left) / geo.ux, py = (o[1] - geo.top) / geo.ux;
			if (px !== px || py !== py || !isFinite(px) || !isFinite(py)) return null;
			pts.push([px, py]);
		}
		var x0 = Infinity, x1 = -Infinity;
		for (i = 0; i < n; i++) { if (pts[i][0] < x0) x0 = pts[i][0]; if (pts[i][0] > x1) x1 = pts[i][0]; }
		if (!(x1 > x0) || x1 - x0 > 60) return null;      /* nonsense, not an umbrella */
		var top = [], STEP = 0.25;
		for (var cx = x0; cx <= x1; cx += STEP) {
			var best = Infinity;
			for (i = 0; i < n; i++) {
				var a = pts[i], b = pts[(i + 1) % n];
				if (a[0] === b[0] || (a[0] - cx) * (b[0] - cx) > 0) continue;
				var cy = a[1] + (b[1] - a[1]) * (cx - a[0]) / (b[0] - a[0]);
				if (cy < best) best = cy;
			}
			top.push(best);
		}
		var L = pts[0], R = pts[n - 1];
		return { x0: x0, step: STEP, top: top, low: L[1] > R[1] ? L : R, high: L[1] > R[1] ? R : L };
	}

	function canopyTop(x) {
		if (!canopy) return Infinity;
		var i = Math.round((x - canopy.x0) / canopy.step);
		return (i < 0 || i >= canopy.top.length) ? Infinity : canopy.top[i];
	}

	/* A drop or flake leaves the bottom of a cloud that is on screen, so a
	 * shower falls only under its cloud. */
	function respawn(d) {
		var c = cloudList.length ? cloudList[Math.floor(rnd() * cloudList.length)] : null;
		var xs = [];                                     /* the copies of it that are on screen */
		if (c && c.x > -c.w * 0.6 && c.x < 96) xs.push(c.x);
		if (c && c.twin && c.x - LANE > -c.w * 0.6) xs.push(c.x - LANE);
		if (xs.length) {
			var x = xs[Math.floor(rnd() * xs.length)];
			d.x = geo.ox + x + 5 * c.s + rnd() * (c.w - 10 * c.s);
			d.y = geo.oy + c.y + c.h * 0.82;
		} else {
			d.x = geo.ox + rnd() * 100;
			d.y = geo.oy + 10;
		}
	}

	function buildPrecip(kind, level) {
		parts = [];
		drips = [];
		var n = counts(kind, level), i;
		var len = [1.8, 2.6, 3.4][level];
		for (i = 0; i < n.rain; i++) {
			parts.push({ rain: true, sp: 50 + rnd() * 20, len: len * (0.8 + rnd() * 0.4), a: rnd() < 0.5 ? 0 : 1, x: 0, y: 0 });
		}
		for (i = 0; i < n.snow; i++) {
			var big = rnd() < 0.28;
			parts.push({ rain: false, big: big, front: big && rnd() < 0.6,
				r: big ? 0.9 + rnd() * 0.6 : 0.28 + rnd() * 0.36,
				sp: big ? 6.5 + rnd() * 2.5 : 3.2 + rnd() * 3.2,
				ph: rnd() * 6.28, sw: 0.7 + rnd() * 1.0, rot: rnd() * 1.05, rs: (rnd() - 0.5) * 1.2, x: 0, y: 0 });
		}
		var fl = floor();
		for (i = 0; i < parts.length; i++) {      /* already on their way down */
			respawn(parts[i]);
			parts[i].y += rnd() * Math.max(0, fl - parts[i].y);
		}
		precKind = kind;
		precLevel = level;
		builtPrec = kind + level;
	}

	/* Rebuild the particles when what falls, or how hard, has changed. */
	function ensurePrecip() {
		var key = cur.precip + cur.level;
		if (key === builtPrec) return;
		if (cur.precip === 'none') {
			parts = []; drips = [];
			precKind = 'none'; precLevel = 0; builtPrec = key;
			return;
		}
		canvasShow(true);
		if (fitDirty || !geo.ok) fit();
		if (!geo.ok) return;                  /* try again next frame */
		buildPrecip(cur.precip, cur.level);
		LOG('sky: ' + cur.precip + ' level ' + cur.level + ', ' + parts.length + ' particles');
	}

	/* The ground catches up with the weather: snow lies deeper the harder it
	 * snows, grows slowly and melts after; puddles come and go. */
	function ground(gdt) {
		var snowing = precKind === 'snow' || precKind === 'sleet';
		var target = snowing ? [1.2, 2.0, 2.8][precLevel] * (precKind === 'sleet' ? 0.45 : 1) : 0;
		if (gSnow < target) gSnow = Math.min(target, gSnow + 0.08 * gdt);
		else gSnow = Math.max(target, gSnow - 0.15 * gdt);
		var wet = (precKind === 'rain' || precKind === 'sleet') ? 1 : 0;
		gWet += clamp(wet - gWet, -0.08 * gdt, 0.3 * gdt);
	}

	function splash(x, y, onUmbrella) {
		if (splashes.length > 48) splashes.shift();
		splashes.push({ x: x, y: y, age: 0, um: onUmbrella, dir: rnd() < 0.5 ? -1 : 1 });
	}

	/* on the floor a ring and two droplets; on the umbrella just the droplets */
	function drawSplash(ctx, s, U) {
		var k = clamp(s.age / 0.42, 0, 1), h = (s.um ? 2.4 : 3.6) * k * (1 - k);
		ctx.globalAlpha = 0.85 * (1 - k);
		if (!s.um) {
			ctx.strokeStyle = '#9cc4ff';
			ctx.lineWidth = 0.2 * U;
			ctx.beginPath();
			ctx.ellipse(s.x * U, s.y * U, (0.3 + 1.5 * k) * U, (0.12 + 0.3 * k) * U, 0, 0, TAU);
			ctx.stroke();
		}
		ctx.fillStyle = '#a9ccff';
		ctx.beginPath();
		ctx.arc((s.x - 1.2 * k * s.dir) * U, (s.y - h) * U, 0.2 * U, 0, TAU);
		ctx.fill();
		ctx.beginPath();
		ctx.arc((s.x + 1.0 * k * s.dir) * U, (s.y - h * 0.75) * U, 0.16 * U, 0, TAU);
		ctx.fill();
		ctx.globalAlpha = 1;
	}

	var PUDDLES = [[9, 4], [23, 3], [37, 3.6], [64, 4.2], [79, 3], [92, 3.6]];

	function drawFloor(fl) {
		var U = geo.U, kx = geo.W / 100, i;
		if (gWet > 0.01) {
			gb.fillStyle = '#5d8fe0';
			for (i = 0; i < PUDDLES.length; i++) {
				gb.globalAlpha = gWet * (0.28 + 0.08 * Math.sin(t * 2.2 + i * 1.7));
				gb.beginPath();
				gb.ellipse(PUDDLES[i][0] * kx * U, (fl + 0.6) * U, PUDDLES[i][1] * U, 0.65 * U, 0, 0, TAU);
				gb.fill();
			}
			gb.globalAlpha = 1;
		}
		if (gSnow > 0.03) {
			gb.fillStyle = 'rgba(238,244,255,0.94)';
			gb.beginPath();
			gb.moveTo(0, geo.H * U);
			for (var x = 0; x <= geo.W + 2; x += 2) {
				var y = fl + 1 - gSnow * (0.72 + 0.28 * Math.sin(x * 0.55) * Math.sin(x * 0.21 + 1));
				gb.lineTo(x * U, y * U);
			}
			gb.lineTo((geo.W + 2) * U, geo.H * U);
			gb.closePath();
			gb.fill();
		}
	}

	function streaks(list, colour, lw, lean, U) {
		if (!list.length) return;
		gb.strokeStyle = colour;
		gb.lineWidth = lw;
		gb.beginPath();
		for (var j = 0; j < list.length; j++) {
			var q = list[j];
			gb.moveTo(q.x * U, q.y * U);
			gb.lineTo((q.x - lean * q.len) * U, (q.y - q.len) * U);
		}
		gb.stroke();
	}

	function crystals(ctx, list, U) {
		if (!list.length) return;
		ctx.strokeStyle = 'rgba(244,248,255,0.95)';
		ctx.lineWidth = 0.22 * U;
		ctx.lineCap = 'round';
		ctx.beginPath();
		for (var j = 0; j < list.length; j++) {
			var q = list[j];
			for (var a = 0; a < 3; a++) {
				var an = q.rot + a * Math.PI / 3, dx = Math.cos(an) * q.r, dy = Math.sin(an) * q.r;
				ctx.moveTo((q.x - dx) * U, (q.y - dy) * U);
				ctx.lineTo((q.x + dx) * U, (q.y + dy) * U);
			}
		}
		ctx.stroke();
	}

	/* One frame of everything that falls. adt moves the particles (0 for a
	 * still frame); gdt moves the ground (a still frame catches up a minute). */
	function precipFrame(adt, gdt) {
		if (!cv) return;
		ensurePrecip();
		ground(gdt);
		var active = parts.length || splashes.length || drips.length || gWet > 0.01 || gSnow > 0.03;
		if (!active || wrapperHidden()) { canvasShow(false); return; }
		canvasShow(true);
		if (fitDirty || !geo.ok) fit();
		if (!geo.ok) return;
		readShelter();

		var U = geo.U, W = geo.W, i, p;
		var fl = floor();
		var v = clamp(wind, 0, 40);
		gb.clearRect(0, 0, cv.width, cv.height);
		gf.clearRect(0, 0, cf.width, cf.height);
		drawFloor(fl);

		var lean = Math.min(v, 14) * 0.045;
		var land = fl + 1 - gSnow * 0.85;
		var rainA = [], rainB = [], dots = [], bigB = [], bigF = [];
		for (i = 0; i < parts.length; i++) {
			p = parts[i];
			p.y += p.sp * adt;
			if (p.rain) {
				p.x += lean * p.sp * adt;
				var top = canopyTop(p.x);
				if (p.y >= top) {
					if (adt > 0 && rnd() < 0.7) splash(p.x, top, true);
					respawn(p);
				} else if (p.y >= fl) {
					if (adt > 0 && rnd() < 0.5) splash(p.x, fl + 0.4, false);
					respawn(p);
				}
				(p.a ? rainA : rainB).push(p);
			} else {
				p.x += (v * 0.35 + p.sw * Math.cos(t * 1.4 * p.sw + p.ph)) * adt;
				if (p.x > W + 4) p.x -= W + 8;
				if (p.x < -4) p.x += W + 8;
				p.rot += p.rs * adt;
				if (p.y >= canopyTop(p.x) || p.y >= (p.front ? land + 1.5 : land)) respawn(p);
				if (!p.big) dots.push(p);
				else (p.front ? bigF : bigB).push(p);
			}
		}

		/* water runs off the umbrella's lower rim end, now and then off the other */
		if (canopy && (precKind === 'rain' || precKind === 'sleet') && adt > 0) {
			dripIn -= adt;
			if (dripIn <= 0) {
				var edge = rnd() < 0.8 ? canopy.low : canopy.high;
				drips.push({ x: edge[0], y: edge[1] + 0.3, v: 4 });
				dripIn = [0.9, 0.5, 0.28][precLevel] * (0.6 + rnd() * 0.8);
			}
		}
		for (i = drips.length - 1; i >= 0; i--) {
			var d = drips[i];
			d.v += 140 * adt;
			d.y += d.v * adt;
			if (d.y >= fl) { splash(d.x, fl + 0.4, false); drips.splice(i, 1); }
		}

		/* rain in two shades, one stroke each */
		gb.lineCap = 'round';
		var lw = [0.26, 0.32, 0.4][precLevel] * U;
		streaks(rainA, 'rgba(138,184,255,0.85)', lw, lean, U);
		streaks(rainB, 'rgba(138,184,255,0.55)', lw, lean, U);
		if (drips.length) {
			gb.fillStyle = 'rgba(156,196,255,0.9)';
			for (i = 0; i < drips.length; i++) {
				gb.beginPath();
				gb.ellipse(drips[i].x * U, drips[i].y * U, 0.28 * U, 0.5 * U, 0, 0, TAU);
				gb.fill();
			}
		}
		/* snow: small round flakes behind, six-pointed ones behind and in front of her */
		if (dots.length) {
			gb.fillStyle = 'rgba(242,246,255,0.85)';
			gb.beginPath();
			for (i = 0; i < dots.length; i++) {
				gb.moveTo((dots[i].x + dots[i].r) * U, dots[i].y * U);
				gb.arc(dots[i].x * U, dots[i].y * U, dots[i].r * U, 0, TAU);
			}
			gb.fill();
		}
		crystals(gb, bigB, U);
		crystals(gf, bigF, U);

		for (i = splashes.length - 1; i >= 0; i--) {
			var s = splashes[i];
			s.age += adt;
			if (s.age >= 0.42) { splashes.splice(i, 1); continue; }
			drawSplash(s.um ? gf : gb, s, U);
		}
	}

	/* ================================================================== *
	 *  the scene in effect, and the preview                              *
	 * ================================================================== */

	/* A preview is the test menu's: a sky to look at on the phone when the
	 * weather will not oblige. It changes the picture only - never the numbers,
	 * which are View's - and ends by itself, so a shelf display can never be
	 * left showing a sky that is not there.
	 *
	 *   cover    clear | few | some | ovc      (a cover button also stops anything falling)
	 *   precip   none | rain | snow | sleet | storm, with level 0..2
	 *   wind     m/s for the sock and the drift
	 *   time     flip (twelve hours on) | play (an hour a second)              */
	var pv = null, pvTimer = null;

	var PREVIEWS = [
		['real', 'Real weather'],
		['clear', 'Clear'], ['few', '1 cloud'], ['some', '2 clouds'], ['ovc', 'Overcast'],
		['-ra', 'Light rain'], ['ra', 'Rain'], ['+ra', 'Heavy rain'],
		['-sn', 'Light snow'], ['sn', 'Snow'], ['+sn', 'Heavy snow'],
		['ra_sn', 'Sleet'], ['ts', 'Storm'],
		['w0', 'Wind 0'], ['w4', 'Wind 4 m/s'], ['w10', 'Wind 10 m/s'],
		['flip', 'Day / night'], ['play', 'Play a day'],
		['frost', 'Frost -8°'], ['heat', 'Heat +28°']
	];

	var FALLS = {
		'-ra': ['rain', 0], 'ra': ['rain', 1], '+ra': ['rain', 2],
		'-sn': ['snow', 0], 'sn': ['snow', 1], '+sn': ['snow', 2],
		'ra_sn': ['sleet', 1], 'ts': ['storm', 2]
	};

	function realMinutes() { return curDate.getHours() * 60 + curDate.getMinutes(); }

	function minutes() {
		var m = realMinutes();
		if (pv && pv.time === 'flip') m = (m + 720) % 1440;
		else if (pv && pv.time === 'play') m = ((pv.playFrom + (t - pv.playT) * 60) % 1440 + 1440) % 1440;
		return m;
	}

	function hasData() {
		return !!(data && asOf && (Date.now() - asOf) <= expire * 1000);
	}

	function applyScene() {
		var raw = data ? bitsOf(data.code, data.cloudness) : bitsOf('', null);
		if (pv) {
			if (pv.cover) raw.cover = pv.cover;
			if (pv.precip === 'storm') { raw.precip = 'rain'; raw.level = 2; raw.storm = true; }
			else if (pv.precip) { raw.precip = pv.precip; raw.level = pv.level; raw.storm = false; }
		}
		cur = force(raw);
		wind = (pv && pv.wind !== null) ? pv.wind : (data ? clamp(num(data.wind, 0), 0, 60) : 0);
		if (ready && cur.cover !== builtCover) buildClouds(cur.cover);
		cloudPaint = '';
		interval = 1000 / ((cur.precip !== 'none' || cur.storm) ? FPS_WET : FPS_DRY);
	}

	function preview(key) {
		var ok = false;
		guard('preview', function () {
			if (key === 'real') { endPreview('asked'); ok = true; return; }
			var p = pv || { cover: null, precip: null, level: 1, wind: null, time: null, playFrom: 0, playT: 0, temp: null };
			if (key === 'clear' || key === 'few' || key === 'some' || key === 'ovc') {
				p.cover = key;
				p.precip = 'none';
			} else if (FALLS.hasOwnProperty(key)) {
				p.precip = FALLS[key][0];
				p.level = FALLS[key][1];
			} else if (key === 'w0' || key === 'w4' || key === 'w10') {
				p.wind = Number(key.slice(1));
			} else if (key === 'flip') {
				p.time = p.time === 'flip' ? null : 'flip';
			} else if (key === 'play') {
				if (p.time === 'play') p.time = null;
				else { p.time = 'play'; p.playFrom = realMinutes(); p.playT = t; }
			} else if (key === 'frost' || key === 'heat') {
				p.temp = key === 'frost' ? -8 : 28;  /* the turf only; the numbers stay real */
			} else {
				return;
			}
			if (!pv) waterSaved = gWater;           /* the real level, back when it ends */
			p.key = key;
			p.until = Date.now() + PREVIEW_MS;
			pv = p;
			if (pvTimer) clearTimeout(pvTimer);
			pvTimer = setTimeout(function () { guard('preview-end', function () { endPreview('ten minutes'); }); }, PREVIEW_MS + 100);
			LOG('sky: preview ' + key + ' (back to the real weather in 10 min)');
			ok = true;
			refresh();
		});
		return ok;
	}

	function endPreview(why) {
		if (pvTimer) { clearTimeout(pvTimer); pvTimer = null; }
		if (!pv) return;
		pv = null;
		if (waterSaved !== null) { gWater = waterSaved; waterSaved = null; }
		turfKey = '';
		LOG('sky: preview over (' + why + '), real weather');
		refresh();
	}

	/* A preview with no forecast in hand still shows its sky; the numbers stay
	 * hidden, because there are none. */
	function forceBox() {
		if (!el.box) return;
		if (pv && !hasData()) addClass(el.box, 'sky_force');
		else removeClass(el.box, 'sky_force');
	}

	/* ================================================================== *
	 *  the loop                                                          *
	 * ================================================================== */

	function nowMs() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

	function quietNow() {
		if (typeof cat_quiet_from === 'undefined' || typeof cat_quiet_to === 'undefined') return false;
		return inClockWindow(curDate, cat_quiet_from, cat_quiet_to, false);
	}

	/* off    nothing to show, the page is hidden, or the sky is dead
	 * still  the quiet hours: one frame a minute (a preview overrides them)
	 * run    the timer loop                                                    */
	function wantMode() {
		if (!ready || dead) return 'off';
		if (!hasData() && !pv) return 'off';
		if (document.hidden) return 'off';
		if (!pv && quietNow()) return 'still';
		return 'run';
	}

	/* `redraw`: the still frame is stale (new data, a new minute) - draw it again
	 * even if the mode has not changed. */
	function sync(redraw) {
		var m = wantMode();
		if (m !== mode) LOG('sky: ' + mode + ' -> ' + m + (m === 'run' ? ' at ' + Math.round(1000 / interval) + ' fps' : ''));
		var was = mode;
		mode = m;
		if (m === 'run') { lastStill = 0; startLoop(); return; }
		stopLoop();
		if (m === 'still') { if (was !== 'still' || redraw) still(was !== 'still'); return; }
		canvasShow(false);
		lastStill = 0;
	}

	function startLoop() {
		if (timer) return;
		lastTs = 0;
		arm(0);
	}

	function stopLoop() {
		if (timer) { clearTimeout(timer); timer = null; }
	}

	function arm(ms) {
		if (timer) clearTimeout(timer);
		timer = setTimeout(frame, ms < 0 ? 0 : ms);
	}

	function frame() {
		timer = null;
		if (mode !== 'run' || dead) return;
		var ts = nowMs();
		var dt = lastTs ? Math.min(0.25, (ts - lastTs) / 1000) : 0;
		lastTs = ts;
		guard('frame', function () { step(dt); });
		if (mode === 'run' && !dead && !timer) {
			var wait = interval - (nowMs() - ts);
			arm(wait < MIN_GAP ? MIN_GAP : wait);
		}
	}

	/* ================================================================== *
	 *  the turf under the windsock                                       *
	 * ================================================================== *
	 * A flat strip of grass with a thin edge of soil and a concrete footing for
	 * the mast. It follows the weather. By temperature (the thresholds of her
	 * wardrobe): frozen at 0 and below, muted when cool, green when mild, lush
	 * with a few flowers when hot. Rain floods it: the water rises over ~10 min,
	 * rings spread where drops land, and once it is deep it runs off both ends
	 * into puddles either side; it drains over about an hour after. Below 0 the
	 * water is a sheet of ice. Lying snow caps it. Darker at night.
	 * The shape is rebuilt only when what it shows changes - a few times an hour
	 * in real weather; only the rings, the run-off and the frost glints move.
	 * A preview fills and drains in seconds, and the real level comes back when
	 * it ends.                                                                */
	var TURF = { x0: 39, x1: 61, h: 1.25, soil: 1.3 };
	var TURF_TOP = 43.3 - TURF.h;
	var GRASS = {                             /* top, bottom, blades */
		frozen: ['#dcecf4', '#7f9fb0', '#f4fbff'],
		cool:   ['#93a96b', '#4b5e34', '#b3c88a'],
		mild:   ['#7fbf5c', '#3d6d2d', '#a6dc84'],
		hot:    ['#8fe05a', '#3a8a26', '#b8f08c']
	};
	var FILL_REAL = [1 / 900, 1 / 600, 1 / 360], DRAIN_REAL = 1 / 3600;   /* per second, by strength */
	var FILL_PV = [1 / 14, 1 / 9, 1 / 6], DRAIN_PV = 1 / 30;
	var gWater = 0, waterSeeded = false, waterSaved = null;
	var turfKey = '', pool = null, turfSides = [], ripples = [], ripIn = 0;
	var trickL = null, trickR = null, sparks = [];

	function turfU(x) { return (x - 50) / ((TURF.x1 - TURF.x0) / 2); }
	function turfTop(x) {
		var u = turfU(x);
		if (u <= -1 || u >= 1) return 43.3;
		return 43.3 - TURF.h * Math.sqrt(1 - Math.pow(Math.abs(u), 6));
	}
	function grassState(tc) { return tc <= 0 ? 'frozen' : (tc < 10 ? 'cool' : (tc < 23 ? 'mild' : 'hot')); }
	function groundTemp() {
		if (pv && typeof pv.temp === 'number') return pv.temp;
		return (data && typeof data.temp === 'number' && isFinite(data.temp)) ? data.temp : 10;
	}
	function dim(hex, k) {
		var n = parseInt(hex.slice(1), 16);
		return 'rgb(' + Math.round(((n >> 16) & 255) * k) + ',' + Math.round(((n >> 8) & 255) * k) + ',' + Math.round((n & 255) * k) + ')';
	}
	function waterSpan() {                    /* the pool widens and deepens as it fills */
		var half = 6 + 3.8 * gWater;
		return { xa: 50 - half, xb: 50 + half, ys: TURF_TOP - (0.3 + 1.25 * gWater) };
	}

	function buildTurf() {
		var g = el.turfFx;
		if (!g) return;
		for (var i = 0; i < 12; i++) {
			ripples.push({ el: mk('ellipse', { rx: 0.1, ry: 0.05, fill: 'none', stroke: '#d8ecff', 'stroke-width': 0.16, opacity: 0 }, g),
				age: 1, on: false, x: 50, y: 42 });
		}
		var trick = { fill: 'none', stroke: '#7fb2f0', 'stroke-width': 0.3, 'stroke-linecap': 'round', 'stroke-dasharray': '0.5 0.45', opacity: 0 };
		trickL = mk('path', trick, g);
		trickR = mk('path', trick, g);
		var SP = [41.6, 45.3, 52.8, 57.9];
		for (var j = 0; j < SP.length; j++) {
			sparks.push({ el: mk('circle', { cx: SP[j], cy: fx(turfTop(SP[j]) - 0.2, 2), r: 0.2, fill: '#ffffff', opacity: 0 }, g), ph: j * 1.9 });
		}
	}

	function drawTurf(day) {
		var g = el.land;
		if (!g) return;
		var st = grassState(groundTemp()), frozen = st === 'frozen';
		var snowCap = Math.min(1.1, gSnow * 0.45);
		var key = st + (day ? 'd' : 'n') + Math.round(snowCap * 20) + '/' + Math.round(gWater * 20) + (gWet > 0.3 ? 'w' : '');
		if (key === turfKey) return;
		turfKey = key;
		var K = day ? 1 : 0.45, C = GRASS[st];
		put(el.turfA, 'stop-color', dim(C[0], K));
		put(el.turfB, 'stop-color', dim(C[1], K));

		while (g.firstChild) g.removeChild(g.firstChild);
		var x, i, d, u, pts = [];
		for (x = TURF.x0; x <= TURF.x1 + 0.001; x += 0.5) pts.push([x, turfTop(x)]);

		/* a thin edge of soil under the horizon */
		d = 'M' + (TURF.x0 + 0.4) + ',43.2';
		for (x = TURF.x0 + 0.4; x <= TURF.x1 - 0.4 + 0.001; x += 0.5) {
			u = turfU(x);
			d += ' L' + fx(x, 2) + ',' + fx(43.2 + TURF.soil * Math.sqrt(Math.max(0, 1 - Math.pow(Math.abs(u), 6))), 2);
		}
		mk('path', { d: d + ' L' + (TURF.x1 - 0.4) + ',43.2 Z', fill: day ? 'url(#skyGSoilDay)' : 'url(#skyGSoilNight)' }, g);

		/* the grass, a little darker when soaked */
		d = 'M' + pts[0][0] + ',43.4';
		for (i = 0; i < pts.length; i++) d += ' L' + fx(pts[i][0], 2) + ',' + fx(pts[i][1], 2);
		d += ' L' + pts[pts.length - 1][0] + ',43.4 Z';
		mk('path', { d: d, fill: 'url(#skyGTurf)' }, g);
		if (gWet > 0.3 && !frozen) mk('path', { d: d, fill: '#0a1a10', opacity: 0.18 }, g);

		/* water on top - a flat surface, rounded where it meets the grass - and
		 * the overflow lying on the ground either side; ice below 0 */
		pool = null;
		turfSides = [];
		if (gWater > 0.03) {
			var w = waterSpan();
			var wet = frozen ? (day ? '#d6ecfa' : '#6f8796') : (day ? '#4a8ae0' : '#2c548c');
			var shine = frozen ? '#ffffff' : (day ? '#cfe6ff' : '#8fb0d8');
			d = 'M' + fx(w.xa, 2) + ',' + fx(turfTop(w.xa), 2) +
				' Q' + fx(w.xa + 0.5, 2) + ',' + fx(w.ys, 2) + ' ' + fx(w.xa + 1.4, 2) + ',' + fx(w.ys, 2) +
				' L' + fx(w.xb - 1.4, 2) + ',' + fx(w.ys, 2) +
				' Q' + fx(w.xb - 0.5, 2) + ',' + fx(w.ys, 2) + ' ' + fx(w.xb, 2) + ',' + fx(turfTop(w.xb), 2);
			for (x = w.xb; x >= w.xa - 0.001; x -= 0.5) d += ' L' + fx(x, 2) + ',' + fx(turfTop(x) + 0.05, 2);
			mk('path', { d: d + ' Z', fill: wet, opacity: frozen ? 0.92 : 0.88 }, g);
			if (frozen) {
				mk('path', { d: 'M' + fx(w.xa + 2, 2) + ',' + fx(w.ys + 0.15, 2) + ' L' + fx(w.xa + 6, 2) + ',' + fx(w.ys + 0.15, 2) +
					' M' + fx(w.xb - 5, 2) + ',' + fx(w.ys + 0.25, 2) + ' l2,0', stroke: '#ffffff', 'stroke-width': 0.2,
					'stroke-linecap': 'round', opacity: day ? 0.9 : 0.5 }, g);
				mk('path', { d: 'M' + fx(w.xa + 7, 2) + ',' + fx(w.ys + 0.1, 2) + ' l0.8,0.35 l0.9,-0.2 l0.7,0.4',
					stroke: day ? '#9fc3d8' : '#4d6372', 'stroke-width': 0.12, fill: 'none' }, g);
			} else {
				mk('line', { x1: fx(w.xa + 1.6, 2), y1: fx(w.ys + 0.12, 2), x2: fx(w.xb - 1.6, 2), y2: fx(w.ys + 0.12, 2),
					stroke: shine, 'stroke-width': 0.2, 'stroke-linecap': 'round', opacity: 0.8 }, g);
				pool = w;
			}
			var spread = 11 * clamp((gWater - 0.4) / 0.6, 0, 1);
			if (spread > 0.3) {
				var edges = [[TURF.x0 + 1.2 - spread, TURF.x0 + 1.2], [TURF.x1 - 1.2, TURF.x1 - 1.2 + spread]];
				for (i = 0; i < 2; i++) {
					var cx = (edges[i][0] + edges[i][1]) / 2, rx = (edges[i][1] - edges[i][0]) / 2 + 0.4;
					mk('ellipse', { cx: fx(cx, 2), cy: 43.1, rx: fx(rx, 2), ry: 0.5, fill: wet, opacity: frozen ? 0.9 : 0.85 }, g);
					mk('line', { x1: fx(cx - rx * 0.7, 2), y1: 42.78, x2: fx(cx + rx * 0.7, 2), y2: 42.78, stroke: shine,
						'stroke-width': 0.16, 'stroke-linecap': 'round', opacity: 0.7 }, g);
					if (!frozen) turfSides.push({ xa: cx - rx * 0.8, xb: cx + rx * 0.8, y: 42.85 });
				}
			}
		}

		/* blades - stiff and white when frozen, short and dull when cool, tall
		 * when hot - standing up out of the water; gone under snow */
		if (snowCap < 0.5) {
			var TUFTS = [-0.86, -0.62, -0.38, -0.14, 0.14, 0.38, 0.62, 0.86], blades = '';
			var tall = st === 'hot' ? 1.55 : (st === 'cool' ? 0.85 : (frozen ? 0.95 : 1.15));
			var lean = frozen ? 0.12 : 0.38;
			for (i = 0; i < TUFTS.length; i++) {
				x = 50 + TUFTS[i] * (TURF.x1 - TURF.x0) / 2;
				if (Math.abs(x - 50) < 1.8) continue;               /* the footing is there */
				var y = turfTop(x) + 0.15;
				blades += 'M' + fx(x - 0.25, 2) + ',' + fx(y, 2) + ' l' + fx(-lean, 2) + ',' + fx(-tall * 0.75, 2) +
					' M' + fx(x, 2) + ',' + fx(y, 2) + ' l0,' + fx(-tall, 2) +
					' M' + fx(x + 0.25, 2) + ',' + fx(y, 2) + ' l' + fx(lean, 2) + ',' + fx(-tall * 0.7, 2) + ' ';
			}
			mk('path', { d: blades, stroke: dim(C[2], day ? 1 : 0.55), 'stroke-width': frozen ? 0.2 : 0.24, 'stroke-linecap': 'round', fill: 'none' }, g);
			if (st === 'hot') {
				var FL = [[42.6, '#ffe066'], [47.1, '#ffffff'], [55.4, '#ffe066'], [58.6, '#ffffff']];
				for (i = 0; i < FL.length; i++) {
					var fy = fx(turfTop(FL[i][0]) - 1.0, 2);
					mk('circle', { cx: FL[i][0], cy: fy, r: 0.55, fill: dim(FL[i][1], day ? 1 : 0.5) }, g);
					mk('circle', { cx: FL[i][0], cy: fy, r: 0.2, fill: day ? '#f29b2a' : '#7a4e15' }, g);
				}
			}
		}

		/* a white cap while snow lies */
		if (snowCap > 0.04) {
			d = '';
			for (i = 0; i < pts.length; i++) {
				u = turfU(pts[i][0]);
				d += (i ? ' L' : 'M') + fx(pts[i][0], 2) + ',' + fx(pts[i][1] - snowCap * (0.55 + 0.45 * (1 - u * u)), 2);
			}
			for (i = pts.length - 1; i >= 0; i--) d += ' L' + fx(pts[i][0], 2) + ',' + fx(pts[i][1] + 0.25, 2);
			mk('path', { d: d + ' Z', fill: '#eef4ff' }, g);
		}

		/* the mast's concrete footing, on the water or the snow if there is any */
		var ty = Math.min(turfTop(50), gWater > 0.03 ? waterSpan().ys + 0.3 : 99) - snowCap * 0.6;
		mk('rect', { x: 48.7, y: fx(ty - 0.9, 2), width: 2.6, height: 1.1, rx: 0.25, fill: day ? '#aab0b8' : '#5d636b' }, g);
	}

	/* The water level follows the rain. A preview fills and drains in seconds;
	 * the first real data after a start finds it already wet if it is raining. */
	function water(gdt) {
		var raining = cur.precip === 'rain' || cur.precip === 'sleet';
		if (!pv && !waterSeeded && hasData()) {
			waterSeeded = true;
			if (raining) gWater = 0.7;
		}
		var lvl = clamp(num(cur.level, 1), 0, 2);
		if (raining) gWater = Math.min(1, gWater + (pv ? FILL_PV : FILL_REAL)[lvl] * gdt);
		else gWater = Math.max(0, gWater - (pv ? DRAIN_PV : DRAIN_REAL) * gdt);
		return raining;
	}

	/* every frame (run) or once a minute (still): the level, then what moves */
	function turfFrame(adt, gdt, run) {
		if (!el.land) return;
		var raining = water(gdt);
		drawTurf(isDay);
		var frozen = grassState(groundTemp()) === 'frozen';
		var i, q;

		/* rings where drops land, on the strip or a puddle, by width */
		if (run && pool && raining && adt > 0) {
			ripIn -= adt;
			if (ripIn <= 0) {
				var r = ripples[0];
				for (i = 1; i < ripples.length; i++) if (ripples[i].age > r.age) r = ripples[i];
				var surf = [{ xa: pool.xa + 1.6, xb: pool.xb - 1.6, y: pool.ys + 0.12 }].concat(turfSides), tot = 0, m;
				for (m = 0; m < surf.length; m++) tot += surf[m].xb - surf[m].xa;
				var pick = rnd() * tot;
				for (m = 0; m < surf.length - 1 && pick > surf[m].xb - surf[m].xa; m++) pick -= surf[m].xb - surf[m].xa;
				r.age = 0;
				r.x = surf[m].xa + rnd() * (surf[m].xb - surf[m].xa);
				r.y = surf[m].y;
				ripIn = (1 / [3, 7, 14][clamp(num(cur.level, 1), 0, 2)]) * (0.5 + rnd());
			}
		}
		for (i = 0; i < ripples.length; i++) {
			q = ripples[i];
			if (!run || q.age >= 0.7) {
				if (q.on) { put(q.el, 'opacity', 0); q.on = false; }
				q.age = Math.max(q.age, 0.7);
				continue;
			}
			q.age += adt;
			var k = clamp(q.age / 0.7, 0, 1);
			q.on = true;
			put(q.el, 'cx', fx(q.x, 2));
			put(q.el, 'cy', fx(q.y, 2));
			put(q.el, 'rx', fx(0.2 + 1.6 * k, 2));
			put(q.el, 'ry', fx(0.05 + 0.3 * k, 2));
			put(q.el, 'opacity', fx(0.85 * (1 - k), 2));
		}

		/* deep water runs off both ends */
		var flow = pool && gWater > 0.45 ? clamp((gWater - 0.45) / 0.3, 0, 1) : 0;
		if (flow > 0) {
			put(trickL, 'd', 'M' + fx(pool.xa + 0.3, 2) + ',' + fx(turfTop(pool.xa) - 0.1, 2) + ' Q' + fx(pool.xa - 0.6, 2) + ',' +
				fx(turfTop(pool.xa) + 0.2, 2) + ' ' + fx(pool.xa - 0.9, 2) + ',43.6');
			put(trickR, 'd', 'M' + fx(pool.xb - 0.3, 2) + ',' + fx(turfTop(pool.xb) - 0.1, 2) + ' Q' + fx(pool.xb + 0.6, 2) + ',' +
				fx(turfTop(pool.xb) + 0.2, 2) + ' ' + fx(pool.xb + 0.9, 2) + ',43.6');
			if (run) {
				put(trickL, 'stroke-dashoffset', fx(-t * 2.5, 1));
				put(trickR, 'stroke-dashoffset', fx(-t * 2.5, 1));
			}
		}
		put(trickL, 'opacity', fx(0.85 * flow, 2));
		put(trickR, 'opacity', fx(0.85 * flow, 2));

		/* frost glints on frozen grass, a slow twinkle that needs few writes */
		var glint = frozen && gSnow * 0.45 < 0.5;
		if (!run || frameNo % 3 === 0) {
			for (i = 0; i < sparks.length; i++) {
				var o = glint && run ? Math.max(0, Math.sin(t * 1.7 + sparks[i].ph)) * (isDay ? 0.95 : 0.6) : (glint ? 0.5 : 0);
				put(sparks[i].el, 'opacity', fx(o, 2));
			}
		}
	}

	function step(dt) {
		t += dt;
		frameNo++;
		var m = minutes();
		if (layoutDirty || Math.floor(m) !== shownMin) {
			placeSky(m);
			shownMin = Math.floor(m);
			layoutDirty = false;
		}
		moveClouds(dt);
		drawSock(t, false);
		if (isDay) put(el.rays, 'transform', 'rotate(' + Math.round((t * 6) % 360) + ')');
		else if (frameNo % 3 === 0) twinkle();      /* a slow twinkle needs few writes */
		lightning(dt, cur.storm);
		precipFrame(dt, dt);
		turfFrame(dt, dt, true);
	}

	/* The quiet-hours frame: the sky as it is now, nothing moving. The ground
	 * still catches up, a minute at a time, so snow settles overnight. */
	function still(entering) {
		var nowT = Date.now();
		var gdt = (lastStill && !entering) ? Math.min(60, (nowT - lastStill) / 1000) : 0;
		lastStill = nowT;
		var m = minutes();
		placeSky(m);
		shownMin = Math.floor(m);
		layoutDirty = false;
		moveClouds(0);
		drawSock(t, false);
		if (!isDay) twinkle();
		lightning(0, false);
		precipFrame(0, gdt);
		turfFrame(0, gdt, false);
	}

	/* everything the scene or the data decides, then the loop */
	function refresh() {
		if (!ready || dead) return;
		applyScene();
		layoutDirty = true;
		forceBox();
		sync(true);
	}

	/* ================================================================== *
	 *  the way in                                                        *
	 * ================================================================== */

	function init() {
		guard('init', function () {
			for (var k in IDS) if (IDS.hasOwnProperty(k)) el[k] = byId(IDS[k]);
			if (!el.box || !el.svg || !document.createElementNS) { LOG('sky: no sky markup, staying off'); return; }
			buildStars();
			buildRays();
			buildSock();
			buildTurf();
			canvasInit();
			on(window, 'resize', function () {
				guard('resize', function () { fitDirty = true; layoutDirty = true; if (mode === 'still') still(false); });
			});
			on(document, 'visibilitychange', function () { guard('visibility', function () { sync(false); }); });
			ready = true;
			LOG('sky: ready' + (cv ? '' : ' (no canvas: no rain or snow)'));
			refresh();
			drawSock(0, false);
		});
	}

	/* weather.js, on every paint: the sky state and how current it is */
	function feed(state, stamp) {
		guard('feed', function () {
			data = state || null;
			asOf = num(stamp, 0);
			curDate = new Date();
			refresh();
		});
	}

	/* clock.js, once a minute */
	function minute(date) {
		guard('minute', function () {
			curDate = date || new Date();
			if (pv && Date.now() >= pv.until) { endPreview('ten minutes'); return; }
			fitDirty = true;                  /* one layout read a minute, no more */
			forceBox();
			sync(true);
		});
	}

	/* The cat side registers where her umbrella is; null takes it back. */
	function shelter(fn) { shelterFn = typeof fn === 'function' ? fn : null; }

	function previewing() {
		if (!pv) return null;
		return { key: pv.key, precip: cur.precip, level: cur.level, storm: cur.storm, cover: cur.cover, until: pv.until };
	}

	function status() {
		return {
			mode: mode, fps: Math.round(1000 / interval), cover: cur.cover, precip: cur.precip,
			level: cur.level, storm: cur.storm, wind: wind, day: isDay,
			preview: pv ? pv.key : '', until: pv ? pv.until : 0,
			drops: parts.length, canopy: !!canopy, canvas: !!cv,
			turf: grassState(groundTemp()), water: Math.round(gWater * 1000) / 1000, pool: !!pool, puddles: turfSides.length,
			faults: faultCount, dead: dead, lastFault: lastFault
		};
	}

	return {
		init: init,
		feed: feed,
		minute: minute,
		shelter: shelter,
		preview: preview,
		previewing: previewing,
		previews: function () { return PREVIEWS.slice(); },
		status: status,

		/* pure, for tools/check-sky.js */
		where: where,
		pickDays: pickDays,
		onArc: onArc,
		arcPath: arcPath,
		moonPath: moonPath,
		scene: scene,
		counts: counts,
		sock: sock,
		clockStr: clockStr,
		/* the insides, for tools/check-sky.js only */
		debug: function () {
			return { geo: geo, canopy: canopy, floor: floor(), parts: parts, splashes: splashes,
				drips: drips, gSnow: gSnow, gWet: gWet, interval: interval, t: t, clouds: cloudList,
				canvasLive: canvasLive, canopyTop: canopyTop };
		}
	};
})();
