/**
 * EL INFORME AL CLIENTE · LAS CIFRAS DEL PERIODO, SACADAS DE LO QUE EL ERP YA TIENE GUARDADO. SOLO SERVIDOR. Ninguna llamada a Amazon.
 *
 *   · Publicidad      ads_rendimiento_diario (el proceso de 3 h lo trae de Amazon Ads): total, por país, por producto (el ASIN sale del nombre de la campaña) y día a día.
 *   · Ventas totales  ads_ventas_asin (Ventas y tráfico de Seller Central): solo si el periodo acaba ayer, que es el que Amazon da (7, 14 o 30 días).
 *   · Lo ejecutado    ads_cambios_log: lo que se ha cambiado en la cuenta desde el ERP (a mano o aprobando propuestas del motor). Lo hecho fuera del ERP lo añade
 *                     el administrativo en el borrador.
 *   · Visibilidad     (quincenal y mensual) las búsquedas de Brand Analytics de los productos que se siguen en SEO, con su diagnóstico traducido.
 *   · Salud           (mensual) fichas con problemas ante Amazon al principio y al final del periodo (cumplimiento_diario).
 */
import { createServiceClient } from '@/lib/supabase/service'
import { cuentasDeCliente } from '@/lib/ads/cuenta'
import { asinDeCampana, resumenDeCampana } from '@/lib/ads/productos-agrupar'
import { ventasTotales } from '@/lib/ads/ventas-totales'
import { consultasDelAnterior, consultasGuardadas, cuentasSeoDeClientes, preciosDeListings, productosSeguidos } from '@/lib/seo/datos'
import { diagnosticarTodas } from '@/lib/seo/embudo'
import { conexionesDeCliente } from '@/lib/cumplimiento/conexiones'
import {
  claseDeLog,
  DIAS_DEL_INFORME,
  etiquetaDeVeredicto,
  periodos,
  resumirEjecutado,
  sumar,
  VENTANA_VACIA,
  type BusquedaDelInforme,
  type CambioHecho,
  type DatosDelInforme,
  type PaisDelInforme,
  type ProductoDelInforme,
  type TipoDeInforme,
  type Ventana,
} from './informe'

const DIA = 86_400_000
const n = (v: unknown) => Number(v ?? 0) || 0
const ayer = () => new Date(Date.now() - DIA).toISOString().slice(0, 10)

interface FilaDiaria {
  fecha: string
  campaign_id: string
  nombre: string
  gasto: unknown
  ventas: unknown
  pedidos: unknown
  clics: unknown
  impresiones: unknown
}

async function filasDe(perfilId: string, desde: string, hasta: string): Promise<FilaDiaria[]> {
  const s = createServiceClient()
  const salida: FilaDiaria[] = []
  for (let i = 0; ; i += 1000) {
    const { data, error } = await s
      .from('ads_rendimiento_diario')
      .select('fecha, campaign_id, nombre, gasto, ventas, pedidos, clics, impresiones')
      .eq('perfil_id', perfilId)
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha')
      .order('campaign_id')
      .range(i, i + 999)
    if (error) throw error
    salida.push(...((data ?? []) as FilaDiaria[]))
    if (!data || data.length < 1000) return salida
  }
}

const aVentana = (r: FilaDiaria): Ventana => ({ gasto: n(r.gasto), ventas: n(r.ventas), pedidos: n(r.pedidos), clics: n(r.clics), impresiones: n(r.impresiones) })

