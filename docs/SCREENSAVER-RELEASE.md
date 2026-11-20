# Lili Screensaver 1.0.0

Lili is a screen saver for Android phones. When your phone is charging and goes idle, Lili shows a clock and a small animated cat instead of a black screen. Every time the screen saver starts, she plays a random animation. After that she gets on with her day: she blinks, wanders about, grooms herself and does something new every minute or two. Her outfit follows a made-up sky that changes with the season.

Between 23:00 and 07:00 she plays one animation, then curls up and sleeps, and the screen dims.

You don't need an account, an API key or an internet connection. The app requests no permissions at all.

## Install

1. Download `lili-screensaver-1.0.0.apk` from this release on your phone.
2. Open it. Android asks you to allow installs from this source (your browser or file manager). Allow it for this one install. You can turn it off again afterwards.
3. Play Protect may warn that the app comes from an unknown developer. This is expected for apps that aren't on Google Play. Tap **More details**, then **Install anyway**.

Requires Android 5.0 or newer, with Android System WebView.

## Set up

Open **Lili** from your app drawer. The app guides you through these steps:

1. Tap **Open screen saver settings**.
2. Choose **Lili**.
3. Set **When to start** to **While charging**. Many phones start out on *While docked*, and with that setting Lili never appears.

Where the setting lives:

- Pixel, Samsung and most recent phones: **Settings → Display → Screen saver**
- Android 8: **Settings → Display → Advanced → Screen saver**
- MIUI / HyperOS, EMUI and some other skins hide it. Search Settings for "screen saver" or "Daydream". The button in the app sometimes opens it anyway.
- Some Android Go phones have no screen saver at all.

**No screen saver setting on your phone?** Use **Preview** in the app. It keeps Lili on screen for as long as it is open. Press Back to close it.

## What it does not do

- It does not appear on the lock screen itself. Lili shows when the phone is charging and goes idle, even while it is locked. Touch the screen and she goes away, and the lock screen appears.
- It does not appear on the always-on display. Android doesn't let apps draw there.
- It does not run on battery, because Android only starts screen savers while charging or docked.

## Checksum

```
SHA-256  <filled in from build-saver-apk.ps1 -Release>  lili-screensaver-1.0.0.apk
```
