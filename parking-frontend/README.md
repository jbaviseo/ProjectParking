# Parkside reservations

React weekly calendar for the parking reservation API.

## Run locally

```powershell
cd parking-frontend
npm install
npm run dev
```

The Vite dev server proxies `/api/*` to `http://localhost:8000/*`. Start the FastAPI backend separately. Set `VITE_API_BASE_URL` to change the API prefix; see `.env.example`.

The current `/reservations` and `/reserve` handlers in `fastapi-backend/main.py` are placeholders. Until they return real data, the calendar shows clearly labeled sample bookings and displays the response from a reservation submission without claiming success when the API does not confirm it.

RESERVE submissions include `user_id`, `vehicle_type`, `reservation_date`, `reservation_starttime`, `hours`, `preferred_spot_id`, and `purpose`.
