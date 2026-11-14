import { createServiceClient } from '@/lib/supabase/service'
import { connectionCredentials } from '@/lib/amazon/data'
import { AmazonApiError, type AmazonIssue } from '@/lib/amazon/errors'
import { spApiRequest } from '@/lib/amazon/sp-api'
import type { AmazonCredentials } from '@/lib/amazon/sp-api'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { conexionesDeCliente } from './conexiones'
import {
  VALIDEZ_DE_VALIDACION_MS,
  aFormulario,
  atributosDePatches,
  atributosEditables,
  definicionDeAtributo,
  elementosDelPais,
  hayErrores,
  huellaDe,
  idiomaDe,
  issuesLegibles,
  patchesDeCorreccion,
  type CorreccionRegistrada,
  type DefinicionDeAtributo,
  type EstadoCorreccion,
  type Formulario,
  type IssueLegible,
  type OperacionDePatch,
} from './correccion'

/**
 * CUMPLIMIENTO · CORREGIR UNA INCIDENCIA DESDE EL ERP. SOLO SERVIDOR.
 *
 *   preparar  lee el listing de Amazon (getListingsItem: atributos e incidencias de ahora), el esquema de su tipo de producto
 *             (Product Type Definitions API) y monta el formulario SOLO con los atributos que nombra la incidencia. No escribe nada.
 *   validar   manda los cambios a Amazon en modo VALIDATION_PREVIEW: Amazon dice si los aceptaría, SIN GUARDAR NADA. Se apunta.
 *   enviar    ESCRIBE EN LA FICHA DEL CLIENTE. Solo si hay una validación correcta de LOS MISMOS cambios (misma huella), del mismo
 *             usuario y en los últimos 30 minutos, y solo con la tabla de registro (migración 313). Se apunta con lo que había antes.
 *
 * Decisión de Raúl (14 nov 2026): corrigen los administradores y quien tenga la casilla de Cumplimiento (requireAppDeCuentas en la
 * ruta), siempre con validación previa y registro. Un listing cada vez: nada de lotes por Feeds API (otra fase).
 *
 * El cliente llega como amazonClientId y la conexión se busca aquí (amazon_listings de SUS conexiones): no se puede tocar el
 * listing de otro cliente aunque se conozca el SKU.
 */

const ISSUE_LOCALE = 'es_ES'
export const FALTA_MIGRACION_CORRECCIONES = 'Falta lanzar la migración 313_cumplimiento_correcciones.sql: sin el registro no se puede enviar nada a Amazon (validar sí se puede).'

/* ------------------------------------------------------------------ */
/* El listing y su conexión                                            */
/* ------------------------------------------------------------------ */

interface Localizado {
  connectionId: string
  creds: AmazonCredentials
  asin: string | null
  titulo: string | null
  productTypeGuardado: string | null
}

async function localizar(amazonClientId: string, mercado: string, sku: string): Promise<Localizado | { error: string }> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) return { error: 'Este cliente no tiene ninguna cuenta de Amazon activa.' }
  const { data, error } = await createServiceClient()
    .from('amazon_listings')
    .select('connection_id, asin, title, product_type')
    .in(
      'connection_id',
      conexiones.map((c) => c.id)
    )
    .eq('marketplace_id', mercado)
    .eq('sku', sku)
    .limit(1)
    .maybeSingle()
  if (error) throw error
  if (!data) return { error: 'Ese listing no está en el catálogo de este cliente.' }
  const fila = data as { connection_id: string; asin: string | null; title: string | null; product_type: string | null }
  const resuelta = await connectionCredentials(fila.connection_id)
  if (!resuelta) return { error: 'La cuenta de Amazon de este listing ya no está conectada.' }
  return { connectionId: fila.connection_id, creds: resuelta.credentials, asin: fila.asin, titulo: fila.title, productTypeGuardado: fila.product_type }
}

interface ListingLeido {
  productType: string | null
  asin: string | null
  titulo: string | null
  atributos: Record<string, unknown>
  issues: AmazonIssue[]
}

