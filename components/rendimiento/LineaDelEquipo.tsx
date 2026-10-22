'use client'

import { Clock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { horaDeMinuto, pausasDe, resumenDeLinea, textoDeMinutos, ventanaDeHoras, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { DetalleDeMarca, EjeDeHoras, Fondo, Marca } from './LineaDelDia'

/**
 * LA LÍNEA DEL DÍA DE TODO EL EQUIPO: una franja por persona, todas con el mismo eje de horas.
 *
 * Es lo que se mira para saber de un vistazo quién empezó cuándo, quién está llamando ahora y quién lleva rato sin
 * actividad. En cada franja, arriba las llamadas (rayas) y debajo lo demás (WhatsApp, correos, respuestas, citas).
 * Las franjas ámbar son huecos de media hora o más. Un clic en el nombre abre el panel de esa persona.
 */

export interface PersonaDeLinea {
  id: string
  nombre: string
  vinculado: boolean
}

interface Props {
  titulo: string
  personas: PersonaDeLinea[]
  eventosPorPersona: ReadonlyMap<string, EventoDeLinea[]>
  ahora: number | null
  cargando: boolean
  onElegir: (id: string) => void
}

const COLUMNAS = '150px minmax(0, 1fr) 150px'

export function LineaDelEquipo({ titulo, personas, eventosPorPersona, ahora, cargando, onElegir }: Props) {
  const [activo, setActivo] = useState<string | null>(null)

  const todos = useMemo(() => personas.flatMap((p) => eventosPorPersona.get(p.id) ?? []), [personas, eventosPorPersona])
  const ventana = useMemo(() => ventanaDeHoras(todos), [todos])
  const filas = useMemo(
    () =>
      personas.map((p) => {
        const eventos = eventosPorPersona.get(p.id) ?? []
        const pausas = pausasDe(eventos, { ahora })
        return { persona: p, eventos, pausas, resumen: resumenDeLinea(eventos, pausas) }
      }),
    [personas, eventosPorPersona, ahora]
  )

  const eventoActivo = useMemo(() => {
    if (!activo) return null
    const [personaId, eventoId] = activo.split('|')
    const fila = filas.find((f) => f.persona.id === personaId)
    const evento = fila?.eventos.find((e) => e.id === eventoId)
    return fila && evento ? { ...evento, titulo: `${fila.persona.nombre}: ${evento.titulo}` } : null
  }, [activo, filas])

  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-label={titulo}>
      <h2 className="text-[13px] font-semibold text-white flex items-center gap-2 mb-3">
        <Clock className="h-3.5 w-3.5 text-[#FF6600]" /> {titulo}
      </h2>

      <div className="overflow-x-auto">
        <div className="min-w-[860px] pr-3">
          <div className="grid items-end h-[18px]" style={{ gridTemplateColumns: COLUMNAS }}>
            <span />
            <div className="relative h-full">
              <EjeDeHoras ventana={ventana} />
            </div>
            <span />
          </div>

          {filas.map(({ persona, eventos, pausas, resumen }) => {
            const llamadas = eventos.filter((e) => e.carril === 'llamadas')
            const demas = eventos.filter((e) => e.carril !== 'llamadas')
            const mensajes = resumen.porCarril.whatsapp + resumen.porCarril.correos + resumen.porCarril.respuestas + resumen.porCarril.otras
            const enCurso = pausas.find((p) => p.enCurso)
            return (
              <div key={persona.id} className="grid items-center border-t border-white/[0.05] py-1" style={{ gridTemplateColumns: COLUMNAS }}>
                <div className="pr-2 min-w-0">
                  <button type="button" onClick={() => onElegir(persona.id)} className="text-[12px] font-medium text-white/85 hover:text-white hover:underline underline-offset-2 truncate max-w-full text-left">
                    {persona.nombre}
                  </button>
                  <p className="text-[10px] text-white/35 tabular-nums truncate">
                    {resumen.total === 0 ? (persona.vinculado ? 'Sin actividad' : 'Sin Rinkel') : `${resumen.primera}–${resumen.ultima}`}
                  </p>
                </div>

                <div className="relative">
                  <Fondo ventana={ventana} pausas={pausas} ahora={ahora} />
                  <div className="relative h-[20px]">
                    {llamadas.map((e) => (
                      <Marca key={e.id} evento={e} ventana={ventana} activa={activo === `${persona.id}|${e.id}`} onActivar={(id) => setActivo(id ? `${persona.id}|${id}` : null)} />
                    ))}
                  </div>
                  <div className="relative h-[14px]">
                    {demas.map((e) => (
                      <Marca key={e.id} evento={e} ventana={ventana} activa={activo === `${persona.id}|${e.id}`} onActivar={(id) => setActivo(id ? `${persona.id}|${id}` : null)} />
                    ))}
                  </div>
                </div>

                <div className="pl-3 text-[10px] text-white/40 leading-snug tabular-nums">
                  <p>
                    <span className="text-white/60">{resumen.porCarril.llamadas}</span> llamadas
                  </p>
                  <p>
                    <span className="text-white/60">{mensajes}</span> mensajes
                    {resumen.porCarril.citas > 0 ? ` · ${resumen.porCarril.citas} ${resumen.porCarril.citas === 1 ? 'cita' : 'citas'}` : ''}
                  </p>
                  {enCurso ? (
                    <p className="text-amber-300/90">sin actividad desde las {horaDeMinuto(enCurso.desde)}</p>
                  ) : resumen.pausaMasLarga ? (
                    <p>pausa más larga {textoDeMinutos(resumen.pausaMasLarga.minutos)}</p>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3">
        <DetalleDeMarca evento={eventoActivo} vacio="Pasa el ratón o pulsa una marca para ver qué fue y de quién. Las franjas ámbar son huecos de media hora o más sin actividad." />
      </div>
    </section>
  )
}
