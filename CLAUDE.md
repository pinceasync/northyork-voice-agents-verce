# North York Voice Agents — Claude Code Context

## What this project is
A dashboard for two AI voice receptionists built on Retell AI, being migrated to a custom LiveKit/OpenAI/Cartesia stack.

- **Dante** — HVAC receptionist (Australian male voice)
- **Claire** — Law firm receptionist (young female voice)

The dashboard lets you test both agents via a chat UI with optional TTS playback.

## Repo
`pinceasync/northyork-voice-agents-verce` — this is the repo Vercel is connected to.
The other repo (`northyork-voice-agents`) exists but is NOT what Vercel deploys from.

## Live URL
https://northyork-voice-agents-verce.vercel.app

## Stack
- **Frontend**: Tailwind CSS single-page app — two tabs (Overview, Test Agent)
- **Backend**: FastAPI (`dashboard/backend.py`) deployed on Vercel as serverless
- **Database**: MongoDB Atlas (`northyork_agents` db, collections: `conversations`, `messages`, `leads`)
- **LLM**: OpenAI `gpt-4o-mini` for chat replies
- **TTS**: Cartesia `sonic-2` model via `/api/tts` endpoint
- **Voice pipeline**: LiveKit + Deepgram + Cartesia (in `worker.py`, NOT deployed to Vercel)

## Key files
| File | Purpose |
|------|---------|
| `dashboard/backend.py` | FastAPI app — all API routes + TTS endpoint |
| `dashboard/mongo_db.py` | MongoDB helpers (conversations, messages, leads) |
| `dashboard/frontend/index.html` | Two-tab UI |
| `dashboard/frontend/static/app.js` | Frontend JS — chat logic, Web Audio ambience |
| `prompts/hvac_prompt.py` | Dante's full system prompt + begin message |
| `prompts/law_firm_prompt.py` | Claire's full system prompt + begin message |
| `pyproject.toml` | Vercel entrypoint: `dashboard.backend:app` |
| `worker.py` | LiveKit agent runner (NOT served by Vercel) |

## Vercel environment variables (all set in Vercel dashboard)
```
OPENAI_API_KEY       — gpt-4o-mini for chat, user's new key
MONGODB_URI          — mongodb+srv://szabolcshungarian23_db_user@cluster0.ocbhahe.mongodb.net/
CARTESIA_API_KEY     — sk_car_rXby5SiHBALFb9tt2K2coZ  (add this if not yet set)
DB_PATH              — /tmp/calls.db
```
MongoDB password: `NorthYork2026`

## Cartesia voice IDs
- Dante (HVAC): `e98bd614-9b9d-4031-b930-ed72482af858` — Jasper, Australian male
- Claire (Law): `71a7ad14-091c-4e8e-a314-022ece01c121` — Charlotte, elegant young female

## Retell AI
- Old key: `key_ef8743ec3b22e19cc9cbd63875ee`
- New key: `key_3cafc02ce4e3baa92c87778d034f`
- Dante LLM ID: `llm_867a3fe8368eb120af7de26d839d`
- Claire LLM ID: `llm_918a3eb4ec744b492bdb9337a220`

## Audio features (dashboard/frontend/static/app.js)
- Voice toggle button (🔇/🔊) in chat tab
- When voice is ON and agent is speaking:
  - Office room tone (lowpass pink noise + 60Hz AC hum) fades in
  - Random keyboard bursts every 3–9 seconds in background
  - Both stop when agent finishes speaking
- Ambient sounds are tied to `audio.onplay` / `audio.onended` of TTS playback

## API routes
| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/chat/start` | Start a new conversation, returns greeting |
| POST | `/api/chat/message` | Send user message, returns agent reply |
| POST | `/api/tts` | Convert text to Cartesia MP3 audio |
| GET | `/api/chat/{id}/history` | Fetch conversation + messages |
| GET | `/api/conversations` | List all conversations |
| GET | `/api/leads` | List all captured leads |
| GET | `/api/stats` | Calls today + leads today |

## Known issues / next steps
- `CARTESIA_API_KEY` must be set in Vercel env vars (may not be set yet — check)
- MongoDB Atlas Network Access must have `0.0.0.0/0` whitelisted for Vercel's dynamic IPs
- `worker.py` (LiveKit pipeline) is separate infrastructure, not on Vercel

## How to deploy changes
Push to `main` branch of this repo — Vercel auto-deploys.
Or use the GitHub API directly (as done in this session).
