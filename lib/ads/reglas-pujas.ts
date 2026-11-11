/**
 * AMAZON ADS · LAS REGLAS DE PUJA Y PRESUPUESTO DEL MOTOR (fase 3). PURAS: entran datos, salen propuestas con su motivo en una línea.
 *
 * PUJAS, por segmentación (keyword, producto o cláusula de la automática), con su ventana de lectura y SOLO con muestra suficiente (principio 03 del SOP):
 *
 *   SUBIR     vende y con un ACoS por debajo del 70 % del objetivo: hay margen para pujar más y ganar posición. Sube el % de la ficha («cambio de puja»).
 *   BAJAR     vende pero por encima del objetivo (más de un 15 %): se baja hacia la puja que dejaría el ACoS en el objetivo (puja × objetivo ÷ ACoS), como mucho el % de la ficha de golpe.
 *   BAJAR     gasta sin vender: ha consumido ya un CPA objetivo entero en clics sin una compra. Baja el % de la ficha (negativizar es para términos de búsqueda; aquí se le quita aire a la puja).
 *
 * PRESUPUESTO, por campaña: si cumple el ACoS objetivo y en la última semana se ha gastado de media el 90 % o más de su presupuesto diario (se queda corta), se propone subirlo el % de la ficha.
 *
 * Lo que NO hace: tocar campañas fuera de la nomenclatura, ni segmentaciones pausadas, ni proponer cambios de menos de 2 céntimos.
 */

import { pujaValida, type MetricasDeObjetivo } from './segmentaciones-calculo'

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
}

export interface ParametrosDePuja {
  /** ACoS objetivo del producto, en % */
  acosObjetivoPct: number
  /** Lo que cuesta conseguir una venta en el objetivo (precio × ACoS objetivo) */
  cpaObjetivo: number
  /** % de cambio de puja de la ficha (SOP: 10-20 %) */
  cambioPujaPct: number
  /** Clics mínimos para decidir nada */
  muestraMinimaClics: number
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
  metricas: { clics: number; gasto: number; pedidos: number; ventas: number; acosPct: number | null }
}

const r2 = (n: number) => Math.round(n * 100) / 100
const coma = (n: number, d = 1) => n.toLocaleString('es-ES', { minimumFractionDigits: d, maximumFractionDigits: d })

export function proponerPujas(segmentaciones: readonly SegmentacionParaReglas[], p: ParametrosDePuja): PropuestaDePuja[] {
  const salida: PropuestaDePuja[] = []
  const paso = Math.max(1, Math.min(50, p.cambioPujaPct)) / 100
  for (const s of segmentaciones) {
    if (!s.activa || !(s.puja > 0)) continue
    const m = s.metricas
    if (m.clics < p.muestraMinimaClics) continue
    const acos = m.ventas > 0 ? (m.gasto / m.ventas) * 100 : null
    const base = { objetivoId: s.id, objetivoTipo: s.tipo, texto: s.texto, campaignId: s.campaignId, campaignName: s.campaignName, adGroupId: s.adGroupId, pujaActual: r2(s.puja), metricas: { clics: m.clics, gasto: r2(m.gasto), pedidos: m.pedidos, ventas: r2(m.ventas), acosPct: acos == null ? null : Math.round(acos * 10) / 10 } }

    let nueva: number | null = null
    let motivo = ''
    if (m.pedidos >= 2 && acos !== null && acos < p.acosObjetivoPct * 0.7) {
      nueva = pujaValida(s.puja * (1 + paso))
      motivo = `${m.pedidos} pedidos con ACoS ${coma(acos)} %, muy por debajo del objetivo (${coma(p.acosObjetivoPct)} %): se puede pujar más para ganar posición`
    } else if (m.pedidos >= 1 && acos !== null && acos > p.acosObjetivoPct * 1.15) {
      const aObjetivo = s.puja * (p.acosObjetivoPct / acos)
      nueva = pujaValida(Math.max(aObjetivo, s.puja * (1 - paso)))
      motivo = `ACoS ${coma(acos)} % con ${m.pedidos} ${m.pedidos === 1 ? 'pedido' : 'pedidos'}, por encima del objetivo (${coma(p.acosObjetivoPct)} %): se baja la puja hacia la que lo dejaría en el objetivo`
    } else if (m.pedidos === 0 && m.gasto >= p.cpaObjetivo && p.cpaObjetivo > 0) {
      nueva = pujaValida(s.puja * (1 - paso))
      motivo = `${coma(m.gasto, 2)} gastados en ${m.clics} clics sin ninguna venta (un CPA objetivo entero, ${coma(p.cpaObjetivo, 2)}): se le baja la puja`
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
  motivo: string
  metricas: { gasto: number; ventas: number; acosPct: number | null; usoPct: number }
}

export function proponerPresupuestos(campanas: readonly CampanaParaPresupuesto[], p: { acosObjetivoPct: number; subidaPct: number }): PropuestaDePresupuesto[] {
  const salida: PropuestaDePresupuesto[] = []
  for (const c of campanas) {
    if (!c.activa || c.presupuesto == null || c.presupuesto <= 0 || c.diasConDatos < 5) continue
    const media = c.gasto7 / c.diasConDatos
    const uso = media / c.presupuesto
    const acos = c.ventas7 > 0 ? (c.gasto7 / c.ventas7) * 100 : null
    if (uso < 0.9 || acos === null || acos > p.acosObjetivoPct) continue
    const nuevo = r2(c.presupuesto * (1 + Math.max(1, Math.min(100, p.subidaPct)) / 100))
    salida.push({
      campaignId: c.campaignId,
      campaignName: c.campaignName,
      presupuestoActual: c.presupuesto,
      presupuestoNuevo: nuevo,
      motivo: `Gasta de media el ${Math.round(uso * 100)} % de su presupuesto (se queda corta) con ACoS ${coma(acos)} %, dentro del objetivo (${coma(p.acosObjetivoPct)} %): más presupuesto, más ventas rentables`,
      metricas: { gasto: r2(c.gasto7), ventas: r2(c.ventas7), acosPct: Math.round(acos * 10) / 10, usoPct: Math.round(uso * 100) },
    })
  }
  return salida
}
