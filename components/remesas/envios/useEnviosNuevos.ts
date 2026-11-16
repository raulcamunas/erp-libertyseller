'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * CUÁNTOS ENVÍOS NUEVOS TIENE CADA CLIENTE EN AMAZON (los que el ERP todavía no conoce): lo que enciende las insignias de «Importar pedidos»
 * (la barra de clientes, las tarjetas de salud de Hoy y el aviso de la sección Envíos).
 *
 * Se pide DESPUÉS de pintar la pantalla, una sola vez, y el servidor lo guarda 10 minutos (lib/fba/envios-nuevos-servidor.ts): abrir Remesas no espera a Amazon. Si falla, no se
 * enseña nada y no se avisa: es un aviso de comodidad, la pantalla funciona igual sin él.
 *
 * API
 *   useEnviosNuevosDeTodos(activo) → { porCliente: { [clienteId]: n }, cargando, refrescar() }
 *   nuevosDe(porCliente, clienteId, puedeEditar) → n   (solo cuentan para quien puede importar)
 */
export function useEnviosNuevosDeTodos(activo: boolean): { porCliente: Record<string, number>; cargando: boolean; refrescar: () => void } {
  const [porCliente, setPorCliente] = useState<Record<string, number>>({})
  const [cargando, setCargando] = useState(false)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    if (!activo) return
    let vivo = true
    setCargando(true)
    fetch('/api/fba/remesas/envios-nuevos?todos=1')
      .then((r) => (r.ok ? r.json() : null))
      .then((p: { clientes?: Array<{ clienteId: string; nuevos: number }> } | null) => {
        if (!vivo || !p?.clientes) return
        setPorCliente(Object.fromEntries(p.clientes.map((c) => [c.clienteId, c.nuevos])))
      })
      .catch(() => undefined)
      .finally(() => vivo && setCargando(false))
    return () => {
      vivo = false
    }
  }, [activo, vuelta])

  const refrescar = useCallback(() => setVuelta((v) => v + 1), [])
  return { porCliente, cargando, refrescar }
}

/** Los envíos nuevos de un cliente, solo si quien mira puede importarlos (si no, el aviso no le sirve de nada) */
export function nuevosDe(porCliente: Record<string, number>, clienteId: string, puedeEditar: boolean): number {
  if (!puedeEditar) return 0
  const n = porCliente[clienteId] ?? 0
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
}
