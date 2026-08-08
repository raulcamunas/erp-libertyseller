'use client'

import { useState } from 'react'
import { Copy, ExternalLink, FileText } from 'lucide-react'
import {
  COLD_STATUSES,
  COLD_STATUS_DOTS,
  COLD_STATUS_HINTS,
  COLD_STATUS_LABELS,
  type ColdLeadStatus,
} from '@/lib/types/cold-leads'
import { MarcoHoy, TituloHoy, type TemaHoy } from './Marco'
import { KPIS_HOY, LEADS_HOY, LISTAS_HOY, TOTAL_LEADS_HOY, colorDeLista, type LeadHoy } from './datos'

/**
 * PANTALLA 2 — `/dashboard/cold-calling`, vista tabla, como está hoy.
 *
 * Réplica del marcado de components/cold-calling/ColdLeadsTable.tsx y del
 * cromo de ColdCallingBoard.tsx. Los números que hay que poder comprobar aquí,
 * todos medidos en el informe:
 *
 *   · fila de 35,5 px, y quien la manda no es el dato: es el `<select>` de
 *     estado (26,5 px) y la celda editable de seguimiento (26) dentro de un
 *     `td py-1`;
 *   · cabecera de 27,5 px, con los nombres de columna a `text-white/40`, que
 *     son 3,80:1 en oscuro y 4,05:1 en claro, a 10 px y en mayúsculas;
 *   · 396,5 px de cromo por encima de la tabla: título, 4 KPI, tres filas de
 *     filtros y el botón de «Ver más»;
 *   · con todo eso, 19 filas a 1080 px de ventana, 15 a 940 y 10 a 780.
 *
 * Se conserva lo que funciona y hay que no perder: el tinte de fila con el color
 * del estado al 8 % —que es lo que hacían en el Excel—, el fondo OPACO bajo la
 * primera columna congelada, la escalera de z-index (esquina 30 · cabecera 20 ·
 * primera columna 10) y `tabular-nums` en la facturación.
 */

function importe(n: number | null): string {
  return n != null ? `${Math.round(n).toLocaleString('es-ES')} €` : '—'
}

