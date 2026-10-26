'use client'

import { Check, ChevronDown, Clock, Coins, Loader2, MessageCircle, RotateCw, TriangleAlert, Type } from 'lucide-react'
import { useState } from 'react'
import { enCentimos } from '@/lib/ia/precios'
import type { CasoVista } from '@/lib/whatsapp/ia-casos'
import type { ResultadoDePrueba } from '@/lib/whatsapp/ia-laboratorio-tipos'
import { ETIQUETA_DE_SITUACION } from '@/lib/whatsapp/mensajes'
import { Anatomia } from './Anatomia'

/**
 * UN CASO DE PRUEBA CON SU MENSAJE.
 *
 * La cabecera dice qué caso es y en qué momento está; el mensaje sale como saldría en WhatsApp, con cuántas palabras, cuánto ha tardado y cuánto ha costado; debajo, qué mirar en ese
 * caso (lo que hace que sirva para calibrar) y, plegado, lo que recibió la IA además de las instrucciones («cómo lo interpretó»). Con la comparación puesta salen dos mensajes del
 * mismo caso, el de esta versión y el de la que usa el equipo, para ver de un vistazo si lo que se ha tocado mejora o empeora.
 */

export interface PropsDeResultado {
  caso: Pick<CasoVista, 'etiqueta' | 'mirar' | 'descripcion'> & { momento?: string }
  /** El de esta versión. undefined = todavía no se ha probado */
  resultado?: ResultadoDePrueba
  /** El de la versión que usa el equipo, si se está comparando */
  produccion?: ResultadoDePrueba
  comparando: boolean
  probando: boolean
  onRepetir?: () => void
  /** Hasta cuántas palabras se deja pasar: para marcar un mensaje largo */
  onEditar: (editor: string) => void
}

function Burbuja({ r, titulo }: { r: ResultadoDePrueba | undefined; titulo?: string }) {
  if (!r) return <p className="rounded-[8px] border border-dashed border-[var(--ls-linea)] px-3 py-3 text-[12px] text-[var(--ls-t4)]">Sin probar todavía.</p>
  return (
    <div className="space-y-1.5">
      {titulo && <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">{titulo}</p>}
      {r.ok && r.mensaje ? (
        <p className="whitespace-pre-wrap rounded-[10px] rounded-tl-[3px] bg-[color-mix(in_srgb,var(--ls-e-verde)_14%,var(--ls-sup2))] px-3 py-2 text-[13px] leading-snug text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--ls-e-verde)_28%,transparent)]">{r.mensaje}</p>
      ) : (
        <p role="alert" className="flex items-start gap-1.5 rounded-[8px] border border-[var(--ls-e-ambar)] px-2.5 py-2 text-[12px] leading-snug text-[var(--ls-e-ambar)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {r.error}
        </p>
      )}
      {r.ok && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-[var(--ls-t4)]">
          <span className={`inline-flex items-center gap-1 ${r.palabras > r.maxPalabras ? 'text-[var(--ls-e-ambar)]' : ''}`} title={`Hasta ${r.maxPalabras} palabras se deja pasar con esta configuración`}>
            <Type className="h-3 w-3" aria-hidden /> {r.palabras} palabras
          </span>
          <span className="inline-flex items-center gap-1" title={`${r.modelo} · ${r.llamadas === 1 ? 'una llamada' : `${r.llamadas} llamadas (se pidió una corrección)`}`}>
            <Clock className="h-3 w-3" aria-hidden /> {(r.ms / 1000).toLocaleString('es-ES', { maximumFractionDigits: 1 })} s
          </span>
          <span className="inline-flex items-center gap-1" title={r.tokens ? `${r.tokens.entrada} tokens de entrada (${r.tokens.cache} en caché) y ${r.tokens.salida} de salida. Sin nada en caché: ${enCentimos(r.costeMaximo)}` : undefined}>
            <Coins className="h-3 w-3" aria-hidden /> {enCentimos(r.coste)}
          </span>
        </p>
      )}
      {r.ok && r.base && <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Basado en: {r.base}</p>}
      {r.ok && r.aviso && (
        <p className="flex items-start gap-1.5 text-[11.5px] leading-snug text-[var(--ls-e-ambar)]">
          <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden /> {r.aviso}
        </p>
      )}
    </div>
  )
}

export function ResultadoDeCaso({ caso, resultado, produccion, comparando, probando, onRepetir, onEditar }: PropsDeResultado) {
  const [verEncargo, setVerEncargo] = useState(false)
  const algo = resultado ?? produccion
  const momento = resultado?.situacion ?? produccion?.situacion
  return (
    <article className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" aria-busy={probando}>
      <header className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--ls-linea)] px-3 py-2">
        <MessageCircle className="h-3.5 w-3.5 shrink-0 text-[var(--ls-e-verde)]" aria-hidden />
        <h4 className="min-w-0 flex-1 text-[12.5px] font-semibold text-[var(--ls-t1)]" title={caso.descripcion}>
          {caso.etiqueta}
        </h4>
        {momento && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px text-[10.5px] font-medium text-[var(--ls-t3)]">{ETIQUETA_DE_SITUACION[momento]}</span>}
        {resultado && !probando && (resultado.ok ? <Check className="h-3.5 w-3.5 text-[var(--ls-e-verde)]" aria-label="Con mensaje" /> : <TriangleAlert className="h-3.5 w-3.5 text-[var(--ls-e-ambar)]" aria-label="Sin mensaje" />)}
        {onRepetir && (
          <button type="button" onClick={onRepetir} disabled={probando} title="Volver a probar solo este caso" aria-label="Volver a probar solo este caso" className="flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:opacity-50">
            {probando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <RotateCw className="h-3.5 w-3.5" aria-hidden />}
          </button>
        )}
      </header>

      <div className="space-y-2.5 px-3 py-2.5">
        {probando && !algo ? (
          <div className="space-y-1.5" aria-label="Escribiendo">
            <div className="h-3 w-5/6 animate-pulse rounded bg-[var(--ls-sup3)]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-[var(--ls-sup3)]" />
          </div>
        ) : comparando ? (
          <div className="grid gap-3 md:grid-cols-2">
            <Burbuja r={resultado} titulo="Esta versión" />
            <Burbuja r={produccion} titulo="La que usa el equipo" />
          </div>
        ) : (
          <Burbuja r={resultado} />
        )}

        <p className="text-[11.5px] leading-snug text-[var(--ls-t4)]">
          <span className="font-semibold text-[var(--ls-t3)]">Qué mirar:</span> {caso.mirar}
        </p>

        {resultado && resultado.encargo.length > 0 && (
          <div>
            <button type="button" onClick={() => setVerEncargo((v) => !v)} aria-expanded={verEncargo} className="inline-flex items-center gap-1 text-[11.5px] font-medium text-[var(--ls-t3)] hover:text-[var(--ls-t1)]">
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${verEncargo ? '' : '-rotate-90'}`} aria-hidden /> Cómo lo ha interpretado la IA
            </button>
            {verEncargo && (
              <div className="mt-2">
                <Anatomia bloques={resultado.encargo} onEditar={onEditar} titulo="Lo que recibió de este lead" ayuda="Esto salió de la ficha, el historial y el momento. Debajo de cada bloque ves de dónde viene y, si lo escribes tú, dónde cambiarlo." />
              </div>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
