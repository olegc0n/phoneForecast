/* saver-boot.js - startup order for the screen saver.
 *
 * The clock is painted before anything optional, and is not inside Guard: if
 * the cat fails to start, or is switched off later after three faults in a
 * minute, the time keeps showing. The sky is published before the cat exists;
 * Cat subscribes to `weather` with replay, so it still receives it.          */

on(window, 'load', function () {
	LOG('=== saver load === build ' + cat_build + ' at ' + location.href);

	SaverClock.paint();
	Guard.run('sky', function () { Sky.begin(new Date()); });
	SaverClock.start();

	Guard.run('init', function () { Cat.init(); });
	Guard.run('saver', function () { Saver.begin(); });
	LOG('=== saver boot complete ===');
});
