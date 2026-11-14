import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { notionConfigurado, quienSoy } from '@/lib/tareas-clientes/notion/cliente'
import { escrituraPermitida } from '@/lib/tareas-clientes/notion/sync'
import { conPermiso } from '@/lib/tareas-clientes/rutas'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * El estado de la conexión con Notion, para quien administra: si hay clave, si se puede escribir, cómo va cada cliente y qué hay en cola.
 * Es lo primero que se mira cuando algo no cuadra.
 */
export async function GET() {
  return conPermiso(async (p) => {
    if (!p.esAdmin) return { permitido: false }
    const service = createServiceClient()
    const [clientes, cola, fallidas, aviso, personas] = await Promise.all([
      service.from('tc_clientes').select('id, nombre, notion_ds_id, sync_ultima, sync_error').eq('activo', true).order('orden'),
      service.from('tc_notion_cola').select('id', { count: 'exact', head: true }).is('hecho_en', null),
      service.from('tc_notion_cola').select('id, operacion, error, intentos, tarea_id').is('hecho_en', null).gt('intentos', 0).order('id', { ascending: false }).limit(10),
      service.from('tc_notion_eventos').select('tipo, recibido_en').eq('id', 'verificacion').maybeSingle(),
      service.from('tc_personas').select('perfil_id, notion_user_id, notion_nombre, confirmada').order('creado_en'),
    ])
    let integracion: { nombre?: string; espacio?: string } | { error: string } | null = null
    if (notionConfigurado()) {
      integracion = await quienSoy().then((u) => ({ nombre: u.name, espacio: u.bot?.workspace_name })).catch((e) => ({ error: e instanceof Error ? e.message : 'No se pudo preguntar a Notion' }))
    }
    return {
      permitido: true,
      clave: notionConfigurado(),
      escritura: escrituraPermitida(),
      integracion,
      webhook: { tokenRecibido: Boolean(aviso.data), token: aviso.data?.tipo ?? null },
      clientes: clientes.data ?? [],
      cola: { pendientes: cola.count ?? 0, conFallos: fallidas.data ?? [] },
      personas: personas.data ?? [],
    }
  })
}

export const POST = () => NextResponse.json({ error: 'Método no permitido' }, { status: 405 })
