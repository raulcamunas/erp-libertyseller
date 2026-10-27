import { NextResponse, type NextRequest } from 'next/server'
import { motivoParaSaltar, pasadaDeNotas } from '@/lib/crm/gemini/servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS NOTAS DE GEMINI: UNA PASADA DEL CRON.
 *
 * Cada minuto el crontab del contenedor entra aquí y `tocaAhora('notas-gemini')` decide si ya toca (cada tres minutos, o lo que se ponga en Sistema; o apagado). Una pasada
 * (lib/crm/gemini/sincronizar.ts) lee de Gmail los correos nuevos de Gemini, abre el documento de las reuniones con clientes, las casa con su ficha del CRM y pasa por la IA las
 * que ya tienen cliente. SOLO LEE de Google. Una reunión interna del equipo solo deja apuntado su título.
 *
 * Mientras falte autorizar el correo y Drive en Google Workspace, o la migración 258, la pasada lo dice (en Sistema, con la frase de qué hacer) y no hace nada más.
 *
 * `conRegistro` envuelve SOLO el trabajo, no las comprobaciones previas: abre su fila ANTES de trabajar, y eso es lo que evita que el cron del minuto siguiente arranque otra
 * pasada encima de una que tarda (y gaste la IA dos veces en la misma nota).
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('notas-gemini')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  try {
    const db = createServiceClient()
    const motivo = await motivoParaSaltar(db)
    if (motivo) return NextResponse.json({ ok: true, saltado: motivo })

    const salida = await conRegistro('notas-gemini', lanzadoPorDe(request.headers), async () => {
      const { resultado, resumen } = await pasadaDeNotas(db)
      // Un permiso que falta es un fallo de verdad: en Sistema tiene que verse en rojo, con la frase de qué hacer
      if (resultado.detenida) throw new Error(resumen)
      return { ...resultado, resumen }
    })
    return NextResponse.json({ ok: true, ...salida })
  } catch (error) {
    console.error('[crm-gemini] error en el cron:', (error as Error).message)
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 })
  }
}
