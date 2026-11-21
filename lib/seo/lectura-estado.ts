/**
 * SEO · LAS TRANSICIONES DEL ESTADO DE LA LECTURA (seo_lecturas). PURO: no importa nada del servidor.
 *
 * lectura.ts habla con Amazon y con la base; aquí se decide QUÉ se guarda después de cada cosa que pasa. Cada función devuelve el parche para `guardar()` (solo las columnas que cambian: el
 * upsert es parcial) y lectura.ts se limita a aplicarlo. Así cada camino se puede probar con un objeto a mano (lectura.prueba.ts).
 *
 * LAS REGLAS:
 *   · Una tanda de ASIN nunca se pierde por un fallo pasajero: vuelve al FRENTE de la cola (`pendientes`) y se reintenta con la espera de 30 minutos.
 *   · Con 3 intentos sobre la misma tanda se abandona, se dice qué ASIN y se sigue con las demás. Si no quedan, el periodo se cierra igual que cuando todo va bien.
 *   · Un informe FATAL de varios ASIN se parte en dos mitades (sin espera ni error): así los ASIN buenos se leen enseguida y el malo acaba solo en una tanda de 1.
 *   · Un ASIN que da FATAL tres veces seguidas solo se apunta en `asins_sin_ba` (migración 332) y deja de pedirse hasta que se reinicie la lectura. Sin la migración se salta solo en ese periodo.
 *   · Los caminos de aviso (partir la tanda, abandonar un ASIN) dejan `intentos` en 0: el error se ve en pantalla pero no frena la lectura.
 */

import { claveDePeriodo, mesesAnteriores, semanasAnteriores, tandasDeAsins, ultimaSemana, ultimoMes, type PeriodoSqp, type RangoSqp } from './periodos'

/** Cuánto se rellena hacia atrás la primera vez */
export const HISTORICO_SEMANAS = 8
export const HISTORICO_MESES = 3
/** Intentos sobre la misma tanda antes de abandonarla */
export const TOPE_DE_INTENTOS = 3
/** Lo que cabe en la columna `error` */
const LARGO_DEL_ERROR = 500

export interface EstadoSeo {
  estado: 'reposo' | 'esperando'
  report_id: string | null
  periodo: PeriodoSqp | null
  desde: string | null
  hasta: string | null
  asins: string[]
  pendientes: string[][]
  mes_ok: string | null
  semana_ok: string | null
  ficha_leida_at: string | null
  acceso: 'desconocido' | 'si' | 'no'
  pedido_at: string | null
  error: string | null
  intentos: number
  /** Migración 299. Si no está, `mejoras` es false y no se usan */
  periodos_leidos?: string[]
  top_report_id?: string | null
  top_desde?: string | null
  top_hasta?: string | null
  top_pedido_at?: string | null
  top_ok?: string | null
  top_error?: string | null
  /** ¿Está lanzada la migración 299? */
  mejoras?: boolean
  /** Migración 332: los ASIN de los que Brand Analytics no da datos (FATAL tres veces). `undefined` = la columna no existe */
  asins_sin_ba?: string[]
}

/** El parche para guardar() */
export type Parche = Record<string, unknown>

const recortar = (t: string) => t.slice(0, LARGO_DEL_ERROR)
const mayus = (a: string) => a.trim().toUpperCase()

/**
 * ¿Qué periodo toca leer ahora? Primero el último mes y la última semana; después, si hay histórico (migración 299: `periodos_leidos` no es undefined), las semanas y los meses anteriores que
 * falten, del más reciente al más viejo; si ya está todo, nada.
 */
export function periodoQueToca(e: Pick<EstadoSeo, 'mes_ok' | 'semana_ok' | 'periodos_leidos'> | null, hoy: string): RangoSqp | null {
  const mes = ultimoMes(hoy)
  if (e?.mes_ok !== mes.desde) return mes
  const semana = ultimaSemana(hoy)
  if (e?.semana_ok !== semana.desde) return semana
  if (!e?.periodos_leidos) return null
  const leidos = new Set(e.periodos_leidos)
  for (const r of [...semanasAnteriores(hoy, HISTORICO_SEMANAS), ...mesesAnteriores(hoy, HISTORICO_MESES)]) if (!leidos.has(claveDePeriodo(r))) return r
  return null
}

