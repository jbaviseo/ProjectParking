from typing import List, Dict, Optional

ALL_SPOTS: List[Dict] = [
    {"id": "A-1", "zone": "Executive", "near_elevator": True,  "has_ev": True},
    {"id": "A-2", "zone": "Executive", "near_elevator": True,  "has_ev": False},
    {"id": "B-1", "zone": "General",   "near_elevator": False, "has_ev": True},
    {"id": "B-2", "zone": "General",   "near_elevator": False, "has_ev": False},
    {"id": "B-3", "zone": "General",   "near_elevator": False, "has_ev": False},
]

SPOT_LOOKUP: Dict[str, Dict] = {spot["id"]: spot for spot in ALL_SPOTS}


def rank_candidate_spots(
    preferred_spot_id: Optional[str] = None,
    needs_ev: bool = False
) -> List[Dict]:
    """Sorts all physical spots from highest to lowest match score."""
    def score(spot: Dict) -> int:
        points = 0
        if preferred_spot_id and spot["id"] == preferred_spot_id:
            points += 100
        if needs_ev and spot["has_ev"]:
            points += 50
        if spot["near_elevator"]:
            points += 10
        return points

    return sorted(ALL_SPOTS, key=score, reverse=True)