# Using Supabase as the database

CalibrateIQ stores everything (users, equipment catalogue, checks, tokens, certificates, messages) in
PostgreSQL. Supabase is hosted PostgreSQL, so you only need its **connection string**.

## 1. Create the project
1. Go to https://supabase.com -> **New project**. Pick a region close to you and set a **database password** (save it).
2. Wait ~2 minutes for it to finish provisioning.

## 2. Copy the connection string
1. In the project, click **Connect** (top bar) -> **Session pooler**.
2. Copy the URI. It looks like  
   `postgresql://postgres.abcdefghijkl:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`
3. Replace `[YOUR-PASSWORD]` with your real password. If it contains `@ : / # ?` or spaces, URL-encode them
   (`@` -> `%40`, `#` -> `%23`, `/` -> `%2F`, `:` -> `%3A`). Easiest: reset the password to letters and digits only.

> Use the **Session pooler** URI. The "Direct connection" host is IPv6-only on many home/office networks and will fail with `ENOTFOUND`.

## 3. Put it in the app
Open `backend/.env` (created from `.env.example` the first time you run setup) and set:
```
DATABASE_URL=postgresql://postgres.abcdefghijkl:YourRealPassword@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
JWT_SECRET=<a long random string>
```

## 4. Test and run
```
cd backend
npm run db:check      # prints "Connected to database ..." and creates the tables
cd ..
.\start.ps1           # Windows   (or ./start.sh on Mac/Linux)
```
On first start the app **creates all tables automatically** and loads the 10 instrument types and the demo accounts.
You can verify in Supabase -> **Table Editor**: `users`, `equipment_types`, `checks`, `requests`, `request_events`, `certificates`, `messages`.

Optional: load demo tokens (with the app running): `cd backend && npm run seed:demo`.

## Security notes
* **Row Level Security is enabled on every table with no policies.** The app connects directly as the database owner, so it is
  unaffected, but nobody can read or write your data through Supabase's public REST API using the `anon` key.
* Never put the database password or the `service_role` key in the frontend or commit `backend/.env`.
* Before real use: delete or change the demo accounts (admin@lab.test, tech@lab.test, user@lab.test) and set `SEED_DEMO_USERS=false`
  in `.env` if you do not want them recreated on an empty database.
* Supabase free projects pause after about a week of inactivity - restore from the dashboard if the app suddenly cannot connect.

## Moving data from the old SQLite version
The previous version kept data in a local `calibration.db`. That data is not migrated automatically (it was demo data). If you have
real records you need to keep, tell me and I will write an export/import script.

## Running the automated tests
`npm test` needs a PostgreSQL database. It defaults to `postgres://postgres:postgres@localhost:54329/cal`; set `TEST_DATABASE_URL`
to use another (it runs inside a temporary schema that is dropped at the end, so existing data is untouched).
