import { NextResponse, type NextRequest } from 'next/server'
import { fail, requireAppAccess } from '@/lib/amazon/api'
import {
  FALTA_MIGRACION_RENDIMIENTO,
  autorizarObjetivo,
  desvincularClave,
  esFaltaDeMigracion,
  leerCuentaDe,
  leerVinculo,
  vincularClave,
  type ResultadoDeLeerCuenta,
} from '@/lib/rendimiento/servidor'
import { leerCuerpoConTope } from '@/lib/subidas-limite'
import { createServiceClient } from '@/lib/supabase/service'

/**
 * VINCULAR, SINCRONIZAR Y DESVINCULAR LA CLAVE DE RINKEL DE UN COMERCIAL.
 *
 * POST { accion: 'vincular', clave }   · comprueba la clave contra Rinkel, la guarda cifrada y empieza a importar
 * POST { accion: 'sincronizar' }       · lee lo que falte; se repite mientras la respuesta diga `pendiente`. Con `rapida: true`
 *                                        (la pantalla de Cold Calling, cada minuto) solo relee las últimas dos horas
 * POST { accion: 'desvincular' }       · borra la clave y el estado; las llamadas ya importadas se quedan
 * Las tres admiten además `usuario` (el id de otra persona): ver abajo.
 *
 * DE QUIÉN ES LA CLAVE. Por defecto, de quien llama: ese usuario sale de la sesión. Un ADMINISTRADOR puede
 * actuar sobre la clave de otra persona del equipo comercial mandando su id en `usuario`; cualquier otro que lo
 * mande recibe un 403. La regla entera, con sus casos, está en lib/rendimiento/gestion.ts y en
 * autorizarObjetivo() (lib/rendimiento/servidor.ts), que es lo que se prueba. Una clave de Rinkel abre todas las
 * grabaciones de su dueño, así que la puerta es el rol de administrador, no «puede ver al equipo».
 *
 * LAS RESPUESTAS SON FRASES FIJAS. Esta ruta maneja un secreto, así que no se reenvía el texto de ninguna
 * excepción —ver el aviso de errorResponse en lib/amazon/api.ts— y la clave no se escribe en ningún registro.
 *
 * Cada petición lee durante unos 40 s como mucho y devuelve cuánto queda. Es el navegador quien insiste mientras
 * haya histórico pendiente: una cuenta con meses de llamadas no cabe en una sola petición, y así quien vincula
 * ve avanzar el contador en vez de esperar a ciegas.
 */
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 120

const MAX_BYTES_CUERPO = 4 * 1024
const PRESUPUESTO_MS = 40_000
/** Pulsar «Sincronizar» dos veces seguidas no vuelve a preguntar a Rinkel: no hay nada nuevo en 15 segundos */
const ENTRE_LECTURAS_MS = 15_000
const SIN_CACHE = { 'Cache-Control': 'no-store' }
/** Dos horas: lo que se relee en una lectura «rápida» (la pantalla de Cold Calling pide una por minuto) */
const SOLAPE_RAPIDO_DIAS = 2 / 24

const ACCIONES = ['vincular', 'sincronizar', 'desvincular'] as const
type Accion = (typeof ACCIONES)[number]

const FALLO_GENERICO = 'No se ha podido completar la operación. Vuelve a intentarlo en un momento.'

/** Lo que se registra de un fallo: el mensaje y el código, nunca el objeto entero */
function registrar(contexto: string, error: unknown) {
  const e = error as { message?: unknown; code?: unknown; cause?: { code?: unknown } } | null
  console.error(contexto, {
    mensaje: typeof e?.message === 'string' ? e.message : 'sin mensaje',
    codigo: e?.code ?? e?.cause?.code ?? null,
  })
}

/** Lo que el navegador necesita saber de una lectura */
function respuestaDeLectura(lectura: ResultadoDeLeerCuenta) {
  if (lectura.tipo === 'ocupada') return { ocupada: true as const }
  if (lectura.tipo === 'sin_vinculo') return { sinVinculo: true as const }
  return { resumen: lectura.resumen }
}

