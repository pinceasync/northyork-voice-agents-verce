import logging
import os

from dotenv import load_dotenv
load_dotenv()

from livekit.agents import WorkerOptions, cli
from livekit.agents import JobContext, JobProcess

import config
from agent import LawFirmAgent, build_session

logging.basicConfig(
    level=getattr(logging, config.LOG_LEVEL, logging.INFO),
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


async def entrypoint(ctx: JobContext) -> None:
    logger.info("Incoming call — room: %s", ctx.room.name)
    await ctx.connect()

    session = build_session()
    await session.start(ctx.room, agent=LawFirmAgent())
    logger.info("Agent session started")


def prewarm(proc: JobProcess) -> None:
    from livekit.plugins import silero
    proc.userdata["vad"] = silero.VAD.load()


if __name__ == "__main__":
    cli.run_app(
        WorkerOptions(
            entrypoint_fnc=entrypoint,
            prewarm_fnc=prewarm,
            api_key=config.LIVEKIT_API_KEY,
            api_secret=config.LIVEKIT_API_SECRET,
            ws_url=config.LIVEKIT_URL,
        )
    )
