import { createServiceClient } from '@/lib/supabase/service'
import {
  CONFIG_ALERTAS_POR_DEFECTO,
  UMBRALES_ALERTAS,
  FAMILIA_DE_TIPO,
  calcularAlertas,
  planearAlertas,
  plazoValido,
  type AlertaFba,
  type ConfigAlertas,
  type EnvioParaAlertas,
  type FilaDeAlerta,
  type Severidad,
  type VentasDelAnoPasado,
} from './alertas'
import { FALTA_LA_MIGRACION_267 } from './alertas-mensajes'
import { enviosDelCliente, inventarioDeCliente } from './inventario-datos'
import { sumarDiasInv } from './inventario'
import { leerTodo } from './paginar'
import { faltaLaTabla } from './planificacion'

/**
 * LEER LA BASE, CALCULAR LAS ALERTAS DE UN CLIENTE Y ESCRIBIRLAS — SOLO SERVIDOR.
 * ===============================================================================
 * Aquí no se decide qué merece una alerta: eso está en alertas.ts (puro, con pruebas). Aquí se junta lo que hace falta —el inventario del
 * cliente, sus envíos con el momento del último cambio, las ventas del año pasado, los ajustes de inventario recientes y qué listings no son
 * comprables—, se llama al motor y se guarda lo que salga, comparándolo con lo que ya había.
 *
 * NADA DE ESTO ESCRIBE EN AMAZON. Solo lee de la base del ERP (que ya se alimenta del libro mayor y del catálogo) y escribe en las tablas de
 * alertas (migración 267) y en la campana.
 *
 * SIN LA MIGRACIÓN 267 las tablas no existen: se dice (`faltaMigracion`) y no se rompe nada. Las alertas se calculan igual a demanda.
 */

type Servicio = ReturnType<typeof createServiceClient>

export { FALTA_LA_MIGRACION_267 }

const MARKETPLACE_ESPANA = 'A1RKKUPIHCS9HS'

/* ------------------------------------------------------------------ */
/* La configuración: el plazo lo pone el equipo                        */
/* ------------------------------------------------------------------ */

export interface ConfigDeCliente extends ConfigAlertas {
  /** false = se calculan y se ven las alertas pero no suena la campana */
  avisar: boolean
}

export async function leerConfigAlertas(service: Servicio, clienteId: string): Promise<{ config: ConfigDeCliente; faltaMigracion: boolean }> {
  const porDefecto: ConfigDeCliente = { ...CONFIG_ALERTAS_POR_DEFECTO, plazoPorSku: {}, avisar: true }
  const { data, error } = await service
    .from('fba_alertas_config')
    .select('plazo_reposicion_dias, antelacion_dias, avisar')
    .eq('client_id', clienteId)
    .maybeSingle()
  if (error) {
    if (faltaLaTabla(error)) return { config: porDefecto, faltaMigracion: true }
    throw error
  }
  const { data: filasSku, error: errorSku } = await service
    .from('fba_alertas_plazo_sku')
    .select('sku, plazo_reposicion_dias')
    .eq('client_id', clienteId)
  if (errorSku && !faltaLaTabla(errorSku)) throw errorSku
  const plazoPorSku: Record<string, number> = {}
  for (const f of (filasSku ?? []) as Array<{ sku: string; plazo_reposicion_dias: number }>) {
    const p = plazoValido(f.plazo_reposicion_dias)
    if (p !== null) plazoPorSku[f.sku] = p
  }
  if (!data) return { config: { ...porDefecto, plazoPorSku }, faltaMigracion: false }
  const fila = data as { plazo_reposicion_dias: number; antelacion_dias: number; avisar: boolean }
  return {
    config: {
      plazoDias: plazoValido(fila.plazo_reposicion_dias) ?? porDefecto.plazoDias,
      plazoConfigurado: true,
      antelacionDias: Math.min(120, Math.max(0, Math.round(fila.antelacion_dias ?? porDefecto.antelacionDias))),
      plazoPorSku,
      avisar: fila.avisar !== false,
    },
    faltaMigracion: false,
  }
}

