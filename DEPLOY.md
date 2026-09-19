# Deploy: API on Railway, console on Vercel

The API is a long-running Node server that writes to a SQLite file, so it needs a host with a persistent disk (Railway). The console is a static site (Vercel). Both configs are in the repo: `railway.json` and `vercel.json`. Both flows were rehearsed from a clean copy of the repo: `npm ci`, the console build, and the API's first boot and restart.

## 1. API on Railway

```bash
npx @railway/cli login                 # opens the browser
npx @railway/cli init                  # new project, e.g. "retrofit"
npx @railway/cli up                    # uploads this repo and builds it
npx @railway/cli volume add --mount-path /data
npx @railway/cli variables \
  --set DATABASE_URL=/data/retrofit.db \
  --set FEDERATO_BASE_URL=... --set FEDERATO_TOKEN_URL=... \
  --set FEDERATO_AUDIENCE=... --set FEDERATO_CLIENT_ID=... \
  --set FEDERATO_CLIENT_SECRET=... --set GEMINI_API_KEY=...
npx @railway/cli domain                # prints the public API URL
```

Railway injects `PORT`. On every boot, `railway.json` runs `seed --if-empty --no-enrich` and then starts the server. The first boot loads the live Federato book (158 submissions) into the volume. Every restart after that skips straight to serving. If Federato is unreachable at boot, the server still starts (`;`, not `&&`), and `/health` says so.

Check it: `curl https://<api-domain>/health` should show `"submissionCount":158` and `"adapter":"live"`.

## 2. Console on Vercel

```bash
npx vercel@latest login
npx vercel@latest link                              # from the repo root
npx vercel@latest env add VITE_API_URL production   # paste the Railway URL, https://…
npx vercel@latest deploy --prod
```

`vercel.json` installs from the repo root (npm workspaces), builds only the console, and rewrites every path to `index.html`, so deep links such as `/submissions/SUB-2026-00081` survive a refresh. `VITE_API_URL` is baked in at build time, so if the Railway URL changes, redeploy.

## Notes

- **Gemini credits** are still depleted. The deployed app behaves exactly as it does locally: the deterministic parts work, and reply extraction does not (STATUS.md).
- **Enrichment is skipped on boot** (`--no-enrich`) because the public Overpass mirrors are slow and rate-limited. Run it for one account from the console ("Run enrichment") or with `POST /enrich/:id`.
- **The phone app** can point at the Railway URL: set `EXPO_PUBLIC_API_URL=https://<api-domain>`.
- **Cost:** Railway bills usage after its trial credit; a single small service with a 1 GB volume is a few dollars a month. Delete the project after the event if you don't need it.
