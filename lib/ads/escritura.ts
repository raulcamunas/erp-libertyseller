/**
 * AMAZON ADS · LAS LLAMADAS QUE CREAN COSAS EN LA CUENTA DE UN CLIENTE.
 * SOLO SERVIDOR.
 *
 * ESTO ESCRIBE EN LA CUENTA DEL CLIENTE. Aquí solo están las llamadas sueltas (una campaña, un grupo, un anuncio, los grupos de segmentación de la automática); quién las encadena, con qué
 * permisos y dejando qué rastro está en crear-estructura.ts.
 *
 *
 * ============ LAS CAMPAÑAS NACEN PAUSADAS ============
 *
 * Una campaña pausada con su presupuesto y sus pujas puestos no gasta nada. El SOP (sección 08, «Montaje») lo pide así: primero se crean vacías con su nomenclatura, después se cargan las
 * negativas, y solo entonces se activa. Activar es un acto aparte y de una persona.
 *
 *
 * ============ LA v3 DEVUELVE 207 ============
 *
 * Cada escritura de la v3 responde con un código de éxito aunque falle lo que se pidió: el cuerpo trae dos listas, `success` y `error`, y hay que mirarlas. `llamarAds` solo lanza con un 4xx/5xx
 * de verdad, así que un «207 con el error dentro» pasaba por bueno. `aislar()` lo convierte en una excepción con el motivo de Amazon.
 */

import { llamarAds } from './datos'
import { AdsError } from './oauth'
import type { CampanaPlan, TargetAuto } from './estructura'

const T_CAMPANA = 'application/vnd.spCampaign.v3+json'
const T_GRUPO = 'application/vnd.spAdGroup.v3+json'
const T_ANUNCIO = 'application/vnd.spProductAd.v3+json'
const T_TARGET = 'application/vnd.spTargetingClause.v3+json'

const cabeceras = (tipo: string) => ({ Accept: tipo, 'Content-Type': tipo })

type ListaMulti = {
  success?: Array<Record<string, unknown>>
  error?: Array<{ index?: number; errors?: Array<{ errorType?: string; errorValue?: unknown }> }>
}

/** El motivo legible de un error de la v3: su tipo y el primer texto que traiga dentro */
function motivoDe(e: { errors?: Array<{ errorType?: string; errorValue?: unknown }> } | undefined): string {
  const primero = e?.errors?.[0]
  if (!primero) return 'Amazon no ha dicho por qué'
  const texto = JSON.stringify(primero.errorValue ?? {})
  const dentro = /"(?:message|reason)":"([^"]+)"/.exec(texto)?.[1]
  return `${primero.errorType ?? 'ERROR'}${dentro ? `: ${dentro}` : texto && texto !== '{}' ? `: ${texto.slice(0, 200)}` : ''}`
}

/**
 * Del cuerpo de una escritura al elemento creado o cambiado, o una excepción con lo que dijo Amazon. `clave` es la lista de la respuesta (`campaigns`, `adGroups`, `productAds`,
 * `targetingClauses`).
 */
function aislar(cuerpo: unknown, clave: string, indice = 0): Record<string, unknown> {
  const lista = (cuerpo as Record<string, ListaMulti> | null)?.[clave]
  const bien = lista?.success?.find((s) => (s.index as number | undefined) === indice) ?? lista?.success?.[indice]
  if (bien) return bien
  const mal = lista?.error?.find((e) => (e.index ?? 0) === indice) ?? lista?.error?.[0]
  throw new AdsError(`Amazon no ha creado el elemento (${clave}): ${motivoDe(mal)}`, { estado: 207, cuerpo: JSON.stringify(cuerpo).slice(0, 600) })
}

function idDe(elemento: Record<string, unknown>, campo: string): string {
  const id = elemento[campo] ?? (elemento[campo.replace(/Id$/, '')] as Record<string, unknown> | undefined)?.[campo]
  if (id == null || String(id) === '') throw new AdsError(`Amazon ha contestado sin «${campo}»: ${JSON.stringify(elemento).slice(0, 200)}`)
  return String(id)
}

/** Crea una campaña PAUSADA. Devuelve su campaignId */
export async function crearCampana(conexionId: string, profileId: number, c: CampanaPlan): Promise<string> {
  const res = await llamarAds<unknown>(conexionId, '/sp/campaigns', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: cabeceras(T_CAMPANA),
    cuerpo: {
      campaigns: [
        {
          name: c.nombre,
          targetingType: c.targetingType,
          state: 'PAUSED',
          budget: { budgetType: 'DAILY', budget: c.presupuestoDiario },
          dynamicBidding: {
            strategy: c.estrategiaPuja,
            placementBidding: [{ placement: 'PLACEMENT_TOP', percentage: Math.round(c.topBusquedasPct) }],
          },
        },
      ],
    },
  })
  return idDe(aislar(res, 'campaigns'), 'campaignId')
}

