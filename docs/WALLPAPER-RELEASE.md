<!-- Release title "Lili Wallpaper 1.0.0", tag wallpaper-v1.0.0, asset lili-wallpaper-1.0.0.apk -->

# Lili Wallpaper 1.0.0

Lili is a small animated cat who lives on your phone's home screen.

She is a live wallpaper, under your icons and widgets. Each time you come back to the home screen after a little while away (you unlock the phone or close an app), she starts a random animation. In between she gets on with her day: she blinks, wanders about, grooms herself and does something new every minute or two. Her outfit follows a made-up sky that changes with the season.

From 23:00 to 07:00 she sleeps. Unlocking the phone at night shows her curled up asleep, and she doesn't perform.

You choose what is behind her: **My wallpaper** (the picture you had as your wallpaper, which Lili keeps a copy of), one of six dark backgrounds, or a photo of your own. You also choose how big she is and how high she stands, so she stays clear of your dock and icons. The preview shows her with home-screen icons on top, drawn ones or your own.

When the wallpaper is out of sight (screen off, or an app in front) she pauses completely, so she uses no battery then. You don't need an account, an API key or an internet connection.

## Permissions

- **Set the wallpaper**: to put your old wallpaper (or My wallpaper) back when you take Lili off. Granted at install, no question.
- **Run at startup**: only for a lock-screen picture of Lili that is switched off in this version (see "Lock screen"); it does something only on a phone that still has that picture from a test build. Granted at install.
- **Photos and media** (Android 6 to 12): to read your current wallpaper, to keep it as My wallpaper and to save it before Lili takes the home screen. Android asks you once; if you say no, you can pick your wallpaper from your photos instead.
- **All files access** (Android 13 and newer): the only way Android 13+ lets an app read your current wallpaper, for My wallpaper. Lili never asks with a popup: a card in her settings explains it, and **Allow** opens the system page where you switch it on. Lili reads nothing else with it. If you'd rather not, tap **Pick from photos instead**. (Google Play doesn't allow this permission for an app like Lili, which is one reason Lili is on GitHub.)
- **Run a foreground service**, and **of the screen-capture type** (Android 14): only while **Use my real home screen** is capturing, a second or two, with a notification "Lili is capturing your home screen". The capture itself needs your OK each time, in Android's own screen-capture dialog.

## Install

1. Download `lili-wallpaper-1.0.0.apk` from this release on your phone.
2. Open it. Android asks you to allow installs from this source (your browser or file manager). Allow it for this one install. You can turn it off again afterwards.
3. Play Protect may warn that the app comes from an unknown developer. This is expected for apps that aren't on Google Play. Tap **More details**, then **Install anyway**.

Requires Android 5.0 or newer, with Android System WebView.

## Set up

Open **Lili** from your app drawer.

**The first time**, Lili keeps a copy of your current home-screen wallpaper as **My wallpaper**, so it is never lost, even if you later delete the original. On Android 6 to 12 she asks for **Photos and media** first. On Android 13 and newer a card at the top explains **All files access**; tap **Allow**, switch it on and come back, or tap **Pick from photos instead**. If your wallpaper is animated, or Lili can't read it, the card offers **Pick from photos**. Once she has it, the card goes away for good and **My wallpaper** is the first background button. Until you apply something else, it is the background behind her.

**Where Lili lives** says what your phone shows now, for example "Lili is on: home screen" or "Not set".

Then:

1. Choose the background (**My wallpaper**, one of the six colours, or **Choose photo…**), how dark a picture is, and her size and height. Nothing changes on your phone yet; "Changes not applied yet" shows above **Preview**.
2. Tap **Preview**. Lili appears full screen as she'll look on your home screen, with home-screen icons over her. At the top:
   - **Home screen**: on means Lili will be your home-screen wallpaper, off means your previous wallpaper comes back. It starts on if Lili isn't your wallpaper yet. The line under it says what Apply will do.
   - **Lock screen**: see "Lock screen" below; on most phones it can't be switched on.
   - **Show icons**: the icons over her. They're drawn ones at first. If Lili is already your wallpaper, **Use my real home screen** shows your own icons instead (see below), and **Drawn icons** / **Real icons** switches between them.
   - Tap the picture to hide this panel and see the whole screen; tap again to bring it back.
