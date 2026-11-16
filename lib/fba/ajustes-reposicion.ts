/**
 * AJUSTES DE REPOSICIÓN DE UN CLIENTE (spec remesas-pro §7 y §11 D14). Puro: sin base de datos ni fechas.
 *
 * Los ajustes viven en su tabla propia, `fba_reposicion_config` (migración 316). Una columna en NULL
 * no es «cero»: quiere decir «lo que se haya medido y, si no, el valor de partida». Por eso:
 *
 *   manual (la fila)  >  medido (MedidasCliente, solo minEnvio y ventanaAgrupacion)  >  partida
 *
 * - `ventanaAgrupacion` medida = la cadencia del cliente (días entre envíos), acotada a 3-30.
 * - `minEnvio` medido = el 40 % de su tamaño típico de envío.
 *
 * El plazo (preparación, transporte, recepción, margen) NO está aquí: sigue en `fba_alertas_config`.
 */

import type { AjustesReposicion, MedidasCliente } from './plan-tipos'

/** Una fila de `fba_reposicion_config` tal como llega de Supabase (todo lo opcional puede faltar si el select es parcial) */
export interface FilaReposicionConfig {
  client_id?: string
  cobertura_objetivo_dias?: number | null
  cobertura_max_dias?: number | null
  multiplo_caja?: number | null
  min_unidades_linea?: number | null
  min_unidades_envio?: number | null
  ventana_agrupacion_dias?: number | null
  capacidad_unidades?: number | null
  /** NUMERIC(4,2): según el cliente puede llegar como texto */
  tope_estacional?: number | string | null
  campana_hasta?: string | null
  transporte_urgente_dias?: number | null
  planificador_activo?: boolean | null
  avisar_chat?: boolean | null
  actualizado_at?: string | null
  actualizado_por?: string | null
}

/** Columnas que se pueden escribir desde el PUT (las de fecha y autor las pone el servidor) */
export type CambiosReposicionConfig = Partial<Omit<FilaReposicionConfig, 'client_id' | 'actualizado_at' | 'actualizado_por'>>

/** Valores de partida: lo que se usa cuando no hay fila ni medida */
export const AJUSTES_DE_PARTIDA: AjustesReposicion = {
  coberturaObjetivo: 45,
  coberturaMaxima: 90,
  multiploCaja: null,
  minLinea: 3,
  minEnvio: 30,
  ventanaAgrupacion: 7,
  capacidadUnidades: null,
  topeEstacional: 1.8,
  campanaHasta: null,
  transporteUrgenteDias: null,
  activo: true,
  avisarChat: true,
  origen: { minEnvio: 'partida', ventanaAgrupacion: 'partida' },
}

/** Los mismos límites que los CHECK de la migración 316 */
export const RANGOS_AJUSTES = {
  cobertura_objetivo_dias: { min: 7, max: 180, entero: true, nombre: 'La cobertura objetivo', unidad: 'días' },
  cobertura_max_dias: { min: 14, max: 365, entero: true, nombre: 'La cobertura máxima', unidad: 'días' },
  multiplo_caja: { min: 1, max: 500, entero: true, nombre: 'Las unidades por caja', unidad: 'ud' },
  min_unidades_linea: { min: 1, max: 500, entero: true, nombre: 'El mínimo por referencia', unidad: 'ud' },
  min_unidades_envio: { min: 1, max: 10000, entero: true, nombre: 'El mínimo por envío', unidad: 'ud' },
  ventana_agrupacion_dias: { min: 0, max: 30, entero: true, nombre: 'La ventana para agrupar', unidad: 'días' },
  capacidad_unidades: { min: 1, max: 10000000, entero: true, nombre: 'La capacidad en Amazon', unidad: 'ud' },
  tope_estacional: { min: 1, max: 8, entero: false, nombre: 'El tope de temporada', unidad: '×' },
  transporte_urgente_dias: { min: 1, max: 60, entero: true, nombre: 'El transporte urgente', unidad: 'días' },
} as const

type ColumnaNumerica = keyof typeof RANGOS_AJUSTES

/** Ventana medida: la cadencia del cliente, acotada a 3-30 días (D14) */
const VENTANA_MEDIDA = { min: 3, max: 30 }
/** Mínimo por envío medido: 40 % del tamaño típico (D14) */
const PARTE_DEL_TAMANO_TIPICO = 0.4

/* ------------------------------ utilidades ------------------------------ */

