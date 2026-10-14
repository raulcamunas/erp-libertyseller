import { connectionCredentials } from '@/lib/amazon/data'
import { fetchListingsBySku } from '@/lib/amazon/sp-api'
import { AmazonApiError } from '@/lib/amazon/errors'
import { leerTramos } from '@/lib/auditor-stock/paralelo'
import { enviarSlack } from '@/lib/notificaciones/slack'
import { isMissingSchema } from '@/lib/plataforma/eventos'
import { createServiceClient } from '@/lib/supabase/service'
import { construirInforme, textoSlack, type EntradaVerificacion } from './verificacion-pura'
import { ventasDesde, ventasDeSku, type VentaSku } from './ventas-intervalo'

/**
 * VERIFICAR, A LOS 30 MINUTOS, QUE LO SUBIDO A AMAZON ESTÁ BIEN.
 * SOLO SERVIDOR. Solo LEE de Amazon: nunca corrige nada por su cuenta.
 *
 * Dos mitades:
 *
 *   programarVerificacion()  la llama el ciclo de sincronismo justo después de
 *                            enviar. Solo APUNTA una fila con la hora a la que
 *                            toca; no espera ni se queda dormida.
 *   ejecutarVencidas()       la llama una tarea cada pocos minutos. Recoge las
 *                            que ya han vencido, lee Amazon, compara, guarda el
 *                            informe y avisa a Slack.
 *
 * LA ESPERA ES UNA FILA, NO UN PROCESO. Un contenedor que se reinicia a las 3 de
 * la madrugada no puede dejar una verificación perdida: la fila sigue ahí y la
 * siguiente pasada la recoge.
 *
 * Las migraciones se lanzan a mano: sin la 225, todo esto es un no-hace-nada
 * silencioso y el ciclo de sincronismo sigue como siempre.
 */

const TRAMO = 100
const PRESUPUESTO_MS = 240_000
const MAX_FILAS_INFORME = 2000

/** ¿Hay que verificar a este cliente? Devuelve los minutos de espera, o null */
export async function minutosDeVerificacion(clientId: string): Promise<number | null> {
  const { data, error } = await createServiceClient()
    .from('stock_verificacion_clientes')
    .select('minutos, activo')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) {
    if (isMissingSchema(error)) return null
    throw error
  }
  const f = data as { minutos: number; activo: boolean } | null
  return f && f.activo ? f.minutos : null
}

/**
 * Apunta una verificación pendiente. NUNCA LANZA: que la verificación no se pueda
 * programar no puede estropear un envío que ya salió bien.
 */
export async function programarVerificacion(args: {
  clientId: string
  profileId: string | null
  connectionId: string
  marketplaceId: string
  batchId: string
  enviados: number
}): Promise<void> {
  try {
    const minutos = await minutosDeVerificacion(args.clientId)
    if (minutos === null || args.enviados <= 0) return
    const { error } = await createServiceClient()
      .from('stock_verificaciones')
      .insert({
        client_id: args.clientId,
        profile_id: args.profileId,
        connection_id: args.connectionId,
        marketplace_id: args.marketplaceId,
        batch_id: args.batchId,
        vence_at: new Date(Date.now() + minutos * 60_000).toISOString(),
        enviados: args.enviados,
      })
    if (error && !isMissingSchema(error)) console.warn('[verificacion] no se ha podido programar:', error.message)
  } catch (e) {
    console.warn('[verificacion] no se ha podido programar:', e instanceof Error ? e.message : e)
  }
}

interface FilaVerificacion {
  id: string
  client_id: string
  profile_id: string | null
  connection_id: string
  marketplace_id: string
  batch_id: string
}

/** Recoge las verificaciones vencidas y las hace una a una, hasta agotar el tiempo */
export async function ejecutarVencidas(): Promise<{ hechas: number; errores: number; pendientes: number }> {
  const service = createServiceClient()
  const inicio = Date.now()
  let hechas = 0
  let errores = 0

  // Una en curso desde hace más de 20 minutos es de un contenedor que murió: se vuelve a poner en cola
  await service
    .from('stock_verificaciones')
    .update({ estado: 'pendiente' })
    .eq('estado', 'en_curso')
    .lt('vence_at', new Date(Date.now() - 20 * 60_000).toISOString())

  for (;;) {
    if (Date.now() - inicio > PRESUPUESTO_MS) break

    const { data, error } = await service
      .from('stock_verificaciones')
      .select('id, client_id, profile_id, connection_id, marketplace_id, batch_id')
      .eq('estado', 'pendiente')
      .lte('vence_at', new Date().toISOString())
      .order('vence_at', { ascending: true })
      .limit(1)
    if (error) {
      if (isMissingSchema(error)) return { hechas: 0, errores: 0, pendientes: 0 }
      throw error
    }
    const fila = ((data ?? []) as FilaVerificacion[])[0]
    if (!fila) break

    // Se la queda UNA sola pasada: el update con el estado esperado es el candado
    const { data: tomada } = await service
      .from('stock_verificaciones')
      .update({ estado: 'en_curso' })
      .eq('id', fila.id)
      .eq('estado', 'pendiente')
      .select('id')
    if (!tomada || tomada.length === 0) continue

    try {
      await verificar(fila)
      hechas += 1
    } catch (e) {
      errores += 1
      const mensaje = e instanceof AmazonApiError ? e.humanMessage : e instanceof Error ? e.message : 'Error desconocido'
      await service
        .from('stock_verificaciones')
        .update({ estado: 'error', error: mensaje.slice(0, 500), verificada_at: new Date().toISOString() })
        .eq('id', fila.id)
      const aviso = await enviarSlack(`:x: No se ha podido verificar el stock subido (lote ${fila.batch_id.slice(0, 8)}): ${mensaje.slice(0, 300)}`)
      if (!aviso.ok) console.warn('[verificacion] Slack:', aviso.motivo)
    }
  }

  const { count } = await service
    .from('stock_verificaciones')
    .select('id', { count: 'exact', head: true })
    .in('estado', ['pendiente', 'en_curso'])
  return { hechas, errores, pendientes: count ?? 0 }
}

