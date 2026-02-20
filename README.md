# Painting Progress

A secure, public-shareable web app for tracking Warhammer model painting progress.

## Features

- Add units manually with instant save
- Global Old World army selector that filters visible units
- Mass import from pasted Old World Builder text
- Unit categories: `Unit` and `Character`
- Stores and displays unit loadout details (weapons, magic items, upgrades)
- Delete units directly from each card
- Color-coded cards by status (`Unbuilt`, `Build`, `Sprayed`, `Undercoated`, `Painted`)
- Track model/unit states:
  - `Unbuilt`
  - `Build`
  - `Sprayed`
  - `Undercoated`
  - `Painted`
- Optional command details for units (Champion, Musician, Banner Bearer)
- Security basics for public hosting:
  - `helmet`
  - rate limiting
  - CORS control
  - server-side input validation

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:10000](http://localhost:10000)

## Deploy to Render

1. Push this folder to GitHub.
2. In Render, create a **Web Service** from the repo.
3. Render will detect `render.yaml`.
4. Set `FRONTEND_ORIGIN` if you host frontend separately; leave blank when using the same service URL.

## Mass Import

Paste text directly from Old World Builder into the **Mass Import** box and click **Create Units From List**.
