/**
 * AMAZON ADS · EL MOTOR, FASE 3: PROPUESTAS DE PUJA, PAUSA Y PRESUPUESTO (SOLO SERVIDOR). Solo PROPONE: aplicar lo hace una persona desde «Propuestas» (el piloto automático solo negativiza).
 *
 * Una vez al día (cuando llega el informe de términos), por cada cuenta con el motor encendido:
 *   · Pujas y pausas: las métricas de cada segmentación de 14 días que acaban «días sin cerrar» antes de hoy (ads_objetivos_diario; los últimos días Amazon aún reajusta conversiones) contra el ACoS
 *     objetivo de su producto y el CVR de referencia de su campaña, con la puja que tiene AHORA en Amazon. Reglas en reglas-pujas.ts.
 *   · Presupuesto: el gasto de los últimos 7 días de cada campaña (ads_rendimiento_diario) contra su presupuesto de hoy.
 * Cuarentena: una segmentación con una propuesta de puja pendiente o resuelta hace menos de «días entre cambios de puja» (ficha) no se vuelve a tocar; una campaña, lo mismo con «horas entre subidas».
 * Solo campañas activas con la nomenclatura del SOP y de productos con ACoS objetivo fijado.
 *
 * EN MODO AGENTE (con `ajustes` del agente PPC, lib/ads/agente/): cada producto baja contra SU objetivo efectivo (con postura) y sus umbrales ya combinados; la presión del día de cada campaña
 * (R2/R3) se suma con combinarAjustes, siempre acotada. Toda SUBIDA tiene que pasar subidaPermitida (contra el objetivo BASE) y no pasar de la puja máxima; no hay subidas si la cuenta o el producto
 * no las permiten, ni en campañas o términos de marca (que bajan contra la mitad del objetivo). Lo que tiene un efecto abierto (sin medir) no se toca, los presupuestos los decide el agente (R1/R4)
 * y un producto en lanzamiento solo pausa con el doble de muestra. Sin `ajustes`, todo como siempre.
 */

import { todasLasFilas, trozos } from './paginar'
import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { campanasDe } from './campanas'
import { leerFicha } from './cuenta'
import { llamarAds } from './datos'
import { objetivosDeCuenta } from './motor'
import { motivoSegmentacionesSinReleer } from './motor-calculo'
import { efectosAbiertos } from './agente/efectos-servidor'
import { cvrsDeCuenta, leerUmbrales } from './umbrales-cuenta'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre } from './reglas'
import { proponerPausas, proponerPresupuestos, proponerPujas, type SegmentacionParaReglas } from './reglas-pujas'
import { CLAUSULA_AUTO, pujaValida, textoDeExpresion } from './segmentaciones-calculo'
import type { CuentaParaSincronizar } from './sincronizar'
import type { UmbralesEstimados } from './umbrales'
import { combinarAjustes, esTextoDeMarca, subidaPermitida } from './agente/objetivos-calculo'
import { cuotasOrganicasDeCuenta } from './organico'
import { normalizarConsulta, proponerDefensaOrganica, type CuotaOrganica } from './organico-calculo'
import { AGENTE, type AjustesDelAgenteParaPujas, type Presion } from './agente/tipos'

const DIA_MS = 86_400_000
const VENTANA_PUJAS_DIAS = 14
/** Filas de ads_objetivos_diario por trozo de 100 campañas (14 días): de sobra; si se llega, la lectura falla en vez de truncar */
const TOPE_FILAS_POR_TROZO = 300_000
const cab = (t: string) => ({ Accept: t, 'Content-Type': t })
const desplazar = (dia: string, dias: number) => new Date(Date.parse(`${dia}T00:00:00Z`) + dias * DIA_MS).toISOString().slice(0, 10)

async function listar<T>(cuenta: CuentaParaSincronizar, ruta: string, tipo: string, clave: string, campaignIds: string[]): Promise<T[]> {
  const salida: T[] = []
  for (let i = 0; i < campaignIds.length; i += 100) {
    let token: string | undefined
    for (let pag = 0; pag < 20; pag++) {
      const res = await llamarAds<Record<string, unknown>>(cuenta.conexionId, ruta, { perfilId: cuenta.profileId, metodo: 'POST', cabeceras: cab(tipo), cuerpo: { campaignIdFilter: { include: campaignIds.slice(i, i + 100) }, stateFilter: { include: ['ENABLED'] }, maxResults: 1000, ...(token ? { nextToken: token } : {}) } })
      salida.push(...((res[clave] as T[] | undefined) ?? []))
      token = res.nextToken as string | undefined
      if (!token) break
    }
  }
  return salida
}

/** Lo que deja una propuesta en su motivo cuando el precio del producto es el ticket medio de Ads */
const notaDePrecio = (precio: number | null) => (precio ? ` · precio estimado ${precio.toFixed(2).replace('.', ',')} (ticket medio de Ads)` : '')

