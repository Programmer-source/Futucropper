"use client";
import { useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";
import { askAI, clean, Msg } from "@/lib/llm";
import { useZone } from "@/lib/zone";

/** Runs the LLM for a ready prompt and shows the text. No model picker: askAI tries every free route itself. */
export function useAI(messages: Msg[] | null) {
  const { meta } = useZone();
  const [state, setState] = useState<{ text: string | null; busy: boolean; wait: number | null; failed: boolean }>({ text: null, busy: false, wait: null, failed: false });
  const key = messages ? JSON.stringify(messages) : null;
  const [nonce, setNonce] = useState(0);
  const live = useRef(0);
  useEffect(() => {
    if (!messages) { setState({ text: null, busy: false, wait: null, failed: false }); return; }
    const id = ++live.current;
    setState({ text: null, busy: true, wait: null, failed: false });
    askAI(messages, { serverKey: !!meta?.llm, onStatus: (s) => id === live.current && setState((x) => ({ ...x, wait: s.kind === "waiting" ? s.seconds : null })) })
      .then((text) => id === live.current && setState({ text: clean(text), busy: false, wait: null, failed: false }))
      .catch(() => id === live.current && setState({ text: null, busy: false, wait: null, failed: true }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);
  return { ...state, retry: () => setNonce((n) => n + 1) };
}

export function AIText({ ai, children }: { ai: ReturnType<typeof useAI>; children?: React.ReactNode }) {
  const { t } = useT();
  return (
    <div aria-live="polite">
      {ai.busy && (
        <p className="text-moss text-sm flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-water animate-pulse" />
          {ai.wait ? t("ai.waiting", { s: ai.wait }) : t("ai.thinking")}
        </p>
      )}
      {ai.failed && (
        <p className="text-sm">{t("ai.failed")} <button onClick={ai.retry} className="underline">{t("ai.retry")}</button></p>
      )}
      {ai.text && (children ?? <p className="whitespace-pre-wrap">{ai.text}</p>)}
      {ai.text && <p className="mt-2 text-xs text-moss">{t("ai.note")}</p>}
    </div>
  );
}
