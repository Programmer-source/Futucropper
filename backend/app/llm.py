"""Server-side LLM call used as a fallback when the browser cannot reach the free model directly.
Order: Claude (only if ANTHROPIC_API_KEY is set) -> Pollinations POST /openai -> Pollinations GET.
Pollinations' free tier allows one reply about every 45 s per IP; on 402/429 we wait the time it asks for once."""
import os
import re
import time
from urllib.parse import quote

import httpx

POLL = "https://text.pollinations.ai"


def _wait_seconds(text: str) -> int:
    m = re.search(r"(\d+)\s*s", text or "")
    return min(50, int(m.group(1)) + 1) if m else 20


def _openrouter(messages):
    key = os.environ.get("OPENROUTER_API_KEY")
    if not key:
        return None
    r = httpx.post("https://openrouter.ai/api/v1/chat/completions", timeout=90,
                   headers={"Authorization": f"Bearer {key}", "HTTP-Referer": "http://localhost:3000",
                            "X-Title": "Follow the Gas"},
                   json={"model": os.environ.get("OPENROUTER_MODEL", "nvidia/nemotron-3.5-lightning:free"),
                         "messages": messages, "max_tokens": 900, "temperature": 0.3, "reasoning": {"enabled": False}})
    r.raise_for_status()
    c = r.json()["choices"][0]["message"]["content"]
    return c.strip() if isinstance(c, str) else None


def _claude(messages):
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    msgs = [m for m in messages if m["role"] != "system"]
    r = httpx.post("https://api.anthropic.com/v1/messages", timeout=60,
                   headers={"x-api-key": key, "anthropic-version": "2023-06-01"},
                   json={"model": os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), "max_tokens": 900,
                         "system": system, "messages": msgs})
    r.raise_for_status()
    return "".join(b.get("text", "") for b in r.json().get("content", []) if b.get("type") == "text").strip()


def _poll_post(messages):
    for attempt in range(2):
        r = httpx.post(f"{POLL}/openai", timeout=90,
                       json={"model": "openai-fast", "messages": messages, "private": True})
        if r.status_code in (402, 429) and attempt == 0:
            time.sleep(_wait_seconds(r.text))
            continue
        r.raise_for_status()
        c = r.json()["choices"][0]["message"]["content"]
        return c.strip() if isinstance(c, str) else None
    return None


def _poll_get(messages):
    system = "\n".join(m["content"] for m in messages if m["role"] == "system")
    user = "\n".join(m["content"] for m in messages if m["role"] == "user")
    r = httpx.get(f"{POLL}/{quote(user[:6000])}", timeout=90,
                  params={"model": "openai-fast", "private": "true", "system": system[:1500]})
    r.raise_for_status()
    return r.text.strip()


def chat(messages):
    errors = []
    for name, fn in (("openrouter", _openrouter), ("claude", _claude), ("pollinations", _poll_post), ("pollinations-get", _poll_get)):
        try:
            text = fn(messages)
            if text:
                return {"text": text, "provider": name}
        except Exception as e:  # noqa: BLE001 - every failure moves on to the next provider
            errors.append(f"{name}: {str(e)[:120]}")
    return {"text": None, "error": "; ".join(errors)}
