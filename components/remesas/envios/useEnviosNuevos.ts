'use client'

import { useCallback, useEffect, useState } from 'react'

/**
 * CUÁNTOS ENVÍOS NUEVOS TIENE CADA CLIENTE EN AMAZON (los que el ERP todavía no conoce): lo que enciende las insignias de «Importar pedidos».
 *
 * Se pide DESPUÉS de pintar la pantalla, una sola vez, y el servidor lo guarda 10 minutos (lib/fba/envios-nuevos-servidor.ts): abrir Remesas no espera a Amazon. Si falla, no se
 * enseña nada y no se avisa: es un aviso de comodidad, la pantalla funciona igual sin él.
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
