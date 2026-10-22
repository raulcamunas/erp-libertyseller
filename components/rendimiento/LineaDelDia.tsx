'use client'

import { Clock } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import {
  CARRILES,
  horaDeMinuto,
  pausasDe,
  resumenDeLinea,
  textoDeMinutos,
  ventanaDeHoras,
  type Carril,
  type EventoDeLinea,
  type Estilo,
  type Pausa,
} from '@/lib/rendimiento/linea'

/**
 * LA LÍNEA DEL DÍA DE UNA PERSONA: qué hizo y a qué hora, todo en un mismo eje.
 *
 * Una fila por cosa que deja rastro (llamadas, WhatsApp, correos, respuestas de clientes, citas) y las horas de
 * trabajo de izquierda a derecha. Las llamadas son rayas —más altas y claras las conversaciones, apagadas las que
 * no contestó nadie—; lo demás son puntos. Las franjas ámbar son huecos de media hora o más sin ninguna actividad,
 * y si el día es hoy, una línea marca «ahora» y avisa de lo que lleva la persona sin actividad.
 *
 * Pasar el ratón o pulsar una marca enseña qué fue: la hora, el cliente y el comentario.
 */

const COLOR_DE_LLAMADA: Record<Estilo, string> = {
  conversacion: 'bg-emerald-300',
  contestada: 'bg-emerald-500',
  recibida: 'bg-sky-400',
  contestador: 'bg-white/35',
  sinContestar: 'bg-white/20',
  perdida: 'bg-red-400/70',
  normal: 'bg-white/40',
}

const COLOR_DE_PUNTO: Record<Exclude<Carril, 'llamadas'>, string> = {
  whatsapp: 'bg-green-400',
  correos: 'bg-sky-400',
  respuestas: 'bg-[#FF6600]',
  citas: 'bg-violet-400',
  otras: 'bg-white/45',
}

const ANCHO_DE_ETIQUETA = 92

export function Marca({ evento, ventana, activa, onActivar }: { evento: EventoDeLinea; ventana: { desde: number; hasta: number }; activa: boolean; onActivar: (id: string | null) => void }) {
  const izquierda = ((evento.minuto - ventana.desde) / (ventana.hasta - ventana.desde)) * 100
  return (
    <button
      type="button"
      onMouseEnter={() => onActivar(evento.id)}
      onFocus={() => onActivar(evento.id)}
      onClick={() => onActivar(evento.id)}
      aria-label={`${evento.hora}. ${evento.titulo}. ${evento.detalle}`}
      className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 px-[3px] py-1 outline-none"
      style={{ left: `${izquierda}%` }}
    >
      {evento.carril === 'llamadas' ? (
        <span className={`block w-[3px] rounded-full transition-all ${COLOR_DE_LLAMADA[evento.estilo]} ${evento.estilo === 'conversacion' ? 'h-[20px]' : 'h-[14px]'} ${activa ? 'ring-2 ring-white/70' : ''}`} />
      ) : (
        <span
          className={`block h-[9px] w-[9px] ${evento.carril === 'citas' ? 'rotate-45 rounded-[2px]' : 'rounded-full'} ${COLOR_DE_PUNTO[evento.carril]} ${activa ? 'ring-2 ring-white/70' : ''}`}
        />
      )}
    </button>
  )
}

/** Lo que se ve al dejar el ratón sobre una marca: en una línea fija bajo el dibujo, que no se corta ni se sale de la pantalla */
export function DetalleDeMarca({ evento, vacio }: { evento: EventoDeLinea | null; vacio: ReactNode }) {
  return (
    <div className="min-h-[38px] rounded-lg bg-white/[0.03] border border-white/[0.06] px-3 py-1.5 text-[12px]" aria-live="polite">
      {evento ? (
        <p className="text-white/80 leading-snug">
          <span className="font-semibold text-white tabular-nums">{evento.hora}</span> · {evento.titulo}
          {evento.detalle && <span className="text-white/55"> — {evento.detalle}</span>}
        </p>
      ) : (
        <p className="text-white/35">{vacio}</p>
      )}
    </div>
  )
}

/** Las marcas del eje: una cada hora (o cada dos si el dibujo es muy largo) */
export function EjeDeHoras({ ventana }: { ventana: { desde: number; hasta: number } }) {
  const total = ventana.hasta - ventana.desde
  const paso = total > 12 * 60 ? 120 : 60
  const horas: number[] = []
  for (let m = ventana.desde; m <= ventana.hasta; m += paso) horas.push(m)
  return (
    <>
      {horas.map((m) => (
        <span key={m} className="absolute top-0 -translate-x-1/2 text-[10px] text-white/30 tabular-nums" style={{ left: `${((m - ventana.desde) / total) * 100}%` }}>
          {String(m / 60).padStart(2, '0')}
        </span>
      ))}
    </>
  )
}

