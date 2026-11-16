/**
 * LO PURO DE LA PANTALLA DE REPOSICIÓN DE UN CLIENTE (spec remesas-pro §1.5, §6.3, D8, D13, D16 y D43; paquete C5).
 *
 * Sin React ni fechas del sistema: `hoy` llega del plan. Se prueba con
 *   cd /Users/raulcamunas/Dev/ERP-remesas && npx tsx components/remesas/reposicion/calculos.prueba.ts
 *
 * Nada de aquí decide cifras del plan: el planificador (lib/fba/planificador.ts) es la autoridad. Esto ordena, filtra y
 * redacta lo que el plan ya ha calculado, y estima lo único que el plan no da: el almacenaje de lo que sobra (D16).
 *
 * API
 *   consumoDe(linea)                         ud/día con las que se gasta el stock (consumo neto > previsto > base), o null
 *   diasDeStock(linea)                       (vendibles + de camino) / consumo; Infinity si hay stock y no vende
 *   filaExceso(linea, coberturaMaxima, hoy)  { dias, sobrantes, costeMes, accion, porque } o null si no sobra (D16)
 *   gruposDeAtencion(lineas, ajustes, hoy)   { agotados, exceso, entrante, tallas } (D8, D16, D2 y D5.2)
 *   FILTROS, filtrarLineas(lineas, filtro, texto, hoy), contarFiltros(lineas, hoy, maxima)
 *   datosMapaCobertura(lineas, plazo, n = 15)   las n de rotura más próxima, con su barra (días) topada para el dibujo
 *   textoAcierto(acierto, hoy)                  «El ritmo previsto acertó ±18 % el último mes (desde el 16 oct)»
 *   textoPlazo(plazo, hoy)                      { L, LM, aLaVenta, frase }
 *   preguntaAgotado(linea, cliente, hoy)        el texto para preguntar al cliente si una referencia agotada se repone
 *   ordenPorDefecto(lineas)                     las que piden envío primero (prioridad, decidir antes de), luego por rotura
 *   etapasDelPlazo(plazo)                       [{ clave, titulo, dias, origen }] para pintar el plazo con su origen
 *   cajaPorGuardar(linea)                       unidades de la caja deducida que aún no es suya (D13), o null
 *   ritmoDe(linea)                              el ritmo que se enseña (previsto > base), o null
 */

import { costeMensual, mesDe } from '@/lib/fba/almacenaje'
import { rompeEn } from '@/lib/fba/rotura-linea'
import type { AjustesReposicion, LineaPlan, OrigenEtapa, PlanCliente, PlazoEtapas, Prioridad } from '@/lib/fba/plan-tipos'
import { decimal, diasEntre, entero, fechaCorta, ritmo, sumarDias } from '../formato'

/* ------------------------------------------------------------------ */
/* Ritmo y días de stock                                               */
/* ------------------------------------------------------------------ */

/** Las ud/día con las que se gasta el stock: el consumo neto del plan (D12) si lo hay; si no, el previsto o el base */
export function consumoDe(l: Pick<LineaPlan, 'ritmo'>): number | null {
  const r = l.ritmo
  const c = r.consumoNeto ?? r.previsto ?? r.base
  return c !== null && Number.isFinite(c) && c > 0 ? c : null
}

/** Días que dura lo que hay en Amazon y lo que viene (sin lo dudoso, que el plan ya no cuenta). Infinity: tiene stock y no vende */
export function diasDeStock(l: Pick<LineaPlan, 'ritmo' | 'vendibles' | 'deCamino'>): number | null {
  const stock = Math.max(0, l.vendibles) + Math.max(0, l.deCamino)
  const c = consumoDe(l)
  if (c === null) return stock > 0 ? Infinity : null
  return stock / c
}

/* ------------------------------------------------------------------ */
/* Exceso (D16)                                                        */
/* ------------------------------------------------------------------ */

export type AccionExceso = 'no_enviar' | 'promocion' | 'retirada'

