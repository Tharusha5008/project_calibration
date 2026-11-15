#!/usr/bin/env bash
# Starts the AI service (5001) and the API + web app (4000). Run ./start.sh --setup the first time.
set -e
cd "$(dirname "$0")"
if [ "$1" = "--setup" ]; then
  (cd ai-service && pip install -r requirements.txt && python3 generate_dataset.py && python3 train.py)
  (cd backend && npm install && [ -f .env ] || cp .env.example .env)
  (cd frontend && npm install && npm run build)
fi
if [ ! -f backend/.env ] || grep -qE "YOUR-PASSWORD|xxxxxxxxxxxx" backend/.env; then
  echo "Edit backend/.env and paste your Supabase connection string (DATABASE_URL), then run this again."; exit 1
fi
(cd backend && npm run db:check)
trap 'kill 0' EXIT
(cd ai-service && python3 app.py) &
(cd backend && node src/server.js) &
echo "Open http://localhost:4000  (admin@lab.test / Admin@123)"
wait
