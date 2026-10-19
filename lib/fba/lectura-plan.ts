/**
 * QUÉ CUENTAS LEE LA PASADA NOCTURNA DEL LIBRO MAYOR, Y EN QUÉ ORDEN.
 * ====================================================================
 * PURO. Se comprueba con lectura-plan.prueba.ts. Lo usa app/api/fba/cron-remesas.
 *
 *
 * ============ POR QUÉ NO BASTA CON «LAS CUENTAS QUE TIENEN REMESAS» ============
 *
 * La pasada nació para el reparto de las remesas, y por eso leía SOLO las cuentas que tenían
 * alguna: un cliente sin remesas no tiene nada que consumir, y pedirle el libro mayor gasta
 * una petición de informe para guardar movimientos que nadie iba a mirar.
 *
 * Ya no es verdad. El panel del cliente (inventario FBA, ventas, devoluciones, tiempo parado)
 * y la propuesta con IA se calculan DEL LIBRO MAYOR, para cualquier cliente con stock en
 * Amazon, tenga o no remesas. Con la regla de antes, un cliente cuyas remesas se borraban o
 * se cerraban dejaba de leerse en silencio: el 15 de octubre la pasada pasó de cuatro cuentas
 * a una, y ShoesF se quedó con las ventas leídas hasta el 14 mientras el panel decía que
 * llevaba cinco días sin vender nada.
 *
 * Ahora se leen, además de las cuentas con remesas:
 *
 *   · las que tienen stock en FBA, y
 *   · las que ya se habían leído alguna vez (un cliente que se queda sin stock porque lo ha
 *     vendido todo es justo el que más conviene seguir mirando).
 *
 *
 * ============ EL ORDEN ============
 *
 * La pasada tiene un presupuesto de tiempo y las cuentas se leen una detrás de otra. Lo que
 * no cabe se salta, así que el orden decide quién se queda sin leer:
 *
 *   1. Primero las cuentas CON remesas, como siempre, de la remesa más antigua a la más
 *      reciente: son las que tienen envíos en marcha y las que ya se leían.
 *   2. Después las demás, de la MÁS ATRASADA a la más al día (las que no se han leído nunca,
 *      primero). Así, si una noche no da tiempo para todas, la que se queda fuera es la que
 *      menos lo necesita y a la siguiente noche le toca antes. Con un orden fijo, la última
 *      de la lista se quedaría sin leer para siempre.
 */

export interface UnidadDeLectura {
  conexion: string
  mercado: string
  /** La remesa más antigua de la cuenta. Solo importa la primera vez que se lee. null = no tiene remesas */
  primera: string | null
  conRemesas: boolean
}

export interface RemesaParaLeer {
  conexion: string
  mercado: string
  /** 'YYYY-MM-DD' */
  fechaEnvio: string
}

export interface ConexionParaLeer {
  id: string
  /** El mercado por el que se lee. null = la conexión no tiene ninguno y no se puede leer */
  mercado: string | null
  /** Tiene alguna referencia con unidades en los almacenes de Amazon */
  conStockFba: boolean
}

export const claveDeLectura = (conexion: string, mercado: string): string => `${conexion}|${mercado}`

export function planDeLectura(entrada: {
  remesas: RemesaParaLeer[]
  conexiones: ConexionParaLeer[]
  /** `conexion|mercado` → hasta cuándo se leyó. Lo que no esté, o esté a null, no se ha leído nunca */
  leidoHasta: ReadonlyMap<string, string | null>
}): UnidadDeLectura[] {
  /* ---------- 1) las cuentas con remesas ---------- */
  const conRemesas = new Map<string, UnidadDeLectura>()
  for (const r of entrada.remesas) {
    const k = claveDeLectura(r.conexion, r.mercado)
    const u = conRemesas.get(k)
    if (!u) conRemesas.set(k, { conexion: r.conexion, mercado: r.mercado, primera: r.fechaEnvio, conRemesas: true })
    else if (u.primera === null || r.fechaEnvio < u.primera) u.primera = r.fechaEnvio
  }
  const primeras = [...conRemesas.entries()]
    .sort(([ka, a], [kb, b]) => (a.primera ?? '').localeCompare(b.primera ?? '') || ka.localeCompare(kb))
    .map(([, u]) => u)

  /* ---------- 2) las demás con algo que leer ---------- */
  const extras = new Map<string, UnidadDeLectura>()
  for (const c of entrada.conexiones) {
    if (!c.mercado) continue
    const k = claveDeLectura(c.id, c.mercado)
    if (conRemesas.has(k) || extras.has(k)) continue
    if (!c.conStockFba && !entrada.leidoHasta.has(k)) continue
    extras.set(k, { conexion: c.id, mercado: c.mercado, primera: null, conRemesas: false })
  }
  const resto = [...extras.entries()]
    // '' pesa menos que cualquier fecha: lo que no se ha leído nunca va primero
    .sort(([ka], [kb]) => (entrada.leidoHasta.get(ka) ?? '').localeCompare(entrada.leidoHasta.get(kb) ?? '') || ka.localeCompare(kb))
    .map(([, u]) => u)

  return [...primeras, ...resto]
}
