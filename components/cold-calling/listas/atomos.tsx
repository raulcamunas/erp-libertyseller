'use client'

import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { useEffect, useRef, type ReactNode } from 'react'
import { ETIQUETA_DE_TIPO_DE_LISTA, porcentajeTexto, type TipoDeLista } from '@/lib/cold-calling/listas'
import { segmentosDeEstados } from '@/lib/cold-calling/listas-vista'
import { BOTON, COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { COLD_STATUS_LABELS } from '@/lib/types/cold-leads'
import { ESTADO_VISUAL, tinte } from '../ui'

/**
 * LAS PIEZAS PEQUEÑAS DE LA PANTALLA DE LISTAS: lo que se repite en las cuatro pestañas.
 * Todo con los tokens de lib/estilo/denso.ts: ni un color ni una medida sueltos.
 */

export const numero = (n: number) => n.toLocaleString('es-ES')

/**
 * El último valor que no fue null. Una ventana se cierra con una animación de salida durante la cual su contenido sigue a la vista: si el estado que la alimenta pasa a
 * null en el mismo instante, se vería un destello de «Mover 0 leads» o de «Asignar «»». Con esto la ventana se desvanece mostrando lo último que enseñaba.
 */
export function useConservar<T>(valor: T | null): T | null {
  const ultimo = useRef<T | null>(valor)
  if (valor !== null) ultimo.current = valor
  return ultimo.current
}

/* ------------------------------------------------------------------ */
/* Selectores                                                          */
/* ------------------------------------------------------------------ */

export interface OpcionDeSelector {
  valor: string
  etiqueta: string
  /** Agrupa las opciones en un <optgroup> */
  grupo?: string
  desactivada?: boolean
}

/** Un desplegable nativo con el aspecto de un chip de filtro. `rotulo` es lo que lee un lector de pantalla */
export function Selector({ valor, onCambiar, opciones, rotulo, ancho = 'max-w-[190px]', className = '' }: { valor: string; onCambiar: (v: string) => void; opciones: readonly OpcionDeSelector[]; rotulo: string; ancho?: string; className?: string }) {
  const grupos = [...new Set(opciones.map((o) => o.grupo).filter((g): g is string => !!g))]
  const sueltas = opciones.filter((o) => !o.grupo)
  const pinta = (o: OpcionDeSelector) => (
    <option key={o.valor} value={o.valor} disabled={o.desactivada} className="bg-[var(--ls-sup)]">
      {o.etiqueta}
    </option>
  )
  return (
    <select value={valor} onChange={(e) => onCambiar(e.target.value)} aria-label={rotulo} title={rotulo} className={`${BOTON.chip} !h-7 ${ancho} cursor-pointer !pr-1.5 outline-none ${className}`}>
      {sueltas.map(pinta)}
      {grupos.map((g) => (
        <optgroup key={g} label={g} className="bg-[var(--ls-sup)]">
          {opciones.filter((o) => o.grupo === g).map(pinta)}
        </optgroup>
      ))}
    </select>
  )
}

/* ------------------------------------------------------------------ */
/* Casilla                                                             */
/* ------------------------------------------------------------------ */

/** Una casilla de verdad (accesible con teclado) que admite el estado «a medias» de la cabecera de una tabla */
export function Casilla({ marcada, aMedias = false, onCambiar, rotulo, desactivada = false }: { marcada: boolean; aMedias?: boolean; onCambiar: () => void; rotulo: string; desactivada?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = aMedias && !marcada
  }, [aMedias, marcada])
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={marcada}
      disabled={desactivada}
      onChange={onCambiar}
      aria-label={rotulo}
      className="h-[14px] w-[14px] cursor-pointer rounded-[3px] accent-[var(--ls-acc-relleno)] disabled:cursor-default disabled:opacity-40"
    />
  )
}

/* ------------------------------------------------------------------ */
/* Barras                                                              */
/* ------------------------------------------------------------------ */

/** Cuánto de una lista se ha trabajado: una barra fina con el porcentaje al lado */
export function BarraDeUso({ pct, titulo, ancho = 'w-[84px]' }: { pct: number; titulo?: string; ancho?: string }) {
  const relleno = Math.max(0, Math.min(1, pct))
  return (
    <span className="inline-flex items-center gap-1.5" title={titulo}>
      <span className={`relative inline-block h-[6px] ${ancho} overflow-hidden rounded-full bg-[var(--ls-sup3)]`} role="img" aria-label={`${porcentajeTexto(relleno)} trabajado`}>
        <span className="absolute inset-y-0 left-0 rounded-full bg-[var(--ls-acc-relleno)]" style={{ width: `${relleno * 100}%` }} />
      </span>
      <span className="w-[38px] text-right text-[11.5px] tabular-nums text-[var(--ls-t2)]">{porcentajeTexto(relleno)}</span>
    </span>
  )
}

