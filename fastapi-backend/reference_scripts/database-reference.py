import os
import datetime
from typing import Dict, Any, Optional
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor
from spots import ALL_SPOTS, SPOT_LOOKUP, rank_candidate_spots

# Read DATABASE_URL from Docker Compose environment variable with a local fallback
DATABASE_URL = os.getenv(
    "DATABASE_URL", 
    "postgresql://user:password@localhost:5432/parking_db"
)

# Initialize a thread-safe connection pool for FastAPI
db_pool = None


def get_pool():
    global db_pool
    if db_pool is None:
        db_pool = psycopg2.pool.ThreadedConnectionPool(
            minconn=1,
            maxconn=10,
            dsn=DATABASE_URL
        )
    return db_pool


def init_db() -> None:
    """Initializes the append-only transaction table and indexes in PostgreSQL."""
    conn = get_pool().getconn()
    try:
        with conn.cursor() as cursor:
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS parking_transactions (
                    id SERIAL PRIMARY KEY,
                    spot_id VARCHAR(50) NOT NULL,
                    user_id VARCHAR(255) NOT NULL,
                    action VARCHAR(20) NOT NULL CHECK(action IN ('RESERVE', 'CONFIRM', 'RELEASE', 'BUMP')),
                    priority INTEGER DEFAULT 3,
                    preferred_spot_id VARCHAR(50),
                    start_time TIMESTAMP NOT NULL,
                    end_time TIMESTAMP NOT NULL,
                    ref_transaction_id INTEGER,
                    reason TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                );
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_tx_window 
                ON parking_transactions(start_time, end_time, action);
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_tx_ref 
                ON parking_transactions(ref_transaction_id);
            """)
            conn.commit()
    finally:
        get_pool().putconn(conn)


def _format_dt(val: Any) -> Optional[str]:
    """Helper to ensure timestamps are serialized cleanly as ISO strings."""
    if isinstance(val, (datetime.datetime, datetime.date)):
        return val.isoformat()
    return val


def build_parking_state(
    start_time: str,
    end_time: str
) -> Dict[str, Any]:
    """
    Replays all ledger transactions overlapping [start_time, end_time]
    to dynamically build the current state dictionary in memory.
    """
    spots_state: Dict[str, Dict[str, Any]] = {
        spot["id"]: {
            "spot_id": spot["id"],
            "zone": spot["zone"],
            "near_elevator": spot["near_elevator"],
            "has_ev": spot["has_ev"],
            "status": "AVAILABLE",      # AVAILABLE | RESERVED | CONFIRMED
            "occupant": None,
            "priority": None,
            "reservation_tx_id": None,
            "preferred_spot_id": None,
            "window_start": None,
            "window_end": None,
        }
        for spot in ALL_SPOTS
    }

    conn = get_pool().getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            # Fetch overlapping reserves and any lifecycle events referencing them
            cursor.execute("""
                WITH overlapping_reserves AS (
                    SELECT id FROM parking_transactions
                    WHERE action = 'RESERVE'
                      AND start_time < %s
                      AND end_time > %s
                )
                SELECT * FROM parking_transactions
                WHERE id IN (SELECT id FROM overlapping_reserves)
                   OR ref_transaction_id IN (SELECT id FROM overlapping_reserves)
                ORDER BY id ASC;
            """, (end_time, start_time))

            transactions = cursor.fetchall()

            reservations_by_id: Dict[int, Dict[str, Any]] = {}

            # Replay transactions sequentially
            for tx in transactions:
                action = tx["action"]
                spot_id = tx["spot_id"]

                if action == "RESERVE":
                    reservations_by_id[tx["id"]] = tx
                    if spot_id in spots_state:
                        spots_state[spot_id].update({
                            "status": "RESERVED",
                            "occupant": tx["user_id"],
                            "priority": tx["priority"],
                            "reservation_tx_id": tx["id"],
                            "preferred_spot_id": tx["preferred_spot_id"],
                            "window_start": _format_dt(tx["start_time"]),
                            "window_end": _format_dt(tx["end_time"]),
                        })

                elif action == "CONFIRM":
                    ref_id = tx["ref_transaction_id"]
                    if ref_id in reservations_by_id:
                        target_spot = reservations_by_id[ref_id]["spot_id"]
                        if spots_state[target_spot]["reservation_tx_id"] == ref_id:
                            spots_state[target_spot]["status"] = "CONFIRMED"

                elif action in ("RELEASE", "BUMP"):
                    ref_id = tx["ref_transaction_id"]
                    if ref_id in reservations_by_id:
                        target_spot = reservations_by_id[ref_id]["spot_id"]
                        if spots_state[target_spot]["reservation_tx_id"] == ref_id:
                            spots_state[target_spot].update({
                                "status": "AVAILABLE",
                                "occupant": None,
                                "priority": None,
                                "reservation_tx_id": None,
                                "preferred_spot_id": None,
                                "window_start": None,
                                "window_end": None,
                            })

        summary = {
            "total_spots": len(ALL_SPOTS),
            "available": sum(1 for s in spots_state.values() if s["status"] == "AVAILABLE"),
            "reserved": sum(1 for s in spots_state.values() if s["status"] == "RESERVED"),
            "confirmed": sum(1 for s in spots_state.values() if s["status"] == "CONFIRMED"),
        }

        return {
            "window": {"start_time": start_time, "end_time": end_time},
            "summary": summary,
            "spots": spots_state,
            "ledger_events_replayed": len(transactions),
        }
    finally:
        get_pool().putconn(conn)


def reserve_spot(
    user_id: str,
    start_time: str,
    end_time: str,
    preferred_spot_id: Optional[str] = None,
    needs_ev: bool = False,
    priority: int = 1
) -> Dict[str, Any]:
    """
    Atomically evaluates spot state, bumps lower-priority reservations if needed,
    and appends a RESERVE transaction using Postgres advisory locking.
    """
    if preferred_spot_id and preferred_spot_id not in SPOT_LOOKUP:
        return {"success": False, "error": f"Preferred spot '{preferred_spot_id}' does not exist."}

    conn = get_pool().getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            # Transaction-level advisory lock serializes slot allocation across workers
            cursor.execute("SELECT pg_advisory_xact_lock(42);")

            # Check active claims in the requested window
            cursor.execute("""
                SELECT r.spot_id, r.id, r.priority, r.user_id,
                       EXISTS (
                           SELECT 1 FROM parking_transactions c
                           WHERE c.action = 'CONFIRM' AND c.ref_transaction_id = r.id
                       ) AS is_confirmed
                FROM parking_transactions r
                WHERE r.action = 'RESERVE'
                  AND r.start_time < %s
                  AND r.end_time > %s
                  AND NOT EXISTS (
                      SELECT 1 FROM parking_transactions x
                      WHERE x.action IN ('RELEASE', 'BUMP')
                        AND x.ref_transaction_id = r.id
                  );
            """, (end_time, start_time))

            active_claims: Dict[str, Dict[str, Any]] = {
                row["spot_id"]: dict(row) for row in cursor.fetchall()
            }

            # Enforce 1 spot per user rule within this window
            for claim in active_claims.values():
                if claim["user_id"] == user_id:
                    conn.rollback()
                    return {
                        "success": False,
                        "error": f"User already holds an active reservation (tx #{claim['id']}) on spot {claim['spot_id']}."
                    }

            candidates = rank_candidate_spots(preferred_spot_id=preferred_spot_id, needs_ev=needs_ev)
            chosen_spot: Optional[str] = None
            bumped_record: Optional[Dict[str, Any]] = None

            # Pass 1: Grab first unoccupied preferred candidate
            for spot in candidates:
                if spot["id"] not in active_claims:
                    chosen_spot = spot["id"]
                    break

            # Pass 2: VIP Preemption of unconfirmed bookings
            if not chosen_spot and priority > 1:
                for spot in candidates:
                    claim = active_claims[spot["id"]]
                    if priority > claim["priority"] and not claim["is_confirmed"]:
                        chosen_spot = spot["id"]
                        bumped_record = claim

                        cursor.execute("""
                            INSERT INTO parking_transactions
                            (spot_id, user_id, action, priority, start_time, end_time, ref_transaction_id, reason)
                            VALUES (%s, %s, 'BUMP', %s, %s, %s, %s, %s);
                        """, (
                            chosen_spot,
                            claim["user_id"],
                            priority,
                            start_time,
                            end_time,
                            claim["id"],
                            f"Bumped by higher-priority user {user_id}"
                        ))
                        break

            if not chosen_spot:
                conn.rollback()
                return {"success": False, "error": "No spots available for the requested time window."}

            # Insert RESERVE transaction and fetch generated ID
            cursor.execute("""
                INSERT INTO parking_transactions
                (spot_id, user_id, action, priority, preferred_spot_id, start_time, end_time)
                VALUES (%s, %s, 'RESERVE', %s, %s, %s, %s)
                RETURNING id;
            """, (chosen_spot, user_id, priority, preferred_spot_id, start_time, end_time))

            new_tx_id = cursor.fetchone()["id"]
            conn.commit()

            return {
                "success": True,
                "transaction_id": new_tx_id,
                "assigned_spot": chosen_spot,
                "preferred_spot_requested": preferred_spot_id,
                "got_preferred": (chosen_spot == preferred_spot_id) if preferred_spot_id else True,
                "bumped_user": bumped_record["user_id"] if bumped_record else None,
                "bumped_transaction_id": bumped_record["id"] if bumped_record else None,
            }

    except Exception as e:
        conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        get_pool().putconn(conn)


def append_lifecycle_action(
    action: str,
    user_id: str,
    ref_transaction_id: int,
    reason: Optional[str] = None
) -> Dict[str, Any]:
    """Appends a CONFIRM or RELEASE transaction referencing an active RESERVE transaction."""
    if action not in ("CONFIRM", "RELEASE"):
        return {"success": False, "error": "Invalid lifecycle action."}

    conn = get_pool().getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cursor:
            # Lock transaction to avoid double releases/confirms
            cursor.execute("SELECT pg_advisory_xact_lock(42);")

            cursor.execute("""
                SELECT * FROM parking_transactions
                WHERE id = %s AND action = 'RESERVE';
            """, (ref_transaction_id,))
            parent = cursor.fetchone()

            if not parent:
                conn.rollback()
                return {"success": False, "error": f"Reservation transaction #{ref_transaction_id} not found."}

            if parent["user_id"] != user_id:
                conn.rollback()
                return {"success": False, "error": "Cannot modify another user's reservation."}

            # Check if reservation was already released or bumped
            cursor.execute("""
                SELECT action FROM parking_transactions
                WHERE ref_transaction_id = %s AND action IN ('RELEASE', 'BUMP');
            """, (ref_transaction_id,))
            terminated = cursor.fetchone()

            if terminated:
                conn.rollback()
                return {
                    "success": False,
                    "error": f"Reservation #{ref_transaction_id} is no longer active (already {terminated['action']})."
                }

            cursor.execute("""
                INSERT INTO parking_transactions
                (spot_id, user_id, action, priority, start_time, end_time, ref_transaction_id, reason)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id;
            """, (
                parent["spot_id"],
                user_id,
                action,
                parent["priority"],
                parent["start_time"],
                parent["end_time"],
                ref_transaction_id,
                reason
            ))

            action_tx_id = cursor.fetchone()["id"]
            conn.commit()

            return {
                "success": True,
                "action": action,
                "transaction_id": action_tx_id,
                "ref_transaction_id": ref_transaction_id,
                "spot_id": parent["spot_id"],
                "user_id": user_id,
            }
    except Exception as e:
        conn.rollback()
        return {"success": False, "error": str(e)}
    finally:
        get_pool().putconn(conn)

'''

CREATE TABLE parking_transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action TEXT NOT NULL,               -- 'RESERVE', 'CONFIRM', 'RELEASE', 'BUMP'
    user_id TEXT NOT NULL,
    vehicle_type TEXT NOT NULL          -- VEHICLETYPE: 'Motorcycle', 'Car'
    preferred_spot_id TEXT,             -- What they requested (e.g., 'A-1')
    start_time TEXT NOT NULL,           -- RESERVATION DATE (DATE AND TIME)
    end_time TEXT NOT NULL,             -- RESERVATION DATE (DATE AND TIME)                
    ref_transaction_id INTEGER,
    reason TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
    spot_id TEXT NOT NULL,              -- The actual assigned spot (e.g., 'A-2') -- confirmation only if a spot was assigned
    priority INTEGER DEFAULT 1,         -- 1 = Staff, 2 = VIP -- removed since priority is computed on the fly

);

Reservation Date
Employee
Vehicle Type
Status
Shift
Purpose
'''