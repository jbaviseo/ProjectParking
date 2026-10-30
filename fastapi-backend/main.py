from contextlib import asynccontextmanager
from datetime import date, time, timedelta
from typing import Literal, Optional

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

import database


class ReserveRequest(BaseModel):
    user_id: str = Field(min_length=1)
    vehicle_type: Literal["Motorcycle", "Car"]
    reservation_date: date
    reservation_starttime: time = time(13, 0)
    hours: int = Field(default=9, ge=1, le=24)
    purpose: Optional[str] = None
    preferred_spot_id: Optional[str] = None
    priority: int = Field(default=2, ge=1, le=3)


class ConfirmRequest(BaseModel):
    user_id: str = Field(min_length=1)
    ref_transaction_id: int = Field(gt=0)


class ReleaseRequest(BaseModel):
    user_id: str = Field(min_length=1)
    ref_transaction_id: int = Field(gt=0)
    reason: Optional[str] = None


def _transaction_response(result: dict) -> dict:
    if result.get("success"):
        return result

    error = result.get("error", "The transaction could not be completed.")
    if result.get("error_code") == "database_error":
        raise HTTPException(status_code=500, detail="Database transaction failed.")
    if "not found" in error.lower():
        raise HTTPException(status_code=404, detail=error)
    if "cannot modify" in error.lower():
        raise HTTPException(status_code=403, detail=error)
    if any(term in error.lower() for term in (
        "no spots",
        "maximum",
        "already",
        "no upcoming",
        "no longer actionable",
        "only allocated",
    )):
        raise HTTPException(status_code=409, detail=error)
    raise HTTPException(status_code=422, detail=error)

@asynccontextmanager
async def lifespan(app: FastAPI):
    database.init_db()
    try:
        yield
    finally:
        database.close_pool()


app = FastAPI(
    title="Event-Sourced Parking Ledger API",
    lifespan=lifespan
)

@app.get("/")
def root():
    return { "Hello": "World" }

@app.get("/config")
def get_parking_config():
    """Return frontend-safe parking configuration."""
    return {"parking_spot_ids": database.PARKING_SPOT_IDS}

@app.get("/state")
def get_parking_state(date: str):
    '''Gets state of the parking at a specific time stamp.'''

    # PARAMS: date: str - specific point in time you want to build the parking state for
    # this may be in the past or present.

    # OUTPUT: dict[<parking_spot: str> : <reservation_ids : list>]

    # Get all transactions where start_time is within the week where date is in and
    # and the previous week of that and build the state of the parking based on the transactions

    # TODO: determine whether you want spot-specific reservations or no
    return {"Spot 1" : ["001"]}

@app.get("/reservations")
def get_full_parking_state(
    start_date: Optional[date] = Query(default=None),
    end_date: Optional[date] = Query(default=None),
):
    """Replay transactions and list computed reservation states in a requested window."""
    today = date.today()
    default_start = today - timedelta(days=today.weekday())
    window_start = start_date or default_start
    window_end = end_date or window_start + timedelta(days=14)
    if window_end <= window_start:
        raise HTTPException(status_code=422, detail="end_date must be after start_date.")
    try:
        return database.get_reservations(window_start.isoformat(), window_end.isoformat())
    except Exception as error:
        raise HTTPException(status_code=500, detail="Could not load reservations.") from error

@app.post("/reserve")
def reserve_parking(payload: ReserveRequest):
    """Create a RESERVE transaction, even when it must remain waitlisted."""
    result = database.insert_transaction(
        action="RESERVE",
        user_id=payload.user_id,
        vehicle_type=payload.vehicle_type,
        reservation_date=payload.reservation_date.isoformat(),
        reservation_starttime=payload.reservation_starttime.strftime("%H:%M"),
        hours=payload.hours,
        purpose=payload.purpose,
        preferred_spot_id=payload.preferred_spot_id,
        priority=payload.priority,
    )
    result = _transaction_response(result)
    result.update({"user_id": payload.user_id, "vehicle_type": payload.vehicle_type})
    return result

@app.post("/confirm")
def confirm_parking(payload: ConfirmRequest):
    """Record a driver's arrival for an allocated reservation."""
    result = database.insert_transaction(
        action="CONFIRM",
        user_id=payload.user_id,
        ref_transaction_id=payload.ref_transaction_id,
    )
    return _transaction_response(result)

@app.post("/release")
def release_parking(payload: ReleaseRequest):
    """Create a RELEASE transaction for a reservation, ending its spot claim."""
    result = database.insert_transaction(
        action="RELEASE",
        user_id=payload.user_id,
        ref_transaction_id=payload.ref_transaction_id,
        reason=payload.reason,
    )
    return _transaction_response(result)