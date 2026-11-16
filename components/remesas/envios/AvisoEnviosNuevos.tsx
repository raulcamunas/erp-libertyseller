'use client'

import { PackagePlus } from 'lucide-react'
import { Boton } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { cx } from '../comun/ui'

/**
 * «HAY N ENVÍOS NUEVOS EN AMAZON… [IMPORTAR]» (spec remesas-pro §11 D41).
 *
 * El aviso de siempre de la pantalla de Envíos (antes en EspacioRemesas.tsx): Amazon tiene en la cuenta del cliente envíos
 * que el ERP todavía no conoce. Solo sale si hay alguno y quien mira puede importarlos (`nuevos` ya viene filtrado con
 * `nuevosDe` de useEnviosNuevos.ts). El botón abre «Importar pedidos» (el diálogo lo monta quien tiene el estado).
 */
export function AvisoEnviosNuevos({ nuevos, onImportar, className }: { nuevos: number; onImportar: () => void; className?: string }) {
  if (!(nuevos > 0)) return null
  const ambar = COLOR_ESTADO.ambar
  return (
    <div
      role="status"
      className={cx(
        'ls-aparecer flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] border px-4 py-3 text-[13px] text-[var(--ls-t1)]',
        className
      )}
      style={{ borderColor: `color-mix(in srgb, ${ambar} 35%, var(--ls-linea))`, background: `color-mix(in srgb, ${ambar} 8%, var(--ls-sup))` }}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px]" style={{ background: `color-mix(in srgb, ${ambar} 16%, transparent)`, color: ambar }}>
        <PackagePlus className="h-4 w-4" aria-hidden />
      </span>
      <p className="min-w-0 flex-1 leading-[1.45]">
        {nuevos === 1 ? 'Hay 1 envío nuevo en Amazon que todavía no está en el ERP' : `Hay ${nuevos.toLocaleString('es-ES')} envíos nuevos en Amazon que todavía no están en el ERP`}
        <span className="block text-[12px] text-[var(--ls-t3)]">Impórtalos para que cuenten en el stock, las ventas y el plan.</span>
      </p>
      <Boton tamano="sm" icono={PackagePlus} onClick={onImportar}>
        Importar
      </Boton>
    </div>
  )
}
