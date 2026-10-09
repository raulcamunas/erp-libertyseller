/**
 * AUDITOR DE STOCK: AGRUPAR POR HORAS.
 *
 * Pura, y la usa la pantalla (de ahí que viva aparte de la parte de servidor):
 * las auditorías se muestran en desplegables de una hora cada uno.
 *
 * LA HORA SE MIDE EN MADRID y no en UTC ni en la zona del navegador. Quien mira
 * esto piensa en «lo que pasó a las tres de la tarde» y el servidor está en
 * UTC: sin esto, el desplegable de las 14:00 mostraría lo que pasó a las 12:00
 * en verano y a las 13:00 en invierno.
 */

export const ZONA = 'Europe/Madrid'

export interface FilaResumen {
  id: string
  creada_at: string
  estado: 'completa' | 'parcial' | 'error'
  con_stock: number
  sin_stock: number
  sin_dato: number
  unidades: number
  entran: number | null
  salen: number | null
}

export interface GrupoHora<T extends FilaResumen> {
  /** '2026-10-09 14' en hora de Madrid. Sirve de clave y de orden */
  clave: string
  /** '14:00–14:59' */
  rango: string
  /** '9 oct' */
  dia: string
  /** De la más reciente a la más antigua */
  filas: T[]
  /** La última auditoría COMPLETA de la hora: es la cifra que representa a la hora */
  ultima: T | null
  /** Cuánto cambió el número de productos con stock a lo largo de la hora */
  delta: number | null
  /** Cuántas fallaron o se quedaron a medias */
  problemas: number
}

const partes = new Intl.DateTimeFormat('sv-SE', {
  timeZone: ZONA,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  hour12: false,
})

const diaCorto = new Intl.DateTimeFormat('es-ES', { timeZone: ZONA, day: 'numeric', month: 'short' })

/** '2026-10-09 14' */
export function claveHora(iso: string): string {
  // sv-SE da «2026-10-09 14». Con hour12:false la medianoche puede salir como
  // «24»; se normaliza a «00» para que ordene bien como texto.
  return partes.format(new Date(iso)).replace(/ 24$/, ' 00').replace(/:.*$/, '')
}

export function agruparPorHora<T extends FilaResumen>(filas: T[]): GrupoHora<T>[] {
  const mapa = new Map<string, T[]>()
  for (const f of filas) {
    const k = claveHora(f.creada_at)
    const g = mapa.get(k)
    if (g) g.push(f)
    else mapa.set(k, [f])
  }

  return [...mapa.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([clave, grupo]) => {
      const ordenadas = [...grupo].sort((a, b) => b.creada_at.localeCompare(a.creada_at))
      const completas = ordenadas.filter((f) => f.estado === 'completa')
      const hora = clave.slice(-2)
      return {
        clave,
        rango: `${hora}:00–${hora}:59`,
        dia: diaCorto.format(new Date(ordenadas[0].creada_at)),
        filas: ordenadas,
        ultima: completas[0] ?? null,
        // De la más antigua a la más reciente COMPLETA de la hora. Una parcial no
        // cuenta: sus cifras no son comparables.
        delta:
          completas.length >= 2
            ? completas[0].con_stock - completas[completas.length - 1].con_stock
            : null,
        problemas: ordenadas.filter((f) => f.estado !== 'completa').length,
      }
    })
}
