'use client'

import { memo, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowRight, CalendarClock, Check, MessagesSquare, Phone, RotateCcw, UserRound, X } from 'lucide-react'
import { BOTON, COLOR_ESTADO, INSIGNIA, type TonoEstado } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { colorForAgent, type CalendarPerson } from '@/lib/types/appointments'
import { CRM_STAGE_DOTS, CRM_STAGE_LABELS, type CrmClientWithDetails, type CrmStage } from '@/lib/types/crm'
import type { AlcanceDelCrm } from '@/lib/crm/acceso'
import { ETIQUETA_CORTA, type ResumenDeFila } from '@/lib/crm/lista'
import { ETIQUETA_DE_SITUACION, FASES_DEL_SEGUIMIENTO, MOTIVOS_DE_DESCARTE, diasDesde, motivoDeDescarte, siguientePaso, sugerenciaDeLaCita, type AccionDeFase, type ResumenDeContactos, type SituacionDeLaCita } from '@/lib/crm/pestanas'
import { INTERES } from './etiquetas'

/**
 * LAS FILAS DE LAS TRES PESTAÑAS DEL CRM: CITA AGENDADA, EN SEGUIMIENTO Y CERRADO.
 * ===============================================================================
 * Cada pestaña enseña de un lead lo que importa en ESE momento y ofrece lo que se hace con él (lib/crm/pestanas.ts decide qué acciones hay en cada fase; aquí solo se pintan):
 *
 *   · Cita agendada: cómo salió la cita y, a la derecha, SEGUIR o DESCARTAR. Si la cita salió cualificada se destaca «Seguir»; si no cualificó o no asistió, «Descartar». Es una
 *     sugerencia: los dos botones siempre están. Descartar pide un motivo (opcional) en la propia fila, sin ventanas.
 *   · En seguimiento: el PROCESO del lead (Seguimiento → Propuesta → Revisión → Negociación), desde cuándo, lo que toca hacer y cuándo fue el último contacto. Avanzar, cerrar o perder.
 *   · Cerrado: ganados (con su ciclo y, a quien los ve, los importes) y perdidos (con el motivo). Reabrir.
 *
 * Las tres caben en una lista estrecha (con la ficha abierta a la derecha): dos o tres líneas y los botones debajo, nada de columnas fijas.
 */

const corto = (iso: string) => format(toMadrid(new Date(iso)), 'd MMM', { locale: es })
const conHora = (iso: string) => format(toMadrid(new Date(iso)), "EEE d MMM · HH:mm", { locale: es })
const dinero = (n: number | null | undefined) => (n == null ? null : `${Number(n).toLocaleString('es-ES')} €`)

const TONO_DE_SITUACION: Record<SituacionDeLaCita, TonoEstado> = {
  por_celebrar: 'azul',
  sin_resultado: 'ambar',
  cualificada: 'verde',
  no_cualificada: 'rojo',
  no_asistio: 'naranja',
  cancelada: 'gris',
  sin_cita: 'gris',
}

const textoDelContacto = (kind: string) => ({ llamada: 'Llamada', email: 'Email', whatsapp: 'WhatsApp', reunion: 'Reunión', propuesta: 'Propuesta' })[kind] ?? 'Contacto'

/* ------------------------------------------------------------------ */
/* Piezas comunes                                                      */
/* ------------------------------------------------------------------ */

function Marco({ c, activa, onElegir, children }: { c: CrmClientWithDetails; activa: boolean; onElegir: (id: string) => void; children: ReactNode }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onElegir(c.id)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          onElegir(c.id)
        }
      }}
      aria-current={activa ? 'true' : undefined}
      className={`relative cursor-pointer border-b border-[var(--ls-linea)] px-3 py-[9px] outline-none hover:bg-[var(--ls-sup3)] focus-visible:bg-[var(--ls-sup3)] ${activa ? 'bg-[var(--ls-sel)]' : ''}`}
    >
      {activa && <span className="absolute inset-y-0 left-0 w-[2px] bg-[var(--ls-acc-graf)]" />}
      {children}
    </div>
  )
}

