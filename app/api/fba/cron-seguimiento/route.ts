import { NextResponse, type NextRequest } from 'next/server'
import { connectionCredentials } from '@/lib/amazon/data'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { estadoDeEnvios, lineasDeEnvio, sigueVivo } from '@/lib/fba/inbound'
import { anotarSeguimiento } from '@/lib/fba/seguimiento'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL SEGUIMIENTO HORARIO DE LOS ENVÍOS A FBA.
 *
 * La pasada nocturna de remesas (cron-remesas) lee el libro mayor entero, que es
 * pesado y solo cambia una vez al día. Esto es lo contrario: LIGERO y frecuente.
 * Solo mira los envíos que siguen vivos —con número FBA y sin cerrar— y para cada
 * uno hace dos preguntas a Amazon: en qué estado está y cuántas unidades ha
 * recibido. Si algo ha cambiado desde la última vez, lo apunta en el historial del
 * envío (migración 224) con la hora en que se ha visto.
 *
 * Sin envíos vivos no hace ninguna llamada a Amazon.
 *
 * Solo lee de Amazon. El reloj lo decide `tocaAhora()` desde la tabla cron_config
 * (60 minutos por defecto), como el resto de tareas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_MS = 240_000

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('fba-seguimiento')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  }

  const salida = await conRegistro('fba-seguimiento', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const service = createServiceClient()

    const { data, error } = await service
      .from('fba_remesas')
      .select('id, connection_id, marketplace_id, referencia_envio, estado_amazon')
      .not('connection_id', 'is', null)
      .not('referencia_envio', 'is', null)
    if (error) throw error

    const vivas = ((data ?? []) as Array<{
      id: string
      connection_id: string
      marketplace_id: string
      referencia_envio: string
      estado_amazon: string | null
    }>).filter((r) => sigueVivo(r.estado_amazon))

    // Por (conexión, mercado): las credenciales y el estado se piden una vez por grupo
    const grupos = new Map<string, typeof vivas>()
    for (const r of vivas) {
      const k = `${r.connection_id}|${r.marketplace_id}`
      grupos.set(k, [...(grupos.get(k) ?? []), r])
    }

    let seguidos = 0
    let apuntados = 0
    const avisos: string[] = []

    for (const [k, remesas] of grupos) {
      const [conexion, mercado] = k.split('|')
      try {
        const resuelta = await connectionCredentials(conexion)
        if (!resuelta) {
          avisos.push(`${conexion}: la conexión ya no existe`)
          continue
        }
        const { credentials } = resuelta
        const estados = await estadoDeEnvios(credentials, mercado, remesas.map((r) => r.referencia_envio))

        for (const remesa of remesas) {
          if (Date.now() - arranque > PRESUPUESTO_MS) {
            avisos.push('sin tiempo: quedan envíos para la próxima pasada')
            break
          }
          const info = estados.get(remesa.referencia_envio)
          if (!info) continue

          const lineas = await lineasDeEnvio(credentials, mercado, remesa.referencia_envio)
          for (const l of lineas) {
            await service
              .from('fba_remesa_lineas')
              .update({ unidades_recibidas: l.recibidas, updated_at: new Date().toISOString() })
              .eq('remesa_id', remesa.id)
              .eq('sku', l.sku)
          }
          await service
            .from('fba_remesas')
            .update({
              estado_amazon: info.estado,
              seguimiento_at: new Date().toISOString(),
              seguimiento_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', remesa.id)

          const r = await anotarSeguimiento(service, remesa.id, {
            estado: info.estado,
            enviadas: lineas.reduce((s, l) => s + l.enviadas, 0),
            recibidas: lineas.reduce((s, l) => s + l.recibidas, 0),
          })
          seguidos += 1
          if (r === 'apuntado') apuntados += 1
        }
      } catch (e) {
        avisos.push(`${conexion}: ${e instanceof Error ? e.message.slice(0, 160) : 'error desconocido'}`)
      }
    }

    return {
      envios_vivos: vivas.length,
      seguidos,
      apuntados,
      avisos,
      resumen: `${seguidos} envíos mirados, ${apuntados} con cambios`,
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
