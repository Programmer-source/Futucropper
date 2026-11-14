import "@fontsource-variable/unbounded";
import "@fontsource-variable/onest";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { LangProvider } from "@/lib/i18n";
import { ZoneProvider } from "@/lib/zone";

export const metadata: Metadata = {
  title: "Follow the Gas: drought watch from NASA data",
  description: "Field greenness, drought outlook and climate trends for irrigated farmland in southern Ukraine and Australia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk">
      <body>
        <LangProvider>
          <ZoneProvider>
            <Shell>{children}</Shell>
          </ZoneProvider>
        </LangProvider>
      </body>
    </html>
  );
}
