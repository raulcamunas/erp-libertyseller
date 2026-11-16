/**
 * AMAZON ADS · EL AGENTE PPC: OBJETIVOS CONGELADOS, TECHO DEL MES, FASE, MARCA Y COMBINACIÓN ACOTADA DE AJUSTES. PURO (nada de servidor).
 *
 * Lo que decide CONTRA QUÉ se mide el agente. La regla que no se negocia: NADA SE MIDE CONTRA SÍ MISMO.
 *
 *   ACoS AUTOMÁTICO   (producto sin ACoS humano) sale del margen (0,8 × equilibrio), si no del ACoS real (min(30 d, 90 d) × 0,9) o del TACoS objetivo. Se calcula UNA vez y se CONGELA: un ACoS que
 *                     sube tres días seguidos no mueve el objetivo. Solo hay una revisión al mes (desde el día 4, nunca con una ventana que toca un evento de temporada): sube como mucho 2 puntos,
 *                     baja lo que haga falta. Sin equilibrio (fuente ≠ 'equilibrio') el producto es «solo defensivo»: sin margen conocido no se escala.
 *   TECHO MENSUAL     el de la ficha manda; si no, el congelado; si no (primera vez), min(gasto 30 d × 1,2, TACoS objetivo × ventas totales 30 d), sin bajar del gasto 30 d. Sin gasto real → null y en la cuenta no sube nada.
 *   COMBINAR          la postura (crecer/mantener/recortar) y la presión del día (subir/bajar) mueven los umbrales del motor, pero SIEMPRE con un acotado final: nunca se sube con ACoS por encima de
 *                     0,85 × objetivo, nunca con menos de 2 pedidos (3 en cuenta pequeña), ningún porcentaje pasa del 25 %. Las subidas se miden contra el objetivo BASE, nunca el efectivo con postura.
 *
 * Todos los números viven en AGENTE (./tipos) para que pruebas, reglas y pantalla usen los mismos.
 */

import { margenDeProducto } from '../margen'
import { normalizarTexto } from '../reglas'
import { DESCRIPCION_DE_UMBRALES, type UmbralesEstimados } from '../umbrales'
import { AGENTE, type FaseDeProducto, type FuenteDeObjetivo, type Postura, type Presion } from './tipos'

const redondear = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d
const redondear1 = (n: number) => redondear(n, 1)
const acotar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))
const positivo = (n: number | null | undefined): n is number => n != null && Number.isFinite(n) && n > 0
const DIA_MS = 86_400_000

/* =============================================================================================================================================================
 * 3.1 · ACoS OBJETIVO AUTOMÁTICO (candidato) y su ciclo de vida
 * ============================================================================================================================================================= */

export interface EntradaAcosAuto {
  precio: number | null
  ivaPct: number
  costeProducto: number | null
  comisionPct: number
  tarifaFba: number
  otrosCostes: number
  acos30Pct: number | null
  acos90Pct: number | null
  pedidos30: number
  ventasAds30: number
  ventasTotales30: number | null
  tacosObjetivoPct: number | null
}

export interface ResultadoAcosAuto {
  acosObjetivoPct: number | null
  fuente: Exclude<FuenteDeObjetivo, 'humano'> | null
  equilibrioPct: number | null
  soloDefensivo: boolean
  detalle: string
  motivoSinObjetivo: string | null
}

/**
 * EL CANDIDATO a ACoS objetivo automático de un producto sin ACoS humano, por orden:
 *   1. Con precio y coste: 0,8 × ACoS de equilibrio, entre 5 y 60 (fuente 'equilibrio'). Equilibrio 0 = pierde dinero sin publicidad → null.
 *   2. Si no, con ≥ 5 pedidos en 30 d y ventas: min(ACoS 30 d, ACoS 90 d) × 0,9, entre 10 y 40 (fuente 'acos_real').
 *   3. Si no, con TACoS objetivo y ventas: TACoS objetivo × ventas totales 30 d ÷ ventas de publicidad 30 d, entre 10 y 40 (fuente 'tacos').
 *   4. Si no, null.
 * Toda fuente que no sea 'equilibrio' deja el producto en «solo defensivo» (sin margen conocido no se escala).
 */