export async function POST(request: NextRequest) {
  const sesion = await requireAppAccess('rendimiento')
  if (sesion instanceof NextResponse) return sesion

  const cuerpo = await leerCuerpoConTope(request, MAX_BYTES_CUERPO)
  if (cuerpo instanceof NextResponse) return cuerpo

  let json: { accion?: unknown; clave?: unknown; usuario?: unknown; rapida?: unknown }
  try {
    json = JSON.parse(cuerpo.texto) as typeof json
  } catch {
    return fail(400, 'No se ha entendido lo que se ha mandado')
  }
  const accion = ACCIONES.find((a) => a === json?.accion) as Accion | undefined
  if (!accion) return fail(400, 'No se ha entendido lo que se ha mandado')

  try {
    const service = createServiceClient()

    const objetivo = await autorizarObjetivo(service, sesion, json.usuario, accion)
    if (!objetivo.ok) return fail(objetivo.estado, objetivo.mensaje)
    const userId = objetivo.userId
    // Queda rastro de que un administrador ha tocado la cuenta de otra persona: solo ids, nunca la clave
    if (objetivo.deOtra) console.info('Rendimiento · un administrador gestiona la cuenta de Rinkel de otra persona', { administrador: sesion.userId, persona: userId, accion })

    if (accion === 'vincular') {
      // Al administrador, si pega por error la clave de otra persona, se le dice de quién es
      const r = await vincularClave(service, userId, json.clave, { presupuestoMs: PRESUPUESTO_MS, revelarQuien: sesion.role === 'admin' })
      if (!r.ok) return fail(r.estado, r.mensaje)
      return NextResponse.json(
        {
          ok: true,
          cuenta: { usuario: r.cuenta.usuario, numero: r.cuenta.numero, totalLlamadas: r.cuenta.totalLlamadas, finalClave: r.finalClave },
          ...respuestaDeLectura(r.lectura),
        },
        { headers: SIN_CACHE }
      )
    }

    if (accion === 'desvincular') {
      const r = await desvincularClave(service, userId)
      if (!r.ok) return fail(500, 'No se ha podido desvincular la clave. Vuelve a intentarlo en un momento.')
      return NextResponse.json({ ok: true }, { headers: SIN_CACHE })
    }

    // sincronizar
    const vinculo = await leerVinculo(service, userId)
    if (!vinculo) return fail(409, 'Todavía no hay una clave de Rinkel vinculada.')
    // Una lectura rápida es para lo reciente: si aún falta importar el histórico, eso lo hace la pasada de fondo y no esta petición
    if (json.rapida === true && !vinculo.historico_completo) return NextResponse.json({ ok: true, historicoPendiente: true }, { headers: SIN_CACHE })
    if (vinculo.historico_completo && vinculo.ultimo_intento_at && Date.now() - Date.parse(vinculo.ultimo_intento_at) < ENTRE_LECTURAS_MS) {
      return NextResponse.json({ ok: true, recienLeido: true }, { headers: SIN_CACHE })
    }
    const lectura = await leerCuentaDe(service, userId, { presupuestoMs: PRESUPUESTO_MS, ...(json.rapida === true ? { solapeDias: SOLAPE_RAPIDO_DIAS } : {}) })
    if (lectura.tipo === 'sin_vinculo') return fail(409, 'Todavía no hay una clave de Rinkel vinculada.')
    return NextResponse.json({ ok: true, ...respuestaDeLectura(lectura) }, { headers: SIN_CACHE })
  } catch (error) {
    registrar(`Rendimiento · ${accion}: fallo`, error)
    if (esFaltaDeMigracion(error)) return fail(503, FALTA_MIGRACION_RENDIMIENTO)
    return fail(500, FALLO_GENERICO)
  }
}
