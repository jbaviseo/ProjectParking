import datetime
import os
from pathlib import Path
from typing import Any, Optional

import psycopg2
from psycopg2 import pool
from psycopg2.extensions import make_dsn
from psycopg2.extras import RealDictCursor
from dotenv import load_dotenv


load_dotenv(Path(__file__).resolve().parents[1] / ".env")


def _database_dsn() -> str:
	database_url = os.getenv("DATABASE_URL")
	database_name = os.getenv("POSTGRES_DB", "parking_db")
	if database_url:
		return make_dsn(database_url, dbname=database_name)

	user = os.getenv("POSTGRES_USER")
	password = os.getenv("POSTGRES_PASSWORD")
	if not user or not password:
		raise RuntimeError(
			"Set DATABASE_URL or both POSTGRES_USER and POSTGRES_PASSWORD in the environment."
		)
	return make_dsn(
		user=user,
		password=password,
		dbname=database_name,
		host=os.getenv("POSTGRES_HOST", "localhost"),
		port=os.getenv("POSTGRES_PORT", "5432"),
	)


DATABASE_URL = _database_dsn()
PARKING_SPOT_IDS = tuple(
	spot_id.strip()
	for spot_id in os.getenv("PARKING_SPOT_IDS", "A-1,A-2,B-1,B-2,B-3").split(",")
	if spot_id.strip()
)

db_pool: Optional[pool.ThreadedConnectionPool] = None


def get_pool() -> pool.ThreadedConnectionPool:
	global db_pool
	if db_pool is None:
		db_pool = pool.ThreadedConnectionPool(
			minconn=1,
			maxconn=10,
			dsn=DATABASE_URL,
		)
	return db_pool


def init_db() -> None:
	"""Initialize the PostgreSQL parking transaction ledger and indexes."""
	connection = get_pool().getconn()
	try:
		with connection.cursor() as cursor:
			cursor.execute("""
				CREATE TABLE IF NOT EXISTS parking_transactions (
					id SERIAL PRIMARY KEY,
					action TEXT NOT NULL
						CHECK (action IN ('RESERVE', 'CONFIRM', 'RELEASE', 'BUMP')),
					user_id TEXT NOT NULL,
					vehicle_type TEXT NOT NULL,
					preferred_spot_id TEXT,
					start_time TEXT NOT NULL,
					end_time TEXT NOT NULL,
					ref_transaction_id INTEGER,
					purpose TEXT,
					created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
					spot_id TEXT NOT NULL,
					priority INTEGER NOT NULL DEFAULT 2
				);
			""")
			cursor.execute("""
				CREATE INDEX IF NOT EXISTS idx_parking_transactions_window
				ON parking_transactions(start_time, end_time, action);
			""")
			cursor.execute("""
				CREATE INDEX IF NOT EXISTS idx_parking_transactions_reference
				ON parking_transactions(ref_transaction_id);
			""")
		connection.commit()
	except Exception:
		connection.rollback()
		raise
	finally:
		get_pool().putconn(connection)


def close_pool() -> None:
	"""Close all database connections when the application shuts down."""
	global db_pool
	if db_pool is not None:
		db_pool.closeall()
		db_pool = None


