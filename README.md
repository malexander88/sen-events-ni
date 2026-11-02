# SEN Events NI

A simple Android app (and web UI) listing autism/SEN-friendly events in **County Antrim** and **County Down**, Northern Ireland — aimed at families of non-verbal autistic children around ages 5–6.

## Live data

The app fetches:

`https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json`

Update `events.json` on `main` and the app will pick up new events on next launch (with offline cache + bundled fallback).

## App

- Calm, large-text UI with filters: **area**, **event type**, **SEN-specific vs all**, hide past
- Sort: by date, then Belfast and county order
- Tap an event → opens its booking/info page in the browser
- Android APK: see Releases or build from `android/`

## Areas

1. Belfast  
2. County Antrim  
3. County Down  
4. County Armagh  
5. County Londonderry  
6. County Tyrone  
7. County Fermanagh  

Each event carries `town` and `county` (`area` = `county`). A town dropdown lists all NI cities, towns and main villages with live event counts.

## Build APK

See `android/README.md`.
