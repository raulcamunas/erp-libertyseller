import { NextResponse } from 'next/server'
import { prepararLote } from '@/lib/actividad/ingesta'
import { requireSession } from '@/lib/auth/api'
import { crearLimitador } from '@/lib/mcp/limite'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * AQUÍ LLEGA LA ACTIVIDAD DE LOS EMPLEADOS (escritura).
 *
 * El navegador de cada empleado manda un lote cada medio minuto —«abrí esta pantalla», «pulsé este botón», «sigo aquí»— y
 * esto lo guarda en actividad_registro (migración 240). Los lee solo quien supervisa, en /dashboard/actividad.
 *
 * LO QUE HACE QUE SEA FIABLE:
 *   · QUIÉN es lo decide la sesión, nunca el cuerpo. La hora la fija el servidor (lib/actividad/ingesta.ts).
 *   · Solo se registra a los EMPLEADOS (rol 'employee'): a un administrador, un socio o un cliente se le contesta 204 y no
 *     se guarda nada.
 *   · NUNCA SE LE DICE NADA A QUIEN NAVEGA: contesta siempre 204, también si la tabla no existe todavía o falla la base.
 *     Registrar es una función de fondo; si falla no puede romper ni retrasar lo que hace la persona.
 *   · Freno: 40 peticiones por minuto y persona (el navegador manda unas 3). Cuerpo de 32 KB como mucho.
 *
 * La limpieza de lo que llega está en lib/actividad/ingesta.ts y lib/actividad/limpieza.ts.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const limitador = crearLimitador({ maximo: 40, ventanaMs: 60_000 })
const MAX_CUERPO = 32 * 1024
const CADA_CUANTO_PURGAR_MS = 6 * 3_600_000

let avisadoSinTabla = false
let ultimaPurga = 0

const sinContenido = () => new NextResponse(null, { status: 204 })

/** La IP de quien llama, tal y como la pasa el proxy. Solo es informativa (se guarda únicamente al abrir sesión) */
function ipDe(request: Request): string | null {
  const reenviada = request.headers.get('x-forwarded-for')
  if (reenviada) return reenviada.split(',')[0]?.trim() || null
  return request.headers.get('x-real-ip')
}

export async function POST(request: Request) {
  const sesion = await requireSession()
  if (sesion instanceof NextResponse) return sesion
  if (sesion.role !== 'employee') return sinContenido()

  if (!limitador.permitir(sesion.userId).ok) return new NextResponse(null, { status: 429 })

  const texto = await request.text()
  if (texto.length > MAX_CUERPO) return new NextResponse(null, { status: 413 })
  let cuerpo: unknown
  try {
    cuerpo = JSON.parse(texto)
  } catch {
    return new NextResponse(null, { status: 400 })
  }

  const { filas } = prepararLote(cuerpo, {
    userId: sesion.userId,
    ahoraMs: Date.now(),
    ip: ipDe(request),
    agente: request.headers.get('user-agent'),
  })
  if (filas.length === 0) return sinContenido()

  try {
    const service = createServiceClient()
    const { error } = await service.from('actividad_registro').insert(filas)
    if (error) {
      if (isMissingSchema(error)) {
        if (!avisadoSinTabla) {
          avisadoSinTabla = true
          console.warn('[actividad] falta lanzar la migración 240_actividad_registro.sql: la actividad no se guarda todavía.')
        }
      } else {
        console.error('[actividad] no se ha podido guardar el lote', { codigo: (error as { code?: string }).code ?? null })
      }
      return sinContenido()
    }

    // A los 90 días se borra solo, sin un proceso aparte: como mucho cada seis horas y sin esperar a que acabe
    const ahora = Date.now()
    if (ahora - ultimaPurga > CADA_CUANTO_PURGAR_MS) {
      ultimaPurga = ahora
      void Promise.resolve(service.rpc('actividad_purgar', { p_dias: 90 })).then(
        ({ error: errorPurga }) => {
          if (errorPurga) console.warn('[actividad] no se ha podido purgar lo antiguo', { codigo: (errorPurga as { code?: string }).code ?? null })
        },
        () => undefined
      )
    }
  } catch (error) {
    console.error('[actividad] fallo al guardar el lote', { mensaje: error instanceof Error ? error.message : 'desconocido' })
  }
  return sinContenido()
}