export const TEXTO_ACCION_EXCESO: Record<AccionExceso, string> = {
  no_enviar: 'No enviar más hasta que baje',
  promocion: 'Promoción o cupón para que rote',
  retirada: 'Retirada o liquidación',
}

export interface FilaExceso {
  sku: string
  nombre: string | null
  /** Días que dura el stock; Infinity si no vende */
  dias: number
  /** Unidades por encima de la cobertura máxima */
  sobrantes: number
  /** Almacenaje estimado del mes de lo que sobra (€, supuestos de almacenaje.ts) */
  costeMes: number
  accion: AccionExceso
  porque: string
  linea: LineaPlan
}

/**
 * Lo que sobra de una referencia: días por encima de la cobertura máxima, unidades sobrantes y lo que cuestan este mes.
 * Acción sugerida:
 *   retirada   no vende (parado, sin ventas) o dura más del triple de la máxima;
 *   promoción  dura más de 1,5 veces la máxima, o tiene stock antiguo;
 *   no enviar  lo demás (se gasta solo).
 * Sin stock en Amazon no hay exceso (lo de camino solo, no se puede retirar todavía).
 */
export function filaExceso(l: LineaPlan, coberturaMaxima: number, hoy: string): FilaExceso | null {
  if (l.vendibles <= 0) return null
  const d = diasDeStock(l)
  if (d === null || d <= coberturaMaxima) return null
  const c = consumoDe(l)
  const stock = Math.max(0, l.vendibles) + Math.max(0, l.deCamino)
  const sobrantes = c === null ? Math.max(0, l.vendibles) : Math.max(0, Math.floor(stock - c * coberturaMaxima + 1e-9))
  if (sobrantes <= 0) return null
  const costeMes = Math.round(costeMensual(sobrantes, mesDe(hoy)) * 100) / 100
  const noVende = c === null || l.fuera === 'parado' || l.fuera === 'sin_ventas'
  const antiguo = l.avisos.includes('antiguo') || l.fuera === 'antiguo'
  const accion: AccionExceso = noVende || d > coberturaMaxima * 3 ? 'retirada' : d > coberturaMaxima * 1.5 || antiguo ? 'promocion' : 'no_enviar'
  const cuanto = d === Infinity ? 'no vende' : `dura ${entero(d)} días`
  const porque =
    accion === 'retirada'
      ? `${cuanto}: el almacenaje se come el margen. Habla con el cliente de retirarlo o liquidarlo.`
      : accion === 'promocion'
        ? `${cuanto}${antiguo ? ' y tiene stock antiguo' : ''}: una promoción lo hace rotar antes de que suba el recargo.`
        : `${cuanto} con ${ritmo(c)}: no le mandes más hasta que baje de ${entero(coberturaMaxima)} días.`
  return { sku: l.sku, nombre: l.nombre, dias: d, sobrantes, costeMes, accion, porque, linea: l }
}

/* ------------------------------------------------------------------ */
/* Grupos de atención                                                  */
/* ------------------------------------------------------------------ */

export interface GrupoTallas {
  modelo: string
  tallas: LineaPlan[]
  /** Unidades en Amazon de esas tallas (lo que está parado en tallas que no venden) */
  vendibles: number
}

export interface GruposDeAtencion {
  /** Agotados hace tiempo (D8): ¿se repone? */
  agotados: LineaPlan[]
  /** Por encima de la cobertura máxima (D16), de más a menos almacenaje */
  exceso: FilaExceso[]
  /** Amazon tiene entrantes que no están en ninguna remesa del ERP (D2) */
  entrante: LineaPlan[]
  /** Tallas sin ventas en 180 días, por modelo (D5.2) */
  tallas: GrupoTallas[]
}

