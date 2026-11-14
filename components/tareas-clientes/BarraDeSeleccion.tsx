'use client'

import { useState } from 'react'
import { Archive, ArrowRightLeft, Loader2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { OpcionDeEstado } from '@/lib/tareas-clientes/tipos'
import { Etiqueta } from './ui'

/**
 * LA BARRA DE LO SELECCIONADO: aparece abajo, en el centro, en cuanto hay una o más tareas marcadas. «Mover a…» las lleva todas a una columna (al final de ella) y «Archivar» las
 * archiva (no se borran: se recuperan; en Notion van a la papelera). La equis (o Escape) quita la selección.
 */
export function BarraDeSeleccion({ cantidad, columnas, ocupada, onMover, onArchivar, onQuitar }: { cantidad: number; columnas: readonly OpcionDeEstado[]; ocupada: boolean; onMover: (estado: string) => void; onArchivar: () => void; onQuitar: () => void }) {
  const [menu, setMenu] = useState(false)
  return (
    <div className="tc-seleccion-barra" role="toolbar" aria-label="Acciones sobre las tareas seleccionadas">
      <span className="tc-seleccion-cuenta" aria-live="polite"><b>{cantidad}</b> {cantidad === 1 ? 'seleccionada' : 'seleccionadas'}</span>
      <span className="tc-seleccion-sep" />
      <Popover open={menu} onOpenChange={setMenu}>
        <PopoverTrigger asChild>
          <button type="button" disabled={ocupada} className="tc-seleccion-boton"><ArrowRightLeft className="h-3.5 w-3.5" /> Mover a…</button>
        </PopoverTrigger>
        <PopoverContent side="top" align="center" className="!w-[230px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-1.5 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
          <p className="tc-lat-rotulo !pt-1.5">Mover a la columna</p>
          <div className="flex max-h-[260px] flex-col gap-px overflow-auto">
            {columnas.map((c) => (
              <button key={c.nombre} type="button" className="tc-opcion" onClick={() => { setMenu(false); onMover(c.nombre) }}>
                <Etiqueta color={c.color}>{c.nombre}</Etiqueta>
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <button type="button" disabled={ocupada} onClick={onArchivar} className="tc-seleccion-boton tc-seleccion-peligro"><Archive className="h-3.5 w-3.5" /> Archivar</button>
      {ocupada && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t3)]" aria-label="Aplicando" />}
      <span className="tc-seleccion-sep" />
      <button type="button" onClick={onQuitar} aria-label="Quitar la selección" title="Quitar la selección (Esc)" className="tc-icono-boton"><X className="h-3.5 w-3.5" /></button>
    </div>
  )
}