def get_reservations(start_time: str, end_time: str) -> list[dict[str, Any]]:
	"""Return active RESERVE rows overlapping the requested time window."""
	connection = get_pool().getconn()
	try:
		with connection.cursor(cursor_factory=RealDictCursor) as cursor:
			cursor.execute("""
				SELECT reservation.*,
				       COALESCE(
					       LEAST(termination.created_at, reservation.end_time::timestamp),
					       reservation.end_time::timestamp
				       )::text AS effective_end_time,
				       EXISTS (
					       SELECT 1
					       FROM parking_transactions AS confirmation
					       WHERE confirmation.ref_transaction_id = reservation.id
					         AND confirmation.action = 'CONFIRM'
				       ) AS confirmed
				FROM parking_transactions AS reservation
				LEFT JOIN LATERAL (
					SELECT lifecycle.created_at
					FROM parking_transactions AS lifecycle
					WHERE lifecycle.ref_transaction_id = reservation.id
					  AND lifecycle.action IN ('RELEASE', 'BUMP')
					ORDER BY lifecycle.id
					LIMIT 1
				) AS termination ON TRUE
				WHERE reservation.action = 'RESERVE'
				  AND reservation.start_time::timestamp < %s::timestamp
				  AND COALESCE(
					      LEAST(termination.created_at, reservation.end_time::timestamp),
					      reservation.end_time::timestamp
				  ) > %s::timestamp
				  AND COALESCE(
					      LEAST(termination.created_at, reservation.end_time::timestamp),
					      reservation.end_time::timestamp
				  ) > reservation.start_time::timestamp
				ORDER BY reservation.start_time::timestamp, reservation.id;
			""", (end_time, start_time))
			return [dict(row) for row in cursor.fetchall()]
	except Exception:
		connection.rollback()
		raise
	finally:
		get_pool().putconn(connection)


def _parse_start_time(value: str) -> datetime.time:
	try:
		return datetime.time.fromisoformat(value)
	except ValueError:
		for time_format in ("%I:%M %p", "%I %p", "%I%p"):
			try:
				return datetime.datetime.strptime(value, time_format).time()
			except ValueError:
				continue
	raise ValueError("reservation_starttime must be a valid time, such as '13:00' or '1 PM'.")


def _parse_datetime(value: Any) -> datetime.datetime:
	if isinstance(value, datetime.datetime):
		return value
	if isinstance(value, datetime.date):
		return datetime.datetime.combine(value, datetime.time.min)
	return datetime.datetime.fromisoformat(str(value))


