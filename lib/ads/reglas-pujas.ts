/**
 * AMAZON ADS · LAS REGLAS DE PUJA, PAUSA Y PRESUPUESTO DEL MOTOR. PURAS: entran datos, salen propuestas con su motivo en una línea.
 *
 * PUJAS, por segmentación (keyword, producto o cláusula de la automática), con 14 días que acaban 3 antes de hoy y SOLO con muestra suficiente: al menos la muestra mínima de la ficha (principio 03
 * del SOP) y al menos 1 ÷ CVR clics (los que «cuesta» un pedido). La PUJA OBJETIVO es la que deja el ACoS en el objetivo: ventas por clic × ACoS objetivo.
 *
 *   SUBIR     ≥ 3 pedidos y ACoS < 0,7× el objetivo: sube un 15 %, sin pasar de la puja objetivo (si ya la pasa, no hay nada que ganar subiendo).
 *   BAJAR     ≥ 2 pedidos y ACoS > 1,2× el objetivo: baja HACIA la puja objetivo, como mucho un 25 % de golpe (para no matar un término por ruido).
 *   BAJAR     0 pedidos con ≥ 1 ÷ CVR clics, sin llegar al tope de pausar: −15 %.
 *
 * PAUSAR, por segmentación: keyword o ASIN con 0 pedidos que pasa el tope de excluir (clics ≥ 3 ÷ CVR, o gasto ≥ 1,5 × CPA objetivo). Nunca una cláusula de la automática ni una semilla de
 * EXACTA DOMINIO: ahí se baja la puja.
 *
 * PRESUPUESTO, por campaña: se queda corta (gasta de media el 90 % o más) y cumple el ACoS objetivo → sube el % de la ficha (SOP y Amazon: +20 %). Si se queda corta perdiendo dinero NO se toca el
 * presupuesto: se corrigen las pujas (investigación nov 2026, regla 9).
 *
 * Todos los cortes que no son del SOP están en umbrales.ts como ESTIMACIÓN y se cambian por cuenta. Lo que NO hace: tocar campañas fuera de la nomenclatura, segmentaciones pausadas, ni proponer
 * cambios de menos de 2 céntimos.
 */

import { pujaValida, type MetricasDeObjetivo } from './segmentaciones-calculo'
import { clicsPorPedido, UMBRALES_DE_PARTIDA, type UmbralesEstimados } from './umbrales'

export interface SegmentacionParaReglas {
  id: string
  tipo: 'keyword' | 'producto' | 'auto'
  texto: string
  campaignId: string
  campaignName: string
  adGroupId: string
  /** La puja que se está usando (la propia o, si no tiene, la del grupo) */
  puja: number
  activa: boolean
  metricas: Pick<MetricasDeObjetivo, 'impresiones' | 'clics' | 'gasto' | 'ventas' | 'pedidos'>
  /** CVR de referencia de su campaña (pedidos ÷ clics). Sin él, el de partida */
  cvr?: number
  /** Es una semilla de EXACTA DOMINIO (no se pausa) */
  esSemilla?: boolean
}

export interface ParametrosDePuja {
  /** ACoS objetivo del producto, en % */
  acosObjetivoPct: number
  /** Lo que cuesta conseguir una venta en el objetivo (precio × ACoS objetivo) */
  cpaObjetivo: number
  /** Ya no fija el paso (lo fijan los umbrales estimados); se conserva por compatibilidad */
  cambioPujaPct?: number
  /** Clics mínimos para decidir nada (ficha, principio 03) */
  muestraMinimaClics: number
  /** Los cortes que el SOP no fija (estimación, configurables por cuenta). Sin ellos, los de partida */
  umbrales?: UmbralesEstimados
}

export interface PropuestaDePuja {
  objetivoId: string
  objetivoTipo: SegmentacionParaReglas['tipo']
  texto: string
  campaignId: string
  campaignName: string
  adGroupId: string
  pujaActual: number
  pujaNueva: number
  direccion: 'subir' | 'bajar'
  motivo: string
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null; pujaObjetivo: number | null; cvrPct: number }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const coma = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })

/** La puja que deja el ACoS en el objetivo: ventas por clic × ACoS objetivo. null sin ventas */
export function pujaObjetivo(m: { clics: number; ventas: number }, acosObjetivoPct: number): number | null {
  if (!(m.clics > 0) || !(m.ventas > 0)) return null
  return r2((m.ventas / m.clics) * (acosObjetivoPct / 100))
}

