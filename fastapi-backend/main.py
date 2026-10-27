from fastapi import FastAPI, HTTPException, Query
from contextlib import asynccontextmanager

@asynccontextmanager
async def lifespan(app: FastAPI):
    # on startup
    # initialize database connections pool(?)
    
    yield

    # on shutdown


app = FastAPI(
    title="Event-Sourced Parking Ledger API",
    lifespan=lifespan
)

@app.get("/")
def root():
    return { "Hello": "World" }

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
def get_full_parking_state():
    '''Used to show all the reservations for the current week and the next'''
    pass

@app.post("/reserve")
def reserve_parking():
    # PAYLOAD: user_id: str - email and maybe password run through hash function
    #          reservation_date: str - date when the reservation starts
    #          reservation_starttime: str - time when the reservation starts within the date, defaults to 1 PM
    #          hours: str - hours of stay, defaults to 9
    #          purpose: str - text that notes purpose of visit

    # OUTPUT: JSON[
    #    reservation_id: str - reservation id for release command
    #    reservation_date: str - date when the reservation starts
    #    reservation_starttime: str - time when the reservation starts within the date, defaults to 1 PM
    #    hours: int - hours of stay, defaults to 9
    #    purpose: str - text that notes purpose of visit
    #    spot_allocation: str/None - parking spot allocated if any, waitlisted if None
    # ]

    # Creates a RESERVE record, checks for available parking spots and puts it in spot_allocation
    # CHECKS:
    # Does user already have more than 2 parking reservations?
    # Is the reserve date within next week or this week?
    # Is there an available parking spot to allocate to this reservation?
    return None

@app.post("/confirm")
def confirm_parking():
    # PAYLOAD: user_id: str - email and maybe password run through hash function

    # OUTPUT: JSON[
    #    reservation_id: str - reservation id that was confirmed
    #    reservation_date: str - date when the reservation starts
    #    reservation_starttime: str - time when the reservation starts within the date, defaults to 1 PM
    #    hours: int - hours of stay, defaults to 9
    #    purpose: str - text that notes purpose of visit
    #    spot_allocation: str/None - parking spot allocated if any, waitlisted if None
    # ]

    # Creates a CONFIRM transaction for the reservation_id with closest upcoming
    # reservation_date+reservation_starttime as long as it is x hours from the start

    return None

@app.post("/release")
def release_parking():
    '''Creates a RELEASE transaction matching a RESERVE, cancelling it or ending it early if underway.'''

    # PAYLOAD: user_id: str - user who owns the reservation
    #          ref_transaction_id: int - ID of the RESERVE transaction to release
    #          reason: str/None - optional explanation for the cancellation or early termination

    # OUTPUT: JSON[
    #    success: bool - whether the RELEASE transaction was created
    #    action: str - "RELEASE"
    #    transaction_id: int - ID of the created RELEASE transaction
    #    ref_transaction_id: int - ID of the RESERVE transaction being released
    #    spot_id: str/None - parking spot associated with the reservation
    #    user_id: str - user who owns the reservation
    #    error: str/None - failure reason when success is false
    # ]

    return None