/** Quién lleva el cliente: su círculo de color y su nombre. Solo se enseña a quien ve a todo el equipo (un autónomo solo ve los suyos: no aporta nada) */
function Responsable({ dueno }: { dueno: CalendarPerson | null | undefined }) {
  if (!dueno) return <span className="text-[11px] text-[var(--ls-t4)]">Sin responsable</span>
  const nombre = dueno.full_name || dueno.email || '?'
  return (
    <span className="inline-flex min-w-0 items-center gap-[5px] text-[11px] text-[var(--ls-t3)]" title={`Lo lleva ${nombre}`}>
      <span className="flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-full text-[8px] font-bold text-white" style={{ backgroundColor: colorForAgent(dueno.id, dueno.calendar_color) }}>
        {nombre.slice(0, 2).toUpperCase()}
      </span>
      <span className="truncate">{nombre.split(' ')[0]}</span>
    </span>
  )
}

function Cabecera({ c, r, derecha, dueno, mostrarResponsable, color }: { c: CrmClientWithDetails; r: ResumenDeFila; derecha?: ReactNode; dueno?: CalendarPerson | null; mostrarResponsable: boolean; color?: string }) {
  return (
    <>
      <div className="flex items-center gap-2">
        <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: color ?? CRM_STAGE_DOTS[c.stage] }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ls-t1)]">{r.nombre}</span>
        {derecha && <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-[var(--ls-t3)]">{derecha}</span>}
      </div>
      <div className="mt-px flex items-center gap-2 pl-[15px]">
        <span className="min-w-0 truncate text-[11.5px] text-[var(--ls-t3)]">{r.empresa ?? 'Sin empresa'}</span>
        {mostrarResponsable && (
          <>
            <span aria-hidden className="text-[var(--ls-t4)]">·</span>
            <Responsable dueno={dueno} />
          </>
        )}
      </div>
    </>
  )
}

/** El interés que dedujo la IA de la última reunión y cuántas reuniones tienen notas */
function Pistas({ r }: { r: ResumenDeFila }) {
  return (
    <>
      {r.interes && (
        <span className="shrink-0 text-[11px] font-medium" style={{ color: COLOR_ESTADO[INTERES[r.interes].tono] }} title={INTERES[r.interes].texto}>
          {r.interes === 'alto' ? '▲' : r.interes === 'medio' ? '◆' : r.interes === 'bajo' ? '▽' : r.interes === 'ninguno' ? '✕' : '·'}
        </span>
      )}
      {r.notas > 0 && (
        <span className="inline-flex shrink-0 items-center gap-[2px] text-[11px] tabular-nums text-[var(--ls-t4)]" title={`${r.notas} reunión${r.notas === 1 ? '' : 'es'} con notas${r.porAnalizar ? ' (alguna por analizar)' : ''}`}>
          <MessagesSquare className="h-[11px] w-[11px]" />
          {r.notas}
        </span>
      )}
    </>
  )
}

/** Un botón de la fila. No propaga el clic: pulsarlo no abre la ficha */
function Accion({ tono = 'secundario', icono, children, onClick, disabled, titulo }: { tono?: 'primario' | 'secundario' | 'peligro'; icono?: ReactNode; children: ReactNode; onClick: () => void; disabled?: boolean; titulo?: string }) {
  const clase =
    tono === 'primario'
      ? BOTON.primario
      : tono === 'peligro'
        ? 'border-[var(--ls-e-rojo)] bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)] text-[var(--ls-e-rojo)] font-semibold hover:brightness-110'
        : BOTON.secundario
  return (
    <button
      type="button"
      disabled={disabled}
      title={titulo}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`${BOTON.base} ${clase} [&>svg]:h-3 [&>svg]:w-3`}
    >
      {icono}
      {children}
    </button>
  )
}

