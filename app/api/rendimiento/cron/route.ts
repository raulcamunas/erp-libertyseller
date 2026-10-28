import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { FALTA_MIGRACION_RENDIMIENTO, esFaltaDeMigracion, leerCuentaDe } from '@/lib/rendimiento/servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { crearGuardianDePasadas } from '@/lib/sistema/una-a-la-vez'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * LAS LLAMADAS DE RINKEL DE TODOS LOS COMERCIALES QUE HAN VINCULADO SU CLAVE.
 *
 * Cada persona tiene su cuenta de Rinkel y su clave, y esta pasada las recorre UNA DETRÁS DE OTRA:
 *
 *   · Empieza por la cuenta que lleva más tiempo sin leerse, de modo que si el tiempo no da para todas, a la
 *     siguiente pasada le tocan las que se quedaron fuera y no siempre las mismas.
 *   · Cada cuenta tiene un tope de tiempo propio: una con meses de histórico por importar no se come la pasada
 *     de las demás. Lo que no cabe se sigue en la próxima (el cursor de la cuenta queda guardado).
 *   · Si una cuenta falla —clave revocada, Rinkel caído— se apunta en ella y se sigue con las otras.
 *
 * Solo LEE de Rinkel. El reloj lo decide `tocaAhora()` desde la tabla cron_config (1 minuto por defecto),
 * como el resto de tareas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_TOTAL_MS = 240_000
const PRESUPUESTO_POR_CUENTA_MS = 50_000
/** Con menos tiempo que esto no se empieza una cuenta: no daría ni para su primera página */
const MINIMO_PARA_EMPEZAR_MS = 8_000

/**
 * UNA SOLA PASADA A LA VEZ EN ESTE PROCESO (lib/sistema/una-a-la-vez.ts). Pasa cada minuto y lo normal son 6 s, pero la de una cuenta recién vinculada importa su
 * histórico por tramos y puede tardar mucho más: la siguiente no se le monta encima leyendo las mismas cuentas. Una pasada que pasa de 330 s se da por muerta.
 */
const guardian = crearGuardianDePasadas(330_000)

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  const soltar = guardian.entrar()
  if (!soltar) return NextResponse.json({ ok: true, saltado: 'ya hay una pasada en curso' })
  try {
    if (request.nextUrl.searchParams.get('forzar') !== '1') {
      const veredicto = await tocaAhora('rinkel-llamadas')
      if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
    }

    if (!hasTokenKey()) {
      return NextResponse.json({ ok: true, saltado: 'El servidor no tiene la clave de cifrado' })
    }

    return await pasada(request)
  } finally {
    soltar()
  }
}

async function pasada(request: NextRequest) {
  const salida = await conRegistro('rinkel-llamadas', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const service = createServiceClient()

    const { data, error } = await service
      .from('rinkel_vinculos')
      .select('user_id')
      .order('ultimo_intento_at', { ascending: true, nullsFirst: true })
    if (error) {
      // Sin la migración 234 no hay nada que leer, y la pantalla de Sistema tiene que decir por qué
      if (esFaltaDeMigracion(error)) throw new Error(FALTA_MIGRACION_RENDIMIENTO)
      throw new Error('No se ha podido leer la lista de cuentas vinculadas.')
    }

    const cuentas = ((data ?? []) as Array<{ user_id: string }>).map((c) => c.user_id)
    let leidas = 0
    let conAviso = 0
    let pendientes = 0
    let sinTiempo = 0
    const avisos: string[] = []

    for (const userId of cuentas) {
      const quedan = PRESUPUESTO_TOTAL_MS - (Date.now() - arranque)
      if (quedan < MINIMO_PARA_EMPEZAR_MS) {
        sinTiempo += 1
        continue
      }
      try {
        const lectura = await leerCuentaDe(service, userId, { presupuestoMs: Math.min(PRESUPUESTO_POR_CUENTA_MS, quedan - 2_000) })
        if (lectura.tipo !== 'hecha') continue
        leidas += 1
        if (!lectura.resumen.ok) {
          conAviso += 1
          // Sin nombres ni claves: el aviso lo lee quien mira la pantalla de Sistema
          avisos.push(lectura.resumen.mensaje ?? 'una cuenta ha dado un aviso')
        }
        if (lectura.resumen.pendiente) pendientes += 1
      } catch (e) {
        conAviso += 1
        avisos.push(esFaltaDeMigracion(e) ? FALTA_MIGRACION_RENDIMIENTO : 'no se ha podido leer una cuenta')
        console.error('Rendimiento · cron: fallo en una cuenta', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
      }
    }

    const partes = [`${leidas} de ${cuentas.length} cuentas leídas`]
    if (conAviso > 0) partes.push(`${conAviso} con aviso`)
    if (pendientes > 0) partes.push(`${pendientes} con histórico por terminar`)
    if (sinTiempo > 0) partes.push(`${sinTiempo} sin tiempo (a la próxima)`)

    return {
      cuentas: cuentas.length,
      leidas,
      con_aviso: conAviso,
      pendientes,
      sin_tiempo: sinTiempo,
      avisos: [...new Set(avisos)].slice(0, 10),
      resumen: partes.join(' · '),
    }
  })

  return NextResponse.json({ ok: true, ...salida })
}
