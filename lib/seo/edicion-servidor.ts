/**
 * SEO · ESCRIBIR EN LA FICHA DEL CLIENTE DESDE EL ERP, CON REGISTRO Y VERIFICACIÓN. SOLO SERVIDOR.
 *
 * La ÚNICA puerta de SEO Test que escribe en Amazon. La usan el editor a mano (pestaña Ficha) y «Aplicar en Amazon» de la propuesta con IA. Siempre:
 *   1. lee el listing en ese momento (tipo de producto, idioma y lo que hay: eso es el «antes» que se guarda, Item Highlights incluidos);
 *   2. mira en la definición del tipo de producto cuál es el atributo de los Item Highlights (si no lo tiene, avisa en vez de perderlos);
 *   3. valida en Amazon SIN guardar nada (mode=VALIDATION_PREVIEW) y, si dice que no, se enseñan sus motivos;
 *   4. solo con la confirmación de una persona, lo manda de verdad y apunta quién, cuándo y qué contestó Amazon (seo_ediciones, migración 312);
 *   5. en las pasadas siguientes del proceso `seo-lecturas` relee la ficha y compara campo a campo: aplicada, no aplicada o parcial.
 *
 * Pueden hacerlo los administradores y quien tenga la casilla de SEO Test (decisión de Raúl, 14 nov 2026; la comprobación está en lib/seo/ruta.ts).
 * amazon_submissions/sendChanges no sirven aquí: solo admiten precio y cantidad numéricos.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError, describeIssues, type AmazonIssue } from '@/lib/amazon/errors'
import { spApiRequest, type AmazonCredentials } from '@/lib/amazon/sp-api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { bloqueosDeEdicion, camposPisadosDesdeValidar, CAMPOS_FICHA, decidirEdicion, NOMBRE_DE_CAMPO, explicacionDeNoAplicada, highlightsDeAtributos, MINUTOS_ANTES_DE_VERIFICAR, planDePatch, verificarEdicion, atributoDeHighlights, type CampoFicha, type ComparacionDeCampo, type EstadoVerificado, type TextosFicha } from './edicion'
import { fichaDeItem, type FichaLeida } from './ficha-servidor'
import { cambiosDesdeLaPropuesta, IDIOMA_DE_MARKETPLACE, motivoFichaCambiada, type CampoComparado } from './propuesta'
import { DIAS_ENTRE_CAMBIOS, ventanaDeCambio } from './tareas'
import { cambiosAplicados } from './datos'

export type EstadoEdicion = 'validada' | 'rechazada' | 'enviada' | 'aplicada' | 'no_aplicada' | 'parcial' | 'error'

export interface EdicionGuardada {
  id: string
  asin: string
  sku: string
  origen: 'manual' | 'ia'
  propuestaId: string | null
  antes: TextosFicha
  despues: TextosFicha
  campos: CampoFicha[]
  estado: EstadoEdicion
  issues: AmazonIssue[]
  submissionId: string | null
  verificacion: { campos?: Partial<Record<CampoFicha, ComparacionDeCampo>>; explicacion?: string | null; issues?: AmazonIssue[] } | null
  fueraDeVentana: boolean
  avisos: string[]
  error: string | null
  creadoPor: string | null
  enviadoPor: string | null
  createdAt: string
  validadaAt: string | null
  enviadaAt: string | null
  verificadaAt: string | null
}

const COLUMNAS = 'id, asin, sku, origen, propuesta_id, antes, despues, campos, estado, issues, submission_id, verificacion, fuera_de_ventana, avisos, error, creado_por, enviado_por, created_at, validada_at, enviada_at, verificada_at'

function deFila(r: Record<string, unknown>, nombres: Map<string, string>): EdicionGuardada {
  const nombre = (id: unknown) => (typeof id === 'string' ? (nombres.get(id) ?? 'alguien del equipo') : null)
  return {
    id: String(r.id),
    asin: String(r.asin),
    sku: String(r.sku),
    origen: r.origen === 'ia' ? 'ia' : 'manual',
    propuestaId: (r.propuesta_id as string | null) ?? null,
    antes: r.antes as TextosFicha,
    despues: r.despues as TextosFicha,
    campos: (r.campos as CampoFicha[]) ?? [],
    estado: r.estado as EstadoEdicion,
    issues: (r.issues as AmazonIssue[]) ?? [],
    submissionId: (r.submission_id as string | null) ?? null,
    verificacion: (r.verificacion as EdicionGuardada['verificacion']) ?? null,
    fueraDeVentana: Boolean(r.fuera_de_ventana),
    avisos: (r.avisos as string[]) ?? [],
    error: (r.error as string | null) ?? null,
    creadoPor: nombre(r.creado_por),
    enviadoPor: nombre(r.enviado_por),
    createdAt: String(r.created_at),
    validadaAt: (r.validada_at as string | null) ?? null,
    enviadaAt: (r.enviada_at as string | null) ?? null,
    verificadaAt: (r.verificada_at as string | null) ?? null,
  }
}

async function nombresDe(ids: Array<unknown>): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter((x): x is string => typeof x === 'string'))]
  if (unicos.length === 0) return new Map()
  const { data } = await createServiceClient().from('profiles').select('id, full_name').in('id', unicos)
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name ?? 'alguien del equipo']))
}

/** El historial de ediciones de un producto (las 20 últimas), con los nombres de quién las hizo. Sin la migración 312, vacío */
export async function edicionesDe(c: { connectionId: string; marketplaceId: string }, asin: string): Promise<{ ediciones: EdicionGuardada[]; sinMigracion: boolean }> {
  const { data, error } = await createServiceClient().from('seo_ediciones').select(COLUMNAS).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('asin', asin).order('created_at', { ascending: false }).limit(20)
  if (error) {
    if (isMissingSchema(error)) return { ediciones: [], sinMigracion: true }
    throw error
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const nombres = await nombresDe(filas.flatMap((f) => [f.creado_por, f.enviado_por]))
  return { ediciones: filas.map((f) => deFila(f, nombres)), sinMigracion: false }
}

/* ------------------------------------------------------------------ */
/* Amazon: el listing, la definición del tipo y el PATCH               */
/* ------------------------------------------------------------------ */

/** La definición de cada tipo de producto cambia poco: se guarda un día en memoria */
const definiciones = new Map<string, { at: number; propiedades: string[] }>()
const UN_DIA_MS = 86_400_000

/** Los atributos que admite un tipo de producto en un marketplace (Product Type Definitions API: propertyGroups[*].propertyNames). Solo LEE */
export async function propiedadesDelTipo(creds: AmazonCredentials, marketplaceId: string, productType: string): Promise<string[]> {
  const clave = `${marketplaceId}|${productType}`
  const guardada = definiciones.get(clave)
  if (guardada && Date.now() - guardada.at < UN_DIA_MS) return guardada.propiedades
  const { data } = await spApiRequest<{ propertyGroups?: Record<string, { propertyNames?: string[] }> }>(creds, 'getDefinitionsProductType', {
    method: 'GET',
    path: `/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`,
    query: { marketplaceIds: [marketplaceId], sellerId: creds.sellingPartnerId, requirements: 'LISTING', locale: 'DEFAULT' },
    maxAttempts: 2,
  })
  const propiedades = [...new Set(Object.values(data.propertyGroups ?? {}).flatMap((g) => g.propertyNames ?? []))]
  definiciones.set(clave, { at: Date.now(), propiedades })
  return propiedades
}

interface ListingLeido {
  ficha: FichaLeida
  productType: string
  languageTag: string
  /** Otros idiomas de la ficha en este país (Bélgica, Canadá): con alguno, no se edita desde el ERP */
  otrosIdiomas: string[]
  atributoHighlights: string | null
  textos: TextosFicha
}

/** El listing de un SKU tal cual está ahora, con su tipo, su idioma y el atributo de los highlights. Solo LEE */
async function leerListing(creds: AmazonCredentials, marketplaceId: string, sku: string): Promise<ListingLeido | { motivo: string }> {
  const { data } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(creds, 'searchListingsItems', {
    method: 'GET',
    path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
    query: { marketplaceIds: [marketplaceId], identifiers: [sku], identifiersType: 'SKU', includedData: ['summaries', 'attributes', 'issues'], pageSize: 1 },
  })
  const item = data.items?.[0]
  const ficha = item ? fichaDeItem(item, marketplaceId) : null
  if (!item || !ficha) return { motivo: `Amazon no encuentra el SKU ${sku} en esta cuenta y país.` }
  if (!ficha.productType) return { motivo: 'Amazon no ha devuelto el tipo de producto de este listing: no se puede cambiar desde aquí.' }
  // Un solo idioma (fichaDeItem ya lo ha elegido): el del título de este marketplace o, si no dice, el del país
  const languageTag = ficha.languageTag ?? 'es_ES'
  // Si la definición no se puede leer, los highlights se avisan (no se mandan a ciegas con un nombre inventado)
  const propiedades = await propiedadesDelTipo(creds, marketplaceId, ficha.productType).catch((e) => {
    console.error('SEO: definición del tipo de producto:', e instanceof Error ? e.message : e)
    return [] as string[]
  })
  const atributoHighlights = atributoDeHighlights(propiedades)
  const highlights = atributoHighlights ? highlightsDeAtributos(ficha.atributos, marketplaceId, atributoHighlights, languageTag) : ficha.highlights
  return {
    ficha,
    productType: ficha.productType,
    languageTag,
    otrosIdiomas: ficha.otrosIdiomas ?? [],
    atributoHighlights,
    textos: { titulo: ficha.titulo ?? '', highlights: highlights ?? '', bullets: ficha.bullets, descripcion: ficha.descripcion ?? '', backend: ficha.backend ?? '' },
  }
}

type RespuestaPatch = { status?: string; submissionId?: string; issues?: AmazonIssue[] }
const bloquea = (r: RespuestaPatch) => r.status === 'INVALID' || (r.issues ?? []).some((i) => (i.severity ?? '').toUpperCase() === 'ERROR')

async function patch(creds: AmazonCredentials, marketplaceId: string, sku: string, productType: string, patches: unknown[], validar: boolean): Promise<RespuestaPatch> {
  const { data } = await spApiRequest<RespuestaPatch>(creds, 'patchListingsItem', {
    method: 'PATCH',
    path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}/${encodeURIComponent(sku)}`,
    query: { marketplaceIds: [marketplaceId], issueLocale: 'es_ES', mode: validar ? 'VALIDATION_PREVIEW' : undefined },
    body: { productType, patches },
    // replace = valor absoluto: repetirlo deja lo mismo
    repeatable: true,
    maxAttempts: 2,
  })
  return data
}

/* ------------------------------------------------------------------ */
/* Validar y aplicar                                                   */
/* ------------------------------------------------------------------ */

export interface Cuenta {
  connectionId: string
  marketplaceId: string
}

export type ResultadoDeValidacion =
  | { ok: true; edicion: EdicionGuardada | null; campos: CampoFicha[]; avisos: string[]; issues: AmazonIssue[]; antes: TextosFicha; ventana: { bloqueada: boolean; ultimo: string; puedeDesde: string } | null }
  | {
      ok: false
      motivo: string
      issues: AmazonIssue[]
      edicion?: EdicionGuardada | null
      /** La ficha tal cual está ahora en Amazon (si se ha llegado a leer): el editor la usa como nuevo «original» */
      antes?: TextosFicha
      /** Los campos tocados que han cambiado en Amazon desde la última lectura */
      camposCambiadosEnAmazon?: CampoFicha[]
      /** Los idiomas de una ficha bilingüe (Bélgica, Canadá): el editor no deja editarla */
      idiomas?: string[]
    }

/** ¿La ventana del SOP (30 días entre cambios de título) está cerrada para este producto? Cuenta lo aplicado por la IA y lo editado a mano */
async function ventanaDe(c: Cuenta, asin: string) {
  return ventanaDeCambio(await cambiosAplicados(c.connectionId, c.marketplaceId), asin, new Date().toISOString().slice(0, 10))
}

async function credencialesDe(c: Cuenta): Promise<AmazonCredentials | null> {
  const r = await connectionCredentials(c.connectionId)
  return r?.credentials ?? null
}

/**
 * PASO 1 · VALIDAR EN AMAZON. No guarda nada en la ficha (VALIDATION_PREVIEW). Apunta la edición «validada» o «rechazada» con lo que dijo Amazon y el
 * «antes» leído en este momento. Solo se puede aplicar una edición validada.
 */
export async function validarEdicion(
  c: Cuenta,
  e: {
    asin: string
    sku: string
    despues: TextosFicha
    origen: 'manual' | 'ia'
    propuestaId?: string | null
    userId: string
    /** Los campos que la persona ha tocado. Obligatorio: sin él no se manda nada (antes se mandaba todo lo distinto y se pisaba Seller Central) */
    soloCampos: CampoFicha[] | null | undefined
    /** Lo que había en esos campos cuando la persona empezó a editar: si Amazon ya no lo tiene (y tampoco lo nuevo), no se pisa */
    antesVisto?: Partial<TextosFicha> | null
    /** La ficha sobre la que se hizo una propuesta de la IA: si el título, las viñetas o el backend ya no son esos, no se manda nada */
    esperado?: TextosFicha | null
  }
): Promise<ResultadoDeValidacion> {
  const creds = await credencialesDe(c)
  if (!creds) return { ok: false, motivo: 'La conexión de Amazon ya no existe.', issues: [] }
  const listing = await leerListing(creds, c.marketplaceId, e.sku)
  if ('motivo' in listing) return { ok: false, motivo: listing.motivo, issues: [] }

  const decision = decidirEdicion({ viva: listing.textos, despues: e.despues, soloCampos: e.soloCampos, antesVisto: e.antesVisto, esperado: e.esperado, otrosIdiomas: listing.otrosIdiomas, languageTag: listing.languageTag })
  if (!decision.ok) {
    const idiomas = listing.otrosIdiomas.length > 0 ? [listing.languageTag, ...listing.otrosIdiomas] : undefined
    return { ok: false, motivo: decision.motivo, issues: [], antes: listing.textos, camposCambiadosEnAmazon: decision.camposCambiadosEnAmazon, idiomas }
  }
  const campos = decision.campos
  const { bloqueos } = bloqueosDeEdicion(e.despues, campos)
  if (bloqueos.length > 0) return { ok: false, motivo: bloqueos.join(' '), issues: [], antes: listing.textos }

  const plan = planDePatch(e.despues, campos, { marketplaceId: c.marketplaceId, languageTag: listing.languageTag, atributoHighlights: listing.atributoHighlights })
  if (plan.patches.length === 0) return { ok: false, motivo: plan.avisos.join(' ') || 'No hay nada que mandar.', issues: [], antes: listing.textos }

  let respuesta: RespuestaPatch
  try {
    respuesta = await patch(creds, c.marketplaceId, e.sku, listing.productType, plan.patches, true)
  } catch (err) {
    if (!(err instanceof AmazonApiError)) throw err
    return { ok: false, motivo: err.humanMessage ?? err.message, issues: err.issues ?? [], antes: listing.textos }
  }
  const issues = respuesta.issues ?? []
  const rechazada = bloquea(respuesta)
  const ventana = await ventanaDe(c, e.asin)

  const fila = {
    connection_id: c.connectionId,
    marketplace_id: c.marketplaceId,
    asin: e.asin,
    sku: e.sku,
    product_type: listing.productType,
    origen: e.origen,
    propuesta_id: e.propuestaId ?? null,
    antes: listing.textos,
    despues: e.despues,
    campos: plan.enviados,
    atributo_highlights: listing.atributoHighlights,
    estado: rechazada ? 'rechazada' : 'validada',
    issues,
    avisos: plan.avisos,
    error: rechazada ? describeIssues(issues).slice(0, 1000) : null,
    creado_por: e.userId,
    validada_at: new Date().toISOString(),
  }
  const { data, error } = await createServiceClient().from('seo_ediciones').insert(fila).select(COLUMNAS).single()
  // Sin la migración 312 se puede validar igual (no hay dónde apuntarlo); aplicar a mano sí la necesita
  if (error && !isMissingSchema(error)) throw error
  const edicion = data ? deFila(data as Record<string, unknown>, await nombresDe([e.userId])) : null
  if (rechazada) return { ok: false, motivo: `Amazon no lo acepta: ${describeIssues(issues)}`, issues, edicion, antes: listing.textos }
  return { ok: true, edicion, campos: plan.enviados, avisos: plan.avisos, issues, antes: listing.textos, ventana: ventana ? { bloqueada: ventana.bloqueada, ultimo: ventana.ultimo, puedeDesde: ventana.puedeDesde } : null }
}

export type ResultadoDeAplicar = { ok: true; edicion: EdicionGuardada; submissionId: string | null; avisos: string | null } | { ok: false; motivo: string; issues: AmazonIssue[] }

/** Una edición validada caduca: lo que se aplica tiene que ser lo que se acaba de ver validado */
const VALIDEZ_MS = 2 * 3_600_000

/**
 * PASO 2 · APLICAR. ESCRIBE EN LA FICHA DEL CLIENTE. Solo una edición «validada» hace menos de 2 horas, de esta cuenta. Vuelve a validar (la ficha puede
 * haber cambiado), lo manda y apunta quién y cuándo. Si toca el título y el SOP dice que no han pasado 30 días, no se manda salvo que la persona lo
 * confirme a sabiendas (`saltarVentana`), y queda apuntado.
 */
export async function aplicarEdicion(c: Cuenta, id: string, userId: string, opciones: { saltarVentana?: boolean } = {}): Promise<ResultadoDeAplicar> {
  const service = createServiceClient()
  const { data, error } = await service.from('seo_ediciones').select(`${COLUMNAS}, product_type, atributo_highlights`).eq('id', id).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).maybeSingle()
  if (error) throw error
  if (!data) return { ok: false, motivo: 'Esa edición no existe.', issues: [] }
  const fila = data as Record<string, unknown>
  const ed = deFila(fila, new Map())
  if (ed.estado !== 'validada') return { ok: false, motivo: `Esa edición ya está ${ed.estado.replace('_', ' ')}: valida de nuevo.`, issues: [] }
  if (!ed.validadaAt || Date.now() - Date.parse(ed.validadaAt) > VALIDEZ_MS) return { ok: false, motivo: 'La validación tiene más de 2 horas: vuelve a validar en Amazon antes de aplicar.', issues: [] }

  const ventana = ed.campos.includes('titulo') ? await ventanaDe(c, ed.asin) : null
  if (ventana?.bloqueada && !opciones.saltarVentana) return { ok: false, motivo: `El título de este producto se cambió el ${ventana.ultimo}: el SOP pide ${DIAS_ENTRE_CAMBIOS} días entre cambios (desde el ${ventana.puedeDesde}). Si aun así quieres mandarlo, confírmalo marcando la casilla.`, issues: [] }

  const creds = await credencialesDe(c)
  if (!creds) return { ok: false, motivo: 'La conexión de Amazon ya no existe.', issues: [] }
  const listing = await leerListing(creds, c.marketplaceId, ed.sku)
  if ('motivo' in listing) return { ok: false, motivo: listing.motivo, issues: [] }
  if (listing.otrosIdiomas.length > 0) return { ok: false, motivo: `Esta ficha está en dos idiomas (${[listing.languageTag, ...listing.otrosIdiomas].join(' y ')}) en este país: edítala en Seller Central.`, issues: [] }
  // Entre validar y aplicar (hasta 2 h) alguien puede haber cambiado la ficha en Seller Central: no se pisa
  const pisados = camposPisadosDesdeValidar(listing.textos, ed.antes, ed.despues, ed.campos)
  if (pisados.length > 0) {
    await service.from('seo_ediciones').update({ estado: 'rechazada', error: `Cambiado en Amazon antes de aplicar: ${pisados.join(', ')}` }).eq('id', id)
    const nombres = pisados.map((x) => NOMBRE_DE_CAMPO[x].toLowerCase()).join(', ')
    return { ok: false, motivo: `${pisados.length === 1 ? `Este campo (${nombres}) ha cambiado` : `Estos campos (${nombres}) han cambiado`} en Amazon desde que lo validaste: recarga la ficha y vuelve a validar.`, issues: [] }
  }
  const plan = planDePatch(ed.despues, ed.campos, { marketplaceId: c.marketplaceId, languageTag: listing.languageTag, atributoHighlights: (fila.atributo_highlights as string | null) ?? listing.atributoHighlights })
  if (plan.patches.length === 0) return { ok: false, motivo: plan.avisos.join(' ') || 'No hay nada que mandar.', issues: [] }

  try {
    const prueba = await patch(creds, c.marketplaceId, ed.sku, listing.productType, plan.patches, true)
    if (bloquea(prueba)) {
      const issues = prueba.issues ?? []
      await service.from('seo_ediciones').update({ estado: 'rechazada', issues, error: describeIssues(issues).slice(0, 1000) }).eq('id', id)
      return { ok: false, motivo: `Amazon ya no lo acepta: ${describeIssues(issues)}`, issues }
    }
    const hecho = await patch(creds, c.marketplaceId, ed.sku, listing.productType, plan.patches, false)
    const issues = hecho.issues ?? []
    if (bloquea(hecho)) {
      await service.from('seo_ediciones').update({ estado: 'error', issues, submission_id: hecho.submissionId ?? null, error: describeIssues(issues).slice(0, 1000), enviado_por: userId, enviada_at: new Date().toISOString() }).eq('id', id)
      return { ok: false, motivo: `Amazon ha rechazado el cambio: ${describeIssues(issues)}`, issues }
    }
    const ahora = new Date().toISOString()
    const { data: actualizada, error: e2 } = await service
      .from('seo_ediciones')
      .update({ estado: 'enviada', issues, submission_id: hecho.submissionId ?? null, enviado_por: userId, enviada_at: ahora, fuera_de_ventana: Boolean(ventana?.bloqueada), error: null })
      .eq('id', id)
      .select(COLUMNAS)
      .single()
    if (e2) throw e2
    // La ficha se vuelve a leer en la pasada siguiente; la verificación compara a partir de los 5 minutos
    await service.from('seo_lecturas').update({ ficha_leida_at: null }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
    // Un cambio a mano deja viejas las propuestas de la IA pendientes de ese producto: se descartan (si no, una podría pisar lo que se acaba de mandar)
    if (ed.origen === 'manual') await descartarPropuestasPendientes(c, ed.asin)
    const nombres = await nombresDe([fila.creado_por, userId])
    return { ok: true, edicion: deFila(actualizada as Record<string, unknown>, nombres), submissionId: hecho.submissionId ?? null, avisos: issues.length > 0 ? describeIssues(issues) : null }
  } catch (err) {
    if (!(err instanceof AmazonApiError)) throw err
    await service.from('seo_ediciones').update({ estado: 'error', error: (err.humanMessage ?? err.message).slice(0, 1000) }).eq('id', id)
    return { ok: false, motivo: err.humanMessage ?? err.message, issues: err.issues ?? [] }
  }
}

/** Marca como descartadas las propuestas de la IA pendientes de un producto. No rompe el envío si falla (ya está hecho en Amazon) */
async function descartarPropuestasPendientes(c: Cuenta, asin: string): Promise<void> {
  const { error } = await createServiceClient().from('seo_propuestas').update({ estado: 'descartada' }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId).eq('asin', asin).eq('estado', 'pendiente')
  if (error && !isMissingSchema(error)) console.error('SEO: descartar propuestas pendientes tras editar a mano:', error.message)
}

/* ------------------------------------------------------------------ */
/* La verificación (desde el proceso de lectura)                        */
/* ------------------------------------------------------------------ */

/** Cada cuánto se vuelve a mirar una edición que aún no se ve en la ficha */
const VERIFICAR_CADA_MS = 20 * 60_000

/** ¿Hay ediciones de esta cuenta esperando a verificarse que toque mirar ya? Barato: una consulta pequeña. Sin la 312, no */
export async function hayEdicionesPorVerificar(c: Cuenta): Promise<boolean> {
  const { data, error } = await createServiceClient()
    .from('seo_ediciones')
    .select('id, enviada_at, comprobada_at')
    .eq('connection_id', c.connectionId)
    .eq('marketplace_id', c.marketplaceId)
    .eq('estado', 'enviada')
    .limit(20)
  if (error) return false
  const ahora = Date.now()
  return ((data ?? []) as Array<{ enviada_at: string | null; comprobada_at: string | null }>).some((r) => r.enviada_at && ahora - Date.parse(r.enviada_at) > MINUTOS_ANTES_DE_VERIFICAR * 60_000 && (!r.comprobada_at || ahora - Date.parse(r.comprobada_at) > VERIFICAR_CADA_MS))
}

/** Las cuentas con alguna edición que toca verificar (para que el proceso de fondo pase por ellas aunque no tengan otra cosa que hacer) */
export async function cuentasConEdicionesPorVerificar(): Promise<Cuenta[]> {
  const { data, error } = await createServiceClient().from('seo_ediciones').select('connection_id, marketplace_id, enviada_at, comprobada_at').eq('estado', 'enviada').limit(200)
  if (error) return []
  const ahora = Date.now()
  const filas = ((data ?? []) as Array<{ connection_id: string; marketplace_id: string; enviada_at: string | null; comprobada_at: string | null }>).filter((r) => r.enviada_at && ahora - Date.parse(r.enviada_at) > MINUTOS_ANTES_DE_VERIFICAR * 60_000 && (!r.comprobada_at || ahora - Date.parse(r.comprobada_at) > VERIFICAR_CADA_MS))
  return [...new Map(filas.map((r) => [`${r.connection_id}|${r.marketplace_id}`, { connectionId: r.connection_id, marketplaceId: r.marketplace_id }])).values()]
}

/**
 * Relee de Amazon los SKU con ediciones enviadas y compara campo a campo (lib/seo/edicion.ts → verificarEdicion). Marca aplicada / no aplicada / parcial
 * (y lo copia en la propuesta de la IA, si venía de una), o apunta que se ha mirado y aún no se ve. Solo LEE de Amazon. Devuelve cuántas ha cerrado.
 */
export async function verificarEdiciones(c: Cuenta, creds: AmazonCredentials): Promise<number> {
  const service = createServiceClient()
  const { data, error } = await service
    .from('seo_ediciones')
    .select('id, sku, despues, campos, atributo_highlights, enviada_at, comprobada_at, comprobaciones, propuesta_id')
    .eq('connection_id', c.connectionId)
    .eq('marketplace_id', c.marketplaceId)
    .eq('estado', 'enviada')
    .order('enviada_at', { ascending: true })
    .limit(20)
  if (error) {
    if (isMissingSchema(error)) return 0
    throw error
  }
  const ahora = Date.now()
  const toca = ((data ?? []) as Array<Record<string, unknown>>).filter((r) => {
    const enviada = typeof r.enviada_at === 'string' ? Date.parse(r.enviada_at) : 0
    const comprobada = typeof r.comprobada_at === 'string' ? Date.parse(r.comprobada_at) : 0
    return enviada && ahora - enviada > MINUTOS_ANTES_DE_VERIFICAR * 60_000 && (!comprobada || ahora - comprobada > VERIFICAR_CADA_MS)
  })
  if (toca.length === 0) return 0

  const skus = [...new Set(toca.map((r) => String(r.sku)))].slice(0, 20)
  const { data: leidos } = await spApiRequest<{ items?: Array<Record<string, unknown>> }>(creds, 'searchListingsItems', {
    method: 'GET',
    path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}`,
    query: { marketplaceIds: [c.marketplaceId], identifiers: skus, identifiersType: 'SKU', includedData: ['summaries', 'attributes', 'issues'], pageSize: 20 },
  })
  const porSku = new Map<string, FichaLeida>()
  for (const item of leidos.items ?? []) {
    const f = fichaDeItem(item, c.marketplaceId)
    if (f) porSku.set(f.sku, f)
  }

  let cerradas = 0
  for (const r of toca) {
    const f = porSku.get(String(r.sku))
    const campos = (r.campos as CampoFicha[]) ?? []
    const horas = (ahora - Date.parse(String(r.enviada_at))) / 3_600_000
    const leido: Partial<TextosFicha> = f
      ? {
          titulo: f.titulo ?? '',
          bullets: f.bullets,
          descripcion: f.descripcion ?? '',
          backend: f.backend ?? '',
          // Los highlights se leen con el MISMO atributo con el que se mandaron. Si se mandaron con un atributo conocido y la ficha no los trae,
          // es que NO están (vacío → «distinto»), no que no se puedan leer: si no, una edición solo de highlights se daba por aplicada a las 24 h
          highlights: r.atributo_highlights ? (highlightsDeAtributos(f.atributos, c.marketplaceId, String(r.atributo_highlights), f.languageTag) ?? '') : (f.highlights ?? undefined),
        }
      : {}
    const v = verificarEdicion(r.despues as TextosFicha, leido, campos.filter((x) => CAMPOS_FICHA.includes(x)), horas)
    const explicacion = explicacionDeNoAplicada(v.estado, v.campos)
    const verificacion = { campos: v.campos, explicacion, issues: (f?.issues ?? []).slice(0, 10), leida_at: new Date(ahora).toISOString() }
    const cambio: Record<string, unknown> = { verificacion, comprobaciones: Number(r.comprobaciones ?? 0) + 1, comprobada_at: new Date(ahora).toISOString() }
    if (v.estado !== 'pendiente') {
      cambio.estado = v.estado
      cambio.verificada_at = new Date(ahora).toISOString()
      cerradas++
    }
    await service.from('seo_ediciones').update(cambio).eq('id', String(r.id))
    if (v.estado !== 'pendiente' && r.propuesta_id) await marcarPropuesta(String(r.propuesta_id), v.estado, verificacion)
  }
  return cerradas
}

