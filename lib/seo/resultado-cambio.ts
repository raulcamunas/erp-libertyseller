/**
 * SEO · EL RESULTADO DE UN CAMBIO DE FICHA. PURO (se prueba sin base de datos).
 *
 * Compara las 3 semanas ANTES del cambio con las 3 DESPUÉS (la semana del cambio no cuenta: va a medias) con la CESTA FIJA del producto (lib/seo/cesta.ts): las búsquedas del producto que
 * más compras movían la última semana antes del cambio. Así las búsquedas nuevas que traiga el cambio no ensucian la cuota (comparar cestas distintas engaña) y la temporada tampoco: se mira la
 * CUOTA (lo nuestro entre todo lo de Amazon), no las compras a secas, que en noviembre suben para todos.
 *
 * Lo que se mira, por orden:
 *   1. cuota de compras de la cesta (si hay compras propias suficientes para que el cambio no sea azar);
 *   2. si no, cuota de impresiones (lo primero que mueve el SEO: salir más veces).
 *   Mejora o empeora si se mueve un 10 % o más (relativo); si no, «se queda igual».
 *
 * NO SE PUEDE ATRIBUIR si en las 6 semanas hubo una rotura de stock (3 días o más sin vender, del libro mayor de FBA) u OTRO cambio de ficha del mismo producto: el resultado sería de eso.
 * Si el gasto de publicidad cambió mucho (±40 %), se juzga igual pero se avisa: parte del efecto puede venir de ahí.
 *
 * Además, las búsquedas que el cambio METIÓ o SACÓ de la ficha (enteras en el título o en algún sitio) con su cuota antes y después: es lo que el cambio tocó directamente.
 */

import type { ConsultaGuardada } from './datos'
import { cestaFija, type PuntoDeCesta } from './cesta'
import { coberturaDe, type TextosDeFicha } from './cobertura'
import { claveDeBusqueda, type DecisionesDeBusquedas } from './embudo'
import { sinVentasEnPeriodo, type TramoSinVentas } from './sin-stock'
import type { TextosFicha } from './edicion'

export const SEMANAS_A_COMPARAR = 3
export const DIAS_PARA_JUZGAR = 21
/** Variación relativa de la cuota a partir de la cual se dice que mejora o empeora */
export const UMBRAL_VARIACION = 0.1
/** Compras propias (antes + después) por debajo de las cuales la cuota de compras es azar y se juzga por impresiones */
export const COMPRAS_MINIMAS = 10
/** Días sin vender en las 6 semanas que bastan para no poder atribuir nada al cambio */
export const DIAS_SIN_STOCK_QUE_ENSUCIAN = 3
/** Cambio del gasto de publicidad (relativo) a partir del cual se avisa */
export const CAMBIO_PPC_QUE_AVISA = 0.4

export type EstadoResultado = 'esperando' | 'provisional' | 'mejora' | 'empeora' | 'igual' | 'pocos-datos' | 'no-atribuible'

export interface MedidasDeVentana {
  semanas: number
  cuotaImpresiones: number | null
  cuotaClics: number | null
  cuotaCompras: number | null
  /** Compras propias en la cesta, por semana */
  comprasSemana: number | null
  /** Gasto de publicidad del producto por semana (null si no hay Marketing Test) */
  gastoSemana: number | null
}

export interface BusquedaTocada {
  consulta: string
  /** entra: el cambio la puso entera (en el título o en la ficha); sale: la quitó */
  cambio: 'entra' | 'sale'
  donde: 'titulo' | 'ficha'
  comprasMercado: number
  antes: { cuotaImpresiones: number | null; comprasAsin: number | null; semanas: number }
  despues: { cuotaImpresiones: number | null; comprasAsin: number | null; semanas: number }
}

