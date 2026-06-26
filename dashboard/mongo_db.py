from pymongo import MongoClient
from datetime import datetime, timezone
import os

_client = None

def _db():
    global _client
    if _client is None:
        _client = MongoClient(os.environ["MONGODB_URI"])
    return _client["northyork_agents"]

def create_conversation(agent: str) -> str:
    result = _db().conversations.insert_one({
        "agent": agent,
        "status": "active",
        "started_at": _now(),
        "ended_at": None,
    })
    return str(result.inserted_id)

def end_conversation(conversation_id: str) -> None:
    from bson import ObjectId
    _db().conversations.update_one(
        {"_id": ObjectId(conversation_id)},
        {"$set": {"status": "ended", "ended_at": _now()}}
    )

def get_conversation(conversation_id: str) -> dict | None:
    from bson import ObjectId
    doc = _db().conversations.find_one({"_id": ObjectId(conversation_id)})
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc

def list_conversations(limit: int = 50) -> list[dict]:
    docs = list(_db().conversations.find().sort("started_at", -1).limit(limit))
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs

def add_message(conversation_id: str, role: str, content: str) -> None:
    _db().messages.insert_one({
        "conversation_id": conversation_id,
        "role": role,
        "content": content,
        "timestamp": _now(),
    })

def get_messages(conversation_id: str) -> list[dict]:
    return list(_db().messages.find(
        {"conversation_id": conversation_id}, {"_id": 0}
    ).sort("timestamp", 1))

def insert_lead(conversation_id: str, agent: str, caller_name: str,
                caller_phone: str, problem_details: str) -> None:
    _db().leads.insert_one({
        "conversation_id": conversation_id,
        "agent": agent,
        "caller_name": caller_name,
        "caller_phone": caller_phone,
        "problem_details": problem_details,
        "created_at": _now(),
    })

def list_leads(limit: int = 50) -> list[dict]:
    docs = list(_db().leads.find().sort("created_at", -1).limit(limit))
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs

def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
