from pydantic import BaseModel, Field
from typing import Optional


class ReserveRequest(BaseModel):
    user_id: str = Field(..., example="alex.rivera@company.com")
    start_time: str = Field(..., example="2026-10-27T09:00:00")
    end_time: str = Field(..., example="2026-10-27T17:00:00")
    preferred_spot_id: Optional[str] = Field(None, example="A-1")
    needs_ev: bool = Field(False, example=True)
    priority: int = Field(1, description="1 = Standard Staff, 2 = VIP")


class ActionByReferenceRequest(BaseModel):
    user_id: str = Field(..., example="alex.rivera@company.com")
    ref_transaction_id: int = Field(..., example=12)
    reason: Optional[str] = Field(None, example="Leaving early")