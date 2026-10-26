'use client'

import { Clock } from 'lucide-react'
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import {
  CARRILES,
  desgloseDeLlamadas,
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
import { CabeceraDePanel, PANEL } from './ui'

/**
 * LA LÍNEA DEL DÍA DE UNA PERSONA: qué hizo y a qué hora, todo en un mismo eje.
 *
 * Una fila por cosa que deja rastro (llamadas, WhatsApp, correos, respuestas de clientes, citas) y las horas de
 * trabajo de izquierda a derecha. Las llamadas son rayas —más altas y claras las conversaciones, apagadas las que
 * no contestó nadie—; lo demás son puntos. Las franjas rayadas en ámbar son huecos de media hora o más sin ninguna
 * actividad, y si el día es hoy, una línea marca «ahora» (con un punto que late) y avisa de lo que lleva la
 * persona sin actividad. Al aparecer, las marcas entran de izquierda a derecha.
 *
 * Pasar el ratón o pulsar una marca enseña qué fue: la hora, el cliente y el comentario.
 */

const COLOR_DE_LLAMADA: Record<Estilo, string> = {
  conversacion: COLOR_ESTADO.verde,
  contestada: `color-mix(in srgb, ${COLOR_ESTADO.verde} 60%, transparent)`,
  recibida: COLOR_ESTADO.cian,
  contestador: 'var(--ls-t4)',
  sinContestar: 'var(--ls-linea2)',
  perdida: `color-mix(in srgb, ${COLOR_ESTADO.rojo} 75%, transparent)`,
  normal: 'var(--ls-t3)',
}

const COLOR_DE_PUNTO: Record<Exclude<Carril, 'llamadas'>, string> = {
  whatsapp: COLOR_ESTADO.verde,
  correos: COLOR_ESTADO.azul,
  respuestas: 'var(--ls-acc-graf)',
  citas: COLOR_ESTADO.violeta,
  otras: 'var(--ls-t3)',
}

const COLOR_DE_CARRIL: Record<Carril, string> = { llamadas: COLOR_ESTADO.verde, ...COLOR_DE_PUNTO }

const ANCHO_DE_ETIQUETA = 104

/** El fondo rayado de un hueco sin actividad */
const RAYAS_DE_PAUSA = `repeating-linear-gradient(135deg, color-mix(in srgb, ${COLOR_ESTADO.ambar} 16%, transparent) 0 5px, transparent 5px 10px)`

export function Marca({
  evento,
  ventana,
  activa,
  onActivar,
  orden = 0,
}: {
  evento: EventoDeLinea
  ventana: { desde: number; hasta: number }
  activa: boolean
  onActivar: (id: string | null) => void
  /** El puesto de la marca entre las de su fila: marca el escalón de la animación de entrada */
  orden?: number
}) {
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
        <span
          className={`rend-pop block w-[3px] rounded-full transition-[height,box-shadow] ${evento.estilo === 'conversacion' ? 'h-[18px]' : 'h-[12px]'} ${activa ? 'shadow-[0_0_0_2px_var(--ls-t1)]' : ''}`}
          style={{ background: COLOR_DE_LLAMADA[evento.estilo], '--d': Math.min(orden, 60) } as CSSProperties}
        />
      ) : (
        <span
          className={`rend-pop block h-[9px] w-[9px] transition-shadow ${evento.carril === 'citas' ? 'rotate-45 rounded-[2px]' : 'rounded-full'} ${activa ? 'shadow-[0_0_0_2px_var(--ls-t1)]' : ''}`}
          style={{ background: COLOR_DE_PUNTO[evento.carril], '--d': Math.min(orden, 60) } as CSSProperties}
        />
      )}
    </button>
  )
}

/** Lo que se ve al dejar el ratón sobre una marca: en una línea fija bajo el dibujo, que no se corta ni se sale de la pantalla */
export function DetalleDeMarca({ evento, vacio }: { evento: EventoDeLinea | null; vacio: ReactNode }) {
  return (
    <div className="min-h-[34px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5 text-[12px]" aria-live="polite">
      {evento ? (
        <p key={evento.id} className="rend-entra leading-snug text-[var(--ls-t2)]">
          <span className="font-semibold tabular-nums text-[var(--ls-t1)]">{evento.hora}</span> · {evento.titulo}
          {evento.detalle && <span className="text-[var(--ls-t4)]"> — {evento.detalle}</span>}
        </p>
      ) : (
        <p className="text-[var(--ls-t4)]">{vacio}</p>
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
        <span key={m} className="absolute top-0 -translate-x-1/2 text-[10px] tabular-nums text-[var(--ls-t4)]" style={{ left: `${((m - ventana.desde) / total) * 100}%` }}>
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
        <span key={m} className="absolute inset-y-0 w-px bg-[var(--ls-linea)]" style={{ left: `${pct(m)}%` }} />
      ))}
      {pausas.map((p) => (
        <span
          key={`${p.desde}-${p.hasta}`}
          title={`${textoDeMinutos(p.minutos)} sin actividad (${horaDeMinuto(p.desde)} - ${horaDeMinuto(p.hasta)})${p.enCurso ? ', y sigue' : ''}`}
          className="absolute inset-y-0 border-x"
          style={{
            left: `${pct(p.desde)}%`,
            width: `${pct(p.hasta) - pct(p.desde)}%`,
            backgroundImage: RAYAS_DE_PAUSA,
            borderColor: `color-mix(in srgb, ${COLOR_ESTADO.ambar} ${p.enCurso ? 45 : 28}%, transparent)`,
          }}
        />
      ))}
      {ahora !== null && ahora >= ventana.desde && ahora <= ventana.hasta && (
        <span className="absolute inset-y-0 w-px bg-[var(--ls-acc-graf)]" style={{ left: `${pct(ahora)}%` }}>
          <span className="absolute -left-[3px] -top-[3px] h-[7px] w-[7px] rounded-full bg-[var(--ls-acc-graf)] rend-latido" />
        </span>
      )}
    </div>
  )
}