/* ------------------------------------------------------------------ */
/* Lo que se lee para calcular                                         */
/* ------------------------------------------------------------------ */

/** Cuándo se VIO por última vez un cambio en cada envío (migración 224). Sin la tabla, vacío: el motor cae a la fecha de envío */
async function ultimosCambios(service: Servicio, remesaIds: readonly string[]): Promise<Map<string, string>> {
  const salida = new Map<string, string>()
  for (let i = 0; i < remesaIds.length; i += 100) {
    const trozo = remesaIds.slice(i, i + 100)
    try {
      const filas = await leerTodo<{ remesa_id: string; visto_at: string }>((a, b) =>
        service
          .from('fba_remesa_eventos')
          .select('remesa_id, visto_at')
          .in('remesa_id', trozo)
          .order('visto_at', { ascending: true })
          .order('id', { ascending: true })
          .range(a, b)
      )
      for (const f of filas) {
        const previo = salida.get(f.remesa_id)
        if (!previo || f.visto_at > previo) salida.set(f.remesa_id, f.visto_at)
      }
    } catch (e) {
      if (!faltaLaTabla(e as { code?: string })) throw e
      return salida
    }
  }
  return salida
}

/** Las ventas del tramo de hace un año que interesa para la estacionalidad: sku → fecha → unidades */
async function ventasDelAnoPasado(service: Servicio, conexion: string, mercado: string, hoy: string, horizonteMax: number): Promise<VentasDelAnoPasado> {
  const base = sumarDiasInv(hoy, -365)
  const desde = sumarDiasInv(base, -UMBRALES_ALERTAS.estacional.diasPrevios)
  const hasta = sumarDiasInv(base, horizonteMax)
  const filas = await leerTodo<{ sku: string; fecha: string; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('sku, fecha, cantidad')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .eq('tipo', 'Shipments')
      .gte('fecha', desde)
      .lt('fecha', hasta)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )
  const salida: VentasDelAnoPasado = {}
  for (const f of filas) {
    const porDia = (salida[f.sku] ??= {})
    porDia[f.fecha] = (porDia[f.fecha] ?? 0) + Math.abs(f.cantidad)
  }
  return salida
}

/** Los ajustes de inventario de los últimos días, en neto por referencia (negativo = Amazon dio de baja unidades) */
async function ajustesRecientes(service: Servicio, conexion: string, mercado: string, hoy: string): Promise<Array<{ sku: string; neto: number }>> {
  const desde = sumarDiasInv(hoy, -UMBRALES_ALERTAS.perdidas.ventanaDias)
  const filas = await leerTodo<{ sku: string; cantidad: number }>((a, b) =>
    service
      .from('fba_movimientos')
      .select('sku, cantidad')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .eq('tipo', 'Adjustments')
      .gte('fecha', desde)
      .order('fecha', { ascending: true })
      .order('id', { ascending: true })
      .range(a, b)
  )
  const neto = new Map<string, number>()
  for (const f of filas) neto.set(f.sku, (neto.get(f.sku) ?? 0) + f.cantidad)
  return [...neto.entries()].map(([sku, n]) => ({ sku, neto: n }))
}

/**
 * Los SKU con stock y ventas cuyo listing NO figura como comprable.
 *
 * SOLO SE AFIRMA SI EL DATO EXISTE: si ningún listing del cliente trae el estado BUYABLE, es que el catálogo todavía no ha guardado el estado
 * (o este cliente no lo expone) y acusar a todos de «no comprable» sería una avalancha de falsas alarmas.
 */
