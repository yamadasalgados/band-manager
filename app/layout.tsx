import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientProviders from "./ClientProviders";
import SubscriptionGuard from "@/components/SubscriptionGuard";
import PushInitializer from "@/components/PushInitializer";
import InstallIOSBanner from "@/components/InstallIOSBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Weekend Loop Backstage",
  description: "Gestão profissional de repertório e escalas.",
  manifest: "/manifest.webmanifest", // ✅ Verifique se o Next gera como .json ou .webmanifest
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Backstage",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#020617",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover", // ✅ Essencial para preencher a tela toda no iPhone
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-br" className="dark h-full" suppressHydrationWarning>
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          "antialiased bg-slate-950 selection:bg-blue-500/30",
          "w-full min-h-[100dvh] overflow-x-hidden", // ✅ min-h-[100dvh] resolve o bug da altura no Safari
          "flex flex-col",
          // ✅ Adicionamos paddings dinâmicos para Safe Areas (Notch e Barra Home)
          "pb-[env(safe-area-inset-bottom)]",
          "pl-[env(safe-area-inset-left)]",
          "pr-[env(safe-area-inset-right)]",
        ].join(" ")}
      >
        <ClientProviders>
          {/* ✅ OneSignal init */}
          <PushInitializer />

          {/* ✅ Banner iOS: ensina instalar pelo Safari + Add to Home */}
          <InstallIOSBanner />

          {/* ✅ O main garante que o conteúdo role se for maior que a tela deitada */}
          <main className="flex-1 w-full flex flex-col overflow-y-auto overflow-x-hidden pt-[env(safe-area-inset-top)]">
            <SubscriptionGuard>{children}</SubscriptionGuard>
          </main>
        </ClientProviders>
      </body>
    </html>
  );
}