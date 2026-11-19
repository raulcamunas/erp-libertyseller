import { createServiceClient } from '@/lib/supabase/service'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { connectionCredentials } from '@/lib/amazon/data'
import { spApiRequest } from '@/lib/amazon/sp-api'
import { AmazonApiError } from '@/lib/amazon/errors'
import { consultarInforme, descargarInforme } from '@/lib/plataforma/amazon/informes'
import { diasDe, filasDelInforme, sumarDias } from './calculo'

/**
 * LA LECTURA DEL TRÁFICO DE LOS CLIENTES CON ENLACE (proceso `trafico-cliente`). SOLO SERVIDOR. Solo LEE de Amazon.
 *
 * El informe de Ventas y tráfico de Seller Central (GET_SALES_AND_TRAFFIC_REPORT, por ASIN hijo) da el periodo ENTERO por ASIN, no día a día: para tener cada ASIN
 * cada día hay que pedir un informe por día. Así que, por cada cliente y país con un enlace activo:
 *   · se recogen los informes que Amazon ya ha terminado y se guardan (un día = todas sus filas, sustituyendo las anteriores);
 *   · se piden los días que faltan, del más reciente al más antiguo (al crear un enlace se rellena el histórico poco a poco: unos 30 días por hora);
 *   · los tres últimos días se vuelven a pedir una vez al día hasta que tienen 4 días de antigüedad: Amazon tarda en consolidar las sesiones.
 * Nunca espera a Amazon: pide y recoge en pasadas distintas. Un «límite de peticiones» de Amazon no es un error: se sigue en la pasada siguiente.
 */

const MAX_EN_COLA = 6
const MAX_PEDIDOS_POR_PASADA = 3
const ESPERA_MAXIMA_MS = 3 * 3_600_000
const REINTENTO_ERROR_MS = 3 * 3_600_000
const MAX_INTENTOS = 4
const RELEER_CADA_MS = 20 * 3_600_000
const DIAS_PROVISIONALES = 4

interface Fuente {
  client_id: string
  marketplace_id: string
  desde: string
}

interface Lectura {
  fecha: string
  estado: 'pedido' | 'hecho' | 'error'
  report_id: string | null
  pedido_at: string | null
  leido_at: string | null
  intentos: number
}

const hoyEnEspana = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())

/** Cada cliente y país con algún enlace activo, con el día más antiguo que piden sus enlaces */
export async function fuentesActivas(): Promise<Fuente[]> {
  // `*` y no las columnas: así vale con y sin la migración 323 (los enlaces del auditor de stock no se leen aquí)
  const { data, error } = await createServiceClient().from('trafico_enlaces').select('*').eq('activo', true)
  if (error) {
    if (isMissingSchema(error)) return []
    throw error
  }
  const por = new Map<string, Fuente>()
  for (const f of ((data ?? []) as Array<Fuente & { tipo?: string }>).filter((x) => (x.tipo ?? 'trafico') === 'trafico')) {
    const k = `${f.client_id}|${f.marketplace_id}`
    const ya = por.get(k)
    if (!ya || f.desde < ya.desde) por.set(k, f)
  }
  return [...por.values()]
}

/** Qué días hay que pedir ahora, del más reciente al más antiguo. Puro, para probarlo */
export function diasAPedir(desde: string, ayer: string, lecturas: readonly Lectura[], ahora: number): string[] {
  const por = new Map(lecturas.map((l) => [l.fecha, l]))
  const salida: string[] = []
  for (const dia of diasDe(desde, ayer).reverse()) {
    const l = por.get(dia)
    if (!l) salida.push(dia)
    else if (l.estado === 'error' && l.intentos < MAX_INTENTOS && (!l.pedido_at || ahora - Date.parse(l.pedido_at) > REINTENTO_ERROR_MS)) salida.push(dia)
    else if (l.estado === 'hecho' && dia >= sumarDias(ayer, -(DIAS_PROVISIONALES - 1)) && l.leido_at && ahora - Date.parse(l.leido_at) > RELEER_CADA_MS && l.leido_at < `${sumarDias(dia, DIAS_PROVISIONALES)}T00:00:00Z`) salida.push(dia)
  }
  return salida
}

