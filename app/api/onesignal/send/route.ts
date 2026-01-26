import { NextResponse } from "next/server";

type Body = {
  title: string;
  message: string;
  url?: string;
  externalUserIds?: string[]; // ex: ["membroId1", "membroId2"]
  data?: Record<string, any>;
};

export async function POST(req: Request) {
  try {
    const appId = process.env.ONESIGNAL_APP_ID;
    const restKey = process.env.ONESIGNAL_REST_API_KEY;

    if (!appId || !restKey) {
      return NextResponse.json(
        { ok: false, error: "Missing ONESIGNAL_APP_ID or ONESIGNAL_REST_API_KEY" },
        { status: 500 }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body?.title || !body?.message) {
      return NextResponse.json({ ok: false, error: "Missing title/message" }, { status: 400 });
    }

    // ✅ alvo: por external user ids (recomendado)
    // se vier vazio, você pode escolher: bloquear, ou mandar pra um segmento.
    const externalIds = (body.externalUserIds || []).map(String).filter(Boolean);
    if (externalIds.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No externalUserIds provided (refuse to send)" },
        { status: 400 }
      );
    }

    const payload = {
      app_id: appId,
      headings: { en: body.title },
      contents: { en: body.message },
      url: body.url || undefined,
      data: body.data || undefined,

      // 🔥 Principal: envia para usuários logados (OneSignal.login(membroId))
      include_external_user_ids: externalIds,

      // opcional (ajuda quando tem múltiplas subscriptions por usuário)
      channel_for_external_user_ids: "push",
    };

    const r = await fetch("https://onesignal.com/api/v1/notifications", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${restKey}`,
      },
      body: JSON.stringify(payload),
    });

    const json = await r.json().catch(() => ({}));

    if (!r.ok) {
      console.error("OneSignal error:", json);
      return NextResponse.json({ ok: false, error: "OneSignal request failed", details: json }, { status: 500 });
    }

    return NextResponse.json({ ok: true, result: json });
  } catch (e: any) {
    console.error("Send push error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Unknown error" }, { status: 500 });
  }
}
