import os
from dotenv import load_dotenv

load_dotenv()

def _require(key: str) -> str:
    val = os.getenv(key)
    if not val:
        raise RuntimeError(f"Missing required environment variable: {key}")
    return val

LIVEKIT_URL           = _require("LIVEKIT_URL")
LIVEKIT_API_KEY       = _require("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET    = _require("LIVEKIT_API_SECRET")

DEEPGRAM_API_KEY      = _require("DEEPGRAM_API_KEY")
OPENAI_API_KEY        = _require("OPENAI_API_KEY")
CARTESIA_API_KEY      = _require("CARTESIA_API_KEY")

TWILIO_ACCOUNT_SID    = _require("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN     = _require("TWILIO_AUTH_TOKEN")
TWILIO_NUMBER_LAW_FIRM = os.getenv("TWILIO_NUMBER_LAW_FIRM", "")
TWILIO_NUMBER_HVAC     = os.getenv("TWILIO_NUMBER_HVAC", "")

N8N_WEBHOOK_LAW_FIRM  = _require("N8N_WEBHOOK_LAW_FIRM")
N8N_WEBHOOK_HVAC      = _require("N8N_WEBHOOK_HVAC")

LOG_LEVEL             = os.getenv("LOG_LEVEL", "INFO")
