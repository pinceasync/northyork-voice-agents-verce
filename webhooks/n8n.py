import logging
import httpx

logger = logging.getLogger(__name__)

async def send(url: str, payload: dict) -> None:
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.post(url, json=payload)
            resp.raise_for_status()
            logger.info("n8n webhook delivered — status %s", resp.status_code)
    except Exception as exc:
        logger.error("n8n webhook failed (call continues): %s", exc)
