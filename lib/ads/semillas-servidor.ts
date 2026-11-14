/**
 * LAS PALABRAS, ASIN Y NEGATIVAS DE UN PRODUCTO: PROPONER Y APLICAR. SOLO SERVIDOR.
 *
 * Proponer solo LEE (términos de la cuenta, Brand Analytics y, si se suben, los CSV de Helium 10, que clasifica la IA). Aplicar ESCRIBE en la cuenta de
 * publicidad del cliente: crea keywords, segmentaciones y negativas en las campañas de la estructura del producto, una a una, dejando cada cambio en el log.
 * Las campañas de la estructura nacen PAUSADAS, así que lo aplicado no gasta hasta que alguien las activa.
 */
import { anotarCambio, estructurasDeCuenta, marketplaceDePais, productosDeCuenta, type CuentaDeAnunciante, type ProductoDeAds } from './cuenta'
import { leerTerminos } from './terminos'
import { asinDeCampana, resumenDeCampana } from './productos-agrupar'
import { campanasDe } from './campanas'
import { crearKeyword, crearNegativaDeCampana, crearNegativaDeProducto, crearSegmentacionDeProducto, gruposActivosDe } from './escritura'
import { describeElProducto, juntar, semillasDeCerebro, semillasDeLaCuenta, semillasDelGrabber, type BusquedaDelProducto, type Semilla } from './semillas'
import { clasificarCerebro } from './semillas-ia'
import type { FilaCerebro, FilaGrabber } from './helium10'
import type { Rol } from './estructura'
import { competenciaDe, consultasGuardadas, cuentasSeoDeClientes, fichasGuardadas, preciosDeListings } from '@/lib/seo/datos'
import { diagnosticarTodas, esRelevante } from '@/lib/seo/embudo'

export interface Propuesta {
  semillas: Semilla[]
  /** Qué se ha podido mirar y qué no, para decirlo en pantalla */
  fuentes: Array<{ fuente: string; estado: 'ok' | 'sin-datos' | 'error'; detalle: string }>
}

