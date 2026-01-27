// lib/push/sendPush.ts
export type SendPushArgs = {
  title: string;
  message: string;
  url?: string;
  externalUserIds: string[];
  data?: Record<string, any>;
};

export async function sendPush(args: SendPushArgs) {
  const payload = {
    title: String(args.title || "").trim(),
    message: String(args.message || "").trim(),
    url: args.url ? String(args.url) : undefined,
    externalUserIds: (args.externalUserIds || []).map(String).filter(Boolean),
    data: args.data || undefined,
  };

  const r = await fetch("/api/onesignal/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  // Alguns erros retornam HTML/empty body — então isso é mais robusto:
  const text = await r.text();
  const json = (() => {
    try {
      return text ? JSON.parse(text) : {};
    } catch {
      return {};
    }
  })();

  if (!r.ok || !json?.ok) {
    console.error("sendPush failed:", json);
    throw new Error(json?.error || `sendPush failed (HTTP ${r.status})`);
  }

  return json;
}
