"use client";
import { useState } from "react";
import { PageHead } from "@/components/bits";
import { Now, post } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { askAI, clean, Msg } from "@/lib/llm";
import { useZone, useZoneName } from "@/lib/zone";

type Answer = { mode: "llm" | "offline" | "error"; answer?: string; error?: string; facts: { now: Now } };
type Turn = { q: string; a?: Answer; level: string };
const LEVELS = ["farmer", "agronomist", "researcher"] as const;

export default function Assistant() {
  const { t, list, lang } = useT();
  const { zoneId, meta } = useZone();
  const name = useZoneName();
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("farmer");
  const [wait, setWait] = useState<number | null>(null);
  const [q, setQ] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const serverLLM = !!meta?.llm;

  const offlineText = (now: Now) => {
    const c = now.condition;
    const pct = c ? Math.round(c.pct_vs_normal) : 0;
    const month = c ? list("months_in")[c.month - 1] : "";
    const nowS = !c ? "" : Math.abs(pct) < 3 ? t("now.same", { zone: name(zoneId), month })
      : pct < 0 ? t("now.less", { zone: name(zoneId), pct: Math.abs(pct), month }) : t("now.more", { zone: name(zoneId), pct, month });
    const worst = now.forecast.filter((f) => f.lead_months <= 3).map((f) => f.light);
    const light = worst.includes("red") ? "red" : worst.includes("yellow") ? "yellow" : "green";
    const why = now.why?.chain.map((s) => (s.state === "unknown" ? "" : t(`why.${s.variable}.${s.state}`))).filter(Boolean).join(" → ") ?? "";
    const driver = now.why?.driver ? t("why.driver", { driver: t(`var.${now.why.driver}`).toLowerCase() }) : "";
    return t("ask.offline_answer", { zone: name(zoneId), now: nowS, light: t(`light.${light}`).toLowerCase(), why: why ? why + "." : "", driver });
  };

  const setLast = (a: Answer) => setTurns((x) => x.map((tn, i) => (i === x.length - 1 ? { ...tn, a } : tn)));

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setTurns((x) => [...x, { q: text, level }]);
    setQ("");
    try {
      // our numbers are the only context; askAI tries Claude (server key), then the free model, then the server proxy
      const pack = await post<{ messages: Msg[]; facts: { now: Now } }>("/api/assistant/messages", { zone: zoneId, question: text, level, lang });
      try {
        const answer = await askAI(pack.messages, { serverKey: serverLLM, onStatus: (st) => setWait(st.kind === "waiting" ? st.seconds : null) });
        setLast({ mode: "llm", answer: clean(answer), facts: pack.facts });
      } catch (e) {
        setLast({ mode: "offline", error: String((e as Error).message || e), facts: pack.facts });
      }
    } catch (e) {
      setLast({ mode: "error", error: String((e as Error).message || e), facts: {} as Answer["facts"] });
    } finally {
      setWait(null);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHead title={t("ask.title")} lead={t("ask.lead", { zone: name(zoneId) })} />

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mb-5">
        <fieldset className="flex flex-wrap items-center gap-2">
          <legend className="sr-only">{t("ask.level")}</legend>
          <span className="text-sm text-moss mr-1">{t("ask.level")}</span>
          {LEVELS.map((l) => (
            <button key={l} onClick={() => setLevel(l)} aria-pressed={level === l}
              className={`text-sm px-3 py-1.5 rounded-full border ${level === l ? "bg-basalt text-white border-basalt" : "border-rule hover:border-basalt"}`}>
              {t(`ask.level.${l}`)}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="space-y-6">
        {turns.map((tn, i) => (
          <div key={i}>
            <p className="font-semibold">{tn.q}</p>
            <div className="mt-2 rounded-lg bg-panel border border-rule p-4 whitespace-pre-wrap">
              {!tn.a && <span className="text-moss">{wait ? t("ai.waiting", { s: wait }) : t("ai.thinking")}</span>}
              {tn.a?.mode === "llm" && (
                <>
                  {tn.a.answer}
                  <p className="mt-3 text-xs text-moss">{t("ai.note")}</p>
                </>
              )}
              {tn.a?.mode === "offline" && (
                <>
                  <p>{offlineText(tn.a.facts.now)}</p>
                  <p className="mt-3 text-xs text-moss">{tn.a.error ? t("ask.fallback", { error: tn.a.error }) : t("ask.offline")}</p>
                </>
              )}
              {tn.a?.mode === "error" && <span className="text-scorch">{t("ask.error", { error: tn.a.error ?? "" })}</span>}
            </div>
          </div>
        ))}
      </div>

      {turns.length === 0 && (
        <ul className="flex flex-wrap gap-2 mb-6">
          {list("ask.examples").map((ex) => (
            <li key={ex}>
              <button onClick={() => ask(ex)} className="text-sm text-left px-3 py-2 rounded-lg border border-rule hover:border-basalt bg-panel">{ex}</button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="mt-6 flex gap-2">
        <label htmlFor="q" className="sr-only">{t("ask.placeholder")}</label>
        <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("ask.placeholder")}
          className="flex-1 rounded-lg border border-rule bg-panel px-4 py-3" maxLength={500} />
        <button type="submit" disabled={busy || !q.trim()} className="rounded-lg bg-basalt text-white px-5 py-3 disabled:opacity-40">{t("ask.send")}</button>
      </form>
    </div>
  );
}