/** Crea el grupo de anuncios de una campaña. Devuelve su adGroupId */
export async function crearGrupo(conexionId: string, profileId: number, campaignId: string, nombre: string, pujaPorDefecto: number): Promise<string> {
  const res = await llamarAds<unknown>(conexionId, '/sp/adGroups', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: cabeceras(T_GRUPO),
    cuerpo: { adGroups: [{ campaignId, name: nombre, state: 'ENABLED', defaultBid: pujaPorDefecto }] },
  })
  return idDe(aislar(res, 'adGroups'), 'adGroupId')
}

/**
 * Pone el producto en el grupo. Una cuenta de VENDEDOR anuncia por SKU; una de PROVEEDOR (vendor), por ASIN. Devuelve el adId.
 */
export async function crearAnuncio(
  conexionId: string,
  profileId: number,
  campaignId: string,
  adGroupId: string,
  producto: { asin: string; sku: string },
  tipoDeCuenta: string | null
): Promise<string> {
  const anuncio = tipoDeCuenta === 'vendor' ? { asin: producto.asin } : { sku: producto.sku }
  const res = await llamarAds<unknown>(conexionId, '/sp/productAds', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: cabeceras(T_ANUNCIO),
    cuerpo: { productAds: [{ campaignId, adGroupId, state: 'ENABLED', ...anuncio }] },
  })
  return idDe(aislar(res, 'productAds'), 'adId')
}

interface ClausulaCruda {
  targetId?: string | number
  state?: string
  bid?: number
  expression?: Array<{ type?: string }>
}

/**
 * Deja los grupos de segmentación de una campaña AUTOMÁTICA como los pide el SOP: unos encendidos a su puja y otros apagados.
 *
 * Amazon crea los cuatro al crear el grupo de anuncios automático. Aquí se leen y se ajustan. Devuelve cuántos ha dejado configurados.
 */
export async function configurarAutomatica(conexionId: string, profileId: number, campaignId: string, adGroupId: string, targets: readonly TargetAuto[], pujaBase: number): Promise<number> {
  const lista = await llamarAds<{ targetingClauses?: ClausulaCruda[] }>(conexionId, '/sp/targets/list', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: cabeceras(T_TARGET),
    cuerpo: { adGroupIdFilter: { include: [adGroupId] }, maxResults: 100 },
  })
  const existentes = new Map<string, ClausulaCruda>()
  for (const t of lista.targetingClauses ?? []) {
    const tipo = t.expression?.[0]?.type
    if (tipo) existentes.set(tipo, t)
  }

  const puja = (t: TargetAuto) => Math.max(0.02, Math.round(pujaBase * t.factorDePuja * 100) / 100)
  const cambios = targets.filter((t) => existentes.has(t.tipo)).map((t) => ({ targetId: String(existentes.get(t.tipo)?.targetId), state: t.activo ? 'ENABLED' : 'PAUSED', bid: puja(t) }))
  // Los cuatro grupos de la automática NO se pueden crear a mano (la especificación de Amazon: «Auto Targeting - cannot be manually created»): los pone Amazon al crear el grupo de anuncios y aquí
  // solo se ajustan. Si falta alguno, se dice, y quien llama deshace la campaña
  const faltan = targets.filter((t) => !existentes.has(t.tipo))
  if (faltan.length > 0) throw new AdsError(`Amazon no ha creado los grupos de segmentación automáticos de la campaña (faltan: ${faltan.map((t) => t.nombre).join(', ')}).`)

  if (cambios.length > 0) {
    const res = await llamarAds<unknown>(conexionId, '/sp/targets', {
      perfilId: profileId,
      metodo: 'PUT',
      cabeceras: cabeceras(T_TARGET),
      cuerpo: { targetingClauses: cambios },
    })
    // Si alguno falla, la respuesta lo dice en `error`: se mira cada índice
    for (let i = 0; i < cambios.length; i++) aislar(res, 'targetingClauses', i)
  }
  return cambios.length
}

/**
 * Archiva una campaña (`POST /sp/campaigns/delete`: en la v3 el estado ARCHIVED no se puede poner con un PUT, solo se llega a él borrando). Solo se usa para deshacer lo que ESTA misma pasada acaba de
 * crear cuando algo falla a mitad (una campaña sin grupo ni anuncio no sirve y estorba en la cuenta del cliente). No se puede revertir: no se llama nunca sobre una campaña que no se haya creado en
 * esta misma ejecución.
 */
export async function archivarCampana(conexionId: string, profileId: number, campaignId: string): Promise<void> {
  const res = await llamarAds<unknown>(conexionId, '/sp/campaigns/delete', {
    perfilId: profileId,
    metodo: 'POST',
    cabeceras: cabeceras(T_CAMPANA),
    cuerpo: { campaignIdFilter: { include: [campaignId] } },
  })
  aislar(res, 'campaigns')
}
