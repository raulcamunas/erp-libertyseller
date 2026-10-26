'use client'

import { ArrowRight, ChevronDown, Loader2, Sparkles, Voicemail } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { createClient } from '@/lib/supabase/client'
import { turnosLegibles, vistaDelResumen } from '@/lib/transcripcion/pantalla'
import { COLOR_DE_INTERES } from '@/lib/transcripcion/reglas'
import { ETIQUETA_DE_INTERES, ETIQUETA_DE_QUIEN, type QuienHabla, type ResumenDeLlamadaGuardado, type TurnoDeLaLlamada } from '@/lib/transcripcion/tipos'

/**
 * LO QUE SE HABLÓ EN UNA LLAMADA, DEBAJO DE ELLA.
 *
 * Lo escribe la IA a partir de la grabación unos minutos después de colgar (proceso `rinkel-transcribir`, migración 244): un resumen de una a tres
 * frases, el interés que mostró el cliente, el siguiente paso acordado y —plegados— la línea de la conversación y la transcripción entera. Es una
 * ayuda para no tener que escuchar la grabación, no el acta de la llamada: la transcripción es automática y puede confundir un nombre o a quién se
 * atribuye una frase. La transcripción entera se enseña como una conversación («Comercial» y «Cliente») cuando la IA ya ha separado quién habla (migración
 * 253; lo deduce por lo que se dice, así que puede equivocarse) y, si no, corrida. Queda a un clic y la grabación sigue ahí.
 *
 * Según el estado se enseña una cosa u otra (lib/transcripcion/pantalla.ts): el bloque, una línea de «buzón de voz», «transcribiendo…», o el
 * motivo de que no haya resumen. Cuando no hay nada aprovechable (silencio, un «¿diga?») no se pinta nada.
 */

const COLOR_DE_QUIEN: Record<QuienHabla, string> = { comercial: COLOR_ESTADO.azul, cliente: COLOR_ESTADO.verde, los_dos: COLOR_ESTADO.gris }