/** La propuesta de la IA guarda la verificación en su `resultado` (su estado sigue siendo «aplicada»: el CHECK de la 299 no admite otro) */
async function marcarPropuesta(id: string, estado: EstadoVerificado, verificacion: Record<string, unknown>): Promise<void> {
  const service = createServiceClient()
  const { data } = await service.from('seo_propuestas').select('resultado').eq('id', id).maybeSingle()
  const resultado = ((data as { resultado?: Record<string, unknown> } | null)?.resultado ?? {}) as Record<string, unknown>
  await service.from('seo_propuestas').update({ resultado: { ...resultado, verificacion: { estado, ...verificacion } } }).eq('id', id)
}

/**
 * Para la propuesta de la IA: valida y, si Amazon dice que sí, manda en el mismo paso (la persona ya confirmó en la pantalla).
 *
 * `esperado` (fallo 14): la ficha sobre la que se escribió la propuesta. Si la viva ya no coincide en título, viñetas o backend, NO se manda nada (la propuesta pisaría lo que alguien cambió
 * después) y se devuelve `fichaCambiada` con los campos. La validación ya leyó la ficha viva sin escribir (VALIDATION_PREVIEW): la edición que apuntó se marca rechazada.
 */
export async function validarYAplicar(c: Cuenta, e: { asin: string; sku: string; despues: TextosFicha; propuestaId: string; userId: string }, opciones: { esperado?: TextosFicha | null } = {}): Promise<ResultadoDeAplicarIa> {
  const v = await validarEdicion(c, { ...e, origen: 'ia', soloCampos: ['titulo', 'highlights', 'bullets', 'backend'] })
  if (!v.ok) return { ok: false, motivo: v.motivo, issues: v.issues }
  const cambiados = opciones.esperado ? cambiosDesdeLaPropuesta(opciones.esperado, v.antes) : []
  if (cambiados.length > 0) {
    const motivo = motivoFichaCambiada(cambiados)
    if (v.edicion) await createServiceClient().from('seo_ediciones').update({ estado: 'rechazada', error: motivo }).eq('id', v.edicion.id)
    return { ok: false, motivo, issues: [], fichaCambiada: cambiados }
  }
  if (!v.edicion) return enviarSinRegistro(c, e.sku, e.despues, v.campos)
  // La ventana del SOP ya la comprobó quien llama (aplicarPropuesta): aquí no se vuelve a bloquear
  const r = await aplicarEdicion(c, v.edicion.id, e.userId, { saltarVentana: true })
  return r.ok ? { ...r, campos: v.campos, antes: v.antes, avisosPlan: v.avisos } : r
}

