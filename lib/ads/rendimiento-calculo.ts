/**
 * AMAZON ADS · EL RENDIMIENTO DE UNA CUENTA: DE LAS FILAS DIARIAS DEL INFORME A LAS CIFRAS DE LA PANTALLA.
 *
 * PURO: sin red ni base de datos, y por eso se prueba con datos de mentira y se importa desde el navegador. Entra el informe `spCampaigns` agrupado por campaña y por día; salen los totales de un
 * periodo, su comparación con el anterior, la serie diaria y el desglose por campaña y por tipo de campaña.
 *
 * Las fórmulas son las de la consola de Amazon Ads:
 *   ACoS = gasto ÷ ventas       ROAS = ventas ÷ gasto       CTR = clics ÷ impresiones
 *   CPC  = gasto ÷ clics        CVR  = pedidos ÷ clics
 * Con denominador 0 el resultado es null (no 0): «sin ventas» y «0 % de ACoS» no son lo mismo y la pantalla pinta un guion.
 */

import { partesDeNombre } from './reglas'

export interface FilaDiaria {
  /** 'YYYY-MM-DD' */
  fecha: string
  campaignId: string
  nombre: string
  impresiones: number
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
}

export interface Totales {
  impresiones: number
  clics: number
  gasto: number
  ventas: number
  pedidos: number
  unidades: number
  acos: number | null
  roas: number | null
  ctr: number | null
  cpc: number | null
  cvr: number | null
}

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN
  return Number.isFinite(n) ? n : 0
}

/** De las filas crudas del informe (`date`, `campaignId`, `cost`, `sales7d`, `purchases7d`…) a filas diarias. Se descartan las que no traen fecha o campaña */
export function filasDeInforme(crudas: ReadonlyArray<Record<string, unknown>>): FilaDiaria[] {
  const salida: FilaDiaria[] = []
  for (const r of crudas) {
    const fecha = typeof r.date === 'string' ? r.date.slice(0, 10) : ''
    const campaignId = r.campaignId == null ? '' : String(r.campaignId)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !campaignId) continue
    salida.push({
      fecha,
      campaignId,
      nombre: typeof r.campaignName === 'string' ? r.campaignName : '(sin nombre)',
      impresiones: num(r.impressions),
      clics: num(r.clicks),
      gasto: num(r.cost),
      ventas: num(r.sales7d),
      pedidos: num(r.purchases7d),
      unidades: num(r.unitsSoldClicks7d),
    })
  }
  return salida
}

const dividir = (a: number, b: number): number | null => (b > 0 ? a / b : null)

export function totalesDe(filas: ReadonlyArray<Pick<FilaDiaria, 'impresiones' | 'clics' | 'gasto' | 'ventas' | 'pedidos' | 'unidades'>>): Totales {
  const t = { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0, unidades: 0 }
  for (const f of filas) {
    t.impresiones += f.impresiones
    t.clics += f.clics
    t.gasto += f.gasto
    t.ventas += f.ventas
    t.pedidos += f.pedidos
    t.unidades += f.unidades
  }
  return { ...t, acos: dividir(t.gasto, t.ventas), roas: dividir(t.ventas, t.gasto), ctr: dividir(t.clics, t.impresiones), cpc: dividir(t.gasto, t.clics), cvr: dividir(t.pedidos, t.clics) }
}

/** La variación relativa de una cifra frente a la del periodo anterior (0,12 = +12 %). null si no hay con qué comparar */
export function variacion(actual: number | null, anterior: number | null): number | null {
  if (actual === null || anterior === null || anterior === 0) return null
  return (actual - anterior) / Math.abs(anterior)
}

export interface PuntoDeSerie {
  fecha: string
  gasto: number
  ventas: number
  clics: number
  pedidos: number
  acos: number | null
}

/** Una fila por día de `dias` (los que no tienen datos, a cero: la gráfica no se salta días). `dias` en orden cronológico */
export function serieDiaria(filas: ReadonlyArray<FilaDiaria>, dias: readonly string[]): PuntoDeSerie[] {
  const por = new Map<string, { gasto: number; ventas: number; clics: number; pedidos: number }>(dias.map((d) => [d, { gasto: 0, ventas: 0, clics: 0, pedidos: 0 }]))
  for (const f of filas) {
    const p = por.get(f.fecha)
    if (!p) continue
    p.gasto += f.gasto
    p.ventas += f.ventas
    p.clics += f.clics
    p.pedidos += f.pedidos
  }
  return dias.map((d) => {
    const p = por.get(d) as { gasto: number; ventas: number; clics: number; pedidos: number }
    return { fecha: d, ...p, acos: dividir(p.gasto, p.ventas) }
  })
}

/** Los días 'YYYY-MM-DD' de un rango, ambos incluidos, en orden. Opera en UTC para no depender de la zona horaria de quien mira */
export function diasDelRango(desde: string, hasta: string): string[] {
  const salida: string[] = []
  const fin = Date.parse(`${hasta}T00:00:00Z`)
  for (let t = Date.parse(`${desde}T00:00:00Z`); t <= fin && salida.length < 400; t += 86_400_000) salida.push(new Date(t).toISOString().slice(0, 10))
  return salida
}

export interface CampanaConCifras extends Totales {
  campaignId: string
  nombre: string
}

/** Los totales de cada campaña en las filas dadas, de más a menos gasto */
export function porCampana(filas: ReadonlyArray<FilaDiaria>): CampanaConCifras[] {
  const grupos = new Map<string, { nombre: string; filas: FilaDiaria[] }>()
  for (const f of filas) {
    const g = grupos.get(f.campaignId)
    if (g) g.filas.push(f)
    else grupos.set(f.campaignId, { nombre: f.nombre, filas: [f] })
  }
  return [...grupos.entries()].map(([campaignId, g]) => ({ campaignId, nombre: g.nombre, ...totalesDe(g.filas) })).sort((a, b) => b.gasto - a.gasto)
}

/** El tipo de campaña a partir de su nombre: el rol del SOP si sigue la nomenclatura, y si no, «Otras» (las campañas de antes de la metodología) */
export function tipoDeCampana(nombre: string): string {
  return partesDeNombre(nombre)?.rol ?? 'Otras'
}

export interface ReparteDelGasto {
  tipo: string
  gasto: number
  ventas: number
  campanas: number
  /** Parte del gasto total, 0..1 */
  parte: number
}

/** Cuánto gasta y vende cada tipo de campaña, de más a menos gasto */
export function repartoPorTipo(campanas: ReadonlyArray<CampanaConCifras>): ReparteDelGasto[] {
  const por = new Map<string, { gasto: number; ventas: number; campanas: number }>()
  for (const c of campanas) {
    const t = tipoDeCampana(c.nombre)
    const x = por.get(t) ?? { gasto: 0, ventas: 0, campanas: 0 }
    x.gasto += c.gasto
    x.ventas += c.ventas
    x.campanas += 1
    por.set(t, x)
  }
  const total = [...por.values()].reduce((a, x) => a + x.gasto, 0)
  return [...por.entries()].map(([tipo, x]) => ({ tipo, ...x, parte: total > 0 ? x.gasto / total : 0 })).sort((a, b) => b.gasto - a.gasto)
}

/** Las campañas que gastan y no venden nada en el periodo, con al menos `gastoMinimo`: las que primero hay que mirar */
export function gastanSinVender(campanas: ReadonlyArray<CampanaConCifras>, gastoMinimo = 5): CampanaConCifras[] {
  return campanas.filter((c) => c.pedidos === 0 && c.gasto >= gastoMinimo)
}