export async function generarPropuestasDePujaYPresupuesto(cuenta: CuentaParaSincronizar, ajustes?: AjustesDelAgenteParaPujas): Promise<{ pujas: number; presupuestos: number; pausas: number; omitido?: string; sinMigracionPausas?: boolean }> {
  const service = createServiceClient()
  // Sin la migración 298 no hay dónde guardarlas
  const sonda = await service.from('ads_objetivos_diario').select('perfil_id').eq('perfil_id', cuenta.id).limit(1)
  if (sonda.error) {
    if (isMissingSchema(sonda.error)) return { pujas: 0, presupuestos: 0, pausas: 0, omitido: 'falta la migración 298' }
    throw sonda.error
  }

  const ficha = await leerFicha(cuenta.id)
  const [objetivos, { umbrales }, { campanas }] = await Promise.all([objetivosDeCuenta(cuenta.id, ficha), leerUmbrales(cuenta.id), campanasDe(cuenta.conexionId, cuenta.profileId)])
  const cvrs = await cvrsDeCuenta(cuenta.id, umbrales.cvrPorDefectoPct)
  // El objetivo de cada producto (ACoS fijado + precio, o el ticket medio de Ads como estimación). Sin él, sus campañas no se tocan
  const objetivoDe = new Map<string, { acosObjetivoPct: number; cpaObjetivo: number; gastoMaximoSinVenta: number; precioEstimado: number | null }>()
  for (const [asin, o] of objetivos.porAsin) if (o) objetivoDe.set(asin, { acosObjetivoPct: o.acosObjetivoPct, cpaObjetivo: o.cpaObjetivo, gastoMaximoSinVenta: o.gastoMaximoSinVenta, precioEstimado: o.precioEstimado ? o.precio : null })
  const vivas = campanas.filter((c) => c.estado === 'ENABLED' && partesDeNombre(c.nombre) && asinDeCampana(c.nombre) && objetivoDe.has(asinDeCampana(c.nombre) as string))
  if (vivas.length === 0) return { pujas: 0, presupuestos: 0, pausas: 0, omitido: 'sin campañas de productos con ACoS objetivo' }
  const porId = new Map(vivas.map((c) => [c.campaignId, c]))
  const ids = vivas.map((c) => c.campaignId)

  // ---- lo que ya se propuso (cuarentena) ----
  const desdePuja = new Date(Date.now() - Math.max(1, ficha.diasEntreCambiosPuja) * DIA_MS).toISOString()
  const desdePresupuesto = new Date(Date.now() - Math.max(1, ficha.horasEntreSubidas) * 3_600_000).toISOString()
  // Paginado: con muchas segmentaciones pasaba de las 1.000 filas que da PostgREST y la cuarentena salía incompleta
  const { data: previas, error: ePrevias } = await todasLasFilas((a, b) =>
    service
      .from('ads_propuestas')
      .select('id, tipo, objetivo_id, campaign_id, estado, creada_at, resuelta_at')
      .eq('perfil_id', cuenta.id)
      .in('tipo', ['puja', 'presupuesto', 'pausar'])
      .or(`estado.eq.pendiente,resuelta_at.gte.${desdePresupuesto < desdePuja ? desdePresupuesto : desdePuja}`)
      .order('id')
      .range(a, b)
  )
  if (ePrevias) {
    if (isMissingSchema(ePrevias)) return { pujas: 0, presupuestos: 0, pausas: 0, omitido: 'falta la migración 298' }
    throw ePrevias
  }
  const bloqueadas = new Set<string>()
  const campanasBloqueadas = new Set<string>()
  for (const r of (previas ?? []) as Array<{ tipo: string; objetivo_id: string | null; campaign_id: string; estado: string; resuelta_at: string | null }>) {
    if (r.estado === 'caducada') continue
    // Una segmentación con una puja o una pausa pendiente (o resuelta hace poco) no se vuelve a tocar: un cambio cada vez y con ventana de lectura
    if ((r.tipo === 'puja' || r.tipo === 'pausar') && r.objetivo_id && (r.estado === 'pendiente' || (r.resuelta_at ?? '') >= desdePuja)) bloqueadas.add(r.objetivo_id)
    if (r.tipo === 'presupuesto' && (r.estado === 'pendiente' || (r.resuelta_at ?? '') >= desdePresupuesto)) campanasBloqueadas.add(r.campaign_id)
  }
  // CUARENTENA UNIFICADA: los cambios A MANO desde Campañas (ads_cambios_log) también cuentan. Con la 311 cada entrada lleva el id de la segmentación; sin ella no se puede cruzar
  for (const c of await cambiosAManoRecientes(cuenta.id, desdePresupuesto < desdePuja ? desdePresupuesto : desdePuja)) {
    if (c.campo?.startsWith('presupuesto')) {
      if (c.creado_at >= desdePresupuesto && c.campaign_id) campanasBloqueadas.add(c.campaign_id)
    } else if (c.entidad_id && c.creado_at >= desdePuja) bloqueadas.add(c.entidad_id)
  }
  // Modo agente: lo que tiene un efecto abierto (aún sin su medición provisional) no se toca; medir un cambio encima de otro no dice nada
  if (ajustes) {
    for (const id of ajustes.bloqueadasPorEfecto) bloqueadas.add(id)
    for (const id of ajustes.campanasBloqueadasPorEfecto) campanasBloqueadas.add(id)
  } else {
    // Sin ajustes también (p. ej. una llamada que no los pasa): los efectos abiertos se leen aquí (solo lectura; sin la 315, vacío). Un cambio del agente sin medir no se pisa nunca
    const efectos = await efectosAbiertos(cuenta.id)
    for (const id of efectos.objetivos) bloqueadas.add(id)
    for (const id of efectos.campanas) campanasBloqueadas.add(id)
  }

  // ---- pujas: estado vivo + métricas de 14 días ----
  const T_GRUPO = 'application/vnd.spAdGroup.v3+json'
  const [grupos, keywords, targets] = await Promise.all([
    listar<{ adGroupId?: string | number; defaultBid?: number }>(cuenta, '/sp/adGroups/list', T_GRUPO, 'adGroups', ids),
    listar<{ keywordId?: string | number; campaignId?: string | number; adGroupId?: string | number; keywordText?: string; matchType?: string; bid?: number }>(cuenta, '/sp/keywords/list', 'application/vnd.spKeyword.v3+json', 'keywords', ids),
    listar<{ targetId?: string | number; campaignId?: string | number; adGroupId?: string | number; expression?: Array<{ type?: string; value?: string }>; resolvedExpression?: Array<{ type?: string; value?: string }>; expressionType?: string; bid?: number }>(cuenta, '/sp/targets/list', 'application/vnd.spTargetingClause.v3+json', 'targetingClauses', ids),
  ])
  const pujaDelGrupo = new Map(grupos.filter((g) => g.adGroupId != null).map((g) => [String(g.adGroupId), typeof g.defaultBid === 'number' ? g.defaultBid : null]))

  // La ventana de pujas acaba «días sin cerrar» antes de hoy (como mínimo, ayer): las conversiones de los últimos días todavía se están atribuyendo
  const hoy = new Date().toISOString().slice(0, 10)
  const hasta = desplazar(hoy, -Math.max(1, umbrales.diasSinCerrar))
  const desde = desplazar(hasta, -(VENTANA_PUJAS_DIAS - 1))

  // FRESCURA: si el informe de segmentaciones lleva fallando, las filas son de días leídos una sola vez (ventas a medio atribuir) o faltan días: no se decide nada con ellas.
  // No cambia el estado del agente ni ninguna regla; solo se omite hoy y se dice en el registro
  const sinReleer = await frescuraDeSegmentaciones(cuenta.id, desde, hasta, ids)
  if (sinReleer) return { pujas: 0, presupuestos: 0, pausas: 0, omitido: sinReleer }

  // Por trozos de 100 campañas: con todas en un solo `.in()` la URL pasaba de lo que admite PostgREST (414/400) con unas 600 campañas, y ese día la cuenta no generaba pujas.
  // Cada trozo se lee entero; si llega al tope, falla («lectura incompleta») en vez de decidir con los días más recientes cortados
  const suma = new Map<string, { impresiones: number; clics: number; gasto: number; ventas: number; pedidos: number }>()
  for (const trozo of trozos(ids, 100)) {
    const { data, error } = await todasLasFilas(
      (a, b) =>
        service
          .from('ads_objetivos_diario')
          .select('objetivo_id, impresiones, clics, gasto, ventas, pedidos')
          .eq('perfil_id', cuenta.id)
          .gte('fecha', desde)
          .lte('fecha', hasta)
          .in('campaign_id', trozo)
          .order('fecha')
          .order('objetivo_id')
          .range(a, b) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }>,
      { tope: TOPE_FILAS_POR_TROZO, lanzarAlTope: true }
    )
    if (error) throw error
    for (const r of data) {
      const x = suma.get(String(r.objetivo_id)) ?? { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0 }
      x.impresiones += Number(r.impresiones)
      x.clics += Number(r.clics)
      x.gasto += Number(r.gasto)
      x.ventas += Number(r.ventas)
      x.pedidos += Number(r.pedidos)
      suma.set(String(r.objetivo_id), x)
    }
  }

  const porAsin = new Map<string, SegmentacionParaReglas[]>()
  const meter = (campaignId: string, s: Omit<SegmentacionParaReglas, 'campaignName' | 'metricas' | 'activa'>) => {
    const c = porId.get(campaignId)
    const m = suma.get(s.id)
    if (!c || !m || bloqueadas.has(s.id) || !(s.puja > 0)) return
    const asin = asinDeCampana(c.nombre) as string
    const lista = porAsin.get(asin) ?? []
    lista.push({ ...s, campaignName: c.nombre, activa: true, metricas: m, cvr: cvrs.de(c.campaignId, asin).cvr, esSemilla: partesDeNombre(c.nombre)?.rol === 'MANUAL EXACTA / DOMINIO' })
    porAsin.set(asin, lista)
  }
  for (const k of keywords) {
    if (k.keywordId == null || k.campaignId == null) continue
    meter(String(k.campaignId), { id: String(k.keywordId), tipo: 'keyword', texto: k.keywordText ?? '', campaignId: String(k.campaignId), adGroupId: String(k.adGroupId ?? ''), puja: typeof k.bid === 'number' ? k.bid : (pujaDelGrupo.get(String(k.adGroupId)) ?? 0) })
  }
  for (const t of targets) {
    if (t.targetId == null || t.campaignId == null) continue
    const auto = t.expressionType === 'AUTO' || Boolean(t.expression?.[0]?.type && CLAUSULA_AUTO[t.expression[0].type])
    meter(String(t.campaignId), { id: String(t.targetId), tipo: auto ? 'auto' : 'producto', texto: textoDeExpresion(t.resolvedExpression?.length ? t.resolvedExpression : t.expression), campaignId: String(t.campaignId), adGroupId: String(t.adGroupId ?? ''), puja: typeof t.bid === 'number' ? t.bid : (pujaDelGrupo.get(String(t.adGroupId)) ?? 0) })
  }

  let pujas = 0
  let pausas = 0
  let sinMigracionPausas = false
  // Lo orgánico de cada búsqueda (Brand Analytics menos publicidad): para no pagar ventas que llegan igual (organico-calculo.ts). Si falla, hoy no hay defensa del orgánico
  const organico = await cuotasOrganicasDeCuenta(cuenta.id, new Map(vivas.map((c) => [c.campaignId, asinDeCampana(c.nombre) as string]))).catch((err) => {
    console.error(`[ads] orgánico de ${cuenta.id}:`, err instanceof Error ? err.message : err)
    return new Map<string, Map<string, CuotaOrganica>>()
  })
  const deMarcaCampana = new Set(ajustes?.campanasDeMarca ?? [])
  // Sin la Buy Box (lib/ads/agente/buybox-calculo.ts): sus cifras caen sin culpa de las keywords, no se toca nada del producto
  const congelados = new Set((ajustes?.congeladosPorBuyBox ?? []).map((a) => a.toUpperCase()))
  for (const [asin, todas] of porAsin) {
    const o = objetivoDe.get(asin)
    if (!o || congelados.has(asin.toUpperCase())) continue
    for (const g of gruposDelAgente(todas, asin, ajustes)) {
      const segs = g.segs
      // Sin ajustes, un solo grupo con lo de siempre. Con ellos, el objetivo para BAJAR del grupo (marca = la mitad) y el CPA a la misma escala
      const pg = g.parametros ?? { acosObjetivoPct: o.acosObjetivoPct, cpaObjetivo: o.cpaObjetivo, umbrales }
      const cpaGrupo = g.parametros ? o.cpaObjetivo * (pg.acosObjetivoPct / o.acosObjetivoPct) : o.cpaObjetivo
      // Primero lo que se pausa (pasa el tope sin venta): a eso no se le propone además bajar la puja
      const pausadas = new Set<string>()
      for (const pa of proponerPausas(segs, { cpaObjetivo: cpaGrupo, muestraMinimaClics: ficha.muestraMinimaClics, umbrales: pg.umbrales })) {
        // Un producto en lanzamiento solo pausa con el doble de muestra (aún está aprendiendo)
        if (g.lanzamiento && pa.metricas.clics < AGENTE.LANZAMIENTO_PAUSA_X_MUESTRA * (ajustes?.muestraMinimaClics ?? ficha.muestraMinimaClics)) continue
        pausadas.add(pa.objetivoId)
        if (sinMigracionPausas) continue
        const { error } = await service.from('ads_propuestas').insert({
          perfil_id: cuenta.id,
          tipo: 'pausar',
          asin,
          termino: pa.texto.slice(0, 300),
          campaign_id: pa.campaignId,
          campaign_nombre: pa.campaignName,
          ad_group_id: pa.adGroupId || null,
          desde_rol: partesDeNombre(pa.campaignName)?.rol ?? null,
          motivo: pa.motivo + notaDePrecio(o.precioEstimado),
          metricas: { ...pa.metricas, ...(o.precioEstimado ? { precioEstimado: o.precioEstimado } : {}) },
          objetivo_id: pa.objetivoId,
          objetivo_tipo: pa.objetivoTipo,
        })
        if (!error) pausas += 1
        // 23514 = la base todavía no admite el tipo «pausar» (falta la migración 305): se sigue con lo demás y se dice
        else if (error.code === '23514') sinMigracionPausas = true
        else if (error.code !== '23505') throw error
      }
      const sinPausar = segs.filter((x) => !pausadas.has(x.id))
      const conPropuesta = new Set<string>()
      for (const crudo of proponerPujas(sinPausar, { acosObjetivoPct: pg.acosObjetivoPct, cpaObjetivo: cpaGrupo, cambioPujaPct: ficha.cambioPujaPct, muestraMinimaClics: ficha.muestraMinimaClics, umbrales: pg.umbrales })) {
        const pr = ajustes ? filtrarSubidaDelAgente(crudo, g, ajustes) : crudo
        if (!pr) continue
        conPropuesta.add(pr.objetivoId)
        const { error } = await service.from('ads_propuestas').insert({
          perfil_id: cuenta.id,
          tipo: 'puja',
          asin,
          termino: pr.texto.slice(0, 300),
          campaign_id: pr.campaignId,
          campaign_nombre: pr.campaignName,
          ad_group_id: pr.adGroupId || null,
          desde_rol: partesDeNombre(pr.campaignName)?.rol ?? null,
          motivo: pr.motivo + notaDePrecio(o.precioEstimado),
          metricas: { ...pr.metricas, ...(o.precioEstimado ? { precioEstimado: o.precioEstimado } : {}) },
          objetivo_id: pr.objetivoId,
          objetivo_tipo: pr.objetivoTipo,
          valor_actual: pr.pujaActual,
          valor_nuevo: pr.pujaNueva,
        })
        if (!error) pujas += 1
        else if (error.code !== '23505') throw error
      }

      // ---- Defensa del orgánico: keywords (no de marca) de búsquedas donde el producto ya se lleva muchos clics y compras sin pagar ----
      const cuotas = organico.get(asin.toUpperCase())
      if (cuotas && cuotas.size > 0) {
        for (const s of sinPausar) {
          if (s.tipo !== 'keyword' || conPropuesta.has(s.id) || deMarcaCampana.has(s.campaignId) || esTextoDeMarca(s.texto, g.marca)) continue
          const d = proponerDefensaOrganica(s, cuotas.get(normalizarConsulta(s.texto)), { acosObjetivoPct: pg.acosObjetivoPct, muestraMinimaClics: ficha.muestraMinimaClics })
          if (!d) continue
          const nueva = pujaValida(d.pujaNueva)
          if (nueva == null || s.puja - nueva < 0.02) continue
          conPropuesta.add(s.id)
          const m = s.metricas
          const { error } = await service.from('ads_propuestas').insert({
            perfil_id: cuenta.id,
            tipo: 'puja',
            asin,
            termino: s.texto.slice(0, 300),
            campaign_id: s.campaignId,
            campaign_nombre: s.campaignName,
            ad_group_id: s.adGroupId || null,
            desde_rol: partesDeNombre(s.campaignName)?.rol ?? null,
            motivo: d.motivo,
            metricas: { clics: m.clics, gasto: Math.round(m.gasto * 100) / 100, pedidos: m.pedidos, ventas: Math.round(m.ventas * 100) / 100, ...d.metricas, origen: 'organico' },
            objetivo_id: s.id,
            objetivo_tipo: s.tipo,
            valor_actual: Math.round(s.puja * 100) / 100,
            valor_nuevo: nueva,
          })
          if (!error) pujas += 1
          else if (error.code !== '23505') throw error
        }
      }

      // ---- El stock se acaba / se ha repuesto (solo en modo agente) ----
      // Con 7 días o menos de stock, TODAS las segmentaciones activas del producto bajan `bajadaPct` (las que ya tienen propuesta de las reglas, no: una sola
      // propuesta por segmentación). Cuando vuelve a tener stock, las que se bajaron por stock suben un 15 % al día hasta su puja de antes. Una vez al día:
      // el motor genera una vez al día y el índice único de pendientes impide repetirlas
      const stockDelAsin = ajustes ? (ajustes.porAsin[asin] ?? ajustes.porAsin[asin.toUpperCase()])?.stock : null
      const restaurar = ajustes?.restaurarPorStock ?? {}
      // Sin saber qué se movió hoy por stock (la lectura falló), hoy no se mueve nada por stock: mejor un día sin bajar que bajar dos veces
      const yaHoy = ajustes?.cambiadasPorStockHoy === undefined ? new Set<string>() : ajustes.cambiadasPorStockHoy === null ? null : new Set(ajustes.cambiadasPorStockHoy)
      for (const s of yaHoy ? sinPausar : []) {
        if (yaHoy?.has(s.id) || conPropuesta.has(s.id) || !s.activa || !(s.puja > 0) || ajustes?.bloqueadasPorEfecto.includes(s.id)) continue
        let nueva: number | null = null
        let motivo = ''
        let origenStock: 'bajar' | 'restaurar' | null = null
        if (stockDelAsin?.fase === 'bajar' && stockDelAsin.bajadaPct > 0) {
          nueva = pujaValida(s.puja * (1 - stockDelAsin.bajadaPct / 100))
          motivo = `El stock se acaba: ${stockDelAsin.porque}`
          origenStock = 'bajar'
        } else if (!stockDelAsin && restaurar[s.id] != null && s.puja < restaurar[s.id] - 0.02) {
          nueva = pujaValida(Math.min(restaurar[s.id], s.puja * (1 + AGENTE.STOCK_RESTAURAR_PCT / 100)))
          motivo = `Vuelve a tener stock: la puja vuelve hacia la de antes de que se acabara (${restaurar[s.id].toFixed(2).replace('.', ',')}), un ${AGENTE.STOCK_RESTAURAR_PCT} % al día`
          origenStock = 'restaurar'
        }
        if (nueva == null || !origenStock || Math.abs(nueva - s.puja) < 0.02) continue
        const m = s.metricas
        const { error } = await service.from('ads_propuestas').insert({
          perfil_id: cuenta.id,
          tipo: 'puja',
          asin,
          termino: s.texto.slice(0, 300),
          campaign_id: s.campaignId,
          campaign_nombre: s.campaignName,
          ad_group_id: s.adGroupId || null,
          desde_rol: partesDeNombre(s.campaignName)?.rol ?? null,
          motivo,
          // `agente: true` en la de devolver: es una subida que el filtro del agente da por buena (no busca rendimiento, deshace una bajada por stock)
          metricas: { clics: m.clics, gasto: Math.round(m.gasto * 100) / 100, pedidos: m.pedidos, ventas: Math.round(m.ventas * 100) / 100, origenStock, ...(origenStock === 'restaurar' ? { agente: true } : {}) },
          objetivo_id: s.id,
          objetivo_tipo: s.tipo,
          valor_actual: Math.round(s.puja * 100) / 100,
          valor_nuevo: nueva,
        })
        if (!error) pujas += 1
        else if (error.code !== '23505') throw error
      }
    }
  }

  // En modo agente los presupuestos los decide el agente (R1/R4 con el uso de hoy): aquí no se proponen
  if (ajustes?.presupuestosLosHaceElAgente) return { pujas, presupuestos: 0, pausas, ...(sinMigracionPausas ? { sinMigracionPausas } : {}) }

  // ---- presupuesto: últimos 7 días contra el presupuesto de hoy ----
  const desde7 = desplazar(hasta, -6)
  const diario: Array<{ campaign_id: string; fecha: string; gasto: number; ventas: number }> = []
  for (const trozo of trozos(ids, 100)) {
    const { data, error: eDiario } = await todasLasFilas((a, b) => service.from('ads_rendimiento_diario').select('campaign_id, fecha, gasto, ventas').eq('perfil_id', cuenta.id).gte('fecha', desde7).lte('fecha', hasta).in('campaign_id', trozo).order('fecha').order('campaign_id').range(a, b), { lanzarAlTope: true })
    if (eDiario) throw eDiario
    diario.push(...(data as Array<{ campaign_id: string; fecha: string; gasto: number; ventas: number }>))
  }
  const g7 = new Map<string, { gasto: number; ventas: number; dias: Set<string> }>()
  for (const r of diario) {
    const x = g7.get(r.campaign_id) ?? { gasto: 0, ventas: 0, dias: new Set<string>() }
    x.gasto += Number(r.gasto)
    x.ventas += Number(r.ventas)
    x.dias.add(r.fecha)
    g7.set(r.campaign_id, x)
  }
  let presupuestos = 0
  const candidatas = vivas.filter((c) => !campanasBloqueadas.has(c.campaignId)).map((c) => ({ c, x: g7.get(c.campaignId) }))
  for (const { c, x } of candidatas) {
    if (!x) continue
    const o = objetivoDe.get(asinDeCampana(c.nombre) as string)
    if (!o) continue
    for (const pr of proponerPresupuestos([{ campaignId: c.campaignId, campaignName: c.nombre, presupuesto: c.presupuesto, activa: true, gasto7: x.gasto, diasConDatos: x.dias.size, ventas7: x.ventas }], { acosObjetivoPct: o.acosObjetivoPct, subidaPct: ficha.subidaPresupuestoPct, umbrales })) {
      const { error } = await service.from('ads_propuestas').insert({
        perfil_id: cuenta.id,
        tipo: 'presupuesto',
        asin: asinDeCampana(c.nombre),
        termino: c.nombre.slice(0, 300),
        campaign_id: c.campaignId,
        campaign_nombre: c.nombre,
        desde_rol: partesDeNombre(c.nombre)?.rol ?? null,
        motivo: pr.motivo + notaDePrecio(o.precioEstimado),
        metricas: { clics: 0, gasto: pr.metricas.gasto, pedidos: 0, ventas: pr.metricas.ventas, acosPct: pr.metricas.acosPct, usoPct: pr.metricas.usoPct, ...(o.precioEstimado ? { precioEstimado: o.precioEstimado } : {}) },
        valor_actual: pr.presupuestoActual,
        valor_nuevo: pr.presupuestoNuevo,
      })
      if (!error) presupuestos += 1
      else if (error.code !== '23505') throw error
    }
  }
  return { pujas, presupuestos, pausas, ...(sinMigracionPausas ? { sinMigracionPausas } : {}) }
}

