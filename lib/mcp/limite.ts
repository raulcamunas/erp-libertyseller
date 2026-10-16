/**
 * UN FRENO PARA LAS LLAMADAS DEL CONECTOR.
 * PURO: el reloj llega de fuera. Se prueba en limite.prueba.ts.
 *
 * La spec de MCP pide limitar el ritmo de las herramientas, y aquí hay una razón
 * propia: un modelo que se equivoca puede entrar en un bucle y lanzar cientos de
 * consultas por minuto contra la base de datos del ERP. El freno es por persona y
 * por ventana fija; en memoria, que aquí basta —hay un solo contenedor— y, si el
 * proceso se reinicia, empieza de cero sin consecuencias.
 */

export interface Limitador {
  /** ok = pasa. Si no, `esperaMs` es cuánto falta para que se abra otra ventana */
  permitir(clave: string): { ok: true } | { ok: false; esperaMs: number }
}

export function crearLimitador(opciones: {
  maximo: number
  ventanaMs: number
  ahora?: () => number
}): Limitador {
  const ahora = opciones.ahora ?? Date.now
  const ventanas = new Map<string, { inicio: number; n: number }>()

  return {
    permitir(clave) {
      const t = ahora()
      const actual = ventanas.get(clave)
      if (!actual || t - actual.inicio >= opciones.ventanaMs) {
        ventanas.set(clave, { inicio: t, n: 1 })
        // Barrido ocasional: un mapa que solo crece es una fuga con buenos modales
        if (ventanas.size > 500) {
          for (const [k, v] of ventanas) if (t - v.inicio >= opciones.ventanaMs) ventanas.delete(k)
        }
        return { ok: true }
      }
      if (actual.n >= opciones.maximo) {
        return { ok: false, esperaMs: opciones.ventanaMs - (t - actual.inicio) }
      }
      actual.n += 1
      return { ok: true }
    },
  }
}
