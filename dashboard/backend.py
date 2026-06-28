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
    log_usage, get_openai_usage, get_cartesia_usage, count_messages,
)
from prompts.hvac_prompt import SYSTEM_PROMPT as HVAC_PROMPT, BEGIN_MESSAGE as HVAC_BEGIN
from prompts.law_firm_prompt import SYSTEM_PROMPT as LAW_PROMPT, BEGIN_MESSAGE as LAW_BEGIN

app = FastAPI(title="North York Voice Agents — Dashboard")

FRONTEND = Path(__file__).parent / "frontend"

AGENTS = {
    "hvac": {
        "prompt": HVAC_PROMPT,
        "begin": HVAC_BEGIN,
        "voice_id": "e98bd614-9b9d-4031-b930-ed72482af858",
    },
    "law_firm": {
        "prompt": LAW_PROMPT,
        "begin": LAW_BEGIN,
        "voice_id": "bf0a246a-8642-498a-9bc5-80c35e9276b5",
    },
}

PER_MINUTE_COMPONENTS = [
    {"service": "Twilio",   "detail": "inbound PSTN",        "cost": 0.0085},
    {"service": "Deepgram", "detail": "Flux STT",             "cost": 0.0077},
    {"service": "Cartesia", "detail": "sonic-2 TTS",          "cost": 0.0300},
    {"service": "OpenAI",   "detail": "gpt-4o-mini LLM",      "cost": 0.0020},
    {"service": "LiveKit",  "detail": "cloud orchestration",  "cost": 0.0004},
    {"service": "OpenAI",   "detail": "post-call analysis",   "cost": 0.0001},
]
TOTAL_PER_MIN = round(sum(c["cost"] for c in PER_MINUTE_COMPONENTS), 4)
AVG_CALL_MIN = 3


class StartRequest(BaseModel):
    agent: str = "law_firm"


class MessageRequest(BaseModel):
    conversation_id: str
    message: str


class TTSRequest(BaseModel):
    text: str
    agent: str = "law_firm"


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

    tokens_in = response.usage.prompt_tokens
    tokens_out = response.usage.completion_tokens
    cost = tokens_in * 0.00000015 + tokens_out * 0.0000006
    log_usage("openai", tokens_in + tokens_out, cost, {
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "conversation_id": req.conversation_id,
    })

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
                "voice": {
                    "mode": "id",
                    "id": voice_id,
                    "__experimental_controls": {"speed": "normal"},
                },
                "output_format": {
                    "container": "mp3",
                    "encoding": "mp3",
                    "sample_rate": 44100,
                },
            },
        )
    if resp.status_code != 200:
        raise HTTPException(status_code=502, detail=f"Cartesia error: {resp.text[:200]}")

    char_count = len(req.text)
    log_usage("cartesia", char_count, char_count * 0.000015, {"agent": req.agent})

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


@app.get("/api/dev/stats")
async def dev_stats():
    oai = get_openai_usage()
    car = get_cartesia_usage()

    services = [
        {
            "name": "OpenAI",
            "status": "ok" if os.environ.get("OPENAI_API_KEY") else "missing",
            "detail": "gpt-4o-mini",
            "purpose": "LLM — agent chat replies",
        },
        {
            "name": "Cartesia",
            "status": "ok" if os.environ.get("CARTESIA_API_KEY") else "missing",
            "detail": "sonic-2",
            "purpose": "Text-to-speech (TTS)",
        },
        {
            "name": "MongoDB",
            "status": "ok",
            "detail": "northyork_agents",
            "purpose": "Conversations, messages & leads",
        },
        {
            "name": "LiveKit",
            "status": "configured" if os.environ.get("LIVEKIT_URL") else "not set",
            "detail": "cloud",
            "purpose": "Voice agent WebRTC",
        },
        {
            "name": "Deepgram",
            "status": "configured" if os.environ.get("DEEPGRAM_API_KEY") else "not set",
            "detail": "Flux model",
            "purpose": "Speech-to-text (STT)",
        },
        {
            "name": "n8n",
            "status": "configured" if os.environ.get("N8N_WEBHOOK_HVAC") else "not set",
            "detail": "webhook",
            "purpose": "Leads → Google Sheets",
        },
    ]

    agents_info = [
        {
            "id": "law_firm",
            "name": "Claire",
            "role": "Law firm receptionist",
            "voice": "Charlotte — elegant young female",
            "model": "gpt-4o-mini",
            "tts_model": "sonic-2 (fast)",
            "tools": ["schedule_consultation", "end_call"],
        },
    ]

    convs = list_conversations(1000)
    leads = list_leads(1000)

    volumes = [
        {"calls": 300,  "label": "300 calls/mo"},
        {"calls": 500,  "label": "500 calls/mo"},
        {"calls": 1000, "label": "1,000 calls/mo"},
    ]
    projections = [
        {
            "label": v["label"],
            "minutes": v["calls"] * AVG_CALL_MIN,
            "pipeline_cost": round(v["calls"] * AVG_CALL_MIN * TOTAL_PER_MIN, 2),
            "hosting_cost": 10.00,
            "total": round(v["calls"] * AVG_CALL_MIN * TOTAL_PER_MIN + 10, 2),
        }
        for v in volumes
    ]

    return {
        "costs": {
            "openai": {
                "cost_usd": round(oai["total_cost"] or 0, 6),
                "tokens_in": oai.get("tokens_in") or 0,
                "tokens_out": oai.get("tokens_out") or 0,
                "calls": oai["calls"],
            },
            "cartesia": {
                "cost_usd": round(car["total_cost"] or 0, 6),
                "characters": car.get("total_chars") or 0,
                "calls": car["calls"],
            },
            "total_usd": round((oai["total_cost"] or 0) + (car["total_cost"] or 0), 6),
        },
        "per_minute": {
            "components": PER_MINUTE_COMPONENTS,
            "total": TOTAL_PER_MIN,
            "avg_call_min": AVG_CALL_MIN,
            "cost_per_call": round(TOTAL_PER_MIN * AVG_CALL_MIN, 4),
            "projections": projections,
        },
        "services": services,
        "agents": agents_info,
        "activity": {
            "conversations": len(convs),
            "active_conversations": sum(1 for c in convs if c["status"] == "active"),
            "total_messages": count_messages(),
            "leads_captured": len(leads),
            "llm_calls": oai["calls"],
            "tts_requests": car["calls"],
        },
    }


app.mount("/static", StaticFiles(directory=FRONTEND / "static"), name="static")


@app.get("/")
async def root():
    return FileResponse(FRONTEND / "index.html")