export function proponerPujas(segmentaciones: readonly SegmentacionParaReglas[], p: ParametrosDePuja): PropuestaDePuja[] {
  const salida: PropuestaDePuja[] = []
  const u = p.umbrales ?? UMBRALES_DE_PARTIDA
  for (const s of segmentaciones) {
    if (!s.activa || !(s.puja > 0)) continue
    const m = s.metricas
    const cvr = s.cvr ?? u.cvrPorDefectoPct / 100
    const unPedido = clicsPorPedido(cvr)
    if (m.clics < Math.max(p.muestraMinimaClics, unPedido)) continue
    const acos = m.ventas > 0 ? (m.gasto / m.ventas) * 100 : null
    const objetivo = pujaObjetivo(m, p.acosObjetivoPct)
    const base = {
      objetivoId: s.id,
      objetivoTipo: s.tipo,
      texto: s.texto,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      adGroupId: s.adGroupId,
      pujaActual: r2(s.puja),
      metricas: { clics: m.clics, gasto: r2(m.gasto), pedidos: m.pedidos, ventas: r2(m.ventas), acosPct: acos == null ? null : Math.round(acos * 10) / 10, pujaObjetivo: objetivo, cvrPct: Math.round(cvr * 1000) / 10 },
    }

    let nueva: number | null = null
    let motivo = ''
    if (m.pedidos >= u.pedidosParaSubir && acos !== null && acos < p.acosObjetivoPct * u.subirSiAcosBajoX && objetivo !== null && objetivo > s.puja) {
      nueva = pujaValida(Math.min(s.puja * (1 + u.subirPujaPct / 100), objetivo))
      motivo = `${m.pedidos} pedidos con ACoS ${coma(acos)} %, muy por debajo del objetivo (${coma(p.acosObjetivoPct)} %): cada clic trae ${coma(m.ventas / m.clics, 2)} en ventas y se puede pujar hasta ${coma(objetivo, 2)}. Se sube para ganar posición`
    } else if (m.pedidos >= u.pedidosParaBajar && acos !== null && acos > p.acosObjetivoPct * u.bajarSiAcosSobreX && objetivo !== null) {
      nueva = pujaValida(Math.max(objetivo, s.puja * (1 - u.pujaMaxBajadaPct / 100)))
      motivo = `ACoS ${coma(acos)} % con ${m.pedidos} pedidos, por encima del objetivo (${coma(p.acosObjetivoPct)} %): la puja que lo deja en el objetivo es ${coma(objetivo, 2)} (${coma(m.ventas / m.clics, 2)} en ventas por clic × ${coma(p.acosObjetivoPct)} %)${objetivo < s.puja * (1 - u.pujaMaxBajadaPct / 100) ? `; se baja como mucho un ${u.pujaMaxBajadaPct} % de golpe` : ''}`
    } else if (m.pedidos === 0 && m.ventas === 0) {
      nueva = pujaValida(s.puja * (1 - u.bajarSinPedidosPct / 100))
      motivo = `${coma(m.gasto, 2)} gastados en ${m.clics} clics sin ningún pedido (con un CVR del ${coma(cvr * 100)} %, a estas alturas tendría que llevar al menos uno): se le baja la puja un ${u.bajarSinPedidosPct} %`
    }
    if (nueva == null || Math.abs(nueva - s.puja) < 0.02) continue
    salida.push({ ...base, pujaNueva: nueva, direccion: nueva > s.puja ? 'subir' : 'bajar', motivo })
  }
  // Primero lo que más dinero mueve
  return salida.sort((a, b) => b.metricas.gasto - a.metricas.gasto)
}

export interface CampanaParaPresupuesto {
  campaignId: string
  campaignName: string
  presupuesto: number | null
  activa: boolean
  /** Gasto de los últimos 7 días y en cuántos de ellos hubo gasto (para la media) */
  gasto7: number
  diasConDatos: number
  ventas7: number
}

export interface PropuestaDePresupuesto {
  campaignId: string
  campaignName: string
  presupuestoActual: number
  presupuestoNuevo: number
  direccion: 'subir'
  motivo: string
  metricas: { gasto: number; ventas: number; acosPct: number | null; usoPct: number }
}