export function acosAutomatico(e: EntradaAcosAuto): ResultadoAcosAuto {
  const m = margenDeProducto({ precio: e.precio, ivaPct: e.ivaPct, costeProducto: e.costeProducto, comisionPct: e.comisionPct, tarifaFba: e.tarifaFba, otrosCostes: e.otrosCostes })
  const equilibrioPct = m ? m.acosEquilibrioPct : null

  // 1) Del margen
  if (m) {
    if (m.acosEquilibrioPct > 0) {
      const objetivo = redondear1(acotar(AGENTE.ACOS_AUTO_EQUILIBRIO_X * m.acosEquilibrioPct, AGENTE.ACOS_AUTO_EQ_MIN, AGENTE.ACOS_AUTO_EQ_MAX))
      return {
        acosObjetivoPct: objetivo,
        fuente: 'equilibrio',
        equilibrioPct,
        soloDefensivo: false,
        detalle: `${AGENTE.ACOS_AUTO_EQUILIBRIO_X.toLocaleString('es-ES')} × ACoS de equilibrio ${m.acosEquilibrioPct.toLocaleString('es-ES')} % = ${objetivo.toLocaleString('es-ES')} %`,
        motivoSinObjetivo: null,
      }
    }
    return {
      acosObjetivoPct: null,
      fuente: null,
      equilibrioPct,
      soloDefensivo: true,
      detalle: 'El producto pierde dinero sin publicidad (margen ≤ 0): no hay ACoS objetivo posible.',
      motivoSinObjetivo: 'pierde dinero sin publicidad',
    }
  }

  // 2) Del ACoS real (el mejor de 30 y 90 días, con un 10 % de exigencia)
  if (e.pedidos30 >= AGENTE.ACOS_AUTO_PEDIDOS_MIN && positivo(e.ventasAds30) && e.acos30Pct != null && Number.isFinite(e.acos30Pct) && e.acos30Pct >= 0) {
    const acos90 = e.acos90Pct != null && Number.isFinite(e.acos90Pct) && e.acos90Pct >= 0 ? e.acos90Pct : e.acos30Pct
    const base = Math.min(e.acos30Pct, acos90)
    const objetivo = redondear1(acotar(base * AGENTE.ACOS_AUTO_REAL_X, AGENTE.ACOS_AUTO_MIN, AGENTE.ACOS_AUTO_MAX))
    return {
      acosObjetivoPct: objetivo,
      fuente: 'acos_real',
      equilibrioPct: null,
      soloDefensivo: true,
      detalle: `${AGENTE.ACOS_AUTO_REAL_X.toLocaleString('es-ES')} × el mejor ACoS real (30 d ${e.acos30Pct.toLocaleString('es-ES')} %, 90 d ${acos90.toLocaleString('es-ES')} %) = ${objetivo.toLocaleString('es-ES')} %. Sin coste del producto: solo defensivo.`,
      motivoSinObjetivo: null,
    }
  }

  // 3) Del TACoS objetivo de la cuenta
  if (positivo(e.tacosObjetivoPct) && positivo(e.ventasTotales30) && positivo(e.ventasAds30)) {
    const objetivo = redondear1(acotar((e.tacosObjetivoPct * e.ventasTotales30) / e.ventasAds30, AGENTE.ACOS_AUTO_MIN, AGENTE.ACOS_AUTO_MAX))
    return {
      acosObjetivoPct: objetivo,
      fuente: 'tacos',
      equilibrioPct: null,
      soloDefensivo: true,
      detalle: `TACoS objetivo ${e.tacosObjetivoPct.toLocaleString('es-ES')} % × ventas totales ÷ ventas de publicidad (30 d) = ${objetivo.toLocaleString('es-ES')} %. Sin coste del producto: solo defensivo.`,
      motivoSinObjetivo: null,
    }
  }

  return {
    acosObjetivoPct: null,
    fuente: null,
    equilibrioPct: null,
    soloDefensivo: true,
    detalle: 'Sin coste del producto ni ventas suficientes para fijar un ACoS objetivo.',
    motivoSinObjetivo: 'sin costes ni ventas suficientes',
  }
}

/**
 * EL CICLO DE VIDA DEL OBJETIVO AUTOMÁTICO (congelado):
 *   - Sin fila: se guarda el candidato (cambia = true, revisadoMes = mes actual). Sin candidato, nada.
 *   - Con fila: NO se toca, salvo una revisión al mes: día local ≥ 4, revisadoMes ≠ mes actual y la ventana de 30 d no toca un evento de temporada. En la revisión baja libre y sube como mucho 2 puntos.
 * `hoy.mes` = 'YYYY-MM' local del marketplace; `hoy.dia` = día local del mes.
 */
