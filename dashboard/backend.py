from datetime import datetime, timezone
from pathlib import Path
import os

import httpx
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, Response
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
    "hvac": {
        "prompt": HVAC_PROMPT,
        "begin": HVAC_BEGIN,
        "voice_id": "e98bd614-9b9d-4031-b930-ed72482af858",  # Jasper — Australian male
    },
    "law_firm": {
        "prompt": LAW_PROMPT,
        "begin": LAW_BEGIN,
        "voice_id": "71a7ad14-091c-4e8e-a314-022ece01c121",  # Charlotte — elegant young female
    },
}

class StartRequest(BaseModel):
    agent: str = "hvac"

class MessageRequest(BaseModel):
    conversation_id: str
    message: str

class TTSRequest(BaseModel):
    text: str
    agent: str = "hvac"

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

@app.post("/api/tts")
async def tts(req: TTSRequest):
    if req.agent not in AGENTS:
        raise HTTPException(status_code=400, detail=f"Unknown agent: {req.agent}")
    voice_id = AGENTS[req.agent]["voice_id"]
    api_key = os.environ["CARTESIA_API_KEY"]

    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            "https://api.cartesia.ai/tts/bytes",
            headers={
                "X-API-Key": api_key,
                "Cartesia-Version": "2024-06-10",
                "Content-Type": "application/json",
            },
            json={
                "model_id": "sonic-2",
                "transcript": req.text,
                "voice": {"mode": "id", "id": voice_id},
                "output_format": {
                    "container": "mp3",
                    "encoding": "mp3",
                    "sample_rate": 44100,
                },
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Cartesia error: {resp.text[:200]}")
    return Response(content=resp.content, media_type="audio/mpeg")

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

app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")

@app.get("/")
async def root():
    return FileResponse(FRONTEND / "index.html")
