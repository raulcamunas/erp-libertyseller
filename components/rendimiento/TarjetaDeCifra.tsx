'use client'

import type { CSSProperties, ReactNode } from 'react'
import type { Variacion } from '@/lib/rendimiento/comparativa'
import { Delta, IconoEnCaja, MiniBarras, Numero } from './ui'

/**
 * UNA CIFRA GRANDE: lo que ha hecho una persona (o el equipo) en el periodo, con su cambio y sus siete días.
 *
 *   ┌──────────────────────────────┐
 *   │ ▣ Llamadas hechas   ▼ −38 %  │   el cambio frente a la referencia, en una píldora
 *   │ 34                  ▂▃▅▇▅▃▆  │   la cifra cuenta hasta su valor; a la derecha, sus últimos días
 *   │ 12 contestadas · 35 %        │
 *   └──────────────────────────────┘
 *
 * La usan el panel (cifras de una persona) y el informe semanal (cifras del equipo). Si se le pasa `onClick` es un
 * botón: pulsarla lleva a la lista que hay detrás de la cifra.
 */

export interface PropsDeTarjetaDeCifra {
  icono: ReactNode
  titulo: string
  valor: number
  /** Cómo se escribe: «34», «31 %», «1 h 05 min». Recibe el valor intermedio mientras cuenta */
  formato?: (n: number) => string
  detalle?: ReactNode
  cambio?: Variacion | null
  /** Con qué se compara, para el texto que sale al pasar el ratón por el cambio */
  contra?: string
  /** Sus últimos días, en barritas */
  barras?: { valores: ReadonlyArray<number | null>; anteriores?: ReadonlyArray<number | null>; etiquetas?: ReadonlyArray<string>; formato?: (n: number) => string; resaltar?: number }
  /** La primera de la fila: lleva un velo de naranja */
  destacada?: boolean
  /** La que se está mirando (en el informe, la que enseña la tabla de debajo) */
  seleccionada?: boolean
  onClick?: () => void
  ayuda?: string
  /** En vez de la cifra, un guion (no hay de dónde sacarla: sin Rinkel vinculado) */
  sinDato?: boolean
  /** Escalón de la animación de entrada */
  indice?: number
}

export function TarjetaDeCifra({ icono, titulo, valor, formato, detalle, cambio = null, contra = 'el periodo anterior', barras, destacada = false, seleccionada = false, onClick, ayuda, sinDato = false, indice = 0 }: PropsDeTarjetaDeCifra) {
  const clases = `rend-aparece group relative flex min-w-0 flex-col overflow-hidden rounded-[10px] border p-2.5 text-left transition-[background-color,border-color,box-shadow,translate] duration-200 ${
    seleccionada
      ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)]'
      : destacada
        ? 'border-[var(--ls-linea)] bg-[var(--ls-sup)] bg-[linear-gradient(135deg,var(--ls-acc-suave),transparent_62%)]'
        : 'border-[var(--ls-linea)] bg-[var(--ls-sup)]'
  } ${onClick ? 'cursor-pointer hover:-translate-y-px hover:border-[var(--ls-linea2)] hover:shadow-[0_8px_20px_-12px_rgba(0,0,0,0.7)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]' : ''}`

  const contenido = (
    <>
      <span className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
          <IconoEnCaja>{icono}</IconoEnCaja>
          <span className="truncate">{titulo}</span>
        </span>
        {!sinDato && <Delta v={cambio} contra={contra} />}
      </span>

      <span className="mt-2 flex items-end justify-between gap-2">
        <span className="text-[26px] font-semibold leading-none tabular-nums text-[var(--ls-t1)]">{sinDato ? '—' : <Numero valor={valor} formato={formato} />}</span>
        {barras && !sinDato && <MiniBarras valores={barras.valores} anteriores={barras.anteriores} etiquetas={barras.etiquetas} formato={barras.formato} resaltar={barras.resaltar} alto={26} nombre={titulo} />}
      </span>

      <span className="mt-1.5 block min-h-[16px] truncate text-[11.5px] text-[var(--ls-t4)]" title={typeof detalle === 'string' ? detalle : undefined}>
        {detalle}
      </span>
    </>
  )

  const estilo = { '--d': indice } as CSSProperties

  return onClick ? (
    <button type="button" onClick={onClick} aria-pressed={seleccionada || undefined} title={ayuda ? `${ayuda}. Pulsa para ver el detalle` : 'Pulsa para ver el detalle'} className={clases} style={estilo}>
      {contenido}
    </button>
  ) : (
    <div title={ayuda} className={clases} style={estilo}>
      {contenido}
    </div>
  )
}