async function conexionDe(f: Fuente): Promise<string | null> {
  const { data } = await createServiceClient().from('amazon_connections').select('id, marketplace_ids').eq('client_id', f.client_id).eq('is_active', true)
  const lista = (data ?? []) as Array<{ id: string; marketplace_ids: string[] | null }>
  return (lista.find((c) => (c.marketplace_ids ?? []).includes(f.marketplace_id)) ?? lista[0])?.id ?? null
}

const textoDeError = (err: unknown): string =>
  err instanceof AmazonApiError && err.kind === 'permisos'
    ? 'Sin acceso al informe de Ventas y tráfico: a la app de Amazon del ERP le falta el rol de análisis de marca.'
    : err instanceof AmazonApiError
      ? err.humanMessage
      : err instanceof Error
        ? err.message
        : String(err)

export interface ResultadoDePaso {
  guardados: number
  pedidos: number
  errores: string[]
  faltan: number
}

export async function pasoDeLectura(f: Fuente, hastaMs: number): Promise<ResultadoDePaso> {
  const service = createServiceClient()
  const r: ResultadoDePaso = { guardados: 0, pedidos: 0, errores: [], faltan: 0 }
  const conexion = await conexionDe(f)
  if (!conexion) return { ...r, errores: ['el cliente no tiene una cuenta de vendedor conectada'] }
  const resuelta = await connectionCredentials(conexion)
  if (!resuelta) return { ...r, errores: ['no se han podido abrir las credenciales de Amazon'] }
  const creds = resuelta.credentials
  const clave = { client_id: f.client_id, marketplace_id: f.marketplace_id }

  const { data, error } = await service.from('trafico_lecturas').select('fecha, estado, report_id, pedido_at, leido_at, intentos').eq('client_id', f.client_id).eq('marketplace_id', f.marketplace_id).gte('fecha', f.desde).limit(5000)
  if (error) throw error
  const lecturas = (data ?? []) as Lectura[]

  // 1. Recoger lo que Amazon ya ha terminado
  for (const l of lecturas.filter((x) => x.estado === 'pedido' && x.report_id)) {
    if (Date.now() > hastaMs) break
    try {
      if (l.pedido_at && Date.now() - Date.parse(l.pedido_at) > ESPERA_MAXIMA_MS) {
        await service.from('trafico_lecturas').update({ estado: 'error', error: 'Amazon tardó más de tres horas en preparar el informe.' }).match({ ...clave, fecha: l.fecha })
        l.estado = 'error'
        continue
      }
      const estado = await consultarInforme(creds, l.report_id as string)
      if (estado.estado === 'FATAL' || estado.estado === 'CANCELLED') {
        await service.from('trafico_lecturas').update({ estado: 'error', error: `Amazon no ha podido generar el informe (${estado.estado}).` }).match({ ...clave, fecha: l.fecha })
        l.estado = 'error'
        continue
      }
      if (estado.estado !== 'DONE' || !estado.documentId) continue
      const doc = await descargarInforme(creds, estado.documentId)
      const filas = filasDelInforme(JSON.parse(doc.texto))
      const ahora = new Date().toISOString()
      const { error: eBorrar } = await service.from('trafico_diario').delete().match({ ...clave, fecha: l.fecha })
      if (eBorrar) throw eBorrar
      if (filas.length > 0) {
        const { error: eIns } = await service.from('trafico_diario').insert(
          filas.map((x) => ({
            ...clave,
            fecha: l.fecha,
            asin: x.asin,
            parent_asin: x.parent,
            sesiones: Math.round(x.sesiones),
            sesiones_navegador: Math.round(x.navegador),
            sesiones_app: Math.round(x.app),
            visitas: Math.round(x.visitas),
            visitas_buybox: Number(x.visitasBB.toFixed(4)),
            unidades: Math.round(x.unidades),
            pedidos: Math.round(x.pedidos),
            ventas: Number(x.ventas.toFixed(2)),
            moneda: x.moneda,
            leido_at: ahora,
          }))
        )
        if (eIns) throw eIns
      }
      await service.from('trafico_lecturas').update({ estado: 'hecho', leido_at: ahora, error: null, intentos: 0 }).match({ ...clave, fecha: l.fecha })
      l.estado = 'hecho'
      l.leido_at = ahora
      r.guardados += 1
    } catch (err) {
      if (err instanceof AmazonApiError && err.kind === 'limite') break
      r.errores.push(`${l.fecha}: ${textoDeError(err).slice(0, 120)}`)
    }
  }

  // 2. Pedir los días que faltan (sin pasar de MAX_EN_COLA esperando a la vez)
  const ayer = sumarDias(hoyEnEspana(), -1)
  const toca = diasAPedir(f.desde, ayer, lecturas, Date.now())
  r.faltan = toca.length
  let enCola = lecturas.filter((x) => x.estado === 'pedido').length
  for (const dia of toca) {
    if (enCola >= MAX_EN_COLA || r.pedidos >= MAX_PEDIDOS_POR_PASADA || Date.now() > hastaMs) break
    const previa = lecturas.find((x) => x.fecha === dia)
    try {
      const { data: rep } = await spApiRequest<{ reportId?: string }>(creds, 'createReport', {
        method: 'POST',
        path: '/reports/2021-06-30/reports',
        body: { reportType: 'GET_SALES_AND_TRAFFIC_REPORT', marketplaceIds: [f.marketplace_id], dataStartTime: `${dia}T00:00:00Z`, dataEndTime: `${dia}T23:59:59Z`, reportOptions: { dateGranularity: 'DAY', asinGranularity: 'CHILD' } },
        repeatable: false,
        maxAttempts: 1,
      })
      if (!rep.reportId) throw new Error('Amazon ha aceptado el informe pero no ha dado su identificador.')
      // Un día ya leído que se vuelve a pedir sigue enseñando lo de antes mientras tanto (sus filas no se borran hasta tener las nuevas)
      await service.from('trafico_lecturas').upsert({ ...clave, fecha: dia, estado: 'pedido', report_id: rep.reportId, pedido_at: new Date().toISOString(), intentos: (previa?.intentos ?? 0) + (previa?.estado === 'error' ? 1 : 0), error: null, leido_at: previa?.leido_at ?? null }, { onConflict: 'client_id,marketplace_id,fecha' })
      r.pedidos += 1
      enCola += 1
    } catch (err) {
      if (err instanceof AmazonApiError && err.kind === 'limite') break
      const texto = textoDeError(err).slice(0, 500)
      await service.from('trafico_lecturas').upsert({ ...clave, fecha: dia, estado: previa?.estado === 'hecho' ? 'hecho' : 'error', report_id: null, pedido_at: new Date().toISOString(), intentos: (previa?.intentos ?? 0) + 1, error: texto, leido_at: previa?.leido_at ?? null }, { onConflict: 'client_id,marketplace_id,fecha' })
      r.errores.push(`${dia}: ${texto.slice(0, 120)}`)
      // Si es de permisos o de credenciales, todos los días fallarán igual: no se sigue
      if (err instanceof AmazonApiError && (err.kind === 'permisos' || err.kind === 'auth')) break
    }
  }
  return r
}

/** ¿Hay algo que hacer? (barato: solo la base) */
export async function hayLecturaPendiente(): Promise<boolean> {
  const fuentes = await fuentesActivas()
  if (fuentes.length === 0) return false
  const ayer = sumarDias(hoyEnEspana(), -1)
  for (const f of fuentes) {
    const { data } = await createServiceClient().from('trafico_lecturas').select('fecha, estado, report_id, pedido_at, leido_at, intentos').eq('client_id', f.client_id).eq('marketplace_id', f.marketplace_id).gte('fecha', f.desde).limit(5000)
    const lecturas = (data ?? []) as Lectura[]
    if (lecturas.some((l) => l.estado === 'pedido') || diasAPedir(f.desde, ayer, lecturas, Date.now()).length > 0) return true
  }
  return false
}