export function revisarObjetivo(
  actual: { acosObjetivoPct: number; revisadoMes: string | null } | null,
  candidato: ResultadoAcosAuto,
  hoy: { mes: string; dia: number },
  ventanaTocaEvento: boolean
): { acosObjetivoPct: number | null; cambia: boolean; revisadoMes: string | null; detalle: string } {
  if (!actual) {
    if (candidato.acosObjetivoPct == null) return { acosObjetivoPct: null, cambia: false, revisadoMes: null, detalle: candidato.motivoSinObjetivo ?? candidato.detalle }
    return { acosObjetivoPct: candidato.acosObjetivoPct, cambia: true, revisadoMes: hoy.mes, detalle: `Objetivo automático congelado: ${candidato.detalle}` }
  }

  const sinCambio = (porque: string) => ({ acosObjetivoPct: actual.acosObjetivoPct, cambia: false, revisadoMes: actual.revisadoMes, detalle: porque })
  if (actual.revisadoMes === hoy.mes) return sinCambio('Congelado: ya se revisó este mes.')
  if (hoy.dia < AGENTE.ACOS_AUTO_DIA_REVISION) return sinCambio(`Congelado: la revisión mensual es a partir del día ${AGENTE.ACOS_AUTO_DIA_REVISION}.`)
  if (ventanaTocaEvento) return sinCambio('Congelado: la ventana de 30 días toca un evento de temporada; se revisa cuando no lo toque.')

  // Revisión del mes
  if (candidato.acosObjetivoPct == null) {
    return { acosObjetivoPct: actual.acosObjetivoPct, cambia: false, revisadoMes: hoy.mes, detalle: `Revisado: sin candidato (${candidato.motivoSinObjetivo ?? 'sin datos'}), se queda en ${actual.acosObjetivoPct.toLocaleString('es-ES')} %.` }
  }
  const c = candidato.acosObjetivoPct
  const nuevo = redondear1(c < actual.acosObjetivoPct ? c : Math.min(c, actual.acosObjetivoPct + AGENTE.ACOS_AUTO_SUBIDA_MAX_PTS))
  const cambia = nuevo !== actual.acosObjetivoPct
  const detalle = !cambia
    ? `Revisado: se queda en ${actual.acosObjetivoPct.toLocaleString('es-ES')} %.`
    : nuevo < actual.acosObjetivoPct
      ? `Revisado: baja de ${actual.acosObjetivoPct.toLocaleString('es-ES')} % a ${nuevo.toLocaleString('es-ES')} %.`
      : `Revisado: sube de ${actual.acosObjetivoPct.toLocaleString('es-ES')} % a ${nuevo.toLocaleString('es-ES')} %${c > nuevo ? ` (el cálculo daba ${c.toLocaleString('es-ES')} %, se sube como mucho ${AGENTE.ACOS_AUTO_SUBIDA_MAX_PTS} puntos al mes)` : ''}.`
  return { acosObjetivoPct: nuevo, cambia, revisadoMes: hoy.mes, detalle }
}

/* =============================================================================================================================================================
 * 3.2 · TECHO MENSUAL (congelado)
 * ============================================================================================================================================================= */

/**
 * EL TECHO MENSUAL DE GASTO. Objetivo del dueño: VENDER MÁS CON MENOS PUBLICIDAD; el techo deja crecer lo que rinde en TACoS y no deja crecer lo que no.
 *   · El de la ficha (persona) manda siempre.
 *   · Automático: max(gasto 30 d, TACoS objetivo × ventas totales proyectadas), con el crecimiento acotado a +25 % (TECHO_AUTO_CRECER_X) sobre el gasto de 30 d.
 *     «Ventas totales proyectadas» = el ritmo de ventas totales de los últimos 30 días (lo que la cuenta vende al mes hoy). Si el TACoS va mejor que el objetivo
 *     (gasto < TACoS × ventas), el techo sube hasta ese margen (como mucho +25 %); si va peor, el techo es el gasto de 30 d: ni crece ni recorta. Sin ventas totales
 *     (no se sabe el TACoS) → el gasto de 30 d (nada crece hasta saberlo).
 *   · Se CONGELA al calcularse y solo se revisa una vez al mes (`mesActual` distinto del `mes` en que se congeló), nunca con una ventana de 30 días que toque un evento
 *     de temporada (`ventanaConEvento`): en la revisión sube como mucho +25 % sobre el techo anterior; baja libre (nunca por debajo del gasto de 30 d).
 *     Sin `mes` del congelado o sin `mesActual`, no se revisa.
 *   · Sin gasto real (gasto 30 d < 1) y sin techo congelado → null: en la cuenta no sube nada.
 * `cambia` = el techo nuevo es distinto del congelado (para avisar solo cuando cambia).
 */
