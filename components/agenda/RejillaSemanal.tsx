'use client'

import { memo, useMemo, useState, type PointerEvent as EventoDePuntero, type RefObject } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import type { AppointmentWithPeople } from '@/lib/types/appointments'
import { parseTimeToHourMinute, type AvailabilityWindow } from '@/lib/types/availability'
import { alturaDeLaHora, huecoDeLaRejilla, REJILLA, type Colocada } from '@/lib/agenda/colocar'
import { DURACION_CITA_MS } from '@/lib/agenda/duracion'
import { colorForAgent } from '@/lib/types/appointments'
import { BloqueDeCita } from './BloqueDeCita'
import type { EntradaDePresencia } from './usePresencia'

/**
 * LA REJILLA SEMANAL: cabecera de días, columna de horas y una columna por día.
 *
 * LO QUE CAMBIA CON LA REJILLA DE ANTES (el comportamiento es el mismo):
 *
 *   · Las líneas de las horas ya no son 26 `<div>` por columna (13 horas × 2 líneas × 7 columnas = 182 nodos): son dos degradados CSS en el fondo de cada columna.
 *   · El indicador de la hora bajo el ratón vive en SU columna, con su propio estado. Antes era un estado del calendario entero y cada movimiento del ratón repintaba
 *     todas las citas de la semana; ahora repinta una línea y una etiqueta.
 *   · Las columnas y los bloques están memorizados: pasar el ratón, el reloj de cada minuto o abrir una ficha no los vuelve a calcular.
 *   · Los huecos de Google van en su propia capa, detrás: una cita del ERP que cae encima de uno ya no se parte en dos columnas de medio ancho, como pasaba cuando
 *     todo se repartía junto.
 */

type Cita = AppointmentWithPeople

export interface CapaDelDia {
  externas: Colocada<Cita>[]
  propias: Colocada<Cita>[]
}

export interface DestinoDeArrastre {
  /** «2026-10-28» */
  dia: string
  hour: number
  minute: number
}

const ALTO_TOTAL = (REJILLA.finDia - REJILLA.inicioDia) * REJILLA.alturaHora
const HORAS = Array.from({ length: REJILLA.finDia - REJILLA.inicioDia }, (_, i) => REJILLA.inicioDia + i)
const COLUMNAS_ESCRITORIO = '56px repeat(7, minmax(0, 1fr))'
const COLUMNAS_MOVIL = '48px minmax(0, 1fr)'

// La línea de cada hora (1 px arriba de cada tramo de 64) y la de la media hora, más suave (en el px 31 del tramo)
const LINEAS =
  'linear-gradient(to bottom, var(--ls-linea) 0, var(--ls-linea) 1px, transparent 1px), ' +
  'linear-gradient(to bottom, transparent 31px, color-mix(in srgb, var(--ls-linea) 55%, transparent) 31px, color-mix(in srgb, var(--ls-linea) 55%, transparent) 32px, transparent 32px)'
const TAMANO_DE_LINEAS = `100% ${REJILLA.alturaHora}px, 100% ${REJILLA.alturaHora}px`

const dosDigitos = (n: number) => String(n).padStart(2, '0')

interface PropsColumna {
  /** Una sola columna (móvil): toda ella es «hoy» y teñirla entera cansa; solo se tiñe la cabecera */
  movil: boolean
  dia: Date
  /** «2026-10-28» */
  clave: string
  esHoy: boolean
  capa: CapaDelDia
  ventanas: AvailabilityWindow[]
  presentes: EntradaDePresencia[]
  editores: ReadonlyMap<string, EntradaDePresencia>
  /** Dónde está la línea de «ahora», solo en la columna de hoy */
  ahoraTop: number | null
  arrastrando: Cita | null
  /** Solo la columna sobre la que caería llega con destino: las demás no se repintan mientras se arrastra */
  destino: DestinoDeArrastre | null
  esAdmin: boolean
  usuarioId: string
  onHueco: (dia: Date, hour: number, minute: number) => void
  onAbrir: (cita: Cita) => void
  onArrastrar: (e: EventoDePuntero, cita: Cita) => void
  consumirArrastre: () => boolean
}