async function noComprables(service: Servicio, conexion: string, mercado: string, skus: readonly string[]): Promise<string[]> {
  if (skus.length === 0) return []
  const { count, error } = await service
    .from('amazon_listings')
    .select('sku', { count: 'exact', head: true })
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .contains('listing_status', ['BUYABLE'])
  if (error || !count) return []

  const malos: string[] = []
  for (let i = 0; i < skus.length; i += 150) {
    const { data, error: e } = await service
      .from('amazon_listings')
      .select('sku, listing_status')
      .eq('connection_id', conexion)
      .eq('marketplace_id', mercado)
      .in('sku', skus.slice(i, i + 150))
    if (e) return []
    for (const f of (data ?? []) as Array<{ sku: string; listing_status: string[] | null }>) {
      if (!(f.listing_status ?? []).includes('BUYABLE')) malos.push(f.sku)
    }
  }
  return malos
}

/* ------------------------------------------------------------------ */
/* Calcular                                                            */
/* ------------------------------------------------------------------ */

export interface ResultadoDeCalculo {
  conectado: boolean
  alertas: AlertaFba[]
  /** false = alguna lectura falló y NO se debe dar por resuelta ninguna alerta */
  completo: boolean
  /** Por qué no se pudo calcular, o aviso de que se calculó a medias */
  error: string | null
  config: ConfigDeCliente
  faltaMigracion: boolean
}

/** Las alertas de un cliente, calculadas ahora mismo con lo que hay en la base. No escribe nada */
export async function calcularAlertasDeCliente(service: Servicio, clienteId: string, hoy: string): Promise<ResultadoDeCalculo> {
  const { config, faltaMigracion } = await leerConfigAlertas(service, clienteId)
  const inv = await inventarioDeCliente(clienteId, { hoy })
  if (!inv.conectado) return { conectado: false, alertas: [], completo: false, error: 'El cliente no tiene una conexión de Amazon activa', config, faltaMigracion }

  const envios = await enviosDelCliente(service, clienteId)
  const cambios = await ultimosCambios(service, envios.map((e) => e.id))
  const enviosAlertas: EnvioParaAlertas[] = envios.map((e) => ({ ...e, ultimoCambioAt: cambios.get(e.id) ?? null }))

  let completo = true
  const errores: string[] = []
  const conexion = inv.conexionId
  const mercado = inv.marketplaceId ?? MARKETPLACE_ESPANA

  let ventasAnoPasado: VentasDelAnoPasado | undefined
  let ajustes: Array<{ sku: string; neto: number }> | undefined
  let sinComprar: string[] | undefined
  if (conexion) {
    const horizonteMax = Math.max(config.plazoDias, ...Object.values(config.plazoPorSku)) + config.antelacionDias
    try {
      ventasAnoPasado = await ventasDelAnoPasado(service, conexion, mercado, hoy, horizonteMax)
    } catch (e) {
      // Sin estacionalidad el cálculo sigue valiendo (solo se queda sin el ajuste que SUBE el ritmo): no se da por incompleto
      errores.push(`estacionalidad: ${mensaje(e)}`)
    }
    try {
      ajustes = await ajustesRecientes(service, conexion, mercado, hoy)
    } catch (e) {
      completo = false
      errores.push(`ajustes: ${mensaje(e)}`)
    }
    try {
      const candidatos = inv.skus.filter((s) => s.vendibles > 0 && s.vendidas.d90 > 0).map((s) => s.sku)
      sinComprar = await noComprables(service, conexion, mercado, candidatos)
    } catch (e) {
      completo = false
      errores.push(`listings: ${mensaje(e)}`)
    }
  }

  const alertas = calcularAlertas({ hoy, inventario: inv, envios: enviosAlertas, config, ventasAnoPasado, noComprables: sinComprar, ajustesRecientes: ajustes })
  // Una lectura del libro que va atrasada (o sin leer) no es un fallo del cálculo, pero sí obliga a no cerrar nada: faltan ventas
  if (inv.libro === 'sin_leer') {
    completo = false
    errores.push('el libro mayor de Amazon no se ha leído todavía')
  }
  return { conectado: true, alertas, completo, error: errores.length > 0 ? errores.join(' · ') : null, config, faltaMigracion }
}

const mensaje = (e: unknown): string => (e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160))