/** Los ASIN seguidos que se pueden pedir: sin los que Brand Analytics no da (`asins_sin_ba`) */
export function asinsLeibles(asins: readonly string[], sinBa: readonly string[] | undefined): string[] {
  const fuera = new Set((sinBa ?? []).map(mayus))
  return asins.filter((a) => !fuera.has(mayus(a)))
}

/**
 * Lo que hay que añadir al parche cuando se termina un periodo (no quedan tandas): `mes_ok`/`semana_ok` si es el último cerrado, y el periodo a `periodos_leidos` (con la migración 299).
 * Vacío si todavía quedan tandas.
 */
export function cierreDePeriodo(e: Pick<EstadoSeo, 'periodo' | 'desde' | 'mejoras' | 'periodos_leidos'>, quedan: readonly string[][], hoy: string): Parche {
  if (quedan.length > 0 || !e.periodo || !e.desde) return {}
  const esElActual = e.periodo === 'MONTH' ? ultimoMes(hoy).desde === e.desde : ultimaSemana(hoy).desde === e.desde
  return {
    ...(esElActual ? (e.periodo === 'MONTH' ? { mes_ok: e.desde } : { semana_ok: e.desde }) : {}),
    ...(e.mejoras ? { periodos_leidos: [...new Set([...(e.periodos_leidos ?? []), claveDePeriodo({ periodo: e.periodo, desde: e.desde })])].slice(-80) } : {}),
  }
}

export interface Transicion {
  parche: Parche
  /** ¿Se ha terminado el periodo? (lectura.ts borra entonces lo viejo, como al guardar) */
  cerrado: boolean
  detalle: string
}

/** El informe se ha guardado bien */
export function trasGuardar(e: EstadoSeo, hoy: string): Transicion {
  const quedan = e.pendientes ?? []
  return {
    parche: { estado: 'reposo', report_id: null, acceso: 'si', error: null, intentos: 0, ...cierreDePeriodo(e, quedan, hoy) },
    cerrado: quedan.length === 0,
    detalle: 'guardado',
  }
}

/**
 * Se deja la tanda en curso y se sigue con las demás (tope de intentos). El error dice qué ASIN; `intentos` vuelve a 0 porque la tanda siguiente empieza de cero. Si no quedan, se cierra el periodo.
 * Con `aSinBa` (FATAL repetido de un solo ASIN y la migración 332 lanzada), el ASIN se apunta para no volver a pedirlo.
 */
function abandonarTanda(e: EstadoSeo, motivo: string, hoy: string, aSinBa: boolean): Transicion {
  const quedan = e.pendientes ?? []
  const asins = e.asins ?? []
  const sinBa = aSinBa && e.asins_sin_ba !== undefined ? { asins_sin_ba: [...new Set([...e.asins_sin_ba.map(mayus), ...asins.map(mayus)])] } : {}
  const quien = asins.length === 1 ? `el ASIN ${asins[0]}` : `los ASIN ${asins.join(', ')}`
  const como = aSinBa ? (e.asins_sin_ba !== undefined ? 'no se vuelve a pedir hasta que cambien los productos' : 'se salta en este periodo') : 'se salta en este periodo'
  return {
    parche: {
      estado: 'reposo',
      report_id: null,
      pendientes: quedan,
      intentos: 0,
      error: recortar(`Brand Analytics no da datos de ${quien} tras ${TOPE_DE_INTENTOS} intentos; ${como}. ${motivo}`),
      ...sinBa,
      ...cierreDePeriodo(e, quedan, hoy),
    },
    cerrado: quedan.length === 0,
    detalle: `tanda abandonada (${asins.join(' ')})`,
  }
}

/**
 * La tanda vuelve al frente de la cola para pedirla otra vez (con la espera de 30 minutos: `intentos` > 0). Es lo que pasa cuando el informe caduca (más de una hora), cuando falla al recogerlo
 * con un error que no se arregla reintentando, o cuando el documento llega roto. Al tercer intento se abandona.
 */