export function techoAutomatico(e: {
  presupuestoMensual: number | null
  congelado: { techo: number; automatico: boolean; mes?: string | null } | null
  gasto30: number
  ventasTotales30: number | null
  tacosObjetivoPct: number | null
  mesActual?: string | null
  ventanaConEvento?: boolean
}): { techo: number | null; automatico: boolean; congelar: boolean; cambia: boolean; detalle: string } {
  if (positivo(e.presupuestoMensual)) {
    return { techo: e.presupuestoMensual, automatico: false, congelar: false, cambia: false, detalle: 'Presupuesto mensual de la ficha (solo Sponsored Products).' }
  }
  const previo = e.congelado && e.congelado.automatico && positivo(e.congelado.techo) ? e.congelado.techo : null
  const tocaRevisar = previo != null && !!e.congelado?.mes && !!e.mesActual && e.mesActual > e.congelado.mes && e.ventanaConEvento !== true
  if (previo != null && !tocaRevisar) {
    return { techo: previo, automatico: true, congelar: false, cambia: false, detalle: 'Techo automático congelado: se revisa una vez al mes (como mucho +25 %); una persona lo cambia en la Ficha.' }
  }
  if (!(Number.isFinite(e.gasto30) && e.gasto30 >= 1)) {
    if (previo != null) return { techo: previo, automatico: true, congelar: false, cambia: false, detalle: 'Techo automático congelado: sin gasto en 30 días no se revisa.' }
    return { techo: null, automatico: true, congelar: false, cambia: false, detalle: 'Sin gasto real en 30 días: sin techo, el agente no sube nada en la cuenta.' }
  }
  const es = (n: number) => redondear(n).toLocaleString('es-ES')
  const porTacos = positivo(e.tacosObjetivoPct) && positivo(e.ventasTotales30) ? (e.tacosObjetivoPct / 100) * e.ventasTotales30 : null
  const tope = e.gasto30 * AGENTE.TECHO_AUTO_CRECER_X
  let techo = porTacos != null ? Math.max(e.gasto30, Math.min(porTacos, tope)) : e.gasto30
  let detalle =
    porTacos == null
      ? `Gasto de los últimos 30 días = ${es(techo)} (sin ventas totales no sé el TACoS: no dejo crecer hasta saberlo).`
      : porTacos <= e.gasto30
        ? `Gasto de los últimos 30 días = ${es(techo)} (el TACoS va por encima del objetivo: ${e.tacosObjetivoPct!.toLocaleString('es-ES')} % × ventas totales ${es(e.ventasTotales30!)} = ${es(porTacos)}; no crece).`
        : porTacos <= tope
          ? `TACoS objetivo ${e.tacosObjetivoPct!.toLocaleString('es-ES')} % × ventas totales proyectadas ${es(e.ventasTotales30!)} = ${es(techo)} (el TACoS va bien: deja crecer sobre el gasto de 30 d, ${es(e.gasto30)}).`
          : `Gasto de 30 días ${es(e.gasto30)} + 25 % = ${es(techo)} (el TACoS objetivo daría ${es(porTacos)}: se crece como mucho un 25 % al mes).`
  if (previo != null) {
    // Revisión mensual: sube como mucho +25 % sobre el techo anterior; baja libre (sin bajar del gasto de 30 d, que ya está en el cálculo)
    const maximo = previo * AGENTE.TECHO_AUTO_CRECER_X
    if (techo > maximo) {
      techo = maximo
      detalle = `${detalle} Revisión mensual: sube como mucho un 25 % sobre el techo anterior (${es(previo)}).`
    } else detalle = `${detalle} Revisión mensual (antes ${es(previo)}).`
  }
  techo = redondear(techo)
  if (!(techo > 0)) return { techo: null, automatico: true, congelar: false, cambia: false, detalle: 'El techo calculado sale en cero: sin techo, el agente no sube nada en la cuenta.' }
  return { techo, automatico: true, congelar: true, cambia: previo == null || Math.abs(techo - previo) >= 0.01, detalle }
}

