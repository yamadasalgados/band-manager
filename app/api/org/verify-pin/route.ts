import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic"; // evita cache em alguns deploys

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null);

    const orgId = String(body?.orgId || "").trim();
    const pin = String(body?.pin || "").replace(/\D/g, "").slice(0, 6);

    if (!orgId || pin.length !== 6) {
      return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 });
    }

    // ✅ Melhor usar SUPABASE_URL (não precisa ser NEXT_PUBLIC no server)
    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !serviceKey) {
      console.error("Missing env:", { hasUrl: !!supabaseUrl, hasServiceKey: !!serviceKey });
      return NextResponse.json({ ok: false, error: "missing_env" }, { status: 500 });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data, error } = await supabase
      .from("organizacoes")
      .select("pin_acesso")
      .eq("id", orgId)
      .maybeSingle();

    if (error) {
      console.error("PIN query error:", error);
      return NextResponse.json({ ok: false, error: "query" }, { status: 500 });
    }

    const pinBanco = String(data?.pin_acesso || "").replace(/\D/g, "").slice(0, 6);
    const ok = pinBanco.length === 6 && pinBanco === pin;

    // ✅ debug útil (não vaza o PIN)
    console.log("pin-check:", { orgId, ok, hasPinBanco: pinBanco.length === 6 });

    return NextResponse.json({ ok });
  } catch (e) {
    console.error("PIN server error:", e);
    return NextResponse.json({ ok: false, error: "server" }, { status: 500 });
  }
}
