import { type AmazonCredentials } from '@/lib/amazon/sp-api'
import { consultarInforme, descargarInforme, pedirInforme } from '@/lib/plataforma/amazon/informes'
import { createServiceClient } from '@/lib/supabase/service'
import { INFORME_PLANIFICACION, faltaLaTabla, parsearPlanificacion, type FilaPlanificacion, type ResultadoLectura } from './planificacion'

/**
 * PEDIRLE A AMAZON SU INFORME DE ANTIGÜEDAD Y GUARDARLO.
 * =====================================================
 * SOLO SERVIDOR. SOLO LEE de Amazon: pide un informe, lo espera y lo descarga. Lo que se lee y cómo
 * se reparte está en lib/fba/planificacion.ts (puro, con pruebas).
 *
 *
 * ============ UNA LECTURA INDEPENDIENTE DE LA DEL LIBRO MAYOR ============
 *
 * Se pide a la vez que el libro mayor, y si falla NO tumba la lectura de ventas: son dos datos
 * distintos. Sin el libro no hay ventas; sin este informe hay una estimación de la antigüedad, que
 * es lo que el panel ya enseñaba. Por eso aquí se devuelve el resultado o se lanza, y quien lo
 * llama decide qué hacer con cada uno por separado.
 *
 *
 * ============ LA TABLA PUEDE NO EXISTIR TODAVÍA ============
 *
 * La tabla es de la migración 231, que se lanza a mano en el editor SQL de Supabase. Hasta
 * entonces el informe se lee igual y simplemente no se guarda: se dice en el resultado, y la
 * pasada nocturna sigue con lo suyo.
 */

const ESPERA_ENTRE_SONDEOS_MS = 20_000
/** Diez minutos: lo que tarda un informe grande en un mal día */
const SONDEOS_MAXIMOS = 30

export interface LecturaPlanificacion extends ResultadoLectura {
  reportId: string
  /** Amazon canceló el informe porque no hay nada que contar (sin inventario en ese mercado) */
  vacia: boolean
}

export async function leerPlanificacion(creds: AmazonCredentials, marketplaceId: string): Promise<LecturaPlanificacion> {
  const pedido = await pedirInforme(creds, { tipo: INFORME_PLANIFICACION, marketplaceId })

  let documentId: string | null = null
  for (let i = 0; i < SONDEOS_MAXIMOS; i++) {
    const estado = await consultarInforme(creds, pedido.reportId)
    if (estado.estado === 'DONE') {
      documentId = estado.documentId
      break
    }
    if (estado.estado === 'CANCELLED') {
      // Amazon cancela los informes sin datos: no es un fallo, es «no hay inventario»
      return { reportId: pedido.reportId, vacia: true, filas: [], fecha: null, columnasEdad: [], aproximada: false, descartadas: 0, columnas: [] }
    }
    if (estado.estado === 'FATAL') {
      throw new Error(`Amazon no ha podido generar el informe de planificación (informe ${pedido.reportId})`)
    }
    await new Promise((r) => setTimeout(r, ESPERA_ENTRE_SONDEOS_MS))
  }
  if (!documentId) {
    throw new Error(
      `El informe de planificación ${pedido.reportId} sigue generándose después de ${Math.round((SONDEOS_MAXIMOS * ESPERA_ENTRE_SONDEOS_MS) / 60_000)} minutos`
    )
  }

  const documento = await descargarInforme(creds, documentId)
  // Si no trae las columnas esperadas, parsearPlanificacion lanza diciendo cuáles ha traído
  const lectura = parsearPlanificacion(documento.texto)
  return { ...lectura, reportId: pedido.reportId, vacia: false }
}

/* ------------------------------------------------------------------ */
/* Guardarlo                                                           */
/* ------------------------------------------------------------------ */

type Servicio = ReturnType<typeof createServiceClient>

export interface ResultadoGuardado {
  /** Cuántas referencias hay ahora guardadas de esa cuenta */
  guardadas: number
  guardado: boolean
  /** Lo que hay que decir: por ejemplo que falta lanzar la migración */
  aviso: string | null
}

const AVISO_SIN_MIGRACION = 'La antigüedad de Amazon no se guarda todavía: falta lanzar la migración 231_fba_planificacion.sql en Supabase.'

