"use client";
import { API_URL, Light } from "@/lib/api";
import { LIGHT_COLOR } from "@/lib/format";
import { useT } from "@/lib/i18n";

export function Status({ loading, error, empty }: { loading?: boolean; error?: string | null; empty?: boolean }) {
  const { t } = useT();
  if (loading) return <p className="text-moss">{t("state.loading")}</p>;
  if (error) return <p className="text-scorch measure">{t("state.offline", { url: API_URL })}</p>;
  if (empty) return <p className="text-moss measure">{t("state.empty")}</p>;
  return null;
}

/** Traffic-light dot + word. Colour never carries the meaning alone. */
export function LightTag({ light, size = "md" }: { light: Light; size?: "md" | "lg" }) {
  const { t } = useT();
  const key = light ?? "none";
  const dot = size === "lg" ? "w-4 h-4" : "w-3 h-3";
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`${dot} rounded-full inline-block`} style={{ background: light ? LIGHT_COLOR[light] : "#c9cfc6" }} aria-hidden />
      <span className={size === "lg" ? "font-semibold" : ""}>{t(`light.${key}`)}</span>
    </span>
  );
}

export function PageHead({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mb-8">
      <h1 className="text-2xl sm:text-3xl font-semibold">{title}</h1>
      {lead && <p className="measure mt-3 text-moss">{lead}</p>}
    </div>
  );
}

export function Section({ title, help, children, className = "" }: { title: string; help?: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={`mt-12 ${className}`}>
      <h2 className="text-lg font-semibold">{title}</h2>
      {help && <p className="measure mt-1 text-sm text-moss">{help}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}
