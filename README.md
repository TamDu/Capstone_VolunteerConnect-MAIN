# Volunteer Connect

A simple, static volunteer-opportunity finder built with plain HTML, CSS, and JavaScript — no build tools, frameworks, or installs required.

## Features

- Free-text location search (city, state, or ZIP code) with built-in approximate geocoding
- "Use my current location" via browser geolocation
- Search radius slider + number input (1–100 miles)
- Filter by 10 volunteer categories (Environment, Social Services, Education & Youth, Health & Wellness, Animals & Wildlife, Arts & Culture, Sports, Faith-based, Disaster Relief, Seniors & Veterans)
- Sort by Distance, Relevance, or Alphabetical
- Responsive card layout with mock opportunity listings

## Data

This is a prototype using mock sample data. Each listing's `source` field labels it as representative of a real volunteer platform (Idealist, VolunteerMatch, Volunteer Connector, Points of Light Engage, JustServe) as a placeholder for future live API integration.

## Running locally

No build step needed. From this directory, run a static file server:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser. Alternatively, open `index.html` directly in a browser.

## Files

- `index.html` — page structure
- `styles.css` — styling
- `data.js` — mock dataset, category metadata, and location-resolution logic
- `app.js` — application/interaction logic
