"use client";

import { useEffect } from "react";

type PushProps = {
  membroId?: string;
};

declare global {
  interface Window {
    OneSignal?: any;
  }
}

export default function PushInitializer({ membroId }: PushProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;

    window.OneSignal = window.OneSignal || [];
    const OneSignal = window.OneSignal;

    OneSignal.push(async () => {
      try {
        if (!membroId) return;

        // 🔐 garante permissão
        const perm = await OneSignal.Notifications.permission;
        if (perm !== "granted") {
          await OneSignal.Notifications.requestPermission();
        }

        await OneSignal.login(String(membroId));
        console.log("🔔 OneSignal login OK:", membroId);
      } catch (e) {
        console.error("❌ OneSignal login error:", e);
      }
    });
  }, [membroId]);

  return null;
}
