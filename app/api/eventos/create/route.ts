import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Extração de dados básica
    const orgId = String(body?.orgId || "").trim();
    const local = String(body?.local || "").trim();
    const titulo = String(body?.titulo || body?.local || "").trim();
    const paleta = body?.paleta ? String(body.paleta) : null;
    const recorrente = !!body?.recorrente;
    const autoEscalar = body?.autoEscalar !== false;
    
    // Captura o Timezone enviado pelo Front (ex: 'America/Sao_Paulo')
    // Fallback para UTC caso venha vazio
    const timezone = String(body?.tz || "UTC").trim();

    // Data de início para o cálculo da recorrência
    const dataInicio = body?.dataInicio || new Date().toISOString().split('T')[0];

    if (!orgId || !local) {
      return NextResponse.json({ ok: false, error: "invalid_fields" }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY! // 🔒 Uso seguro no servidor
    );

    // ==========================================
    // 1. EVENTO ÚNICO (Show ou Ensaio Pontual)
    // ==========================================
    if (!recorrente) {
      const dataStr = String(body?.data || "").trim();
      if (!dataStr) return NextResponse.json({ ok: false, error: "missing_date" }, { status: 400 });

      // O JS converte o datetime-local do navegador para o objeto Date
      const ts = new Date(dataStr).toISOString();

      // Chama a RPC que cria o evento e já faz a escala automática
      const { data: rpcData, error: rpcErr } = await supabase.rpc("criar_evento_e_escalar", {
        p_org_id: orgId,
        p_local: local,
        p_data: ts,
        p_paleta: paleta,
        p_auto_escalar: autoEscalar,
      });

      if (rpcErr) {
        return NextResponse.json({ ok: false, error: rpcErr.message }, { status: 500 });
      }

      return NextResponse.json({ ok: true, eventoId: rpcData });
    }

    // ==========================================
    // 2. EVENTO RECORRENTE (Template Semanal)
    // ==========================================
    const dias = Array.isArray(body?.diasSemana) ? body.diasSemana.map((n: any) => Number(n)) : [];
    const hora = String(body?.hora || "").trim();

    if (dias.length === 0 || !hora) {
      return NextResponse.json({ ok: false, error: "missing_recurrence_info" }, { status: 400 });
    }

    // Salva a regra na tabela de recorrência
    const { data: rec, error: recErr } = await supabase
      .from("eventos_recorrentes")
      .insert([
        {
          org_id: orgId,
          titulo: titulo,
          local: local,
          paleta_cores: paleta,
          dias_semana: dias,
          hora: hora,
          tz: timezone,         // 🌍 Aqui salva o fuso horário (ex: 'Asia/Tokyo')
          data_inicio: dataInicio,
          ativo: true,
          auto_escalar: autoEscalar,
        },
      ])
      .select("id")
      .single();

    if (recErr) {
      return NextResponse.json({ ok: false, error: recErr.message }, { status: 500 });
    }

    // Após criar a regra, chama a RPC para gerar os eventos reais no calendário
    // Isso garante que o usuário já veja o próximo evento assim que salvar
    const { error: genErr } = await supabase.rpc("gerar_eventos_recorrentes_proxima_semana");
    
    if (genErr) {
      // Retornamos ok: true porque a regra foi criada, mesmo que a geração imediata falhe
      return NextResponse.json({ ok: true, recorrenciaId: rec.id, warn: "Regra criada, mas falha na geração automática: " + genErr.message });
    }

    return NextResponse.json({ ok: true, recorrenciaId: rec.id });

  } catch (e: any) {
    console.error("Critical API Error:", e);
    return NextResponse.json({ ok: false, error: e?.message || "Internal Server Error" }, { status: 500 });
  }
}