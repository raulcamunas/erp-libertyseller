/**
 * AMAZON ADS · EL MOTOR, FASE 3: PROPUESTAS DE PUJA Y DE PRESUPUESTO (SOLO SERVIDOR). Solo PROPONE: aplicar lo hace una persona desde «Propuestas» (el piloto automático solo negativiza).
 *
 * Una vez al día (cuando llega el informe de términos), por cada cuenta con el motor encendido:
 *   · Pujas: las métricas de cada segmentación de los últimos 14 días (ads_objetivos_diario) contra el ACoS objetivo de su producto, con la puja que tiene AHORA en Amazon. Reglas en reglas-pujas.ts.
 *   · Presupuesto: el gasto de los últimos 7 días de cada campaña (ads_rendimiento_diario) contra su presupuesto de hoy.
 * Cuarentena: una segmentación con una propuesta de puja pendiente o resuelta hace menos de «días entre cambios de puja» (ficha) no se vuelve a tocar; una campaña, lo mismo con «horas entre subidas».
 * Solo campañas activas con la nomenclatura del SOP y de productos con ACoS objetivo fijado.
 */

import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { campanasDe } from './campanas'
import { leerFicha, productosDeCuenta } from './cuenta'
import { llamarAds } from './datos'
import { objetivosDesdeAcos } from './margen'
import { asinDeCampana } from './productos-agrupar'
import { partesDeNombre } from './reglas'
import { proponerPresupuestos, proponerPujas, type SegmentacionParaReglas } from './reglas-pujas'
import { CLAUSULA_AUTO, textoDeExpresion } from './segmentaciones-calculo'
import type { CuentaParaSincronizar } from './sincronizar'

const DIA_MS = 86_400_000
const VENTANA_PUJAS_DIAS = 14
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

