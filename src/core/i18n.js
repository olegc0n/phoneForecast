/* i18n.js - every word the page shows, in English and Russian.
 *
 * The language follows the phone: Russian when its language is Russian,
 * Belarusian, Ukrainian or Kazakh, English for everything else. Asked, in order:
 *   1. a #lang=en or #lang=ru in the page's address (a browser tab, for testing);
 *   2. the config's app_lang ('en' | 'ru'; '' = automatic);
 *   3. the APK: PhoneForecast.lang(), Android's Locale.getDefault().getLanguage();
 *   4. a browser tab: navigator.languages / navigator.language;
 *   5. English.
 *
 * This is the ONLY page file with Cyrillic in it (check-i18n.js scans the rest,
 * and that English renders without a single Cyrillic letter). Both tables carry
 * the same keys. A value may hold markup (<br>, entities) where it goes into
 * innerHTML; `{0}`, `{1}`... are filled by t().
 *
 * Names that are names stay as they are in both: Open-Meteo.com, MET Norway,
 * GeoNames, the licences. The animation list behind the gear is a developer's
 * tool and shows the scenes' own English labels in both languages.          */

var I18n = (function () {
	var RU_FAMILY = ['ru', 'be', 'uk', 'kk'];

	var T = {
		en: {
			wday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
			month: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
			compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
			part_morning: 'morning',
			part_day: 'afternoon',
			part_evening: 'evening',
			part_night: 'night',
			light_day: 'day',
			light_night: 'night',
			unit_wind: 'm/s',
			unit_pressure: 'hPa',
			unit_hours: 'h',
			unit_minutes: 'min',

			cond_clear: 'clear',
			cond_partly: 'partly cloudy',
			cond_overcast: 'overcast',
			cond_rain_light: 'light rain',
			cond_rain: 'rain',
			cond_rain_heavy: 'heavy rain',
			cond_showers: 'showers',
			cond_snow_light: 'light snow',
			cond_snow: 'snow',
			cond_snow_heavy: 'heavy snow',
			cond_snow_showers: 'snow showers',
			cond_sleet: 'sleet',
			cond_thunder: 'thunderstorm',

			prompt: 'Choose a city:<br>tap the gear<br>in the top-right corner',
			stale_dead: 'the forecast has run out &mdash; data from {0}',
			stale_ends: 'the forecast runs out in {0} h',
			stale_last: 'last answer {0} ago',
			age_hm: '{0} h {1} min',
			age_m: '{0} min',

			cfg_title: 'SETTINGS',
			cfg_tests: 'TEST ANIMATIONS',
			cfg_city: 'CITY &mdash; the forecast is for it',
			cfg_city_hint: 'City name, e.g. London',
			cfg_find: 'FIND',
			cfg_locate: 'USE MY LOCATION',
			cfg_sleep: 'SLEEP &mdash; she sleeps, the animation stops',
			cfg_from: 'from',
			cfg_to: 'to',
			cfg_save: 'SAVE',
			cfg_reset: 'RESET SLEEP HOURS',
			cfg_close: 'CLOSE',
			cfg_data: 'WEATHER DATA',
			cfg_credit_om: 'Forecast: Open-Meteo.com &mdash; Weather data by Open-Meteo.com, licensed CC BY 4.0. Free, with no key.',
			cfg_credit_met: 'When Open-Meteo does not answer (in the app only): MET Norway, the Norwegian Meteorological Institute &mdash; Weather data by MET Norway, CC BY 4.0.',
			cfg_credit_geo: 'City search: Open-Meteo, from GeoNames data (CC BY 4.0).',
			cfg_credit_sent: 'Only the city\'s coordinates are sent (2 decimals to Open-Meteo, 4 to MET Norway) and, when you search, the name you type. Sunrise, sunset and the moon phase are worked out on the phone.',

			place_none: 'Not chosen &mdash; no forecast',
			st_loading: 'Loading the forecast…',
			st_updated: 'Updated {0}',
			st_last_failed: 'the last try failed',
			st_no_data: 'No forecast yet',
			st_calls: '{0} of {1} requests today',
			st_now: 'Now {0}°, {1}, wind {2} {3} {4}',
			msg_type_city: 'Type a city name',
			msg_searching: 'Searching…',
			msg_search_failed: 'The search failed ({0}). Check the internet connection.',
			msg_not_found: 'Nothing found: {0}',
			msg_pick_one: 'Tap the city to choose it',
			msg_pick: 'Choose your city from the list',
			msg_locating: 'Finding your location…',
			msg_not_a_place: 'That is not a place on the map',
			msg_same_city: 'This city is already chosen',
			msg_failed: 'The forecast has not loaded yet ({0}). It will try again in a few minutes.',
			msg_done: 'Done &mdash; the forecast is updated',
			msg_bad_time: 'Times as HH:MM',
			msg_saved: 'Saved',
			msg_unchanged: 'No changes',
			msg_reset: 'Sleep hours reset: {0} &ndash; {1}',
			loc_denied: 'No permission to use your location. Search for your city instead.',
			loc_off: 'Location is turned off in the phone\'s settings.',
			loc_timeout: 'The phone did not find its location in 15 seconds. Try again, or search for your city.',
			loc_unavailable: 'Location is not available. Search for your city instead.',
			loc_failed: 'Could not find your location.'
		},

		ru: {
			wday: ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'],
			month: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
			compass: ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'],
			part_morning: 'утром',
			part_day: 'днём',
			part_evening: 'вечером',
			part_night: 'ночью',
			light_day: 'день',
			light_night: 'ночь',
			unit_wind: 'м/с',
			unit_pressure: 'мм рс',
			unit_hours: 'ч',
			unit_minutes: 'мин',

			cond_clear: 'ясно',
			cond_partly: 'переменная облачность',
			cond_overcast: 'пасмурно',
			cond_rain_light: 'небольшой дождь',
			cond_rain: 'дождь',
			cond_rain_heavy: 'сильный дождь',
			cond_showers: 'ливень',
			cond_snow_light: 'небольшой снег',
			cond_snow: 'снег',
			cond_snow_heavy: 'снегопад',
			cond_snow_showers: 'снежный заряд',
			cond_sleet: 'дождь со снегом',
			cond_thunder: 'гроза',

			prompt: 'Выберите город:<br>нажмите на шестерёнку<br>в правом верхнем углу',
			stale_dead: 'прогноз закончился &mdash; данные от {0}',
			stale_ends: 'прогноз кончится через {0} ч',
			stale_last: 'последний ответ {0} назад',
			age_hm: '{0} ч {1} мин',
			age_m: '{0} мин',

			cfg_title: 'НАСТРОЙКИ',
			cfg_tests: 'ТЕСТ АНИМАЦИЙ',
			cfg_city: 'ГОРОД &mdash; для него показывается прогноз',
			cfg_city_hint: 'Название, например Минск',
			cfg_find: 'НАЙТИ',
			cfg_locate: 'МОЁ МЕСТОПОЛОЖЕНИЕ',
			cfg_sleep: 'СОН &mdash; она спит, анимация остановлена',
			cfg_from: 'с',
			cfg_to: 'до',
			cfg_save: 'СОХРАНИТЬ',
			cfg_reset: 'СБРОСИТЬ ЧАСЫ СНА',
			cfg_close: 'ЗАКРЫТЬ',
			cfg_data: 'ДАННЫЕ О ПОГОДЕ',
			cfg_credit_om: 'Прогноз: Open-Meteo.com &mdash; Weather data by Open-Meteo.com, лицензия CC BY 4.0. Бесплатно и без ключа.',
			cfg_credit_met: 'Если Open-Meteo не отвечает (только в приложении): MET Norway, Норвежский метеорологический институт &mdash; Weather data by MET Norway, CC BY 4.0.',
			cfg_credit_geo: 'Поиск городов: Open-Meteo, по данным GeoNames (CC BY 4.0).',
			cfg_credit_sent: 'Отправляются только координаты города (2 знака после запятой для Open-Meteo, 4 для MET Norway), а при поиске &mdash; введённое название. Восход, закат и фаза Луны считаются на телефоне.',

			place_none: 'Не выбран &mdash; прогноза нет',
			st_loading: 'Загружаем прогноз…',
			st_updated: 'Обновлено {0}',
			st_last_failed: 'последняя попытка не удалась',
			st_no_data: 'Прогноза пока нет',
			st_calls: 'запросов сегодня {0} из {1}',
			st_now: 'Сейчас {0}°, {1}, ветер {2} {3} {4}',
			msg_type_city: 'Введите название города',
			msg_searching: 'Ищем…',
			msg_search_failed: 'Поиск не удался ({0}). Проверьте интернет.',
			msg_not_found: 'Ничего не найдено: {0}',
			msg_pick_one: 'Нажмите на город, чтобы выбрать его',
			msg_pick: 'Выберите город из списка',
			msg_locating: 'Определяем местоположение…',
			msg_not_a_place: 'Это не место на карте',
			msg_same_city: 'Этот город уже выбран',
			msg_failed: 'Прогноз пока не загрузился ({0}). Попробуем снова через несколько минут.',
			msg_done: 'Готово &mdash; прогноз обновлён',
			msg_bad_time: 'Время в формате ЧЧ:ММ',
			msg_saved: 'Сохранено',
			msg_unchanged: 'Без изменений',
			msg_reset: 'Часы сна сброшены: {0} &ndash; {1}',
			loc_denied: 'Нет разрешения на местоположение. Найдите город поиском.',
			loc_off: 'Определение местоположения выключено в настройках телефона.',
			loc_timeout: 'Телефон не определил местоположение за 15 секунд. Попробуйте ещё раз или найдите город поиском.',
			loc_unavailable: 'Местоположение недоступно. Найдите город поиском.',
			loc_failed: 'Не удалось определить местоположение.'
		}
	};

	/* ---------------- which one ---------------- */

	/* 'ru' for the Russian-reading family, 'en' for anything else; null for nothing */
	function family(code) {
		if (!code) return null;
		var c = String(code).toLowerCase().split(/[-_]/)[0];
		if (!c) return null;
		return RU_FAMILY.indexOf(c) !== -1 ? 'ru' : 'en';
	}

	/* every source, in order; `how` says which one decided, for the log and the harness */
	function detect(env) {
		var m = /[#&]lang=(en|ru)\b/.exec(String(env.hash || ''));
		if (m) return { lang: m[1], how: 'hash' };
		if (env.config === 'en' || env.config === 'ru') return { lang: env.config, how: 'config' };
		var f = family(env.bridge);
		if (f) return { lang: f, how: 'bridge' };
		var list = env.navigator || [];
		for (var i = 0; i < list.length; i++) {
			f = family(list[i]);
			if (f) return { lang: f, how: 'navigator' };
		}
		return { lang: 'en', how: 'default' };
	}

	function environment() {
		var env = { hash: '', config: '', bridge: '', navigator: [] };
		try { env.hash = window.location ? window.location.hash : ''; } catch (e) {}
		try { env.config = typeof app_lang === 'string' ? app_lang : ''; } catch (e) {}
		try { env.bridge = (typeof Host !== 'undefined' && Host.lang) ? Host.lang() : ''; } catch (e) {}
		try {
			if (typeof navigator !== 'undefined' && navigator) {
				if (navigator.languages && navigator.languages.length) {
					for (var i = 0; i < navigator.languages.length; i++) env.navigator.push(navigator.languages[i]);
				}
				if (navigator.language) env.navigator.push(navigator.language);
			}
		} catch (e) {}
		return env;
	}

	var chosen = detect(environment());
	var lang = chosen.lang;
	var table = T[lang];

	/* ---------------- the words ---------------- */

	function t(key) {
		var s = table.hasOwnProperty(key) ? table[key] : (T.en.hasOwnProperty(key) ? T.en[key] : key);
		if (arguments.length < 2) return s;
		var args = arguments;
		return String(s).replace(/\{(\d)\}/g, function (all, n) {
			var v = args[+n + 1];
			return v === undefined ? all : String(v);
		});
	}

	function two(n) { return n < 10 ? '0' + n : '' + n; }

	/* the date under the clock: "пн, 23.11.26" in Russian, "Mon 23 Nov" in English */
	function date(d) {
		if (lang === 'ru') {
			return table.wday[d.getDay()] + ', ' + two(d.getDate()) + '.' + two(d.getMonth() + 1) + '.' +
				String(d.getFullYear()).slice(-2);
		}
		return table.wday[d.getDay()] + ' ' + d.getDate() + ' ' + table.month[d.getMonth()];
	}

	/* "23 Nov" / "23 ноя": a day that is not today */
	function dayMonth(d) { return d.getDate() + ' ' + table.month[d.getMonth()]; }

	/* where the wind comes from, in eight points: 0 = N, 45 = NE... */
	function compass(deg) {
		if (typeof deg !== 'number' || deg !== deg) return '';
		return table.compass[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
	}

	/* an icon code (skc_d, bkn_-ra_n, ovc_ts_ra...) in words */
	function condition(code) {
		code = String(code || '');
		if (code.indexOf('ts') !== -1) return t('cond_thunder');
		var heavy = code.indexOf('+') !== -1, light = code.indexOf('-') !== -1, shower = code.indexOf('bkn') === 0;
		if (code.indexOf('ra_sn') !== -1) return t('cond_sleet');
		if (code.indexOf('ra') !== -1) return t(shower ? 'cond_showers' : light ? 'cond_rain_light' : heavy ? 'cond_rain_heavy' : 'cond_rain');
		if (code.indexOf('sn') !== -1) return t(shower ? 'cond_snow_showers' : light ? 'cond_snow_light' : heavy ? 'cond_snow_heavy' : 'cond_snow');
		if (code.indexOf('ovc') === 0) return t('cond_overcast');
		if (code.indexOf('bkn') === 0) return t('cond_partly');
		return code ? t('cond_clear') : '';
	}

	/* Fill every [data-i18n] element in the static markup with its words. */
	function paint(root) {
		var list = (root || document).querySelectorAll('[data-i18n]');
		for (var i = 0; i < list.length; i++) list[i].innerHTML = t(list[i].getAttribute('data-i18n'));
	}

	return {
		lang: function () { return lang; },
		how: function () { return chosen.how; },
		t: t,
		date: date,
		dayMonth: dayMonth,
		compass: compass,
		condition: condition,
		/* English shows pressure in hPa, as the sources give it; Russian in mm Hg */
		hpa: function () { return lang === 'en'; },
		paint: paint,
		/* for the offline harness */
		detect: detect,
		family: family,
		tables: T
	};
})();
