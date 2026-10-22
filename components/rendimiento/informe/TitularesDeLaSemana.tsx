'use client'

import { Check, Copy, ListChecks, TrendingUp, TriangleAlert } from 'lucide-react'
import { useState, type CSSProperties } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Titular, TipoDeTitular } from '@/lib/rendimiento/informe'
import { CabeceraDePanel, PANEL } from '../ui'

/**
 * LO MÁS IMPORTANTE DE LA SEMANA, EN FRASES.
 *
 * Es lo primero que se lee en la reunión: lo que ha pasado, escrito. Cada frase lleva un glifo y un color por si es
 * buena noticia (flecha verde), algo a mirar (triángulo ámbar) o un dato (punto gris): la forma va antes que el
 * color, así que se entiende también sin distinguir tonos. Salen de las mismas cifras de más abajo, no de una opinión.
 */

const TONO: Record<TipoDeTitular, string> = {
  bien: COLOR_ESTADO.verde,
  aviso: COLOR_ESTADO.ambar,
  info: 'var(--ls-t4)',
}

const ETIQUETA: Record<TipoDeTitular, string> = {
  bien: 'Buena noticia',
  aviso: 'A mirar',
  info: 'Dato',
}

function Glifo({ tipo }: { tipo: TipoDeTitular }) {
  const color = TONO[tipo]
  return (
    <span className="mt-px flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px]" style={{ color, background: `color-mix(in srgb, ${color} 15%, transparent)` }} title={ETIQUETA[tipo]} aria-label={ETIQUETA[tipo]}>
      {tipo === 'bien' ? <TrendingUp className="h-3 w-3" aria-hidden /> : tipo === 'aviso' ? <TriangleAlert className="h-3 w-3" aria-hidden /> : <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
    </span>
  )
}

interface Props {
  titulares: Titular[]
  /** «Semana del 19 al 25 de octubre de 2026»: encabeza el texto que se copia */
  encabezadoParaCopiar: string
}

export function TitularesDeLaSemana({ titulares, encabezadoParaCopiar }: Props) {
  const [copiado, setCopiado] = useState(false)

  const copiar = async () => {
    const texto = `${encabezadoParaCopiar}\n\n${titulares.map((t) => `· ${t.texto}`).join('\n')}`
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch {
      // Sin permiso para el portapapeles (o en una pestaña sin foco) no pasa nada: el texto sigue en pantalla
    }
  }

  return (
    <section className={`${PANEL} rend-aparece overflow-hidden`} aria-label="Titulares de la semana">
      <CabeceraDePanel
        icono={<ListChecks className="h-3.5 w-3.5" />}
        titulo="Lo más importante de la semana"
        derecha={
          titulares.length > 0 ? (
            <button
              type="button"
              onClick={copiar}
              className="flex h-6 items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] px-2.5 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
            >
              {copiado ? <Check className="h-3 w-3 text-[var(--ls-e-verde)]" /> : <Copy className="h-3 w-3" />}
              {copiado ? 'Copiado' : 'Copiar'}
            </button>
          ) : undefined
        }
      />

      <div className="p-3">
        {titulares.length === 0 ? (
          <p className="text-[13px] text-[var(--ls-t4)]">Todavía no hay nada que destacar de esta semana.</p>
        ) : (
          <ul className="grid gap-x-8 gap-y-2 lg:grid-cols-2">
            {titulares.map((t, i) => (
              <li key={i} className="rend-entra flex items-start gap-2.5 text-[13.5px] leading-snug text-[var(--ls-t2)]" style={{ '--d': i } as CSSProperties}>
                <Glifo tipo={t.tipo} />
                <span>{t.texto}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
