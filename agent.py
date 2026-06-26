import logging
import time
from dataclasses import dataclass
from typing import Annotated

import httpx
from livekit.agents import (
    Agent,
    AgentSession,
    RunContext,
    function_tool,
    get_job_context,
)
from livekit.plugins import cartesia, deepgram, openai, silero

import config
from prompts.law_firm_prompt import BEGIN_MESSAGE, SYSTEM_PROMPT
from webhooks import n8n

logger = logging.getLogger(__name__)

DASHBOARD_URL = "http://localhost:8080"


async def _dashboard(path: str, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=2.0) as client:
            await client.post(f"{DASHBOARD_URL}{path}", json=payload)
    except Exception:
        pass  # dashboard is optional — never break the call


@dataclass
class CallState:
    call_id: str = ""
    caller_number: str = ""
    started_at: float = 0.0
    caller_name: str = ""
    caller_phone: str = ""
    legal_matter: str = ""
    preferred_datetime: str = ""
    is_urgent: bool = False
    consultation_booked: bool = False


class LawFirmAgent(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions=SYSTEM_PROMPT,
            stt=deepgram.STT(
                model="nova-3",
                language="en",
                api_key=config.DEEPGRAM_API_KEY,
            ),
            llm=openai.LLM(
                model="gpt-4o-mini",
                api_key=config.OPENAI_API_KEY,
            ),
            tts=cartesia.TTS(
                model="sonic-2",
                voice="79a125e8-cd45-4c13-8a67-188112f4dd22",
                api_key=config.CARTESIA_API_KEY,
            ),
            vad=silero.VAD.load(),
        )

    async def on_enter(self) -> None:
        ctx = self.session
        userdata: CallState = ctx.userdata
        userdata.started_at = time.time()

        job_ctx = get_job_context()
        userdata.call_id = job_ctx.room.name

        participants = job_ctx.room.remote_participants
        if participants:
            first = next(iter(participants.values()))
            userdata.caller_number = getattr(first, "identity", "")

        await _dashboard("/internal/call/start", {
            "call_id": userdata.call_id,
            "agent": "law_firm",
            "caller_number": userdata.caller_number,
        })

        self.session.generate_reply(instructions=BEGIN_MESSAGE)

    @function_tool(
        description=(
            "Record the caller's details and book a consultation once all required fields "
            "are collected and confirmed by the caller."
        )
    )
    async def schedule_consultation(
        self,
        context: RunContext[CallState],
        caller_name: Annotated[str, "Full name of the caller"],
        legal_matter: Annotated[str, "Area of law or matter type, e.g. personal injury, real estate, family law"],
        caller_phone: Annotated[str, "Callback phone number. Leave empty if caller confirmed inbound number is fine."] = "",
        preferred_datetime: Annotated[str, "Preferred consultation date and time, e.g. Tuesday afternoon"] = "",
        is_urgent: Annotated[bool, "True if caller indicated an urgent or emergency legal matter"] = False,
    ) -> str:
        ud = context.userdata
        ud.caller_name = caller_name
        ud.caller_phone = caller_phone
        ud.legal_matter = legal_matter
        ud.preferred_datetime = preferred_datetime
        ud.is_urgent = is_urgent
        ud.consultation_booked = True

        await n8n.send(config.N8N_WEBHOOK_LAW_FIRM, {
            "caller_name": caller_name,
            "caller_phone": caller_phone,
            "legal_matter": legal_matter,
            "preferred_datetime": preferred_datetime,
            "is_urgent": is_urgent,
        })

        await _dashboard("/internal/lead", {
            "call_id": ud.call_id,
            "agent": "law_firm",
            "caller_name": caller_name,
            "caller_phone": caller_phone,
            "legal_matter": legal_matter,
            "preferred_datetime": preferred_datetime,
            "is_urgent": is_urgent,
            "webhook_fired": True,
        })

        logger.info("Consultation booked — name=%s matter=%s urgent=%s", caller_name, legal_matter, is_urgent)
        return "Consultation recorded successfully."

    @function_tool(description="End the call once the conversation is fully complete.")
    async def end_call(self, context: RunContext[CallState]) -> None:
        ud = context.userdata
        duration = int(time.time() - ud.started_at) if ud.started_at else 0

        await _dashboard("/internal/call/end", {
            "call_id": ud.call_id,
            "duration_sec": duration,
        })

        logger.info("end_call — duration=%ds", duration)
        job_ctx = get_job_context()
        await job_ctx.api.room.delete_room(
            api=job_ctx.api,
            delete={"room": job_ctx.room.name},
        )


def build_session() -> AgentSession[CallState]:
    return AgentSession[CallState](userdata=CallState())