export async function guardarPlanificacion(
  service: Servicio,
  entrada: { conexion: string; mercado: string; lectura: LecturaPlanificacion }
): Promise<ResultadoGuardado> {
  const { conexion, mercado, lectura } = entrada
  const ahora = new Date().toISOString()

  const aFila = (f: FilaPlanificacion) => ({
    connection_id: conexion,
    marketplace_id: mercado,
    sku: f.sku,
    fecha_foto: lectura.fecha,
    disponible: f.disponible,
    no_vendible: f.noVendible,
    edad: f.edad,
    recargo: f.recargo,
    coste_mes: f.costeMes,
    moneda: f.moneda,
    dias_suministro: f.diasSuministro,
    accion: f.accion,
    informe: lectura.reportId,
    updated_at: ahora,
  })

  const filas = lectura.filas.map(aFila)
  for (let i = 0; i < filas.length; i += 500) {
    const { error } = await service.from('fba_planificacion').upsert(filas.slice(i, i + 500), { onConflict: 'connection_id,marketplace_id,sku' })
    if (error) {
      if (faltaLaTabla(error)) return { guardadas: 0, guardado: false, aviso: AVISO_SIN_MIGRACION }
      throw error
    }
  }

  // Lo que ya no sale en el informe (se agotó del todo, se retiró) no se queda con la edad de ayer
  const { error: errorLimpieza } = await service
    .from('fba_planificacion')
    .delete()
    .eq('connection_id', conexion)
    .eq('marketplace_id', mercado)
    .lt('updated_at', ahora)
  if (errorLimpieza) {
    // Con un informe vacío, aquí es donde se descubre que falta la tabla: no se cuenta como guardado
    if (faltaLaTabla(errorLimpieza)) return { guardadas: 0, guardado: false, aviso: AVISO_SIN_MIGRACION }
    throw errorLimpieza
  }

  await anotarPlanificacion(service, { conexion, mercado, error: null, informe: lectura.reportId })
  return { guardadas: filas.length, guardado: true, aviso: lectura.aproximada ? 'Amazon ha devuelto tramos de antigüedad de otro mercado: el reparto es aproximado.' : null }
}

/**
 * Deja dicho en `fba_lecturas` cómo fue la última lectura de la antigüedad, para que la pantalla
 * pueda contarlo. Tolera que las columnas no existan: es la misma migración.
 */
export async function anotarPlanificacion(
  service: Servicio,
  entrada: { conexion: string; mercado: string; error: string | null; informe?: string | null }
): Promise<void> {
  const { error } = await service.from('fba_lecturas').upsert(
    {
      connection_id: entrada.conexion,
      marketplace_id: entrada.mercado,
      planificacion_at: new Date().toISOString(),
      planificacion_error: entrada.error,
      ...(entrada.informe ? { planificacion_informe: entrada.informe } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'connection_id,marketplace_id' }
  )
  if (error && !faltaLaTabla(error)) throw error
}

/** Un error de lectura, reducido a una frase que se pueda guardar y enseñar */
export const mensajeDeError = (e: unknown): string => (e instanceof Error ? e.message : 'Error desconocido').slice(0, 500)

/* ------------------------------------------------------------------ */
/* Leerlo y guardarlo, sin que nunca tire de nada                      */
/* ------------------------------------------------------------------ */

export interface ResultadoPlanificacion extends ResultadoGuardado {
  /** Por qué no se ha podido leer, si no se ha podido */
  error: string | null
}

/**
 * Lo que hacen la pasada nocturna y el botón del panel, entero y SIN LANZAR NUNCA: se pide a la vez
 * que el libro mayor, y que falle —una columna que cambia, un informe que no llega, la tabla que
 * falta— no puede llevarse por delante la lectura de ventas. El motivo queda guardado en
 * `fba_lecturas` y en el resultado.
 */
export async function leerYGuardarPlanificacion(
  service: Servicio,
  creds: AmazonCredentials,
  entrada: { conexion: string; mercado: string }
): Promise<ResultadoPlanificacion> {
  try {
    const lectura = await leerPlanificacion(creds, entrada.mercado)
    const guardado = await guardarPlanificacion(service, { ...entrada, lectura })
    return { ...guardado, error: null }
  } catch (e) {
    const error = mensajeDeError(e)
    try {
      await anotarPlanificacion(service, { ...entrada, error })
    } catch {
      // Ya queda dicho en el resultado: lo que no se puede es fallar por contar que se ha fallado
    }
    return { guardadas: 0, guardado: false, aviso: null, error }
  }
}

/**
 * Cuánto se espera, como mucho, a la lectura de la antigüedad DESPUÉS de tener ya la de las ventas.
 *
 * Los dos informes se piden a la vez y suelen acabar casi juntos, pero Amazon puede tardar en uno
 * mucho más que en el otro. La pasada nocturna tiene un presupuesto de tiempo y una cuenta lenta
 * no puede dejar sin leer a las demás: pasado este plazo se sigue adelante. La lectura NO se
 * pierde —sigue esperando en segundo plano y se guarda sola cuando Amazon la entrega—, y esa es la
 * razón de que la lectura no lance nunca: nadie la está esperando para recoger un error.
 */
export const ESPERA_EXTRA_PLANIFICACION_MS = 150_000

export const AVISO_PLANIFICACION_TARDA =
  'Amazon sigue preparando el informe de antigüedad: se guardará solo cuando lo entregue. Pulsa «Actualizar» dentro de unos minutos.'

export async function esperarPlanificacion(pendiente: Promise<ResultadoPlanificacion>, ms = ESPERA_EXTRA_PLANIFICACION_MS): Promise<ResultadoPlanificacion> {
  let temporizador: ReturnType<typeof setTimeout> | undefined
  const tarde = new Promise<'tarde'>((resolver) => {
    temporizador = setTimeout(() => resolver('tarde'), ms)
  })
  try {
    const r = await Promise.race([pendiente, tarde])
    return r === 'tarde' ? { guardadas: 0, guardado: false, aviso: AVISO_PLANIFICACION_TARDA, error: null } : r
  } finally {
    if (temporizador) clearTimeout(temporizador)
  }
}
