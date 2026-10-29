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

RESERVE submissions include `user_id`, `vehicle_type`, `reservation_date`, `reservation_starttime`, `hours`, `preferred_spot_id`, and `purpose`.

## Run with Docker Compose

From the repository root, start the frontend and its backend dependencies:

```powershell
docker compose up --build parking-frontend
```

Open <http://localhost:3000>. The frontend container serves the built app and proxies `/api/*` requests to the `fastapi-app` Compose service.
