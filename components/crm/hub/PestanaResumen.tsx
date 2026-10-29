'use client'

import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { ArrowRight, CalendarCheck, CalendarClock, Euro, FileText, Flag, MessageSquareQuote, Sparkles, Target, Video } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { toMadrid } from '@/lib/timezone'
import { APPOINTMENT_STATUS_LABELS } from '@/lib/types/appointments'
import { CRM_STAGE_LABELS, crmContact } from '@/lib/types/crm'
import { textoDeDias, type LineaDeFases } from '@/lib/crm/fases'
import { estadoDeLaAccion } from '@/lib/crm/lista'
import type { AvanceDeLaPropuesta, PropuestaPlan } from '@/lib/crm/propuesta'
import { conMayuscula, ESTADO_DE_NOTA, INTERES, Medidor } from './etiquetas'
import { Boton, Dato, Insignia, Lista, Seccion, Vacio } from './piezas'
import type { ContextoFicha } from './tipos'

const dinero = (n: number | null | undefined) => (n == null ? null : `${Number(n).toLocaleString('es-ES')} €`)
const fechaLarga = (iso: string) => conMayuscula(format(toMadrid(new Date(iso)), "EEEE d 'de' MMMM · HH:mm", { locale: es }))

/**
 * EL RESUMEN: lo esencial del cliente de un vistazo, sin tocar nada. Siguiente paso (con su fecha en rojo si ya pasó), lo último que se habló en la reunión según la IA, los
 * dolores que se detectaron, cómo va la propuesta, la cita y el dinero. Cada tarjeta lleva a la pestaña donde se trabaja.
 */