3. Tap **Apply**. Lili applies the look, then does what the switches say:
   - **Home screen on** (and Lili isn't your wallpaper yet): she saves your current wallpapers, then Android shows a preview of her. Tap **Set wallpaper** and choose **Home screen**, or **Home screen and lock screen** to have her on the lock screen too on phones that allow it.
   - **Home screen off** (and Lili is your wallpaper): she puts back the wallpaper you had before. If she couldn't save it, she puts back **My wallpaper**. If she has neither, she asks what to put there: a photo you choose, or the system default. **Cancel** leaves her where she is.

**Cancel** (or Back) in the preview takes you back to the settings with your changes kept and nothing done. If you leave the settings with Back before applying, Lili asks whether to **Apply** or **Discard** your changes, or to **Keep editing**.

If Android's wallpaper preview doesn't open, set her through your launcher instead: long-press an empty part of the home screen, then **Wallpapers** (or **Wallpaper & style**), then **Live wallpapers**, then **Lili**.

### Your real home screen in the preview

With Lili as your wallpaper, tap **Use my real home screen** in the preview. The preview steps aside and your home screen shows. Android asks whether Lili may capture the screen: tap **Start now** (on Android 14 and newer, choose **Entire screen** first). For a moment Lili's wallpaper turns bright pink; she takes one picture of your home screen, cuts the pink out, and you're back in the preview with your own icons, widgets and dock over her. Nothing leaves your phone. If you cancel, or choose a single app, the drawn icons stay.

## Lock screen

Android doesn't let apps animate the lock screen, so the **Lock screen** switch in the preview can't be switched on.

- **Animated on the lock screen** works only where the phone maker's lock screen shows live wallpapers from other apps. That is stock Android: Pixel, Motorola, Nokia, and the Android emulator. Keep **Home screen** on, tap **Apply**, and choose **Home screen and lock screen** in Android's preview. "Where Lili lives" then says "home and lock screen (animated)". Turning **Home screen** off (and applying) takes her off both, and puts your old lock-screen wallpaper back too.
- **Not supported:**
  - **Huawei** (EMUI, HarmonyOS 2 to 4): no live wallpapers or videos from other apps on the lock screen. There is only an unofficial workaround through Theme Editor, which we don't support.
  - **Samsung** (One UI): no live wallpapers from other apps on the lock screen. Samsung's own video lock-screen wallpaper (up to 15 seconds) is a manual option, but Lili can't export a video (yet).
  - **Xiaomi, Oppo and OnePlus**: it depends on the model. Usually she is on the home screen only.
- **Why not more:** the only other way would be an app that replaces your lock screen. It would need "Display over other apps" and a permanent notification, and it would hide the system lock screen behind it. We decided against that.

A still picture of Lili for the lock screen was built and tested on Huawei, where it works, but it is switched off in this version. If your phone still has that picture from a test build, "Where Lili lives" says so, and the **Lock screen** switch in the preview is on. Switch it off and tap **Apply** to get your old lock-screen wallpaper back.

## Huawei and Honor phones

- Lili lives on the home screen. Choose **Home screen** in Android's preview.
- If you still have her lock-screen picture from a test build and it doesn't appear, turn off **Magazine unlock** (Settings, Home screen & wallpaper, Magazine unlock). For it to be renewed every few hours until you turn it off, let Lili run in the background: Settings, **Battery**, **App launch**, Lili, **Manage manually**, with all three switches on.

## What it does not do

- It can't copy an animated wallpaper of another app as My wallpaper (there's no picture); pick a photo instead.
- She isn't on the lock screen of phones whose makers don't allow live wallpapers from other apps there (Huawei, Samsung One UI, most Xiaomi/HyperOS and Oppo/ColorOS builds). See "Lock screen".
- She doesn't appear on the always-on display. Android doesn't let apps draw there.
- After a restart, Lili appears once you have unlocked the phone for the first time. Until then Android shows its own fallback wallpaper.
- She doesn't react to touch yet.

## Checksum

```
SHA-256  <filled in from build-wallpaper-apk.ps1 -Release>  lili-wallpaper-1.0.0.apk
```