/** El motivo de descartar, dentro de la propia fila: un clic en el motivo y hecho. «Otro» deja escribir una frase */
function SelectorDeMotivo({ onElegir, onCancelar }: { onElegir: (motivo: string | null, detalle?: string) => void; onCancelar: () => void }) {
  const [otro, setOtro] = useState(false)
  const [detalle, setDetalle] = useState('')
  const chip = `${BOTON.chip} !h-[22px] hover:!border-[var(--ls-linea2)]`
  return (
    <div className="mt-2 rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] p-2" onClick={(e) => e.stopPropagation()} role="group" aria-label="Motivo del descarte">
      <p className="mb-1.5 text-[11px] text-[var(--ls-t3)]">¿Por qué se descarta? <span className="text-[var(--ls-t4)]">(opcional: queda apuntado en la Actividad del cliente)</span></p>
      <div className="flex flex-wrap gap-1">
        {MOTIVOS_DE_DESCARTE.map((m) =>
          m === 'Otro' ? (
            <button key={m} type="button" className={`${chip} ${otro ? BOTON.chipEncendido : ''}`} onClick={() => setOtro(true)}>
              Otro…
            </button>
          ) : (
            <button key={m} type="button" className={chip} onClick={() => onElegir(m)}>
              {m}
            </button>
          )
        )}
        <button type="button" className={`${chip} text-[var(--ls-t4)]`} onClick={() => onElegir(null)}>
          Sin motivo
        </button>
        <button type="button" className={`${chip} text-[var(--ls-t4)]`} onClick={onCancelar}>
          Cancelar
        </button>
      </div>
      {otro && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <input
            autoFocus
            value={detalle}
            onChange={(e) => setDetalle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onElegir('Otro', detalle)
              if (e.key === 'Escape') onCancelar()
            }}
            maxLength={200}
            placeholder="Cuéntalo en una frase"
            className="h-6 min-w-0 flex-1 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2 text-[12px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
          />
          <Accion tono="primario" onClick={() => onElegir('Otro', detalle)}>
            Descartar
          </Accion>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* CITA AGENDADA                                                       */
/* ------------------------------------------------------------------ */

export interface PropsDeFila {
  c: CrmClientWithDetails
  r: ResumenDeFila
  activa: boolean
  onElegir: (id: string) => void
  alcance: AlcanceDelCrm
  dueno: CalendarPerson | null | undefined
  ocupado: boolean
  onAccion: (c: CrmClientWithDetails, accion: AccionDeFase, descarte?: { motivo: string | null; detalle?: string | null }) => void
}

const RESULTADOS_DE_CITA: ReadonlyArray<{ valor: 'qualified' | 'not_qualified' | 'no_show'; texto: string; titulo: string }> = [
  { valor: 'qualified', texto: 'Cualif.', titulo: 'Cita cualificada: genera la comisión del comercial que la agendó' },
  { valor: 'not_qualified', texto: 'No cualif.', titulo: 'Cita no cualificada' },
  { valor: 'no_show', texto: 'No asistió', titulo: 'El lead no se presentó' },
]

export const FilaDeCita = memo(function FilaDeCita({
  c,
  r,
  activa,
  onElegir,
  alcance,
  dueno,
  ocupado,
  onAccion,
  situacion,
  onResultadoDeCita,
}: PropsDeFila & { situacion: SituacionDeLaCita; onResultadoDeCita: (c: CrmClientWithDetails, estado: 'qualified' | 'not_qualified' | 'no_show') => void }) {
  const [descartando, setDescartando] = useState(false)
  const sugerencia = sugerenciaDeLaCita(situacion)
  const inicio = c.appointment?.start_time
  const estadoCita = c.appointment?.status
  return (
    <Marco c={c} activa={activa} onElegir={onElegir}>
      <Cabecera c={c} r={r} dueno={dueno} mostrarResponsable={alcance.veTodos} derecha={inicio ? conHora(inicio) : 'Alta manual'} />
      <div className="mt-[6px] flex flex-wrap items-center gap-x-2 gap-y-[6px] pl-[15px]">
        {alcance.puedeResultadoDeCita && c.appointment ? (
          <span className="inline-flex items-center gap-[3px]" role="group" aria-label="Resultado de la cita">
            {RESULTADOS_DE_CITA.map((o) => {
              const encendido = estadoCita === o.valor
              return (
                <button
                  key={o.valor}
                  type="button"
                  disabled={ocupado}
                  title={o.titulo}
                  onClick={(e) => {
                    e.stopPropagation()
                    if (!encendido) onResultadoDeCita(c, o.valor)
                  }}
                  className={`inline-flex h-[20px] items-center rounded-[5px] border px-[6px] text-[10.5px] font-medium disabled:opacity-50 ${
                    encendido ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
                  }`}
                >
                  {o.texto}
                </button>
              )
            })}
          </span>
        ) : (
          <span className={INSIGNIA.base} title={c.appointment ? 'Cómo salió la cita. Lo marca dirección' : 'Alta manual: no hay cita en la agenda'}>
            <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: COLOR_ESTADO[TONO_DE_SITUACION[situacion]] }} />
            {ETIQUETA_DE_SITUACION[situacion]}
          </span>
        )}
        <Pistas r={r} />
        <span className="flex-1" />
        {alcance.puedeMover && (
          <span className="inline-flex items-center gap-1">
            <Accion tono={sugerencia === 'seguir' ? 'primario' : 'secundario'} disabled={ocupado} onClick={() => onAccion(c, 'seguir')} icono={<ArrowRight />} titulo="Seguir con este lead: pasa a «En seguimiento»">
              Seguir
            </Accion>
            <Accion tono={sugerencia === 'descartar' ? 'peligro' : 'secundario'} disabled={ocupado} onClick={() => setDescartando((v) => !v)} icono={<X />} titulo="Descartar este lead: se da por perdido">
              Descartar
            </Accion>
          </span>
        )}
      </div>
      {descartando && (
        <SelectorDeMotivo
          onCancelar={() => setDescartando(false)}
          onElegir={(motivo, detalle) => {
            setDescartando(false)
            onAccion(c, 'descartar', { motivo, detalle })
          }}
        />
      )}
    </Marco>
  )
})