/** El chip de lo que lleva sin actividad o de su pausa más larga: lo que se mira de un vistazo en la cabecera */
function Chip({ children, tono }: { children: ReactNode; tono?: 'ambar' }) {
  return (
    <span
      className={`inline-flex h-[20px] items-center gap-1 whitespace-nowrap rounded-[5px] px-1.5 text-[11px] tabular-nums ${tono === 'ambar' ? '' : 'bg-[var(--ls-sup2)] text-[var(--ls-t3)]'}`}
      style={tono === 'ambar' ? { color: COLOR_ESTADO.ambar, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 14%, transparent)` } : undefined}
    >
      {children}
    </span>
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
  // «30 intentos a 25 clientes · 4 recibidas»: por qué hay más rayas que la cifra de llamadas. Vacío si cada llamada fue a un cliente distinto
  const desglose = desgloseDeLlamadas(resumen.llamadas)

  return (
    <section className={`${PANEL} rend-aparece overflow-hidden transition-opacity duration-300 ${cargando ? 'opacity-60' : ''}`} aria-label={titulo}>
      <CabeceraDePanel
        icono={<Clock className="h-3.5 w-3.5" />}
        titulo={titulo}
        derecha={
          resumen.total > 0 ? (
            <div className="flex flex-wrap items-center justify-end gap-1.5">
              <Chip>
                de <span className="font-semibold text-[var(--ls-t1)]">{resumen.primera}</span> a <span className="font-semibold text-[var(--ls-t1)]">{resumen.ultima}</span>
              </Chip>
              {resumen.pausaMasLarga && !resumen.pausaMasLarga.enCurso && (
                <Chip tono="ambar">
                  pausa más larga {textoDeMinutos(resumen.pausaMasLarga.minutos)} ({horaDeMinuto(resumen.pausaMasLarga.desde)}–{horaDeMinuto(resumen.pausaMasLarga.hasta)})
                </Chip>
              )}
              {enCurso && (
                <Chip tono="ambar">
                  <span className="rend-latido h-1.5 w-1.5 rounded-full" style={{ background: 'currentColor' }} />
                  sin actividad desde las {horaDeMinuto(enCurso.desde)} ({textoDeMinutos(enCurso.minutos)})
                </Chip>
              )}
            </div>
          ) : (
            <span className="text-[11.5px] text-[var(--ls-t4)]">{cargando ? 'Leyendo el día…' : 'Ese día no hay nada apuntado.'}</span>
          )
        }
      />

      <div className="px-3 pb-3 pt-2">
        <div className="overflow-x-auto">
          {/* El margen de la derecha deja sitio a la mitad de la última hora del eje, que si no se corta */}
          <div className="min-w-[720px] pr-3">
            <div className="grid h-[16px] items-end" style={{ gridTemplateColumns: `${ANCHO_DE_ETIQUETA}px minmax(0, 1fr)` }}>
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
                <div key={c.id} className="grid items-center border-t border-[var(--ls-linea)]" style={{ gridTemplateColumns: `${ANCHO_DE_ETIQUETA}px minmax(0, 1fr)` }}>
                  <span className="flex items-center gap-1.5 pr-2 text-[11.5px] text-[var(--ls-t3)]">
                    <span className="h-1.5 w-1.5 rounded-full" style={{ background: COLOR_DE_CARRIL[c.id] }} />
                    {c.etiqueta}
                    {/* En «Llamadas», clientes distintos (la cifra de las tarjetas y de la tabla); en el resto, cada apunte */}
                    <span className="tabular-nums text-[var(--ls-t4)]">{c.id === 'llamadas' ? resumen.llamadas.clientes : resumen.porCarril[c.id]}</span>
                  </span>
                  <div className="relative h-[26px]">
                    {eventos
                      .filter((e) => e.carril === c.id)
                      .map((e, orden) => (
                        <Marca key={e.id} evento={e} ventana={ventana} activa={activo === e.id} onActivar={setActivo} orden={orden} />
                      ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-2.5 space-y-2">
          <DetalleDeMarca evento={eventoActivo} vacio="Pasa el ratón o pulsa una marca para ver qué fue: la hora, el cliente y lo que se apuntó." />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10.5px] text-[var(--ls-t4)]">
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-[3px] rounded-full" style={{ background: COLOR_DE_LLAMADA.conversacion }} /> conversación (más de 1 min)
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px] rounded-full" style={{ background: COLOR_DE_LLAMADA.contestada }} /> contestada
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px] rounded-full" style={{ background: COLOR_DE_LLAMADA.contestador }} /> sin contestar o contestador
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-[3px] rounded-full" style={{ background: COLOR_DE_LLAMADA.recibida }} /> recibida
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-4 rounded-[2px] border" style={{ backgroundImage: RAYAS_DE_PAUSA, borderColor: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 30%, transparent)` }} /> 30 min o más sin actividad
            </span>
            {desglose && (
              <span className="basis-full">
                Llamadas: {desglose}. Cada raya es un intento (o una recibida); la cifra cuenta un cliente una sola vez al día, como el resto de cifras del panel.
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