export function gruposDeAtencion(lineas: readonly LineaPlan[], ajustes: Pick<AjustesReposicion, 'coberturaMaxima'>, hoy: string): GruposDeAtencion {
  const agotados = lineas
    .filter((l) => l.fuera === 'agotado_largo')
    .sort((a, b) => (b.ritmo.base ?? 0) * (b.precio ?? 1) - (a.ritmo.base ?? 0) * (a.precio ?? 1) || a.sku.localeCompare(b.sku, 'es', { numeric: true }))

  const exceso = lineas
    .map((l) => filaExceso(l, ajustes.coberturaMaxima, hoy))
    .filter((x): x is FilaExceso => x !== null)
    .sort((a, b) => b.costeMes - a.costeMes || b.sobrantes - a.sobrantes)

  const entrante = lineas.filter((l) => l.entranteSinRemesa > 0).sort((a, b) => b.entranteSinRemesa - a.entranteSinRemesa)

  const porModelo = new Map<string, LineaPlan[]>()
  for (const l of lineas) {
    if (l.fuera !== 'talla_sin_ventas') continue
    const m = l.modelo ?? l.sku
    porModelo.set(m, [...(porModelo.get(m) ?? []), l])
  }
  const tallas: GrupoTallas[] = [...porModelo.entries()]
    .map(([modelo, ls]) => ({
      modelo,
      tallas: [...ls].sort((a, b) => (a.talla ?? a.sku).localeCompare(b.talla ?? b.sku, 'es', { numeric: true })),
      vendibles: ls.reduce((s, l) => s + Math.max(0, l.vendibles), 0),
    }))
    .sort((a, b) => b.vendibles - a.vendibles || a.modelo.localeCompare(b.modelo, 'es', { numeric: true }))

  return { agotados, exceso, entrante, tallas }
}

/* ------------------------------------------------------------------ */
/* Filtros de la tabla                                                 */
/* ------------------------------------------------------------------ */

export type FiltroTabla = 'todas' | 'propuestas' | 'rompen30' | 'decidir' | 'fuera' | 'exceso' | 'sin_datos'

export const FILTROS: ReadonlyArray<{ id: FiltroTabla; texto: string }> = [
  { id: 'todas', texto: 'Todas' },
  { id: 'propuestas', texto: 'Con propuesta' },
  { id: 'decidir', texto: 'Decidir esta semana' },
  { id: 'rompen30', texto: 'Rompen en 30 días' },
  { id: 'exceso', texto: 'Exceso' },
  { id: 'fuera', texto: 'Fuera del plan' },
  { id: 'sin_datos', texto: 'Sin datos' },
]

const PRIORIDADES_DECIDIR: readonly Prioridad[] = ['tarde', 'urgente', 'esta_semana']

/** ¿Pasa la línea el filtro? `maxima` = cobertura máxima del cliente (para «Exceso») */
export function pasaFiltro(l: LineaPlan, filtro: FiltroTabla, hoy: string, maxima: number): boolean {
  switch (filtro) {
    case 'todas':
      return true
    case 'propuestas':
      return l.fuera === null && l.cantidad > 0
    case 'decidir':
      return l.fuera === null && l.cantidad > 0 && PRIORIDADES_DECIDIR.includes(l.prioridad)
    case 'rompen30':
      // La misma regla que la cifra «rompen en 30 días» del Resumen (D4 · D30)
      return rompeEn(l, hoy, 30)
    case 'exceso':
      return filaExceso(l, maxima, hoy) !== null
    case 'fuera':
      return l.fuera !== null
    case 'sin_datos':
      return l.fuera === 'sin_datos' || l.ritmo.confianza === 'sin_datos'
  }
}

const normal = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Filtra por el filtro y por texto (referencia, nombre, ASIN, FNSKU, modelo) */
export function filtrarLineas(lineas: readonly LineaPlan[], filtro: FiltroTabla, texto: string, hoy: string, maxima: number): LineaPlan[] {
  const q = normal(texto.trim())
  return lineas.filter((l) => {
    if (!pasaFiltro(l, filtro, hoy, maxima)) return false
    if (!q) return true
    return [l.sku, l.nombre, l.asin, l.fnsku, l.modelo].some((v) => v && normal(v).includes(q))
  })
}

