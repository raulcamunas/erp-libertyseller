import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { isAmazonConfigured } from '@/lib/amazon/lwa'
import { FALTA_MIGRACION_CUMPLIMIENTO, hayTablaCumplimiento } from '@/lib/cumplimiento/esquema'
import { revisarTodos } from '@/lib/cumplimiento/revisar'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'

/**
 * LA TAREA QUE REVISA LAS INCIDENCIAS DE LOS LISTINGS.
 *
 * Entra cada minuto (crontab) y casi siempre dice «no me toca»: el reloj de verdad
 * vive en cron_config (una hora por defecto). Cada pasada revisa los listings más
 * urgentes de cada cuenta —con stock y sin revisar, o con problemas abiertos— y deja
 * el resto para la siguiente. Solo lee de Amazon.
 *
 * EL SECRETO CIERRA LA PUERTA SI FALTA, NO LA ABRE. Mismo criterio que el resto de
 * tareas: en middleware.ts todo lo que empieza por /api/ es público.
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
    const veredicto = await tocaAhora('cumplimiento')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  if (!isAmazonConfigured() || !hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'Amazon no configurado' })
  }

  const salida = await conRegistro('cumplimiento', lanzadoPorDe(request.headers), async () => {
    // Dentro del registro a propósito: si falta la migración, la pantalla de Sistema
    // enseña la pasada como fallida con la razón, en vez de callarse.
    if (!(await hayTablaCumplimiento())) throw new Error(FALTA_MIGRACION_CUMPLIMIENTO)

    const r = await revisarTodos()
    // Solo cifras de trabajo: este registro lo ve todo el mundo que mire Sistema y
    // aquí no se mezcla nada de ningún cliente con nada de otro.
    return {
      ...r,
      resumen:
        `${r.leidos} listings revisados en ${r.cuentas} cuentas, ${r.llamadas} llamadas` +
        (r.noVinieron ? `, ${r.noVinieron} no devueltos por Amazon` : '') +
        // Si esto es casi todo lo leído, Amazon no está mandando el campo de incidencias
        // en los listings limpios (o no lo está mandando nunca): hay que mirarlo.
        (r.sinCampo ? `, ${r.sinCampo} sin el campo de incidencias` : '') +
        (r.errores ? `, ${r.errores} cuentas con error` : ''),
    }
  })
  return NextResponse.json({ ok: true, ...salida })
}
