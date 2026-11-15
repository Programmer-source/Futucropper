import "@fontsource-variable/unbounded";
import "@fontsource-variable/onest";
import "leaflet/dist/leaflet.css";
import "./globals.css";
import type { Metadata } from "next";
import { Shell } from "@/components/Shell";
import { LangProvider } from "@/lib/i18n";
import { ZoneProvider } from "@/lib/zone";

export const metadata: Metadata = {
  title: "Futucropper: drought watch from NASA data",
  description: "Field greenness, drought outlook and climate trends for irrigated farmland in southern Ukraine and Australia.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="uk" suppressHydrationWarning>
      <head>
        {/* hide the intro splash before first paint if it was already shown in this browser session */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(sessionStorage.getItem('ftc-splash-seen')==='1')document.documentElement.classList.add('splash-seen')}catch(e){}" }} />
        {/* optional dark theme: apply a saved "dark" choice before first paint (light is the default) */}
        <script dangerouslySetInnerHTML={{ __html: "try{if(localStorage.getItem('ftc-theme')==='dark')document.documentElement.setAttribute('data-theme','dark')}catch(e){}" }} />
      </head>
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