/* ------------------------------------------------------------------ */
/* EN SEGUIMIENTO                                                      */
/* ------------------------------------------------------------------ */

/** El proceso: cuatro pasos, llenos hasta el actual, con el nombre debajo */
function Proceso({ stage }: { stage: CrmStage }) {
  const actual = FASES_DEL_SEGUIMIENTO.indexOf(stage)
  return (
    <ol className="flex w-full max-w-[360px] items-start gap-[3px]" aria-label="Proceso del lead">
      {FASES_DEL_SEGUIMIENTO.map((f, i) => {
        const hecho = i < actual
        const esActual = i === actual
        return (
          <li key={f} className="min-w-0 flex-1" aria-current={esActual ? 'step' : undefined}>
            <span className="block h-[3px] rounded-[1px]" style={{ backgroundColor: i <= actual ? 'var(--ls-acc-graf)' : 'var(--ls-linea2)', opacity: hecho ? 0.55 : 1 }} />
            <span className={`mt-[3px] block truncate text-[10px] leading-none ${esActual ? 'font-semibold text-[var(--ls-t1)]' : hecho ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t4)]'}`}>{ETIQUETA_CORTA[f]}</span>
          </li>
        )
      })}
    </ol>
  )
}

export const FilaDeSeguimiento = memo(function FilaDeSeguimiento({
  c,
  r,
  activa,
  onElegir,
  alcance,
  dueno,
  ocupado,
  onAccion,
  contactos,
  ahora,
}: PropsDeFila & { contactos: ResumenDeContactos | undefined; ahora: number }) {
  const [perdiendo, setPerdiendo] = useState(false)
  const siguiente = siguientePaso(c.stage)
  const dias = contactos?.ultimo ? diasDesde(contactos.ultimo.en, ahora) : null
  const colorAccion = r.accion?.estado === 'vencida' ? COLOR_ESTADO.rojo : r.accion?.estado === 'hoy' ? COLOR_ESTADO.ambar : undefined
  return (
    <Marco c={c} activa={activa} onElegir={onElegir}>
      <Cabecera c={c} r={r} dueno={dueno} mostrarResponsable={alcance.veTodos} derecha={`${ETIQUETA_CORTA[c.stage]}${r.diasEnLaFase !== null ? ` · ${r.diasEnLaFase} d` : ''}`} />
      <div className="mt-[7px] pl-[15px]">
        <Proceso stage={c.stage} />
      </div>
      <div className="mt-[7px] flex flex-wrap items-center gap-x-3 gap-y-[3px] pl-[15px] text-[11px]">
        <span className="inline-flex min-w-0 items-center gap-1" style={{ color: colorAccion ?? 'var(--ls-t3)' }} title="Próxima acción">
          <CalendarClock className="h-[11px] w-[11px] shrink-0" />
          <span className="truncate">
            {r.accion && (r.accion.texto || r.accion.fecha) ? (
              <>
                {r.accion.texto || 'Acción'}
                {r.accion.fecha ? ` · ${corto(`${r.accion.fecha.slice(0, 10)}T12:00:00Z`)}` : ''}
                {r.accion.estado === 'vencida' ? ' · vencida' : r.accion.estado === 'hoy' ? ' · hoy' : ''}
              </>
            ) : (
              'Sin próxima acción'
            )}
          </span>
        </span>
        <span className="inline-flex items-center gap-1 text-[var(--ls-t3)]" title={contactos?.ultimo ? `Último contacto: ${textoDelContacto(contactos.ultimo.kind)} el ${corto(contactos.ultimo.en)}` : 'Todavía no hay tomas de contacto apuntadas'}>
          <Phone className="h-[11px] w-[11px] shrink-0" />
          {contactos?.ultimo ? `${textoDelContacto(contactos.ultimo.kind)} ${dias === 0 ? 'hoy' : `hace ${dias} d`}${contactos.total > 1 ? ` · ${contactos.total} contactos` : ''}` : 'Sin contactos apuntados'}
        </span>
        <Pistas r={r} />
      </div>
      {alcance.puedeMover && (
        <div className="mt-[7px] flex flex-wrap items-center gap-1 pl-[15px]">
          {siguiente && (
            <Accion tono="primario" disabled={ocupado} onClick={() => onAccion(c, 'avanzar')} icono={<ArrowRight />} titulo={`Pasa a «${CRM_STAGE_LABELS[siguiente]}»`}>
              {ETIQUETA_CORTA[siguiente]}
            </Accion>
          )}
          <Accion tono={siguiente ? 'secundario' : 'primario'} disabled={ocupado} onClick={() => onAccion(c, 'cerrar')} icono={<Check />} titulo="Cliente cerrado: pasa a «Cerrado»">
            Cerrar
          </Accion>
          <Accion disabled={ocupado} onClick={() => setPerdiendo((v) => !v)} icono={<X />} titulo="Se pierde este lead">
            Perder
          </Accion>
        </div>
      )}
      {perdiendo && (
        <SelectorDeMotivo
          onCancelar={() => setPerdiendo(false)}
          onElegir={(motivo, detalle) => {
            setPerdiendo(false)
            onAccion(c, 'perder', { motivo, detalle })
          }}
        />
      )}
    </Marco>
  )
})

