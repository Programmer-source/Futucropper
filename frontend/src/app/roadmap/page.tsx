"use client";
import { PageHead } from "@/components/bits";
import { useT } from "@/lib/i18n";

/** Honest status of every feature we talked about: what works today, what is next, what is later. */
const ITEMS: { key: string; status: "done" | "new" | "next" | "later" }[] = [
  { key: "fields_now", status: "done" }, { key: "trends", status: "done" }, { key: "chain", status: "done" },
  { key: "expected", status: "done" }, { key: "compare", status: "done" }, { key: "expert", status: "done" },
  { key: "map", status: "new" }, { key: "planner", status: "new" }, { key: "dashboard", status: "new" },
  { key: "notifications", status: "new" }, { key: "free_ai", status: "new" },
  { key: "data_2026", status: "next" }, { key: "any_region", status: "next" }, { key: "auto_updates", status: "next" },
  { key: "telegram", status: "next" }, { key: "cropland_mask", status: "next" },
  { key: "scenarios", status: "later" }, { key: "ndvi_8day", status: "later" }, { key: "mining", status: "later" },
];
const STYLE = {
  done: "bg-canopy text-white", new: "bg-water text-white", next: "border border-basalt", later: "border border-rule text-moss",
} as const;

export default function Roadmap() {
  const { t } = useT();
  return (
    <div>
      <PageHead title={t("road.title")} lead={t("road.lead")} />
      {(["done", "new", "next", "later"] as const).map((s) => (
        <section key={s} className="mt-8">
          <h2 className="text-lg font-semibold">{t(`road.group.${s}`)}</h2>
          <ul className="mt-3 divide-y divide-rule border-y border-rule">
            {ITEMS.filter((i) => i.status === s).map((i) => (
              <li key={i.key} className="py-3 grid sm:grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                <div>
                  <p className="font-semibold">{t(`road.item.${i.key}`)}</p>
                  <p className="text-sm text-moss measure">{t(`road.desc.${i.key}`)}</p>
                </div>
                <span className={`self-start justify-self-start text-xs px-2.5 py-1 rounded-full ${STYLE[s]}`}>{t(`road.status.${s}`)}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
