"use client";

import Script from "next/script";
import { useEffect, Suspense } from "react";
import { OrgProvider } from "@/contexts/OrgContext";

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      try {
        await OneSignal.init({
          appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID!,
          allowLocalhostAsSecureOrigin: true,
          serviceWorkerPath: "OneSignalSDKWorker.js",
          notifyButton: { enable: false },
        });

        console.log("✅ OneSignal inicializado");
      } catch (e) {
        console.error("❌ OneSignal init error:", e);
      }
    });
  }, []);

  return (
    <>
      <Script
        src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
        strategy="afterInteractive"
      />
      <Suspense fallback={null}>
        <OrgProvider>{children}</OrgProvider>
      </Suspense>
    </>
  );
}
