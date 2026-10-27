'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { Briefcase, Building2, CalendarCheck, CalendarClock, Euro, Globe, Link2, Mail, MapPin, Phone, StickyNote, Store, User, BadgeEuro } from 'lucide-react'
import { toMadrid } from '@/lib/timezone'
import { APPOINTMENT_STATUS_LABELS } from '@/lib/types/appointments'
import { crmContact } from '@/lib/types/crm'
import { AREA_FANTASMA, Fila, INPUT_FANTASMA, Seccion, Valor } from './piezas'
import type { ContextoFicha } from './tipos'

/**
 * LOS DATOS DEL CLIENTE: contacto, empresa, la cita (cualificada o no), responsable, próxima acción y notas internas.
 *
 * Los campos se guardan al salir de ellos (blur) si cambiaron, sin botón de guardar. Si la ficha nace de una cita, la cita manda: nombre, email, teléfono y empresa se editan
 * en la agenda para que agenda y CRM no se contradigan; en las altas manuales no hay cita, así que se editan aquí.
 */
export function PestanaDatos({ ctx }: { ctx: ContextoFicha }) {
  const { client, puedeEditar, patch, commitText, commitNumber, team } = ctx
  const appt = client.appointment
  const contacto = crmContact(client)
  const esManual = !client.appointment_id

  const [leadName, setLeadName] = useState(client.lead_name ?? '')
  const [leadEmail, setLeadEmail] = useState(client.lead_email ?? '')
  const [leadPhone, setLeadPhone] = useState(client.lead_phone ?? '')
  const [leadCompany, setLeadCompany] = useState(client.lead_company ?? '')
  const [facturacion, setFacturacion] = useState(client.revenue_amount != null ? String(client.revenue_amount) : '')
  const [enlaceAmazon, setEnlaceAmazon] = useState(client.amazon_link ?? '')
  const [cargo, setCargo] = useState(client.contact_role ?? '')
  const [web, setWeb] = useState(client.website ?? '')
  const [pais, setPais] = useState(client.country ?? '')
  const [marketplaces, setMarketplaces] = useState(client.marketplaces ?? '')
  const [proximaAccion, setProximaAccion] = useState(client.next_action ?? '')
  const [fechaAccion, setFechaAccion] = useState(client.next_action_date ?? '')
  const [cierre, setCierre] = useState(client.closed_at ? format(toMadrid(client.closed_at), 'yyyy-MM-dd') : '')
  const [notas, setNotas] = useState(client.notes ?? '')

  // La fecha de cierre la sella un disparador al pasar a «Cliente cerrado»: llega de vuelta por Realtime y hay que reflejarla aquí
  useEffect(() => {
    setCierre(client.closed_at ? format(toMadrid(client.closed_at), 'yyyy-MM-dd') : '')
  }, [client.closed_at])

  const dueno = team.find((p) => p.id === client.owner_id)
  const estadoCita = appt?.status

  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {/* ---------------- La cita ---------------- */}
      <Seccion titulo="La cita" icono={<CalendarCheck />}>
        {!appt ? (
          <p className="text-[12px] leading-[1.5] text-[var(--ls-t3)]">Este lead se dio de alta a mano, sin cita en la agenda. No hay nada que cualificar y no genera comisión por cita.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-[5px]">
              {/* Los tres desenlaces solo se pintan como botón para dirección: cualificar es lo que genera la comisión del comercial */}
              {puedeEditar ? (
                ([
                  { valor: 'qualified' as const, texto: 'Cita cualificada' },
                  { valor: 'not_qualified' as const, texto: 'No cualificada' },
                  { valor: 'no_show' as const, texto: 'No asistió' },
                ]).map((o) => {
                  const activa = estadoCita === o.valor
                  return (
                    <button
                      key={o.valor}
                      type="button"
                      disabled={ctx.cambiandoCita}
                      onClick={() => !activa && void ctx.cambiarEstadoCita(o.valor)}
                      className={`inline-flex h-6 items-center rounded-[6px] border px-2 text-[11.5px] font-medium disabled:opacity-50 ${
                        activa ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
                      }`}
                    >
                      {o.texto}
                    </button>
                  )
                })
              ) : (
                <span className="text-[12px] text-[var(--ls-t2)]">{estadoCita ? APPOINTMENT_STATUS_LABELS[estadoCita] : '—'} · cambiarlo es de dirección</span>
              )}
              {puedeEditar && estadoCita && estadoCita !== 'qualified' && estadoCita !== 'not_qualified' && estadoCita !== 'no_show' && <span className="text-[11px] text-[var(--ls-t4)]">Todavía sin decidir · {APPOINTMENT_STATUS_LABELS[estadoCita]}</span>}
            </div>
            <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t3)]">
              Solo <strong className="font-semibold text-[var(--ls-t2)]">Cita cualificada</strong> genera la comisión del comercial que la agendó. Las otras dos no, y las tres se ven al momento en el calendario.
            </p>
          </>
        )}
      </Seccion>

      {/* ---------------- Seguimiento ---------------- */}
      <Seccion titulo="Seguimiento" icono={<CalendarClock />}>
        <Fila etiqueta="Responsable" icono={<User />}>
          <select disabled={!puedeEditar} value={client.owner_id ?? 'none'} onChange={(e) => void patch({ owner_id: e.target.value === 'none' ? null : e.target.value })} className={`${INPUT_FANTASMA} cursor-pointer`}>
            <option value="none">Sin asignar</option>
            {team.map((p) => (
              <option key={p.id} value={p.id}>
                {p.full_name || p.email}
              </option>
            ))}
          </select>
        </Fila>
        <Fila etiqueta="Próxima acción" icono={<CalendarClock />}>
          <input readOnly={!puedeEditar} value={proximaAccion} onChange={(e) => setProximaAccion(e.target.value)} onBlur={() => commitText('next_action', proximaAccion)} className={INPUT_FANTASMA} placeholder="Llamar para cerrar la propuesta…" />
        </Fila>
        <Fila etiqueta="Fecha" icono={<CalendarClock />}>
          <input
            readOnly={!puedeEditar}
            type="date"
            value={fechaAccion}
            onChange={(e) => {
              setFechaAccion(e.target.value)
              void patch({ next_action_date: e.target.value || null })
            }}
            className={`${INPUT_FANTASMA} [color-scheme:light_dark]`}
          />
        </Fila>
        {/* Fecha de cierre = cuándo pagó de verdad. Se sella sola al marcar «Cliente cerrado», pero se puede corregir: una cita del 30 de julio que paga el 3 de agosto cuenta en la tesorería de agosto */}
        <Fila etiqueta="Fecha de cierre" icono={<BadgeEuro />}>
          <input
            readOnly={!puedeEditar}
            type="date"
            value={cierre}
            onChange={(e) => {
              setCierre(e.target.value)
              void patch({ closed_at: e.target.value ? new Date(`${e.target.value}T12:00:00Z`).toISOString() : null })
            }}
            disabled={client.stage !== 'ganado'}
            className={`${INPUT_FANTASMA} [color-scheme:light_dark]`}
            title={client.stage !== 'ganado' ? 'Solo se rellena cuando el cliente está cerrado' : 'Día en que pagó: es lo que cuenta para la tesorería del mes'}
          />
        </Fila>
        {dueno && <p className="mt-1 text-[11px] text-[var(--ls-t4)]">Lo lleva {dueno.full_name || dueno.email}.</p>}
      </Seccion>

      {/* ---------------- Datos del cliente ---------------- */}
      <Seccion titulo="Datos del cliente" icono={<Building2 />} className="xl:col-span-2">
        <div className="grid gap-x-6 gap-y-px md:grid-cols-2">
          <Fila etiqueta="Contacto" icono={<User />}>
            {esManual ? <input readOnly={!puedeEditar} value={leadName} onChange={(e) => setLeadName(e.target.value)} onBlur={() => leadName.trim() && commitText('lead_name', leadName)} className={INPUT_FANTASMA} placeholder="Nombre y apellidos" /> : <Valor>{contacto.name}</Valor>}
          </Fila>
          <Fila etiqueta="Cargo" icono={<Briefcase />}>
            <input readOnly={!puedeEditar} value={cargo} onChange={(e) => setCargo(e.target.value)} onBlur={() => commitText('contact_role', cargo)} className={INPUT_FANTASMA} placeholder="CEO, responsable ecommerce…" />
          </Fila>
          <Fila etiqueta="Email" icono={<Mail />}>
            {esManual ? (
              <input readOnly={!puedeEditar} value={leadEmail} onChange={(e) => setLeadEmail(e.target.value)} onBlur={() => commitText('lead_email', leadEmail)} className={INPUT_FANTASMA} placeholder="hola@empresa.com" />
            ) : contacto.email ? (
              <a href={`mailto:${contacto.email}`} className="block break-all px-2 py-[3px] text-[12.5px] text-[var(--ls-t1)] hover:text-[var(--ls-acc)]">
                {contacto.email}
              </a>
            ) : (
              <Valor />
            )}
          </Fila>
          <Fila etiqueta="Teléfono" icono={<Phone />}>
            {esManual ? <input readOnly={!puedeEditar} value={leadPhone} onChange={(e) => setLeadPhone(e.target.value)} onBlur={() => commitText('lead_phone', leadPhone)} className={INPUT_FANTASMA} placeholder="+34…" /> : <Valor>{contacto.phone}</Valor>}
          </Fila>
          <Fila etiqueta="Empresa" icono={<Building2 />}>
            {esManual ? <input readOnly={!puedeEditar} value={leadCompany} onChange={(e) => setLeadCompany(e.target.value)} onBlur={() => commitText('lead_company', leadCompany)} className={INPUT_FANTASMA} placeholder="Nombre de la empresa" /> : <Valor>{contacto.company}</Valor>}
          </Fila>
          <Fila etiqueta="Web" icono={<Globe />}>
            <input readOnly={!puedeEditar} value={web} onChange={(e) => setWeb(e.target.value)} onBlur={() => commitText('website', web)} className={INPUT_FANTASMA} placeholder="https://…" />
          </Fila>
          <Fila etiqueta="País" icono={<MapPin />}>
            <input readOnly={!puedeEditar} value={pais} onChange={(e) => setPais(e.target.value)} onBlur={() => commitText('country', pais)} className={INPUT_FANTASMA} placeholder="España" />
          </Fila>
          <Fila etiqueta="Marketplaces" icono={<Store />}>
            <input readOnly={!puedeEditar} value={marketplaces} onChange={(e) => setMarketplaces(e.target.value)} onBlur={() => commitText('marketplaces', marketplaces)} className={INPUT_FANTASMA} placeholder="ES, IT, DE…" />
          </Fila>
          <Fila etiqueta="Amazon" icono={<Link2 />}>
            {esManual ? (
              <input readOnly={!puedeEditar} value={enlaceAmazon} onChange={(e) => setEnlaceAmazon(e.target.value)} onBlur={() => commitText('amazon_link', enlaceAmazon)} className={INPUT_FANTASMA} placeholder="https://amazon.es/…" />
            ) : contacto.amazonLink ? (
              <a href={contacto.amazonLink} target="_blank" rel="noopener noreferrer" className="block break-all px-2 py-[3px] text-[12.5px] text-[var(--ls-t1)] hover:text-[var(--ls-acc)]">
                {contacto.amazonLink}
              </a>
            ) : (
              <Valor />
            )}
          </Fila>
          <Fila etiqueta="Facturación" icono={<Euro />}>
            {esManual ? (
              <input readOnly={!puedeEditar} value={facturacion} onChange={(e) => setFacturacion(e.target.value)} onBlur={() => commitNumber('revenue_amount', facturacion)} inputMode="decimal" className={INPUT_FANTASMA} placeholder="0 €" />
            ) : (
              <Valor>{contacto.revenue != null ? `${Number(contacto.revenue).toLocaleString('es-ES')} €` : null}</Valor>
            )}
          </Fila>
        </div>
        {!esManual && <p className="mt-1.5 text-[11px] text-[var(--ls-t4)]">Nombre, correo, teléfono, empresa, facturación y enlace de Amazon salen de la cita de la agenda: se corrigen allí.</p>}
      </Seccion>

      {/* ---------------- Notas internas ---------------- */}
      <Seccion titulo="Notas internas" icono={<StickyNote />} className="xl:col-span-2">
        <textarea readOnly={!puedeEditar} value={notas} onChange={(e) => setNotas(e.target.value)} onBlur={() => commitText('notes', notas)} rows={4} placeholder="Todo lo que haya que recordar de este cliente…" className={AREA_FANTASMA} />
      </Seccion>
    </div>
  )
}
