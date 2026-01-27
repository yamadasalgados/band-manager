// lib/push/sendPush.ts
type SendPushArgs = {
  title: string;
  message: string;
  url?: string;
  externalUserIds: string[];
  data?: Record<string, any>;
};

export async function sendPush(args: SendPushArgs) {
  const r = await fetch("/api/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // cache: "no-store", // opcional
    body: JSON.stringify(args),
  });

  const raw = await r.text().catch(() => "");
  let json: any = null;

  try {
    json = raw ? JSON.parse(raw) : null;
  } catch {
    json = null;
  }

  // ✅ Se não for ok, mostra diagnóstico REAL (status + raw)
  if (!r.ok || !json?.ok) {
    console.error("sendPush failed:", {
      status: r.status,
      statusText: r.statusText,
      url: r.url,
      raw: raw?.slice(0, 500), // evita log gigante
      json,
    });

    const errMsg =
      (json && (json.error || json.message)) ||
      `HTTP ${r.status} (${r.statusText})`;

    throw new Error(errMsg);
  }

  return json;
}