/* ------------------------------------------------------------------ */
/* Modo agente: grupos por presión y marca, y el filtro de las subidas */
/* ------------------------------------------------------------------ */

interface GrupoDelAgente {
  segs: SegmentacionParaReglas[]
  /** null = sin ajustes del agente (todo como siempre) */
  parametros: { acosObjetivoPct: number; umbrales: UmbralesEstimados } | null
  acosParaSubir: number | null
  sinSubidas: boolean
  marca: string | null
  pujaMaxima: number | null
  lanzamiento: boolean
}

/**
 * Las segmentaciones de un producto repartidas por lo que cambia sus parámetros: la presión del día de su campaña y si son de MARCA (campaña de marca o texto con la marca). Sin ajustes, un solo
 * grupo sin parámetros (lo de siempre). Un ASIN que el agente no trae en porAsin baja con su objetivo de siempre y NO sube (sin margen conocido no se escala).
 */
function gruposDelAgente(segs: SegmentacionParaReglas[], asin: string, ajustes: AjustesDelAgenteParaPujas | undefined): GrupoDelAgente[] {
  if (!ajustes) return [{ segs, parametros: null, acosParaSubir: null, sinSubidas: false, marca: null, pujaMaxima: null, lanzamiento: false }]
  const pa = ajustes.porAsin[asin] ?? ajustes.porAsin[asin.toUpperCase()]
  if (!pa) return [{ segs, parametros: null, acosParaSubir: null, sinSubidas: true, marca: null, pujaMaxima: null, lanzamiento: false }]
  const deMarca = new Set(ajustes.campanasDeMarca)
  const grupos = new Map<string, GrupoDelAgente>()
  for (const s of segs) {
    const presion: Presion | null = ajustes.presion[s.campaignId] ?? null
    const marca = deMarca.has(s.campaignId) || esTextoDeMarca(s.texto, pa.marca)
    const clave = `${presion ?? ''}|${marca ? 1 : 0}`
    let g = grupos.get(clave)
    if (!g) {
      // La presión se suma a los umbrales del producto (ya con su postura): combinarAjustes con «mantener» solo añade la presión y vuelve a acotar
      const umbrales = presion
        ? combinarAjustes(pa.umbrales, { postura: 'mantener', presion, objetivoBase: pa.acosParaSubir, equilibrioPct: null, soloDefensivo: pa.soloDefensivo, esMarca: false, cuentaPequena: ajustes.cuentaPequena, sinSubidasCuenta: ajustes.sinSubidas }).umbrales
        : pa.umbrales
      g = {
        segs: [],
        parametros: { acosObjetivoPct: Math.round(pa.acosParaBajar * (marca ? AGENTE.MARCA_ACOS_X : 1) * 100) / 100, umbrales },
        acosParaSubir: pa.acosParaSubir,
        sinSubidas: ajustes.sinSubidas || pa.sinSubidas || marca,
        marca: pa.marca,
        pujaMaxima: pa.pujaMaxima,
        lanzamiento: pa.fase === 'lanzamiento',
      }
      grupos.set(clave, g)
    }
    g.segs.push(s)
  }
  return [...grupos.values()]
}