function ColumnaSinMemoria({
  movil, dia, clave, esHoy, capa, ventanas, presentes, editores, ahoraTop, arrastrando, destino, esAdmin, usuarioId, onHueco, onAbrir, onArrastrar, consumirArrastre,
}: PropsColumna) {
  // Los minutos desde las 00:00 del hueco de media hora bajo el ratón (o null). Un número y no un objeto: pasar a otro punto del mismo hueco no repinta nada
  const [hover, setHover] = useState<number | null>(null)

  const franjas = useMemo(
    () =>
      ventanas
        .filter((w) => w.days_of_week.includes(dia.getDay()))
        .map((w) => {
          const ini = parseTimeToHourMinute(w.start_time)
          const fin = parseTimeToHourMinute(w.end_time)
          const top = alturaDeLaHora(ini.hour, ini.minute)
          return { id: w.id, top, height: alturaDeLaHora(fin.hour, fin.minute) - top }
        }),
    [ventanas, dia]
  )

  const puedeArrastrar = (c: Cita) => !c.is_external && (esAdmin || c.comercial_id === usuarioId)
  const creandoAqui = presentes.filter((p) => p.mode === 'create' && p.dia === clave)

  return (
    <div
      data-dia={clave}
      className="relative cursor-pointer border-l border-[var(--ls-linea)]"
      style={{
        height: ALTO_TOTAL,
        backgroundImage: LINEAS,
        backgroundSize: TAMANO_DE_LINEAS,
        backgroundColor: esHoy && !movil ? 'color-mix(in srgb, var(--ls-acc-suave) 38%, transparent)' : undefined,
      }}
      onMouseMove={(e) => {
        if (arrastrando) return
        const caja = e.currentTarget.getBoundingClientRect()
        const { hour, minute } = huecoDeLaRejilla(e.clientY - caja.top)
        setHover(hour * 60 + minute)
      }}
      onMouseLeave={() => setHover(null)}
      onClick={(e) => {
        // Soltar un arrastre también dispara un clic en la columna: ese no agenda nada
        if (consumirArrastre()) return
        const caja = e.currentTarget.getBoundingClientRect()
        const { hour, minute } = huecoDeLaRejilla(e.clientY - caja.top)
        setHover(null)
        onHueco(dia, hour, minute)
      }}
    >
      {/* Franjas de disponibilidad: informativas */}
      {franjas.map((f) => (
        <div
          key={f.id}
          aria-hidden
          className="pointer-events-none absolute inset-x-0 border-y"
          style={{
            top: f.top,
            height: f.height,
            background: 'color-mix(in srgb, var(--ls-e-verde) 7%, transparent)',
            borderColor: 'color-mix(in srgb, var(--ls-e-verde) 28%, transparent)',
          }}
        />
      ))}

      {/* Huecos de Google, detrás */}
      {capa.externas.map((c) => (
        <BloqueDeCita key={c.cita.id} colocada={c} puedeArrastrar={false} oculta={false} onAbrir={onAbrir} onArrastrar={onArrastrar} />
      ))}

      {/* Alguien más está rellenando una cita nueva a esta hora */}
      {creandoAqui.map((p) => (
        <div
          key={p.userId}
          className="pointer-events-none absolute inset-x-1 z-30 overflow-hidden rounded-[6px] border-2 border-dashed px-1.5 py-0.5"
          style={{ top: alturaDeLaHora(p.hour ?? REJILLA.inicioDia, p.minute ?? 0), height: REJILLA.alturaHora / 2, borderColor: p.color, background: `${p.color}1f` }}
        >
          <div className="flex items-center gap-1 truncate text-[10.5px] font-semibold" style={{ color: p.color }}>
            <span className="relative flex h-1.5 w-1.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" style={{ backgroundColor: p.color }} />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full" style={{ backgroundColor: p.color }} />
            </span>
            {p.fullName || p.email} agendando...
          </div>
        </div>
      ))}

      {/* Línea de la hora bajo el ratón */}
      {hover !== null && !arrastrando && (
        <div className="pointer-events-none absolute inset-x-0 z-30" style={{ top: alturaDeLaHora(Math.floor(hover / 60), hover % 60) }}>
          <div className="border-t border-dashed" style={{ borderColor: 'color-mix(in srgb, var(--ls-acc-graf) 70%, transparent)' }} />
          <span className="absolute -top-[11px] left-1 rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1.5 text-[10.5px] font-semibold tabular-nums text-[var(--ls-t1)] shadow-sm">
            {dosDigitos(Math.floor(hover / 60))}:{dosDigitos(hover % 60)}
          </span>
        </div>
      )}

      {/* Línea de ahora */}
      {ahoraTop !== null && (
        <div className="pointer-events-none absolute inset-x-0 z-20 flex items-center" style={{ top: ahoraTop }}>
          <span className="-ml-[4px] h-2 w-2 rounded-full bg-[var(--ls-acc-graf)]" />
          <span className="h-[2px] flex-1 bg-[var(--ls-acc-graf)]" />
        </div>
      )}

      {/* Las citas del ERP, por encima de los huecos */}
      {capa.propias.map((c) => (
        <BloqueDeCita
          key={c.cita.id}
          colocada={c}
          puedeArrastrar={puedeArrastrar(c.cita)}
          oculta={arrastrando?.id === c.cita.id}
          editor={editores.get(c.cita.id)}
          onAbrir={onAbrir}
          onArrastrar={onArrastrar}
        />
      ))}

      {/* El «fantasma» de la cita que se está arrastrando, en el hueco donde caería */}
      {arrastrando && destino && <Fantasma cita={arrastrando} destino={destino} esAdmin={esAdmin} />}
    </div>
  )
}

