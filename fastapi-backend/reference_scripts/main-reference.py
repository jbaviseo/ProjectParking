from contextlib import asynccontextmanager
from datetime import datetime, timedelta
from typing import Optional
from fastapi import FastAPI, HTTPException, Query

from models import ReserveRequest, ActionByReferenceRequest
import database as db


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    yield


app = FastAPI(
    title="Event-Sourced Parking Ledger API",
    lifespan=lifespan
)


@app.get("/state")
def get_parking_state(
    start_time: Optional[str] = Query(
        None, description="ISO start timestamp (defaults to now)"
    ),
    end_time: Optional[str] = Query(
        None, description="ISO end timestamp (defaults to +1 hour)"
    ),
):
    """
    Dynamically builds the parking lot dictionary state from the transaction ledger
    for the requested time window.
    """
    now = datetime.now()
    resolved_start = start_time or now.strftime("%Y-%m-%dT%H:%M:%S")
    resolved_end = end_time or (now + timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S")

    if resolved_start >= resolved_end:
        raise HTTPException(status_code=400, detail="start_time must be earlier than end_time.")

    return db.build_parking_state(start_time=resolved_start, end_time=resolved_end)


@app.post("/reserve")
def create_reservation(payload: ReserveRequest):
    """Automatically assigns the highest-scoring spot and logs a RESERVE transaction."""
    if payload.start_time >= payload.end_time:
        raise HTTPException(status_code=400, detail="start_time must be earlier than end_time.")

    result = db.reserve_spot(
        user_id=payload.user_id,
        start_time=payload.start_time,
        end_time=payload.end_time,
        preferred_spot_id=payload.preferred_spot_id,
        needs_ev=payload.needs_ev,
        priority=payload.priority,
    )
    if not result["success"]:
        raise HTTPException(status_code=409, detail=result["error"])
    return result


@app.post("/confirm")
def confirm_arrival(payload: ActionByReferenceRequest):
    """Logs a CONFIRM transaction against an existing reservation."""
    result = db.append_lifecycle_action(
        action="CONFIRM",
        user_id=payload.user_id,
        ref_transaction_id=payload.ref_transaction_id,
        reason=payload.reason,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


@app.post("/release")
def release_spot(payload: ActionByReferenceRequest):
    """Logs a RELEASE transaction to free a reserved or confirmed spot."""
    result = db.append_lifecycle_action(
        action="RELEASE",
        user_id=payload.user_id,
        ref_transaction_id=payload.ref_transaction_id,
        reason=payload.reason,
    )
    if not result["success"]:
        raise HTTPException(status_code=400, detail=result["error"])
    return result