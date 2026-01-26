"use client";

import Script from "next/script";
import { useEffect, Suspense } from "react";
import { OrgProvider } from "@/contexts/OrgContext";

// Tipagem global do OneSignal
declare global {
  interface Window {
    OneSignalDeferred?: any[];
  }
}

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.OneSignalDeferred = window.OneSignalDeferred || [];
    window.OneSignalDeferred.push(async (OneSignal: any) => {
      await OneSignal.init({
        appId: "09afe9c3-9c98-40e4-be2d-ba5e392dc191",
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerPath: "OneSignalSDKWorker.js",
        serviceWorkerParam: { scope: "/" },
        notifyButton: {
          enable: true,
          position: "bottom-right",
          size: "medium",
          colors: {
            "circle.background": "#2563eb",
          },
          displayPredicate: () => {
            return OneSignal?.Notifications?.permission !== "granted";
          },
        },
        promptOptions: {
          slidedown: {
            enabled: true,
            autoPrompt: false,
          },
        },
      });
    });
  }, []);

  return (
    <>
      <Script
        src="https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js"
        strategy="lazyOnload"
      />
      {/* ✅ Suspense é necessário aqui porque OrgProvider usa useSearchParams.
        ✅ Removemos a checagem de 'mounted' que impedia o Provider de carregar.
      */}
      <Suspense fallback={null}>
        <OrgProvider>{children}</OrgProvider>
      </Suspense>
    </>
  );
}