function Fantasma({ cita, destino, esAdmin }: { cita: Cita; destino: DestinoDeArrastre; esAdmin: boolean }) {
  const color = cita.comercial ? colorForAgent(cita.comercial.id, cita.comercial.calendar_color) : '#FF6600'
  // Un administrador conserva la duración que tuviera; un comercial la deja en una hora (lib/agenda/duracion.ts)
  const milis = esAdmin ? new Date(cita.end_time).getTime() - new Date(cita.start_time).getTime() : DURACION_CITA_MS
  const alto = Math.max((milis / 3_600_000) * REJILLA.alturaHora, REJILLA.alturaMinima)
  return (
    <div
      className="pointer-events-none absolute inset-x-1 z-40 overflow-hidden rounded-[6px] border-2 border-dashed px-2 py-1"
      style={{ top: alturaDeLaHora(destino.hour, destino.minute), height: alto, borderColor: color, background: `color-mix(in srgb, ${color} 24%, var(--ls-sup))` }}
    >
      {/* Si la cita es baja (media hora) no caben dos líneas: la hora va delante del nombre */}
      {alto < 44 ? (
        <div className="flex items-baseline gap-1.5 truncate text-[12px] font-semibold text-[var(--ls-t1)]">
          <span className="text-[10.5px] font-normal tabular-nums text-[var(--ls-t2)]">
            {dosDigitos(destino.hour)}:{dosDigitos(destino.minute)}
          </span>
          <span className="truncate">{cita.lead_name}</span>
        </div>
      ) : (
        <>
          <div className="truncate text-[12px] font-semibold text-[var(--ls-t1)]">{cita.lead_name}</div>
          <div className="text-[10.5px] tabular-nums text-[var(--ls-t2)]">
            {dosDigitos(destino.hour)}:{dosDigitos(destino.minute)}
          </div>
        </>
      )}
    </div>
  )
}

const Columna = memo(ColumnaSinMemoria)

interface Props {
  dias: Date[]
  movil: boolean
  /** Cambia con la semana: es lo que hace que la rejilla «entre» de nuevo */
  claveDeSemana: string
  direccion: number
  capas: ReadonlyMap<string, CapaDelDia>
  /** Cuántas citas del ERP tiene cada día (la cifra bajo el número del día) */
  conteo: ReadonlyMap<string, number>
  ventanas: AvailabilityWindow[]
  presencia: EntradaDePresencia[]
  /** La hora de España ahora, y la clave del día de hoy */
  ahora: Date
  hoy: string
  arrastrando: { cita: Cita; destino: DestinoDeArrastre | null } | null
  esAdmin: boolean
  usuarioId: string
  /** El contenedor que hace scroll (la pantalla lo usa para centrar la hora de ahora al abrir y para medir al arrastrar) */
  contenedorRef: RefObject<HTMLDivElement>
  onHueco: (dia: Date, hour: number, minute: number) => void
  onAbrir: (cita: Cita) => void
  onArrastrar: (e: EventoDePuntero, cita: Cita) => void
  consumirArrastre: () => boolean
}

const CAPA_VACIA: CapaDelDia = { externas: [], propias: [] }

