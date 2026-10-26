'use client'

import { Clock } from 'lucide-react'
import { useMemo, useState, type CSSProperties } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { desgloseDeLlamadas, horaDeMinuto, pausasDe, resumenDeLinea, textoDeMinutos, ventanaDeHoras, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { DetalleDeMarca, EjeDeHoras, Fondo, Marca } from './LineaDelDia'
import { CabeceraDePanel, PANEL } from './ui'

/**
 * LA LÍNEA DEL DÍA DE TODO EL EQUIPO: una franja por persona, todas con el mismo eje de horas.
 *
 * Es lo que se mira para saber de un vistazo quién empezó cuándo, quién está llamando ahora y quién lleva rato sin
 * actividad. En cada franja, arriba las llamadas (rayas) y debajo lo demás (WhatsApp, correos, respuestas, citas).
 * Las franjas rayadas en ámbar son huecos de media hora o más. Un clic en el nombre abre el panel de esa persona.
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
    <section className={`${PANEL} rend-aparece overflow-hidden transition-opacity duration-300 ${cargando ? 'opacity-60' : ''}`} aria-label={titulo}>
      <CabeceraDePanel icono={<Clock className="h-3.5 w-3.5" />} titulo={titulo} derecha={<span className="text-[11px] text-[var(--ls-t4)]">Pulsa un nombre para abrir su panel</span>} />

      <div className="px-3 pb-3 pt-2">
        <div className="overflow-x-auto">
          <div className="min-w-[860px] pr-3">
            <div className="grid h-[16px] items-end" style={{ gridTemplateColumns: COLUMNAS }}>
              <span />
              <div className="relative h-full">
                <EjeDeHoras ventana={ventana} />
              </div>
              <span />
            </div>

            {filas.map(({ persona, eventos, pausas, resumen }, indice) => {
              const llamadas = eventos.filter((e) => e.carril === 'llamadas')
              const demas = eventos.filter((e) => e.carril !== 'llamadas')
              const mensajes = resumen.porCarril.whatsapp + resumen.porCarril.correos + resumen.porCarril.respuestas + resumen.porCarril.otras
              // «30 intentos · 4 recibidas»: lo que hace que haya más rayas que llamadas. Vacío si cada llamada fue a un cliente distinto
              const desglose = desgloseDeLlamadas(resumen.llamadas, { corto: true })
              const enCurso = pausas.find((p) => p.enCurso)
              return (
                <div key={persona.id} className="rend-entra grid items-center border-t border-[var(--ls-linea)] py-1" style={{ gridTemplateColumns: COLUMNAS, '--d': indice } as CSSProperties}>
                  <div className="min-w-0 pr-2">
                    <button type="button" onClick={() => onElegir(persona.id)} className="max-w-full truncate text-left text-[12.5px] font-medium text-[var(--ls-t2)] underline-offset-2 transition-colors hover:text-[var(--ls-t1)] hover:underline">
                      {persona.nombre}
                    </button>
                    <p className="truncate text-[10.5px] tabular-nums text-[var(--ls-t4)]">{resumen.total === 0 ? (persona.vinculado ? 'Sin actividad' : 'Sin Rinkel') : `${resumen.primera}–${resumen.ultima}`}</p>
                  </div>

                  <div className="relative">
                    <Fondo ventana={ventana} pausas={pausas} ahora={ahora} />
                    <div className="relative h-[20px]">
                      {llamadas.map((e, orden) => (
                        <Marca key={e.id} evento={e} ventana={ventana} activa={activo === `${persona.id}|${e.id}`} onActivar={(id) => setActivo(id ? `${persona.id}|${id}` : null)} orden={orden} />
                      ))}
                    </div>
                    <div className="relative h-[14px]">
                      {demas.map((e, orden) => (
                        <Marca key={e.id} evento={e} ventana={ventana} activa={activo === `${persona.id}|${e.id}`} onActivar={(id) => setActivo(id ? `${persona.id}|${id}` : null)} orden={orden} />
                      ))}
                    </div>
                  </div>

                  <div className="pl-3 text-[10.5px] leading-snug tabular-nums text-[var(--ls-t4)]">
                    {/* La cifra de «llamadas» es la de la tabla del equipo: clientes distintos, un cliente una vez al día. Las rayas son cada intento (y cada recibida) */}
                    <p title="A cuántos clientes distintos ha llamado: la misma cifra que la tabla del equipo (un cliente cuenta una sola llamada al día). Cada raya del dibujo es un intento, o una llamada recibida.">
                      <span className="text-[var(--ls-t2)]">{resumen.llamadas.clientes}</span> llamadas
                    </p>
                    {desglose && <p>{desglose}</p>}
                    <p>
                      <span className="text-[var(--ls-t2)]">{mensajes}</span> mensajes
                      {resumen.porCarril.citas > 0 ? ` · ${resumen.porCarril.citas} ${resumen.porCarril.citas === 1 ? 'cita' : 'citas'}` : ''}
                    </p>
                    {enCurso ? (
                      <p className="flex items-center gap-1" style={{ color: COLOR_ESTADO.ambar }}>
                        <span className="rend-latido h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
                        sin actividad desde las {horaDeMinuto(enCurso.desde)}
                      </p>
                    ) : resumen.pausaMasLarga ? (
                      <p>pausa más larga {textoDeMinutos(resumen.pausaMasLarga.minutos)}</p>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="mt-2.5">
          <DetalleDeMarca
            evento={eventoActivo}
            vacio="Pasa el ratón o pulsa una marca para ver qué fue y de quién. Las franjas rayadas son huecos de media hora o más sin actividad. La cifra de llamadas cuenta clientes distintos, como la tabla del equipo; cada raya es un intento (o una llamada recibida), por eso puede haber más rayas que llamadas."
          />
        </div>
      </div>
    </section>
  )
}