async function verificar(fila: FilaVerificacion): Promise<void> {
  const service = createServiceClient()

  // ---------- Lo que se envió, tal y como quedó apuntado ----------
  const { data: envios, error } = await service
    .from('amazon_submissions')
    .select('sku, previous_value, new_value, status, error_message, sent_at')
    .eq('batch_id', fila.batch_id)
    .eq('field', 'cantidad')
  if (error) throw error
  const enviados = (envios ?? []) as Array<{
    sku: string
    previous_value: string | null
    new_value: string
    status: string
    error_message: string | null
    sent_at: string | null
  }>
  if (enviados.length === 0) throw new Error('Este lote no tiene envíos de cantidad apuntados.')

  const aplicados = enviados.filter((e) => !['invalido', 'error', 'pendiente'].includes(e.status))
  const resueltas = await connectionCredentials(fila.connection_id)
  if (!resueltas) throw new Error('La conexión de Amazon de este cliente ya no existe.')
  const { credentials } = resueltas

  // ---------- Lo que Amazon tiene AHORA de esos SKU ----------
  const skus = aplicados.map((e) => e.sku)
  const tramos: string[][] = []
  for (let i = 0; i < skus.length; i += TRAMO) tramos.push(skus.slice(i, i + TRAMO))
  const ahora = new Map<string, number | null>()
  if (tramos.length > 0) {
    const lectura = await leerTramos(
      tramos.length,
      async (idx) => {
        const { items } = await fetchListingsBySku(credentials, {
          marketplaceId: fila.marketplace_id,
          skus: tramos[idx],
          incluir: ['summaries', 'fulfillmentAvailability'],
        })
        for (const it of items) ahora.set(it.sku, it.isFba ? null : it.quantity)
      },
      {
        concurrencia: 3,
        limiteMs: 150_000,
        mensajeDe: (e) => (e instanceof AmazonApiError ? e.humanMessage : e instanceof Error ? e.message : 'Error desconocido'),
      }
    )
    if (lectura.fallo !== null && ahora.size === 0) throw new Error(`No se ha podido leer Amazon: ${lectura.fallo}`)
  }

  // ---------- Lo vendido desde el envío ----------
  const primeraSalida = aplicados.map((e) => e.sent_at).filter((x): x is string => !!x).sort()[0]
  let ventas: VentaSku[] | null = null
  let notaVentas: string | null = null
  if (primeraSalida) {
    const v = await ventasDesde(credentials, fila.marketplace_id, primeraSalida)
    if (v.ok) ventas = v.ventas
    else notaVentas = v.motivo
  }

  // ---------- La comparación ----------
  const num = (t: string | null) => {
    if (t === null) return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  const entradas: EntradaVerificacion[] = enviados.map((e) => ({
    sku: e.sku,
    anterior: num(e.previous_value),
    enviado: num(e.new_value) ?? 0,
    actual: ahora.has(e.sku) ? (ahora.get(e.sku) ?? null) : null,
    ventas: ventas && e.sent_at ? ventasDeSku(ventas, e.sku, e.sent_at) : null,
    estadoEnvio: e.status,
    errorEnvio: e.error_message,
  }))
  const informe = construirInforme(entradas, { conVentas: ventas !== null, tope: MAX_FILAS_INFORME })

  // ---------- A quién y de qué cliente es ----------
  const [{ data: cli }, { data: perfil }, { data: cfg }] = await Promise.all([
    service.from('stock_clients').select('name').eq('id', fila.client_id).maybeSingle(),
    fila.profile_id
      ? service.from('stock_read_profiles').select('name').eq('id', fila.profile_id).maybeSingle()
      : Promise.resolve({ data: null }),
    service.from('stock_verificacion_clientes').select('minutos').eq('client_id', fila.client_id).maybeSingle(),
  ])
  const cliente = (cli as { name: string } | null)?.name ?? 'Cliente'
  const nombrePerfil = (perfil as { name: string } | null)?.name ?? 'sin nombre'
  const minutos = (cfg as { minutos: number } | null)?.minutos ?? 30

  const base = (process.env.ERP_PUBLIC_URL ?? '').trim().replace(/\/$/, '')
  let texto = textoSlack(informe, {
    cliente,
    perfil: nombrePerfil,
    minutos,
    enlace: base ? `${base}/dashboard/stock-sync` : null,
  })
  if (notaVentas) texto += `\n_Ventas: ${notaVentas}_`
  const aviso = await enviarSlack(texto)

  await service
    .from('stock_verificaciones')
    .update({
      estado: 'hecha',
      verificada_at: new Date().toISOString(),
      fallos: informe.fallos,
      resumen: { ...informe.porResultado, total: informe.total, conVentas: informe.conVentas, notaVentas },
      informe: informe.filas,
      slack: aviso.ok ? 'enviado' : aviso.motivo,
    })
    .eq('id', fila.id)
}