/** Las líneas verticales de las horas, las franjas de pausa y la de «ahora», detrás de las marcas */
export function Fondo({ ventana, pausas, ahora }: { ventana: { desde: number; hasta: number }; pausas: Pausa[]; ahora: number | null }) {
  const total = ventana.hasta - ventana.desde
  const pct = (m: number) => ((m - ventana.desde) / total) * 100
  const paso = total > 12 * 60 ? 120 : 60
  const horas: number[] = []
  for (let m = ventana.desde; m <= ventana.hasta; m += paso) horas.push(m)
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {horas.map((m) => (
        <span key={m} className="absolute inset-y-0 w-px bg-white/[0.06]" style={{ left: `${pct(m)}%` }} />
      ))}
      {pausas.map((p) => (
        <span
          key={`${p.desde}-${p.hasta}`}
          title={`${textoDeMinutos(p.minutos)} sin actividad (${horaDeMinuto(p.desde)} - ${horaDeMinuto(p.hasta)})${p.enCurso ? ', y sigue' : ''}`}
          className={`absolute inset-y-0 border-x ${p.enCurso ? 'border-amber-400/40 bg-amber-400/[0.07]' : 'border-amber-400/25 bg-amber-400/[0.09]'}`}
          style={{ left: `${pct(p.desde)}%`, width: `${pct(p.hasta) - pct(p.desde)}%` }}
        />
      ))}
      {ahora !== null && ahora >= ventana.desde && ahora <= ventana.hasta && <span className="absolute inset-y-0 w-px bg-[#FF6600]/70" style={{ left: `${pct(ahora)}%` }} />}
    </div>
  )
}

interface Props {
  titulo: string
  eventos: EventoDeLinea[]
  /** Los minutos desde las 00:00 de ahora mismo, si el día que se mira es hoy */
  ahora: number | null
  cargando?: boolean
}

export function LineaDelDia({ titulo, eventos, ahora, cargando = false }: Props) {
  const [activo, setActivo] = useState<string | null>(null)
  const ventana = useMemo(() => ventanaDeHoras(eventos), [eventos])
  const pausas = useMemo(() => pausasDe(eventos, { ahora }), [eventos, ahora])
  const resumen = useMemo(() => resumenDeLinea(eventos, pausas), [eventos, pausas])
  const eventoActivo = eventos.find((e) => e.id === activo) ?? null

  // Siempre las cinco filas de siempre, para poder comparar un día con otro; «otras notas» solo si las hay
  const carriles = CARRILES.filter((c) => c.id !== 'otras' || resumen.porCarril.otras > 0)
  const enCurso = pausas.find((p) => p.enCurso)

  return (
    <section className={`rounded-2xl border border-white/10 bg-white/[0.02] p-3 sm:p-4 transition-opacity ${cargando ? 'opacity-60' : ''}`} aria-label={titulo}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
        <h2 className="text-[13px] font-semibold text-white flex items-center gap-2">
          <Clock className="h-3.5 w-3.5 text-[#FF6600]" /> {titulo}
        </h2>
        {resumen.total > 0 ? (
          <p className="text-[12px] text-white/50 tabular-nums">
            De <span className="text-white/80 font-medium">{resumen.primera}</span> a <span className="text-white/80 font-medium">{resumen.ultima}</span>
            {resumen.pausaMasLarga && !resumen.pausaMasLarga.enCurso && (
              <>
                {' · '}pausa más larga <span className="text-amber-300 font-medium">{textoDeMinutos(resumen.pausaMasLarga.minutos)}</span> ({horaDeMinuto(resumen.pausaMasLarga.desde)}–
                {horaDeMinuto(resumen.pausaMasLarga.hasta)})
              </>
            )}
            {enCurso && (
              <>
                {' · '}<span className="text-amber-300 font-medium">sin actividad desde las {horaDeMinuto(enCurso.desde)}</span> ({textoDeMinutos(enCurso.minutos)})
              </>
            )}
          </p>
        ) : (
          <p className="text-[12px] text-white/35">{cargando ? 'Leyendo el día…' : 'Ese día no hay nada apuntado.'}</p>
        )}
      </div>

      <div className="overflow-x-auto">
        {/* El margen de la derecha deja sitio a la mitad de la última hora del eje, que si no se corta */}
        <div className="min-w-[720px] pr-3">
          <div className="grid items-end h-[18px]" style={{ gridTemplateColumns: `${ANCHO_DE_ETIQUETA}px minmax(0, 1fr)` }}>
            <span />
            <div className="relative h-full">
              <EjeDeHoras ventana={ventana} />
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-y-0 right-0" style={{ left: ANCHO_DE_ETIQUETA }}>
              <Fondo ventana={ventana} pausas={pausas} ahora={ahora} />
            </div>
            {carriles.map((c) => (
              <div key={c.id} className="grid items-center border-t border-white/[0.05]" style={{ gridTemplateColumns: `${ANCHO_DE_ETIQUETA}px minmax(0, 1fr)` }}>
                <span className="text-[11px] text-white/50 flex items-center gap-1.5 pr-2">
                  {c.etiqueta}
                  <span className="text-white/25 tabular-nums">{resumen.porCarril[c.id]}</span>
                </span>
                <div className="relative h-[28px]">
                  {eventos
                    .filter((e) => e.carril === c.id)
                    .map((e) => (
                      <Marca key={e.id} evento={e} ventana={ventana} activa={activo === e.id} onActivar={setActivo} />
                    ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        <DetalleDeMarca evento={eventoActivo} vacio="Pasa el ratón o pulsa una marca para ver qué fue: la hora, el cliente y lo que se apuntó." />
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-white/35">
          <span className="flex items-center gap-1.5">
            <span className="h-3 w-[3px] rounded-full bg-emerald-300" /> conversación (más de 1 min)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-[3px] rounded-full bg-emerald-500" /> contestada
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-[3px] rounded-full bg-white/35" /> sin contestar o contestador
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-[3px] rounded-full bg-sky-400" /> recibida
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-4 border-x border-amber-400/30 bg-amber-400/10" /> 30 min o más sin actividad
          </span>
        </div>
      </div>
    </section>
  )
}
