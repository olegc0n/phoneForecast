<!-- Release title "Lili Weather 1.0.0", tag weather-v1.0.0, marked as a pre-release, asset lili-weather-1.0.0.apk -->

# Lili Weather 1.0.0 (pre-release)

Lili Weather turns an old Android phone into a weather display for your desk or shelf: a large clock, the date and the forecast for your city, with Lili, a small animated cat, living in front of it.

The phone stays on with the screen on (keep it on its charger). You get the current temperature, the weather icon, wind, humidity and pressure, today's low and high, the next two parts of the day, sunrise and sunset with the length of the day, and the moon. Lili dresses for the weather: a coat and umbrella in the rain, a hat and scarf in the cold, a cap and sunglasses on a warm sunny day. She works at a desk during working hours, has lunch, plays in the snow, and sleeps from 23:00 to 10:00 (you can change the hours). The app comes back by itself after a power cut.

The forecast is free and needs no key or account. It comes from Open-Meteo, with MET Norway as a backup.

The app is in English and Russian. It follows your phone's language: Russian if the phone is set to Russian, Belarusian, Ukrainian or Kazakh, English otherwise.

This is a **pre-release**. It is the first public build of the free-forecast version, tested mainly on a Moto G4 Plus with Android 8.

## Install

1. On the phone, download `lili-weather-1.0.0.apk` from this release.
2. Open it. Android asks you to allow installs from this source (your browser or file manager). Allow it for this one install. You can turn it off again afterwards.
3. Play Protect may warn that the app comes from an unknown developer. This is expected for apps that aren't on Google Play. Tap **More details**, then **Install anyway**.
4. Open **Lili Weather** from your app drawer.

You need Android 5.0 or newer, with Android System WebView. Lili Weather installs as a separate app (`com.lili.weather`). It doesn't replace or touch an earlier Lili build that used a Yandex key.

## Choose your city

On the first start there's no city, so there's no forecast yet. The screen shows the clock, the date and a short note asking you to choose a city. Lili is there, but she doesn't know the weather until you choose one.

Tap the **gear** in the top-right corner (wait a second after the app opens), then under **CITY** (**ГОРОД** in Russian):

- **Search:** type the name of your city and tap **FIND** (**НАЙТИ**). Up to eight places appear, each with its region and country. Tap yours.
- **Or use your location:** tap **USE MY LOCATION** (**МОЁ МЕСТОПОЛОЖЕНИЕ**). The first time, Android asks whether Lili Weather may use your approximate location. The phone finds where it is through its own network location (no Google services needed) and names the place with the phone's geocoder, if it has one. Otherwise the place is called by its coordinates.

The city is saved on the phone and the forecast loads at once. Under the city you see the weather there now, and when the forecast was last updated and where from. To change the city later, search again.

The forecast then updates by itself about once an hour.

## What is sent

- **To get the forecast:** only your city's coordinates, rounded to 2 decimals (about 1 km) for Open-Meteo and to 4 decimals for MET Norway. MET Norway is asked only when Open-Meteo doesn't answer.
- **When you search for a city:** only the name you typed, to Open-Meteo's place search.
- Every request is over HTTPS. Requests name the app and link to this project ("Lili-Weather/1.0.0 (+https://github.com/olegc0n/phoneForecast)"), which MET Norway requires.
- **"Use my location"** asks Android where the phone is. The answer stays on the phone, and only the rounded coordinates above are ever sent.
- There's no account, no API key, no analytics and no identifier of you or your phone.

## How often

- Once an hour while everything works. That's about 24 requests a day.
- After a failed update, it tries again in 5, 15 and 30 minutes, then once an hour.
- Nothing is tried while the phone is offline.
- It never makes more than 48 requests in a day.
- Restarting the app costs nothing: the last forecast is kept on the phone and shown at once. It holds two days and more of hourly forecast, so the screen stays correct hour by hour even if the internet is down for a day.

## Sources and licences

- [Open-Meteo](https://open-meteo.com): weather data by Open-Meteo.com, licensed CC BY 4.0. Free for non-commercial use. Its place search is built on GeoNames (CC BY 4.0).
- [MET Norway](https://api.met.no) Locationforecast 2.0, as the backup: weather data by MET Norway (the Norwegian Meteorological Institute), licensed CC BY 4.0 and NLOD 2.0.

The forecast screen shows the source in its bottom-right corner ("Open-Meteo.com" or "MET Norway"). The settings list the full credits. Sunrise, sunset, day and night, and the phase of the moon are worked out on the phone.

The forecast layout began as Weather informer v1 (2025) by Alexey N. The app is under the MIT License.

## Permissions

- **Internet:** to load the forecast and to search for your city.
- **Network state:** so the app knows when the phone is offline and doesn't try.
- **Run at startup:** to come back by itself after the phone restarts, for example after a power cut.
- **Approximate location:** only if you tap **USE MY LOCATION**. Android asks you then. If you say no, search for your city instead.

## Good to know

- Times on the screen use the phone's clock. If you choose a city in another time zone, you see its weather on your own time.
- The app keeps the screen on. Keep the phone on its charger.
- In English, pressure is shown in hPa; in Russian, in mm of mercury, as before.
- Behind the gear there is also **TEST ANIMATIONS**, a list of all of Lili's animations to play by hand. Their names are in English in both languages.

## Checksum

```
SHA-256  <filled in from build-apk.ps1 -Release>  lili-weather-1.0.0.apk
```
