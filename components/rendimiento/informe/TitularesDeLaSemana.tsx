'use client'

import { Check, Copy, ListChecks } from 'lucide-react'
import { useState } from 'react'
import type { Titular, TipoDeTitular } from '@/lib/rendimiento/informe'

/**
 * LO MÁS IMPORTANTE DE LA SEMANA, EN FRASES.
 *
 * Es lo primero que se lee en la reunión: lo que ha pasado, escrito, con un punto de color por si es buena noticia
 * (verde), algo a mirar (ámbar) o un dato (gris). Salen de las mismas cifras de más abajo, no de una opinión.
 */

const PUNTO: Record<TipoDeTitular, string> = {
  bien: 'bg-emerald-400',
  aviso: 'bg-amber-400',
  info: 'bg-white/30',
}

const ETIQUETA: Record<TipoDeTitular, string> = {
  bien: 'Buena noticia',
  aviso: 'A mirar',
  info: 'Dato',
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
    <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5" aria-label="Titulares de la semana">
      <div className="flex items-center justify-between gap-3 mb-3">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
          <ListChecks className="h-4 w-4 text-[#FF6600]" /> Lo más importante de la semana
        </h2>
        {titulares.length > 0 && (
          <button
            type="button"
            onClick={copiar}
            className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 h-7 text-[11px] text-white/55 hover:text-white hover:border-white/25 transition-colors"
          >
            {copiado ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
            {copiado ? 'Copiado' : 'Copiar'}
          </button>
        )}
      </div>

      {titulares.length === 0 ? (
        <p className="text-[13px] text-white/40">Todavía no hay nada que destacar de esta semana.</p>
      ) : (
        <ul className="grid gap-x-8 gap-y-2.5 lg:grid-cols-2">
          {titulares.map((t, i) => (
            <li key={i} className="flex items-start gap-2.5 text-[14px] leading-snug text-white/80">
              <span className={`mt-[7px] h-2 w-2 shrink-0 rounded-full ${PUNTO[t.tipo]}`} title={ETIQUETA[t.tipo]} aria-label={ETIQUETA[t.tipo]} />
              <span>{t.texto}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