/** SUBIR el presupuesto de lo que se queda corto cumpliendo el ACoS objetivo (el % de la ficha). Lo que se queda corto perdiendo dinero no se toca: se arregla con pujas */
export function proponerPresupuestos(campanas: readonly CampanaParaPresupuesto[], p: { acosObjetivoPct: number; subidaPct: number; umbrales?: UmbralesEstimados }): PropuestaDePresupuesto[] {
  const salida: PropuestaDePresupuesto[] = []
  const u = p.umbrales ?? UMBRALES_DE_PARTIDA
  for (const c of campanas) {
    if (!c.activa || c.presupuesto == null || c.presupuesto <= 0 || c.diasConDatos < 5) continue
    const media = c.gasto7 / c.diasConDatos
    const uso = media / c.presupuesto
    const acos = c.ventas7 > 0 ? (c.gasto7 / c.ventas7) * 100 : null
    if (uso < u.usoPresupuestoCortoPct / 100 || acos === null || acos > p.acosObjetivoPct) continue
    salida.push({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      presupuestoActual: c.presupuesto,
      presupuestoNuevo: r2(c.presupuesto * (1 + Math.max(1, Math.min(100, p.subidaPct)) / 100)),
      direccion: 'subir',
      motivo: `Gasta de media el ${Math.round(uso * 100)} % de su presupuesto (se queda corta) con ACoS ${coma(acos)} %, dentro del objetivo (${coma(p.acosObjetivoPct)} %): más presupuesto, más ventas rentables`,
      metricas: { gasto: r2(c.gasto7), ventas: r2(c.ventas7), acosPct: Math.round(acos * 10) / 10, usoPct: Math.round(uso * 100) },
    })
  }
  return salida
}

/* ------------------------------------------------------------------ */
/* Pausar                                                              */
/* ------------------------------------------------------------------ */

export interface PropuestaDePausa {
  objetivoId: string
  objetivoTipo: 'keyword' | 'producto'
  texto: string
  campaignId: string
  campaignName: string
  adGroupId: string
  motivo: string
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: null; cvrPct: number }
}

/**
 * PAUSAR UNA KEYWORD O UN ASIN que pasa el tope de excluir sin un solo pedido: la regla de negativizar llevada a la segmentación (un término se excluye; una keyword que no vende, se para). Bajarle la
 * puja un poco cada ciclo a algo que ya ha demostrado que no convierte solo alarga la pérdida.
 *
 * NO se pausan las cláusulas de la automática (la AUTO RADAR «no se apaga nunca»: ahí se baja la puja o se excluyen términos) ni las semillas de EXACTA DOMINIO (investigación, regla 3: ahí se
 * baja la puja). El SOP no tiene «Pausar» en el vocabulario del Log: siempre pide aprobación y el Log lo deja fuera, diciéndolo.
 */
export function proponerPausas(segmentaciones: readonly SegmentacionParaReglas[], p: { cpaObjetivo: number; muestraMinimaClics: number; umbrales?: UmbralesEstimados }): PropuestaDePausa[] {
  const salida: PropuestaDePausa[] = []
  const u = p.umbrales ?? UMBRALES_DE_PARTIDA
  const gastoTope = p.cpaObjetivo > 0 ? r2(p.cpaObjetivo * u.negativizarGastoXCpa) : 0
  for (const s of segmentaciones) {
    if (!s.activa || s.tipo === 'auto' || s.esSemilla) continue
    const m = s.metricas
    if (m.pedidos > 0 || m.ventas > 0) continue
    const cvr = s.cvr ?? u.cvrPorDefectoPct / 100
    // Nunca con menos clics de los que cuesta un pedido (ni de la muestra mínima): dos clics caros no demuestran nada
    if (m.clics < Math.max(p.muestraMinimaClics, clicsPorPedido(cvr))) continue
    const clicsTope = Math.ceil(u.negativizarClicsPorCvr / cvr - 1e-9)
    const porClics = m.clics >= clicsTope
    const porGasto = gastoTope > 0 && m.gasto >= gastoTope
    if (!porClics && !porGasto) continue
    salida.push({
      objetivoId: s.id,
      objetivoTipo: s.tipo,
      texto: s.texto,
      campaignId: s.campaignId,
      campaignName: s.campaignName,
      adGroupId: s.adGroupId,
      motivo: `${coma(m.gasto, 2)} gastados en ${m.clics} clics sin ningún pedido (${porClics ? `con un CVR del ${coma(cvr * 100)} %, ${clicsTope} clics sin pedido ya no son mala suerte` : `pasa ${coma(u.negativizarGastoXCpa)}× el CPA objetivo, ${coma(gastoTope, 2)}`}). Bajar la puja solo alargaría la pérdida: se pausa`,
      metricas: { clics: m.clics, gasto: r2(m.gasto), pedidos: 0, ventas: 0, acosPct: null, cvrPct: Math.round(cvr * 1000) / 10 },
    })
  }
  return salida.sort((a, b) => b.metricas.gasto - a.metricas.gasto)
}
