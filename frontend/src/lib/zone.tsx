"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { Meta, useApi, Zone } from "./api";
import { useLang } from "./i18n";

type Ctx = {
  meta: Meta | null; metaError: string | null; zoneId: string; setZoneId: (z: string) => void; zone: Zone | null;
};
const ZoneContext = createContext<Ctx>({ meta: null, metaError: null, zoneId: "UA_main", setZoneId: () => {}, zone: null });

export function ZoneProvider({ children }: { children: React.ReactNode }) {
  const { data: meta, error } = useApi<Meta>("/api/meta");
  const [zoneId, setZoneIdState] = useState("UA_main");
  useEffect(() => {
    const saved = localStorage.getItem("zone");
    if (saved) setZoneIdState(saved);
  }, []);
  const setZoneId = (z: string) => {
    setZoneIdState(z);
    localStorage.setItem("zone", z);
  };
  const zone = meta?.zones.find((z) => z.zone === zoneId) ?? meta?.zones[0] ?? null;
  return <ZoneContext.Provider value={{ meta, metaError: error, zoneId: zone?.zone ?? zoneId, setZoneId, zone }}>{children}</ZoneContext.Provider>;
}

export function useZone() {
  return useContext(ZoneContext);
}

export function useZoneName() {
  const { lang } = useLang();
  const { meta } = useZone();
  return (id: string | undefined | null) => {
    const z = meta?.zones.find((x) => x.zone === id);
    return z ? (lang === "uk" ? z.name_uk : z.name_en) : id ?? "";
  };
}
