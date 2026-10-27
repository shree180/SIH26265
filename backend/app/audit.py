"""Append-only, hash-chained audit trail.

Each event hashes the previous hash plus a canonical representation of the
event. This detects edits to chained history, but it is NOT immutability: a
privileged actor who can rewrite every row and the head checkpoint could
rebuild a consistent chain. Database-level DELETE/UPDATE grants must therefore
be restricted in production, and the limitation is stated in the UI.
"""

from __future__ import annotations

import hashlib
import json
import threading
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .models import AuditEvent, User, new_id, utcnow

GENESIS_HASH = "0" * 64
CHAIN_LIMITATION = (
    "Hash chaining detects edits to the recorded history. It cannot guarantee "
    "immutability if a privileged actor can rewrite every event and the chain head."
)

# Serialises chain appends inside one process. A multi-instance deployment must
# use a database sequence/advisory lock instead of this lock.
_CHAIN_LOCK = threading.Lock()


def canonical_json(value) -> str:
    return json.dumps(
        value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, default=str
    )


def _timestamp(value: datetime) -> str:
    return value.isoformat(timespec="microseconds") + "Z"


def canonical_event_document(
    *,
    event_id: str,
    actor_id: str | None,
    actor_label: str,
    entity_type: str,
    entity_id: str,
    action: str,
    occurred_at: datetime,
    payload: dict,
) -> str:
    return canonical_json(
        {
            "id": event_id,
            "actor_id": actor_id,
            "actor_label": actor_label,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "action": action,
            "occurred_at": _timestamp(occurred_at),
            "payload": payload,
        }
    )


def compute_event_hash(previous_hash: str, canonical_document: str) -> str:
    return hashlib.sha256((previous_hash + canonical_document).encode("utf-8")).hexdigest()


def record_audit(
    db: Session,
    *,
    actor: User | None,
    entity_type: str,
    entity_id: str,
    action: str,
    payload: dict | None = None,
    occurred_at: datetime | None = None,
) -> AuditEvent:
    """Append an audit event. Callers should already be inside a transaction."""
    payload = payload or {}
    actor_label = actor.email if actor is not None else "system (automated job)"
    occurred = occurred_at or utcnow()

    with _CHAIN_LOCK:
        last = db.execute(
            select(AuditEvent).order_by(AuditEvent.sequence.desc()).limit(1)
        ).scalar_one_or_none()
        previous_hash = last.event_hash if last else GENESIS_HASH
        sequence = (last.sequence + 1) if last else 1
        event_id = new_id()
        document = canonical_event_document(
            event_id=event_id,
            actor_id=actor.id if actor else None,
            actor_label=actor_label,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            occurred_at=occurred,
            payload=payload,
        )
        event = AuditEvent(
            id=event_id,
            sequence=sequence,
            actor_id=actor.id if actor else None,
            actor_label=actor_label,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            event_payload=canonical_json(payload),
            occurred_at=occurred,
            previous_hash=previous_hash,
            event_hash=compute_event_hash(previous_hash, document),
        )
        db.add(event)
        db.flush()
    return event


def verify_chain(db: Session) -> dict:
    events = db.execute(select(AuditEvent).order_by(AuditEvent.sequence.asc())).scalars().all()
    previous_hash = GENESIS_HASH
    expected_sequence = 1
    for event in events:
        if event.sequence != expected_sequence:
            return {
                "valid": False,
                "checked": expected_sequence - 1,
                "broken_event_id": event.id,
                "broken_sequence": event.sequence,
                "reason": f"Expected sequence {expected_sequence}, found {event.sequence}.",
            }
        if event.previous_hash != previous_hash:
            return {
                "valid": False,
                "checked": expected_sequence - 1,
                "broken_event_id": event.id,
                "broken_sequence": event.sequence,
                "reason": "Previous hash does not match the preceding event.",
            }
        try:
            payload = json.loads(event.event_payload)
        except json.JSONDecodeError:
            return {
                "valid": False,
                "checked": expected_sequence - 1,
                "broken_event_id": event.id,
                "broken_sequence": event.sequence,
                "reason": "Event payload is not valid JSON.",
            }
        document = canonical_event_document(
            event_id=event.id,
            actor_id=event.actor_id,
            actor_label=event.actor_label,
            entity_type=event.entity_type,
            entity_id=event.entity_id,
            action=event.action,
            occurred_at=event.occurred_at,
            payload=payload,
        )
        if compute_event_hash(previous_hash, document) != event.event_hash:
            return {
                "valid": False,
                "checked": expected_sequence - 1,
                "broken_event_id": event.id,
                "broken_sequence": event.sequence,
                "reason": "Stored hash does not match the recomputed hash.",
            }
        previous_hash = event.event_hash
        expected_sequence += 1

    return {
        "valid": True,
        "checked": len(events),
        "broken_event_id": None,
        "broken_sequence": None,
        "reason": None,
    }