/** Cómo se reparten los leads entre los siete estados, en una barra apilada con los colores de los estados */
export function BarraDeEstados({ estados, ancho = 'w-[120px]' }: { estados: Record<string, number>; ancho?: string }) {
  const segmentos = segmentosDeEstados(estados)
  const total = segmentos.reduce((s, x) => s + x.n, 0)
  const titulo = segmentos.map((s) => `${COLD_STATUS_LABELS[s.estado]}: ${numero(s.n)}`).join(' · ')
  if (total === 0) return <span className="text-[11.5px] text-[var(--ls-t4)]">—</span>
  return (
    <span className={`flex h-[8px] ${ancho} gap-px overflow-hidden rounded-[3px] bg-[var(--ls-sup3)]`} title={titulo} role="img" aria-label={titulo}>
      {segmentos.map((s) => (
        <span key={s.estado} style={{ width: `${(s.n / total) * 100}%`, minWidth: 2, background: COLOR_ESTADO[ESTADO_VISUAL[s.estado].tono] }} />
      ))}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Insignias                                                           */
/* ------------------------------------------------------------------ */

const TONO_DE_TIPO: Record<TipoDeLista, TonoEstado> = { seller_amazon: 'naranja', tienda_online: 'azul', mixto: 'violeta' }

/** «Venden en Amazon» / «No venden en Amazon» / «Mezcla». Una lista vacía no es de ningún tipo */
export function InsigniaDeTipo({ tipo }: { tipo: TipoDeLista | null }) {
  if (!tipo) return <span className="text-[11.5px] text-[var(--ls-t4)]">—</span>
  const tono = TONO_DE_TIPO[tipo]
  return (
    <span className="inline-flex h-[18px] items-center whitespace-nowrap rounded-[4px] px-1.5 text-[10.5px] font-medium leading-none" style={{ color: COLOR_ESTADO[tono], background: tinte(tono) }}>
      {ETIQUETA_DE_TIPO_DE_LISTA[tipo]}
    </span>
  )
}

/** Un estado de lead: el glifo y la palabra */
export function EstadoDelLead({ estado }: { estado: keyof typeof COLD_STATUS_LABELS }) {
  const v = ESTADO_VISUAL[estado]
  if (!v) return <span className="text-[11.5px] text-[var(--ls-t3)]">{estado}</span>
  const Icono = v.icono
  return (
    <span className="inline-flex items-center gap-[5px] whitespace-nowrap text-[11.5px] text-[var(--ls-t2)]">
      <Icono aria-hidden className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[v.tono] }} />
      {COLD_STATUS_LABELS[estado]}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Paginador y estados vacíos                                          */
/* ------------------------------------------------------------------ */

export function Paginador({ pagina, porPagina, total, onPagina, cargando }: { pagina: number; porPagina: number; total: number; onPagina: (p: number) => void; cargando: boolean }) {
  const paginas = Math.max(1, Math.ceil(total / porPagina))
  return (
    <div className="flex items-center gap-2 text-[11.5px] text-[var(--ls-t3)]">
      {cargando && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-label="Cargando" />}
      <button type="button" className={`${BOTON.base} ${BOTON.secundario}`} disabled={pagina <= 0 || cargando} onClick={() => onPagina(pagina - 1)} aria-label="Página anterior">
        <ChevronLeft className="h-3 w-3" aria-hidden /> Anterior
      </button>
      <span className="tabular-nums">
        Página {numero(pagina + 1)} de {numero(paginas)}
      </span>
      <button type="button" className={`${BOTON.base} ${BOTON.secundario}`} disabled={pagina >= paginas - 1 || cargando} onClick={() => onPagina(pagina + 1)} aria-label="Página siguiente">
        Siguiente <ChevronRight className="h-3 w-3" aria-hidden />
      </button>
    </div>
  )
}

export function Vacio({ children }: { children: ReactNode }) {
  return <div className="flex min-h-[120px] items-center justify-center px-6 py-8 text-center text-[12.5px] text-[var(--ls-t3)]">{children}</div>
}
