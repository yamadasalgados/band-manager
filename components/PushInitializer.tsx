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
    if (!window.OneSignal) return;

    const OneSignal = window.OneSignal;

    OneSignal.push(async () => {
      try {
        if (membroId) {
          await OneSignal.login(String(membroId));
          console.log("🔔 OneSignal login:", membroId);
        }
      } catch (e) {
        console.error("❌ OneSignal login error:", e);
      }
    });
  }, [membroId]);

  return null;
}
