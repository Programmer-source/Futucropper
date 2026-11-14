"use client";
import Link from "next/link";
import { PageHead } from "@/components/bits";
import { useT } from "@/lib/i18n";

const PAGES = [
  ["/now", "nav.now"], ["/compare", "nav.compare"], ["/trends", "nav.trends"], ["/chain", "nav.chain"],
  ["/expected", "nav.expected"], ["/dashboard", "nav.dashboard"], ["/assistant", "nav.assistant"],
  ["/expert", "nav.expert"], ["/roadmap", "nav.roadmap"],
] as const;

export default function Science() {
  const { t } = useT();
  return (
    <div>
      <PageHead title={t("s.title")} lead={t("s.lead")} />
      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {PAGES.map(([href, key]) => (
          <li key={href}>
            <Link href={href} className="block rounded-lg bg-panel border border-rule px-4 py-3 hover:border-basalt">{t(key)} →</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