/* ------------------------------------------------------------------ */
/* Guardar                                                             */
/* ------------------------------------------------------------------ */

export interface ResultadoDeGuardado {
  nuevas: number
  actualizadas: number
  resueltas: number
  /** Las que merecen aviso en la campana (críticas o altas nuevas o que han empeorado) */
  avisar: AlertaFba[]
  faltaMigracion: boolean
}

const TROZO = 150

/** Escribe lo calculado: crea, actualiza y cierra. NO avisa: devuelve qué merece aviso para que quien llama lo haga y luego lo marque (`marcarAvisadas`) */
export async function guardarAlertas(service: Servicio, clienteId: string, alertas: readonly AlertaFba[], hoy: string, completo: boolean): Promise<ResultadoDeGuardado> {
  const { data, error } = await service
    .from('fba_alertas')
    .select('clave, estado, severidad, silenciada_hasta, severidad_avisada')
    .eq('client_id', clienteId)
  if (error) {
    if (faltaLaTabla(error)) return { nuevas: 0, actualizadas: 0, resueltas: 0, avisar: [], faltaMigracion: true }
    throw error
  }
  const guardadas: FilaDeAlerta[] = ((data ?? []) as Array<{ clave: string; estado: FilaDeAlerta['estado']; severidad: Severidad; silenciada_hasta: string | null; severidad_avisada: Severidad | null }>).map(
    (f) => ({ clave: f.clave, estado: f.estado, severidad: f.severidad, silenciadaHasta: f.silenciada_hasta, severidadAvisada: f.severidad_avisada })
  )
  const plan = planearAlertas(guardadas, alertas, hoy, completo)
  const ahora = new Date().toISOString()

  const filas = plan.escribir.map(({ alerta: a, estado, nueva, reabierta }) => ({
    client_id: clienteId,
    clave: a.clave,
    tipo: a.tipo,
    severidad: a.severidad,
    sku: a.sku,
    remesa_id: a.remesaId,
    titulo: a.titulo,
    detalle: a.detalle,
    impacto: Math.round(a.impacto * 100) / 100,
    datos: a.datos,
    estado,
    ultima_vez_at: ahora,
    ...(nueva || reabierta ? { primera_vez_at: ahora, resuelta_at: null } : {}),
    // Una silenciada que ya cumplió su fecha vuelve a estar abierta y sin fecha; una que sigue silenciada conserva la suya
    ...(estado === 'abierta' ? { silenciada_hasta: null } : {}),
  }))
  for (let i = 0; i < filas.length; i += TROZO) {
    const { error: e } = await service.from('fba_alertas').upsert(filas.slice(i, i + TROZO), { onConflict: 'client_id,clave' })
    if (e) throw e
  }
  for (let i = 0; i < plan.resolver.length; i += TROZO) {
    const { error: e } = await service
      .from('fba_alertas')
      .update({ estado: 'resuelta', resuelta_at: ahora })
      .eq('client_id', clienteId)
      .in('clave', plan.resolver.slice(i, i + TROZO))
    if (e) throw e
  }
  return {
    nuevas: plan.escribir.filter((x) => x.nueva).length,
    actualizadas: plan.escribir.filter((x) => !x.nueva).length,
    resueltas: plan.resolver.length,
    avisar: plan.avisar,
    faltaMigracion: false,
  }
}

/** Anota que estas alertas ya se avisaron, con la gravedad con que se avisó: solo se vuelve a avisar si empeoran */
export async function marcarAvisadas(service: Servicio, clienteId: string, alertas: readonly AlertaFba[]): Promise<void> {
  const ahora = new Date().toISOString()
  const porSeveridad = new Map<Severidad, string[]>()
  for (const a of alertas) porSeveridad.set(a.severidad, [...(porSeveridad.get(a.severidad) ?? []), a.clave])
  for (const [severidad, claves] of porSeveridad) {
    for (let i = 0; i < claves.length; i += TROZO) {
      const { error } = await service
        .from('fba_alertas')
        .update({ severidad_avisada: severidad, avisada_at: ahora })
        .eq('client_id', clienteId)
        .in('clave', claves.slice(i, i + TROZO))
      if (error) throw error
    }
  }
}

