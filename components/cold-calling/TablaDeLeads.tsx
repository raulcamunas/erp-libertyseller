'use client'

import { ChevronRight, Copy, ExternalLink, Maximize2 } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { fechaDeRellamada } from '@/lib/cold-calling/cartera'
import { vencimientoDe } from '@/lib/cold-calling/fechas'
import { CELDA, COLOR_ESTADO, TABLA } from '@/lib/estilo/denso'
import { createClient } from '@/lib/supabase/client'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { AVISO_VENTAS_ESTIMADAS, COLD_STATUSES, COLD_STATUS_LABELS, esPartner, esTiendaOnline, formatVentasEstimadas, type ColdLead, type ColdLeadStatus, type ColdNoteKind } from '@/lib/types/cold-leads'
import { DatosDelLead } from './DatosDelLead'
import { HistorialDelLead } from './HistorialDelLead'
import { ESTADO_VISUAL, GlifoDeEstado, InsigniaDeLista, tinte } from './ui'
import { useEscribirAlLead } from './useEscribirAlLead'

/**
 * LA TABLA: muchos leads a la vez, como el Excel de siempre, con el estado, la rellamada y el seguimiento editables en la fila.
 *
 * Fila de 28 px y cabecera de 26 (el contrato de lib/estilo/denso.ts): en el portátil de un comercial caben más del doble de leads.
 * La primera columna está congelada y lleva el estado en forma (glifo) y en el filo de color de siempre; el resto se desplaza.
 *
 * Se pintan 100 filas y, al llegar al final, otras 100: una tabla de miles de filas editables —cada una con su desplegable y su
 * campo de fecha— tardaba más en pintarse que en usarse.
 *
 * LA FLECHA DE CADA FILA abre debajo su historial y sus datos sin salir de la tabla. Es la misma pieza que usa la ficha, así que lo que se
 * apunte aquí y lo que se apunte allí es lo mismo y no hay dos historiales que puedan desincronizarse. Se pueden tener varias abiertas
 * a la vez: en «Rellamadas» el comercial baja la lista llamando una detrás de otra.
 */

const TRAMO = 100

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

/** Celda de texto editable al vuelo, como en una hoja de cálculo. También la usa la tabla de partners */
export function CeldaEditable({ valor, onGuardar, deshabilitada, placeholder }: { valor: string; onGuardar: (v: string) => void; deshabilitada: boolean; placeholder?: string }) {
  const [borrador, setBorrador] = useState(valor)
  const [editando, setEditando] = useState(false)

  if (!editando) {
    return (
      <button
        type="button"
        onClick={() => {
          if (deshabilitada) return
          setBorrador(valor)
          setEditando(true)
        }}
        disabled={deshabilitada}
        title={valor || undefined}
        className={`${CELDA.editable} text-left ${valor ? '' : CELDA.vacia}`}
      >
        {valor || placeholder || '—'}
      </button>
    )
  }

  return (
    <input
      value={borrador}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={() => {
        setEditando(false)
        if (borrador !== valor) onGuardar(borrador)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          setBorrador(valor)
          setEditando(false)
        }
      }}
      autoFocus
      className={`${CELDA.editable} !bg-[var(--ls-sup2)] !border-[var(--ls-acc-graf)] !text-[var(--ls-t1)]`}
    />
  )
}

