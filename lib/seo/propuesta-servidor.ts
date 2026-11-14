/**
 * SEO · LA PROPUESTA DE FICHA CON IA: PEDIRLA, GUARDARLA Y —SOLO CON EL OK DE UNA PERSONA— APLICARLA EN AMAZON. SOLO SERVIDOR.
 *
 *   proponer   lee la ficha y las búsquedas del producto, pide la propuesta a la IA (modelo de lib/ia/modelo.ts; el gasto lo cuenta la tarjeta «Gasto en IA» de Sistema, que lee la factura real
 *              de OpenAI) y la guarda «pendiente». NO toca Amazon.
 *   aplicar    ESCRIBE EN LA FICHA DEL CLIENTE. Solo desde el botón «Aplicar en Amazon», con confirmación. Primero valida en Amazon sin guardar nada (VALIDATION_PREVIEW); si Amazon dice que no, se
 *              enseñan sus motivos y no se manda. Si dice que sí, se manda de verdad y se apunta quién y cuándo.
 *   descartar  la deja como descartada.
 */

import OpenAI from 'openai'
import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError, describeIssues, type AmazonIssue } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { parametrosDeIa } from '@/lib/ia/modelo'
import { AMAZON_MARKETPLACES } from '@/lib/types/amazon'
import { coberturaDe } from './cobertura'
import { cambiosAplicados, consultasGuardadas, fichasGuardadas, preciosDeListings, type FichaGuardada } from './datos'
import { diagnosticarTodas, embudoDelProducto, esRelevante, NOMBRE_DE_ETAPA, RESPONSABLE } from './embudo'
import { IDIOMA_DE_MARKETPLACE, instruccionesDeSistema, limpiarPropuesta, mensajeDeDatos, patchesDeFicha, type PropuestaLimpia, type Razonamiento, type TextosPropuestos } from './propuesta'
import { perfilesAdsDe, terminosDeAdsDelAsin } from './publicidad'
import { terminosQueFaltanEnLaFicha } from './publicidad-calculo'
import { palabrasQueFaltanEnElTitulo } from './resumen'
import { DIAS_ENTRE_CAMBIOS, ventanaDeCambio } from './tareas'

export interface PropuestaGuardada {
  id: string
  asin: string
  sku: string | null
  estado: 'pendiente' | 'aplicada' | 'descartada' | 'error'
  antes: TextosPropuestos
  propuesta: TextosPropuestos
  razonamiento: Razonamiento & { avisos?: string[] }
  modelo: string | null
  creadaAt: string
  aplicadaAt: string | null
  resultado: { submissionId?: string | null; issues?: AmazonIssue[]; mensaje?: string | null } | null
  error: string | null
}

const COLUMNAS = 'id, asin, sku, estado, antes, propuesta, razonamiento, modelo, creada_at, aplicada_at, resultado, error'

function deFila(r: Record<string, unknown>): PropuestaGuardada {
  return {
    id: String(r.id),
    asin: String(r.asin),
    sku: (r.sku as string | null) ?? null,
    estado: r.estado as PropuestaGuardada['estado'],
    antes: r.antes as TextosPropuestos,
    propuesta: r.propuesta as TextosPropuestos,
    razonamiento: (r.razonamiento ?? { resumen: '', cambios: [], palabrasNuevas: [] }) as PropuestaGuardada['razonamiento'],
    modelo: (r.modelo as string | null) ?? null,
    creadaAt: String(r.creada_at),
    aplicadaAt: (r.aplicada_at as string | null) ?? null,
    resultado: (r.resultado as PropuestaGuardada['resultado']) ?? null,
    error: (r.error as string | null) ?? null,
  }
}

export async function propuestasDe(connectionId: string, marketplaceId: string, asin: string): Promise<PropuestaGuardada[]> {
  const { data, error } = await createServiceClient().from('seo_propuestas').select(COLUMNAS).eq('connection_id', connectionId).eq('marketplace_id', marketplaceId).eq('asin', asin).order('creada_at', { ascending: false }).limit(10)
  if (error) throw error
  return ((data ?? []) as Array<Record<string, unknown>>).map(deFila)
}

