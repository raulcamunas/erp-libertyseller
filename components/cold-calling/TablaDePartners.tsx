'use client'

import { ChevronRight, Copy, ExternalLink, Maximize2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fechaDeRellamada } from '@/lib/cold-calling/cartera'
import { vencimientoDe } from '@/lib/cold-calling/fechas'
import { dominioDeWeb, urlSegura, valoracionDe } from '@/lib/cold-calling/partners'
import { CELDA, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { COLD_STATUSES, COLD_STATUS_LABELS, type ColdLead, type ColdLeadStatus, type ColdNoteKind } from '@/lib/types/cold-leads'
import { DatosDelLead } from './DatosDelLead'
import { HistorialDelLead } from './HistorialDelLead'
import { CeldaEditable } from './TablaDeLeads'
import { MarcaDeFestivo } from './Festivos'
import { ESTADO_VISUAL, GlifoDeEstado, InsigniaDeLista, InsigniaDePrioridad, tinte } from './ui'
import { useEscribirAlLead } from './useEscribirAlLead'

/**
 * LA TABLA DE PARTNERS: las columnas del Excel de captación, con el seguimiento editable en la fila.
 *
 * Es la tabla de siempre (components/cold-calling/TablaDeLeads.tsx) con las columnas de un partner en lugar de las de un vendedor: Prioridad, Puntos, Empresa, Razón social, Tipo,
 * Categoría, Ciudad, Teléfono, Email, Web, Valoración y Reseñas, «Menciona Amazon»… y, a su lado, lo mismo de siempre para trabajarlo —estado, rellamada y seguimiento, editables
 * en la fila, y la flecha que abre su historial sin salir de aquí—. La pantalla la elige cuando TODO lo que se está viendo son partners: una tabla con un partner y diez vendedores
 * sigue siendo la de siempre, con una celda distinta para él.
 *
 * Los enlaces largos (LinkedIn, Google Maps) y las búsquedas con las que se encontró no vienen en la cartera: se piden al abrir la fila con la flecha, y la ficha completa los trae
 * también. Un partner que es PERSONA FÍSICA no se llama en frío: su teléfono se atenúa y no sale como enlace, igual que el de un autónomo.
 *
 * Fila de 28 px, cabecera de 26 y primera columna congelada (el contrato de lib/estilo/denso.ts). Se pintan 100 filas y, al llegar al final, otras 100.
 */

const TRAMO = 100
const COLUMNAS = 17

interface Props {
  leads: readonly ColdLead[]
  currentUserId: string
  currentUser: UserProfile
  /** ¿Puede trabajar leads que no son suyos? Hereda el valor del tablero, donde está explicado */
  puedeVerTodos: boolean
  selectedId: string | null
  onSelect: (id: string) => void
  /** Abre la ficha completa de ese lead */
  onOpenDetail: (id: string) => void
  onPatched: (id: string, patch: Partial<ColdLead>) => void
  nombres: ReadonlyMap<string, string>
  version: number
  hoy: string
  /** Sube cuando cambia el filtro o el orden: la tabla vuelve a las primeras 100 */
  generacion: string
}

/** Lo ya pedido de cada partner para la fila abierta, con tope: no crece sin límite */
const DETALLES = new Map<string, Partial<ColdLead>>()
const TOPE_DE_DETALLES = 300

/** Lo que enseña una fila abierta: los datos del partner con sus enlaces largos, que llegan un instante después, y su historial */
function FilaAbierta({ lead, currentUser, nombres, version, alApuntar }: { lead: ColdLead; currentUser: UserProfile; nombres: ReadonlyMap<string, string>; version: number; alApuntar: (k: ColdNoteKind) => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [extra, setExtra] = useState<Partial<ColdLead>>(() => DETALLES.get(lead.id) ?? {})

  useEffect(() => {
    if (DETALLES.has(lead.id)) return
    let vivo = true
    void supabase
      .from('cold_leads')
      .select('linkedin, google_maps_url, busquedas_origen')
      .eq('id', lead.id)
      .single()
      .then(({ data }) => {
        if (!vivo || !data) return
        DETALLES.set(lead.id, data as Partial<ColdLead>)
        if (DETALLES.size > TOPE_DE_DETALLES) DETALLES.delete(DETALLES.keys().next().value as string)
        setExtra(data as Partial<ColdLead>)
      })
    return () => {
      vivo = false
    }
  }, [lead.id, supabase])

  const completo = useMemo(() => ({ ...lead, ...extra }) as ColdLead, [lead, extra])
  return (
    <div className="rend-desliza grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]" style={{ maxWidth: 1100 }}>
      <DatosDelLead lead={completo} conContacto esAutonomo={lead.tipo_empresa === 'autonomo'} />
      <div className="min-w-0">
        <h3 className="mb-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">Historial</h3>
        <HistorialDelLead leadId={lead.id} currentUser={currentUser} nombres={nombres} version={version} onLogged={alApuntar} />
      </div>
    </div>
  )
}

export function TablaDePartners({ leads, currentUserId, currentUser, puedeVerTodos, selectedId, onSelect, onOpenDetail, onPatched, nombres, version, hoy, generacion }: Props) {
  const escribirAlLead = useEscribirAlLead()
  const supabase = useMemo(() => createClient(), [])
  const [abiertos, setAbiertos] = useState<Set<string>>(() => new Set())
  const [visibles, setVisibles] = useState(TRAMO)
  const centinela = useRef<HTMLTableRowElement>(null)

  useEffect(() => setVisibles(TRAMO), [generacion])

  // Al llegar al final de lo pintado, otro tramo
  useEffect(() => {
    const el = centinela.current
    if (!el || visibles >= leads.length || typeof IntersectionObserver === 'undefined') return
    const observador = new IntersectionObserver(
      (entradas) => {
        if (entradas.some((e) => e.isIntersecting)) setVisibles((v) => v + TRAMO)
      },
      { rootMargin: '300px' }
    )
    observador.observe(el)
    return () => observador.disconnect()
  }, [visibles, leads.length])

  function alternar(id: string) {
    setAbiertos((previos) => {
      const siguiente = new Set(previos)
      if (siguiente.has(id)) siguiente.delete(id)
      else siguiente.add(id)
      return siguiente
    })
  }

  async function patch(id: string, campos: Partial<ColdLead>) {
    const { error } = await supabase.from('cold_leads').update(campos).eq('id', id)
    if (error) {
      console.error('Error guardando el lead:', error)
      toast.error('No se pudo guardar')
      return
    }
    onPatched(id, campos)
  }

  /** Lo mismo que hace la ficha al apuntar algo: sella el último contacto. No suma intento: las llamadas de Rinkel lo suman solas (migración 237) */
  const apuntado = (id: string, _clase: ColdNoteKind) => void patch(id, { last_contacted_at: new Date().toISOString() })

  return (
    <div className={`${TABLA.caja} relative`}>
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija} min-w-[230px]`}>Empresa</th>
            <th className={`${TABLA.cabecera} min-w-[170px]`} title="1 llamar primero · 2 segunda ronda · 3 solo email · 4 revisar (posible competencia)">
              Prioridad
            </th>
            <th className={`${TABLA.cabecera} min-w-[64px] text-right`} title="Puntuación de la captación">
              Puntos
            </th>
            <th className={`${TABLA.cabecera} min-w-[160px]`}>Estado</th>
            <th className={`${TABLA.cabecera} min-w-[140px]`}>Teléfono</th>
            <th className={`${TABLA.cabecera} min-w-[120px]`}>Rellamar</th>
            <th className={`${TABLA.cabecera} min-w-[260px]`}>Seguimiento</th>
            <th className={`${TABLA.cabecera} min-w-[180px]`}>Email</th>
            <th className={`${TABLA.cabecera} min-w-[150px]`}>Web</th>
            <th className={`${TABLA.cabecera} min-w-[110px]`}>Ciudad</th>
            <th className={`${TABLA.cabecera} min-w-[170px]`} title="La categoría que le pone Google Maps">
              Categoría
            </th>
            <th className={`${TABLA.cabecera} min-w-[150px]`} title="Valoración en Google Maps y número de reseñas">
              Valoración
            </th>
            <th className={`${TABLA.cabecera} min-w-[76px] text-center`} title="Su web habla de Amazon">
              Amazon
            </th>
            <th className={`${TABLA.cabecera} min-w-[120px]`} title="Sociedad, persona física (no se llama en frío) o sin verificar">
              Tipo
            </th>
            <th className={`${TABLA.cabecera} min-w-[170px]`}>Razón social</th>
            <th className={`${TABLA.cabecera} min-w-[150px]`}>Lista</th>
            <th className={`${TABLA.cabecera} w-[64px]`} />
          </tr>
        </thead>
        <tbody>
          {leads.slice(0, visibles).map((l) => {
            const puedeEditar = puedeVerTodos || l.assigned_to === currentUserId
            const { tono } = ESTADO_VISUAL[l.status]
            const activa = l.id === selectedId
            const abierto = abiertos.has(l.id)
            const venc = vencimientoDe(fechaDeRellamada(l), hoy)
            const fisica = l.tipo_empresa === 'autonomo'
            const web = urlSegura(l.web)
            const valoracion = valoracionDe(l.rating, l.resenas)

            return (
              <Fragment key={l.id}>
                <tr onClick={() => onSelect(l.id)} className={`${TABLA.fila} ${activa ? TABLA.filaSel : ''} cursor-pointer`}>
                  <td className={`${TABLA.celda} ${TABLA.celdaFija} font-medium text-[var(--ls-t1)]`} style={l.status !== 'pendiente' ? { boxShadow: `inset 2px 0 0 ${COLOR_ESTADO[tono]}` } : undefined}>
                    <span className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          alternar(l.id)
                        }}
                        title={abierto ? 'Cerrar el historial' : 'Ver sus datos y su historial sin salir de aquí'}
                        aria-expanded={abierto}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${abierto ? 'rotate-90 text-[var(--ls-acc)]' : ''}`} aria-hidden />
                      </button>
                      <GlifoDeEstado estado={l.status} tamano={13} />
                      <span className="max-w-[170px] truncate" title={l.store_name}>
                        {l.store_name}
                      </span>
                      <MarcaDeFestivo lead={l} dia={hoy} hoy={hoy} />
                    </span>
                  </td>

                  <td className={TABLA.celda}>
                    <InsigniaDePrioridad prioridad={l.prioridad} />
                  </td>

                  <td className={`${TABLA.celda} ${TABLA.numero}`}>{l.puntos ?? '—'}</td>

                  <td className={`${TABLA.celda} !px-1`} onClick={(e) => e.stopPropagation()}>
                    <select
                      value={l.status}
                      disabled={!puedeEditar}
                      aria-label={`Estado de ${l.store_name}`}
                      onChange={(e) => void patch(l.id, { status: e.target.value as ColdLeadStatus, last_contacted_at: new Date().toISOString() })}
                      className="h-5 w-full cursor-pointer appearance-none rounded-[4px] border px-1.5 text-[11.5px] font-medium text-[var(--ls-t1)] outline-none disabled:cursor-default"
                      style={{ background: tinte(tono, 16), borderColor: `color-mix(in srgb, ${COLOR_ESTADO[tono]} 45%, transparent)` }}
                    >
                      {COLD_STATUSES.map((s) => (
                        <option key={s} value={s} className="bg-[var(--ls-sup)] text-[var(--ls-t1)]">
                          {COLD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td className={TABLA.celda} onClick={(e) => e.stopPropagation()}>
                    {l.phone ? (
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(l.phone!)
                          toast.success('Teléfono copiado')
                        }}
                        title={fisica ? 'Persona física: no se llama en frío' : 'Copiar el teléfono'}
                        className={`inline-flex items-center gap-1 transition-colors hover:text-[var(--ls-t1)] ${fisica ? 'opacity-60' : ''}`}
                      >
                        {l.phone}
                        <Copy className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                      </button>
                    ) : (
                      <span className={CELDA.vacia} title="Sin teléfono: solo por email">
                        —
                      </span>
                    )}
                  </td>

                  <td className={`${TABLA.celda} !px-1`} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      value={l.next_call_date ?? ''}
                      disabled={!puedeEditar}
                      aria-label={`Rellamar a ${l.store_name} el`}
                      onChange={(e) => void patch(l.id, { next_call_date: e.target.value || null })}
                      className={`${CELDA.editable} [color-scheme:dark] [.light_&]:[color-scheme:light] ${l.next_call_date ? '' : 'text-transparent hover:text-[var(--ls-t3)] focus:text-[var(--ls-t1)]'} ${venc?.tipo === 'atrasada' && l.status !== 'no_interesa' ? '!text-[var(--ls-e-ambar)]' : ''}`}
                    />
                  </td>

                  <td className={`${TABLA.celda} !px-1 max-w-[260px]`} onClick={(e) => e.stopPropagation()}>
                    <CeldaEditable valor={l.follow_up ?? ''} deshabilitada={!puedeEditar} placeholder="Añadir seguimiento…" onGuardar={(v) => void patch(l.id, { follow_up: v.trim() || null })} />
                  </td>

                  <td className={TABLA.celda} onClick={(e) => e.stopPropagation()}>
                    {l.email ? (
                      // Lleva a Correo con el mensaje ya abierto y dirigido a él (lib/correo/peticiones.ts); la tabla se queda como está
                      <button type="button" onClick={() => escribirAlLead(l)} className={`${TABLA.corta} max-w-[180px] text-left transition-colors hover:text-[var(--ls-acc)]`} title={`Escribir a ${l.email}`}>
                        {l.email}
                      </button>
                    ) : (
                      <span className={CELDA.vacia}>—</span>
                    )}
                  </td>

                  <td className={TABLA.celda} onClick={(e) => e.stopPropagation()}>
                    {web ? (
                      <a href={web} target="_blank" rel="noopener noreferrer" title={web} className={`${TABLA.corta} inline-flex max-w-[150px] items-center gap-1 transition-colors hover:text-[var(--ls-acc)]`}>
                        <span className="truncate">{dominioDeWeb(web)}</span>
                        <ExternalLink className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                      </a>
                    ) : (
                      <span className={CELDA.vacia}>—</span>
                    )}
                  </td>

                  <td className={TABLA.celda}>{l.ciudad || '—'}</td>

                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} max-w-[170px]`} title={l.category || ''}>
                      {l.category || '—'}
                    </span>
                  </td>

                  <td className={`${TABLA.celda} tabular-nums`}>{valoracion ? `★ ${valoracion}` : <span className={CELDA.vacia}>—</span>}</td>

                  <td className={`${TABLA.celda} text-center`}>
                    {l.menciona_amazon == null ? (
                      <span className={CELDA.vacia}>—</span>
                    ) : l.menciona_amazon ? (
                      <span className="font-semibold text-[var(--ls-e-verde)]">Sí</span>
                    ) : (
                      'No'
                    )}
                  </td>

                  <td className={TABLA.celda}>
                    {l.tipo_empresa === 'sociedad' ? (
                      'Sociedad'
                    ) : fisica ? (
                      <span className="text-[var(--ls-e-ambar)]" title="No se llama en frío: se le escribe por email">
                        Persona física
                      </span>
                    ) : (
                      <span className={CELDA.vacia}>Sin verificar</span>
                    )}
                  </td>

                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} max-w-[170px]`} title={l.company || ''}>
                      {l.company || '—'}
                    </span>
                  </td>

                  <td className={TABLA.celda}>{l.source_list ? <InsigniaDeLista nombre={l.source_list} /> : null}</td>

                  <td className={`${TABLA.celda} !px-1`} onClick={(e) => e.stopPropagation()}>
                    <button type="button" onClick={() => onOpenDetail(l.id)} title="Abrir la ficha completa" aria-label="Abrir la ficha completa" className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                      <Maximize2 className="h-3 w-3" aria-hidden />
                    </button>
                  </td>
                </tr>

                {abierto && (
                  <tr>
                    <td colSpan={COLUMNAS} className="border-b border-[var(--ls-linea2)] bg-[var(--ls-fondo)] p-0">
                      <FilaAbierta lead={l} currentUser={currentUser} nombres={nombres} version={version} alApuntar={(k) => apuntado(l.id, k)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {visibles < leads.length && (
            <tr ref={centinela}>
              <td colSpan={COLUMNAS} className="h-10 text-center text-[11.5px] text-[var(--ls-t4)]">
                <button type="button" onClick={() => setVisibles((v) => v + TRAMO)} className="underline underline-offset-2 hover:text-[var(--ls-t1)]">
                  Ver más ({(leads.length - visibles).toLocaleString('es-ES')} restantes)
                </button>
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
