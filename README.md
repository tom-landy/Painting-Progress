# Painting Progress

A secure, public-shareable web app for tracking Warhammer model painting progress.

## Features

- Import/upload a list of units and model counts
- Track model/unit states:
  - `Unbuilt`
  - `Build`
  - `Sprayed`
  - `Undercoated`
  - `Painted`
- Optional command units (Champion, Musician, Banner Bearer)
- Auto-locate model images via server-side search:
  - Warhammer.com page search + `og:image` extraction
  - Wikimedia fallback
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

## Import format

Use the JSON import textarea in the UI. Example:

```json
[
  {
    "name": "Chaos Space Marines",
    "faction": "Chaos Space Marines",
    "modelCount": 10,
    "command": {
      "champion": 1,
      "musician": 0,
      "bannerBearer": 1
    }
  }
]
```
