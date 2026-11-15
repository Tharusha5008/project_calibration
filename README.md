# CalibrateIQ - Equipment Calibration System

Customers check an instrument against its **standard reference points** (guided by a 3D model that shows where to
read it), book a **calibration token** if it is out of tolerance, hand it over in person or by courier, and download
the **certificate** once a technician has calibrated it and an admin has approved it.

## Quick start
```bash
./start.sh --setup      # first time: installs everything, generates the sample dataset, trains the model, builds the UI
./start.sh              # afterwards
```
Open http://localhost:4000. Needs Node 20+ and Python 3.10+. Optional: `cd backend && npm run seed:demo` (with the app running) loads demo tokens.

| Role | Login | Password |
|---|---|---|
| Admin | admin@lab.test | Admin@123 |
| Technician | tech@lab.test | Tech@123 |
| Customer | user@lab.test | User@123 |

**Change these before real use** and set `JWT_SECRET` (the server refuses to start in production without it).

## What each role can do
| | Customer | Technician | Admin |
|---|---|---|---|
| 3D guide + check error against standard points | yes | | yes (try a check) |
| Book token, hand over (in person / courier), track delivery | yes | | |
| Accept token, assign technician | | | yes |
| Start work, save readings, issue certificate | | yes | |
| Approve / send back certificates | | | yes |
| Return instrument (pickup / courier), tracking updates | confirm receipt | yes | yes |
| Feedback / issues with replies | yes | feedback | reply, resolve |
| Weekly / monthly PDF report | own | assigned | all |
| Download certificate PDF | approved only | own | all |
| Manage accounts, equipment catalogue, retrain AI | | | yes |

Token life-cycle: `booked -> handed over -> accepted (technician assigned) -> in calibration -> certificate pending approval -> certificate approved -> returning -> closed`. A rejected certificate goes back to the technician.

## Why predictions used to be 800-900% wrong (and what changed)
1. The old catalogue stored **one median reference value per instrument type**, but the training data had a different reference value on every row. Any reading compared with the wrong reference gave errors of hundreds of percent. Now every instrument has fixed **standard test points with their own MPE** (`shared/equipment-catalog.json`) and the user picks one - no free-form reference.
2. The dataset stored error as a **fraction** (1.0 = at the limit) while the app treated it as a percent. The unit is now explicit everywhere (`error_ratio` is a fraction; the API also returns `error_pct_of_tolerance`).
3. **The verdict is no longer predicted.** Pass/fail is `|reading - reference| / MPE`, computed exactly. The AI only estimates *drift risk* from history (age, days since calibration, usage, temperature, humidity, previous result) and returns an 80% range, an out-of-tolerance probability and a risk band. It never produces the verdict.
4. Guards: readings far outside the instrument's range are rejected (wrong unit / decimal point), very large errors are flagged, AI inputs are clamped to the training range, and the AI service being down never blocks a check.

## AI service (`ai-service/`)
* `generate_dataset.py` - **synthetic** sample dataset: 10 instrument types x 1,500 rows (`data/calibration_dataset.csv`).
* `train.py` - gradient-boosted models (expected error ratio, 10/90% quantiles, out-of-tolerance classifier) with hold-out metrics in `model/metrics.json`.
* `app.py` - Flask: `GET /health`, `GET /status`, `POST /train`, `POST /predict`.

Current hold-out metrics: typical miss about 20% of tolerance vs 27% for a "predict the average" baseline, AUC 0.84 for out-of-tolerance, 75% of readings inside the 80% range. **These numbers describe the synthetic data.** Replace `calibration_dataset.csv` with your lab's real history (same columns, see the docstring in `generate_dataset.py`) and run `python3 train.py` - or use *Retrain* on the admin dashboard. Equipment types added by an admin get the exact verdict but no AI outlook until the model is retrained with their history.

## Layout
```
shared/equipment-catalog.json   10 instrument types, standard points, MPE, guide steps (source of truth)
ai-service/                     dataset generator, trainer, Flask API
backend/                        Express + SQLite (better-sqlite3), JWT auth, pdfkit, tests (npm test)
frontend/                       React + Vite + three.js (procedural 3D models, no external assets)
```
Tests: `cd backend && npm test` runs the whole lifecycle (check -> token -> courier -> certificate -> PDF -> return -> reports) plus permission and validation checks against a throw-away database.

## Notes / next steps
* SQLite keeps setup to zero; for multi-site production move to PostgreSQL (SQL is plain and isolated in `src/routes`).
* Courier tracking is manual (status updates entered by customer / lab). Integrating a courier API would replace `POST /requests/:id/shipment`.
* Certificates are PDF records with an approval step; they are not digitally signed or ISO/IEC 17025 accredited documents.
* 3D models are procedural approximations to show *where to read*, not CAD replicas.