export async function anotarEstado(service: Servicio, clienteId: string, estado: { error: string | null; abiertas: number }): Promise<void> {
  const { error } = await service
    .from('fba_alertas_estado')
    .upsert({ client_id: clienteId, calculado_at: new Date().toISOString(), error: estado.error, abiertas: estado.abiertas }, { onConflict: 'client_id' })
  if (error && !faltaLaTabla(error)) throw error
}

/* ------------------------------------------------------------------ */
/* La campana                                                          */
/* ------------------------------------------------------------------ */

/** Quién recibe los avisos de un cliente: toda la agencia con acceso a él y los administradores. Nunca el cliente de fuera */
export async function destinatariosDe(service: Servicio, clienteId: string): Promise<string[]> {
  const ids = new Set<string>()
  const { data: admins } = await service.from('profiles').select('id').eq('role', 'admin')
  for (const a of (admins ?? []) as Array<{ id: string }>) ids.add(a.id)
  const { data: accesos } = await service.from('fba_accesos').select('user_id').eq('client_id', clienteId)
  const conAcceso = ((accesos ?? []) as Array<{ user_id: string }>).map((a) => a.user_id)
  if (conAcceso.length > 0) {
    const { data: perfiles } = await service.from('profiles').select('id, role').in('id', conAcceso)
    for (const p of (perfiles ?? []) as Array<{ id: string; role: string }>) if (p.role !== 'cliente') ids.add(p.id)
  }
  return [...ids]
}

/** Cuántas alertas individuales como mucho antes de juntarlas en un solo aviso: la primera pasada de un cliente trae decenas */
export const MAX_AVISOS_SUELTOS = 3

const recortar = (t: string, max: number): string => (t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t)

export interface AvisoDeCampana {
  titulo: string
  mensaje: string
  clave: string
  datos: Record<string, unknown>
}

/** Los avisos de campana de una tanda de alertas de UN cliente: una por alerta, o un resumen si son muchas */
export function avisosDeUnCliente(clienteId: string, clienteNombre: string, alertas: readonly AlertaFba[], hoy: string): AvisoDeCampana[] {
  if (alertas.length === 0) return []
  if (alertas.length <= MAX_AVISOS_SUELTOS) {
    return alertas.map((a) => ({
      titulo: recortar(`${clienteNombre}: ${a.titulo}`, 100),
      mensaje: recortar(a.detalle, 260),
      clave: `fba:${clienteId}:${a.clave}:${a.severidad}:${hoy}`,
      datos: { clienteId, alerta: a.clave, tipo: a.tipo, severidad: a.severidad, sku: a.sku },
    }))
  }
  const criticas = alertas.filter((a) => a.severidad === 'critica').length
  const porFamilia = new Map<string, number>()
  for (const a of alertas) {
    const f = FAMILIA_DE_TIPO[a.tipo]
    porFamilia.set(f, (porFamilia.get(f) ?? 0) + 1)
  }
  const partes = [...porFamilia.entries()].map(([f, n]) => `${n} de ${f === 'reposicion' ? 'reposición' : f === 'envios' ? 'envíos' : f === 'cuadre' ? 'cuadre' : f === 'parado' ? 'stock parado' : 'ventas'}`)
  return [
    {
      titulo: recortar(`${clienteNombre}: ${alertas.length} alertas FBA graves`, 100),
      mensaje: recortar(`${criticas > 0 ? `${criticas} crítica${criticas === 1 ? '' : 's'}. ` : ''}${partes.join(', ')}. Ábrelas en Alertas FBA.`, 260),
      clave: `fba:${clienteId}:resumen:${hoy}`,
      datos: { clienteId, tipo: 'resumen', severidad: criticas > 0 ? 'critica' : 'alta' },
    },
  ]
}

