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
 * ============ EL ORDEN (24 nov 2026) ============
 *
 * La pasada tiene un presupuesto de tiempo (~1 min por cuenta) y las cuentas se leen una detrás de otra. Lo que no cabe se salta,
 * así que el orden decide quién se queda sin leer.
 *
 * Antes iban primero TODAS las cuentas con remesas, en un orden FIJO (de la remesa más antigua a la más reciente), y solo
 * las demás se ordenaban por atraso. Con 15 lecturas y sitio para 9, las últimas con remesas se quedaban fuera TODAS las
 * noches: Portico (EE. UU.) llevaba desde el 20 nov, Yolanda España desde el 6. Ahora hay UN solo orden:
 *
 *   1. De la MÁS ATRASADA a la más al día (las que no se han leído nunca, primero).
 *   2. A igual atraso, primero la que tiene remesas; después, la de la remesa más antigua; y por último, por nombre.
 *
 * Y lo que ya está leído hoy (`hoy`) no se vuelve a leer: la pasada se lanza varias veces al día (lib/sistema/cron.ts) y
 * las de después de la primera solo leen lo que se quedó fuera.
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
  /** 'YYYY-MM-DD' en España: lo leído ya hasta hoy se salta. Sin él, no se salta nada */
  hoy?: string
}): UnidadDeLectura[] {
  /* ---------- 1) las cuentas con remesas ---------- */
  const conRemesas = new Map<string, UnidadDeLectura>()
  for (const r of entrada.remesas) {
    const k = claveDeLectura(r.conexion, r.mercado)
    const u = conRemesas.get(k)
    if (!u) conRemesas.set(k, { conexion: r.conexion, mercado: r.mercado, primera: r.fechaEnvio, conRemesas: true })
    else if (u.primera === null || r.fechaEnvio < u.primera) u.primera = r.fechaEnvio
  }
  /* ---------- 2) las demás con algo que leer ---------- */
  const extras = new Map<string, UnidadDeLectura>()
  for (const c of entrada.conexiones) {
    if (!c.mercado) continue
    const k = claveDeLectura(c.id, c.mercado)
    if (conRemesas.has(k) || extras.has(k)) continue
    if (!c.conStockFba && !entrada.leidoHasta.has(k)) continue
    extras.set(k, { conexion: c.id, mercado: c.mercado, primera: null, conRemesas: false })
  }
  /* ---------- 3) las copias de otros mercados que ya se leyeron alguna vez ---------- */
  // Una lectura que existe se sigue leyendo cada noche (de cuentas activas). Si no, se queda parada y, como el panel prefiere la copia con más
  // historia (D35), acaba enseñando ventas de hace una semana: Yolanda, Italia leída a mano el 20 nov y España al día
  const activas = new Set(entrada.conexiones.map((c) => c.id))
  for (const k of entrada.leidoHasta.keys()) {
    const [conexion, mercado] = k.split('|')
    if (!conexion || !mercado || !activas.has(conexion) || conRemesas.has(k) || extras.has(k)) continue
    extras.set(k, { conexion, mercado, primera: null, conRemesas: false })
  }
  const atraso = (k: string) => entrada.leidoHasta.get(k) ?? '' // '' pesa menos que cualquier fecha: lo que no se ha leído nunca va primero
  return [...conRemesas.entries(), ...extras.entries()]
    .filter(([k]) => !entrada.hoy || atraso(k) < entrada.hoy)
    .sort(
      ([ka, a], [kb, b]) =>
        atraso(ka).localeCompare(atraso(kb)) ||
        Number(b.conRemesas) - Number(a.conRemesas) ||
        (a.primera ?? '').localeCompare(b.primera ?? '') ||
        ka.localeCompare(kb)
    )
    .map(([, u]) => u)
}
