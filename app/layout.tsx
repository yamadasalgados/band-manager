import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import ClientProviders from "./ClientProviders";
import SubscriptionGuard from "@/components/SubscriptionGuard";
import PushInitializer from "@/components/PushInitializer";

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
  manifest: "/manifest.json",
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
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-br" className="dark" suppressHydrationWarning>
      <body
        className={[
          geistSans.variable,
          geistMono.variable,
          "antialiased bg-slate-950 min-h-screen selection:bg-blue-500/30",
          "w-full max-w-[100vw] overflow-x-hidden",
          "pt-[env(safe-area-inset-top)]",
        ].join(" ")}
      >
        <ClientProviders>
          {/* ✅ OneSignal init (não registra /sw.js) */}
          <PushInitializer />

          <SubscriptionGuard>{children}</SubscriptionGuard>
        </ClientProviders>
      </body>
    </html>
  );
}
