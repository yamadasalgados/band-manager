"use client";

import Script from "next/script";
import { useEffect, Suspense } from "react";
import { OrgProvider } from "@/contexts/OrgContext";

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
      // ✅ Inicialização robusta
      await OneSignal.init({
        appId: process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID || "09afe9c3-9c98-40e4-be2d-ba5e392dc191",
        allowLocalhostAsSecureOrigin: true,
        serviceWorkerPath: "OneSignalSDKWorker.js",
        notifyButton: {
          enable: true,
          position: "bottom-right",
          colors: { "circle.background": "#2563eb" },
        },
      });

      // ✅ Vincula o ID do músico automaticamente se ele já estiver logado
      const membroId = localStorage.getItem('usuario_ativo_id') || localStorage.getItem('perfil_id');
      if (membroId) {
        await OneSignal.login(membroId);
        console.log("OneSignal vinculado ao carregar:", membroId);
      }
    });
  }, []);

  return (
    <>
      {/* ✅ Usamos strategy="afterInteractive" para evitar que o objeto fique undefined */}
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