/** El techo de ESTE mes: × 1,3 en un mes con evento de temporada SOLO si un admin marcó `pico_eventos`; si no, el techo tal cual */
export function techoDelMes(techo: number | null, hayEventoEnElMes: boolean, picoEventos: boolean): number | null {
  if (techo == null || !Number.isFinite(techo)) return null
  return hayEventoEnElMes && picoEventos ? redondear(techo * AGENTE.PESO_MES_EVENTO) : techo
}

/* =============================================================================================================================================================
 * 3.3 · OBJETIVO MEDIO DE LA CUENTA
 * ============================================================================================================================================================= */

/** Σ(gasto30 × objetivo BASE) ÷ Σ gasto30 con los productos que tienen objetivo; si ninguno gasta, media simple; sin ninguno, null */
export function acosObjetivoMedio(productos: ReadonlyArray<{ acosObjetivoPct: number | null; gasto30: number }>): number | null {
  const con = productos.filter((p) => positivo(p.acosObjetivoPct)) as Array<{ acosObjetivoPct: number; gasto30: number }>
  if (con.length === 0) return null
  const gastoTotal = con.reduce((s, p) => s + (positivo(p.gasto30) ? p.gasto30 : 0), 0)
  if (gastoTotal > 0) return redondear1(con.reduce((s, p) => s + (positivo(p.gasto30) ? p.gasto30 * p.acosObjetivoPct : 0), 0) / gastoTotal)
  return redondear1(con.reduce((s, p) => s + p.acosObjetivoPct, 0) / con.length)
}

/* =============================================================================================================================================================
 * 3.5 · FASE Y MARCA
 * ============================================================================================================================================================= */

/** La fase de un producto: la manual si la hay; si no, «lanzamiento» si su primera estructura tiene menos de 60 días; si no, «normal» */
export function faseDeProducto(e: { faseManual: FaseDeProducto | null; primeraEstructuraAt: string | null; ahora: number }): FaseDeProducto {
  if (e.faseManual === 'lanzamiento' || e.faseManual === 'normal') return e.faseManual
  if (!e.primeraEstructuraAt) return 'normal'
  const t = Date.parse(e.primeraEstructuraAt)
  if (!Number.isFinite(t)) return 'normal'
  return e.ahora - t < AGENTE.LANZAMIENTO_DIAS * DIA_MS ? 'lanzamiento' : 'normal'
}

/**
 * EL OBJETIVO BASE de un producto (contra el que se miden las subidas; nunca el efectivo con postura): el humano tal cual; si no, el automático congelado (× acosLanzamientoX en lanzamiento);
 * si no, null (y entonces solo defensivo). Con ACoS humano no es «solo defensivo» aunque no haya equilibrio: lo decidió una persona.
 */
export function objetivoBase(e: {
  humano: number | null
  automatico: { acosObjetivoPct: number; fuente: Exclude<FuenteDeObjetivo, 'humano'>; soloDefensivo: boolean } | null
  fase: FaseDeProducto
  acosLanzamientoX: number
}): { acosObjetivoPct: number | null; fuente: FuenteDeObjetivo | null; soloDefensivo: boolean } {
  if (positivo(e.humano)) return { acosObjetivoPct: e.humano, fuente: 'humano', soloDefensivo: false }
  if (e.automatico && positivo(e.automatico.acosObjetivoPct)) {
    const x = e.fase === 'lanzamiento' && positivo(e.acosLanzamientoX) ? e.acosLanzamientoX : 1
    return { acosObjetivoPct: redondear1(e.automatico.acosObjetivoPct * x), fuente: e.automatico.fuente, soloDefensivo: e.automatico.soloDefensivo || e.automatico.fuente !== 'equilibrio' }
  }
  return { acosObjetivoPct: null, fuente: null, soloDefensivo: true }
}

/** Letras de un texto ya normalizado (para exigir una marca de ≥ 3 letras: «A» o «12» casarían con todo) */
const letras = (t: string) => (t.match(/\p{L}/gu) ?? []).length

/** ¿El término o la segmentación es de marca? Si su texto normalizado contiene la marca normalizada (de ≥ 3 letras) */
export function esTextoDeMarca(texto: string, marca: string | null): boolean {
  if (!marca || !texto) return false
  const m = normalizarTexto(marca)
  if (letras(m) < AGENTE.MARCA_LETRAS_MIN) return false
  return normalizarTexto(texto).includes(m)
}

