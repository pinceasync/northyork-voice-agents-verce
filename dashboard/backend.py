from datetime import datetime, timezone
from pathlib import Path
import os

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import openai

from dashboard.mongo_db import (
    create_conversation, end_conversation, get_conversation,
    list_conversations, add_message, get_messages,
    insert_lead, list_leads,
)
from prompts.hvac_prompt import SYSTEM_PROMPT as HVAC_PROMPT, BEGIN_MESSAGE as HVAC_BEGIN
from prompts.law_firm_prompt import SYSTEM_PROMPT as LAW_PROMPT, BEGIN_MESSAGE as LAW_BEGIN

app = FastAPI(title="North York Voice Agents — Dashboard")

FRONTEND = Path(__file__).parent / "frontend"

AGENTS = {
    "hvac": {"prompt": HVAC_PROMPT, "begin": HVAC_BEGIN},
    "law_firm": {"prompt": LAW_PROMPT, "begin": LAW_BEGIN},
}

# ── Chat API ──────────────────────────────────────────────────────────────────

class StartRequest(BaseModel):
    agent: str = "hvac"

class MessageRequest(BaseModel):
    conversation_id: str
    message: str

@app.post("/api/chat/start")
async def chat_start(req: StartRequest):
    if req.agent not in AGENTS:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {req.agent}")
    conversation_id = create_conversation(req.agent)
    begin = AGENTS[req.agent]["begin"]
    add_message(conversation_id, "assistant", begin)
    return {"conversation_id": conversation_id, "message": begin}

@app.post("/api/chat/message")
async def chat_message(req: MessageRequest):
    conv = get_conversation(req.conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    if conv["status"] == "ended":
        raise HTTPException(status_code=400, detail="Conversation has ended")

    add_message(req.conversation_id, "user", req.message)
    history = get_messages(req.conversation_id)

    oai_messages = [{"role": "system", "content": AGENTS[conv["agent"]]["prompt"]}]
    for msg in history:
        oai_messages.append({"role": msg["role"], "content": msg["content"]})

    client = openai.OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=oai_messages,
        temperature=0.4,
    )
    reply = response.choices[0].message.content
    add_message(req.conversation_id, "assistant", reply)

    ended = "have a good one" in reply.lower() or "let you go" in reply.lower()
    if ended:
        end_conversation(req.conversation_id)

    return {"message": reply, "ended": ended}

@app.get("/api/chat/{conversation_id}/history")
async def chat_history(conversation_id: str):
    conv = get_conversation(conversation_id)
    if not conv:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"conversation": conv, "messages": get_messages(conversation_id)}

@app.get("/api/conversations")
async def conversations(limit: int = 50):
    return list_conversations(limit)

@app.get("/api/leads")
async def recent_leads(limit: int = 50):
    return list_leads(limit)

@app.get("/api/stats")
async def stats():
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    convs = list_conversations(500)
    leads = list_leads(500)
    return {
        "calls_today": sum(1 for c in convs if c["started_at"].startswith(today)),
        "consultations_booked": sum(1 for l in leads if l["created_at"].startswith(today)),
    }

# ── Serve frontend ────────────────────────────────────────────────────────────

app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")

@app.get("/")
async def root():
    return FileResponse(FRONTEND / "index.html")