export interface ResultadoDelCambio {
  estado: EstadoResultado
  fechaCambio: string
  juzgableDesde: string
  /** Qué cuota decide: compras o, sin compras suficientes, impresiones */
  medida: 'compras' | 'impresiones' | null
  /** Variación relativa de la medida (0,18 = +18 %) */
  variacion: number | null
  antes: MedidasDeVentana
  despues: MedidasDeVentana
  /** La serie semanal de la cesta (antes, la semana del cambio y después) para pintarla con la marca del cambio */
  serie: Array<PuntoDeCesta & { lado: 'antes' | 'cambio' | 'despues' }>
  cesta: string[]
  tocadas: BusquedaTocada[]
  avisos: string[]
  /** Una frase para la tarjeta */
  resumen: string
}

export interface EntradaDeResultado {
  asin: string
  /** Cuándo quedó aplicado (AAAA-MM-DD o ISO) */
  fecha: string
  antes: Partial<TextosFicha>
  despues: Partial<TextosFicha>
  /** Las búsquedas semanales del producto (pueden venir más: se filtran por asin y WEEK) */
  filas: readonly ConsultaGuardada[]
  precio?: number | null
  decisiones?: DecisionesDeBusquedas
  sinVentas?: readonly TramoSinVentas[] | null
  gastoSemanal?: ReadonlyArray<{ desde: string; gasto: number }> | null
  /** Fechas de los OTROS cambios aplicados del mismo producto */
  otrosCambios?: readonly string[]
  hoy: string
}

