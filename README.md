# Out & About NI

A simple Android app (and web UI), formerly "SEN Events NI", listing autism/SEN-friendly and family events and places across **all of Northern Ireland** — aimed at families of non-verbal autistic children around ages 5–6. The launcher label is "Out & About"; the package (`com.senevents.ni`) and repo name are unchanged so updates install over older versions.

## Live data

The app fetches:

`https://raw.githubusercontent.com/malexander88/sen-events-ni/main/events.json`

Update `events.json` on `main` and the app will pick up new events on next launch (with offline cache + bundled fallback).

## App

- Calm, large-text UI with filters: **area**, **event type**, **SEN-specific vs all**, hide past
- **Age slider** (0 to 12+, v2.0.1): items may carry optional `ageMin` / `ageMax` (whole years, only when the organiser states an age range; `ageMax` absent = "X+"). Items without ages always show; items with a range show if it overlaps the chosen ages. The choice is remembered on the device.
- **Seasonal** type (v2.0.1, replaces `Christmas`): Christmas, New Year, Valentine's, Easter, summer and Halloween events. The section icon follows the season of the earliest upcoming seasonal item (🎄 🎆 💝 🐣 ☀️ 🎃), else today's date.
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