export function devolverTanda(e: EstadoSeo, motivo: string, ahora: number, hoy: string): Transicion {
  const intentos = (e.intentos ?? 0) + 1
  if (intentos >= TOPE_DE_INTENTOS) return abandonarTanda(e, motivo, hoy, false)
  const asins = e.asins ?? []
  return {
    parche: {
      estado: 'reposo',
      report_id: null,
      pendientes: asins.length > 0 ? [asins, ...(e.pendientes ?? [])] : (e.pendientes ?? []),
      pedido_at: new Date(ahora).toISOString(),
      intentos,
      error: recortar(motivo),
    },
    cerrado: false,
    detalle: 'tanda devuelta a la cola',
  }
}

/** Un fallo pasajero (429, 5xx, red) al recoger un informe ya pedido: se queda esperando con el mismo report_id y solo se apunta el error */
export function errorReintentableAlRecoger(motivo: string): Transicion {
  return { parche: { error: recortar(motivo) }, cerrado: false, detalle: 'reintento al recoger' }
}

/** ¿Lleva el informe pedido más de lo que se le da? Vale para cualquier estado 'esperando', no solo IN_QUEUE/IN_PROGRESS */
export function esperaVencida(e: Pick<EstadoSeo, 'pedido_at'>, ahora: number, maximaMs: number): boolean {
  return !!e.pedido_at && ahora - Date.parse(e.pedido_at) > maximaMs
}

/**
 * El informe ha acabado en FATAL. `motivo` es el texto del documento que trae Amazon (o uno genérico si no trae).
 *   · Más de 1 ASIN: se parte en dos mitades al frente de la cola, sin error ni espera.
 *   · 1 ASIN: hasta el 2.º FATAL se reintenta la misma tanda (con espera); al 3.º se apunta en `asins_sin_ba` y se sigue.
 */
export function trasFatal(e: EstadoSeo, motivo: string, ahora: number, hoy: string): Transicion {
  const asins = e.asins ?? []
  if (asins.length > 1) {
    const mitad = Math.ceil(asins.length / 2)
    return {
      parche: { estado: 'reposo', report_id: null, pendientes: [asins.slice(0, mitad), asins.slice(mitad), ...(e.pendientes ?? [])], error: null, intentos: 0 },
      cerrado: false,
      detalle: `FATAL: tanda de ${asins.length} partida en ${mitad} + ${asins.length - mitad}`,
    }
  }
  const intentos = (e.intentos ?? 0) + 1
  if (intentos >= TOPE_DE_INTENTOS) return abandonarTanda(e, motivo, hoy, true)
  return {
    parche: {
      estado: 'reposo',
      report_id: null,
      pendientes: asins.length > 0 ? [asins, ...(e.pendientes ?? [])] : (e.pendientes ?? []),
      pedido_at: new Date(ahora).toISOString(),
      intentos,
      error: recortar(`Amazon no ha podido generar el informe de Brand Analytics de ${asins[0] ?? 'esta tanda'} (intento ${intentos} de ${TOPE_DE_INTENTOS}). ${motivo}`),
    },
    cerrado: false,
    detalle: 'FATAL: se reintenta',
  }
}

/** El texto del documento de un informe FATAL, para guardarlo como motivo. Amazon lo manda en JSON ({"errorDetails": "..."}); si no, el texto tal cual */
export function motivoDeFatal(texto: string | null): string {
  if (!texto || !texto.trim()) return 'Amazon no ha dicho por qué.'
  try {
    const j = JSON.parse(texto) as Record<string, unknown>
    const d = j.errorDetails ?? j.error ?? j.message
    if (typeof d === 'string' && d.trim()) return recortar(`Amazon dice: ${d.trim()}`)
  } catch {
    /* no es JSON: el texto tal cual */
  }
  return recortar(`Amazon dice: ${texto.trim()}`)
}

/** ¿Toca esperar antes de volver a pedir tras un error? Solo si es un error de verdad (`intentos` > 0): los avisos no frenan */
export function esperaTrasError(e: Pick<EstadoSeo, 'error' | 'intentos' | 'pedido_at'> | null, ahora: number, esperaMs: number): boolean {
  return !!e?.error && (e.intentos ?? 0) > 0 && !!e.pedido_at && ahora - Date.parse(e.pedido_at) < esperaMs
}