export async function proponerSemillas(
  cuenta: CuentaDeAnunciante & { clienteAmazonId: string | null },
  producto: ProductoDeAds,
  opciones: { pujaBase: number; cerebro?: readonly FilaCerebro[]; grabber?: readonly FilaGrabber[]; marca?: string | null }
): Promise<Propuesta> {
  const fuentes: Propuesta['fuentes'] = []
  const asin = producto.asin.toUpperCase()
  const propios = new Set((await productosDeCuenta(cuenta.id).catch(() => [])).map((p) => p.asin.toUpperCase()))
  propios.add(asin)

  // Términos de la cuenta: los de las campañas de este producto, y la conversión de toda la cuenta
  let terminos: Awaited<ReturnType<typeof leerTerminos>> = []
  let cvr: number | null = null
  try {
    const todos = await leerTerminos(cuenta.id)
    const clics = todos.reduce((a, t) => a + t.clics, 0)
    cvr = clics > 200 ? todos.reduce((a, t) => a + t.compras, 0) / clics : null
    terminos = todos.filter((t) => asinDeCampana(t.campaignName) === asin)
    fuentes.push({ fuente: 'Términos de búsqueda', estado: terminos.length ? 'ok' : 'sin-datos', detalle: terminos.length ? `${terminos.length} términos de las campañas de este producto (30 días)` : 'Este producto aún no tiene campañas con datos.' })
  } catch (e) {
    fuentes.push({ fuente: 'Términos de búsqueda', estado: 'error', detalle: e instanceof Error ? e.message : 'No se han podido leer.' })
  }

  // Brand Analytics del producto (SEO de fichas) y su competencia
  let busquedas: BusquedaDelProducto[] = []
  let competencia: Array<{ asin: string; consulta: string; cuotaClics: number | null }> = []
  let titulo = producto.titulo ?? producto.resumen
  let detalles: string | null = null
  try {
    const mkt = marketplaceDePais(cuenta.pais)
    const seo = cuenta.clienteAmazonId && mkt ? ((await cuentasSeoDeClientes([cuenta.clienteAmazonId])).get(cuenta.clienteAmazonId) ?? []).find((c) => c.marketplaceId === mkt) : undefined
    if (!seo) fuentes.push({ fuente: 'Brand Analytics', estado: 'sin-datos', detalle: 'Sin cuenta de vendedor conectada en este país.' })
    else {
      const [filas, precios, fichas] = await Promise.all([
        consultasGuardadas(seo.connectionId, seo.marketplaceId, 'MONTH'),
        preciosDeListings(seo.connectionId, seo.marketplaceId, [asin]).catch(() => ({}) as Record<string, number | null>),
        fichasGuardadas(seo.connectionId, seo.marketplaceId).catch(() => []),
      ])
      const ficha = fichas.find((f) => f.asin.toUpperCase() === asin)
      if (ficha) {
        titulo = ficha.titulo ?? titulo
        detalles = [ficha.bullets?.join(' · '), ficha.descripcion].filter(Boolean).join(' · ') || null
      }
      const propias = filas.filter((f) => f.asin.toUpperCase() === asin)
      if (propias.length === 0) fuentes.push({ fuente: 'Brand Analytics', estado: 'sin-datos', detalle: 'Este producto no se sigue en SEO de fichas (o la cuenta no tiene Brand Analytics): añádelo allí para tener sus búsquedas.' })
      else {
        const { busquedas: diag } = diagnosticarTodas(propias, (precios as Record<string, number | null>)[asin] ?? null)
        busquedas = diag.map((b) => ({ consulta: b.fila.consulta, volumen: b.fila.volumen, cuotaCompras: b.fila.cuotaCompras, comprasAsin: b.fila.comprasAsin, relevante: esRelevante(b.veredicto) }))
        const top = busquedas.filter((b) => b.relevante).sort((a, b) => (b.volumen ?? 0) - (a.volumen ?? 0)).slice(0, 15).map((b) => b.consulta)
        const comp = top.length ? await competenciaDe(seo.connectionId, seo.marketplaceId, top).catch(() => null) : null
        competencia = (comp?.filas ?? []).map((f) => ({ asin: f.asin, consulta: f.consulta, cuotaClics: f.cuotaClics }))
        fuentes.push({ fuente: 'Brand Analytics', estado: 'ok', detalle: `${busquedas.filter((b) => b.relevante).length} búsquedas del producto${competencia.length ? ` y ${new Set(competencia.map((c) => c.asin)).size} productos de la competencia` : ''}` })
      }
    }
  } catch (e) {
    fuentes.push({ fuente: 'Brand Analytics', estado: 'error', detalle: e instanceof Error ? e.message : 'No se ha podido leer.' })
  }

  // Lo que describe el producto: su título, su resumen y el RESUMEN de los nombres de sus campañas (muchos productos no tienen título guardado)
  const deCampanas = [...new Set(terminos.map((t) => resumenDeCampana(t.campaignName)).filter(Boolean))]
  const descripcion = [titulo, producto.titulo, producto.resumen, ...deCampanas].filter(Boolean).join(' ')
  const listas: Semilla[][] = [semillasDeLaCuenta({ asin, propios, terminos, busquedas, competencia, pujaBase: opciones.pujaBase, cvr, descripcion })]

  if (opciones.cerebro?.length) {
    const r = await clasificarCerebro({ titulo, detalles }, opciones.cerebro)
    if (r.ok) {
      listas.push(semillasDeCerebro({ ...r.resultado, negativas: r.resultado.negativas.filter((n) => !describeElProducto(n.texto, descripcion)) }, opciones.pujaBase))
      fuentes.push({ fuente: 'Cerebro (Helium 10)', estado: 'ok', detalle: `${opciones.cerebro.length} keywords leídas: ${r.resultado.frase.length} a frase, ${r.resultado.exacta.length} a exacta y ${r.resultado.negativas.length} negativas (las ha clasificado la IA leyendo la ficha: revísalas)` })
    } else fuentes.push({ fuente: 'Cerebro (Helium 10)', estado: 'error', detalle: r.error })
  }
  if (opciones.grabber?.length) {
    const s = semillasDelGrabber(opciones.grabber, { asin, marca: opciones.marca ?? null, precio: producto.precio, propios }, opciones.pujaBase)
    listas.push(s)
    fuentes.push({ fuente: 'ASIN Grabber (Helium 10)', estado: 'ok', detalle: `${opciones.grabber.length} productos leídos: ${s.length} para atacar (más caros o peor valorados, sin los de miles de reseñas)` })
  }

  return { semillas: juntar(...listas), fuentes }
}

/* ------------------------------------------------------------------ */
/* Aplicar                                                             */
/* ------------------------------------------------------------------ */

interface Grupo {
  campaignId: string
  adGroupId: string
  nombre: string
}

