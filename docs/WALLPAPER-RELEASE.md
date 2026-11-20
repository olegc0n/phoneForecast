<!-- Release title "Lili Wallpaper 1.0.0", tag wallpaper-v1.0.0, asset lili-wallpaper-1.0.0.apk -->

# Lili Wallpaper 1.0.0

Lili is a small animated cat who lives on your phone's home screen.

She is a live wallpaper, under your icons and widgets. Each time you come back to the home screen after a little while away (you unlock the phone or close an app), she starts a random animation. In between she gets on with her day: she blinks, wanders about, grooms herself and does something new every minute or two. Her outfit follows a made-up sky that changes with the season.

From 23:00 to 07:00 she sleeps. Unlocking the phone at night shows her curled up asleep, and she doesn't perform.

You choose what is behind her: one of six dark backgrounds, or a photo of your own. You also choose how big she is and how high she stands, so she stays clear of your dock and icons.

When the wallpaper is out of sight (screen off, or an app in front) she pauses completely, so she uses no battery then. You don't need an account, an API key or an internet connection.

## Permissions

- **Set the wallpaper**, to put your old wallpaper back when you turn Lili off. Android grants this when you install the app, without asking.
- **Run at startup**, for a lock-screen picture of Lili that is switched off in this version (see "Lock screen"). It only does something on a phone that still has that picture from a test build.
- **Photos and media** (Android 6 to 12 only). Before Lili moves onto your home screen, she saves the wallpapers on your home screen and lock screen, so that turning her off can bring them back. Reading them needs this permission. Android asks you once. If you say no, Lili still works, and when you turn her off you can choose a photo or the system default instead.

## Install

1. Download `lili-wallpaper-1.0.0.apk` from this release on your phone.
2. Open it. Android asks you to allow installs from this source (your browser or file manager). Allow it for this one install. You can turn it off again afterwards.
3. Play Protect may warn that the app comes from an unknown developer. This is expected for apps that aren't on Google Play. Tap **More details**, then **Install anyway**.

Requires Android 5.0 or newer, with Android System WebView.

## Set up

Open **Lili** from your app drawer. Under **Where Lili lives**, turn on **Home screen**. Lili saves your current wallpapers, then Android shows a preview of her. Tap **Set wallpaper** and choose **Home screen**, or **Home screen and lock screen** to have her on the lock screen too on phones that allow it (see "Lock screen").

Turning **Home screen** off brings back the wallpaper you had before. If Lili couldn't save it, she asks what to put there instead: a photo you choose, or the system default. **Cancel** leaves her where she is.

The line under each switch says what that screen shows now, for example "Lili, animated" or "Your previous wallpaper".

If the switch doesn't open anything, set her through your launcher instead: long-press an empty part of the home screen, then **Wallpapers** (or **Wallpaper & style**), then **Live wallpapers**, then **Lili**.

Further down you can pick a background or a photo, darken the photo, and change her size and height. These changes aren't applied straight away, and your wallpaper stays as it is while you try things. Once you've changed something, "Changes not applied yet" shows above **Preview**. To apply them:

1. Change the background, photo, darkening, size or height.
2. Tap **Preview**. Lili appears full screen, the way she'll look on your home screen.
3. Tap **Apply** at the top. If Lili isn't your wallpaper yet, the button says **Apply and set as wallpaper**, and Android's wallpaper preview opens next, as with the **Home screen** switch.

**Cancel** (or Back) takes you back to the settings with your changes kept, so you can go on adjusting them. If you leave the settings with Back before applying, Lili asks whether to **Apply** or **Discard** your changes, or to **Keep editing**. The **Home screen** and **Lock screen** switches aren't affected by any of this: they work as soon as you flip them.

## Lock screen

Android doesn't let apps animate the lock screen, so the **Lock screen** switch can't be turned on. It shows whether Lili is there.

- **Animated on the lock screen** works only where the phone maker's lock screen shows live wallpapers from other apps. That is stock Android: Pixel, Motorola, Nokia, and the Android emulator. Turn on **Home screen** and choose **Home screen and lock screen** in the picker. The Lock screen switch then shows "Lili, animated (with the home screen)". Turning **Home screen** off takes her off both, and puts your old lock-screen wallpaper back too.
- **Not supported:**
  - **Huawei** (EMUI, HarmonyOS 2 to 4): no live wallpapers or videos from other apps on the lock screen. There is only an unofficial workaround through Theme Editor, which we don't support.
  - **Samsung** (One UI): no live wallpapers from other apps on the lock screen. Samsung's own video lock-screen wallpaper (up to 15 seconds) is a manual option, but Lili can't export a video (yet).
  - **Xiaomi, Oppo and OnePlus**: it depends on the model. Usually she is on the home screen only.
- **Why not more:** the only other way would be an app that replaces your lock screen. It would need "Display over other apps" and a permanent notification, and it would hide the system lock screen behind it. We decided against that.

A still picture of Lili for the lock screen was built and tested on Huawei, where it works, but it is switched off in this version. If your phone still has that picture from a test build, the Lock screen switch is on and shows when the picture was last updated. Turn it off to get your old lock-screen wallpaper back. After that the switch stays off.

## Huawei and Honor phones

- Lili lives on the home screen. Choose **Home screen** in the picker.
- If you still have her lock-screen picture from a test build and it doesn't appear, turn off **Magazine unlock** (Settings, Home screen & wallpaper, Magazine unlock). For it to be renewed every few hours until you turn it off, let Lili run in the background: Settings, **Battery**, **App launch**, Lili, **Manage manually**, with all three switches on.

## What it does not do

- It doesn't show your current wallpaper picture behind her. If you want your own picture behind her, choose it with **Choose photo…**.
- She isn't on the lock screen of phones whose makers don't allow live wallpapers from other apps there (Huawei, Samsung One UI, most Xiaomi/HyperOS and Oppo/ColorOS builds). See "Lock screen".
- She doesn't appear on the always-on display. Android doesn't let apps draw there.
- After a restart, Lili appears once you have unlocked the phone for the first time. Until then Android shows its own fallback wallpaper.
- She doesn't react to touch yet.

## Checksum

```
SHA-256  <filled in from build-wallpaper-apk.ps1 -Release>  lili-wallpaper-1.0.0.apk
```