export function TablaDeLeads({ leads, currentUserId, currentUser, puedeVerTodos, selectedId, onSelect, onOpenDetail, onPatched, nombres, version, hoy, generacion }: Props) {
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
    const observador = new IntersectionObserver((entradas) => {
      if (entradas.some((e) => e.isIntersecting)) setVisibles((v) => v + TRAMO)
    }, { rootMargin: '300px' })
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
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija} min-w-[210px]`}>Tienda</th>
            <th className={`${TABLA.cabecera} min-w-[160px]`}>Empresa</th>
            <th className={`${TABLA.cabecera} min-w-[120px] text-right`} title="Facturación real de los vendedores de Amazon; estimación de tráfico en dólares en las tiendas online">
              Facturación / est.
            </th>
            <th className={`${TABLA.cabecera} min-w-[160px]`}>Estado</th>
            <th className={`${TABLA.cabecera} min-w-[140px]`}>Teléfono</th>
            <th className={`${TABLA.cabecera} min-w-[120px]`}>Rellamar</th>
            <th className={`${TABLA.cabecera} min-w-[260px]`}>Seguimiento</th>
            <th className={`${TABLA.cabecera} min-w-[170px]`}>Email</th>
            <th className={`${TABLA.cabecera} min-w-[110px]`}>Provincia / Ciudad</th>
            <th className={`${TABLA.cabecera} min-w-[150px]`}>Categoría</th>
            <th className={`${TABLA.cabecera} min-w-[100px]`}>Lista</th>
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
                        title={abierto ? 'Cerrar el historial' : 'Ver el historial sin salir de aquí'}
                        aria-expanded={abierto}
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
                      >
                        <ChevronRight className={`h-3.5 w-3.5 transition-transform duration-200 ${abierto ? 'rotate-90 text-[var(--ls-acc)]' : ''}`} aria-hidden />
                      </button>
                      <GlifoDeEstado estado={l.status} tamano={13} />
                      <span className="max-w-[150px] truncate" title={l.store_name}>
                        {l.store_name}
                      </span>
                    </span>
                  </td>

                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} max-w-[160px]`} title={l.company || ''}>
                      {l.company || '—'}
                    </span>
                  </td>

                  {/* EUROS OBSERVADOS Y DÓLARES ESTIMADOS EN LA MISMA COLUMNA, PERO NUNCA CON LA MISMA MONEDA. Un vendedor de Amazon trae su
                      facturación; una tienda online trae la estimación de tráfico de Store Leads, que va en dólares y con «est.» al lado. Poner « €»
                      a la estimación es exactamente el error que hace que alguien la lea en voz alta en una llamada */}
                  <td className={`${TABLA.celda} ${TABLA.numero}`}>
                    {esTiendaOnline(l) ? (
                      l.ventas_estimadas_usd != null ? (
                        <span className="text-[var(--ls-e-ambar)]" title={AVISO_VENTAS_ESTIMADAS}>
                          {formatVentasEstimadas(l.ventas_estimadas_usd)} est.
                        </span>
                      ) : (
                        '—'
                      )
                    ) : l.revenue_monthly != null ? (
                      `${Math.round(Number(l.revenue_monthly)).toLocaleString('es-ES')} €`
                    ) : (
                      '—'
                    )}
                  </td>

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
                        title="Copiar el teléfono"
                        className="inline-flex items-center gap-1 transition-colors hover:text-[var(--ls-t1)]"
                      >
                        {l.phone}
                        <Copy className="h-3 w-3 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                      </button>
                    ) : (
                      <span className={CELDA.vacia}>—</span>
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
                      <button type="button" onClick={() => escribirAlLead(l)} className={`${TABLA.corta} max-w-[170px] text-left transition-colors hover:text-[var(--ls-acc)]`} title={`Escribir a ${l.email}`}>
                        {l.email}
                      </button>
                    ) : (
                      <span className={CELDA.vacia}>—</span>
                    )}
                  </td>

                  {/* Provincia para los vendedores, Ciudad para las tiendas online: la columna «Provincia» del Excel nuevo dice «Europe» en
                      las 1.000 filas medidas (es el campo `region` de Store Leads) y por eso no se importa: la geografía real está en `ciudad` */}
                  <td className={TABLA.celda}>{(esTiendaOnline(l) || esPartner(l) ? l.ciudad : l.province) || '—'}</td>

                  <td className={TABLA.celda}>
                    <span className={`${TABLA.corta} max-w-[150px]`} title={l.category || ''}>
                      {l.category || '—'}
                    </span>
                  </td>

                  <td className={TABLA.celda}>{l.source_list ? <InsigniaDeLista nombre={l.source_list} /> : null}</td>

                  <td className={`${TABLA.celda} !px-1`} onClick={(e) => e.stopPropagation()}>
                    <span className="flex items-center gap-0.5">
                      <button type="button" onClick={() => onOpenDetail(l.id)} title="Abrir la ficha completa" aria-label="Abrir la ficha completa" className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                        <Maximize2 className="h-3 w-3" aria-hidden />
                      </button>
                      {l.seller_url && (
                        <a href={l.seller_url} target="_blank" rel="noopener noreferrer" title="Ver en Amazon" aria-label="Ver en Amazon" className="inline-flex h-5 w-5 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                    </span>
                  </td>
                </tr>

                {abierto && (
                  <tr>
                    <td colSpan={12} className="border-b border-[var(--ls-linea2)] bg-[var(--ls-fondo)] p-0">
                      <div className="rend-desliza grid gap-x-6 gap-y-3 px-4 py-3 lg:grid-cols-[minmax(260px,360px)_minmax(0,1fr)]" style={{ maxWidth: 1100 }}>
                        <DatosDelLead lead={l} conContacto esAutonomo={(esTiendaOnline(l) || esPartner(l)) && l.tipo_empresa === 'autonomo'} />
                        <div className="min-w-0">
                          <h3 className="mb-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">Historial</h3>
                          <HistorialDelLead leadId={l.id} currentUser={currentUser} nombres={nombres} version={version} onLogged={(k) => apuntado(l.id, k)} />
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
          {visibles < leads.length && (
            <tr ref={centinela}>
              <td colSpan={12} className="h-10 text-center text-[11.5px] text-[var(--ls-t4)]">
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