function Etiqueta({ quien }: { quien: QuienHabla }) {
  const color = COLOR_DE_QUIEN[quien]
  return (
    <span className="mr-1.5 inline-block rounded-[4px] px-1 py-px align-baseline text-[10.5px] font-medium" style={{ color, background: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      {ETIQUETA_DE_QUIEN[quien]}
    </span>
  )
}

/** La transcripción entera: se pide cuando se abre, porque es larga y casi nadie la lee */
function TranscripcionCompleta({ llamadaId }: { llamadaId: string }) {
  const supabase = useMemo(() => createClient(), [])
  const [estado, setEstado] = useState<{ tipo: 'cargando' } | { tipo: 'lista'; texto: string; turnos: TurnoDeLaLlamada[] | null } | { tipo: 'error' }>({ tipo: 'cargando' })

  useEffect(() => {
    let activo = true
    void (async () => {
      const leer = (campos: string) => supabase.from('rinkel_transcripciones').select(campos).eq('llamada_id', llamadaId).maybeSingle()
      // Con la migración 253 viene también quién habla. Sin ella esa columna no existe y la consulta falla: se pide solo el texto y se enseña corrido
      let { data, error } = await leer('transcripcion, turnos')
      if (error) ({ data, error } = await leer('transcripcion'))
      if (!activo) return
      const fila = data as unknown as { transcripcion?: string | null; turnos?: unknown } | null
      const texto = fila?.transcripcion
      setEstado(error || typeof texto !== 'string' ? { tipo: 'error' } : { tipo: 'lista', texto, turnos: turnosLegibles(fila?.turnos) })
    })()
    return () => {
      activo = false
    }
  }, [supabase, llamadaId])

  if (estado.tipo === 'cargando') {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Cargando la transcripción…
      </p>
    )
  }
  if (estado.tipo === 'error') return <p className="mt-2 text-[11.5px] text-[var(--ls-t4)]">No se ha podido cargar la transcripción.</p>
  return (
    <div className="mt-2">
      <div className="max-h-56 overflow-y-auto rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-fondo)] px-2.5 py-2 text-[12px] leading-relaxed text-[var(--ls-t2)]">
        {estado.turnos ? (
          <ol className="space-y-1.5">
            {estado.turnos.map((t, i) => (
              <li key={i}>
                <Etiqueta quien={t.quien} />
                {t.texto}
              </li>
            ))}
          </ol>
        ) : (
          <p className="whitespace-pre-wrap">{estado.texto}</p>
        )}
      </div>
      <p className="mt-1 text-[10.5px] text-[var(--ls-t4)]">
        {estado.turnos ? 'Texto automático. Quién habla lo deduce la IA por lo que se dice y puede equivocarse.' : 'Texto automático, sin separar quién habla: puede tener errores.'}
      </p>
    </div>
  )
}

export function ResumenDeLlamada({ resumen }: { resumen: ResumenDeLlamadaGuardado }) {
  const vista = vistaDelResumen(resumen)
  const [linea, setLinea] = useState(false)
  const [texto, setTexto] = useState(false)

  if (vista === 'nada') return null

  if (vista === 'procesando') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Transcribiendo la llamada…
      </p>
    )
  }

  if (vista === 'buzon') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
        <Voicemail className="h-3 w-3 shrink-0" aria-hidden /> Buzón de voz, sin conversación.
      </p>
    )
  }

  if (vista === 'sin_resumen') {
    return (
      <p className="mt-1 truncate text-[11px] text-[var(--ls-t4)]" title={resumen.motivo ?? undefined}>
        Sin resumen{resumen.motivo ? `: ${resumen.motivo}` : '.'}
      </p>
    )
  }

  const interes = resumen.interes && resumen.interes !== 'no_claro' ? resumen.interes : null
  const colorDeInteres = interes ? COLOR_ESTADO[COLOR_DE_INTERES[interes]] : null
  const momentos = resumen.linea ?? []

  return (
    <div className="rend-entra mt-1.5 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2">
      <div className="mb-1 flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ls-t3)]">
          <Sparkles className="h-3 w-3 text-[var(--ls-acc)]" aria-hidden /> Resumen de la llamada
        </span>
        {interes && colorDeInteres && (
          <span className="rounded-[4px] px-1.5 py-px text-[10.5px] font-medium" style={{ color: colorDeInteres, background: `color-mix(in srgb, ${colorDeInteres} 14%, transparent)` }}>
            {ETIQUETA_DE_INTERES[interes]}
          </span>
        )}
      </div>

      <p className="text-[12.5px] leading-snug text-[var(--ls-t2)]">{resumen.resumen}</p>

      {resumen.siguiente_paso && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-snug text-[var(--ls-t1)]">
          <ArrowRight className="mt-[3px] h-3 w-3 shrink-0 text-[var(--ls-acc)]" aria-hidden />
          <span>
            <span className="font-semibold">Siguiente paso:</span> {resumen.siguiente_paso}
          </span>
        </p>
      )}

      <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1">
        {momentos.length > 0 && (
          <button type="button" onClick={() => setLinea((v) => !v)} aria-expanded={linea} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]">
            <ChevronDown className={`h-3 w-3 transition-transform ${linea ? '' : '-rotate-90'}`} aria-hidden /> Cómo fue la conversación
          </button>
        )}
        <button type="button" onClick={() => setTexto((v) => !v)} aria-expanded={texto} className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:text-[var(--ls-t1)]">
          <ChevronDown className={`h-3 w-3 transition-transform ${texto ? '' : '-rotate-90'}`} aria-hidden /> Transcripción completa
        </button>
      </div>

      {linea && momentos.length > 0 && (
        <ol className="mt-2 space-y-1.5 border-l border-[var(--ls-linea2)] pl-2.5">
          {momentos.map((m, i) => (
            <li key={i} className="text-[12px] leading-snug text-[var(--ls-t2)]">
              <Etiqueta quien={m.quien} />
              {m.texto}
            </li>
          ))}
        </ol>
      )}

      {texto && <TranscripcionCompleta llamadaId={resumen.llamada_id} />}
    </div>
  )
}
