# Parkside reservations

React weekly calendar for the parking reservation API.

## Run locally

```powershell
cd parking-frontend
npm install
npm run dev
```

Start the backend in another terminal from the repository root:

```powershell
pip install -r fastapi-backend/requirements.txt
cd fastapi-backend
uvicorn main:app --host 127.0.0.1 --port 8001
```

FastAPI loads the repository-root `.env`. Set `DATABASE_URL`, or provide `POSTGRES_USER` and `POSTGRES_PASSWORD`; `POSTGRES_HOST`, `POSTGRES_PORT`, and `POSTGRES_DB` are optional. Local defaults are `localhost:5432/django`. The Vite dev server proxies `/api/*` to `http://127.0.0.1:8001/*`. Set `VITE_API_BASE_URL` to change the API prefix; see `.env.example`.

The table reads transaction-replayed reservation states from `/reservations`; it does not display placeholder bookings. New reservations are accepted even when no spot is available and appear as `WAITLISTED`. `/confirm` records a driver's arrival for an `ALLOCATED` reservation; `/release` appends a release transaction. State is recomputed from the ledger after each action and can be `ALLOCATED`, `CONFIRMED`, `WAITLISTED`, or `RELEASED`.
Reservations whose end time has passed are computed as `RELEASED` during each replay and no longer receive or hold a spot; their ledger entries are preserved.

Set `PARKING_NOTIFICATION_WEBHOOK_URL` in the repository-root `.env` to the Power Automate HTTP trigger URL, then recreate the backend with `docker compose up -d --force-recreate fastapi-app`. Customize the webhook JSON payload in `_notify_allocated_reservation` in `fastapi-backend/database.py`. The `parking_notifications` table records each reservation transaction and marks `is_notified` after Power Automate responds successfully; failed requests can be retried on the next reservation refresh.

RESERVE submissions include `user_id`, `vehicle_type`, `reservation_date`, `reservation_starttime`, `hours`, `preferred_spot_id`, and `purpose`.
Edit `fastapi-backend/parking-config.json` to configure the parking spaces and reservation limits. `parking_spot_ids` is shared by the backend allocator and frontend selector. Set `reservation_limits.default` to a non-negative integer to limit all users, or leave it `null` for no default limit; `reservation_limits.users` can override limits by user ID (case-insensitive). Limits count each user's unreleased reservations whose end time has not passed. After changing the file, restart the backend service. The default configuration leaves reservation counts unlimited.

## Run with Docker Compose

From the repository root, start the frontend and its backend dependencies:

```powershell
docker compose up --build parking
```

Open <http://localhost:5678>. The frontend container serves the built app and proxies `/api/*` requests to the `fastapi-app` Compose service.
