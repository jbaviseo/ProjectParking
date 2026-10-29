import unittest
from unittest.mock import patch

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
		with patch.object(database, "PARKING_SPOT_IDS", ("A-1",)):
			states = database._simulate_reservations(self.reservations, [])

		self.assertEqual([state["status"] for state in states], ["ALLOCATED", "WAITLISTED"])
		self.assertEqual([state["spot_id"] for state in states], ["A-1", None])

	def test_waitlisted_reservation_is_allocated_after_release_during_window(self):
		events = [{
			"id": 3,
			"ref_transaction_id": 1,
			"action": "RELEASE",
			"created_at": "2030-01-01 02:00:00",
		}]
		with patch.object(database, "PARKING_SPOT_IDS", ("A-1",)):
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
		with patch.object(database, "PARKING_SPOT_IDS", ("A-1",)):
			states = database._simulate_reservations(self.reservations, events)

		self.assertEqual([state["status"] for state in states], ["CONFIRMED", "WAITLISTED"])


if __name__ == "__main__":
	unittest.main()
