'use client'

import { useCallback } from 'react'
import { Dialogo } from '@/components/plataforma/comun'
import type { RemesaParaMedir } from '@/lib/fba/plazos'
import { AjustesReposicion } from './comun/AjustesReposicion'

/**
 * LOS PLAZOS DE UN CLIENTE EN UN DIÁLOGO (la API de siempre; spec remesas-pro §8 y D10, paquete C5).
 *
 * Antes tenía su propio formulario de etapas (preparación, transporte, recepción, margen) con lo medido al lado. Ahora
 * envuelve el editor único `AjustesReposicion` (components/remesas/comun, S7), que hace eso mismo y además: el origen de
 * cada etapa (a mano, medido, de partida), «Confirmar plazos», los plazos por referencia y los ajustes del planificador
 * (cobertura, caja, mínimos, capacidad, temporada y avisos). Guarda contra /api/fba/alertas/config y
 * /api/fba/reposicion-config con PUT parcial.
 *
 * Misma API externa que antes, para no tocar a quien lo abre:
 *   <PlazosDialog clienteId clienteNombre remesas hoy onCerrar onGuardado />
 * `remesas` y `hoy` se siguen aceptando pero ya no hacen falta: lo medido lo calcula el servidor (medidas del cliente,
 * con el libro de Amazon). Al guardar: `onGuardado()` (el `router.refresh()` de siempre) y se cierra, como antes.
 *
 * Quien lo abre ya ha comprobado que puede editar (el botón solo sale a la agencia con permiso); si no, las rutas
 * contestan 403 y el editor lo dice.
 */
export function PlazosDialog({
  clienteId,
  clienteNombre,
  onCerrar,
  onGuardado,
}: {
  clienteId: string
  clienteNombre: string
  /** Ya no se usa (lo medido sale del servidor); se acepta para no cambiar a quien lo abre */
  remesas?: readonly RemesaParaMedir[]
  /** Ya no se usa; se acepta para no cambiar a quien lo abre */
  hoy?: string
  onCerrar: () => void
  onGuardado: () => void
}) {
  const alGuardar = useCallback(() => {
    onGuardado()
    onCerrar()
  }, [onGuardado, onCerrar])

  return (
    <Dialogo
      titulo={`Plazos y reposición de ${clienteNombre}`}
      entradilla="Cuánto tarda desde que le avisamos hasta que su mercancía está a la venta en Amazon, y cuánto se le envía cada vez. De aquí salen el plan de reposición y los avisos de «reponer»."
      onCerrar={onCerrar}
      ancho="max-w-[760px]"
    >
      <AjustesReposicion clienteId={clienteId} clienteNombre={clienteNombre} puedeEditar alGuardar={alGuardar} />
    </Dialogo>
  )
}
