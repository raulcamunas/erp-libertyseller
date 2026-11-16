'use client'

import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { tonoEstable } from '@/components/ui-ls/utilidades'
import type { EnvioPropuestoGuardado, ResumenGlobal, TareaPendiente, TonoSalud } from '@/lib/fba/plan-tipos'
import { puedeCambiar } from '@/lib/fba/trabajo-plan'
import type { SesionRemesas } from '../comun/tipos-ui'
import { useAgencia } from '../comun/useAgencia'
import { diasEntre, fechaCorta } from '../formato'

/**
 * LOS DATOS DE LA VISTA «HOY» (spec remesas-pro §1.5, §6.3, D18, D34 y D42) Y SUS CUENTAS PURAS.
 *
 * El hook pide `GET /api/fba/resumen` (ResumenGlobal + `aviso` si falta la 316) con la memoria de 5 min de `useAgencia`;
 * lo demás es puro (sin React ni navegador) y se prueba con `npx tsx components/remesas/hoy/useResumen.prueba.ts`.
 *
 * API
 *   useResumen(activo?)                 → { resumen, aviso, cargando, error, estado, actualizadoEn, recargar }
 *   ordenarClientes(clientes)           rojo → ámbar → verde → gris (el gris SIEMPRE al final, D42) y, dentro, por € en juego
 *   seriesDeSalidas(salidas, nombres)   filas y series para GraficoBarrasApiladas: un color estable por cliente, y con más
 *                                       de 6 clientes los 5 mayores + «Otros». Los clientes sin unidades no salen
 *   etiquetaSemana(lunes, hoy)          «Esta semana», «Próxima», «24 nov»
 *   avisosDeHoy(clientes, aviso, hoy)   los avisos de la banda de calidad de TODOS los clientes, juntos y sin repetir
 *   accionDePendiente(t, envio, sesion) la acción principal de una tarea: Hablado, Convertir, Asignarme, Importar, Reclamar
 *                                       o Abrir; y si se puede hacer (permisos y transiciones de trabajo-plan)
 *   cuentaAtras(t)                      «Vence hoy», «Quedan 12 días», «Vencido hace 3 días» con su tono (o null)
 *   puedeEditarCliente(sesion, id)
 */

export type RespuestaResumen = ResumenGlobal & { aviso?: string | null }
export type ClienteDeResumen = ResumenGlobal['clientes'][number]

export const URL_RESUMEN = '/api/fba/resumen'

export function useResumen(activo = true) {
  const r = useAgencia<RespuestaResumen>(activo ? URL_RESUMEN : null, { que: 'No se ha podido leer el resumen de remesas' })
  return {
    resumen: r.datos,
    aviso: r.datos?.aviso ?? null,
    cargando: r.cargando,
    error: r.error,
    estado: r.estado,
    actualizadoEn: r.actualizadoEn,
    recargar: r.recargar,
  }
}

/* ------------------------------------------------------------------ */
/* Permisos                                                            */
/* ------------------------------------------------------------------ */

export function puedeEditarCliente(sesion: Pick<SesionRemesas, 'esAgencia' | 'clientesPermitidos' | 'editables'>, clienteId: string): boolean {
  if (!sesion.esAgencia) return false
  if (sesion.clientesPermitidos !== null && !sesion.clientesPermitidos.includes(clienteId)) return false
  return sesion.editables === null || sesion.editables.includes(clienteId)
}

/* ------------------------------------------------------------------ */
/* Tarjetas de salud                                                   */
/* ------------------------------------------------------------------ */

/** Orden de las TARJETAS de Hoy: el gris («sin datos») detrás de todo, también del verde (D42 y el encargo de C1) */
export const ORDEN_TARJETA: Record<TonoSalud, number> = { rojo: 0, ambar: 1, verde: 2, gris: 3 }

export function ordenarClientes<T extends Pick<ClienteDeResumen, 'nombre' | 'salud' | 'resumen'>>(clientes: readonly T[]): T[] {
  const euros = (c: T) => (c.resumen?.eurosEnRiesgo ?? 0)
  return [...clientes].sort(
    (a, b) =>
      ORDEN_TARJETA[a.salud?.tono ?? 'gris'] - ORDEN_TARJETA[b.salud?.tono ?? 'gris'] ||
      euros(b) - euros(a) ||
      a.nombre.localeCompare(b.nombre, 'es')
  )
}

