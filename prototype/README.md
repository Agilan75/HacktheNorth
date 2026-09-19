# Room Sweep

Turn in a circle with your phone camera, get a renters-insurance price. 20 frames from one 360° sweep go to Gemini in a single request, so it can find hazards that only exist as a relationship between frames (the space heater in frame 4 and the curtains in frame 5).

## Run

```sh
cp config.example.js config.js   # then paste your Gemini key into config.js
python3 -m http.server 8000
```

Open http://localhost:8000. No build step, no dependencies.

**On a phone:** the camera API needs HTTPS anywhere other than localhost. Tunnel the local server:

```sh
cloudflared tunnel --url http://localhost:8000    # or: ngrok http 8000
```

No camera handy? "Upload photos instead" sends real photos through the same pipeline.

## How it works

| File | Job |
| --- | --- |
| `capture.js` | Camera, timed sweep (20 frames, one per 750 ms), downscale to 768 px JPEG |
| `gemini.js` | One `generateContent` call to `gemini-3.6-flash` with every frame, an enforced `responseSchema`, and the surveyor prompt |
| `pricing.js` | Every dollar figure in the app |
| `app.js` | Views and rendering |

If the call fails or the model's JSON doesn't parse, the app shows the error and the raw model text. There is no mock or fallback data anywhere.

## Where the price comes from

The model never returns a dollar amount for the premium. It returns a severity and a confidence per hazard, and `pricing.js` maps those to dollars:

| | Monthly delta |
| --- | --- |
| Base rate | $25 (placeholder) |
| High severity | +$9 |
| Medium severity | +$4 |
| Low severity | +$1.50 |

A hazard is priced only when the model's confidence is at least 0.5. Lower-confidence hazards are still shown, greyed out and marked "not priced". Contents values are the model's estimates and do not affect the premium; their sum is shown as suggested contents coverage.

## API key

The key lives in `config.js`, which is gitignored. This is a client-side app, so the key is sent to the browser and anyone can read it in devtools. That is acceptable for a 36-hour demo on a throwaway key and for nothing else. A real deployment would put the Gemini call behind a server.
