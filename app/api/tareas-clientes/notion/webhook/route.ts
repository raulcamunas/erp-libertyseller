import { createHmac, timingSafeEqual } from 'crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { sincronizarPagina } from '@/lib/tareas-clientes/notion/sync'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/**
 * EL AVISO DE NOTION CUANDO ALGO CAMBIA.
 *
 * Dos cosas llegan aquí:
 *   1. Al crear la suscripción en Notion, un POST con `verification_token`. Se guarda (solo lo lee un administrador en /api/tareas-clientes/notion/estado) para pegarlo
 *      en Notion y, de paso, para comprobar la firma de todo lo que llegue después.
 *   2. Los eventos, firmados con `X-Notion-Signature: sha256=<hmac del cuerpo con ese token>`. Lo que no lleve una firma buena se descarta.
 *
 * Se contesta enseguida y la página se trae por detrás. Si algo falla, la pasada periódica lo recoge: este aviso solo hace que se note antes.
 */
export async function POST(request: NextRequest) {
  const texto = await request.text()
  let cuerpo: { verification_token?: string; id?: string; type?: string; entity?: { id?: string; type?: string }; data?: { page_id?: string; parent?: { id?: string; type?: string } } }
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return NextResponse.json({ error: 'Cuerpo no válido' }, { status: 400 })
  }
  const service = createServiceClient()

  if (cuerpo.verification_token) {
    // Solo se acepta el primero: un segundo no puede cambiar la clave con la que se comprueba la firma
    const { data: yaHay } = await service.from('tc_notion_eventos').select('id').eq('id', 'verificacion').maybeSingle()
    if (!yaHay) await service.from('tc_notion_eventos').insert({ id: 'verificacion', tipo: cuerpo.verification_token })
    return NextResponse.json({ ok: true })
  }

  const { data: guardado } = await service.from('tc_notion_eventos').select('tipo').eq('id', 'verificacion').maybeSingle()
  const token = guardado?.tipo
  const firma = request.headers.get('x-notion-signature') ?? ''
  if (!token) return NextResponse.json({ error: 'Webhook sin verificar' }, { status: 401 })
  const esperada = `sha256=${createHmac('sha256', token).update(texto).digest('hex')}`
  const a = Buffer.from(firma)
  const b = Buffer.from(esperada)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return NextResponse.json({ error: 'Firma no válida' }, { status: 401 })

  if (cuerpo.id) {
    const { error } = await service.from('tc_notion_eventos').insert({ id: `ev:${cuerpo.id}`, tipo: cuerpo.type ?? null })
    if (error) return NextResponse.json({ ok: true, duplicado: true })
  }
  const tipo = cuerpo.type ?? ''
  const paginaId = tipo.startsWith('page.') ? cuerpo.entity?.id : tipo.startsWith('comment.') ? (cuerpo.data?.page_id ?? (cuerpo.data?.parent?.type === 'page_id' ? cuerpo.data.parent.id : undefined)) : undefined
  if (paginaId) void sincronizarPagina(paginaId).catch((e) => console.error('Webhook de Notion: no se ha podido traer la página:', e instanceof Error ? e.message : e))
  return NextResponse.json({ ok: true })
}