export function PantallaColdCallingHoy({ tema }: { tema: TemaHoy }) {
  const [sel, setSel] = useState<string | null>('h02')
  const [filtro, setFiltro] = useState<ColdLeadStatus | null>(null)
  const [estados, setEstados] = useState<Record<string, ColdLeadStatus>>({})

  const estadoDe = (l: LeadHoy): ColdLeadStatus => estados[l.id] ?? l.estado
  const filas = filtro ? LEADS_HOY.filter((l) => estadoDe(l) === filtro) : LEADS_HOY

  return (
    <MarcoHoy tema={tema} activo="cold-calling" scroll={false}>
      <TituloHoy
        titulo="Cold Calling"
        sub="Cartera de sellers a prospectar, con estado e historial de llamadas."
      />

      {/* --- Cuatro indicadores: 57,5 px de alto --- */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 12, flex: '0 0 auto' }}>
        {KPIS_HOY.map((k) => (
          <div key={k.etiqueta} className="hoy-tarjeta" style={{ padding: '8px 12px' }}>
            <div className="hoy-rotulo">{k.etiqueta}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <span className="hoy-num" style={{ fontSize: 19, fontWeight: 700 }}>
                {k.valor}
              </span>
              {k.pie && <span style={{ fontSize: 11, color: 'var(--hoy-t40)' }}>{k.pie}</span>}
            </div>
          </div>
        ))}
      </div>

      {/* --- Tres filas de filtros --- */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, flex: '0 0 auto' }}>
        <button
          type="button"
          className="hoy-chip"
          data-on={filtro === null ? '1' : undefined}
          onClick={() => setFiltro(null)}
        >
          Todos <span className="hoy-num">{TOTAL_LEADS_HOY.toLocaleString('es-ES')}</span>
        </button>
        {COLD_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className="hoy-chip"
            data-on={filtro === s ? '1' : undefined}
            onClick={() => setFiltro(filtro === s ? null : s)}
            title={COLD_STATUS_HINTS[s]}
          >
            <span className="hoy-punto" style={{ backgroundColor: COLD_STATUS_DOTS[s], width: 6, height: 6, flexBasis: 6 }} />
            {COLD_STATUS_LABELS[s]}{' '}
            <span className="hoy-num" style={{ color: 'var(--hoy-t40)' }}>
              {LEADS_HOY.filter((l) => estadoDe(l) === s).length}
            </span>
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, flex: '0 0 auto' }}>
        {LISTAS_HOY.map((n) => (
          <button key={n} type="button" className="hoy-chip">
            {n}
          </button>
        ))}
        <span style={{ width: 12 }} />
        <button type="button" className="hoy-chip" data-on="1">
          Tabla
        </button>
        <button type="button" className="hoy-chip">
          Ficha
        </button>
        <span style={{ width: 12 }} />
        <button type="button" className="hoy-chip">
          Más facturación
        </button>
        <button type="button" className="hoy-chip">
          Rellamadas primero
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8, marginBottom: 12, flex: '0 0 auto' }}>
        <span className="hoy-rotulo" style={{ alignSelf: 'center', marginRight: 4 }}>
          Facturación
        </span>
        {['+ de 100k', '50k–100k', '20k–50k', '- de 20k'].map((r) => (
          <button key={r} type="button" className="hoy-chip">
            {r}
          </button>
        ))}
        <span style={{ marginLeft: 'auto' }} />
        <button type="button" className="hoy-btn-nuevo">
          Limpiar filtros
        </button>
      </div>

      {/* --- La tabla --- */}
      <div className="hoy-caja-tabla">
        <table className="hoy-tabla">
          <thead>
            <tr>
              <th data-fija style={{ minWidth: 190 }}>
                Tienda
              </th>
              <th style={{ minWidth: 170 }}>Empresa</th>
              <th style={{ minWidth: 110, textAlign: 'right' }}>Facturación</th>
              <th style={{ minWidth: 170 }}>Estado</th>
              <th style={{ minWidth: 140 }}>Teléfono</th>
              <th style={{ minWidth: 120 }}>Rellamar</th>
              <th style={{ minWidth: 280 }}>Seguimiento</th>
              <th style={{ minWidth: 180 }}>Email</th>
              <th style={{ minWidth: 120 }}>Provincia</th>
              <th style={{ minWidth: 160 }}>Categoría</th>
              <th style={{ minWidth: 110 }}>Lista</th>
              <th style={{ width: 70 }} />
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => {
              const estado = estadoDe(l)
              const color = COLD_STATUS_DOTS[estado]
              const activa = l.id === sel
              // El tinte de la fila entera, con el color del estado al 8 % de
              // alfa: es exactamente lo que hacían en el Excel.
              const fondo = activa
                ? 'rgba(255,102,0,0.14)'
                : estado === 'pendiente'
                  ? 'transparent'
                  : `${color}14`

              return (
                <tr key={l.id} style={{ backgroundColor: fondo }} onClick={() => setSel(l.id)}>
                  <td
                    data-fija
                    style={{
                      // Fondo opaco DEBAJO del tinte: si no, la fila se vería
                      // pasar por detrás de la columna congelada.
                      backgroundColor: 'var(--hoy-sticky)',
                      backgroundImage: `linear-gradient(${fondo}, ${fondo})`,
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="hoy-punto" style={{ backgroundColor: color }} />
                      <span style={{ maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.tienda}</span>
                    </span>
                  </td>

                  <td style={{ color: 'var(--hoy-t65)' }}>
                    <span style={{ display: 'block', maxWidth: 170, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.empresa}
                    </span>
                  </td>

                  <td className="hoy-num" style={{ textAlign: 'right', color: 'var(--hoy-t80)', whiteSpace: 'nowrap' }}>
                    {importe(l.facturacion)}
                  </td>

                  <td data-estrecha onClick={(e) => e.stopPropagation()}>
                    <select
                      className="hoy-select"
                      value={estado}
                      onChange={(e) => setEstados((m) => ({ ...m, [l.id]: e.target.value as ColdLeadStatus }))}
                      style={{ backgroundColor: `${color}26`, borderColor: `${color}66` }}
                    >
                      {COLD_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {COLD_STATUS_LABELS[s]}
                        </option>
                      ))}
                    </select>
                  </td>

                  <td style={{ color: 'var(--hoy-t70)', whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    {l.telefono ? (
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        {l.telefono}
                        <Copy style={{ width: 12, height: 12, opacity: 0.4 }} aria-hidden />
                      </span>
                    ) : (
                      <span style={{ color: 'var(--hoy-t20)' }}>—</span>
                    )}
                  </td>

                  <td data-estrecha onClick={(e) => e.stopPropagation()}>
                    <input
                      type="date"
                      className="hoy-celda hoy-num"
                      style={{ fontSize: 11, color: 'var(--hoy-t75)' }}
                      defaultValue={l.rellamar ?? ''}
                    />
                  </td>

                  <td data-estrecha style={{ maxWidth: 280 }} onClick={(e) => e.stopPropagation()}>
                    <input
                      className="hoy-celda"
                      defaultValue={l.seguimiento}
                      placeholder="Añadir seguimiento..."
                    />
                  </td>

                  <td style={{ color: 'var(--hoy-t55)' }} onClick={(e) => e.stopPropagation()}>
                    {l.email ? (
                      <span style={{ display: 'block', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {l.email}
                      </span>
                    ) : (
                      <span style={{ color: 'var(--hoy-t20)' }}>—</span>
                    )}
                  </td>

                  <td style={{ color: 'var(--hoy-t55)', whiteSpace: 'nowrap' }}>{l.provincia}</td>

                  <td style={{ color: 'var(--hoy-t55)' }}>
                    <span style={{ display: 'block', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {l.categoria}
                    </span>
                  </td>

                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 500,
                        padding: '2px 6px',
                        borderRadius: 4,
                        border: '1px solid',
                        lineHeight: 1,
                        color: colorDeLista(l.lista),
                        borderColor: `${colorDeLista(l.lista)}55`,
                        backgroundColor: `${colorDeLista(l.lista)}1a`,
                      }}
                    >
                      {l.lista}
                    </span>
                  </td>

                  <td data-estrecha style={{ whiteSpace: 'nowrap' }} onClick={(e) => e.stopPropagation()}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, color: 'var(--hoy-t45)' }}>
                      <FileText style={{ width: 14, height: 14 }} aria-hidden />
                      <ExternalLink style={{ width: 14, height: 14 }} aria-hidden />
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 8, flex: '0 0 auto' }}>
        <button type="button" className="hoy-btn-fantasma">
          Ver más ({(TOTAL_LEADS_HOY - filas.length).toLocaleString('es-ES')} restantes)
        </button>
      </div>
    </MarcoHoy>
  )
}
