'use client'

import { useCallback, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AjusteIa, EnvioPropuestoGuardado, EstadoEnvioPropuesto, MotivoDescarte, TareaPendiente } from '@/lib/fba/plan-tipos'
import { leerRespuesta } from './errores'
import { invalidarRemesas, useAgencia } from './useAgencia'

/**
 * LOS ENVÍOS PROPUESTOS DESDE LA PANTALLA (spec remesas-pro §4, §9, D20 y D23). Solo agencia: el cliente externo recibe 403.
 *
 * API
 *   useEnviosPropuestos({ clienteId?, estado?, pendientes? } | null)
 *     → { envios, pendientes, migracion316, aviso, cargando, error, recargar, cambiar, convertir, ocupado }
 *     · GET /api/fba/envios-propuestos?cliente=&estado=&vista=pendientes (sin estado: los activos).
 *     · cambiar(envio, cambio): PATCH con la `version` que se está viendo. 409 por versión → { ok: false, conflicto: envío de ahora }.
 *     · convertir(envio): POST …/convertir → { ok: true, remesaId, yaExistia } (idempotente: dos clics dan UNA remesa).
 *     · Tras escribir: invalidarRemesas(clienteId) + router.refresh() (el panel de la página); nunca router.push.
 *   useEnvioPropuesto(id | null)        → { envio, cargando, error, recargar }       (GET /api/fba/envios-propuestos/<id>)
 *   useHistorialEnvio(id | null)        → { eventos, cargando, error, recargar }     (GET …/<id>/historial)
 *   cambiarEnvioPropuesto(envio, cambio) / convertirEnvioPropuesto(envio)   lo mismo fuera de React (invalidan, sin refresh)
 */

export interface CambioEnvioPropuesto {
  estado?: EstadoEnvioPropuesto
  /** undefined = no se toca; null = sin responsable */
  responsableId?: string | null
  fechaLimite?: string
  nota?: string | null
  motivoDescarte?: MotivoDescarte
  aplicarAjuste?: AjusteIa
}

type EnvioRef = Pick<EnvioPropuestoGuardado, 'id' | 'version' | 'clienteId'>

export type ResultadoCambio =
  | { ok: true; envio: EnvioPropuestoGuardado; aviso: string | null }
  | { ok: false; error: string; estado: number; conflicto: EnvioPropuestoGuardado | null }

export type ResultadoConvertir =
  | { ok: true; remesaId: string; yaExistia: boolean; analisisGuardado: boolean }
  | { ok: false; error: string; estado: number; conflicto: boolean }

const SIN_RED = 'No hay conexión con el servidor: comprueba la red y vuelve a probar.'