const textosDe = (f: FichaGuardada): TextosPropuestos => ({ titulo: f.titulo ?? '', bullets: f.bullets, backend: f.backend ?? '' })

/** Pide la propuesta a la IA y la guarda pendiente. Tarda unos segundos (la IA piensa) */
export async function proponerFicha(c: { connectionId: string; marketplaceId: string; clientId: string }, asin: string, userId: string): Promise<PropuestaGuardada> {
  const clave = process.env.OPENAI_API_KEY?.trim()
  if (!clave) throw new Error('La IA no está configurada en el servidor (falta OPENAI_API_KEY).')
  const [fichas, mes, semana] = await Promise.all([fichasGuardadas(c.connectionId, c.marketplaceId), consultasGuardadas(c.connectionId, c.marketplaceId, 'MONTH'), consultasGuardadas(c.connectionId, c.marketplaceId, 'WEEK')])
  const ficha = fichas.find((f) => f.asin === asin)
  if (!ficha || !ficha.titulo) throw new Error('Todavía no se ha leído la ficha de este producto: pulsa «Actualizar» y espera a que salga.')
  const delMes = mes.filter((x) => x.asin === asin)
  const consultas = delMes.length > 0 ? delMes : semana.filter((x) => x.asin === asin)
  if (consultas.length === 0) throw new Error('Este producto aún no tiene búsquedas de Brand Analytics: sin ellas la IA no sabría qué palabras pesan.')

  const pais = AMAZON_MARKETPLACES.find((m) => m.id === c.marketplaceId)?.countryCode ?? c.marketplaceId
  const idioma = IDIOMA_DE_MARKETPLACE[c.marketplaceId]?.nombre ?? 'el idioma del marketplace'
  const perfiles = await perfilesAdsDe(c.clientId, pais).catch(() => [])
  const ads = terminosQueFaltanEnLaFicha(await terminosDeAdsDelAsin(perfiles, asin).catch(() => []), ficha, 20)

  // Paso 2 y 3 del SOP: diagnosticar el embudo y descartar antes de elegir (ruido y búsquedas que compran a otro precio no llegan a la IA como candidatas)
  const precioListing = (await preciosDeListings(c.connectionId, c.marketplaceId, [asin]).catch(() => ({}) as Record<string, number | null>))[asin] ?? null
  const { contexto, busquedas } = diagnosticarTodas(consultas, precioListing)
  const producto = embudoDelProducto(busquedas, contexto)
  const v = producto.veredicto
  const embudo = !v ? null : v.tipo === 'fuga' ? `Se pierde en ${NOMBRE_DE_ETAPA[v.etapa].toLowerCase()} (${RESPONSABLE[v.etapa].quien}): ${v.motivo}` : v.motivo
  const relevantes = busquedas.filter((d) => esRelevante(d.veredicto))
  const diagnostico = (d: (typeof busquedas)[number]) => (d.veredicto.tipo === 'fuga' ? `se pierde en ${NOMBRE_DE_ETAPA[d.veredicto.etapa].toLowerCase()}` : d.veredicto.tipo === 'visibilidad' ? ((d.veredicto.fuerza ?? 0) >= 1.2 ? 'convierte bien, sale poco' : 'falta salir más') : d.veredicto.tipo === 'lider' ? 'ya manda' : '')

  const datos = {
    idioma,
    pais,
    precio: contexto.precioPropio,
    ficha: { titulo: ficha.titulo, bullets: ficha.bullets, descripcion: ficha.descripcion?.slice(0, 2000) ?? null, backend: ficha.backend },
    embudo,
    busquedas: [...relevantes]
      .sort((a, b) => (b.fila.comprasTotal ?? 0) - (a.fila.comprasTotal ?? 0) || (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
      .slice(0, 40)
      .map((d) => ({ consulta: d.fila.consulta, volumen: d.fila.volumen, comprasTotal: d.fila.comprasTotal, cuotaComprasTuya: d.fila.cuotaCompras, enLaFicha: coberturaDe(d.fila.consulta, ficha).faltan.length === 0, diagnostico: diagnostico(d) })),
    descartadas: busquedas
      .filter((d) => !esRelevante(d.veredicto))
      .sort((a, b) => (b.fila.volumen ?? 0) - (a.fila.volumen ?? 0))
      .slice(0, 25)
      .map((d) => ({ consulta: d.fila.consulta, porQue: d.veredicto.motivo })),
    palabrasQueFaltan: palabrasQueFaltanEnElTitulo(relevantes.map((d) => d.fila), ficha, 40, 20).map((p) => ({ palabra: p.palabra, peso: p.peso })),
    terminosDeAds: ads.map((t) => ({ termino: t.termino, pedidos: t.pedidos })),
  }

  const params = parametrosDeIa({ maxSalida: 16000, esfuerzo: 'medium' })
  const cliente = new OpenAI({ apiKey: clave, maxRetries: 1 })
  const respuesta = await cliente.chat.completions.create({
    ...params,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: instruccionesDeSistema(idioma) },
      { role: 'user', content: mensajeDeDatos(datos) },
    ],
  })
  const contenido = respuesta.choices[0]?.message?.content ?? ''
  let crudo: unknown
  try {
    crudo = JSON.parse(contenido)
  } catch {
    throw new Error('La IA ha contestado algo que no es la propuesta. Vuelve a intentarlo.')
  }
  const limpia = limpiarPropuesta(crudo)
  if ('error' in limpia) throw new Error(limpia.error)
  return guardarPropuesta(c, asin, ficha, limpia, params.model, userId)
}

