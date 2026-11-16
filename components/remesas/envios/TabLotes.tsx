'use client'

import { GanttChartSquare, RefreshCw } from 'lucide-react'
import { EsqueletoTarjeta, EstadoVacio } from '@/components/ui-ls'
import { DetalleLote, NotaFifo } from '../lotes/VistaLotes'
import { useLotes } from '../lotes/useLotes'

/**
 * LA PESTAÑA «LOTES» DE UN ENVÍO (spec remesas-pro §5.3): el FIFO de ESTE envío. Cuánto tardó en llegar, cuánto le duró
 * la venta (o cuánto le queda), el embudo al 100 % —vendidas, retiradas o mermas, quedan y no llegaron—, su curva de
 * consumo frente a los 8 últimos envíos agotados y sus referencias con la insignia «Lote vivo».
 *
 * Los lotes se piden por cliente (GET /api/fba/lotes, memoria de 5 min compartida con la sección Lotes): cambiar de
 * envío no vuelve a pedir nada.
 */
export function TabLotes({ remesaId, clienteId, hoy }: { remesaId: string; clienteId: string; hoy: string }) {
  const { lotes, resumen, ritmo, hayDatos, cargando, error, recargar } = useLotes(clienteId)
  const lote = lotes.find((l) => l.remesaId === remesaId) ?? null

  if (!hayDatos && cargando) return <EsqueletoTarjeta />
  if (!hayDatos && error) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
        <EstadoVacio compacto icono={GanttChartSquare} titulo="No se han podido calcular los lotes" descripcion={error} accion={{ texto: 'Volver a probar', icono: RefreshCw, onClick: () => void recargar() }} />
      </div>
    )
  }
  if (!lote) {
    return (
      <div className="space-y-3">
        <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
          <EstadoVacio
            compacto
            icono={GanttChartSquare}
            acento="remesas"
            titulo="Este envío todavía no tiene lote"
            descripcion="El lote nace cuando el envío sale hacia Amazon (enviado o cerrado). Si acabas de importarlo, vuelve en unos minutos."
          />
        </div>
        <NotaFifo />
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <DetalleLote lote={lote} lotes={lotes} resumen={resumen} hoy={hoy} />
      <NotaFifo ritmo={ritmo} />
    </div>
  )
}