export function contarFiltros(lineas: readonly LineaPlan[], hoy: string, maxima: number): Record<FiltroTabla, number> {
  const r = { todas: 0, propuestas: 0, decidir: 0, rompen30: 0, exceso: 0, fuera: 0, sin_datos: 0 } as Record<FiltroTabla, number>
  for (const l of lineas) for (const f of FILTROS) if (pasaFiltro(l, f.id, hoy, maxima)) r[f.id]++
  return r
}

/* ------------------------------------------------------------------ */
/* Mapa de cobertura (§6.3)                                            */
/* ------------------------------------------------------------------ */

export interface BarraCobertura {
  sku: string
  nombre: string | null
  /** Días hasta la rotura con lo que viene (sin topar) */
  dias: number
  /** Lo que se dibuja (topado a `tope`) */
  barra: number
  topada: boolean
  prioridad: Prioridad
  /** Si la línea está fuera del plan, se pinta en gris */
  fuera: LineaPlan['fuera']
  fechaRotura: string | null
  cantidad: number
}

/**
 * Las `n` referencias de rotura más próxima (con lo que viene), de la más cercana a la más lejana. Solo las que tienen
 * ritmo: lo que no vende no rompe. La barra se topa a `max(L + M) × 3` y como poco 90 días para que una referencia de
 * 400 días no aplaste al resto (el tooltip dice la cifra de verdad).
 */
export function datosMapaCobertura(lineas: readonly LineaPlan[], plazo: Pick<PlazoEtapas, 'hastaLaVenta' | 'margen'>, hoy: string, n = 15): { barras: BarraCobertura[]; tope: number } {
  const lm = plazo.hastaLaVenta + plazo.margen
  const tope = Math.max(90, lm * 3)
  const conDias = lineas
    .map((l) => {
      let d: number | null = l.coberturaConLoQueViene
      if (d === null && l.fechaRotura) d = Math.max(0, diasEntre(hoy, l.fechaRotura))
      if (d === null) {
        const ds = diasDeStock(l)
        d = ds !== null && Number.isFinite(ds) ? ds : null
      }
      return { l, d }
    })
    .filter((x): x is { l: LineaPlan; d: number } => x.d !== null && Number.isFinite(x.d) && consumoDe(x.l) !== null)
    .sort((a, b) => a.d - b.d || a.l.sku.localeCompare(b.l.sku, 'es', { numeric: true }))
    .slice(0, n)
  return {
    tope,
    barras: conDias.map(({ l, d }) => ({
      sku: l.sku,
      nombre: l.nombre,
      dias: Math.round(d),
      barra: Math.min(tope, Math.max(0, Math.round(d))),
      topada: d > tope,
      prioridad: l.prioridad,
      fuera: l.fuera,
      fechaRotura: l.fechaRotura,
      cantidad: l.cantidad,
    })),
  }
}

/* ------------------------------------------------------------------ */
/* Textos                                                              */
/* ------------------------------------------------------------------ */

/** «El ritmo previsto acertó ±18 % el último mes (desde el 16 oct)» (D43.2) */
export function textoAcierto(acierto: PlanCliente['acierto'], hoy: string): string | null {
  if (!acierto) return null
  return `El ritmo previsto acertó ±${entero(acierto.errorPct)} % el último mes (desde el ${fechaCorta(acierto.desde, hoy)})`
}

/** Tono del acierto: verde ≤ 20 %, ámbar ≤ 40 %, rojo más */
export function tonoAcierto(errorPct: number): 'verde' | 'ambar' | 'rojo' {
  return errorPct <= 20 ? 'verde' : errorPct <= 40 ? 'ambar' : 'rojo'
}

export function textoPlazo(plazo: PlazoEtapas, hoy: string): { L: number; LM: number; aLaVenta: string; frase: string } {
  const L = plazo.hastaLaVenta
  const LM = L + plazo.margen
  const aLaVenta = sumarDias(hoy, L)
  return {
    L,
    LM,
    aLaVenta,
    frase: `Si se decide hoy, está a la venta el ${fechaCorta(aLaVenta, hoy)} (${entero(L)} días) y con margen cubre hasta el ${fechaCorta(sumarDias(hoy, LM), hoy)}`,
  }
}