/** ¿La campaña es de marca? Si su rol de nomenclatura es DEFENSA o MARCA, o si su nombre contiene la marca */
export function esCampanaDeMarca(nombre: string, rol: string | null, marca: string | null): boolean {
  if (rol) {
    const palabras = normalizarTexto(rol).split(/[^\p{L}\p{N}]+/u)
    if (palabras.includes('defensa') || palabras.includes('marca')) return true
  }
  return esTextoDeMarca(nombre, marca)
}

/* =============================================================================================================================================================
 * 3.4 · POSTURA, PRESIÓN Y COMBINACIÓN ACOTADA
 * ============================================================================================================================================================= */

const ENTEROS: ReadonlyArray<keyof UmbralesEstimados> = ['irrelevanteClics', 'pedidosParaCosechar', 'pedidosParaSubir', 'pedidosParaBajar', 'diasSinCerrar']

/**
 * LOS UMBRALES DEL MOTOR MOVIDOS POR LA POSTURA Y LA PRESIÓN DEL DÍA, con un acotado final que ninguna combinación se salta:
 *   1. Postura: crecer → subirPujaPct +5 (hasta 20; si ya pasaba de 20 se queda), subirSiAcosBajoX +0,10, pedidosParaSubir −1; recortar → sin subidas, bajarSiAcosSobreX −0,10 (mín 1,0).
 *   2. Presión: bajar → bajarSiAcosSobreX = 1,0, pedidosParaBajar −1 (mín 1); subir → subirSiAcosBajoX +0,15, pedidosParaSubir −1.
 *   3. Acotado: subirSiAcosBajoX ≤ 0,85; pedidosParaSubir ≥ 2 (≥ 3 en cuenta pequeña); subirPujaPct, pujaMaxBajadaPct, bajarSinPedidosPct ≤ 25; todo dentro de DESCRIPCION_DE_UMBRALES.
 *   4. acosParaSubir = objetivo BASE (≤ 0,95 × equilibrio si lo hay). acosParaBajar = base × 1,10 (crecer) / 0,85 (recortar) / 1, nunca > 0,95 × equilibrio; en marca × 0,5.
 *   5. sinSubidas si recortar, solo defensivo, marca o la cuenta no deja (ritmo recorte, rampa, techo nulo, 7 días tras un evento).
 * Un producto solo defensivo, de marca o sin equilibrio no puede «crecer»: su postura crecer se trata como mantener (red de seguridad; posturaFinal ya lo impide).
 */