export type ResultadoDeAplicarIa = { ok: true; edicion: EdicionGuardada | null; submissionId: string | null; avisos: string | null; campos?: CampoFicha[]; antes?: TextosFicha; avisosPlan?: string[] } | { ok: false; motivo: string; issues: AmazonIssue[]; fichaCambiada?: CampoComparado[] }

/**
 * Sin la migración 312 (todavía sin lanzar) la propuesta de la IA se sigue pudiendo aplicar como antes: ya validada, se manda y queda apuntada en la
 * propia propuesta (aplicada_por, aplicada_at). Lo que no hay es verificación posterior.
 */
async function enviarSinRegistro(c: Cuenta, sku: string, despues: TextosFicha, campos: CampoFicha[]): Promise<ResultadoDeAplicarIa> {
  const creds = await credencialesDe(c)
  if (!creds) return { ok: false, motivo: 'La conexión de Amazon ya no existe.', issues: [] }
  const listing = await leerListing(creds, c.marketplaceId, sku)
  if ('motivo' in listing) return { ok: false, motivo: listing.motivo, issues: [] }
  const plan = planDePatch(despues, campos, { marketplaceId: c.marketplaceId, languageTag: listing.languageTag, atributoHighlights: listing.atributoHighlights })
  try {
    const hecho = await patch(creds, c.marketplaceId, sku, listing.productType, plan.patches, false)
    const issues = hecho.issues ?? []
    if (bloquea(hecho)) return { ok: false, motivo: `Amazon ha rechazado el cambio: ${describeIssues(issues)}`, issues }
    await createServiceClient().from('seo_lecturas').update({ ficha_leida_at: null }).eq('connection_id', c.connectionId).eq('marketplace_id', c.marketplaceId)
    return { ok: true, edicion: null, submissionId: hecho.submissionId ?? null, avisos: issues.length > 0 ? describeIssues(issues) : null, campos: plan.enviados, antes: listing.textos, avisosPlan: plan.avisos }
  } catch (err) {
    if (!(err instanceof AmazonApiError)) throw err
    return { ok: false, motivo: err.humanMessage ?? err.message, issues: err.issues ?? [] }
  }
}
