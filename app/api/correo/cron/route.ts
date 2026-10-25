import { NextResponse, type NextRequest } from 'next/server'
import { hasTokenKey } from '@/lib/amazon/crypto'
import { vigilarLaSalud } from '@/lib/correo/secuencias/vigia'
import { FALTA_MIGRACION_CORREO, esFaltaDeMigracion, esperaTrasFallos, sincronizarBuzonPorId } from '@/lib/correo/servidor'
import { conRegistro, lanzadoPorDe, tocaAhora } from '@/lib/sistema/cron'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * EL CORREO DE TODOS LOS BUZONES CONECTADOS.
 *
 * Cada persona tiene su buzón y su contraseña, y esta pasada los recorre UNO DETRÁS DE OTRO:
 *
 *   · Empieza por el buzón que lleva más tiempo sin leerse, de modo que si el tiempo no da para todos, a la siguiente
 *     pasada le tocan los que se quedaron fuera y no siempre los mismos.
 *   · Cada buzón tiene un tope de tiempo propio: uno con meses de histórico por importar no se come la pasada de los
 *     demás. Lo que no cabe se sigue en la próxima (no hay cursor que guardar: se compara lo que hay en el servidor con lo
 *     que ya está aquí).
 *   · Un buzón al que el servidor rechazó la contraseña NO se vuelve a intentar hasta que su dueño la cambie: seguir
 *     probando acaba bloqueando la cuenta en el proveedor.
 *   · Uno que falla por otra causa espera cada vez más entre intentos (2, 4, 8… hasta una hora).
 *
 * Solo LEE del servidor de correo. El reloj lo decide `tocaAhora()` desde la tabla cron_config (3 minutos por defecto),
 * como el resto de tareas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 300

const PRESUPUESTO_TOTAL_MS = 240_000
const PRESUPUESTO_POR_BUZON_MS = 50_000
/** Con menos tiempo que esto no se empieza un buzón: no daría ni para conectar y mirar lo nuevo */
const MINIMO_PARA_EMPEZAR_MS = 8_000

interface BuzonParaLeer {
  id: string
  ultimo_intento_at: string | null
  fallos_seguidos: number
}

export async function POST(request: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || request.headers.get('x-cron-secret') !== secret) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
  }

  if (request.nextUrl.searchParams.get('forzar') !== '1') {
    const veredicto = await tocaAhora('correo-sync')
    if (!veredicto.toca) return NextResponse.json({ ok: true, saltado: veredicto.motivo })
  }

  if (!hasTokenKey()) {
    return NextResponse.json({ ok: true, saltado: 'El servidor no tiene la clave de cifrado' })
  }

  const salida = await conRegistro('correo-sync', lanzadoPorDe(request.headers), async () => {
    const arranque = Date.now()
    const service = createServiceClient()

    // Solo los buzones conectados (con contraseña) y a los que el servidor no ha rechazado la contraseña
    const { data: conectados, error: errorConectados } = await service.from('correo_credenciales').select('buzon_id')
    if (errorConectados) {
      if (esFaltaDeMigracion(errorConectados)) throw new Error(FALTA_MIGRACION_CORREO)
      throw new Error('No se ha podido leer la lista de buzones conectados.')
    }
    const ids = ((conectados ?? []) as Array<{ buzon_id: string }>).map((c) => c.buzon_id)
    if (ids.length === 0) return { buzones: 0, leidos: 0, resumen: 'No hay buzones conectados' }

    const { data, error } = await service
      .from('correo_buzones')
      .select('id, ultimo_intento_at, fallos_seguidos')
      .in('id', ids)
      .eq('credenciales_invalidas', false)
      .order('ultimo_intento_at', { ascending: true, nullsFirst: true })
    if (error) {
      if (esFaltaDeMigracion(error)) throw new Error(FALTA_MIGRACION_CORREO)
      throw new Error('No se ha podido leer la lista de buzones.')
    }

    const buzones = (data ?? []) as BuzonParaLeer[]
    let leidos = 0
    let importados = 0
    let conAviso = 0
    let pendientes = 0
    let sinTiempo = 0
    let esperando = 0
    let ocupados = 0
    const avisos: string[] = []

    for (const buzon of buzones) {
      // Un buzón que falla espera cada vez más entre intentos
      const espera = esperaTrasFallos(buzon.fallos_seguidos)
      if (espera > 0 && buzon.ultimo_intento_at && Date.now() - Date.parse(buzon.ultimo_intento_at) < espera) {
        esperando += 1
        continue
      }
      const quedan = PRESUPUESTO_TOTAL_MS - (Date.now() - arranque)
      if (quedan < MINIMO_PARA_EMPEZAR_MS) {
        sinTiempo += 1
        continue
      }
      try {
        const lectura = await sincronizarBuzonPorId(service, buzon.id, { presupuestoMs: Math.min(PRESUPUESTO_POR_BUZON_MS, quedan - 2_000) })
        if (lectura.tipo === 'ocupada') {
          ocupados += 1
          continue
        }
        if (lectura.tipo === 'hecha') {
          leidos += 1
          importados += lectura.importados
          if (!lectura.completo) pendientes += 1
        } else if (lectura.tipo === 'error') {
          conAviso += 1
          // Sin direcciones ni nombres: el aviso lo lee quien mira la pantalla de Sistema
          avisos.push(lectura.mensaje)
        } else if (lectura.tipo === 'credenciales_invalidas') {
          conAviso += 1
          avisos.push('un buzón tiene la contraseña rechazada')
        }
      } catch (e) {
        conAviso += 1
        avisos.push(esFaltaDeMigracion(e) ? FALTA_MIGRACION_CORREO : 'no se ha podido leer un buzón')
        console.error('Correo · cron: fallo en un buzón', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
      }
    }

    const partes = [`${leidos} de ${buzones.length} buzones leídos`, `${importados} correos nuevos`]
    if (conAviso > 0) partes.push(`${conAviso} con aviso`)
    if (pendientes > 0) partes.push(`${pendientes} con histórico por terminar`)
    if (esperando > 0) partes.push(`${esperando} esperando tras un fallo`)
    if (ocupados > 0) partes.push(`${ocupados} ocupados`)
    if (sinTiempo > 0) partes.push(`${sinTiempo} sin tiempo (a la próxima)`)

    return {
      buzones: buzones.length,
      leidos,
      importados,
      con_aviso: conAviso,
      pendientes,
      esperando,
      sin_tiempo: sinTiempo,
      avisos: [...new Set(avisos)].slice(0, 10),
      resumen: partes.join(' · '),
    }
  })

  // El vigía de las secuencias de correo: mira cómo van los buzones y el motor y avisa por la campana de lo que se estropee. Va AQUÍ y no en el
  // motor a propósito: si el motor se para, él no puede avisar de que se ha parado. Nunca tumba esta pasada (ni la alarga: tiene su tope de tiempo)
  const vigia = await Promise.race([
    vigilarLaSalud(createServiceClient()).catch((e: unknown) => {
      console.error('Correo · vigía: no se ha podido mirar la salud', { mensaje: e instanceof Error ? e.message : 'sin mensaje' })
      return null
    }),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 20_000)),
  ])

  return NextResponse.json({ ok: true, ...salida, ...(vigia && !vigia.omitido ? { vigia: { alarmas: vigia.alarmas, avisos: vigia.avisos } } : {}) })
}