const acotar = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** Número de una celda o de un cuerpo JSON: acepta «1,8» además de 1.8. null si no es un número finito */
function aNumero(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const t = v.trim().replace(',', '.')
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** Normaliza una columna numérica a su CHECK (para leer filas que vinieran fuera de rango) */
function leerNumero(v: unknown, col: ColumnaNumerica): number | null {
  const n = aNumero(v)
  if (n === null) return null
  const r = RANGOS_AJUSTES[col]
  const redondeado = r.entero ? Math.round(n) : Math.round(n * 100) / 100
  return acotar(redondeado, r.min, r.max)
}

const DIAS_DEL_MES = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

/** «MM-DD» con un día que exista (el 29 de febrero vale: hay años bisiestos) */
export function esCampanaValida(v: string): boolean {
  const m = /^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.exec(v)
  if (!m) return false
  return Number(m[2]) <= DIAS_DEL_MES[Number(m[1]) - 1]
}

/* ------------------------------ de la fila a los ajustes ------------------------------ */

/**
 * Los ajustes efectivos de un cliente: lo puesto a mano, si no lo medido y si no los valores de partida.
 * `fila` es la de `fba_reposicion_config` (null si el cliente no tiene); `medidas`, las de `medirCadencia`.
 */
export function ajustesDesdeFila(fila: FilaReposicionConfig | null, medidas: MedidasCliente | null): AjustesReposicion {
  const f = fila ?? {}
  const P = AJUSTES_DE_PARTIDA

  const coberturaObjetivo = leerNumero(f.cobertura_objetivo_dias, 'cobertura_objetivo_dias') ?? P.coberturaObjetivo
  // La máxima nunca por debajo de la objetivo (el CHECK lo exige cuando están las dos; con una sola, también)
  const coberturaMaxima = Math.max(leerNumero(f.cobertura_max_dias, 'cobertura_max_dias') ?? P.coberturaMaxima, coberturaObjetivo)

  // Ventana para agrupar: manual > cadencia medida (3-30) > 7
  let ventanaAgrupacion = P.ventanaAgrupacion
  let origenVentana: AjustesReposicion['origen']['ventanaAgrupacion'] = 'partida'
  const ventanaManual = leerNumero(f.ventana_agrupacion_dias, 'ventana_agrupacion_dias')
  const cadencia = aNumero(medidas?.cadenciaDias)
  if (ventanaManual !== null) {
    ventanaAgrupacion = ventanaManual
    origenVentana = 'manual'
  } else if (cadencia !== null && cadencia >= 0) {
    ventanaAgrupacion = acotar(Math.round(cadencia), VENTANA_MEDIDA.min, VENTANA_MEDIDA.max)
    origenVentana = 'medido'
  }

  // Mínimo por envío: manual > 40 % del tamaño típico > 30
  let minEnvio = P.minEnvio
  let origenMinEnvio: AjustesReposicion['origen']['minEnvio'] = 'partida'
  const minEnvioManual = leerNumero(f.min_unidades_envio, 'min_unidades_envio')
  const tamano = aNumero(medidas?.tamanoTipico)
  if (minEnvioManual !== null) {
    minEnvio = minEnvioManual
    origenMinEnvio = 'manual'
  } else if (tamano !== null && tamano > 0) {
    const r = RANGOS_AJUSTES.min_unidades_envio
    minEnvio = acotar(Math.round(tamano * PARTE_DEL_TAMANO_TIPICO), r.min, r.max)
    origenMinEnvio = 'medido'
  }

  const campana = typeof f.campana_hasta === 'string' && esCampanaValida(f.campana_hasta.trim()) ? f.campana_hasta.trim() : null

  return {
    coberturaObjetivo,
    coberturaMaxima,
    multiploCaja: leerNumero(f.multiplo_caja, 'multiplo_caja') ?? P.multiploCaja,
    minLinea: leerNumero(f.min_unidades_linea, 'min_unidades_linea') ?? P.minLinea,
    minEnvio,
    ventanaAgrupacion,
    capacidadUnidades: leerNumero(f.capacidad_unidades, 'capacidad_unidades') ?? P.capacidadUnidades,
    topeEstacional: leerNumero(f.tope_estacional, 'tope_estacional') ?? P.topeEstacional,
    campanaHasta: campana,
    transporteUrgenteDias: leerNumero(f.transporte_urgente_dias, 'transporte_urgente_dias') ?? P.transporteUrgenteDias,
    activo: typeof f.planificador_activo === 'boolean' ? f.planificador_activo : P.activo,
    avisarChat: typeof f.avisar_chat === 'boolean' ? f.avisar_chat : P.avisarChat,
    origen: { minEnvio: origenMinEnvio, ventanaAgrupacion: origenVentana },
  }
}

/* ------------------------------ validar el PUT (parcial) ------------------------------ */

/** Nombre del cuerpo (como en `AjustesReposicion`) → columna de la tabla. También se aceptan los nombres de columna */
const CAMPOS: Record<string, keyof CambiosReposicionConfig> = {
  coberturaObjetivo: 'cobertura_objetivo_dias',
  coberturaMaxima: 'cobertura_max_dias',
  multiploCaja: 'multiplo_caja',
  minLinea: 'min_unidades_linea',
  minEnvio: 'min_unidades_envio',
  ventanaAgrupacion: 'ventana_agrupacion_dias',
  capacidadUnidades: 'capacidad_unidades',
  topeEstacional: 'tope_estacional',
  campanaHasta: 'campana_hasta',
  transporteUrgenteDias: 'transporte_urgente_dias',
  activo: 'planificador_activo',
  avisarChat: 'avisar_chat',
  cobertura_objetivo_dias: 'cobertura_objetivo_dias',
  cobertura_max_dias: 'cobertura_max_dias',
  multiplo_caja: 'multiplo_caja',
  min_unidades_linea: 'min_unidades_linea',
  min_unidades_envio: 'min_unidades_envio',
  ventana_agrupacion_dias: 'ventana_agrupacion_dias',
  capacidad_unidades: 'capacidad_unidades',
  tope_estacional: 'tope_estacional',
  campana_hasta: 'campana_hasta',
  transporte_urgente_dias: 'transporte_urgente_dias',
  planificador_activo: 'planificador_activo',
  avisar_chat: 'avisar_chat',
}

/** Claves del cuerpo que no son ajustes y se ignoran sin avisar (las manda la pantalla o la ruta) */
const IGNORADAS_EN_SILENCIO = new Set(['cliente', 'clienteId', 'client_id', 'origen', 'actualizado_at', 'actualizado_por'])

export type ResultadoValidarAjustes =
  | { ok: true; cambios: CambiosReposicionConfig; avisos: string[] }
  | { ok: false; errores: string[] }

const fmt = (n: number) => String(n).replace('.', ',')

/**
 * Valida el cuerpo del `PUT /api/fba/reposicion-config`. Es PARCIAL: solo se tocan las claves que vengan.
 * - Número → se redondea (entero, o 2 decimales el tope de temporada) y se acota al CHECK de la 316, con aviso.
 * - null o «» → vuelve a NULL (medido o de partida). Las dos casillas (activo, avisar) no admiten null.
 * - `campanaHasta` tiene que ser «MM-DD» de un día que exista; si no, error (no se adivina).
 * - Si se pasa `actual` (la fila guardada), se comprueba que la cobertura máxima no quede por debajo de la objetivo.
 * Devuelve las columnas de la tabla listas para el update.
 */
export function validarAjustes(entrada: unknown, actual: FilaReposicionConfig | null = null): ResultadoValidarAjustes {
  if (entrada === null || typeof entrada !== 'object' || Array.isArray(entrada)) {
    return { ok: false, errores: ['No llegan ajustes que guardar.'] }
  }
  const errores: string[] = []
  const avisos: string[] = []
  const cambios: CambiosReposicionConfig = {}
  const vistas = new Set<string>()

  for (const [clave, valor] of Object.entries(entrada as Record<string, unknown>)) {
    if (valor === undefined) continue
    const col = CAMPOS[clave]
    if (!col) {
      if (!IGNORADAS_EN_SILENCIO.has(clave)) avisos.push(`Se ignora «${clave}»: no es un ajuste de reposición.`)
      continue
    }
    if (vistas.has(col)) {
      errores.push(`«${clave}» viene repetido con otro nombre.`)
      continue
    }
    vistas.add(col)

    // Casillas
    if (col === 'planificador_activo' || col === 'avisar_chat') {
      if (typeof valor !== 'boolean') {
        errores.push(col === 'planificador_activo' ? '«Planificador activo» tiene que ser sí o no.' : '«Avisar en el chat» tiene que ser sí o no.')
      } else {
        cambios[col] = valor
      }
      continue
    }

    // Fin de campaña
    if (col === 'campana_hasta') {
      if (valor === null || (typeof valor === 'string' && valor.trim() === '')) {
        cambios.campana_hasta = null
      } else if (typeof valor === 'string' && esCampanaValida(valor.trim())) {
        cambios.campana_hasta = valor.trim()
      } else {
        errores.push(`El fin de campaña tiene que ser mes-día, como 12-18 (llega «${String(valor)}»).`)
      }
      continue
    }

    // Números
    const r = RANGOS_AJUSTES[col as ColumnaNumerica]
    if (valor === null || (typeof valor === 'string' && valor.trim() === '')) {
      cambios[col as ColumnaNumerica] = null
      continue
    }
    const n = aNumero(valor)
    if (n === null) {
      errores.push(`${r.nombre} tiene que ser un número (llega «${String(valor)}»).`)
      continue
    }
    const redondeado = r.entero ? Math.round(n) : Math.round(n * 100) / 100
    const acotado = acotar(redondeado, r.min, r.max)
    if (acotado !== redondeado) {
      avisos.push(`${r.nombre} va de ${fmt(r.min)} a ${fmt(r.max)} ${r.unidad}: se guarda ${fmt(acotado)} en lugar de ${fmt(redondeado)}.`)
    }
    cambios[col as ColumnaNumerica] = acotado
  }

  // Cobertura máxima ≥ objetivo, con lo que quedaría guardado (CHECK fba_reposicion_config_cobertura_check)
  const objetivo = 'cobertura_objetivo_dias' in cambios ? cambios.cobertura_objetivo_dias : actual?.cobertura_objetivo_dias ?? null
  const maxima = 'cobertura_max_dias' in cambios ? cambios.cobertura_max_dias : actual?.cobertura_max_dias ?? null
  if (objetivo != null && maxima != null && maxima < objetivo) {
    errores.push(`La cobertura máxima (${maxima} días) no puede ser menor que la objetivo (${objetivo} días).`)
  }

  if (errores.length > 0) return { ok: false, errores }
  if (Object.keys(cambios).length === 0) return { ok: false, errores: ['No llega ningún ajuste que guardar.'] }
  return { ok: true, cambios, avisos }
}