async function guardarPropuesta(c: { connectionId: string; marketplaceId: string }, asin: string, ficha: FichaGuardada, p: PropuestaLimpia, modelo: string, userId: string): Promise<PropuestaGuardada> {
  const { data, error } = await createServiceClient()
    .from('seo_propuestas')
    .insert({
      connection_id: c.connectionId,
      marketplace_id: c.marketplaceId,
      asin,
      sku: ficha.sku,
      estado: 'pendiente',
      antes: textosDe(ficha),
      propuesta: { titulo: p.titulo, highlights: p.highlights, bullets: p.bullets, backend: p.backend },
      razonamiento: { ...p.razonamiento, avisos: p.avisos },
      modelo,
      creada_por: userId,
    })
    .select(COLUMNAS)
    .single()
  if (error) throw error
  return deFila(data as Record<string, unknown>)
}

export async function descartarPropuesta(c: { connectionId: string; marketplaceId: string }, id: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_propuestas').update({ estado: 'descartada' }).eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('estado', 'pendiente')
  if (error) throw error
}

type RespuestaPatch = { status?: string; submissionId?: string; issues?: AmazonIssue[] }

/**
 * APLICA LA PROPUESTA EN AMAZON. Escribe en la ficha del cliente. Devuelve lo que dijo Amazon.
 */
