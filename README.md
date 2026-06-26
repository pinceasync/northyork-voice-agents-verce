# North York Voice Agents

A production-grade AI voice receptionist system powering inbound phone agents for **North York Law Firm** and **North York HVAC**. Built on an open-source component stack — LiveKit Agents, Deepgram Flux, OpenAI gpt-4o-mini, and Cartesia Sonic-3 — as a cost-efficient alternative to managed platforms like Retell AI.

---

## Table of Contents

1. [What This Does](#what-this-does)
2. [Architecture Overview](#architecture-overview)
3. [Tech Stack](#tech-stack)
4. [Project Structure](#project-structure)
5. [How the Pipeline Works](#how-the-pipeline-works)
6. [Agents](#agents)
   - [Claire — North York Law Firm](#claire--north-york-law-firm)
   - [Dante — North York HVAC](#dante--north-york-hvac)
7. [Prerequisites](#prerequisites)
8. [Environment Variables](#environment-variables)
9. [Local Setup](#local-setup)
10. [Running Locally](#running-locally)
11. [Deploying to Railway](#deploying-to-railway)
12. [Twilio SIP Configuration](#twilio-sip-configuration)
13. [Tool Calls & n8n Webhooks](#tool-calls--n8n-webhooks)
14. [Adding a New Agent](#adding-a-new-agent)
15. [Cost Breakdown](#cost-breakdown)
16. [Testing Calls](#testing-calls)
17. [Troubleshooting](#troubleshooting)

---

## What This Does

When someone calls the North York Law Firm or North York HVAC phone number, this system:

1. Answers the call via Twilio
2. Streams the caller's audio in real-time to Deepgram Flux for transcription
3. Sends the transcript to an LLM (gpt-4o-mini) running the agent's persona and script
4. Streams the LLM response to Cartesia Sonic-3, which synthesises speech in under 90ms
5. Plays the audio back to the caller — with natural turn-taking and barge-in support
6. At the end of the call, fires a webhook to n8n, which saves lead data to Google Sheets

The full pipeline runs in under 500ms end-to-end. The caller experiences a natural, low-latency voice conversation.

---

## Architecture Overview

```
Caller
  │
  │  PSTN call
  ▼
Twilio (+12362018632)
  │
  │  SIP trunk (SRTP/DTLS)
  ▼
LiveKit SIP Server
  │
  │  WebRTC audio stream
  ▼
LiveKit Agent Worker (this repo — Railway)
  │
  ├──► Deepgram Flux (STT)
  │         │
  │         │  Real-time transcript
  │         ▼
  ├──► gpt-4o-mini (LLM)
  │         │
  │         │  Streaming text tokens
  │         ▼
  ├──► Cartesia Sonic-3 (TTS)
  │         │
  │         │  Audio chunks (40–90ms TTFA)
  │         ▼
  └──► LiveKit → Twilio → Caller (audio played back)
  │
  │  On tool call (end of collection)
  ▼
n8n Webhook
  │
  ▼
Google Sheets (lead data saved)
```

---

## Tech Stack

| Component | Technology | Purpose | Cost |
|---|---|---|---|
| **Telephony** | Twilio (SIP trunk) | Receives inbound PSTN calls, routes to LiveKit | $0.0085/min |
| **Orchestration** | LiveKit Agents (Python) | Manages the STT → LLM → TTS loop, turn-taking, interruptions | $0.0004/min |
| **Speech-to-Text** | Deepgram Flux | Streaming ASR with built-in end-of-turn detection | $0.0077/min |
| **LLM** | OpenAI gpt-4o-mini | Runs the agent persona, script, and tool calls | ~$0.0020/min |
| **Text-to-Speech** | Cartesia Sonic-3 | Synthesises speech at 40–90ms time-to-first-audio | $0.0300/min |
| **Post-call analysis** | OpenAI gpt-4o-mini | Extracts structured data from call transcript | ~$0.0001/min |
| **Automation** | n8n (existing) | Receives webhook payload, writes to Google Sheets | Already running |
| **Hosting** | Railway | Runs the agent worker process 24/7 | ~$10/month fixed |
| **Total** | | | **~$0.049/min** |

### Why Each Tool Was Chosen

**LiveKit Agents** — Open source (Apache 2.0), used in production by OpenAI ChatGPT Voice and Meta. The Python Agents SDK handles all real-time WebRTC complexity: audio buffering, codec negotiation, VAD, interruption detection, and turn-taking. Without this, you'd build all of that yourself. As of v1.5 it supports native MCP tool calls and adaptive barge-in handling.

**Deepgram Flux** — Not a general-purpose transcription model. Deepgram builds purpose-built ASR models trained exclusively on voice call audio. Flux specifically is designed for voice agent pipelines — it has model-integrated end-of-turn detection, meaning it signals "the caller has finished speaking" as part of the transcription process rather than relying on a separate silence-detection timer. This is the hardest problem in voice AI and Flux solves it at the model level. At $0.0077/min it is also the cheapest real-time streaming ASR available.

**gpt-4o-mini** — The agent scripts are structured, rule-based call flows. They do not require frontier reasoning. gpt-4o-mini is approximately 100x cheaper than GPT-5.1 per token and handles scripted receptionist flows reliably. The system prompts from Retell transfer with no changes.

**Cartesia Sonic-3** — 40–90ms time-to-first-audio, 4x faster than ElevenLabs. In a phone call, TTS latency is felt directly by the caller as a pause before the agent responds. Cartesia eliminates that gap. At $0.03/min it is also cheaper than ElevenLabs while producing professional, natural-sounding voices. Voice cloning is available if a client wants a custom voice.

---

## Project Structure

```
northyork-voice-agents/
│
├── .env.example              # Template for all required environment variables
├── .gitignore                # Excludes .env, __pycache__, venv, etc.
├── README.md                 # This file
├── requirements.txt          # Python dependencies
├── railway.toml              # Railway deployment config
│
├── main.py                   # Entry point — registers agents and starts the worker
├── config.py                 # Loads and validates environment variables
│
├── agents/
│   ├── __init__.py
│   ├── base_agent.py         # Shared agent logic (turn handling, tool dispatch)
│   ├── law_firm.py           # Claire — North York Law Firm agent
│   └── hvac.py               # Dante — North York HVAC agent
│
├── prompts/
│   ├── law_firm_prompt.py    # Full system prompt for Claire
│   └── hvac_prompt.py        # Full system prompt for Dante
│
├── tools/
│   ├── __init__.py
│   ├── end_call.py           # end_call tool definition
│   ├── schedule_consultation.py  # schedule_consultation tool (law firm)
│   └── extract_lead_data.py  # extract_lead_data tool (HVAC)
│
└── webhooks/
    ├── __init__.py
    └── n8n.py                # Sends POST request to n8n webhook with payload
```

### File Roles

| File | What it does |
|---|---|
| `main.py` | Starts the LiveKit agent worker, maps incoming SIP calls to the correct agent based on the Twilio number dialled |
| `config.py` | Reads all API keys from `.env`, validates none are missing on startup |
| `agents/base_agent.py` | Defines the shared `VoiceAgent` class — STT/LLM/TTS pipeline, interruption handling, tool call routing |
| `agents/law_firm.py` | Instantiates Claire with her voice, prompt, tools, and post-call analysis config |
| `agents/hvac.py` | Instantiates Dante with his voice, prompt, tools, and post-call analysis config |
| `prompts/law_firm_prompt.py` | The full system prompt for Claire — this is where you edit her script, fee guide, and call flow |
| `prompts/hvac_prompt.py` | The full system prompt for Dante — this is where you edit his HVAC script |
| `tools/end_call.py` | Registers the `end_call` function — when called by the LLM, terminates the LiveKit session cleanly |
| `tools/schedule_consultation.py` | Registers `schedule_consultation` — collects structured fields and dispatches to `webhooks/n8n.py` |
| `tools/extract_lead_data.py` | Registers `extract_lead_data` — same pattern for the HVAC lead collection tool |
| `webhooks/n8n.py` | Makes the HTTP POST to n8n with the collected payload. Handles timeouts and errors so a webhook failure doesn't break the call |

---

## How the Pipeline Works

Understanding this helps when debugging or tuning latency.

### Step 1 — Call arrives at Twilio

A caller dials the Twilio number. Twilio's SIP trunk (already configured) forwards the call as a SIP INVITE to the LiveKit SIP server. LiveKit accepts the call and creates a Room.

### Step 2 — Agent worker picks up the call

The agent worker (`main.py`) is connected to LiveKit Cloud and listening for new Rooms. When the call arrives, it inspects the dialled number to determine which agent to load (law firm vs HVAC). The correct agent joins the Room.

### Step 3 — STT (Deepgram Flux)

The caller's audio is streamed in real-time to Deepgram Flux over a WebSocket. Deepgram returns partial transcripts as the caller speaks and fires an `end_of_turn` signal when the caller finishes a sentence. This signal (not a silence timer) is what triggers the LLM.

### Step 4 — LLM (gpt-4o-mini)

The final transcript is appended to the conversation history and sent to gpt-4o-mini. The model streams tokens back as it generates them. The first token typically arrives in 150–250ms.

### Step 5 — TTS (Cartesia Sonic-3)

As LLM tokens stream in, they are forwarded sentence-by-sentence to Cartesia Sonic-3. Cartesia begins synthesising speech before the full LLM response is complete. The first audio chunk is ready in 40–90ms. This LLM→TTS interleaving is what keeps total latency under 500ms.

### Step 6 — Audio played to caller

Cartesia's audio chunks are streamed back through LiveKit → Twilio → PSTN to the caller in real-time.

### Step 7 — Barge-in / interruption

If the caller starts speaking while the agent is talking, Deepgram detects speech, LiveKit interrupts the TTS playback, and the LLM receives the new input. The agent stops mid-sentence, listens, and responds to the interruption naturally.

### Step 8 — Tool calls

When the LLM decides to call `schedule_consultation` or `extract_lead_data`, the function runs on the agent server. The collected fields are POSTed to the n8n webhook. The n8n workflow writes the data to Google Sheets. If the webhook fails (timeout, error), the call continues — the failure is logged but does not break the conversation.

### Step 9 — End call

When the LLM calls `end_call`, the agent plays the sign-off line, waits for TTS to complete, then terminates the LiveKit session. Twilio hangs up the PSTN call.

### Step 10 — Post-call analysis

After the call ends, gpt-4o-mini processes the full call transcript and extracts structured fields (name, matter type, phone number, urgency, etc.). These are logged and can be saved alongside the Google Sheets row.

---

## Agents

### Claire — North York Law Firm

| Property | Value |
|---|---|
| **Agent file** | `agents/law_firm.py` |
| **Prompt file** | `prompts/law_firm_prompt.py` |
| **Persona** | Claire, professional law firm receptionist |
| **Voice** | Cartesia — professional female voice (configurable) |
| **Language** | English (US) |
| **LLM** | gpt-4o-mini |
| **Twilio number** | To be assigned on test number first |

**What Claire does:**
- Answers inbound calls to North York Law Firm
- Classifies caller intent: new matter, fee inquiry, urgent legal matter, existing client, sales/vendor, spam
- Collects: caller name, legal matter type, preferred consultation time, callback number
- Quotes fees from the built-in fee guide (wills, real estate, personal injury, immigration, etc.)
- Treats urgent matters (criminal arrest, emergency custody) with priority and urgency flag
- Confirms all collected details before booking
- Fires `schedule_consultation` with structured payload → n8n → Google Sheets
- Ends call with professional sign-off

**Post-call extracts:** `caller_name`, `legal_matter`, `preferred_datetime`, `phone_number`, `is_urgent`

---

### Dante — North York HVAC

| Property | Value |
|---|---|
| **Agent file** | `agents/hvac.py` |
| **Prompt file** | `prompts/hvac_prompt.py` |
| **Persona** | Dante, HVAC inbound receptionist |
| **Voice** | Cartesia — professional male voice (migrated from 11labs-Noah) |
| **Language** | English (Australian, en-AU) |
| **LLM** | gpt-4o-mini |
| **Twilio number** | +12362018632 (live — do not touch until testing complete) |

**What Dante does:**
- Answers inbound calls to North York HVAC
- Identifies if the caller has an HVAC issue
- Collects: caller name, callback number, problem description
- Reads back all three fields for confirmation
- Fires `extract_lead_data` with structured payload → n8n → Google Sheets
- Signs off and ends the call

**Post-call extracts:** `Name`, `problem`, `phone number`

> **Important:** The HVAC agent is live with a real phone number. Do not migrate it from Retell until the custom stack has been fully tested on a separate test number.

---

## Prerequisites

Before setting up, you will need accounts and API keys for the following services:

| Service | Purpose | Sign up |
|---|---|---|
| LiveKit Cloud | Agent hosting, WebRTC, SIP | cloud.livekit.io |
| Deepgram | Streaming STT (Flux model) | deepgram.com |
| OpenAI | LLM (gpt-4o-mini) + post-call analysis | platform.openai.com |
| Cartesia | TTS (Sonic-3) | cartesia.ai |
| Twilio | Already configured — SIP trunk and numbers | Already active |
| n8n | Already configured — webhook and Google Sheets | Already active |
| Railway | Hosting the agent worker | railway.app |
| Python 3.11+ | Runtime | python.org |

---

## Environment Variables

Copy `.env.example` to `.env` and fill in all values. **Never commit `.env` to git.**

```
# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_api_key
LIVEKIT_API_SECRET=your_livekit_api_secret

# Deepgram
DEEPGRAM_API_KEY=your_deepgram_api_key

# OpenAI
OPENAI_API_KEY=your_openai_api_key

# Cartesia
CARTESIA_API_KEY=your_cartesia_api_key

# n8n Webhooks
N8N_WEBHOOK_LAW_FIRM=https://supremeark21.app.n8n.cloud/webhook/...
N8N_WEBHOOK_HVAC=https://supremeark21.app.n8n.cloud/webhook/1d97ef61-1fe8-475f-8a80-e7d2c446e528

# Twilio (used for routing logic — which number maps to which agent)
TWILIO_NUMBER_LAW_FIRM=+1xxxxxxxxxx
TWILIO_NUMBER_HVAC=+12362018632

# Optional: log level
LOG_LEVEL=INFO
```

---

## Local Setup

```bash
# 1. Clone the repository
git clone https://github.com/your-username/northyork-voice-agents.git
cd northyork-voice-agents

# 2. Create a virtual environment
python3 -m venv .venv
source .venv/bin/activate  # on Windows: .venv\Scripts\activate

# 3. Install dependencies
pip install -r requirements.txt

# 4. Set up environment variables
cp .env.example .env
# Open .env and fill in all API keys

# 5. Verify setup
python main.py --check-config
```

---

## Running Locally

```bash
# Start the agent worker
python main.py

# You should see output like:
# [INFO] LiveKit agent worker started
# [INFO] Listening for inbound SIP calls...
# [INFO] Agent: Claire (law_firm) registered
# [INFO] Agent: Dante (hvac) registered
```

The worker connects to LiveKit Cloud and waits for incoming calls. It does not serve HTTP — it is a persistent WebSocket process.

For local testing with real phone calls, use the LiveKit CLI to tunnel SIP traffic to your local machine, or deploy directly to Railway (recommended).

---

## Deploying to Railway

Railway runs the agent worker as a persistent process — it stays alive 24/7 waiting for calls.

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Create a new project
railway init

# Set environment variables (do this in the Railway dashboard or CLI)
railway variables set LIVEKIT_URL=wss://...
railway variables set LIVEKIT_API_KEY=...
# ... set all variables from .env

# Deploy
railway up
```

Railway will detect `railway.toml` and run `python main.py` as the start command. The worker restarts automatically on crash.

**Estimated Railway cost:** $5–10/month for a worker that handles up to ~50 simultaneous calls.

---

## Twilio SIP Configuration

### For the test number (law firm)

1. In the Twilio Console, go to **Phone Numbers → Manage → your test number**
2. Under **Voice Configuration**, set the call handler to:
   - **SIP Trunk** — select your existing SIP trunk (`retellhvac2632.pstn.twilio.com`)
   - Change the SIP URI to your **LiveKit SIP endpoint** (found in LiveKit Cloud → SIP → Inbound Trunk)
3. Save

The SIP trunk URI format for LiveKit will look like:
```
sip:your-project-id.sip.livekit.cloud
```

### For the HVAC number (after testing is complete)

Follow the same steps for `+12362018632`. Only do this after the new stack has been tested on the test number and confirmed working.

> The HVAC agent currently routes directly to Retell via the SIP trunk. Migrating it means callers will immediately reach the new stack.

---

## Tool Calls & n8n Webhooks

Both agents use LLM tool calls to collect structured data and fire webhooks.

### Law Firm — `schedule_consultation`

Fires when Claire has confirmed all required fields.

**Payload sent to n8n:**
```json
{
  "caller_name": "John Smith",
  "caller_phone": "+14161234567",
  "legal_matter": "personal injury",
  "preferred_datetime": "Tuesday afternoon",
  "is_urgent": false
}
```

### HVAC — `extract_lead_data`

Fires when Dante has confirmed all three fields.

**Payload sent to n8n:**
```json
{
  "caller_name": "Maria Santos",
  "caller_phone": "+14161234567",
  "problem_details": "AC unit not cooling, making grinding noise"
}
```

### Webhook error handling

If the n8n webhook returns a non-200 status or times out (5 second timeout), the error is logged and the call continues normally. The agent does not tell the caller there was an error. The data is also logged server-side so it can be recovered manually if needed.

---

## Adding a New Agent

To add a third agent (e.g. a dentist office, another law firm):

1. **Create the prompt file:** `prompts/new_agent_prompt.py`
   - Define the system prompt as a string constant

2. **Create the agent file:** `agents/new_agent.py`
   - Import `base_agent.py`
   - Set the voice, language, prompt, and tools
   - Register the tool call handler and webhook URL

3. **Register the tools:** `tools/new_tool.py` if the new agent needs a different tool
   - Define the tool name, description, and parameters
   - Wire up the webhook call in `webhooks/n8n.py`

4. **Add the Twilio number mapping** in `main.py`:
   ```python
   AGENT_MAP = {
       os.getenv("TWILIO_NUMBER_LAW_FIRM"): law_firm_agent,
       os.getenv("TWILIO_NUMBER_HVAC"): hvac_agent,
       os.getenv("TWILIO_NUMBER_NEW_AGENT"): new_agent,  # add this
   }
   ```

5. **Add the environment variable** to `.env` and Railway

No other changes needed. The same LiveKit worker handles all agents on different numbers.

---

## Cost Breakdown

### Per-Minute Cost

| Component | Cost/min |
|---|---|
| Twilio inbound (US) | $0.0085 |
| LiveKit Cloud | $0.0004 |
| Deepgram Flux (STT) | $0.0077 |
| gpt-4o-mini (LLM) | $0.0020 |
| Cartesia Sonic-3 (TTS) | $0.0300 |
| gpt-4o-mini post-call | $0.0001 |
| **Total per minute** | **$0.0487** |

### Monthly Estimates

| Volume | This stack | Retell equivalent | Monthly saving |
|---|---|---|---|
| 300 calls × 3 min (900 min) | $44 + $10 hosting = **$54** | $117–$279 | $63–$225 |
| 500 calls × 3 min (1,500 min) | $73 + $10 hosting = **$83** | $195–$465 | $112–$382 |
| 1,000 calls × 3 min (3,000 min) | $146 + $10 hosting = **$156** | $390–$930 | $234–$774 |

---

## Testing Calls

### Before going live

1. Deploy to Railway and confirm the worker starts with `[INFO] Listening for inbound SIP calls...`
2. Buy a $1/month test Twilio number
3. Route the test number to your LiveKit SIP endpoint
4. Call it — you should hear the agent's opening line within 2–3 seconds
5. Talk through the full call flow: new matter → collect fields → confirmation → sign-off
6. Check Google Sheets — the row should appear within 5 seconds of the tool firing
7. Check post-call analysis in your logs

### What to listen for

| Issue | Likely cause |
|---|---|
| No answer / silence | SIP routing config wrong — check LiveKit SIP inbound trunk settings |
| Agent responds slowly (>2 sec) | LLM cold start or Railway sleeping — check worker logs |
| Choppy or robotic audio | Audio codec mismatch between Twilio and LiveKit (μ-law vs OPUS) |
| Agent talks over the caller | Interruption sensitivity too high — tune in `base_agent.py` |
| Agent doesn't stop talking | Barge-in / VAD not configured — check Deepgram Flux end-of-turn settings |
| Tool fires but no Google Sheets row | Check n8n webhook URL in `.env`, check n8n execution logs |

---

## Troubleshooting

### Worker won't start

```
Error: LIVEKIT_API_KEY is not set
```
→ Check your `.env` file. Run `python main.py --check-config` to validate all keys are present.

### SIP call not reaching the agent

→ In LiveKit Cloud, go to **SIP → Inbound Trunks** and verify the trunk is active.
→ In Twilio, verify the SIP URI in the phone number config matches your LiveKit SIP endpoint exactly.
→ Check the LiveKit dashboard for incoming Room creation events.

### Audio goes one way (caller can hear agent but agent can't hear caller, or vice versa)

→ This is a NAT/firewall issue with SIP media. LiveKit handles ICE/STUN automatically — if this happens, check that your Railway deployment is not behind a restrictive firewall. Railway's default networking is open.

### n8n webhook not receiving data

→ Confirm the webhook URL in `.env` is the production webhook URL (not the test URL).
→ In n8n, check **Executions** for any recent runs.
→ Test the webhook manually: `curl -X POST $N8N_WEBHOOK_LAW_FIRM -H "Content-Type: application/json" -d '{"test": true}'`

### Agent sounds robotic or unnatural

→ Try a different Cartesia voice. Cartesia's voice library has 50+ professional voices.
→ Adjust `voice_temperature` in the agent config (0.7–0.9 for more natural variation).

### gpt-4o-mini not following the script reliably

→ Add explicit instruction at the top of the system prompt: `Follow the call flow steps exactly. Do not skip steps or combine them.`
→ Add few-shot examples of the confirmation loop to the prompt.
→ If the agent still improvises: upgrade to gpt-4.1 ($2/$8 per 1M tokens) — it follows structured prompts more tightly.

---

*Built with LiveKit Agents · Deepgram Flux · OpenAI gpt-4o-mini · Cartesia Sonic-3 · Twilio · n8n*