export function combinarAjustes(
  u: UmbralesEstimados,
  a: { postura: Postura; presion: Presion | null | undefined; objetivoBase: number; equilibrioPct: number | null; soloDefensivo: boolean; esMarca: boolean; cuentaPequena: boolean; sinSubidasCuenta: boolean }
): { umbrales: UmbralesEstimados; acosParaBajar: number; acosParaSubir: number; sinSubidas: boolean } {
  const hayEquilibrio = positivo(a.equilibrioPct)
  const postura: Postura = a.postura === 'crecer' && (a.soloDefensivo || a.esMarca || !hayEquilibrio) ? 'mantener' : a.postura
  const x: UmbralesEstimados = { ...u }

  // 1) Postura
  if (postura === 'crecer') {
    if (x.subirPujaPct <= AGENTE.CRECER_SUBIR_PCT_MAX) x.subirPujaPct = Math.min(AGENTE.CRECER_SUBIR_PCT_MAX, x.subirPujaPct + AGENTE.CRECER_SUBIR_PCT_MAS)
    x.subirSiAcosBajoX += AGENTE.CRECER_SUBIR_X_MAS
    x.pedidosParaSubir -= 1
  } else if (postura === 'recortar') {
    x.bajarSiAcosSobreX = Math.max(1, x.bajarSiAcosSobreX - AGENTE.RECORTAR_BAJAR_X_MENOS)
  }

  // 2) Presión del día
  if (a.presion === 'bajar') {
    x.bajarSiAcosSobreX = 1
    x.pedidosParaBajar = Math.max(1, x.pedidosParaBajar - 1)
  } else if (a.presion === 'subir') {
    x.subirSiAcosBajoX += AGENTE.PRESION_SUBIR_X_MAS
    x.pedidosParaSubir -= 1
  }

  // 3) Acotado final: primero los límites de la pantalla, luego los del agente (más estrictos)
  for (const clave of Object.keys(DESCRIPCION_DE_UMBRALES) as Array<keyof UmbralesEstimados>) {
    const d = DESCRIPCION_DE_UMBRALES[clave]
    const v = Number.isFinite(x[clave]) ? x[clave] : u[clave]
    x[clave] = ENTEROS.includes(clave) ? Math.round(acotar(v, d.min, d.max)) : redondear(acotar(v, d.min, d.max), 4)
  }
  x.subirSiAcosBajoX = Math.min(AGENTE.SUBIR_X_MAX, x.subirSiAcosBajoX)
  x.pedidosParaSubir = Math.max(a.cuentaPequena ? AGENTE.CUENTA_PEQUENA_PEDIDOS_SUBIR : AGENTE.PEDIDOS_SUBIR_MIN, x.pedidosParaSubir)
  x.subirPujaPct = Math.min(AGENTE.PCT_CAMBIO_MAX, x.subirPujaPct)
  x.pujaMaxBajadaPct = Math.min(AGENTE.PCT_CAMBIO_MAX, x.pujaMaxBajadaPct)
  x.bajarSinPedidosPct = Math.min(AGENTE.PCT_CAMBIO_MAX, x.bajarSinPedidosPct)

  // 4) Objetivos para subir (base) y para bajar (efectivo)
  const base = a.objetivoBase
  const topeEquilibrio = hayEquilibrio ? (a.equilibrioPct as number) * AGENTE.CRECER_TOPE_EQUILIBRIO_X : Number.POSITIVE_INFINITY
  const acosParaSubir = redondear(Math.min(base, topeEquilibrio))
  const factorBajar = postura === 'crecer' ? AGENTE.CRECER_ACOS_X : postura === 'recortar' ? AGENTE.RECORTAR_ACOS_X : 1
  let acosParaBajar = Math.min(base * factorBajar, topeEquilibrio)
  if (a.esMarca) acosParaBajar *= AGENTE.MARCA_ACOS_X
  acosParaBajar = redondear(acosParaBajar)

  // 5) ¿Se puede subir?
  const sinSubidas = postura === 'recortar' || a.soloDefensivo || a.esMarca || a.sinSubidasCuenta

  return { umbrales: x, acosParaBajar, acosParaSubir, sinSubidas }
}

/**
 * ¿PUEDE SUBIR ESTA PUJA? Con los umbrales ya combinados: pedidos ≥ pedidosParaSubir, clics ≥ muestra mínima y ACoS < acosParaSubir × subirSiAcosBajoX. Sin ventas no hay ACoS → no.
 * motor-pujas descarta toda subida que no pase por aquí (y las que superen pujaMaxima).
 */
export function subidaPermitida(m: { clics: number; gasto: number; ventas: number; pedidos: number }, acosParaSubir: number, u: UmbralesEstimados, muestraMinima: number): boolean {
  if (!positivo(acosParaSubir) || !positivo(m.ventas)) return false
  if (!(m.pedidos >= u.pedidosParaSubir)) return false
  if (!(m.clics >= muestraMinima)) return false
  const acos = (m.gasto / m.ventas) * 100
  return Number.isFinite(acos) && acos < acosParaSubir * u.subirSiAcosBajoX
}

/**
 * LA PUJA MÁXIMA de una segmentación: min(tope fijo, precio × CVR × ACoS objetivo × 1,2). Sin precio o CVR, el tope fijo. Nunca por debajo de la puja mínima de Amazon (0,02).
 * El tope fijo es AGENTE.PUJA_MAX_ABSOLUTA (3) salvo `ads_agente.puja_max` de un admin; uno que no vale cae a ese.
 */
export function pujaMaxima(e: { precio: number | null; cvrPct: number | null; acosObjetivoPct: number; topeFijo: number }): number {
  const tope = positivo(e.topeFijo) ? e.topeFijo : AGENTE.PUJA_MAX_ABSOLUTA
  if (!positivo(e.precio) || !positivo(e.cvrPct) || !positivo(e.acosObjetivoPct)) return redondear(Math.max(AGENTE.PUJA_MINIMA, tope))
  const porRentabilidad = e.precio * (e.cvrPct / 100) * (e.acosObjetivoPct / 100) * AGENTE.PUJA_MAX_X
  return redondear(Math.max(AGENTE.PUJA_MINIMA, Math.min(tope, porRentabilidad)))
}