/**
 * Una propuesta de puja en modo agente: las BAJADAS pasan tal cual; una SUBIDA solo si el grupo permite subir, pasa subidaPermitida (contra el objetivo BASE, con la muestra mínima) y no pasa
 * de la puja máxima (si la pasa se recorta; si recortada ya no sube, fuera), y si una subida de la misma segmentación no empeoró ni se deshizo hace poco (subidasVetadas).
 * Las subidas que pasan llevan `metricas.agente = true`. En una campaña con ajuste de ubicación > 100 % se marca como rara (métrica `ubicacionAlta`). null = descartada.
 */
function filtrarSubidaDelAgente<T extends { direccion: 'subir' | 'bajar'; objetivoId: string; campaignId: string; texto: string; pujaActual: number; pujaNueva: number; motivo: string; metricas: { clics: number; gasto: number; ventas: number; pedidos: number } }>(pr: T, g: GrupoDelAgente, ajustes: AjustesDelAgenteParaPujas): (T & { metricas: T['metricas'] & { ubicacionAlta?: boolean; agente?: true } }) | null {
  if (pr.direccion !== 'subir') return pr
  // Una subida de esta segmentación empeoró o se deshizo sola hace poco: no se repite (bajar sí)
  if (ajustes.subidasVetadas?.includes(pr.objetivoId)) return null
  if (g.sinSubidas || g.acosParaSubir == null || !g.parametros) return null
  if (esTextoDeMarca(pr.texto, g.marca)) return null
  if (!subidaPermitida(pr.metricas, g.acosParaSubir, g.parametros.umbrales, ajustes.muestraMinimaClics)) return null
  let pujaNueva = pr.pujaNueva
  let motivo = pr.motivo
  if (g.pujaMaxima != null && pujaNueva > g.pujaMaxima) {
    pujaNueva = Math.round(g.pujaMaxima * 100) / 100
    if (pujaNueva - pr.pujaActual < 0.02) return null
    motivo += ` · recortada a la puja máxima (${pujaNueva.toFixed(2).replace('.', ',')})`
  }
  const ubicacionAlta = ajustes.campanasConUbicacionAlta.includes(pr.campaignId)
  // `agente: true`: la subida ha pasado ESTE filtro (decidirPropuesta retiene toda subida de puja sin la marca: p. ej. las del motor en «aprueba» mientras el agente estaba frenado)
  return { ...pr, pujaNueva, motivo, metricas: { ...pr.metricas, agente: true as const, ...(ubicacionAlta ? { ubicacionAlta: true } : {}) } }
}