/** getListingsItem con atributos e incidencias de ahora. Una llamada (cupo de 5 por segundo, compartido con el catálogo) */
async function leerListing(creds: AmazonCredentials, mercado: string, sku: string): Promise<ListingLeido> {
  const { data } = await spApiRequest<{
    summaries?: Array<{ marketplaceId?: string; productType?: string; asin?: string; itemName?: string }>
    attributes?: Record<string, unknown>
    issues?: AmazonIssue[]
  }>(creds, 'getListingsItem', {
    method: 'GET',
    path: `/listings/2021-08-01/items/${encodeURIComponent(creds.sellingPartnerId)}/${encodeURIComponent(sku)}`,
    query: { marketplaceIds: [mercado], includedData: ['summaries', 'attributes', 'issues'], issueLocale: ISSUE_LOCALE },
    repeatable: true,
    maxAttempts: 2,
  })
  const resumen = data.summaries?.find((s) => s.marketplaceId === mercado) ?? data.summaries?.[0]
  return {
    productType: resumen?.productType ?? null,
    asin: resumen?.asin ?? null,
    titulo: resumen?.itemName ?? null,
    atributos: data.attributes ?? {},
    issues: data.issues ?? [],
  }
}

/* ------------------------------------------------------------------ */
/* El esquema del tipo de producto (Product Type Definitions API)      */
/* ------------------------------------------------------------------ */

interface EsquemaGuardado {
  propiedades: Record<string, unknown>
  defs: Record<string, unknown>
  requeridos: string[]
  version: string | null
  at: number
}

/** En memoria: el esquema de un tipo de producto pesa varios MB y cambia muy de tarde en tarde. 12 h y como mucho 24 tipos */
const ESQUEMAS = new Map<string, EsquemaGuardado>()
const ESQUEMA_MS = 12 * 3600 * 1000
const MAX_ESQUEMAS = 24
const MAX_BYTES_ESQUEMA = 25 * 1024 * 1024

