import unittest
from unittest.mock import MagicMock, patch

import database


class ReservationSimulationTests(unittest.TestCase):
	def setUp(self):
		self.reservations = [
			{
				"id": 1,
				"start_time": "2030-01-01 09:00:00",
				"end_time": "2030-01-01 11:00:00",
				"preferred_spot_id": None,
			},
			{
				"id": 2,
				"start_time": "2030-01-01 09:00:00",
				"end_time": "2030-01-01 11:00:00",
				"preferred_spot_id": None,
			},
		]

	def test_overlapping_reservations_allocate_then_waitlist(self):
		with patch.object(database, "PARKING_SPOT_IDS", ("P1",)):
			states = database._simulate_reservations(self.reservations, [])

		self.assertEqual([state["status"] for state in states], ["ALLOCATED", "WAITLISTED"])
		self.assertEqual([state["spot_id"] for state in states], ["P1", None])

	def test_waitlisted_reservation_is_allocated_after_release_during_window(self):
		events = [{
			"id": 3,
			"ref_transaction_id": 1,
			"action": "RELEASE",
			"created_at": "2030-01-01 02:00:00",
		}]
		with patch.object(database, "PARKING_SPOT_IDS", ("P1",)):
			states = database._simulate_reservations(self.reservations, events)

		self.assertEqual([state["status"] for state in states], ["RELEASED", "ALLOCATED"])

	def test_lifecycle_timestamps_are_converted_from_utc_to_hkt(self):
		self.assertEqual(
			database._parse_lifecycle_datetime("2030-01-01 05:00:00"),
			database.datetime.datetime(2030, 1, 1, 13, 0),
		)

	def test_confirm_records_arrival_for_allocated_reservation(self):
		events = [{
			"id": 3,
			"ref_transaction_id": 1,
			"action": "CONFIRM",
			"created_at": "2030-01-01 09:00:00",
		}]
		with patch.object(database, "PARKING_SPOT_IDS", ("P1",)):
			states = database._simulate_reservations(self.reservations, events)

		self.assertEqual([state["status"] for state in states], ["CONFIRMED", "WAITLISTED"])

	def test_expired_reservation_is_released_without_claiming_a_spot(self):
		reservations = [
			{
				"id": 1,
				"start_time": "2030-01-01 09:00:00",
				"end_time": "2030-01-01 11:00:00",
				"preferred_spot_id": None,
			},
		]

		with patch.object(database, "PARKING_SPOT_IDS", ("P1",)):
			states = database._simulate_reservations(
				reservations,
				[],
				now=database.datetime.datetime(2030, 1, 1, 11, 0),
			)

		self.assertEqual(states[0]["status"], "RELEASED")
		self.assertIsNone(states[0]["spot_id"])

	def test_past_reservation_does_not_get_allocated_on_refresh(self):
		reservations = [
			{
				"id": 1,
				"start_time": "2030-01-01 09:00:00",
				"end_time": "2030-01-01 11:00:00",
				"preferred_spot_id": None,
			},
			{
				"id": 2,
				"start_time": "2030-01-01 09:00:00",
				"end_time": "2030-01-01 11:00:00",
				"preferred_spot_id": None,
			},
		]

		with patch.object(database, "PARKING_SPOT_IDS", ("P1",)):
			states = database._simulate_reservations(
				reservations,
				[],
				now=database.datetime.datetime(2030, 1, 1, 12, 0),
			)

		self.assertEqual([state["status"] for state in states], ["RELEASED", "RELEASED"])
		self.assertEqual([state["spot_id"] for state in states], [None, None])


class ReservationLimitTests(unittest.TestCase):
	def test_parking_config_defines_shared_spots_and_unlimited_default(self):
		spot_ids, default_limit, user_limits = database._load_parking_config()

		self.assertEqual(spot_ids, ("P1", "P2", "P3", "P4", "P5", "P6"))
		self.assertIsNone(default_limit)
		self.assertEqual(user_limits, {})

	def test_unconfigured_reservation_limit_is_unlimited(self):
		with patch.object(database, "DEFAULT_RESERVATION_LIMIT", None), patch.object(
			database, "USER_RESERVATION_LIMITS", {}
		):
			self.assertIsNone(database._check_reservation_limit(MagicMock(), "driver@example.com"))

	def test_per_user_limit_is_case_insensitive_and_counts_only_active_unreleased(self):
		cursor = MagicMock()
		cursor.fetchone.return_value = {"reservation_count": 2}
		now = database.datetime.datetime(2030, 1, 1, 12, 0)
		with patch.object(database, "DEFAULT_RESERVATION_LIMIT", 4), patch.object(
			database, "USER_RESERVATION_LIMITS", {"driver@example.com": 2}
		):
			error = database._check_reservation_limit(cursor, "Driver@Example.com", now)

		self.assertEqual(error, "Maximum of 2 upcoming reservations reached for this user.")
		query, parameters = cursor.execute.call_args.args
		self.assertIn("NOT EXISTS", query)
		self.assertEqual(parameters, ("Driver@Example.com", now))


class AllocationNotificationTests(unittest.TestCase):
	def test_successful_webhook_marks_reservation_notified(self):
		reservation = {
			"id": 42,
			"user_id": "driver@example.com",
			"vehicle_type": "Car",
			"spot_id": "P1",
			"start_time": "2030-01-01 09:00:00",
			"end_time": "2030-01-01 11:00:00",
			"purpose": "Work",
			"priority": 2,
		}
		pool = MagicMock()
		connection = MagicMock()
		pool.getconn.return_value = connection
		cursor_context = MagicMock()
		cursor_context.__enter__.return_value.fetchone.return_value = {"is_notified": False}
		connection.cursor.return_value = cursor_context

		with (
			patch.object(
				database.os,
				"getenv",
				return_value="https://example.test/notify",
			),
			patch.object(database, "get_pool", return_value=pool),
			patch.object(database.httpx, "post") as post,
		):
			database._notify_allocated_reservation(reservation)

		post.assert_called_once()
		payload = post.call_args.kwargs["json"]
		self.assertEqual(payload["event"], "parking.reservation.allocated")
		self.assertEqual(payload["reservation_transaction_id"], 42)
		self.assertEqual(payload["spot_id"], "P1")
		self.assertTrue(any(
			"SET is_notified = TRUE" in call.args[0]
			for call in cursor_context.__enter__.return_value.execute.call_args_list
		))
		connection.commit.assert_called_once()
		pool.putconn.assert_called_once_with(connection)


if __name__ == "__main__":
	unittest.main()