/**
 * ¿Están frescas las segmentaciones de la ventana? (motivoSegmentacionesSinReleer). Tres lecturas pequeñas: el `actualizado_at` más reciente y el último día de ads_objetivos_diario en la ventana,
 * y si el día `hasta` tuvo gasto en alguna campaña viva (ads_rendimiento_diario). Devuelve el motivo para omitir, o null.
 */
async function frescuraDeSegmentaciones(perfilId: string, desde: string, hasta: string, ids: readonly string[]): Promise<string | null> {
  const service = createServiceClient()
  const [ultima, ultimoDia, gastoHasta] = await Promise.all([
    service.from('ads_objetivos_diario').select('actualizado_at').eq('perfil_id', perfilId).gte('fecha', desde).lte('fecha', hasta).order('actualizado_at', { ascending: false }).limit(1).maybeSingle(),
    service.from('ads_objetivos_diario').select('fecha').eq('perfil_id', perfilId).gte('fecha', desde).lte('fecha', hasta).order('fecha', { ascending: false }).limit(1).maybeSingle(),
    // Solo las campañas vivas (las que se van a decidir), por trozos como el resto
    Promise.all(trozos(ids, 100).map((t) => service.from('ads_rendimiento_diario').select('campaign_id').eq('perfil_id', perfilId).eq('fecha', hasta).gt('gasto', 0).in('campaign_id', t).limit(1))),
  ])
  if (ultima.error) throw ultima.error
  if (ultimoDia.error) throw ultimoDia.error
  for (const g of gastoHasta) if (g.error) throw g.error
  const actualizado = (ultima.data as { actualizado_at?: string | null } | null)?.actualizado_at
  const ms = actualizado ? Date.parse(actualizado) : Number.NaN
  return motivoSegmentacionesSinReleer({
    ultimaLecturaMs: Number.isFinite(ms) ? ms : null,
    maxFecha: (ultimoDia.data as { fecha?: string } | null)?.fecha ?? null,
    hasta,
    gastoEnHasta: gastoHasta.some((g) => (g.data ?? []).length > 0),
    ahora: Date.now(),
  })
}