/* ------------------------------------------------------------------ */
/* CERRADO                                                             */
/* ------------------------------------------------------------------ */

export const FilaDeCerrado = memo(function FilaDeCerrado({
  c,
  r,
  activa,
  onElegir,
  alcance,
  dueno,
  ocupado,
  onAccion,
  ciclo,
  motivo,
}: PropsDeFila & { ciclo: number | null; motivo: string | null | undefined }) {
  const ganado = c.stage === 'ganado'
  const fecha = ganado ? (c.closed_at ?? c.updated_at) : c.updated_at
  return (
    <Marco c={c} activa={activa} onElegir={onElegir}>
      <Cabecera c={c} r={r} dueno={dueno} mostrarResponsable={alcance.veTodos} derecha={`${ganado ? 'Cerrado' : 'Perdido'} el ${corto(fecha)}`} />
      <div className="mt-[6px] flex flex-wrap items-center gap-x-3 gap-y-[4px] pl-[15px]">
        <span className={INSIGNIA.base}>
          <span className="h-[7px] w-[7px] shrink-0 rounded-full" style={{ backgroundColor: ganado ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }} />
          {ganado ? 'Ganado' : 'Perdido'}
        </span>
        {ganado ? (
          <>
            {ciclo !== null && <span className="text-[11px] tabular-nums text-[var(--ls-t3)]">Cerrado en {ciclo} d</span>}
            {alcance.puedeVerImportes && (c.setup_budget != null || c.maintenance_budget != null) && (
              <span className="text-[11px] tabular-nums text-[var(--ls-t2)]">
                {dinero(c.setup_budget) ? `Set up ${dinero(c.setup_budget)}` : ''}
                {c.setup_budget != null && c.maintenance_budget != null ? ' · ' : ''}
                {c.maintenance_budget != null ? `${dinero(c.maintenance_budget)}/mes` : ''}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 truncate text-[11px] text-[var(--ls-t3)]" title={motivo ? (motivoDeDescarte(motivo) ?? undefined) : undefined}>
            {motivoDeDescarte(motivo) ? `Motivo: ${motivoDeDescarte(motivo)}` : 'Sin motivo apuntado'}
          </span>
        )}
        <Pistas r={r} />
        <span className="flex-1" />
        {alcance.puedeMover && (
          <Accion disabled={ocupado} onClick={() => onAccion(c, 'reabrir')} icono={<RotateCcw />} titulo="Reabrir: vuelve a «En seguimiento»">
            Reabrir
          </Accion>
        )}
      </div>
    </Marco>
  )
})

/** Un hueco con una frase cuando una pestaña no tiene nada que enseñar */
export function SinFilas({ icono, children }: { icono?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
      <span className="text-[var(--ls-t4)] [&>svg]:h-5 [&>svg]:w-5">{icono ?? <UserRound />}</span>
      <p className="max-w-[46ch]">{children}</p>
    </div>
  )
}