/** Las campañas de la estructura del producto (las creadas desde el ERP o, si no, las que siguen la nomenclatura «ASIN | SKU | RESUMEN | ROL») */
async function gruposDelProducto(cuenta: CuentaDeAnunciante & { id: string }, producto: ProductoDeAds): Promise<Partial<Record<Rol, Grupo>>> {
  const salida: Partial<Record<Rol, Grupo>> = {}
  for (const e of (await estructurasDeCuenta(cuenta.id)).filter((x) => x.productoId === producto.id)) {
    if (e.adGroupId) salida[e.rol] = { campaignId: e.campaignId, adGroupId: e.adGroupId, nombre: e.nombre }
  }
  const roles: Rol[] = ['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'ATAQUE ASIN']
  if (roles.every((r) => salida[r])) return salida
  const { campanas } = await campanasDe(cuenta.conexionId, cuenta.profileId)
  for (const rol of roles) {
    if (salida[rol]) continue
    const c = campanas.find((x) => x.estado !== 'ARCHIVED' && x.nombre.toUpperCase().includes(producto.asin.toUpperCase()) && x.nombre.toUpperCase().trim().endsWith(rol))
    if (!c) continue
    const g = (await gruposActivosDe(cuenta.conexionId, cuenta.profileId, c.campaignId))[0]
    if (g) salida[rol] = { campaignId: c.campaignId, adGroupId: g.adGroupId, nombre: c.nombre }
  }
  return salida
}

export interface ResultadoDeAplicar {
  hechas: number
  fallos: Array<{ texto: string; destino: string; error: string }>
  faltan: string[]
}

export const MAX_ESCRITURAS = 250

export async function aplicarSemillas(cuenta: CuentaDeAnunciante & { id: string }, producto: ProductoDeAds, semillas: readonly Semilla[], userId: string): Promise<ResultadoDeAplicar> {
  const grupos = await gruposDelProducto(cuenta, producto)
  const faltan = (['AUTO RADAR', 'MANUAL AMPLIA', 'MANUAL EXACTA / DOMINIO', 'ATAQUE ASIN'] as Rol[]).filter((r) => !grupos[r])
  const r: ResultadoDeAplicar = { hechas: 0, fallos: [], faltan }
  const comun = { perfilId: cuenta.id, productoId: producto.id, origen: 'manual' as const, userId, motivo: '' }
  let escrituras = 0
  const paso = async (g: Grupo | undefined, s: Semilla, f: (g: Grupo) => Promise<unknown>, log: Omit<Parameters<typeof anotarCambio>[0], 'perfilId' | 'origen'>) => {
    if (!g || escrituras >= MAX_ESCRITURAS) return
    escrituras++
    try {
      await f(g)
      r.hechas++
      await anotarCambio({ ...comun, campaignId: g.campaignId, nombreCampana: g.nombre, ...log, motivo: s.motivo })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      r.fallos.push({ texto: s.texto, destino: s.destino, error })
      await anotarCambio({ ...comun, campaignId: g.campaignId, nombreCampana: g.nombre, ...log, ok: false, error, motivo: s.motivo })
    }
  }

  for (const s of semillas) {
    const puja = s.puja ?? 0.5
    if (s.destino === 'frase') {
      await paso(grupos['MANUAL AMPLIA'], s, (g) => crearKeyword(cuenta.conexionId, cuenta.profileId, { campaignId: g.campaignId, adGroupId: g.adGroupId, texto: s.texto, coincidencia: 'PHRASE', puja }), { entidad: 'keyword', accion: 'crear', campo: 'keyword de frase', valorNuevo: `${s.texto} · ${puja.toFixed(2).replace('.', ',')}` })
    } else if (s.destino === 'exacta') {
      await paso(grupos['MANUAL EXACTA / DOMINIO'], s, (g) => crearKeyword(cuenta.conexionId, cuenta.profileId, { campaignId: g.campaignId, adGroupId: g.adGroupId, texto: s.texto, coincidencia: 'EXACT', puja }), { entidad: 'keyword', accion: 'crear', campo: 'keyword exacta', valorNuevo: `${s.texto} · ${puja.toFixed(2).replace('.', ',')}` })
      // Que la AUTO y la AMPLIA no compitan con la exacta por la misma búsqueda
      for (const rol of ['AUTO RADAR', 'MANUAL AMPLIA'] as Rol[]) {
        await paso(grupos[rol], { ...s, motivo: `Para que no compita con la exacta: ${s.motivo}` }, (g) => crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, g.campaignId, s.texto), { entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: s.texto })
      }
    } else if (s.destino === 'asin') {
      await paso(grupos['ATAQUE ASIN'], s, (g) => crearSegmentacionDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: g.campaignId, adGroupId: g.adGroupId, asin: s.texto, puja }), { entidad: 'target', accion: 'crear', campo: 'segmentación por producto (ASIN)', valorNuevo: `${s.texto.toUpperCase()} · ${puja.toFixed(2).replace('.', ',')}` })
    } else if (s.destino === 'negativa') {
      for (const rol of ['AUTO RADAR', 'MANUAL AMPLIA'] as Rol[]) {
        await paso(grupos[rol], s, (g) => crearNegativaDeCampana(cuenta.conexionId, cuenta.profileId, g.campaignId, s.texto), { entidad: 'negativa', accion: 'negativizar', campo: 'palabra clave negativa exacta', valorNuevo: s.texto })
      }
    } else if (s.destino === 'negativa-asin') {
      await paso(grupos['AUTO RADAR'], s, (g) => crearNegativaDeProducto(cuenta.conexionId, cuenta.profileId, { campaignId: g.campaignId, adGroupId: g.adGroupId, asin: s.texto }), { entidad: 'negativa', accion: 'negativizar', campo: 'segmentación negativa por productos', valorNuevo: s.texto.toUpperCase() })
    }
  }
  return r
}
