/* wall-boot.js - startup order for the live wallpaper.
 *
 *   1. the real weather, if the host has a forecast for this page (Wall.forecast
 *      with PhoneForecast.forecast(); nothing at all without one) - before the
 *      first sky, so she starts dressed for the real weather
 *   2. the sky: the real one, or an invented one - published before the cat
 *      exists (cat.js subscribes to `weather` with replay, so it still
 *      receives it)
 *   3. the stage sized and placed, and a resize listener that re-places it -
 *      registered BEFORE Cat.init(), so on a real resize the stage already has
 *      its new size when Rig.measure() and cat.js's layout() read it
 *   4. the minute tick
 *   5. the cat
 *   6. Wall: the show/hide logic, the sky's day and night - or, when the URL
 *      says #still=1, Still: one calm pose, then everything frozen, for the
 *      lock-screen picture (still.js)
 *
 * The page waits for the engine's Wall.show() before it performs; in a browser
 * tab, with no engine, Wall.begin() shows itself.                            */

on(window, 'load', function () {
	LOG('=== wall load === build ' + cat_build + ' at ' + location.href);

	Guard.run('forecast', function () { Wall.forecast(Wall.hostForecast()); });
	Guard.run('sky', function () { Sky.begin(new Date()); });
	Guard.run('place', function () { Wall.place(); });
	on(window, 'resize', function () { Guard.run('place', function () { Wall.place(); }); });
	WallTick.start();

	Guard.run('init', function () { Cat.init(); });
	if (Still.active()) Still.begin();
	else Guard.run('wall', function () { Wall.begin(); });
	LOG('=== wall boot complete ===');
});