/** Cuántas tarjetas hay de cada tono (para el resumen de la cabecera de «Clientes») */
export function cuentaPorTono(clientes: ReadonlyArray<Pick<ClienteDeResumen, 'salud'>>): Record<TonoSalud, number> {
  const n: Record<TonoSalud, number> = { rojo: 0, ambar: 0, verde: 0, gris: 0 }
  for (const c of clientes) n[c.salud?.tono ?? 'gris'] += 1
  return n
}

/* ------------------------------------------------------------------ */
/* Salidas por semana                                                  */
/* ------------------------------------------------------------------ */

export const MAX_SERIES_SALIDAS = 6
export const CLAVE_OTROS = '__otros'

export interface SerieSalidas {
  clave: string
  nombre: string
  color: string
  tono: TonoEstado | null
  total: number
}

/** El color de un cliente en los gráficos: el mismo en todas las pantallas (tonoEstable del nombre) */
export function colorDeCliente(nombre: string): string {
  return COLOR_ESTADO[tonoEstable(nombre)]
}

export function seriesDeSalidas(
  salidas: ResumenGlobal['salidasPorSemana'],
  nombres: Record<string, string>
): { datos: Array<Record<string, string | number>>; series: SerieSalidas[]; total: number } {
  const totales = new Map<string, number>()
  for (const s of salidas) for (const [id, ud] of Object.entries(s.porCliente)) if (ud > 0) totales.set(id, (totales.get(id) ?? 0) + ud)
  const ordenados = [...totales.entries()].sort((a, b) => b[1] - a[1] || (nombres[a[0]] ?? a[0]).localeCompare(nombres[b[0]] ?? b[0], 'es'))
  const conOtros = ordenados.length > MAX_SERIES_SALIDAS
  const propios = conOtros ? ordenados.slice(0, MAX_SERIES_SALIDAS - 1) : ordenados
  const resto = new Set(conOtros ? ordenados.slice(MAX_SERIES_SALIDAS - 1).map(([id]) => id) : [])

  const series: SerieSalidas[] = propios.map(([id, total]) => {
    const nombre = nombres[id] ?? 'Cliente'
    const tono = tonoEstable(nombre)
    return { clave: id, nombre, color: COLOR_ESTADO[tono], tono, total }
  })
  if (conOtros) {
    const total = [...resto].reduce((s, id) => s + (totales.get(id) ?? 0), 0)
    series.push({ clave: CLAVE_OTROS, nombre: `Otros (${resto.size})`, color: 'var(--ls-t4)', tono: null, total })
  }

  const datos = salidas.map((s) => {
    const fila: Record<string, string | number> = { semana: s.semana }
    for (const x of series) fila[x.clave] = 0
    for (const [id, ud] of Object.entries(s.porCliente)) {
      if (!(ud > 0)) continue
      const clave = resto.has(id) ? CLAVE_OTROS : id
      if (clave in fila) fila[clave] = Number(fila[clave]) + ud
    }
    return fila
  })
  const total = ordenados.reduce((s, [, ud]) => s + ud, 0)
  // De abajo arriba: el mayor abajo (la base de la pila es la que mejor se compara)
  return { datos, series, total }
}

/** El rótulo de una semana (su lunes): «Esta semana», «Próxima» o «24 nov» */
export function etiquetaSemana(lunes: string, hoy: string): string {
  const d = diasEntre(lunes, hoy)
  if (d >= 0 && d < 7) return 'Esta semana'
  if (d < 0 && d >= -7) return 'Próxima'
  return fechaCorta(lunes, hoy)
}

/* ------------------------------------------------------------------ */
/* Banda de calidad de todos los clientes                              */
/* ------------------------------------------------------------------ */

export interface AvisoDeHoy {
  id: string
  tono: 'rojo' | 'ambar' | 'gris'
  texto: string
  /** A qué cliente lleva el botón (el primero del grupo); null = sin botón */
  clienteId: string | null
  accion: 'ver' | 'plazos' | null
}

const lista = (nombres: string[], max = 3) =>
  nombres.length <= max ? nombres.join(', ').replace(/, ([^,]*)$/, ' y $1') : `${nombres.slice(0, max).join(', ')} y ${nombres.length - max} más`

