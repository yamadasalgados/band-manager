import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ONESIGNAL_APP_ID = Deno.env.get('ONESIGNAL_APP_ID')!
const ONESIGNAL_API_KEY = Deno.env.get('ONESIGNAL_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

serve(async (req: Request) => {
  try {
    const { record, table, type } = await req.json()
    
    let message = ""
    let orgId = record.org_id // Tenta pegar direto do registro
    let heading = "Backstage Control"

    // --- LÓGICA DE MENSAGEM & CONTEXTO ---

    // 1. Escalas (Presença)
    if (table === 'escalas' && record?.status === 'falta') {
      message = "⚠️ Alerta de Escala: Um integrante marcou ausência!"
      // 'escalas' já tem org_id, então orgId estará preenchido
    } 
    
    // 2. Setlist (Evento Repertório)
    else if (table === 'evento_repertorio') {
      message = type === 'INSERT' 
        ? "🎵 Nova música adicionada ao setlist!" 
        : "📝 O repertório do show foi alterado."
      
      // Se a tabela de junção não tiver org_id, buscamos através do evento
      if (!orgId && record.evento_id) {
        const { data: evento } = await supabase
          .from('eventos')
          .select('org_id, local') // Pegamos também o local para personalizar
          .eq('id', record.evento_id)
          .single()
        
        if (evento) {
          orgId = evento.org_id
          heading = `Show em: ${evento.local}`
        }
      }
    }

    // --- DISPARO SEGURO (SEGMENTADO) ---
    if (message && orgId) {
      
      // Busca o nome da banda para o título ficar bonito
      const { data: org } = await supabase
        .from('organizacoes')
        .select('nome')
        .eq('id', orgId)
        .single()
      
      if (org?.nome) heading = org.nome

      console.log(`Enviando Push para Org: ${orgId} (${heading})`)

      const response = await fetch("https://onesignal.com/api/v1/notifications", {
        method: "POST",
        headers: {
          "Authorization": `Basic ${ONESIGNAL_API_KEY}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          app_id: ONESIGNAL_APP_ID,
          // 🔒 O PULO DO GATO: Filtra apenas usuários com a tag da org certa
          filters: [
            { field: "tag", key: "org_id", relation: "=", value: orgId } 
          ],
          contents: { "en": message, "pt": message },
          headings: { "en": heading, "pt": heading },
          // URL opcional para abrir o app direto na tela certa
          // url: "https://seudominio.com/..."
        })
      })

      const resData = await response.json()
      
      if (resData.errors) {
        console.error("Erro OneSignal:", resData.errors)
        throw new Error("Falha no envio ao OneSignal")
      }
    } else {
      console.log("Ignorado: Sem mensagem ou OrgID não identificado.")
    }

    return new Response(JSON.stringify({ done: true }), { 
      headers: { "Content-Type": "application/json" },
      status: 200 
    })

  } catch (err: any) {
    console.error(err)
    return new Response(JSON.stringify({ error: err.message }), { 
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})