export function PestanaResumen({ ctx, plan, avance, linea }: { ctx: ContextoFicha; plan: PropuestaPlan; avance: AvanceDeLaPropuesta; linea: LineaDeFases }) {
  const { client, notas } = ctx
  const contacto = crmContact(client)
  const appt = client.appointment

  // La reunión que manda es la más reciente que ya se ha analizado; si ninguna lo está, la más reciente a secas
  const analizada = notas.find((n) => n.analisis)
  const reciente = analizada ?? notas[0] ?? null
  const analisis = analizada?.analisis ?? null

  const estadoAccion = client.stage === 'ganado' || client.stage === 'perdido' ? null : estadoDeLaAccion(client.next_action_date, ctx.ahora)
  const colorAccion = estadoAccion === 'vencida' ? COLOR_ESTADO.rojo : estadoAccion === 'hoy' ? COLOR_ESTADO.ambar : undefined

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {/* ---------------- Siguiente paso ---------------- */}
        <Seccion titulo="Siguiente paso" icono={<Flag />} derecha={linea.diasEnLaActual !== null && !ctx.migracionFalta ? <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{CRM_STAGE_LABELS[client.stage]} · {textoDeDias(linea.diasEnLaActual)?.replace('hace ', 'desde hace ') ?? ''}</span> : undefined}>
          {client.next_action || client.next_action_date ? (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 flex-1 text-[13px] font-medium text-[var(--ls-t1)]">{client.next_action || 'Sin descripción'}</p>
              {client.next_action_date && (
                <span className="inline-flex items-center gap-[5px] text-[12px] font-medium tabular-nums" style={{ color: colorAccion ?? 'var(--ls-t2)' }}>
                  <CalendarClock className="h-3.5 w-3.5" />
                  {format(toMadrid(new Date(`${client.next_action_date.slice(0, 10)}T12:00:00Z`)), "d 'de' MMMM", { locale: es })}
                  {estadoAccion === 'vencida' && ' · vencida'}
                  {estadoAccion === 'hoy' && ' · hoy'}
                </span>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-[var(--ls-t3)]">
              {client.stage === 'ganado' ? 'Cliente cerrado: no hay nada pendiente.' : client.stage === 'perdido' ? 'Cliente perdido.' : 'Nadie ha apuntado qué hay que hacer con este cliente.'}
              {ctx.puedeEditar && client.stage !== 'ganado' && client.stage !== 'perdido' && (
                <button type="button" onClick={() => ctx.irA('datos')} className="ml-1 font-medium text-[var(--ls-acc)] hover:underline">
                  Apuntarlo
                </button>
              )}
            </p>
          )}
        </Seccion>

        {/* ---------------- Lo último de la reunión ---------------- */}
        <Seccion
          titulo="Lo último de la reunión"
          icono={<Sparkles />}
          derecha={
            reciente ? (
              <span className="flex items-center gap-2">
                {reciente.fecha_reunion && <span className="hidden text-[11px] text-[var(--ls-t4)] sm:inline">{fechaLarga(reciente.fecha_reunion)}</span>}
                <Boton onClick={() => ctx.irA('reunion')} icono={<ArrowRight />}>
                  Ver reunión
                </Boton>
              </span>
            ) : undefined
          }
        >
          {!reciente ? (
            <Vacio icono={<Video />}>
              {ctx.migracionFalta
                ? 'Las notas de Gemini se guardan en cuanto se lance la migración 258.'
                : 'Todavía no hay notas de Gemini de este cliente. Llegan solas de Gmail cuando acaba la reunión (con las notas de Gemini encendidas en Meet) y se enlazan con su ficha.'}
            </Vacio>
          ) : analisis ? (
            <div className="space-y-2.5">
              <div className="flex flex-wrap items-center gap-[6px]">
                <Insignia tono={INTERES[analisis.interes.nivel].tono}>{INTERES[analisis.interes.nivel].texto}</Insignia>
                {analisis.fase_sugerida && analisis.fase_sugerida !== client.stage && (
                  <Insignia tono="azul" titulo="Es una sugerencia de la IA: la fase la cambia una persona">
                    Sugiere pasar a «{CRM_STAGE_LABELS[analisis.fase_sugerida]}»
                  </Insignia>
                )}
              </div>
              <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t1)]">{analisis.resumen}</p>
              {analisis.interes.motivo && <p className="text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{analisis.interes.motivo}</p>}
              {analisis.proximos_pasos.length > 0 && (
                <div className="border-t border-[var(--ls-linea)] pt-2">
                  <p className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Quedó pendiente</p>
                  <Lista items={analisis.proximos_pasos.slice(0, 4).map((p) => `${p.quien ? `${p.quien}: ` : ''}${p.que}${p.cuando ? ` (${p.cuando})` : ''}`)} />
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center gap-[6px]">
                <Insignia tono={ESTADO_DE_NOTA[reciente.estado].tono}>{ESTADO_DE_NOTA[reciente.estado].texto}</Insignia>
                <span className="text-[11.5px] text-[var(--ls-t3)]">Gemini ya la resumió; falta el desglose de la IA.</span>
              </div>
              {reciente.resumen && <p className="text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{reciente.resumen}</p>}
            </div>
          )}
        </Seccion>

        {/* ---------------- Dolores ---------------- */}
        {analisis && analisis.dolores.length > 0 && (
          <Seccion titulo="Dolores detectados" icono={<Target />}>
            <div className="grid gap-2 md:grid-cols-2">
              {analisis.dolores.slice(0, 4).map((d, i) => (
                <div key={i} className="rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[9px] py-[7px]">
                  <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">{d.titulo}</p>
                  <p className="mt-[2px] text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">{d.detalle}</p>
                </div>
              ))}
            </div>
          </Seccion>
        )}

        {analisis && analisis.frases_clave.length > 0 && (
          <Seccion titulo="Lo que dijo" icono={<MessageSquareQuote />}>
            <ul className="space-y-2">
              {analisis.frases_clave.slice(0, 3).map((f, i) => (
                <li key={i} className="border-l-2 border-[var(--ls-linea2)] pl-2.5">
                  <p className="text-[12.5px] italic leading-[1.5] text-[var(--ls-t2)]">«{f.texto}»</p>
                  <p className="text-[11px] text-[var(--ls-t4)]">
                    {f.quien}
                    {f.minuto ? ` · ${f.minuto}` : ''}
                  </p>
                </li>
              ))}
            </ul>
          </Seccion>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {/* ---------------- La propuesta ---------------- */}
        <Seccion
          titulo="La propuesta"
          icono={<FileText />}
          derecha={
            <Boton onClick={() => ctx.irA('propuesta')} icono={<ArrowRight />}>
              Abrir
            </Boton>
          }
        >
          <Medidor hechas={avance.hechas.length} />
          <p className="mt-1.5 text-[11.5px] text-[var(--ls-t3)]">
            {avance.faltan.length === 0 ? 'Todo listo para generarla.' : avance.hechas.length === 0 ? 'Todavía no se ha empezado.' : `Falta: ${avance.faltan.join(', ')}.`}
          </p>
          {plan.servicios.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-[5px]">
              {plan.servicios.slice(0, 5).map((s, i) => (
                <span key={i} className="inline-flex h-5 items-center rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[7px] text-[11px] text-[var(--ls-t2)]">
                  {s.nombre}
                </span>
              ))}
            </div>
          )}
          {analizada && plan.origen === null && analisis && analisis.propuesta.servicios.length > 0 && <p className="mt-2 text-[11.5px] text-[var(--ls-t3)]">La IA ha preparado una propuesta con lo hablado en la reunión: está en la pestaña Propuesta.</p>}
        </Seccion>

        {/* ---------------- La cita ---------------- */}
        <Seccion titulo="La cita" icono={<CalendarCheck />}>
          {!appt ? (
            <p className="text-[12px] text-[var(--ls-t3)]">Alta manual, sin cita en la agenda.</p>
          ) : (
            <div className="space-y-1.5">
              <Insignia tono={appt.status === 'qualified' ? 'verde' : appt.status === 'not_qualified' ? 'rojo' : appt.status === 'no_show' ? 'ambar' : 'gris'}>{APPOINTMENT_STATUS_LABELS[appt.status]}</Insignia>
              {contacto.meetingAt && <p className="text-[12px] text-[var(--ls-t2)]">{fechaLarga(contacto.meetingAt)}</p>}
              {appt.google_meet_link && (
                <a href={appt.google_meet_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-[12px] text-[var(--ls-t2)] hover:text-[var(--ls-acc)]">
                  <Video className="h-3 w-3" /> Enlace de la reunión
                </a>
              )}
            </div>
          )}
        </Seccion>

        {/* ---------------- El dinero ---------------- */}
        {ctx.puedeVerImportes ? (
          <Seccion titulo="Dinero" icono={<Euro />}>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
              <Dato etiqueta="Set up">{dinero(client.setup_budget) ?? <span className="text-[var(--ls-t4)]">—</span>}</Dato>
              <Dato etiqueta="Mantenimiento">{client.maintenance_budget != null ? `${dinero(client.maintenance_budget)}/mes` : <span className="text-[var(--ls-t4)]">—</span>}</Dato>
              <Dato etiqueta="Facturación del cliente">{contacto.revenue != null ? dinero(Number(contacto.revenue)) : analisis?.negocio.facturacion_actual ? `${analisis.negocio.facturacion_actual} (según la reunión)` : <span className="text-[var(--ls-t4)]">—</span>}</Dato>
            </div>
          </Seccion>
        ) : (
          <Seccion titulo="Facturación del cliente" icono={<Euro />}>
            <Dato etiqueta="Según la cita o la reunión">{contacto.revenue != null ? dinero(Number(contacto.revenue)) : analisis?.negocio.facturacion_actual ? `${analisis.negocio.facturacion_actual} (según la reunión)` : <span className="text-[var(--ls-t4)]">—</span>}</Dato>
          </Seccion>
        )}
      </div>
    </div>
  )
}
