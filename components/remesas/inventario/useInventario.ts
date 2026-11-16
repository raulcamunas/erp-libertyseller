'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { InventarioDeCliente } from '@/lib/fba/inventario'
import { SUPUESTOS_POR_DEFECTO, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import type { VentasFba } from '@/lib/fba/plan-tipos'
import { leerRespuesta } from '../comun/errores'
import { invalidarRemesas, useAgencia } from '../comun/useAgencia'
import { fecha } from '../formato'
import { n0 } from './formato'

/**
 * LOS DATOS DEL STOCK Y DEL RESUMEN DE UN CLIENTE, DESDE LA PANTALLA (paquete C3).
 *
 * API
 *   useInventario(clienteId)            el inventario (GET /api/fba/inventario), pedido al abrir y recordado 5 min.
 *                                       → { cargando, error, datos, recargar }
 *   useSupuestosAlmacenaje(clienteId)   volumen y tarifas de almacenaje, por cliente y en este navegador
 *   useVentas90(clienteId)              GET /api/fba/ventas?dias=90 con la memoria de useAgencia (la vacía invalidarRemesas)
 *   useLeerDeAmazon(clienteId, alLeer)  «Leer de Amazon» (solo admin: gasta cupo de informes). → { leer(conexionId), leyendo }
 *   useConfirmarPlazos(clienteId, alConfirmar)  «Confirmar plazos» de la banda (PUT parcial de /api/fba/alertas/config)
 */

/* ------------------------------------------------------------------ */
/* Inventario                                                          */
/* ------------------------------------------------------------------ */

const VIGENCIA_MS = 5 * 60 * 1000
const memoria = new Map<string, { en: number; datos: InventarioDeCliente }>()

interface Estado {
  cargando: boolean
  error: string | null
  datos: InventarioDeCliente | null
}

/**
 * No viene con la pantalla de remesas: son los movimientos de varios meses del cliente y quien solo mira un envío no
 * tiene por qué esperarlos. Se pide al abrir la sección y se recuerda cinco minutos (el Resumen y el Stock comparten la
 * misma lectura). El botón de actualizar se salta esa memoria.
 */
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
      // Al actualizar se sigue enseñando lo que hay mientras llega lo nuevo (solo si es de este cliente)
      setEstado((e) => ({ cargando: true, error: null, datos: guardado?.datos ?? (e.datos && vigente.current === clienteId ? e.datos : null) }))
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

/* ------------------------------------------------------------------ */
/* Supuestos de almacenaje                                             */
/* ------------------------------------------------------------------ */

/**
 * Volumen medio por unidad y tarifas: cada cliente vende cosas de tamaños distintos y las tarifas las revisa Amazon cada
 * año. Son ajustes de lectura —no cambian ningún dato—, así que se guardan donde se tocan y no en la base. Si el
 * navegador no deja guardar, se sigue con los valores de siempre. El cliente externo también los ve y los ajusta (D39).
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

/* ------------------------------------------------------------------ */
/* Ventas de 90 días (Resumen)                                         */
/* ------------------------------------------------------------------ */

/** Lo que devuelve GET /api/fba/ventas: VentasFba y de qué copia del libro sale (ver lib/fba/ventas-servidor.ts) */
export type VentasConLectura = VentasFba & { mercado: string | null; leidoHasta: string | null; leidoDesde: string | null; aviso: string | null }

export function useVentas90(clienteId: string | null) {
  return useAgencia<VentasConLectura>(clienteId ? `/api/fba/ventas?cliente=${clienteId}&dias=90` : null, { que: 'No se han podido leer las ventas' })
}

/* ------------------------------------------------------------------ */
/* Leer de Amazon (solo admin)                                         */
/* ------------------------------------------------------------------ */

/**
 * PEDIRLE A AMAZON EL LIBRO MAYOR AHORA.
 *
 * La pasada de la noche lo lee sola, una vez al día. Esto es para cuando hace falta antes —se va a montar un envío y las
 * ventas de los últimos días cuentan— o cuando la pasada ha fallado. Amazon tarda entre uno y varios minutos en preparar
 * el informe y la petición espera a que esté. Si la conexión se corta por el camino, el servidor sigue con lo suyo: un
 * fallo de red no se cuenta como fallo de la lectura, y se dice que mire más tarde.
 */
export function useLeerDeAmazon(clienteId: string, alLeer?: () => void) {
  const [leyendo, setLeyendo] = useState(false)
  const leer = useCallback(
    async (conexionId: string | null) => {
      if (!conexionId) {
        toast.error('Este cliente no tiene la cuenta de Amazon conectada')
        return
      }
      setLeyendo(true)
      try {
        const res = await fetch(`/api/fba/sincronizar?conexion=${encodeURIComponent(conexionId)}`, { method: 'POST' })
        const cuerpo = (await res.json().catch(() => null)) as {
          error?: string; hasta?: string; movimientos?: number
          planificacion?: { guardadas: number; guardado: boolean; aviso: string | null; error: string | null }
        } | null
        if (!res.ok) {
          toast.error(cuerpo?.error ?? 'No se ha podido leer el libro mayor de Amazon')
          return
        }
        toast.success(`Ventas al día: leídas hasta el ${fecha(cuerpo?.hasta)} (${n0(cuerpo?.movimientos ?? 0)} movimientos)`)
        // La antigüedad se lee a la vez y puede fallar sola: se cuenta aparte, no se esconde
        const p = cuerpo?.planificacion
        if (p?.error) toast.warning(`No se ha podido leer la antigüedad de Amazon: ${p.error}`, { duration: 15_000 })
        else if (p && !p.guardado && p.aviso) toast.warning(p.aviso, { duration: 15_000 })
        else if (p?.guardado) toast.success(`Antigüedad de Amazon al día: ${n0(p.guardadas)} referencias`)
        memoria.delete(clienteId)
        invalidarRemesas(clienteId)
        alLeer?.()
      } catch {
        toast.warning('Se ha cortado la conexión con el servidor, pero la lectura puede seguir en marcha. Pulsa «Actualizar» dentro de unos minutos.', { duration: 12_000 })
      } finally {
        setLeyendo(false)
      }
    },
    [clienteId, alLeer]
  )
  return { leer, leyendo }
}

/* ------------------------------------------------------------------ */
/* Confirmar plazos (agencia que edita)                                */
/* ------------------------------------------------------------------ */

export function useConfirmarPlazos(clienteId: string, alConfirmar?: () => void) {
  const [confirmando, setConfirmando] = useState(false)
  const confirmar = useCallback(async () => {
    setConfirmando(true)
    try {
      let res: Response
      try {
        res = await fetch('/api/fba/alertas/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clienteId, confirmarPlazos: true }),
        })
      } catch {
        toast.error('No hay conexión con el servidor: comprueba la red y vuelve a probar.')
        return
      }
      const r = await leerRespuesta<unknown>(res, 'No se han podido confirmar los plazos')
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success('Plazos confirmados: el plan los usa como puestos a mano')
      invalidarRemesas(clienteId)
      alConfirmar?.()
    } finally {
      setConfirmando(false)
    }
  }, [clienteId, alConfirmar])
  return { confirmar, confirmando }
}
