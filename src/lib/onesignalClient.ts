export function getOneSignal() {
  return (globalThis as any).OneSignal as any[] | undefined;
}

export function ensureOneSignalArray() {
  const w = globalThis as any;
  if (!w.OneSignal) w.OneSignal = [];
  return w.OneSignal as any[];
}

export function loadOneSignalScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return resolve();

    // já carregou?
    const existing = document.querySelector('script[data-onesignal="sdk"]') as HTMLScriptElement | null;
    if (existing) {
      if ((globalThis as any).OneSignal) return resolve();
      // espera um pouco
      setTimeout(() => resolve(), 400);
      return;
    }

    const s = document.createElement("script");
    s.src = "https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js";
    s.async = true;
    s.defer = true;
    s.dataset.onesignal = "sdk";

    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Falha ao carregar script do OneSignal"));

    document.head.appendChild(s);
  });
}
