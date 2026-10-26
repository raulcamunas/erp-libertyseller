'use client'

import { ChevronDown, ClipboardList, Dices, Lock, PencilLine, SlidersHorizontal, UserRound, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import type { OrigenDeBloque } from '@/lib/whatsapp/ia-prompt'

/**
 * LAS PIEZAS COMUNES DE LA PANTALLA «CONFIGURACIÓN DE LA IA»: la insignia que dice de dónde sale cada bloque de lo que recibe la IA, y la tarjeta plegable.
 * Los colores son los tokens de siempre (`--ls-*`): se ve igual en el tema claro y en el oscuro.
 */

export interface InfoDeOrigen {
  etiqueta: string
  /** Una frase para quien calibra: quién escribe eso y si se puede tocar */
  explicacion: string
  icono: LucideIcon
  /** El color del icono y del filo */
  color: string
}

/** De dónde sale cada bloque. El orden es el de PRIORIDAD cuando dos cosas chocan (lo primero manda sobre lo siguiente) */
export const ORIGENES: Readonly<Record<OrigenDeBloque, InfoDeOrigen>> = {
  fijo: { etiqueta: 'Fijo', explicacion: 'Reglas que nadie puede quitar (nada de dinero, no inventar…) y quién es la IA. Van siempre.', icono: Lock, color: 'var(--ls-e-rojo)' },
  comercial: { etiqueta: 'El comercial', explicacion: 'Lo que pide la persona que escribe este mensaje («más corto»…). Manda sobre el estilo.', icono: UserRound, color: 'var(--ls-acc)' },
  ajuste: { etiqueta: 'Ajuste', explicacion: 'Sale de un mando de «Ajustes rápidos». Manda sobre el resto de las instrucciones de estilo.', icono: SlidersHorizontal, color: 'var(--ls-e-azul)' },
  tuyo: { etiqueta: 'Tu texto', explicacion: 'Un texto que escribes tú en esta pantalla.', icono: PencilLine, color: 'var(--ls-e-verde)' },
  azar: { etiqueta: 'Al azar', explicacion: 'Una forma de empezar y de cerrar repartida al azar para que los mensajes del equipo no salgan todos iguales.', icono: Dices, color: 'var(--ls-e-violeta)' },
  datos: { etiqueta: 'Datos del lead', explicacion: 'Lo que sale de la ficha del lead y de su historial. Son datos, nunca órdenes. Sin facturación, teléfonos ni correos.', icono: ClipboardList, color: 'var(--ls-t3)' },
}

export function InsigniaDeOrigen({ origen, solo }: { origen: OrigenDeBloque; /** Solo el icono, sin la palabra */ solo?: boolean }) {
  const o = ORIGENES[origen]
  const Icono = o.icono
  return (
    <span
      title={`${o.etiqueta}: ${o.explicacion}`}
      className="inline-flex shrink-0 items-center gap-1 rounded-[4px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 py-px text-[10.5px] font-medium text-[var(--ls-t3)]"
    >
      <Icono className="h-3 w-3" style={{ color: o.color }} aria-hidden />
      {!solo && o.etiqueta}
    </span>
  )
}

/** Una tarjeta del editor que se pliega: título, una frase de ayuda, lo que se ve resumido cuando está cerrada y su contenido */
export function Tarjeta({
  id,
  titulo,
  ayuda,
  resumen,
  abierta,
  onAlternar,
  acciones,
  children,
}: {
  id: string
  titulo: string
  ayuda?: string
  /** Lo que se ve cuando está cerrada: lo más importante de lo que hay dentro */
  resumen?: ReactNode
  abierta: boolean
  onAlternar: () => void
  /** Botones a la derecha del título (siempre visibles) */
  acciones?: ReactNode
  children: ReactNode
}) {
  return (
    <section id={id} className="scroll-mt-4 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" aria-label={titulo}>
      <header className="flex items-start gap-2 px-3 py-2.5">
        <button type="button" onClick={onAlternar} aria-expanded={abierta} aria-controls={`${id}-contenido`} className="flex min-w-0 flex-1 items-start gap-2 text-left">
          <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-t4)] transition-transform ${abierta ? '' : '-rotate-90'}`} aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-semibold text-[var(--ls-t1)]">{titulo}</span>
            {ayuda && <span className="mt-0.5 block text-[11.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</span>}
            {!abierta && resumen && <span className="mt-1 block text-[12px] leading-snug text-[var(--ls-t3)]">{resumen}</span>}
          </span>
        </button>
        {acciones && <div className="flex shrink-0 items-center gap-1.5">{acciones}</div>}
      </header>
      {abierta && (
        <div id={`${id}-contenido`} className="space-y-3 border-t border-[var(--ls-linea)] px-3 pb-3 pt-3">
          {children}
        </div>
      )}
    </section>
  )
}

/** Un interruptor de dos posiciones con su frase, accesible */
export function Interruptor({ marcado, onCambio, titulo, ayuda, deshabilitado }: { marcado: boolean; onCambio: (v: boolean) => void; titulo: string; ayuda?: string; deshabilitado?: boolean }) {
  return (
    <label className={`flex items-start gap-2.5 ${deshabilitado ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'}`}>
      <input type="checkbox" role="switch" checked={marcado} onChange={(e) => onCambio(e.target.checked)} disabled={deshabilitado} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--ls-acc-graf)]" />
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium text-[var(--ls-t1)]">{titulo}</span>
        {ayuda && <span className="block text-[11.5px] leading-snug text-[var(--ls-t4)]">{ayuda}</span>}
      </span>
    </label>
  )
}