/**
 * Los avisos de calidad de todos los clientes, agrupados (una línea por problema, no una por cliente):
 * lectura fallida · ventas atrasadas (> 7 días: plan provisional; > 3 días: atraso) · plazos «de partida» · y el aviso
 * del servidor (falta la 316). Los clientes sin ventas leídas NO salen aquí: ya tienen su tarjeta gris.
 */
export function avisosDeHoy(clientes: ReadonlyArray<Pick<ClienteDeResumen, 'clienteId' | 'nombre' | 'calidad'>>, aviso: string | null, hoy: string): AvisoDeHoy[] {
  const salida: AvisoDeHoy[] = []
  const fallidos = clientes.filter((c) => c.calidad?.ultimoError)
  const muyAtrasados = clientes.filter((c) => c.calidad && c.calidad.libro !== 'sin_leer' && (c.calidad.diasAtraso ?? 0) > 7)
  const atrasados = clientes.filter((c) => c.calidad && c.calidad.libro !== 'sin_leer' && (c.calidad.diasAtraso ?? 0) > 3 && (c.calidad.diasAtraso ?? 0) <= 7)
  const dePartida = clientes.filter((c) => c.calidad?.plazoDePartida)
  const conAtraso = (c: Pick<ClienteDeResumen, 'nombre' | 'calidad'>) =>
    `${c.nombre} hasta el ${fechaCorta(c.calidad?.leidoHasta, hoy)} (${c.calidad?.diasAtraso} días)`

  if (fallidos.length) {
    salida.push({
      id: 'fallo',
      tono: 'rojo',
      clienteId: fallidos[0].clienteId,
      accion: 'ver',
      texto:
        fallidos.length === 1
          ? `La última lectura de Amazon de ${fallidos[0].nombre} falló: ${String(fallidos[0].calidad?.ultimoError).slice(0, 120)}`
          : `La última lectura de Amazon falló en ${fallidos.length} clientes: ${lista(fallidos.map((c) => c.nombre))}`,
    })
  }
  if (muyAtrasados.length) {
    salida.push({
      id: 'provisional',
      tono: 'rojo',
      clienteId: muyAtrasados[0].clienteId,
      accion: 'ver',
      texto: `No te fíes de sus fechas, el plan es provisional: ventas leídas de ${lista(muyAtrasados.map(conAtraso), 2)}`,
    })
  }
  if (atrasados.length) {
    salida.push({
      id: 'atraso',
      tono: 'ambar',
      clienteId: atrasados[0].clienteId,
      accion: 'ver',
      texto: `Ventas atrasadas: ${lista(atrasados.map(conAtraso), 2)}`,
    })
  }
  if (dePartida.length) {
    const n = dePartida.length
    salida.push({
      id: 'plazos',
      tono: 'ambar',
      clienteId: dePartida[0].clienteId,
      accion: 'plazos',
      texto: `${n} cliente${n === 1 ? '' : 's'} con plazos «de partida» (${lista(dePartida.map((c) => c.nombre))}): confírmalos para que las fechas sean de verdad`,
    })
  }
  if (aviso) salida.push({ id: 'servidor', tono: 'gris', clienteId: null, accion: null, texto: aviso })
  return salida
}

/* ------------------------------------------------------------------ */
/* Pendientes: la acción principal y la cuenta atrás                   */
/* ------------------------------------------------------------------ */

export type AccionPendiente = 'hablado' | 'convertir' | 'asignarme' | 'importar' | 'reclamar' | 'abrir'

export const TEXTO_ACCION: Record<AccionPendiente, string> = {
  hablado: 'Hablado',
  convertir: 'Convertir en remesa',
  asignarme: 'Asignarme',
  importar: 'Importar',
  reclamar: 'Reclamar',
  abrir: 'Abrir',
}

export const AYUDA_ACCION: Record<AccionPendiente, string> = {
  hablado: 'Ya lo has hablado con el cliente: se congelan las cantidades acordadas',
  convertir: 'Crea la propuesta en borrador con lo hablado y la enlaza a este envío',
  asignarme: 'Te lo quedas: te llegan sus avisos y deja de estar «sin responsable»',
  importar: 'Amazon tiene un envío que el ERP no conoce: tráelo con «Importar pedidos»',
  reclamar: 'Abre el envío con lo que falta para reclamarlo a Amazon',
  abrir: 'Abre donde se resuelve',
}

type EnvioParaAccion = Pick<EnvioPropuestoGuardado, 'estado' | 'responsableId'>

