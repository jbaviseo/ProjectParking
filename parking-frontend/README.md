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

The calendar reads real reservations from `/reservations`; it does not display placeholder bookings. The side form posts to `/reserve`, and reservation cards can call `/confirm` and `/release`.

RESERVE submissions include `user_id`, `vehicle_type`, `reservation_date`, `reservation_starttime`, `hours`, `preferred_spot_id`, and `purpose`.