export async function cambiarEnvioPropuesto(envio: EnvioRef, cambio: CambioEnvioPropuesto): Promise<ResultadoCambio> {
  let res: Response
  try {
    res = await fetch(`/api/fba/envios-propuestos/${envio.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: envio.version, ...cambio }),
    })
  } catch {
    return { ok: false, error: SIN_RED, estado: 0, conflicto: null }
  }
  const r = await leerRespuesta<{ envio: EnvioPropuestoGuardado; aviso?: string | null }>(res, 'No se ha podido cambiar el envío propuesto')
  // Tanto si sale bien como si alguien lo cambió antes, lo que había en memoria ya no vale
  invalidarRemesas(envio.clienteId)
  if (r.ok) return { ok: true, envio: r.datos.envio, aviso: r.datos.aviso ?? null }
  const otro = r.datos && r.datos.conflicto === true && r.datos.envio && typeof r.datos.envio === 'object' ? (r.datos.envio as EnvioPropuestoGuardado) : null
  return { ok: false, error: r.error, estado: r.estado, conflicto: otro }
}

export async function convertirEnvioPropuesto(envio: Pick<EnvioPropuestoGuardado, 'id' | 'clienteId'>): Promise<ResultadoConvertir> {
  let res: Response
  try {
    res = await fetch(`/api/fba/envios-propuestos/${envio.id}/convertir`, { method: 'POST' })
  } catch {
    return { ok: false, error: SIN_RED, estado: 0, conflicto: false }
  }
  const r = await leerRespuesta<{ remesaId: string; yaExistia?: boolean; analisisGuardado?: boolean }>(res, 'No se ha podido convertir el envío en remesa')
  invalidarRemesas(envio.clienteId)
  if (r.ok) return { ok: true, remesaId: r.datos.remesaId, yaExistia: r.datos.yaExistia === true, analisisGuardado: r.datos.analisisGuardado !== false }
  return { ok: false, error: r.error, estado: r.estado, conflicto: r.datos?.conflicto === true }
}

export function urlDeEnvios(filtro: { clienteId?: string | null; estado?: string | null; pendientes?: boolean }): string {
  const p = new URLSearchParams()
  if (filtro.clienteId) p.set('cliente', filtro.clienteId)
  if (filtro.estado) p.set('estado', filtro.estado)
  if (filtro.pendientes) p.set('vista', 'pendientes')
  const q = p.toString()
  return `/api/fba/envios-propuestos${q ? `?${q}` : ''}`
}

interface RespuestaLista {
  envios: EnvioPropuestoGuardado[]
  pendientes: TareaPendiente[]
  migracion316: boolean
  aviso: string | null
}

export function useEnviosPropuestos(filtro: { clienteId?: string | null; estado?: string | null; pendientes?: boolean } | null) {
  const router = useRouter()
  const url = filtro ? urlDeEnvios(filtro) : null
  const r = useAgencia<RespuestaLista>(url, { que: 'No se han podido leer los envíos propuestos' })
  /** id del envío con una escritura en marcha (para deshabilitar sus botones) */
  const [ocupado, setOcupado] = useState<string | null>(null)

  const cambiar = useCallback(
    async (envio: EnvioRef, cambio: CambioEnvioPropuesto) => {
      setOcupado(envio.id)
      try {
        const x = await cambiarEnvioPropuesto(envio, cambio)
        router.refresh()
        return x
      } finally {
        setOcupado(null)
      }
    },
    [router]
  )

  const convertir = useCallback(
    async (envio: Pick<EnvioPropuestoGuardado, 'id' | 'clienteId'>) => {
      setOcupado(envio.id)
      try {
        const x = await convertirEnvioPropuesto(envio)
        router.refresh()
        return x
      } finally {
        setOcupado(null)
      }
    },
    [router]
  )

  return {
    envios: r.datos?.envios ?? [],
    pendientes: r.datos?.pendientes ?? [],
    migracion316: r.datos ? r.datos.migracion316 : null,
    aviso: r.datos?.aviso ?? null,
    cargando: r.cargando,
    error: r.error,
    estado: r.estado,
    actualizadoEn: r.actualizadoEn,
    recargar: r.recargar,
    cambiar,
    convertir,
    ocupado,
  }
}

export function useEnvioPropuesto(id: string | null) {
  const r = useAgencia<{ envio: EnvioPropuestoGuardado }>(id ? `/api/fba/envios-propuestos/${id}` : null, { que: 'No se ha podido leer el envío propuesto' })
  return { envio: r.datos?.envio ?? null, cargando: r.cargando, error: r.error, estado: r.estado, recargar: r.recargar }
}

export interface EventoHistorialEnvio {
  id: string
  cuando: string
  quien: string | null
  quienNombre: string | null
  accion: string
  de: string | null
  a: string | null
  nota: string | null
  datos: Record<string, unknown> | null
}

export function useHistorialEnvio(id: string | null) {
  const r = useAgencia<{ eventos: EventoHistorialEnvio[]; migracion316?: boolean }>(id ? `/api/fba/envios-propuestos/${id}/historial` : null, {
    que: 'No se ha podido leer el historial del envío',
  })
  return { eventos: r.datos?.eventos ?? [], cargando: r.cargando, error: r.error, recargar: r.recargar }
}