const DIA = 86_400_000
const sumarDias = (d: string, n: number) => new Date(Date.parse(`${d.slice(0, 10)}T00:00:00Z`) + n * DIA).toISOString().slice(0, 10)
const media = (xs: Array<number | null>): number | null => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x))
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
}
const pct = (x: number) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x * 100))} %`
const fechaCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })

const aCobertura = (t: Partial<TextosFicha>): TextosDeFicha => ({ titulo: t.titulo ?? '', bullets: t.bullets ?? [], descripcion: t.descripcion ?? null, backend: t.backend ?? '', highlights: t.highlights ?? null })

function medidas(puntos: PuntoDeCesta[], gasto: ReadonlyArray<{ desde: string; gasto: number }> | null | undefined): MedidasDeVentana {
  const validos = puntos.filter((p) => p.cuotaImpresiones != null || p.cuotaCompras != null)
  let gastoSemana: number | null = null
  if (gasto) {
    const porSemana = new Map(gasto.map((g) => [g.desde, g.gasto]))
    gastoSemana = media(puntos.map((p) => porSemana.get(p.desde) ?? 0))
  }
  return {
    semanas: validos.length,
    cuotaImpresiones: media(validos.map((p) => p.cuotaImpresiones)),
    cuotaClics: media(validos.map((p) => p.cuotaClics)),
    cuotaCompras: media(validos.map((p) => p.cuotaCompras)),
    comprasSemana: media(validos.map((p) => p.comprasAsin)),
    gastoSemana,
  }
}

const relativa = (a: number | null, b: number | null): number | null => (a != null && b != null && a > 0 ? b / a - 1 : null)

export function resultadoDelCambio(e: EntradaDeResultado): ResultadoDelCambio {
  const fecha = e.fecha.slice(0, 10)
  const juzgableDesde = sumarDias(fecha, DIAS_PARA_JUZGAR)
  const semanales = e.filas.filter((f) => f.asin === e.asin && f.periodo === 'WEEK')
  const semanas = [...new Map(semanales.map((f) => [f.desde, f.hasta])).entries()].sort((a, b) => a[0].localeCompare(b[0]))
  const antesSem = semanas.filter(([, hasta]) => hasta < fecha).slice(-SEMANAS_A_COMPARAR)
  const despuesSem = semanas.filter(([desde]) => desde > fecha).slice(0, SEMANAS_A_COMPARAR)
  const vacio: MedidasDeVentana = { semanas: 0, cuotaImpresiones: null, cuotaClics: null, cuotaCompras: null, comprasSemana: null, gastoSemana: null }
  const base = { fechaCambio: fecha, juzgableDesde, medida: null, variacion: null, antes: vacio, despues: vacio, serie: [], cesta: [], tocadas: [], avisos: [] as string[] }

  if (antesSem.length === 0)
    return { ...base, estado: 'pocos-datos', resumen: 'No hay semanas de Brand Analytics de antes del cambio con las que comparar.' }

  // La cesta se elige con la última semana ANTES del cambio y se sigue igual después
  const ultimaAntes = antesSem[antesSem.length - 1][0]
  const { consultas: cesta, serie: serieCompleta } = cestaFija(semanales, e.asin, 'WEEK', e.precio ?? null, undefined, { ultimo: ultimaAntes, ...(e.decisiones ?? {}) })
  // cestaFija corta en `ultimo`: para las semanas de después se recalcula con la misma cesta sumando a mano
  const claves = new Set(cesta.map(claveDeBusqueda))
  const puntoDe = (desde: string, hasta: string): PuntoDeCesta => {
    const ya = serieCompleta.find((p) => p.desde === desde)
    if (ya) return ya
    const sub = semanales.filter((f) => f.desde === desde && claves.has(claveDeBusqueda(f.consulta)))
    // Reutiliza cestaFija sobre esa semana con la cesta forzada: una cesta de la semana con solo esas filas da los mismos sumatorios
    let impT = 0, impA = 0, cliT = 0, cliA = 0, comT = 0, comA = 0, volumen = 0
    const vistas = new Set<string>()
    for (const f of sub) {
      const k = claveDeBusqueda(f.consulta)
      if (vistas.has(k)) continue
      vistas.add(k)
      volumen += f.volumen ?? 0
      const ia = f.impresionesAsin ?? (f.cuotaImpresiones != null && f.impresionesTotal != null ? f.cuotaImpresiones * f.impresionesTotal : null)
      if (f.impresionesTotal != null && ia != null) { impT += f.impresionesTotal; impA += ia }
      const ca = f.clicsAsin ?? (f.cuotaClics != null && f.clicsTotal != null ? f.cuotaClics * f.clicsTotal : null)
      if (f.clicsTotal != null && ca != null) { cliT += f.clicsTotal; cliA += ca }
      comT += f.comprasTotal ?? 0
      comA += f.comprasAsin ?? (f.cuotaCompras != null && f.comprasTotal != null ? f.cuotaCompras * f.comprasTotal : 0)
    }
    const presentes = vistas.size
    const total = claves.size
    if (total === 0 || presentes / total < 0.5) return { desde, hasta, cuotaImpresiones: null, cuotaClics: null, cuotaCompras: null, comprasAsin: null, volumen: null, presentes, total }
    const div = (a: number, b: number) => (b > 0 ? a / b : null)
    return { desde, hasta, cuotaImpresiones: div(impA, impT), cuotaClics: div(cliA, cliT), cuotaCompras: div(comA, comT), comprasAsin: comA, volumen, presentes, total }
  }

  const puntosAntes = antesSem.map(([d, h]) => puntoDe(d, h))
  const puntosDespues = despuesSem.map(([d, h]) => puntoDe(d, h))
  const semanaDelCambio = semanas.find(([d, h]) => d <= fecha && h >= fecha)
  const serie: ResultadoDelCambio['serie'] = [
    ...puntosAntes.map((p) => ({ ...p, lado: 'antes' as const })),
    ...(semanaDelCambio ? [{ ...puntoDe(semanaDelCambio[0], semanaDelCambio[1]), lado: 'cambio' as const }] : []),
    ...puntosDespues.map((p) => ({ ...p, lado: 'despues' as const })),
  ]
  const antes = medidas(puntosAntes, e.gastoSemanal)
  const despues = medidas(puntosDespues, e.gastoSemanal)

  // Las búsquedas que el cambio metió o sacó
  const fichaAntes = aCobertura(e.antes)
  const fichaDespues = aCobertura({ ...e.antes, ...e.despues })
  const porConsulta = new Map<string, ConsultaGuardada[]>()
  for (const f of semanales) {
    const k = claveDeBusqueda(f.consulta)
    porConsulta.set(k, [...(porConsulta.get(k) ?? []), f])
  }
  const desdesAntes = new Set(antesSem.map(([d]) => d))
  const desdesDespues = new Set(despuesSem.map(([d]) => d))
  const lado = (filas: ConsultaGuardada[], desdes: Set<string>) => {
    const fs = filas.filter((f) => desdes.has(f.desde))
    return { cuotaImpresiones: media(fs.map((f) => f.cuotaImpresiones)), comprasAsin: fs.length ? fs.reduce((a, f) => a + (f.comprasAsin ?? 0), 0) / fs.length : null, semanas: fs.length }
  }
  const tocadas: BusquedaTocada[] = []
  for (const filas of porConsulta.values()) {
    const consulta = filas[0].consulta
    const a = coberturaDe(consulta, fichaAntes)
    const d = coberturaDe(consulta, fichaDespues)
    const enteraA = a.faltan.length === 0
    const enteraD = d.faltan.length === 0
    let cambio: BusquedaTocada['cambio'] | null = null
    let donde: BusquedaTocada['donde'] = 'ficha'
    if (!enteraA && enteraD) cambio = 'entra'
    else if (enteraA && !enteraD) cambio = 'sale'
    else if (!a.titulo && d.titulo) { cambio = 'entra'; donde = 'titulo' }
    else if (a.titulo && !d.titulo) { cambio = 'sale'; donde = 'titulo' }
    if (!cambio) continue
    if (donde === 'ficha' && d.titulo !== a.titulo) donde = 'titulo'
    const comprasMercado = Math.max(...filas.filter((f) => desdesAntes.has(f.desde) || desdesDespues.has(f.desde)).map((f) => f.comprasTotal ?? 0), 0)
    tocadas.push({ consulta, cambio, donde, comprasMercado, antes: lado(filas, desdesAntes), despues: lado(filas, desdesDespues) })
  }
  tocadas.sort((x, y) => y.comprasMercado - x.comprasMercado)

  // Lo que ensucia la comparación
  const avisos: string[] = []
  const inicio = antesSem[0][0]
  const fin = despuesSem.length ? despuesSem[despuesSem.length - 1][1] : fecha
  const stock = e.sinVentas ? sinVentasEnPeriodo(e.sinVentas, inicio, fin) : { dias: 0, tramos: [] }
  const otros = (e.otrosCambios ?? []).map((x) => x.slice(0, 10)).filter((x) => x !== fecha && x >= inicio && x <= fin)
  let ensuciado = false
  if (stock.dias >= DIAS_SIN_STOCK_QUE_ENSUCIAN) {
    ensuciado = true
    avisos.push(`Hubo ${stock.dias} días sin vender (probable rotura de stock) entre el ${fechaCorta(inicio)} y el ${fechaCorta(fin)}: lo que se mueva puede ser eso.`)
  }
  if (otros.length > 0) {
    ensuciado = true
    avisos.push(`Hubo otro cambio de ficha de este producto el ${otros.map(fechaCorta).join(' y el ')}: no se puede saber cuál de los dos hizo qué.`)
  }
  const cambioPpc = relativa(antes.gastoSemana, despues.gastoSemana)
  if (cambioPpc != null && Math.abs(cambioPpc) >= CAMBIO_PPC_QUE_AVISA)
    avisos.push(`El gasto en publicidad de este producto ${cambioPpc > 0 ? 'subió' : 'bajó'} un ${Math.abs(Math.round(cambioPpc * 100))} % (${Math.round(antes.gastoSemana ?? 0)} → ${Math.round(despues.gastoSemana ?? 0)} €/semana): parte del efecto puede venir de ahí.`)
  else if (antes.gastoSemana === 0 && (despues.gastoSemana ?? 0) > 0) avisos.push('Antes no había gasto en publicidad de este producto y después sí: parte del efecto puede venir de ahí.')

  const comun = { ...base, antes, despues, serie, cesta, tocadas, avisos }

  if (puntosDespues.length === 0 || despues.semanas === 0)
    return { ...comun, estado: 'esperando', resumen: `Cambio aplicado el ${fechaCorta(fecha)}. Brand Analytics todavía no tiene semanas completas de después; se juzga desde el ${fechaCorta(juzgableDesde)}.` }
  if (antes.semanas === 0) return { ...comun, estado: 'pocos-datos', resumen: 'Las búsquedas del producto antes del cambio son pocas o no salen en el informe: no hay con qué comparar.' }

  // Qué cuota decide
  const comprasTotales = (antes.comprasSemana ?? 0) * antes.semanas + (despues.comprasSemana ?? 0) * despues.semanas
  const porCompras = comprasTotales >= COMPRAS_MINIMAS && antes.cuotaCompras != null && antes.cuotaCompras > 0 && despues.cuotaCompras != null
  const medida: ResultadoDelCambio['medida'] = porCompras ? 'compras' : antes.cuotaImpresiones != null && despues.cuotaImpresiones != null && antes.cuotaImpresiones > 0 ? 'impresiones' : null
  const variacion = medida === 'compras' ? relativa(antes.cuotaCompras, despues.cuotaCompras) : medida === 'impresiones' ? relativa(antes.cuotaImpresiones, despues.cuotaImpresiones) : null
  const nombre = medida === 'compras' ? 'la cuota de compras' : 'la cuota de impresiones'
  const conMedida = { ...comun, medida, variacion }

  if (medida == null || variacion == null) return { ...conMedida, estado: 'pocos-datos', resumen: 'Brand Analytics no da impresiones ni compras suficientes de estas búsquedas para juzgar el cambio.' }
  const tendencia = variacion >= UMBRAL_VARIACION ? 'sube' : variacion <= -UMBRAL_VARIACION ? 'baja' : 'se mantiene'
  if (despues.semanas < SEMANAS_A_COMPARAR || e.hoy < juzgableDesde)
    return { ...conMedida, estado: 'provisional', resumen: `Provisional (${despues.semanas} de ${SEMANAS_A_COMPARAR} semanas): ${nombre} ${tendencia} (${pct(variacion)}). Se juzga desde el ${fechaCorta(juzgableDesde)}.` }
  if (ensuciado) return { ...conMedida, estado: 'no-atribuible', resumen: `${nombre[0].toUpperCase()}${nombre.slice(1)} ${tendencia} (${pct(variacion)}), pero en esas semanas pasó algo más y no se puede atribuir al cambio.` }
  const estado: EstadoResultado = tendencia === 'sube' ? 'mejora' : tendencia === 'baja' ? 'empeora' : 'igual'
  const resumen =
    estado === 'mejora'
      ? `El cambio funcionó: ${nombre} pasa de ${(medida === 'compras' ? antes.cuotaCompras! : antes.cuotaImpresiones!) * 100 < 0.1 ? '<0,1' : ((medida === 'compras' ? antes.cuotaCompras! : antes.cuotaImpresiones!) * 100).toFixed(1).replace('.', ',')} % a ${((medida === 'compras' ? despues.cuotaCompras! : despues.cuotaImpresiones!) * 100).toFixed(1).replace('.', ',')} % (${pct(variacion)}).`
      : estado === 'empeora'
        ? `El cambio no ha funcionado: ${nombre} cae un ${Math.abs(Math.round(variacion * 100))} %. Revisa qué búsquedas salieron de la ficha y valora volver a la versión anterior.`
        : `Sin efecto claro: ${nombre} se mueve un ${pct(variacion)} (menos del ${Math.round(UMBRAL_VARIACION * 100)} %).`
  return { ...conMedida, estado, resumen }
}
