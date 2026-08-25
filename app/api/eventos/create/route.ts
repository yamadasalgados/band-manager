import { NextResponse } from "next/server";
import { requireUserOrg } from "@/lib/serverAuth";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const orgId = String(body?.orgId || "").trim();
    const local = String(body?.local || "").trim();
    const titulo = String(body?.titulo || body?.local || "").trim();
    const paleta = body?.paleta ? String(body.paleta) : null;
    const recorrente = !!body?.recorrente;
    const autoEscalar = body?.autoEscalar !== false;
    const timezone = String(body?.tz || "UTC").trim();
    const modoPreparacao = body?.modoPreparacao === "completo" ? "completo" : "simples";

    if (!orgId || !local) {
      return NextResponse.json({ ok: false, error: "invalid_fields" }, { status: 400 });
    }

    const { service: supabase } = await requireUserOrg(req, orgId);

    // ==========================================
    // 1. EVENTO ÚNICO
    // ==========================================
    if (!recorrente) {
      const dataStr = String(body?.data || "").trim();
      if (!dataStr) return NextResponse.json({ ok: false, error: "missing_date" }, { status: 400 });

      const ts = new Date(dataStr).toISOString();

      const { data: rpcData, error: rpcErr } = await supabase.rpc("criar_evento_e_escalar", {
        p_org_id: orgId,
        p_local: local,
        p_data: ts,
        p_paleta: paleta,
        p_auto_escalar: autoEscalar,
      });

      if (rpcErr) return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });

      const { error: modeError } = await supabase
        .from("eventos")
        .update({ modo_preparacao: modoPreparacao })
        .eq("id", rpcData);

      if (modeError) return NextResponse.json({ ok: false, error: modeError.message }, { status: 500 });
      return NextResponse.json({ ok: true, eventoId: rpcData });
    }

    // ==========================================
    // 2. EVENTO RECORRENTE
    // ==========================================
    const dias = Array.isArray(body?.diasSemana)
      ? body.diasSemana.map((n: any) => Number(n)).filter((n: number) => Number.isInteger(n) && n >= 0 && n <= 6)
      : [];
    const hora = String(body?.hora || "").trim();

    if (dias.length === 0 || !hora) {
      return NextResponse.json({ ok: false, error: "missing_recurrence_info" }, { status: 400 });
    }

    // A. Salva a regra de recorrência.
    // A data de início é calculada no fuso informado, sem depender do relógio/local timezone do browser.
    const formatter = new Intl.DateTimeFormat("en", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const dateParts = Object.fromEntries(
      formatter
        .formatToParts(new Date())
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );
    const dataInicio = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

    const { data: rec, error: recErr } = await supabase
      .from("eventos_recorrentes")
      .insert([
        {
          org_id: orgId,
          titulo,
          local,
          paleta_cores: paleta,
          dias_semana: dias,
          hora,
          tz: timezone,
          data_inicio: dataInicio,
          ativo: true,
          auto_escalar: autoEscalar,
          modo_preparacao: modoPreparacao,
        },
      ])
      .select("id")
      .single();

    if (recErr) return NextResponse.json({ ok: false, error: recErr.message }, { status: 500 });

    // B. Cria a primeira ocorrência de cada dia usando o cálculo do próprio PostgreSQL.
    // Isso evita o bug em que 19:00 Asia/Tokyo virava 19:00 UTC.
    for (const diaSemana of dias) {
      const { data: proximoTs, error: calcError } = await supabase.rpc("calcular_proximo_timestamp", {
        p_weekday: diaSemana,
        p_hora: hora,
        p_tz: timezone,
      });

      if (calcError || !proximoTs) {
        console.error("Erro ao calcular próxima ocorrência:", calcError);
        continue;
      }

      const { data: existente, error: checkError } = await supabase
        .from("eventos")
        .select("id,recorrencia_id")
        .eq("org_id", orgId)
        .eq("local", local)
        .eq("data", proximoTs)
        .maybeSingle();

      if (checkError) {
        console.error("Erro ao checar duplicata:", checkError);
        continue;
      }

      if (existente?.id) {
        if (!existente.recorrencia_id) {
          const { error: linkError } = await supabase
            .from("eventos")
            .update({ recorrencia_id: rec.id, modo_preparacao: modoPreparacao })
            .eq("id", existente.id);
          if (linkError) console.error("Erro ao vincular recorrência ao evento existente:", linkError);
        }
        continue;
      }

      const { data: eventoId, error: createError } = await supabase.rpc("criar_evento_e_escalar", {
        p_org_id: orgId,
        p_local: local,
        p_data: proximoTs,
        p_paleta: paleta,
        p_auto_escalar: autoEscalar,
      });

      if (createError || !eventoId) {
        console.error("Erro ao criar ocorrência recorrente:", createError);
        continue;
      }

      const { error: linkError } = await supabase
        .from("eventos")
        .update({ recorrencia_id: rec.id, modo_preparacao: modoPreparacao })
        .eq("id", eventoId);

      if (linkError) console.error("Erro ao vincular recorrência ao novo evento:", linkError);
    }

    return NextResponse.json({ ok: true, recorrenciaId: rec.id });

  } catch (e: any) {
    console.error("Critical API Error:", e);
    const code = String(e?.message || '');
    const status =
      code === 'AUTH_REQUIRED' || code === 'AUTH_INVALID'
        ? 401
        : code === 'ORG_NOT_LINKED' || code === 'ORG_FORBIDDEN'
        ? 403
        : 500;
    return NextResponse.json({ ok: false, error: code || "Internal Server Error" }, { status });
  }
}