export type SiguientePedido =
  | { tipo: 'pedir'; rango: RangoSqp; tanda: string[]; resto: string[][] }
  /** Quedaban tandas, pero todas eran de ASIN sin Brand Analytics: el periodo se cierra */
  | { tipo: 'cerrar'; transicion: Transicion }
  | { tipo: 'nada' }

/** En reposo: ¿qué tanda se pide ahora? Primero las que quedan del periodo en curso (la devuelta va al frente); si no, el periodo que toque con todos los ASIN que se pueden leer */
export function siguientePedido(e: EstadoSeo | null, asinsSeguidos: readonly string[], hoy: string): SiguientePedido {
  const sinBa = e?.asins_sin_ba
  if (e?.pendientes && e.pendientes.length > 0 && e.periodo && e.desde && e.hasta) {
    const pendientes = e.pendientes.map((t) => asinsLeibles(t, sinBa)).filter((t) => t.length > 0)
    if (pendientes.length > 0) {
      const [tanda, ...resto] = pendientes
      return { tipo: 'pedir', rango: { periodo: e.periodo, desde: e.desde, hasta: e.hasta }, tanda, resto }
    }
    return { tipo: 'cerrar', transicion: { parche: { pendientes: [], ...cierreDePeriodo(e, [], hoy) }, cerrado: true, detalle: 'periodo cerrado (sin ASIN que leer)' } }
  }
  const rango = periodoQueToca(e, hoy)
  if (!rango) return { tipo: 'nada' }
  const [tanda, ...resto] = tandasDeAsins(asinsLeibles(asinsSeguidos, sinBa))
  if (!tanda) return { tipo: 'nada' }
  return { tipo: 'pedir', rango, tanda, resto }
}

/* ------------------------------------------------------------------ */
/* El vigía de títulos                                                 */
/* ------------------------------------------------------------------ */

export interface TituloPrevio {
  asin: string
  titulo: string | null
  titulo_anterior: string | null
  titulo_cambiado_at: string | null
}

/**
 * Prepara las filas de seo_fichas para el vigía de títulos (migración 304). Si el título que llega no es el que había, se guarda el de antes y cuándo cambió.
 *
 * OJO: un upsert por lotes pone a NULL las columnas que falten en una fila, así que TODAS las filas del lote deben llevar las mismas claves. Por eso a las que no cambian se les copia lo que ya
 * tenían, y si no se ha podido leer lo de antes (`previo` null) se quitan titulo, titulo_anterior y titulo_cambiado_at de TODAS: se conserva lo guardado y la ficha se lee igual.
 */
export function filasConVigia<F extends Record<string, unknown> & { asin: string }>(filas: F[], previo: TituloPrevio[] | null, ahoraIso: string): Array<Record<string, unknown> & { asin: string }> {
  if (previo === null) {
    return filas.map((f) => {
      const { titulo: _t, titulo_anterior: _a, titulo_cambiado_at: _c, ...resto } = f
      void _t
      void _a
      void _c
      return resto as Record<string, unknown> & { asin: string }
    })
  }
  const por = new Map(previo.map((a) => [a.asin, a]))
  return filas.map((f) => {
    const viejo = por.get(f.asin)
    const nuevo = typeof f.titulo === 'string' ? f.titulo : null
    if (viejo?.titulo && nuevo && viejo.titulo.trim() !== nuevo.trim()) return { ...f, titulo_anterior: viejo.titulo, titulo_cambiado_at: ahoraIso }
    return { ...f, titulo_anterior: viejo?.titulo_anterior ?? null, titulo_cambiado_at: viejo?.titulo_cambiado_at ?? null }
  })
}

/** Fallos de la base al guardar un informe, por report_id (en memoria del proceso). Devuelve cuántos lleva ese informe */
export function contarFallo(conteos: Map<string, number>, reportId: string): number {
  const n = (conteos.get(reportId) ?? 0) + 1
  conteos.set(reportId, n)
  // Que no crezca sin fin en un proceso largo
  if (conteos.size > 200) for (const k of [...conteos.keys()].slice(0, 100)) conteos.delete(k)
  return n
}
