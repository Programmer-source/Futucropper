"use client";
/** One function, askAI(messages), that keeps trying until a real LLM answers:
 *   1. the backend (/api/llm) when it holds a Claude key
 *   2. Pollinations from the browser: POST /openai (private) -> GET /{prompt}; on the free-tier limit
 *      ("1 reply every 45 seconds per IP", HTTP 402/429) it waits the seconds the server asks for and retries
 *   3. the backend proxy /api/llm (server-side request: works where the browser origin is blocked, e.g. HTTP 403)
 *  Calls are queued so the page never sends two at once (the free tier allows one at a time). */
import { API_URL } from "./api";

export type Msg = { role: "system" | "user" | "assistant"; content: string };
type Status = (s: { kind: "thinking" } | { kind: "waiting"; seconds: number }) => void;

const POLL = "https://text.pollinations.ai";
let queue: Promise<unknown> = Promise.resolve();

function waitSeconds(text: string) {
  const m = /(\d+)\s*s/.exec(text);
  return Math.min(50, m ? Number(m[1]) + 1 : 20);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withTimeout<T>(fn: (s: AbortSignal) => Promise<T>, ms: number) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try { return await fn(ctrl.signal); } finally { clearTimeout(timer); }
}

class Busy extends Error { constructor(public seconds: number) { super("busy"); } }

async function pollPost(messages: Msg[]) {
  return withTimeout(async (signal) => {
    const r = await fetch(`${POLL}/openai`, {
      method: "POST", headers: { "Content-Type": "application/json" }, referrerPolicy: "no-referrer", signal,
      body: JSON.stringify({ model: "openai-fast", messages, private: true }),
    });
    const text = await r.text();
    if (r.status === 402 || r.status === 429) throw new Busy(waitSeconds(text));
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const c = JSON.parse(text)?.choices?.[0]?.message?.content;
    if (typeof c !== "string" || !c.trim()) throw new Error("empty");
    return c.trim();
  }, 90000);
}

async function pollGet(messages: Msg[]) {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const user = messages.filter((m) => m.role !== "system").map((m) => m.content).join("\n");
  const url = `${POLL}/${encodeURIComponent(user.slice(0, 5000))}?model=openai-fast&private=true&system=${encodeURIComponent(system.slice(0, 1200))}`;
  return withTimeout(async (signal) => {
    const r = await fetch(url, { referrerPolicy: "no-referrer", signal });
    const text = await r.text();
    if (r.status === 402 || r.status === 429) throw new Busy(waitSeconds(text));
    if (!r.ok || !text.trim()) throw new Error(`HTTP ${r.status}`);
    return text.trim();
  }, 90000);
}

async function backend(messages: Msg[]) {
  return withTimeout(async (signal) => {
    const r = await fetch(`${API_URL}/api/llm`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages }), signal,
    });
    if (!r.ok) throw new Error(`backend ${r.status}`);
    const j = (await r.json()) as { text?: string };
    if (!j.text) throw new Error("empty");
    return j.text;
  }, 150000);
}

async function run(messages: Msg[], serverKey: boolean, onStatus?: Status): Promise<string> {
  onStatus?.({ kind: "thinking" });
  if (serverKey) {
    try { return await backend(messages); } catch { /* fall through to the free model */ }
  }
  const tries: ((m: Msg[]) => Promise<string>)[] = [pollPost, pollGet, backend];
  let busyWaits = 0;
  for (let i = 0; i < tries.length; i++) {
    try {
      return await tries[i](messages);
    } catch (e) {
      if (e instanceof Busy && busyWaits < 2) {
        busyWaits++;
        for (let s = e.seconds; s > 0; s--) { onStatus?.({ kind: "waiting", seconds: s }); await sleep(1000); }
        onStatus?.({ kind: "thinking" });
        i--; // same provider again after waiting
      }
    }
  }
  throw new Error("all providers failed");
}

export function askAI(messages: Msg[], opts: { serverKey?: boolean; onStatus?: Status } = {}): Promise<string> {
  const job = queue.then(() => run(messages, !!opts.serverKey, opts.onStatus));
  queue = job.catch(() => undefined);
  return job;
}

/** Strip markdown the small model sometimes adds */
export function clean(text: string) {
  return text.replace(/\*\*|__|^#+\s*/gm, "").replace(/^\s*[-*]\s+/gm, "• ").trim();
}