/**
 * La acción principal de una tarea. Solo se proponen acciones que el servidor aceptaría (puedeCambiar) y que la sesión
 * puede hacer en ese cliente; si no, «Abrir».
 */
export function accionDePendiente(
  t: Pick<TareaPendiente, 'tipo' | 'clienteId' | 'envioPropuestoId'>,
  envio: EnvioParaAccion | null,
  sesion: Pick<SesionRemesas, 'usuarioId' | 'esAgencia' | 'clientesPermitidos' | 'editables'>
): AccionPendiente {
  const edita = puedeEditarCliente(sesion, t.clienteId)
  if (t.tipo === 'entrante_sin_remesa') return edita ? 'importar' : 'abrir'
  if (t.tipo === 'cerrado_con_faltantes' || t.tipo === 'envio_dudoso') return 'reclamar'
  if (!envio || !edita) return 'abrir'
  if (t.tipo === 'sin_responsable' && envio.responsableId !== sesion.usuarioId) return 'asignarme'
  if (envio.estado === 'nuevo' && puedeCambiar('nuevo', 'hablado', 'agencia').ok) return 'hablado'
  if ((envio.estado === 'hablado' || envio.estado === 'esperando_cliente') && puedeCambiar(envio.estado, 'en_preparacion', 'agencia').ok) return 'convertir'
  return 'abrir'
}

/** Lo que va en el menú «⋯» además de la principal (sin repetirla) */
export function accionesSecundarias(
  principal: AccionPendiente,
  t: Pick<TareaPendiente, 'tipo' | 'clienteId'>,
  envio: EnvioParaAccion | null,
  sesion: Pick<SesionRemesas, 'usuarioId' | 'esAgencia' | 'clientesPermitidos' | 'editables'>
): Array<AccionPendiente | 'esperando' | 'ver_envio' | 'ver_cliente'> {
  const edita = puedeEditarCliente(sesion, t.clienteId)
  const otras: Array<AccionPendiente | 'esperando' | 'ver_envio' | 'ver_cliente'> = []
  if (principal !== 'abrir') otras.push('abrir')
  if (envio) {
    otras.push('ver_envio')
    if (edita) {
      if (envio.responsableId !== sesion.usuarioId && principal !== 'asignarme') otras.push('asignarme')
      if (envio.estado === 'nuevo' && principal !== 'hablado') otras.push('hablado')
      if (envio.estado === 'hablado') otras.push('esperando')
      if ((envio.estado === 'nuevo' || envio.estado === 'hablado' || envio.estado === 'esperando_cliente') && principal !== 'convertir') otras.push('convertir')
    }
  }
  otras.push('ver_cliente')
  return otras
}

export interface CuentaAtras {
  texto: string
  tono: TonoEstado
}

/** La cuenta atrás de una tarea, si la tiene. En las reclamaciones, son los días que quedan para reclamar */
export function cuentaAtras(t: Pick<TareaPendiente, 'tipo' | 'diasRestantes'>): CuentaAtras | null {
  const d = t.diasRestantes
  if (d === null || d === undefined || !Number.isFinite(d)) return null
  const n = Math.round(d)
  const reclamar = t.tipo === 'cerrado_con_faltantes'
  if (n < 0) return { texto: `Vencido hace ${-n} ${n === -1 ? 'día' : 'días'}`, tono: 'rojo' }
  if (n === 0) return { texto: reclamar ? 'Último día para reclamar' : 'Vence hoy', tono: 'rojo' }
  if (n === 1) return { texto: reclamar ? 'Queda 1 día para reclamar' : 'Vence mañana', tono: 'rojo' }
  const texto = reclamar ? `Quedan ${n} días para reclamar` : `Quedan ${n} días`
  return { texto, tono: n <= 3 ? 'naranja' : n <= 10 ? 'ambar' : 'gris' }
}

/** Tono de la gravedad de una tarea (el punto de la izquierda) */
export const TONO_GRAVEDAD: Record<TareaPendiente['gravedad'], TonoEstado> = { alta: 'rojo', media: 'ambar', baja: 'gris' }

/** Cuántas tareas de cada gravedad */
export function cuentaPorGravedad(tareas: ReadonlyArray<Pick<TareaPendiente, 'gravedad'>>): Record<TareaPendiente['gravedad'], number> {
  const n = { alta: 0, media: 0, baja: 0 }
  for (const t of tareas) n[t.gravedad] += 1
  return n
}