/** Escribe avisos en la campana de cada destinatario. Devuelve si la base los rechazó por falta de la migración */
export async function escribirAvisosFba(service: Servicio, destinatarios: readonly string[], avisos: readonly AvisoDeCampana[], tipo: 'fba_alerta' | 'fba_resumen' = 'fba_alerta'): Promise<{ faltaMigracion: boolean }> {
  if (destinatarios.length === 0 || avisos.length === 0) return { faltaMigracion: false }
  const filas = destinatarios.flatMap((userId) =>
    avisos.map((a) => ({ user_id: userId, type: tipo, title: a.titulo, message: a.mensaje, clave: a.clave, datos: a.datos }))
  )
  for (let i = 0; i < filas.length; i += TROZO) {
    const { error } = await service.from('notifications').upsert(filas.slice(i, i + TROZO), { onConflict: 'user_id,clave', ignoreDuplicates: true })
    if (error) {
      // 23514: el tipo no está en la restricción; 42703/PGRST204: falta la columna clave; 42P10: falta su índice
      if (['23514', '42703', 'PGRST204', '42P10'].includes(error.code ?? '')) return { faltaMigracion: true }
      throw error
    }
  }
  return { faltaMigracion: false }
}

/* ------------------------------------------------------------------ */
/* Una pasada entera sobre un cliente                                  */
/* ------------------------------------------------------------------ */

export interface ResumenDePasada {
  cliente: string
  conectado: boolean
  nuevas: number
  resueltas: number
  abiertas: number
  avisadas: number
  error: string | null
  faltaMigracion: boolean
}

/**
 * Calcula, guarda y avisa por un cliente. Es lo que hacen la pasada diaria y el botón «Recalcular»: la misma ruta para las dos, para que lo
 * que se ve al pulsar sea exactamente lo que haría la pasada de la noche.
 */
export async function pasadaDeCliente(service: Servicio, cliente: { id: string; nombre: string }, hoy: string, opciones: { avisar?: boolean } = {}): Promise<ResumenDePasada> {
  const vacio: ResumenDePasada = { cliente: cliente.nombre, conectado: true, nuevas: 0, resueltas: 0, abiertas: 0, avisadas: 0, error: null, faltaMigracion: false }
  let calculo: ResultadoDeCalculo
  try {
    calculo = await calcularAlertasDeCliente(service, cliente.id, hoy)
  } catch (e) {
    const error = mensaje(e)
    await anotarEstado(service, cliente.id, { error, abiertas: 0 }).catch(() => undefined)
    return { ...vacio, error }
  }
  if (!calculo.conectado) {
    await anotarEstado(service, cliente.id, { error: calculo.error, abiertas: 0 }).catch(() => undefined)
    return { ...vacio, conectado: false, error: calculo.error }
  }

  const guardado = await guardarAlertas(service, cliente.id, calculo.alertas, hoy, calculo.completo)
  if (guardado.faltaMigracion) return { ...vacio, faltaMigracion: true, error: FALTA_LA_MIGRACION_267 }

  // A quién y de qué se avisa: nada si el cliente está en silencio; sin plazo configurado, tampoco de «reponer ya» (depende de un número inventado)
  let avisadas = 0
  if ((opciones.avisar ?? true) && calculo.config.avisar) {
    const merecen = guardado.avisar.filter((a) => calculo.config.plazoConfigurado || a.tipo !== 'reponer_ya')
    if (merecen.length > 0) {
      const destinatarios = await destinatariosDe(service, cliente.id)
      const r = await escribirAvisosFba(service, destinatarios, avisosDeUnCliente(cliente.id, cliente.nombre, merecen, hoy))
      // Solo se marcan como avisadas si la campana las ha recibido: si falta la migración, se vuelve a intentar la próxima vez
      if (!r.faltaMigracion) {
        await marcarAvisadas(service, cliente.id, merecen)
        avisadas = merecen.length
      }
    }
  }

  const { count } = await service.from('fba_alertas').select('id', { count: 'exact', head: true }).eq('client_id', cliente.id).eq('estado', 'abierta')
  const abiertas = count ?? 0
  await anotarEstado(service, cliente.id, { error: calculo.error, abiertas })
  return { ...vacio, nuevas: guardado.nuevas, resueltas: guardado.resueltas, abiertas, avisadas, error: calculo.error }
}