/** Los cambios de puja, estado y presupuesto hechos A MANO (o por el motor) que Amazon aceptó desde `desde`. Sin la 311 no hay entidad_id: solo sirven los de presupuesto */
async function cambiosAManoRecientes(perfilId: string, desde: string): Promise<Array<{ campaign_id: string | null; entidad_id: string | null; campo: string | null; creado_at: string }>> {
  const service = createServiceClient()
  const pedir = (columnas: string) =>
    todasLasFilas((a, b) => service.from('ads_cambios_log').select(columnas).eq('perfil_id', perfilId).eq('ok', true).in('origen', ['manual', 'automatico', 'agente']).in('accion', ['cambiar', 'pausar', 'activar']).gte('creado_at', desde).order('creado_at').order('id').range(a, b) as unknown as PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { code?: string; message?: string } | null }>, 10_000)
  let r = await pedir('campaign_id, entidad_id, campo, motivo, creado_at')
  if (r.error) r = await pedir('campaign_id, campo, motivo, creado_at')
  if (r.error) return []
  // Sin la 311 un ensayo se apunta como «manual» con «[ENSAYO]» delante del motivo: no ha tocado Amazon, así que no pone en cuarentena
  return r.data.filter((x) => !/^\[ENSAYO\]/.test(String(x.motivo ?? ''))).map((x) => ({ campaign_id: (x.campaign_id as string | null) ?? null, entidad_id: (x.entidad_id as string | null) ?? null, campo: (x.campo as string | null) ?? null, creado_at: String(x.creado_at) }))
}
