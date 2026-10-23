import { ErrorDeGasto, MENSAJE_DE_GASTO, NOMBRES_DE_LA_CLAVE, claveDeAdministrador, leerClavesDeApi, leerCostes, leerProyectos, type CodigoDeErrorDeGasto, type DepsDeGasto } from './openai'
import { identificarClaveDelErp, resumirGasto, type ResumenDeGasto } from './resumen'

/**
 * EL GASTO EN IA QUE SE ENSEÑA EN SISTEMA, CON CACHÉ.
 * ===================================================
 * SOLO SERVIDOR. Junta la lectura de OpenAI (openai.ts) con el resumen (resumen.ts) y se queda con el último resultado unos minutos: la pantalla de
 * Sistema se refresca sola cada minuto y varias personas pueden tenerla abierta, y OpenAI no cambia el gasto más deprisa que cada pocos minutos.
 * La caché vive en la memoria del proceso (si el contenedor se reinicia, se vuelve a pedir: no pasa nada).
 *
 * Si OpenAI falla pero hay un resultado guardado, se devuelve ese MARCADO como desactualizado, con el motivo: un contador que desaparece porque
 * OpenAI ha tenido un mal minuto es peor que uno con la hora de la última lectura.
 */

export type RespuestaDeGasto =
  | { estado: 'ok'; resumen: ResumenDeGasto; actualizadoAt: string; desactualizado: false }
  | { estado: 'ok'; resumen: ResumenDeGasto; actualizadoAt: string; desactualizado: true; motivo: string }
  | { estado: 'sin_clave'; mensaje: string }
  | { estado: 'error'; codigo: CodigoDeErrorDeGasto; mensaje: string; detalle: string | null }

/** Cuánto vale una lectura sin volver a pedirla */
export const VIDA_DE_LA_CACHE_MS = 5 * 60_000
/** Con «Actualizar» no se puede pedir más a menudo que esto */
export const ESPERA_ENTRE_ACTUALIZACIONES_MS = 20_000
/** Cuánto se mira hacia atrás: OpenAI solo deja el último año (pedir más es un 400), así que 364 días para no rozar el límite */
const DIAS_HACIA_ATRAS = 364

interface Guardado {
  resumen: ResumenDeGasto
  actualizadoAt: number
}

let guardado: Guardado | null = null

export function vaciarLaCache(): void {
  guardado = null
}

export interface OpcionesDeGasto {
  refrescar?: boolean
  ahora?: () => number
  entorno?: Record<string, string | undefined>
  deps?: Partial<DepsDeGasto>
}

export async function gastoDeIa(op: OpcionesDeGasto = {}): Promise<RespuestaDeGasto> {
  const ahora = op.ahora ?? Date.now
  const clave = claveDeAdministrador(op.entorno)
  if (!clave) {
    return {
      estado: 'sin_clave',
      mensaje: `Falta la clave de administrador de OpenAI. Hay que crearla en OpenAI (Ajustes → Organización → Admin keys, con «Usage: Read») y ponerla en el servidor como ${NOMBRES_DE_LA_CLAVE[0]}.`,
    }
  }

  const t = ahora()
  if (guardado) {
    const edad = t - guardado.actualizadoAt
    const sirve = op.refrescar ? edad < ESPERA_ENTRE_ACTUALIZACIONES_MS : edad < VIDA_DE_LA_CACHE_MS
    if (sirve) return { estado: 'ok', resumen: guardado.resumen, actualizadoAt: new Date(guardado.actualizadoAt).toISOString(), desactualizado: false }
  }

  try {
    const desdeSeg = Math.floor(t / 1000) - DIAS_HACIA_ATRAS * 86_400
    // Los costes y los nombres (de proyectos y de claves) se piden a la vez; los nombres solo sirven para enseñar «LibertyERP» en vez de un identificador
    const nombres = (async () => {
      const proyectos = await leerProyectos(clave, op.deps)
      return { proyectos, claves: await leerClavesDeApi(clave, proyectos, op.deps) }
    })()
    const [filas, { proyectos, claves }] = await Promise.all([leerCostes(clave, desdeSeg, op.deps), nombres])
    // La cuenta de OpenAI se comparte con otras cosas (n8n…): lo del ERP es lo de SU clave, que se reconoce por cómo termina la OPENAI_API_KEY del servidor
    const claveDelErp = identificarClaveDelErp(claves, (op.entorno ?? process.env).OPENAI_API_KEY)
    const resumen = resumirGasto(filas, t, { proyectos: new Map(proyectos.map((p) => [p.id, p.nombre])), claves, claveDelErp })
    guardado = { resumen, actualizadoAt: t }
    return { estado: 'ok', resumen, actualizadoAt: new Date(t).toISOString(), desactualizado: false }
  } catch (e) {
    // Un fallo que no es de OpenAI (un error nuestro al montar el resumen) no se disfraza de «OpenAI ha contestado algo raro»: se dice que es interno
    const error = e instanceof ErrorDeGasto ? e : new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta, null, `Error interno del ERP (${e instanceof Error ? e.name : 'desconocido'})`)
    // Solo el código, el estado y la frase ya limpia (permiso que falta, o lo que no le gusta a OpenAI): nunca el cuerpo de su respuesta
    console.error('[gasto-ia] no se ha podido leer el gasto', { codigo: error.codigo, estado: error.estado, detalle: error.detalle, interno: e instanceof ErrorDeGasto ? undefined : e instanceof Error ? e.message.slice(0, 160) : 'sin mensaje' })
    if (guardado) {
      return { estado: 'ok', resumen: guardado.resumen, actualizadoAt: new Date(guardado.actualizadoAt).toISOString(), desactualizado: true, motivo: error.message }
    }
    return { estado: 'error', codigo: error.codigo, mensaje: error.message, detalle: error.detalle }
  }
}