/* ------------------------------------------------------------------ */
/* El resumen del lunes                                                */
/* ------------------------------------------------------------------ */

/** ¿Es lunes ese día? ('YYYY-MM-DD') */
export const esLunes = (hoy: string): boolean => new Date(`${hoy}T12:00:00Z`).getUTCDay() === 1

/**
 * El resumen semanal en la campana de cada persona de la agencia: cuántas alertas graves tiene abiertas en SUS clientes. Una sola vez por
 * lunes y persona (la clave lleva la fecha). El detalle está en la pantalla «Alertas FBA → Resumen semanal», que se puede imprimir.
 */
export async function avisarResumenSemanal(service: Servicio, hoy: string): Promise<{ avisados: number; faltaMigracion: boolean }> {
  const { data, error } = await service.from('fba_alertas').select('client_id, severidad, tipo').eq('estado', 'abierta')
  if (error) {
    if (faltaLaTabla(error)) return { avisados: 0, faltaMigracion: true }
    throw error
  }
  const filas = (data ?? []) as Array<{ client_id: string; severidad: Severidad; tipo: string }>
  if (filas.length === 0) return { avisados: 0, faltaMigracion: false }

  const { data: admins } = await service.from('profiles').select('id').eq('role', 'admin')
  const { data: accesos } = await service.from('fba_accesos').select('user_id, client_id')
  const ids = new Set(filas.map((f) => f.client_id))
  const porUsuario = new Map<string, Set<string>>()
  for (const a of (admins ?? []) as Array<{ id: string }>) porUsuario.set(a.id, new Set(ids))
  const conAcceso = [...new Set(((accesos ?? []) as Array<{ user_id: string }>).map((a) => a.user_id))]
  if (conAcceso.length > 0) {
    const { data: perfiles } = await service.from('profiles').select('id, role').in('id', conAcceso)
    const agencia = new Set(((perfiles ?? []) as Array<{ id: string; role: string }>).filter((p) => p.role !== 'cliente').map((p) => p.id))
    for (const a of (accesos ?? []) as Array<{ user_id: string; client_id: string }>) {
      if (!agencia.has(a.user_id) || !ids.has(a.client_id)) continue
      if (!porUsuario.has(a.user_id)) porUsuario.set(a.user_id, new Set())
      porUsuario.get(a.user_id)!.add(a.client_id)
    }
  }

  let avisados = 0
  for (const [usuario, clientes] of porUsuario) {
    const suyas = filas.filter((f) => clientes.has(f.client_id))
    const criticas = suyas.filter((f) => f.severidad === 'critica').length
    const altas = suyas.filter((f) => f.severidad === 'alta').length
    if (criticas + altas === 0) continue
    const quienes = new Set(suyas.filter((f) => f.severidad === 'critica' || f.severidad === 'alta').map((f) => f.client_id)).size
    const r = await escribirAvisosFba(
      service,
      [usuario],
      [
        {
          titulo: 'Resumen FBA de la semana',
          mensaje: `${criticas} crítica${criticas === 1 ? '' : 's'} y ${altas} alta${altas === 1 ? '' : 's'} en ${quienes} cliente${quienes === 1 ? '' : 's'}. Ábrelo en Alertas FBA → Resumen semanal.`,
          clave: `fba-resumen:${hoy}`,
          datos: { tipo: 'resumen_semanal', criticas, altas },
        },
      ],
      'fba_resumen'
    )
    if (r.faltaMigracion) return { avisados, faltaMigracion: true }
    avisados += 1
  }
  return { avisados, faltaMigracion: false }
}