/** Lo que se copia para preguntar al cliente por una referencia agotada hace tiempo (D8) */
export function preguntaAgotado(l: LineaPlan, cliente: string, hoy: string): string {
  const nombre = l.nombre ? `${l.nombre} (${l.sku})` : l.sku
  const desde = l.ritmo.ultimoPeriodoHasta ? ` desde el ${fechaCorta(l.ritmo.ultimoPeriodoHasta, hoy)}` : ''
  const vendia = l.ritmo.base ? ` y antes vendía unas ${decimal(l.ritmo.base * 30, 0)} unidades al mes` : ''
  return `Hola, ${cliente}: ${nombre} está agotado en Amazon${desde}${vendia}. ¿Lo vas a reponer o lo dejamos de vender? Si se repone, te preparamos el envío.`
}

/* ------------------------------------------------------------------ */
/* Orden, plazo y caja                                                 */
/* ------------------------------------------------------------------ */

const ORDEN_P: Record<Prioridad, number> = { tarde: 0, urgente: 1, esta_semana: 2, proximas_2: 3, este_mes: 4, mas_adelante: 5 }

/**
 * El orden de la tabla al abrirla: primero lo que pide envío (por prioridad y por «decidir antes de»), después lo que
 * está fuera del plan con rotura a la vista (la más próxima primero) y al final lo que no rompe.
 */
export function ordenPorDefecto(lineas: readonly LineaPlan[]): LineaPlan[] {
  const pide = (l: LineaPlan) => l.fuera === null && l.cantidad > 0
  const rotura = (l: LineaPlan) => l.fechaRotura ?? l.fechaPrimerHueco ?? '9999-12-31'
  return [...lineas].sort((a, b) => {
    const pa = pide(a) ? 0 : 1
    const pb = pide(b) ? 0 : 1
    if (pa !== pb) return pa - pb
    if (pa === 0) {
      const d = ORDEN_P[a.prioridad] - ORDEN_P[b.prioridad]
      if (d !== 0) return d
      const fa = a.decidirAntesDe ?? '9999-12-31'
      const fb = b.decidirAntesDe ?? '9999-12-31'
      if (fa !== fb) return fa < fb ? -1 : 1
    }
    const ra = rotura(a)
    const rb = rotura(b)
    if (ra !== rb) return ra < rb ? -1 : 1
    return a.sku.localeCompare(b.sku, 'es', { numeric: true })
  })
}

export interface EtapaDelPlazo {
  clave: 'preparacion' | 'transporte' | 'recepcion' | 'margen'
  titulo: string
  dias: number
  origen: OrigenEtapa
}

const TITULO_ETAPA: Record<EtapaDelPlazo['clave'], string> = {
  preparacion: 'Preparación',
  transporte: 'Transporte',
  recepcion: 'Recepción',
  margen: 'Margen',
}

/** Las cuatro etapas, en orden, con su origen (puesto a mano, medido o de partida) */
export function etapasDelPlazo(plazo: PlazoEtapas): EtapaDelPlazo[] {
  return (['preparacion', 'transporte', 'recepcion', 'margen'] as const).map((clave) => ({
    clave,
    titulo: TITULO_ETAPA[clave],
    dias: plazo[clave],
    origen: plazo.origen[clave],
  }))
}

/** «caja deducida: 18 · Guardar»: las unidades si el plan usa una caja deducida de sus envíos (aún no guardada como suya) */
export function cajaPorGuardar(l: Pick<LineaPlan, 'caja'>): number | null {
  return l.caja && l.caja.origen === 'deducida' && l.caja.unidades > 0 ? l.caja.unidades : null
}

/** El ritmo que se enseña: el previsto (con temporada) o, si no hay, el base */
export function ritmoDe(l: Pick<LineaPlan, 'ritmo'>): number | null {
  const r = l.ritmo.previsto ?? l.ritmo.base
  return r !== null && Number.isFinite(r) ? r : null
}