export async function aplicarPropuesta(
  c: { connectionId: string; marketplaceId: string },
  id: string,
  userId: string
): Promise<{ ok: true; submissionId: string | null; avisos: string | null } | { ok: false; motivo: string; issues: AmazonIssue[] }> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_propuestas').select(COLUMNAS).eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
  if (error) throw error
  if (!data) return { ok: false, motivo: 'Esa propuesta no existe.', issues: [] }
  const p = deFila(data as Record<string, unknown>)
  if (p.estado !== 'pendiente') return { ok: false, motivo: `Esa propuesta ya está ${p.estado}.`, issues: [] }
  // SOP: como mucho un cambio de título cada 30 días por producto (y 21 días para juzgarlo). Si no, el resultado no se puede atribuir a ningún cambio
  const ventana = ventanaDeCambio(await cambiosAplicados(c.connectionId, c.marketplaceId), p.asin, new Date().toISOString().slice(0, 10))
  if (ventana?.bloqueada) return { ok: false, motivo: `La ficha de este producto se cambió el ${ventana.ultimo}: el SOP no deja volver a cambiarla antes de ${DIAS_ENTRE_CAMBIOS} días (desde el ${ventana.puedeDesde}).`, issues: [] }
  if (!p.sku) return { ok: false, motivo: 'No se sabe el SKU de este producto: sin él no se puede cambiar la ficha.', issues: [] }
  const resuelta = await connectionCredentials(c.connectionId)
  if (!resuelta) return { ok: false, motivo: 'La conexión de Amazon ya no existe.', issues: [] }
  const creds = resuelta.credentials

  // El tipo de producto (Amazon lo exige en cada cambio) y el idioma con el que está escrita la ficha
  const { data: lectura } = await spApiRequest<{ items?: Array<{ summaries?: Array<{ marketplaceId?: string; productType?: string }>; attributes?: Record<string, Array<{ language_tag?: string; marketplace_id?: string }>> }> }>(creds, 'searchListingsItems', {
    method: 'GET',
    path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
    query: { marketplaceIds: [c.marketplaceId], identifiers: [p.sku], identifiersType: 'SKU', includedData: ['summaries', 'attributes'], pageSize: 1 },
  })
  const item = lectura.items?.[0]
  const productType = item?.summaries?.find((s) => s.marketplaceId === c.marketplaceId)?.productType ?? item?.summaries?.[0]?.productType
  if (!productType) return { ok: false, motivo: 'Amazon no ha devuelto el tipo de producto de este listing: no se puede cambiar desde aquí.', issues: [] }
  const tagActual = (item?.attributes?.item_name ?? []).find((v) => !v.marketplace_id || v.marketplace_id === c.marketplaceId)?.language_tag
  const languageTag = tagActual ?? IDIOMA_DE_MARKETPLACE[c.marketplaceId]?.tag ?? 'es_ES'
  const patches = patchesDeFicha(p.propuesta, c.marketplaceId, languageTag)

  const mandar = async (validar: boolean) =>
    spApiRequest<RespuestaPatch>(creds, 'patchListingsItem', {
      method: 'PATCH',
      path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}/${encodeURIComponent(p.sku as string)}`,
      query: { marketplaceIds: [c.marketplaceId], issueLocale: 'es_ES', mode: validar ? 'VALIDATION_PREVIEW' : undefined },
      body: { productType, patches },
      // replace = valor absoluto: repetirlo deja lo mismo
      repeatable: true,
      maxAttempts: 2,
    })
  const bloquea = (r: RespuestaPatch) => r.status === 'INVALID' || (r.issues ?? []).some((i) => (i.severity ?? '').toUpperCase() === 'ERROR')

  try {
    // 1) Validar sin guardar nada
    const { data: prueba } = await mandar(true)
    if (bloquea(prueba)) {
      const issues = prueba.issues ?? []
      await service.from('seo_propuestas').update({ error: `Amazon no la acepta: ${describeIssues(issues)}`.slice(0, 1000), resultado: { issues, mensaje: describeIssues(issues) } }).eq('id', id)
      return { ok: false, motivo: `Amazon no acepta la ficha propuesta: ${describeIssues(issues)}`, issues }
    }
    // 2) De verdad
    const { data: hecho } = await mandar(false)
    const issues = hecho.issues ?? []
    if (bloquea(hecho)) {
      await service.from('seo_propuestas').update({ estado: 'error', error: describeIssues(issues).slice(0, 1000), resultado: { submissionId: hecho.submissionId ?? null, issues, mensaje: describeIssues(issues) } }).eq('id', id)
      return { ok: false, motivo: `Amazon ha rechazado el cambio: ${describeIssues(issues)}`, issues }
    }
    await service
      .from('seo_propuestas')
      .update({ estado: 'aplicada', aplicada_por: userId, aplicada_at: new Date().toISOString(), error: null, resultado: { submissionId: hecho.submissionId ?? null, issues, mensaje: issues.length > 0 ? describeIssues(issues) : null } })
      .eq('id', id)
    // La ficha se vuelve a leer en la pasada siguiente, para ver lo que de verdad ha quedado
    await service.from('seo_lecturas').update({ ficha_leida_at: null }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
    return { ok: true, submissionId: hecho.submissionId ?? null, avisos: issues.length > 0 ? describeIssues(issues) : null }
  } catch (e) {
    if (!(e instanceof AmazonApiError)) throw e
    await service.from('seo_propuestas').update({ error: (e.humanMessage ?? e.message).slice(0, 1000) }).eq('id', id)
    return { ok: false, motivo: e.humanMessage ?? e.message, issues: e.issues ?? [] }
  }
}
