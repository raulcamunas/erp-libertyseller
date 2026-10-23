import { ErrorDeGasto, MENSAJE_DE_GASTO, NOMBRES_DE_LA_CLAVE, claveDeAdministrador, leerCostes, leerProyectos, type CodigoDeErrorDeGasto, type DepsDeGasto } from './openai'
import { resumirGasto, type ResumenDeGasto } from './resumen'

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
/** Cuánto se mira hacia atrás: doce meses y un poco, para tener completo el mes de hace un año */
const DIAS_HACIA_ATRAS = 400

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
    const [filas, proyectos] = await Promise.all([leerCostes(clave, desdeSeg, op.deps), leerProyectos(clave, op.deps)])
    const resumen = resumirGasto(filas, t, proyectos)
    guardado = { resumen, actualizadoAt: t }
    return { estado: 'ok', resumen, actualizadoAt: new Date(t).toISOString(), desactualizado: false }
  } catch (e) {
    const error = e instanceof ErrorDeGasto ? e : new ErrorDeGasto('respuesta', MENSAJE_DE_GASTO.respuesta)
    // Solo el código y el estado: nunca el cuerpo de la respuesta de OpenAI
    console.error('[gasto-ia] no se ha podido leer el gasto', { codigo: error.codigo, estado: error.estado })
    if (guardado) {
      return { estado: 'ok', resumen: guardado.resumen, actualizadoAt: new Date(guardado.actualizadoAt).toISOString(), desactualizado: true, motivo: error.message }
    }
    return { estado: 'error', codigo: error.codigo, mensaje: error.message, detalle: error.detalle }
  }
}