export async function generarPropuestasDePujaYPresupuesto(cuenta: CuentaParaSincronizar): Promise<{ pujas: number; presupuestos: number; omitido?: string }> {
  const service = createServiceClient()
  // Sin la migración 298 no hay dónde guardarlas
  const sonda = await service.from('ads_objetivos_diario').select('perfil_id').eq('perfil_id', cuenta.id).limit(1)
  if (sonda.error) {
    if (isMissingSchema(sonda.error)) return { pujas: 0, presupuestos: 0, omitido: 'falta la migración 298' }
    throw sonda.error
  }

  const [ficha, productos, { campanas }] = await Promise.all([leerFicha(cuenta.id), productosDeCuenta(cuenta.id), campanasDe(cuenta.conexionId, cuenta.profileId)])
  const objetivoDe = new Map<string, { acosObjetivoPct: number; cpaObjetivo: number }>()
  for (const p of productos) {
    const o = objetivosDesdeAcos(p.precio, p.acosObjetivoPct, ficha.gastoSinVentaX)
    if (o) objetivoDe.set(p.asin.toUpperCase(), { acosObjetivoPct: o.acosObjetivoPct, cpaObjetivo: o.cpaObjetivo })
  }
  const vivas = campanas.filter((c) => c.estado === 'ENABLED' && partesDeNombre(c.nombre) && asinDeCampana(c.nombre) && objetivoDe.has(asinDeCampana(c.nombre) as string))
  if (vivas.length === 0) return { pujas: 0, presupuestos: 0, omitido: 'sin campañas de productos con ACoS objetivo' }
  const porId = new Map(vivas.map((c) => [c.campaignId, c]))
  const ids = vivas.map((c) => c.campaignId)

  // ---- lo que ya se propuso (cuarentena) ----
  const desdePuja = new Date(Date.now() - Math.max(1, ficha.diasEntreCambiosPuja) * DIA_MS).toISOString()
  const desdePresupuesto = new Date(Date.now() - Math.max(1, ficha.horasEntreSubidas) * 3_600_000).toISOString()
  const { data: previas, error: ePrevias } = await service
    .from('ads_propuestas')
    .select('tipo, objetivo_id, campaign_id, estado, creada_at, resuelta_at')
    .eq('perfil_id', cuenta.id)
    .in('tipo', ['puja', 'presupuesto'])
    .or(`estado.eq.pendiente,resuelta_at.gte.${desdePresupuesto < desdePuja ? desdePresupuesto : desdePuja}`)
  if (ePrevias) {
    if (isMissingSchema(ePrevias)) return { pujas: 0, presupuestos: 0, omitido: 'falta la migración 298' }
    throw ePrevias
  }
  const bloqueadas = new Set<string>()
  const campanasBloqueadas = new Set<string>()
  for (const r of (previas ?? []) as Array<{ tipo: string; objetivo_id: string | null; campaign_id: string; estado: string; resuelta_at: string | null }>) {
    if (r.estado === 'caducada') continue
    if (r.tipo === 'puja' && r.objetivo_id && (r.estado === 'pendiente' || (r.resuelta_at ?? '') >= desdePuja)) bloqueadas.add(r.objetivo_id)
    if (r.tipo === 'presupuesto' && (r.estado === 'pendiente' || (r.resuelta_at ?? '') >= desdePresupuesto)) campanasBloqueadas.add(r.campaign_id)
  }

  // ---- pujas: estado vivo + métricas de 14 días ----
  const T_GRUPO = 'application/vnd.spAdGroup.v3+json'
  const [grupos, keywords, targets] = await Promise.all([
    listar<{ adGroupId?: string | number; defaultBid?: number }>(cuenta, '/sp/adGroups/list', T_GRUPO, 'adGroups', ids),
    listar<{ keywordId?: string | number; campaignId?: string | number; adGroupId?: string | number; keywordText?: string; matchType?: string; bid?: number }>(cuenta, '/sp/keywords/list', 'application/vnd.spKeyword.v3+json', 'keywords', ids),
    listar<{ targetId?: string | number; campaignId?: string | number; adGroupId?: string | number; expression?: Array<{ type?: string; value?: string }>; resolvedExpression?: Array<{ type?: string; value?: string }>; expressionType?: string; bid?: number }>(cuenta, '/sp/targets/list', 'application/vnd.spTargetingClause.v3+json', 'targetingClauses', ids),
  ])
  const pujaDelGrupo = new Map(grupos.filter((g) => g.adGroupId != null).map((g) => [String(g.adGroupId), typeof g.defaultBid === 'number' ? g.defaultBid : null]))

  const hasta = desplazar(new Date().toISOString().slice(0, 10), -1)
  const desde = desplazar(hasta, -(VENTANA_PUJAS_DIAS - 1))
  const suma = new Map<string, { impresiones: number; clics: number; gasto: number; ventas: number; pedidos: number }>()
  for (let i = 0; i < 100_000; i += 1000) {
    const { data, error } = await service.from('ads_objetivos_diario').select('objetivo_id, impresiones, clics, gasto, ventas, pedidos').eq('perfil_id', cuenta.id).gte('fecha', desde).lte('fecha', hasta).in('campaign_id', ids).order('fecha').order('objetivo_id').range(i, i + 999)
    if (error) throw error
    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const x = suma.get(String(r.objetivo_id)) ?? { impresiones: 0, clics: 0, gasto: 0, ventas: 0, pedidos: 0 }
      x.impresiones += Number(r.impresiones)
      x.clics += Number(r.clics)
      x.gasto += Number(r.gasto)
      x.ventas += Number(r.ventas)
      x.pedidos += Number(r.pedidos)
      suma.set(String(r.objetivo_id), x)
    }
    if (!data || data.length < 1000) break
  }

  const porAsin = new Map<string, SegmentacionParaReglas[]>()
  const meter = (campaignId: string, s: Omit<SegmentacionParaReglas, 'campaignName' | 'metricas' | 'activa'>) => {
    const c = porId.get(campaignId)
    const m = suma.get(s.id)
    if (!c || !m || bloqueadas.has(s.id) || !(s.puja > 0)) return
    const asin = asinDeCampana(c.nombre) as string
    const lista = porAsin.get(asin) ?? []
    lista.push({ ...s, campaignName: c.nombre, activa: true, metricas: m })
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
  for (const [asin, segs] of porAsin) {
    const o = objetivoDe.get(asin)
    if (!o) continue
    for (const pr of proponerPujas(segs, { acosObjetivoPct: o.acosObjetivoPct, cpaObjetivo: o.cpaObjetivo, cambioPujaPct: ficha.cambioPujaPct, muestraMinimaClics: ficha.muestraMinimaClics })) {
      const { error } = await service.from('ads_propuestas').insert({
        perfil_id: cuenta.id,
        tipo: 'puja',
        asin,
        termino: pr.texto.slice(0, 300),
        campaign_id: pr.campaignId,
        campaign_nombre: pr.campaignName,
        ad_group_id: pr.adGroupId || null,
        desde_rol: partesDeNombre(pr.campaignName)?.rol ?? null,
        motivo: pr.motivo,
        metricas: pr.metricas,
        objetivo_id: pr.objetivoId,
        objetivo_tipo: pr.objetivoTipo,
        valor_actual: pr.pujaActual,
        valor_nuevo: pr.pujaNueva,
      })
      if (!error) pujas += 1
      else if (error.code !== '23505') throw error
    }
  }

  // ---- presupuesto: últimos 7 días contra el presupuesto de hoy ----
  const desde7 = desplazar(hasta, -6)
  const { data: diario, error: eDiario } = await service.from('ads_rendimiento_diario').select('campaign_id, fecha, gasto, ventas').eq('perfil_id', cuenta.id).gte('fecha', desde7).lte('fecha', hasta).in('campaign_id', ids).limit(5000)
  if (eDiario) throw eDiario
  const g7 = new Map<string, { gasto: number; ventas: number; dias: Set<string> }>()
  for (const r of (diario ?? []) as Array<{ campaign_id: string; fecha: string; gasto: number; ventas: number }>) {
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
    for (const pr of proponerPresupuestos([{ campaignId: c.campaignId, campaignName: c.nombre, presupuesto: c.presupuesto, activa: true, gasto7: x.gasto, diasConDatos: x.dias.size, ventas7: x.ventas }], { acosObjetivoPct: o.acosObjetivoPct, subidaPct: ficha.subidaPresupuestoPct })) {
      const { error } = await service.from('ads_propuestas').insert({
        perfil_id: cuenta.id,
        tipo: 'presupuesto',
        asin: asinDeCampana(c.nombre),
        termino: c.nombre.slice(0, 300),
        campaign_id: c.campaignId,
        campaign_nombre: c.nombre,
        desde_rol: partesDeNombre(c.nombre)?.rol ?? null,
        motivo: pr.motivo,
        metricas: { clics: 0, gasto: pr.metricas.gasto, pedidos: 0, ventas: pr.metricas.ventas, acosPct: pr.metricas.acosPct, usoPct: pr.metricas.usoPct },
        valor_actual: pr.presupuestoActual,
        valor_nuevo: pr.presupuestoNuevo,
      })
      if (!error) presupuestos += 1
      else if (error.code !== '23505') throw error
    }
  }
  return { pujas, presupuestos }
}