async function esquemaDe(creds: AmazonCredentials, mercado: string, productType: string): Promise<EsquemaGuardado> {
  const clave = `${mercado}|${productType}`
  const guardado = ESQUEMAS.get(clave)
  if (guardado && Date.now() - guardado.at < ESQUEMA_MS) return guardado

  type Definicion = { schema?: { link?: { resource?: string } }; productTypeVersion?: { version?: string } }
  const pedir = (locale: string) =>
    spApiRequest<Definicion>(creds, 'getDefinitionsProductType', {
      method: 'GET',
      path: `/definitions/2020-09-01/productTypes/${encodeURIComponent(productType)}`,
      query: { marketplaceIds: [mercado], sellerId: creds.sellingPartnerId, requirements: 'LISTING', requirementsEnforced: 'ENFORCED', locale },
      repeatable: true,
      maxAttempts: 2,
    })
  // Con los títulos en español si Amazon los tiene para ese país; si no, los de por defecto del país
  let definicion: Definicion
  try {
    definicion = (await pedir('es_ES')).data
  } catch (e) {
    if (!(e instanceof AmazonApiError) || e.httpStatus !== 400) throw e
    definicion = (await pedir('DEFAULT')).data
  }
  const enlace = definicion.schema?.link?.resource
  // El esquema se descarga de un enlace firmado de Amazon (S3). Cualquier otro sitio, no
  if (!enlace || !/^https:\/\/[a-z0-9.-]+\.amazonaws\.com\//i.test(enlace)) throw new Error('Amazon no ha dado el enlace del esquema del tipo de producto.')
  const res = await fetch(enlace, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
  if (!res.ok) throw new Error(`No se ha podido descargar el esquema del tipo de producto (${res.status}).`)
  const largo = Number(res.headers.get('content-length') ?? 0)
  if (largo > MAX_BYTES_ESQUEMA) throw new Error('El esquema del tipo de producto es demasiado grande.')
  const esquema = (await res.json()) as { properties?: Record<string, unknown>; $defs?: Record<string, unknown>; required?: string[] }
  const nuevo: EsquemaGuardado = {
    propiedades: esquema.properties ?? {},
    defs: esquema.$defs ?? {},
    requeridos: Array.isArray(esquema.required) ? esquema.required : [],
    version: definicion.productTypeVersion?.version ?? null,
    at: Date.now(),
  }
  if (ESQUEMAS.size >= MAX_ESQUEMAS) ESQUEMAS.delete(ESQUEMAS.keys().next().value as string)
  ESQUEMAS.set(clave, nuevo)
  return nuevo
}

function definicionesDe(esquema: EsquemaGuardado, atributos: readonly string[]): DefinicionDeAtributo[] {
  return atributosEditables(atributos)
    .slice(0, 8)
    .map((a) => definicionDeAtributo(a, esquema.propiedades[a], esquema.defs, esquema.requeridos))
}

/* ------------------------------------------------------------------ */
/* El registro (migración 313)                                         */
/* ------------------------------------------------------------------ */

const COLUMNAS = 'id, sku, marketplace_id, codigo_incidencia, product_type, modo, estado, patches, submission_id, mensaje, issues, creado_por, creado_at'

async function nombresDe(ids: readonly string[]): Promise<Map<string, string>> {
  const unicos = [...new Set(ids.filter(Boolean))]
  if (unicos.length === 0) return new Map()
  const { data } = await createServiceClient().from('profiles').select('id, full_name').in('id', unicos)
  return new Map(((data ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name ?? 'Alguien del equipo']))
}

function deFila(r: Record<string, unknown>, nombres: Map<string, string>): CorreccionRegistrada {
  return {
    id: String(r.id),
    sku: String(r.sku),
    marketplaceId: String(r.marketplace_id),
    codigoIncidencia: (r.codigo_incidencia as string | null) ?? null,
    productType: String(r.product_type),
    modo: r.modo as 'validar' | 'enviar',
    estado: r.estado as EstadoCorreccion,
    atributos: atributosDePatches(r.patches),
    submissionId: (r.submission_id as string | null) ?? null,
    mensaje: (r.mensaje as string | null) ?? null,
    nIssues: Array.isArray(r.issues) ? r.issues.length : 0,
    creadoPor: r.creado_por ? nombres.get(String(r.creado_por)) ?? null : null,
    creadoAt: String(r.creado_at),
  }
}

/** El historial de correcciones de un listing (o null si la 313 no está lanzada) */
async function historialDe(connectionId: string, mercado: string, sku: string): Promise<CorreccionRegistrada[] | null> {
  const { data, error } = await createServiceClient()
    .from('cumplimiento_correcciones')
    .select(COLUMNAS)
    .eq('connection_id', connectionId)
    .eq('marketplace_id', mercado)
    .eq('sku', sku)
    .order('creado_at', { ascending: false })
    .limit(30)
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const nombres = await nombresDe(filas.map((f) => String(f.creado_por ?? '')))
  return filas.map((f) => deFila(f, nombres))
}

/** Las últimas correcciones de un cliente (un país o todos), para la pestaña «Hoy». null = sin la 313 */
export async function correccionesRecientes(amazonClientId: string, mercado: string | null, limite = 12): Promise<CorreccionRegistrada[] | null> {
  const conexiones = await conexionesDeCliente(amazonClientId)
  if (conexiones.length === 0) return []
  let q = createServiceClient()
    .from('cumplimiento_correcciones')
    .select(COLUMNAS)
    .in(
      'connection_id',
      conexiones.map((c) => c.id)
    )
    .eq('modo', 'enviar')
    .order('creado_at', { ascending: false })
    .limit(limite)
  if (mercado) q = q.eq('marketplace_id', mercado)
  const { data, error } = await q
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const filas = (data ?? []) as Array<Record<string, unknown>>
  const nombres = await nombresDe(filas.map((f) => String(f.creado_por ?? '')))
  return filas.map((f) => deFila(f, nombres))
}

/* ------------------------------------------------------------------ */
/* preparar                                                            */
/* ------------------------------------------------------------------ */

export interface CorreccionPreparada {
  ok: true
  sku: string
  marketplaceId: string
  asin: string | null
  titulo: string | null
  productType: string
  languageTag: string
  definiciones: DefinicionDeAtributo[]
  formulario: Formulario
  /** ¿Sigue Amazon dando esta incidencia ahora mismo? */
  sigueAbierta: boolean
  /** Todas las incidencias de Amazon de ahora en este listing, legibles */
  issuesAhora: IssueLegible[]
  /** null = sin la migración 313 (se puede validar, no enviar) */
  historial: CorreccionRegistrada[] | null
}

export type Fallo = { ok: false; error: string }

function mensajeDe(e: unknown): string {
  if (e instanceof AmazonApiError) return e.humanMessage ?? e.message
  return e instanceof Error ? e.message : 'Error desconocido'
}

export async function prepararCorreccion(
  amazonClientId: string,
  mercado: string,
  sku: string,
  codigo: string | null,
  atributosGuardados: readonly string[]
): Promise<CorreccionPreparada | Fallo> {
  const l = await localizar(amazonClientId, mercado, sku)
  if ('error' in l) return { ok: false, error: l.error }
  try {
    const leido = await leerListing(l.creds, mercado, sku)
    const productType = leido.productType ?? l.productTypeGuardado
    if (!productType) return { ok: false, error: 'Amazon no ha devuelto el tipo de producto de este listing: sin él no se puede cambiar nada desde aquí.' }
    // Los atributos: los que Amazon nombra AHORA en esa incidencia, más los que se guardaron en la revisión
    const deAhora = leido.issues.filter((i) => !codigo || i.code === codigo).flatMap((i) => i.attributeNames ?? [])
    const sigueAbierta = codigo ? leido.issues.some((i) => i.code === codigo) : leido.issues.length > 0
    const atributos = atributosEditables([...deAhora, ...atributosGuardados])
    if (atributos.length === 0) return { ok: false, error: 'Amazon no dice qué dato de la ficha falla en esta incidencia: hay que mirarla en Seller Central.' }
    const esquema = await esquemaDe(l.creds, mercado, productType)
    const definiciones = definicionesDe(esquema, atributos)
    const formulario: Formulario = {}
    for (const d of definiciones) if (d.soportado) formulario[d.nombre] = aFormulario(d, elementosDelPais(leido.atributos, d.nombre, mercado))
    return {
      ok: true,
      sku,
      marketplaceId: mercado,
      asin: leido.asin ?? l.asin,
      titulo: leido.titulo ?? l.titulo,
      productType,
      languageTag: idiomaDe(leido.atributos, mercado),
      definiciones,
      formulario,
      sigueAbierta,
      issuesAhora: issuesLegibles(leido.issues, definiciones),
      historial: await historialDe(l.connectionId, mercado, sku),
    }
  } catch (e) {
    return { ok: false, error: mensajeDe(e) }
  }
}

/* ------------------------------------------------------------------ */
/* validar y enviar                                                    */
/* ------------------------------------------------------------------ */

export interface ResultadoDeCorreccion {
  ok: true
  modo: 'validar' | 'enviar'
  estado: EstadoCorreccion
  /** Lo que dijo Amazon del cambio */
  issues: IssueLegible[]
  submissionId: string | null
  /** Qué atributos se han mandado */
  atributos: string[]
  /** Tras enviar: las incidencias del listing al volver a leerlo (Amazon tarda unos minutos en aplicarlo) */
  issuesDespues: IssueLegible[] | null
  registrado: boolean
  historial: CorreccionRegistrada[] | null
}

type RespuestaPatch = { status?: string; submissionId?: string; issues?: AmazonIssue[] }

export async function corregir(
  modo: 'validar' | 'enviar',
  amazonClientId: string,
  mercado: string,
  sku: string,
  codigo: string | null,
  formulario: Formulario,
  userId: string
): Promise<ResultadoDeCorreccion | (Fallo & { errores?: string[] })> {
  const l = await localizar(amazonClientId, mercado, sku)
  if ('error' in l) return { ok: false, error: l.error }
  const service = createServiceClient()

  try {
    // Se vuelve a leer: lo que había antes tiene que ser lo de AHORA, no lo de cuando se abrió el panel
    const leido = await leerListing(l.creds, mercado, sku)
    const productType = leido.productType ?? l.productTypeGuardado
    if (!productType) return { ok: false, error: 'Amazon no ha devuelto el tipo de producto de este listing.' }
    const esquema = await esquemaDe(l.creds, mercado, productType)
    const definiciones = definicionesDe(esquema, Object.keys(formulario))
    const { patches, anteriores, errores } = patchesDeCorreccion(definiciones, formulario, leido.atributos, mercado, idiomaDe(leido.atributos, mercado))
    if (errores.length > 0) return { ok: false, error: 'Hay datos que corregir en el formulario.', errores }
    if (patches.length === 0) return { ok: false, error: 'No has cambiado nada: lo del formulario es lo que ya tiene Amazon.' }
    const huella = huellaDe(patches, sku, mercado)

    if (modo === 'enviar') {
      // SIEMPRE CON VALIDACIÓN PREVIA: la misma huella, del mismo usuario, correcta y reciente
      const { data: validacion, error } = await service
        .from('cumplimiento_correcciones')
        .select('id')
        .eq('connection_id', l.connectionId)
        .eq('marketplace_id', mercado)
        .eq('sku', sku)
        .eq('huella', huella)
        .eq('modo', 'validar')
        .eq('estado', 'valido')
        .eq('creado_por', userId)
        .gte('creado_at', new Date(Date.now() - VALIDEZ_DE_VALIDACION_MS).toISOString())
        .limit(1)
        .maybeSingle()
      if (error) return { ok: false, error: isMissingSchema(error) ? FALTA_MIGRACION_CORRECCIONES : error.message }
      if (!validacion) return { ok: false, error: 'Antes de enviar hay que validar estos mismos cambios con Amazon (y la validación vale 30 minutos).' }
    }

    let respuesta: RespuestaPatch
    let fallo: string | null = null
    try {
      respuesta = (
        await spApiRequest<RespuestaPatch>(l.creds, 'patchListingsItem', {
          method: 'PATCH',
          path: `/listings/2021-08-01/items/${encodeURIComponent(l.creds.sellingPartnerId)}/${encodeURIComponent(sku)}`,
          query: { marketplaceIds: [mercado], issueLocale: ISSUE_LOCALE, mode: modo === 'validar' ? 'VALIDATION_PREVIEW' : undefined },
          body: { productType, patches: patches as OperacionDePatch[] },
          // replace = valor absoluto: repetirlo deja lo mismo
          repeatable: true,
          maxAttempts: 2,
        })
      ).data
    } catch (e) {
      if (!(e instanceof AmazonApiError)) throw e
      fallo = e.humanMessage ?? e.message
      respuesta = { issues: e.issues ?? [] }
    }
    const issues = respuesta.issues ?? []
    const estado: EstadoCorreccion = fallo ? 'error' : hayErrores(issues, respuesta.status) ? 'invalido' : modo === 'validar' ? 'valido' : 'aceptado'
    const legibles = issuesLegibles(issues, definiciones)

    const { error: errorRegistro } = await service.from('cumplimiento_correcciones').insert({
      connection_id: l.connectionId,
      marketplace_id: mercado,
      sku,
      codigo_incidencia: codigo,
      product_type: productType,
      patches,
      valor_anterior: anteriores,
      huella,
      modo,
      estado,
      submission_id: respuesta.submissionId ?? null,
      issues,
      mensaje: fallo ?? (legibles[0]?.mensaje ?? null),
      creado_por: userId,
    })
    const registrado = !errorRegistro
    if (errorRegistro && !isMissingSchema(errorRegistro)) console.error('[cumplimiento] no se ha podido apuntar la corrección', errorRegistro.message)
    if (modo === 'enviar' && !registrado) console.error('[cumplimiento] ENVIADO SIN REGISTRO', { connectionId: l.connectionId, mercado, sku, huella })

    if (fallo) return { ok: false, error: fallo }

    // Tras enviar, se vuelve a leer el listing: lo normal es que Amazon tarde unos minutos en aplicarlo
    let issuesDespues: IssueLegible[] | null = null
    if (modo === 'enviar' && estado === 'aceptado') {
      issuesDespues = await leerListing(l.creds, mercado, sku)
        .then((r) => issuesLegibles(r.issues, definiciones))
        .catch(() => null)
    }

    return {
      ok: true,
      modo,
      estado,
      issues: legibles,
      submissionId: respuesta.submissionId ?? null,
      atributos: atributosDePatches(patches),
      issuesDespues,
      registrado,
      historial: await historialDe(l.connectionId, mercado, sku),
    }
  } catch (e) {
    return { ok: false, error: mensajeDe(e) }
  }
}
