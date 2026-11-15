# Hosting CalibrateIQ on Render (free tier works)

You will host two small services; the database stays on Supabase.

| Service | What it is | Render name |
|---|---|---|
| Web app + API | Node (serves the website and the API) | `calibrateiq` |
| AI service | Python (drift outlook; optional) | `calibrateiq-ai` |

## 1. Put the project on GitHub
Create an empty **private** repository on github.com, then in PowerShell:
```powershell
cd E:\project_calibration
git init
git add .
git commit -m "CalibrateIQ"
git branch -M main
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```
`.gitignore` already keeps `backend/.env` (your passwords) out of GitHub. Check on github.com that `.env` is NOT in the repo.

## 2. Create both services with the blueprint
1. Sign up at render.com with GitHub.
2. **New -> Blueprint** -> pick your repo. Render reads `render.yaml` and proposes both services.
3. Fill in the prompts:

| Variable | Value |
|---|---|
| `DATABASE_URL` | your Supabase Session pooler URI (same as `backend/.env`) |
| `AI_API_KEY` | any long random text (e.g. run `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`). Use the SAME value on both services |
| `AI_SERVICE_URL` | leave blank for now |
| `LAB_NAME`, `LAB_ADDRESS` | your lab details |

4. Click **Apply**. The first build takes about 5-10 minutes (the AI service trains its model during the build).

## 3. Connect the web app to the AI service
1. Open the `calibrateiq-ai` service, copy its URL (like `https://calibrateiq-ai-xxxx.onrender.com`).
2. Open `calibrateiq` -> **Environment** -> set `AI_SERVICE_URL` to that URL (no trailing slash) -> save. It redeploys.
3. Open the `calibrateiq` URL. Sign in as `admin@lab.test` / `Admin@123`. On the Overview page, the **AI drift model** box should show the model figures.

Skipping the AI service is fine: leave `AI_SERVICE_URL` empty and checks still give the exact pass/fail.

## 4. Secure it before sharing the link
1. Sign in as the demo admin -> **Accounts** -> create your real admin account (strong password).
2. Sign in as the new admin and **disable or delete** the three demo accounts.
3. In Render, add `SEED_DEMO_USERS=false` to `calibrateiq`. (Do this only AFTER step 1, otherwise you can lock yourself out.)
4. Reset your Supabase database password, update `DATABASE_URL` in Render, and keep `JWT_SECRET` (auto-generated) private.

## 5. Updating the site later
Commit and push to GitHub; Render redeploys automatically.
```powershell
git add .
git commit -m "Describe the change"
git push
```

## Things to know about the free tier
* Free web services **sleep after ~15 minutes idle** and take about a minute to wake on the next visit. Paid plans (about $7/month each) stay awake.
* Supabase free projects pause after about a week without activity; restore from the Supabase dashboard if the site cannot connect.
* Your data lives in Supabase, so redeploys never lose data. Turn on Supabase backups (paid) or export regularly.
* A custom domain (e.g. calibration.yourlab.com) can be added under the service's **Settings -> Custom Domains**; HTTPS is automatic.

## Alternative: your own server (VPS)
Ubuntu + Node 20 + Python 3.10+: clone the repo, `cd frontend && npm install && npm run build`, `cd ../backend && npm install`, create `backend/.env`, train the AI (`cd ai-service && pip install -r requirements.txt && python train.py`), run both with `pm2` (`node src/server.js`, and `gunicorn -b 127.0.0.1:5001 app:app` bound to localhost only), then put nginx + certbot in front of port 4000.