export function RejillaSemanal({
  dias, movil, claveDeSemana, direccion, capas, conteo, ventanas, presencia, ahora, hoy, arrastrando, esAdmin, usuarioId, contenedorRef, onHueco, onAbrir, onArrastrar, consumirArrastre,
}: Props) {
  const columnas = movil ? COLUMNAS_MOVIL : COLUMNAS_ESCRITORIO
  const minutosDeAhora = (ahora.getHours() - REJILLA.inicioDia) * 60 + ahora.getMinutes()
  const ahoraEnRejilla = ahora.getHours() >= REJILLA.inicioDia && ahora.getHours() < REJILLA.finDia
  const ahoraTop = ahoraEnRejilla ? (minutosDeAhora / 60) * REJILLA.alturaHora : null
  const hayHoy = dias.some((d) => format(d, 'yyyy-MM-dd') === hoy)

  const editores = useMemo(() => {
    const m = new Map<string, EntradaDePresencia>()
    for (const p of presencia) if (p.mode === 'edit' && p.appointmentId) m.set(p.appointmentId, p)
    return m
  }, [presencia])

  const entrada = direccion === 0 ? '' : direccion > 0 ? 'slide-in-from-right-3' : 'slide-in-from-left-3'

  return (
    <div ref={contenedorRef} className="min-h-0 flex-1 overflow-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <div className={movil ? '' : 'min-w-[880px]'}>
        {/* Cabecera de días, pegada arriba al hacer scroll */}
        <div className="sticky top-0 z-30 grid border-b border-[var(--ls-linea2)] bg-[var(--ls-sup2)]" style={{ gridTemplateColumns: columnas }}>
          <div />
          {dias.map((d) => {
            const clave = format(d, 'yyyy-MM-dd')
            const esHoy = clave === hoy
            const n = conteo.get(clave) ?? 0
            return (
              <div
                key={clave}
                className="border-l border-[var(--ls-linea)] py-[7px] text-center"
                style={esHoy ? { background: 'var(--ls-acc-suave)' } : undefined}
              >
                <div className="text-[11px] font-medium text-[var(--ls-t4)]">{format(d, movil ? 'EEEE' : 'EEE', { locale: es })}</div>
                <div
                  className={`mx-auto mt-0.5 inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[14px] font-semibold tabular-nums ${
                    esHoy ? 'bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]' : 'text-[var(--ls-t1)]'
                  }`}
                >
                  {format(d, 'd')}
                </div>
                <div className="h-[14px] text-[10.5px] leading-[14px] text-[var(--ls-t3)]">{n > 0 ? `${n} ${n === 1 ? 'cita' : 'citas'}` : ''}</div>
              </div>
            )
          })}
        </div>

        {/* Horas y días. Con `key` por semana, al cambiar de semana la rejilla entra de nuevo con un fundido corto */}
        <div key={claveDeSemana} className={`grid animate-in fade-in-0 duration-200 ${entrada}`} style={{ gridTemplateColumns: columnas }}>
          <div className="relative" style={{ height: ALTO_TOTAL }}>
            {HORAS.map((h, i) => (
              <span
                key={h}
                className={`absolute right-2 text-[10.5px] tabular-nums text-[var(--ls-t4)] ${i === 0 ? 'translate-y-[3px]' : '-translate-y-1/2'}`}
                style={{ top: i * REJILLA.alturaHora }}
              >
                {dosDigitos(h)}:00
              </span>
            ))}
            {hayHoy && ahoraTop !== null && (
              <span
                className="absolute right-1 z-10 -translate-y-1/2 rounded-[4px] bg-[var(--ls-acc-relleno)] px-1 text-[10px] font-bold tabular-nums leading-[15px] text-[var(--ls-acc-tinta)]"
                style={{ top: ahoraTop }}
              >
                {format(ahora, 'HH:mm')}
              </span>
            )}
          </div>

          {dias.map((d) => {
            const clave = format(d, 'yyyy-MM-dd')
            const esHoy = clave === hoy
            return (
              <Columna
                key={clave}
                movil={movil}
                dia={d}
                clave={clave}
                esHoy={esHoy}
                capa={capas.get(clave) ?? CAPA_VACIA}
                ventanas={ventanas}
                presentes={presencia}
                editores={editores}
                ahoraTop={esHoy ? ahoraTop : null}
                arrastrando={arrastrando?.cita ?? null}
                destino={arrastrando?.destino?.dia === clave ? arrastrando.destino : null}
                esAdmin={esAdmin}
                usuarioId={usuarioId}
                onHueco={onHueco}
                onAbrir={onAbrir}
                onArrastrar={onArrastrar}
                consumirArrastre={consumirArrastre}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}
