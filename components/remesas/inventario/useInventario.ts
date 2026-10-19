'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { InventarioDeCliente } from '@/lib/fba/inventario'
import { SUPUESTOS_POR_DEFECTO, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'

/**
 * EL INVENTARIO DE UN CLIENTE, PEDIDO CUANDO SE ABRE Y GUARDADO UN RATO.
 *
 * No viene con la pantalla de remesas: son los movimientos de varios meses del cliente y
 * quien solo mira un envío no tiene por qué esperarlos. Se pide al abrir la pestaña y se
 * recuerda cinco minutos, para que ir y volver entre pestañas o entre clientes no repita
 * la lectura. El botón de actualizar se salta esa memoria.
 */

const VIGENCIA_MS = 5 * 60 * 1000
const memoria = new Map<string, { en: number; datos: InventarioDeCliente }>()

interface Estado {
  cargando: boolean
  error: string | null
  datos: InventarioDeCliente | null
}

export function useInventario(clienteId: string) {
  const [estado, setEstado] = useState<Estado>(() => {
    const guardado = memoria.get(clienteId)
    return { cargando: !guardado, error: null, datos: guardado?.datos ?? null }
  })
  // Una respuesta lenta de un cliente anterior no puede pisar la del actual
  const vigente = useRef(clienteId)
  vigente.current = clienteId

  const pedir = useCallback(
    async (forzar: boolean) => {
      const guardado = memoria.get(clienteId)
      if (!forzar && guardado && Date.now() - guardado.en < VIGENCIA_MS) {
        setEstado({ cargando: false, error: null, datos: guardado.datos })
        return
      }
      // Al actualizar se sigue enseñando lo que hay mientras llega lo nuevo. El panel se monta
      // con `key={cliente}`, así que lo que hay aquí siempre es del cliente que se mira.
      setEstado((e) => ({ cargando: true, error: null, datos: guardado?.datos ?? e.datos }))
      try {
        const res = await fetch(`/api/fba/inventario?cliente=${clienteId}`, { cache: 'no-store' })
        const cuerpo = (await res.json().catch(() => null)) as { inventario?: InventarioDeCliente; error?: string } | null
        if (vigente.current !== clienteId) return
        if (!res.ok || !cuerpo?.inventario) {
          setEstado({ cargando: false, error: cuerpo?.error ?? 'No se ha podido leer el inventario', datos: null })
          return
        }
        memoria.set(clienteId, { en: Date.now(), datos: cuerpo.inventario })
        setEstado({ cargando: false, error: null, datos: cuerpo.inventario })
      } catch {
        if (vigente.current !== clienteId) return
        setEstado({ cargando: false, error: 'No se ha podido conectar. Revisa la conexión y vuelve a probar.', datos: null })
      }
    },
    [clienteId]
  )

  useEffect(() => {
    void pedir(false)
  }, [pedir])

  return { ...estado, recargar: () => pedir(true) }
}

/**
 * LOS SUPUESTOS DE ALMACENAJE, POR CLIENTE Y EN ESTE NAVEGADOR.
 *
 * Volumen medio por unidad y tarifas: cada cliente vende cosas de tamaños distintos y las
 * tarifas las revisa Amazon cada año. Son ajustes de lectura —no cambian ningún dato—, así
 * que se guardan donde se tocan y no en la base. Si el navegador no deja guardar, se
 * sigue con los valores de siempre.
 */
export function useSupuestosAlmacenaje(clienteId: string): [SupuestosAlmacenaje, (s: SupuestosAlmacenaje) => void] {
  const clave = `fba-almacenaje:${clienteId}`
  const [supuestos, setSupuestos] = useState<SupuestosAlmacenaje>(SUPUESTOS_POR_DEFECTO)

  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(clave)
      if (!crudo) {
        setSupuestos(SUPUESTOS_POR_DEFECTO)
        return
      }
      const p = JSON.parse(crudo) as Partial<SupuestosAlmacenaje>
      const num = (v: unknown, defecto: number) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : defecto)
      setSupuestos({
        litrosPorUnidad: num(p.litrosPorUnidad, SUPUESTOS_POR_DEFECTO.litrosPorUnidad),
        tarifaBaja: num(p.tarifaBaja, SUPUESTOS_POR_DEFECTO.tarifaBaja),
        tarifaAlta: num(p.tarifaAlta, SUPUESTOS_POR_DEFECTO.tarifaAlta),
        recargoAntiguedad: typeof p.recargoAntiguedad === 'number' && p.recargoAntiguedad >= 0 ? p.recargoAntiguedad : null,
      })
    } catch {
      setSupuestos(SUPUESTOS_POR_DEFECTO)
    }
  }, [clave])

  const guardar = useCallback(
    (s: SupuestosAlmacenaje) => {
      setSupuestos(s)
      try {
        window.localStorage.setItem(clave, JSON.stringify(s))
      } catch {
        // Sin almacenamiento (ventana privada): el ajuste vale mientras la pantalla esté abierta
      }
    },
    [clave]
  )

  return [supuestos, guardar]
}