def _build_reservation_window(
	reservation_date: Optional[str],
	reservation_starttime: str,
	hours: Any,
	start_time: Any,
	end_time: Any,
) -> tuple[str, str, int]:
	if start_time is not None or end_time is not None:
		if start_time is None or end_time is None:
			raise ValueError("Both start_time and end_time are required.")
		start = _parse_datetime(start_time)
		end = _parse_datetime(end_time)
		duration_hours = int((end - start).total_seconds() // 3600)
		if duration_hours <= 0 or end <= start:
			raise ValueError("end_time must be after start_time by at least one hour.")
		return start.isoformat(sep=" "), end.isoformat(sep=" "), duration_hours

	if reservation_date is None:
		raise ValueError("reservation_date or both start_time and end_time are required.")
	try:
		duration_hours = int(hours)
	except (TypeError, ValueError) as error:
		raise ValueError("hours must be a positive integer.") from error
	if duration_hours <= 0:
		raise ValueError("hours must be a positive integer.")

	date_value = datetime.date.fromisoformat(reservation_date)
	start = datetime.datetime.combine(
		date_value,
		_parse_start_time(reservation_starttime),
	)
	end = start + datetime.timedelta(hours=duration_hours)
	return start.isoformat(sep=" "), end.isoformat(sep=" "), duration_hours


def insert_transaction(
	action: str,
	user_id: str,
	*,
	vehicle_type: Optional[str] = None,
	reservation_date: Optional[str] = None,
	reservation_starttime: str = "1 PM",
	hours: Any = 9,
	purpose: Optional[str] = None,
	preferred_spot_id: Optional[str] = None,
	spot_id: Optional[str] = None,
	priority: int = 2,
	ref_transaction_id: Optional[int] = None,
	reason: Optional[str] = None,
	start_time: Any = None,
	end_time: Any = None,
) -> dict[str, Any]:
	"""Insert a RESERVE, CONFIRM, or RELEASE ledger transaction."""
	action = action.upper()
	if action not in {"RESERVE", "CONFIRM", "RELEASE"}:
		return {"success": False, "error": "action must be RESERVE, CONFIRM, or RELEASE."}
	if not user_id:
		return {"success": False, "error": "user_id is required."}

	start_value = ""
	end_value = ""
	duration_hours = 0
	if action == "RESERVE":
		if not vehicle_type:
			return {"success": False, "error": "vehicle_type is required for a reservation."}
		if not PARKING_SPOT_IDS:
			return {"success": False, "error": "No parking spots are configured."}
		try:
			start_value, end_value, duration_hours = _build_reservation_window(
				reservation_date,
				reservation_starttime,
				hours,
				start_time,
				end_time,
			)
		except (TypeError, ValueError) as error:
			return {"success": False, "error": str(error)}
		if preferred_spot_id and preferred_spot_id not in PARKING_SPOT_IDS:
			return {
				"success": False,
				"error": f"Preferred spot '{preferred_spot_id}' is not configured.",
			}
	elif ref_transaction_id is None and action == "RELEASE":
		return {"success": False, "error": "ref_transaction_id is required for RELEASE."}

	connection = get_pool().getconn()
	try:
		with connection.cursor(cursor_factory=RealDictCursor) as cursor:
			cursor.execute("SELECT pg_advisory_xact_lock(42);")

			if action == "RESERVE":
				cursor.execute("""
					SELECT COUNT(*) AS active_reservations
					FROM parking_transactions AS reservation
					LEFT JOIN LATERAL (
						SELECT lifecycle.created_at
						FROM parking_transactions AS lifecycle
						WHERE lifecycle.ref_transaction_id = reservation.id
						  AND lifecycle.action IN ('RELEASE', 'BUMP')
						ORDER BY lifecycle.id
						LIMIT 1
					) AS termination ON TRUE
					WHERE reservation.action = 'RESERVE'
					  AND reservation.user_id = %s
					  AND COALESCE(
						  LEAST(termination.created_at, reservation.end_time::timestamp),
						  reservation.end_time::timestamp
					  ) > CURRENT_TIMESTAMP
					  AND COALESCE(
						  LEAST(termination.created_at, reservation.end_time::timestamp),
						  reservation.end_time::timestamp
					  ) > reservation.start_time::timestamp;
				""", (user_id,))
				reservation_count = cursor.fetchone()
				if reservation_count is None:
					raise RuntimeError("The active reservation count query returned no result.")
				if reservation_count["active_reservations"] >= 2:
					connection.rollback()
					return {
						"success": False,
						"error": "User already has the maximum of two active reservations.",
					}

				cursor.execute("""
					SELECT spot_id, user_id
					FROM parking_transactions AS reservation
					LEFT JOIN LATERAL (
						SELECT lifecycle.created_at
						FROM parking_transactions AS lifecycle
						WHERE lifecycle.ref_transaction_id = reservation.id
						  AND lifecycle.action IN ('RELEASE', 'BUMP')
						ORDER BY lifecycle.id
						LIMIT 1
					) AS termination ON TRUE
					WHERE action = 'RESERVE'
					  AND start_time::timestamp < %s::timestamp
					  AND COALESCE(
						  LEAST(termination.created_at, reservation.end_time::timestamp),
						  reservation.end_time::timestamp
					  ) > %s::timestamp
					  AND COALESCE(
						  LEAST(termination.created_at, reservation.end_time::timestamp),
						  reservation.end_time::timestamp
					  ) > reservation.start_time::timestamp;
				""", (end_value, start_value))
				occupied_spots = {row["spot_id"] for row in cursor.fetchall()}

				ordered_spots = list(PARKING_SPOT_IDS)
				if preferred_spot_id:
					ordered_spots.remove(preferred_spot_id)
					ordered_spots.insert(0, preferred_spot_id)
				assigned_spot = next(
					(candidate for candidate in ordered_spots if candidate not in occupied_spots),
					None,
				)
				if assigned_spot is None:
					connection.rollback()
					return {"success": False, "error": "No spots are available for this time window."}

				cursor.execute("""
					INSERT INTO parking_transactions
						(action, user_id, vehicle_type, preferred_spot_id,
						 start_time, end_time, purpose, spot_id, priority)
					VALUES ('RESERVE', %s, %s, %s, %s, %s, %s, %s, %s)
					RETURNING id;
				""", (
					user_id,
					vehicle_type,
					preferred_spot_id,
					start_value,
					end_value,
					purpose,
					assigned_spot,
					priority,
				))
				inserted = cursor.fetchone()
				if inserted is None:
					raise RuntimeError("The RESERVE insert did not return a transaction ID.")
				transaction_id = inserted["id"]
				connection.commit()
				return {
					"success": True,
					"action": "RESERVE",
					"transaction_id": transaction_id,
					"reservation_id": transaction_id,
					"reservation_date": start_value.split(" ", 1)[0],
					"reservation_starttime": start_value.split(" ", 1)[1],
					"hours": duration_hours,
					"purpose": purpose,
					"spot_allocation": assigned_spot,
				}

			if ref_transaction_id is None:
				cursor.execute("""
					SELECT reservation.id
					FROM parking_transactions AS reservation
					WHERE reservation.action = 'RESERVE'
					  AND reservation.user_id = %s
					  AND reservation.start_time::timestamp > CURRENT_TIMESTAMP
					  AND NOT EXISTS (
						  SELECT 1 FROM parking_transactions AS event
						  WHERE event.ref_transaction_id = reservation.id
							AND event.action IN ('CONFIRM', 'RELEASE', 'BUMP')
					  )
					ORDER BY reservation.start_time::timestamp
					LIMIT 1;
				""", (user_id,))
				next_reservation = cursor.fetchone()
				if next_reservation is None:
					connection.rollback()
					return {"success": False, "error": "No upcoming reservation is available to confirm."}
				ref_transaction_id = next_reservation["id"]

			cursor.execute("""
				SELECT * FROM parking_transactions
				WHERE id = %s AND action = 'RESERVE';
			""", (ref_transaction_id,))
			reservation = cursor.fetchone()
			if reservation is None:
				connection.rollback()
				return {
					"success": False,
					"error": f"Reservation transaction #{ref_transaction_id} was not found.",
				}
			if reservation["user_id"] != user_id:
				connection.rollback()
				return {"success": False, "error": "Cannot modify another user's reservation."}

			cursor.execute("""
				SELECT action FROM parking_transactions
				WHERE ref_transaction_id = %s
				  AND (
					  action IN ('RELEASE', 'BUMP')
					  OR (%s = 'CONFIRM' AND action = 'CONFIRM')
				  );
			""", (ref_transaction_id, action))
			previous_action = cursor.fetchone()
			if previous_action:
				connection.rollback()
				return {
					"success": False,
					"error": f"Reservation is no longer actionable ({previous_action['action']}).",
				}

			event_purpose = reason if action == "RELEASE" and reason else reservation["purpose"]
			cursor.execute("""
				INSERT INTO parking_transactions
					(action, user_id, vehicle_type, preferred_spot_id,
					 start_time, end_time, ref_transaction_id, purpose,
					 spot_id, priority)
				VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
				RETURNING id;
			""", (
				action,
				user_id,
				reservation["vehicle_type"],
				reservation["preferred_spot_id"],
				reservation["start_time"],
				reservation["end_time"],
				ref_transaction_id,
				event_purpose,
				reservation["spot_id"],
				reservation["priority"],
			))
			inserted = cursor.fetchone()
			if inserted is None:
				raise RuntimeError(f"The {action} insert did not return a transaction ID.")
			transaction_id = inserted["id"]
			connection.commit()
			return {
				"success": True,
				"action": action,
				"transaction_id": transaction_id,
				"ref_transaction_id": ref_transaction_id,
				"spot_id": reservation["spot_id"],
				"user_id": user_id,
				"reservation_date": reservation["start_time"].split(" ", 1)[0],
				"reservation_starttime": reservation["start_time"].split(" ", 1)[1],
				"purpose": event_purpose,
			}
	except Exception as error:
		connection.rollback()
		return {"success": False, "error": str(error), "error_code": "database_error"}
	finally:
		get_pool().putconn(connection)
