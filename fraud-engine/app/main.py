from __future__ import annotations

import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

SERVICE_KEY = os.environ.get("FRAUD_ENGINE_API_KEY", "")
RULE_DESCRIPTIONS = {
    "duplicate_utr": "This vendor has already submitted this UTR.",
    "amount_mismatch": "The submitted amount differs from the expected amount.",
    "future_date": "The transaction date is in the future.",
    "structuring": "Five or more transactions under INR 500 were ingested within ten minutes.",
    "odd_time": "The transaction occurred between 1:00 AM and 4:00 AM vendor local time.",
    "metadata_tampered": "Screenshot metadata names image-editing software; this is an indicator, not proof of alteration.",
    "metadata_missing": "Uploaded screenshot has no usable capture/device metadata; this is a weak signal, not proof of alteration.",
}


class RiskRule(BaseModel):
    model_config = ConfigDict(extra="forbid")
    rule_code: str = Field(min_length=1, max_length=80)
    score: int = Field(ge=0, le=32767)


class ScoreRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    utr: str = Field(min_length=12, max_length=22)
    amount: str
    expected_amount: str | None = None
    occurred_at: datetime
    now: datetime
    timezone: str = Field(min_length=1, max_length=64)
    duplicate_utr: bool = False
    recent_small_transaction_count: int = Field(ge=0, le=100_000)
    screenshot_metadata: dict[str, object] | None = None
    rules: list[RiskRule] = Field(default_factory=list)


class RiskFactor(BaseModel):
    rule_code: str
    score: int
    description: str


class ScoreResponse(BaseModel):
    risk_score: int
    risk_level: str
    transaction_status: str
    factors: list[RiskFactor]


@asynccontextmanager
async def lifespan(_app: FastAPI):
    if len(SERVICE_KEY) < 32:
        raise RuntimeError("FRAUD_ENGINE_API_KEY must contain at least 32 characters")
    yield


app = FastAPI(
    title="Micro-Vendor Fraud Intelligence Service",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
    lifespan=lifespan,
)


def _decimal(value: str) -> Decimal:
    try:
        amount = Decimal(value)
        if not amount.is_finite():
            raise InvalidOperation
        return amount.quantize(Decimal("0.01"))
    except (InvalidOperation, ValueError):
        raise HTTPException(status_code=422, detail="Amount is invalid.") from None


def _metadata_issue(metadata: dict[str, object] | None) -> str | None:
    if not metadata:
        return "metadata_missing"

    tamper_keys = ("edited", "tampered", "integrity_failed", "exif_mismatch")
    if any(metadata.get(key) is True for key in tamper_keys):
        return "metadata_tampered"

    # These are the fields the evidence processor will populate after image
    # upload is added. Client supplied values remain unverified until then.
    if not metadata.get("captured_at") or not metadata.get("device"):
        return "metadata_missing"
    return None


def score_request(request: ScoreRequest) -> ScoreResponse:
    weights = {rule.rule_code: rule.score for rule in request.rules}
    factors: list[RiskFactor] = []

    def add(code: str) -> None:
        score = weights.get(code)
        if score is not None and score > 0:
            factors.append(RiskFactor(rule_code=code, score=score, description=RULE_DESCRIPTIONS[code]))

    if request.duplicate_utr:
        add("duplicate_utr")

    amount = _decimal(request.amount)
    if request.expected_amount is not None and amount != _decimal(request.expected_amount):
        add("amount_mismatch")

    now = request.now
    occurred_at = request.occurred_at
    if now.tzinfo is None or occurred_at.tzinfo is None:
        raise HTTPException(status_code=422, detail="Timestamps must include a timezone.")
    if occurred_at > now:
        add("future_date")

    if amount < Decimal("500.00") and request.recent_small_transaction_count >= 5:
        add("structuring")

    try:
        local_hour = occurred_at.astimezone(ZoneInfo(request.timezone)).hour
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(status_code=422, detail="Vendor timezone is invalid.") from None
    if 1 <= local_hour < 4:
        add("odd_time")

    metadata_issue = _metadata_issue(request.screenshot_metadata) if request.screenshot_metadata is not None else None
    if metadata_issue:
        add(metadata_issue)

    score = sum(factor.score for factor in factors)
    if score > 60:
        risk_level = "high_risk"
    elif score > 30:
        risk_level = "medium_risk"
    else:
        risk_level = "low_risk"

    # A score is an alert signal, not a final fraud adjudication.
    status = "suspicious" if factors else "valid"
    return ScoreResponse(
        risk_score=score,
        risk_level=risk_level,
        transaction_status=status,
        factors=factors,
    )


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "fraud-engine"}


@app.get("/v1/health")
def authenticated_health(
    x_fraud_engine_key: Annotated[str | None, Header()] = None,
) -> dict[str, str]:
    _require_service_key(x_fraud_engine_key)
    return {"status": "ready", "service": "fraud-engine"}


def _require_service_key(provided_key: str | None) -> None:
    if not SERVICE_KEY or not provided_key or not hmac.compare_digest(SERVICE_KEY, provided_key):
        raise HTTPException(status_code=401, detail="Unauthorized.")


@app.post("/v1/score", response_model=ScoreResponse)
def score(
    request: ScoreRequest,
    x_fraud_engine_key: Annotated[str | None, Header()] = None,
) -> ScoreResponse:
    _require_service_key(x_fraud_engine_key)
    return score_request(request)

