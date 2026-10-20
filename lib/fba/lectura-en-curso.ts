/**
 * UNA LECTURA DEL LIBRO MAYOR A LA VEZ POR CUENTA Y MERCADO.
 * ==========================================================
 * SOLO SERVIDOR (el estado está en memoria del proceso). La lógica se comprueba con
 * lectura-en-curso.prueba.ts.
 *
 * Leer el libro mayor es BORRAR la ventana de fechas y volver a escribirla (ver
 * lib/fba/ledger.ts). Si dos lecturas de la misma cuenta y el mismo mercado se cruzan —la de la
 * noche y un botón, o dos botones de dos envíos de la misma cuenta—, puede pasar esto:
 *
 *     A borra la ventana · B borra la ventana · A escribe sus filas · B escribe las suyas
 *
 * y cada movimiento queda DOS veces, sin ningún error: cada venta contaría doble y los envíos
 * se agotarían a la mitad de lo debido. Un hueco se nota y se arregla solo en la lectura
 * siguiente; un duplicado se queda callado. Por eso la segunda lectura no espera ni se cuela:
 * se rechaza con un mensaje que dice que ya hay una en marcha.
 *
 * Vale para un solo proceso, que es como corre el ERP (un contenedor). El estado cuelga de
 * `globalThis` y no de una variable del módulo porque Next puede cargar este fichero más de una
 * vez (una por ruta) y entonces cada ruta tendría SU candado y no se verían entre sí.
 *
 * Un candado caduca solo (CADUCA_MS) por si un proceso muere a mitad: sin esto la cuenta
 * quedaría sin poder leerse hasta reiniciar. Pero un proceso que muere pierde también el mapa,
 * así que en la práctica la caducidad solo protege de un cuelgue de una lectura que nunca acaba.
 */

/** Más de lo que tarda Amazon en preparar un informe (hasta quince minutos) y el plazo de la ruta (diez) */
export const CADUCA_MS = 20 * 60_000

type Candados = Map<string, number>
const estadoGlobal = globalThis as typeof globalThis & { __fbaLecturasEnCurso?: Candados }
const candados: Candados = (estadoGlobal.__fbaLecturasEnCurso ??= new Map())

export const claveDeCuenta = (conexion: string, mercado: string): string => `${conexion}|${mercado}`

export type Candado = { ok: true; soltar: () => void } | { ok: false; desdeHaceMs: number }

/**
 * Pide el turno para leer esta cuenta y este mercado. `ok: true` trae la función que hay que llamar
 * al terminar (SIEMPRE, en un `finally`); `ok: false` dice cuánto lleva ya la lectura que está en marcha.
 * `soltar` se puede llamar más de una vez y solo suelta SU candado, nunca el de otra lectura posterior.
 */
export function pedirTurnoDeLectura(clave: string, ahora: number = Date.now(), mapa: Candados = candados): Candado {
  const desde = mapa.get(clave)
  if (desde !== undefined && ahora - desde < CADUCA_MS) return { ok: false, desdeHaceMs: Math.max(0, ahora - desde) }

  mapa.set(clave, ahora)
  return {
    ok: true,
    soltar: () => {
      if (mapa.get(clave) === ahora) mapa.delete(clave)
    },
  }
}

/** «hace 3 min», para el mensaje al que se queda esperando */
export function haceCuanto(ms: number): string {
  const min = Math.round(ms / 60_000)
  return min < 1 ? 'hace menos de un minuto' : `hace ${min} min`
}
