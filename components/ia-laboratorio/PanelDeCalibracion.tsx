'use client'

import { CircleHelp, Mail, MessageCircle } from 'lucide-react'
import { useCallback, useState } from 'react'
import { PanelLaboratorio } from '../correo-laboratorio/PanelLaboratorio'
import { CalibradorDeWhatsapp } from './CalibradorDeWhatsapp'

/**
 * CONFIGURACIÓN DE LA IA: una sola pantalla para calibrar lo que escribe la IA, con un interruptor por canal.
 *
 *   · Correo      las versiones del correo que escribe la IA, tus ejemplos, lo que ya funciona y los resultados (A/B).
 *   · WhatsApp    el perfil del mensaje que la IA escribe para el botón de WhatsApp: ajustes, textos, prueba con casos y publicación.
 *
 * Cada canal se monta la primera vez que se abre y se queda montado (oculto) al cambiar de uno a otro: así no se pierde lo que se estaba editando ni la prueba que se había hecho. El canal
 * va en la dirección (`?canal=whatsapp`) para poder pasar el enlace.
 */

export type Canal = 'correo' | 'whatsapp'

const CANALES: ReadonlyArray<{ id: Canal; texto: string; icono: typeof Mail; ayuda: string }> = [
  { id: 'correo', texto: 'Correo', icono: Mail, ayuda: 'El correo que escribe la IA: versiones, ejemplos y resultados' },
  { id: 'whatsapp', texto: 'WhatsApp', icono: MessageCircle, ayuda: 'El mensaje de WhatsApp que escribe la IA: ajustes, prueba y publicación' },
]

const PASOS: ReadonlyArray<{ n: number; titulo: string; texto: string }> = [
  { n: 1, titulo: 'Ajusta', texto: 'Mueve los mandos o escribe tus textos. Debajo de cada cosa se ve la frase exacta que recibe la IA.' },
  { n: 2, titulo: 'Prueba', texto: 'Escribe un mensaje por cada caso con lo que hay en el editor, sin guardarlo ni enviarlo, y compáralo con el de la versión que usa el equipo.' },
  { n: 3, titulo: 'Publica', texto: 'Guárdalo como borrador y, cuando una prueba salga bien, publícalo. Desde ese momento lo usa todo el equipo; la anterior se queda en el historial.' },
]

export function PanelDeCalibracion({ canalInicial = 'correo' }: { canalInicial?: Canal }) {
  const [canal, setCanal] = useState<Canal>(canalInicial)
  const [montados, setMontados] = useState<ReadonlySet<Canal>>(new Set([canalInicial]))
  const [ayuda, setAyuda] = useState(false)

  const elegir = useCallback((c: Canal) => {
    setCanal(c)
    setMontados((m) => (m.has(c) ? m : new Set(m).add(c)))
    try {
      const url = new URL(window.location.href)
      url.searchParams.set('canal', c)
      window.history.replaceState(window.history.state, '', url)
    } catch {
      // sin dirección que actualizar: no pasa nada
    }
  }, [])

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Canal de la IA" className="inline-flex rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-0.5">
          {CANALES.map((c) => {
            const Icono = c.icono
            const activo = canal === c.id
            return (
              <button
                key={c.id}
                type="button"
                role="tab"
                id={`canal-${c.id}`}
                aria-selected={activo}
                aria-controls={`canal-${c.id}-contenido`}
                title={c.ayuda}
                onClick={() => elegir(c.id)}
                className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-[6px] px-3 text-[12.5px] font-medium transition-colors ${
                  activo ? 'bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
                }`}
              >
                <Icono className="h-3.5 w-3.5" aria-hidden /> {c.texto}
              </button>
            )
          })}
        </div>
        <button type="button" onClick={() => setAyuda((a) => !a)} aria-expanded={ayuda} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] px-2 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]">
          <CircleHelp className="h-3.5 w-3.5" aria-hidden /> Cómo se usa
        </button>
      </div>

      {ayuda && (
        <ol className="grid gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 sm:grid-cols-3">
          {PASOS.map((p) => (
            <li key={p.n} className="flex items-start gap-2.5">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ls-acc-suave)] text-[11px] font-semibold text-[var(--ls-t1)]">{p.n}</span>
              <span className="min-w-0 text-[12px] leading-snug text-[var(--ls-t3)]">
                <strong className="block text-[12.5px] text-[var(--ls-t1)]">{p.titulo}</strong>
                {p.texto}
              </span>
            </li>
          ))}
        </ol>
      )}

      {montados.has('correo') && (
        <div role="tabpanel" id="canal-correo-contenido" aria-labelledby="canal-correo" hidden={canal !== 'correo'}>
          <PanelLaboratorio />
        </div>
      )}
      {montados.has('whatsapp') && (
        <div role="tabpanel" id="canal-whatsapp-contenido" aria-labelledby="canal-whatsapp" hidden={canal !== 'whatsapp'}>
          <CalibradorDeWhatsapp />
        </div>
      )}
    </div>
  )
}
