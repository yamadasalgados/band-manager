import { NextResponse } from "next/server";

type Body = {
  title: string;
  message: string;
  url?: string;
  externalUserIds?: string[]; // ex: ["membroId1", "membroId2"]
  data?: Record<string, any>;

  // opcional: se você quiser controlar idioma no payload
  lang?: "en" | "pt" | "pt-BR";
};

function normString(v: any) {
  return String(v ?? "").trim();
}

function toExternalIds(v: any): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  // aceita string única também
  const s = String(v).trim();
  return s ? [s] : [];
}

export async function POST(req: Request) {
  try {
    // ✅ Preferência: usar variáveis "server-only" (sem NEXT_PUBLIC)
    // Se você já usa outros nomes, pode trocar aqui.
    const appId =
      process.env.ONESIGNAL_APP_ID ||
      process.env.NEXT_PUBLIC_ONESIGNAL_APP_ID; // fallback (não ideal, mas ajuda)

    const restKey =
      process.env.ONESIGNAL_REST_API_KEY ||
      process.env.ONESIGNAL_REST_API_KEY; // (se você tiver esse nome no .env)

    if (!appId || !restKey) {
      return NextResponse.json(
        { ok: false, error: "Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;

    const title = normString(body?.title);
    const message = normString(body?.message);
    const url = body?.url ? normString(body.url) : undefined;
    const data = body?.data && typeof body.data === "object" ? body.data : undefined;

    if (!title || !message) {
      return NextResponse.json(
        { ok: false, error: "Missing title/message" },
        { status: 400 }
      );
    }

    // ✅ alvo por external_user_ids (recomendado)
    const externalIds = toExternalIds(body?.externalUserIds);
    if (externalIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No externalUserIds provided (refuse to send)" },
        { status: 400 }
      );
    }

    // ✅ idioma: envia em EN + PT (pra não depender do idioma do device)
    // OneSignal aceita chaves tipo "en", "pt", "pt-BR"
    const langKey = body?.lang === "pt-BR" ? "pt-BR" : body?.lang === "pt" ? "pt" : "en";

    const payload: any = {
      app_id: appId,

      headings: {
        en: title,
        pt: title,
        "pt-BR": title,
        [langKey]: title,
      },

      contents: {
        en: message,
        pt: message,
        "pt-BR": message,
        [langKey]: message,
      },

      include_external_user_ids: externalIds,

      // opcional: ajuda quando há múltiplas subscriptions por usuário
      channel_for_external_user_ids: "push",
    };

    if (url) payload.url = url;
    if (data) payload.data = data;

    const r = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // ✅ OneSignal REST API (v1) usa Basic {REST_API_KEY}
        Authorization: `Basic ${restKey}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("OneSignal error:", json);
      return NextResponse.json(
        { ok: false, error: "OneSignal request failed", details: json },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, result: json });
  } catch (e: any) {
    console.error("Send push error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message || "Unknown error" },
      { status: 500 }
    );
  }
}