export async function datosDelInforme(c: { amazonClientId: string; nombre: string }, tipo: TipoDeInforme, hasta: string): Promise<DatosDelInforme> {
  const dias = DIAS_DEL_INFORME[tipo]
  const p = periodos(hasta, dias)
  const cuentas = await cuentasDeCliente(c.amazonClientId)
  const moneda = cuentas[0]?.moneda ?? 'EUR'

  // ---- publicidad ----
  const paises: PaisDelInforme[] = []
  const productos = new Map<string, ProductoDelInforme>()
  const diario = new Map<string, { gasto: number; ventas: number }>()
  let ventasTotalesSuma = 0
  let hayVentasTotales = false
  const tocaVentasTotales = hasta === ayer()
  for (const cuenta of cuentas) {
    const filas = await filasDe(cuenta.id, p.anterior.desde, p.hasta)
    const actual = sumar(filas.filter((r) => r.fecha >= p.desde).map(aVentana))
    const anterior = sumar(filas.filter((r) => r.fecha < p.desde).map(aVentana))
    let vt: number | null = null
    if (tocaVentasTotales) {
      const t = await ventasTotales(cuenta.id, dias).catch(() => null)
      if (t && !t.error) {
        const suma = Object.values(t.porAsin).reduce((a, x) => a + n(x.ventas), 0)
        vt = suma > 0 ? suma : null
      }
    }
    if (actual.gasto === 0 && anterior.gasto === 0 && vt == null) continue
    paises.push({ pais: cuenta.pais, moneda: cuenta.moneda, actual, anterior, ventasTotales: vt })
    // Totales, productos y serie: solo los países en la moneda principal (no se suman euros con libras)
    if ((cuenta.moneda ?? 'EUR') !== moneda) continue
    if (vt != null) {
      ventasTotalesSuma += vt
      hayVentasTotales = true
    }
    for (const r of filas) {
      if (r.fecha < p.desde) continue
      const d = diario.get(r.fecha) ?? { gasto: 0, ventas: 0 }
      d.gasto += n(r.gasto)
      d.ventas += n(r.ventas)
      diario.set(r.fecha, d)
      const asin = asinDeCampana(r.nombre)
      if (!asin) continue
      const x = productos.get(asin) ?? { asin, nombre: null, gasto: 0, ventas: 0, pedidos: 0, clics: 0 }
      x.nombre = x.nombre ?? resumenDeCampana(r.nombre)
      x.gasto += n(r.gasto)
      x.ventas += n(r.ventas)
      x.pedidos += n(r.pedidos)
      x.clics += n(r.clics)
      productos.set(asin, x)
    }
  }
  const principales = paises.filter((x) => (x.moneda ?? 'EUR') === moneda)
  const total = sumar(principales.map((x) => x.actual))
  const totalAnterior = sumar(principales.map((x) => x.anterior))

  // ---- lo ejecutado (desde el ERP) ----
  const cambios: CambioHecho[] = []
  if (cuentas.length) {
    const { data, error } = await createServiceClient()
      .from('ads_cambios_log')
      .select('accion, campo, valor_anterior, valor_nuevo, motivo')
      .in('perfil_id', cuentas.map((x) => x.id))
      .eq('ok', true)
      .gte('creado_at', `${p.desde}T00:00:00Z`)
      .lt('creado_at', new Date(Date.parse(`${p.hasta}T00:00:00Z`) + DIA).toISOString())
      .limit(5000)
    if (error) throw error
    for (const r of (data ?? []) as Array<{ accion: string; campo: string | null; valor_anterior: string | null; valor_nuevo: string | null; motivo: string | null }>) {
      // La negativa que acompaña a una búsqueda que pasa a su campaña propia es parte de ese paso, no una exclusión aparte; deshacer no es un cambio que contar
      if (r.accion === 'negativizar' && (r.motivo ?? '').startsWith('Para que no compita')) continue
      if ((r.campo ?? '') === 'deshacer') continue
      const clase = claseDeLog({ accion: r.accion, campo: r.campo, valorAnterior: r.valor_anterior, valorNuevo: r.valor_nuevo })
      if (clase) cambios.push({ clase })
    }
  }

  // ---- visibilidad (Brand Analytics) ----
  let visibilidad: DatosDelInforme['visibilidad'] = null
  let visibilidadNota: string | null = null
  if (tipo !== 'semanal') {
    try {
      const seo = ((await cuentasSeoDeClientes([c.amazonClientId])).get(c.amazonClientId) ?? [])[0]
      if (!seo) visibilidadNota = 'Sin cuenta de vendedor conectada: no hay datos de búsquedas.'
      else {
        const seguidos = await productosSeguidos(seo.connectionId, seo.marketplaceId)
        if (seguidos.length === 0) visibilidadNota = 'Todavía no se siguen productos en SEO: no hay datos de búsquedas.'
        else {
          const periodo = tipo === 'mensual' ? 'MONTH' : 'WEEK'
          const [filas, antes, precios] = await Promise.all([
            consultasGuardadas(seo.connectionId, seo.marketplaceId, periodo),
            consultasDelAnterior(seo.connectionId, seo.marketplaceId, periodo),
            preciosDeListings(seo.connectionId, seo.marketplaceId, seguidos.map((x) => x.asin)).catch(() => ({}) as Record<string, number | null>),
          ])
          if (filas.length === 0) visibilidadNota = 'Amazon todavía no ha dado las búsquedas de este periodo (o la cuenta no tiene Brand Analytics).'
          else {
            const antesDe = new Map(antes.map((a) => [`${a.asin}|${a.consulta}`, a.cuotaCompras]))
            const busquedas: BusquedaDelInforme[] = []
            for (const asin of new Set(filas.map((f) => f.asin))) {
              const propias = filas.filter((f) => f.asin === asin)
              const { busquedas: diag } = diagnosticarTodas(propias, (precios as Record<string, number | null>)[asin] ?? null)
              for (const b of diag) {
                const etiqueta = etiquetaDeVeredicto(b.veredicto as { tipo: string; etapa?: string })
                if (!etiqueta) continue
                busquedas.push({ consulta: b.fila.consulta, volumen: b.fila.volumen, cuotaImpresiones: b.fila.cuotaImpresiones, cuotaClics: b.fila.cuotaClics, cuotaCompras: b.fila.cuotaCompras, cuotaComprasAntes: antesDe.get(`${asin}|${b.fila.consulta}`) ?? null, etiqueta })
              }
            }
            // Primero donde el producto ya aparece (es lo que se puede leer y mejorar); las búsquedas enormes donde no sale ni en una impresión solo rellenan
            const presencia = (b: BusquedaDelInforme) => (b.cuotaImpresiones ?? 0) > 0 || (b.cuotaClics ?? 0) > 0 || (b.cuotaCompras ?? 0) > 0
            busquedas.sort((a, b) => Number(presencia(b)) - Number(presencia(a)) || (b.cuotaCompras ?? 0) * (b.volumen ?? 0) - (a.cuotaCompras ?? 0) * (a.volumen ?? 0) || (b.volumen ?? 0) - (a.volumen ?? 0))
            const f0 = filas[0]
            visibilidad = { periodo: `${periodo === 'MONTH' ? 'mes' : 'semana'} del ${f0.desde} al ${f0.hasta}`, busquedas: busquedas.slice(0, 10) }
          }
        }
      }
    } catch (e) {
      console.error('[informe] visibilidad:', e instanceof Error ? e.message : e)
      visibilidadNota = 'No se han podido leer las búsquedas.'
    }
  }

  // ---- salud de las fichas (mensual) ----
  let salud: DatosDelInforme['salud'] = null
  if (tipo === 'mensual') {
    try {
      const conexiones = await conexionesDeCliente(c.amazonClientId)
      if (conexiones.length) {
        const { data } = await createServiceClient()
          .from('cumplimiento_diario')
          .select('dia, revisados, atencion, ocultos')
          .in('connection_id', conexiones.map((x) => x.id))
          .gte('dia', p.desde)
          .lte('dia', p.hasta)
          .order('dia')
          .limit(5000)
        const porDia = new Map<string, { revisados: number; atencion: number; ocultos: number }>()
        for (const r of (data ?? []) as Array<{ dia: string; revisados: number; atencion: number; ocultos: number }>) {
          const x = porDia.get(r.dia) ?? { revisados: 0, atencion: 0, ocultos: 0 }
          x.revisados += n(r.revisados)
          x.atencion += n(r.atencion)
          x.ocultos += n(r.ocultos)
          porDia.set(r.dia, x)
        }
        const dias_ = [...porDia.keys()].sort()
        if (dias_.length) {
          const fin = porDia.get(dias_.at(-1) as string)!
          salud = { revisadas: fin.revisados, conProblemasInicio: dias_.length > 1 ? porDia.get(dias_[0])!.atencion : null, conProblemasFin: fin.atencion, ocultasFin: fin.ocultos }
        }
      }
    } catch (e) {
      console.error('[informe] salud:', e instanceof Error ? e.message : e)
    }
  }

  return {
    version: 1,
    cliente: c.nombre,
    tipo,
    desde: p.desde,
    hasta: p.hasta,
    dias,
    anterior: p.anterior,
    moneda,
    total: total ?? { ...VENTANA_VACIA },
    totalAnterior,
    ventasTotales: hayVentasTotales ? ventasTotalesSuma : null,
    ventasTotalesNota: hayVentasTotales ? null : tocaVentasTotales ? 'Sin cuenta de vendedor conectada en el país: no hay ventas totales.' : 'Las ventas totales solo salen en un informe que acaba ayer.',
    paises,
    productos: [...productos.values()].sort((a, b) => b.gasto - a.gasto).slice(0, 10),
    diario: [...diario].sort(([a], [b]) => a.localeCompare(b)).map(([fecha, v]) => ({ fecha, ...v })),
    ejecutado: resumirEjecutado(cambios),
    visibilidad,
    visibilidadNota: visibilidad ? null : tipo === 'semanal' ? null : visibilidadNota,
    salud,
    generadoAt: new Date().toISOString(),
  }
}
