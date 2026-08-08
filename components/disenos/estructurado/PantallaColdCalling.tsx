'use client'

import React, { useMemo, useState } from 'react'
import { Copy, ExternalLink, Maximize2, PhoneCall, SlidersHorizontal, X } from 'lucide-react'
import { COLD_STATUSES, COLD_STATUS_HINTS, COLD_STATUS_LABELS, type ColdLeadStatus } from '@/lib/types/cold-leads'
import { CIFRAS_COLD, LEADS, type Lead } from './datos'
import { Chip, Cifra, EstadoLead, ICONO_ESTADO, SinDato, formatEuros, formatFecha } from './piezas'
import { ESTADO_COLOR, type Densidad, type Tema } from './tokens'
import { filasHoy, filasPropuesta } from './metricas'

/**
 * PANTALLA 2 — Cold Calling, vista tabla. La tabla larga.
 *
 * Lo que hay hoy: 396,5 px de cromo por encima de la tabla y filas de 35,5 px. En un
 * monitor de 1080 a pantalla completa se ven 19 leads de casi 4.000; en un portátil,
 * 10. Los siete estados se distinguen por un punto de 8 px y por el tinte de la fila
 * entera al 8 % de alfa; con deuteranopía, el amarillo de «No contesta», el naranja de
 * «En seguimiento» y el verde de «Cita cualificada» a ese alfa son el mismo beige. Y
 * el naranja de marca aparece a la vez en la fila seleccionada, en el chip de filtro
 * encendido y en el estado «En seguimiento», que son tres cosas distintas.
 *
 * Lo que cambia, y por qué:
 *
 *  · LAS CUATRO TARJETAS DE KPI (57,5 px de alto y 69,5 con su hueco) pasan a una tira
 *    de una línea de 30 px. No se pierde ni un dato; se pierde el aire.
 *  · LAS TRES FILAS DE FILTROS (117 px) pasan a una: los siete chips de estado, que son
 *    los que se tocan cada minuto, se quedan a la vista; la lista de origen, el rango de
 *    facturación y el comercial —que se tocan una vez al día— se van a «Más filtros»,
 *    con el número de filtros puestos siempre visible al lado.
 *  · EL TÍTULO DE PANTALLA DE 36 px DESAPARECE. Ya está en las migas de la barra
 *    superior, y allí además dice de qué espacio cuelga.
 *  · EL TINTE DE FILA se sustituye por un FILO de 3 px en la primera celda, con el
 *    mismo color del Excel. Se sigue barriendo la columna con la vista sin leer nada,
 *    pero el color deja de tener que sobrevivir a un 8 % de alfa. Y el estado lleva
 *    además su icono propio y su palabra, así que se lee en blanco y negro.
 *    El tinte se puede volver a encender —botón «Teñir filas»— y entonces SUMA al filo,
 *    no lo sustituye. Está apagado por defecto, no borrado: quitarle al equipo el
 *    código de colores que traían del Excel no es una decisión que tome un diseñador.
 *  · EL NARANJA SALE DE LA TABLA. La fila seleccionada se marca con un doble filete
 *    neutro; el chip de filtro encendido se marca invirtiendo el neutro. Así el único
 *    naranja de la pantalla es el botón de «Llamar al siguiente» y los contadores del
 *    menú, y «En seguimiento» vuelve a ser el único naranja del cuerpo de la tabla.
 */

type Orden = 'revenue_desc' | 'revenue_asc' | 'due_first' | 'name'

const ORDEN_ETIQUETAS: Record<Orden, string> = {
  revenue_desc: 'Más facturación',
  revenue_asc: 'Menos facturación',
  due_first: 'Rellamadas primero',
  name: 'Nombre A-Z',
}

export function PantallaColdCalling({
  tema,
  densidad,
  tinte,
  onTinte,
  alto,
}: {
  tema: Tema
  densidad: Densidad
  tinte: boolean
  onTinte: (v: boolean) => void
  alto: number
}) {
  const [filtroEstado, setFiltroEstado] = useState<ColdLeadStatus | null>(null)
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<Orden>('revenue_desc')
  const [sel, setSel] = useState<string | null>('l13')
  const [masFiltros, setMasFiltros] = useState(false)
  const [lista, setLista] = useState<string | null>(null)

  const recuento = useMemo(() => {
    const r: Record<string, number> = {}
    for (const s of COLD_STATUSES) r[s] = LEADS.filter((l) => l.estado === s).length
    return r
  }, [])

  const filas = useMemo(() => {
    let f = LEADS.filter((l) => !filtroEstado || l.estado === filtroEstado)
    if (lista) f = f.filter((l) => l.lista === lista)
    if (busca.trim()) {
      const q = busca.toLowerCase()
      f = f.filter((l) => l.tienda.toLowerCase().includes(q) || l.empresa.toLowerCase().includes(q))
    }
    const copia = [...f]
    copia.sort((a, b) => {
      if (orden === 'name') return a.tienda.localeCompare(b.tienda, 'es')
      if (orden === 'due_first') return (a.rellamar ?? '9999').localeCompare(b.rellamar ?? '9999')
      const av = a.facturacion ?? 0
      const bv = b.facturacion ?? 0
      return orden === 'revenue_desc' ? bv - av : av - bv
    })
    return copia
  }, [filtroEstado, busca, orden, lista])

  const filtrosPuestos = (lista ? 1 : 0) + (busca.trim() ? 1 : 0)
  const caben = filasPropuesta(alto, densidad)
  const cabenHoy = filasHoy(alto, 'coldCalling')

  return (
    <>
      {/* ---------- Tira de cifras: una línea de 30 px ----------
          `flex: none` no es cosmético: la caja de la tabla es `flex: 1` con base 0,
          así que al encoger la ventana NO es ella la que cede — cederían estas dos
          barras, y el presupuesto de píxeles de metricas.ts dejaría de ser cierto a
          780 px. Quien encoge tiene que ser la tabla, siempre. */}
      <div className="ctx-herramientas" style={{ flex: 'none' }}>
        <div className="ctx-cifras">
          <Cifra etiqueta="En cartera" valor={CIFRAS_COLD.cartera.toLocaleString('es-ES')} />
          <Cifra
            etiqueta="Trabajados"
            valor={CIFRAS_COLD.trabajados.toLocaleString('es-ES')}
            sub={`de ${CIFRAS_COLD.cartera.toLocaleString('es-ES')}`}
          />
          <Cifra etiqueta="Citas cualificadas" valor={String(CIFRAS_COLD.citas)} sub={CIFRAS_COLD.conversion} />
          <Cifra etiqueta="Rellamadas para hoy" valor={String(CIFRAS_COLD.rellamadasHoy)} />
        </div>

        <span className="ctx-crece" />

        <button type="button" className="ctx-btn ctx-btn--fino ctx-t" onClick={() => onTinte(!tinte)} title="Recupera el color de fila del Excel, sumado al filo y al icono">
          {tinte ? 'Quitar tinte de fila' : 'Teñir filas como el Excel'}
        </button>

        {/* El ÚNICO naranja del cuerpo de esta pantalla */}
        <button type="button" className="ctx-btn ctx-btn--primario ctx-t">
          <PhoneCall size={13} strokeWidth={2.4} aria-hidden />
          Llamar al siguiente
        </button>
      </div>

      {/* ---------- Filtros: una fila de 28 px ---------- */}
      <div className="ctx-herramientas" style={{ overflowX: 'auto', position: 'relative', flex: 'none' }}>
        <input
          className="ctx-input"
          style={{ width: 170, flex: 'none' }}
          placeholder="Tienda o empresa…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />

        <Chip activo={filtroEstado === null} onClick={() => setFiltroEstado(null)} num={LEADS.length}>
          Todos
        </Chip>
        {COLD_STATUSES.map((s) => (
          <Chip
            key={s}
            activo={filtroEstado === s}
            onClick={() => setFiltroEstado(filtroEstado === s ? null : s)}
            num={recuento[s]}
            color={ESTADO_COLOR[tema][s]}
            icono={ICONO_ESTADO[s]}
          >
            {COLD_STATUS_LABELS[s]}
          </Chip>
        ))}

        <span className="ctx-sep" aria-hidden />

        <div style={{ position: 'relative', flex: 'none' }}>
          <button
            type="button"
            className="ctx-chip ctx-t"
            data-ctx-activo={filtrosPuestos > 0 ? 'true' : 'false'}
            onClick={() => setMasFiltros((v) => !v)}
          >
            <SlidersHorizontal size={12} strokeWidth={2.4} aria-hidden />
            Más filtros
            {filtrosPuestos > 0 && <span className="ctx-chip-num">{filtrosPuestos}</span>}
          </button>
          {masFiltros && (
            <div className="ctx-pop" style={{ width: 260, top: 30 }}>
              <div className="ctx-pop-grupo">Lista de origen</div>
              {['1a lista', 'Alejandro V2'].map((l) => (
                <button
                  key={l}
                  type="button"
                  className="ctx-pop-item ctx-t"
                  data-ctx-activo={lista === l ? 'true' : 'false'}
                  onClick={() => setLista(lista === l ? null : l)}
                >
                  {l}
                </button>
              ))}
              <div className="ctx-pop-grupo">Facturación</div>
              {['+ de 100k', '50k – 100k', '20k – 50k', '- de 20k'].map((r) => (
                <button key={r} type="button" className="ctx-pop-item ctx-t">
                  {r}
                </button>
              ))}
              <div className="ctx-sm" style={{ padding: '8px 8px 4px', borderTop: '1px solid var(--ctx-line)', marginTop: 4 }}>
                Los filtros se recuerdan de un día para otro, por usuario. Por eso «Limpiar» está
                siempre a la vista.
              </div>
            </div>
          )}
        </div>

        <span className="ctx-sep" aria-hidden />

        <select
          className="ctx-input"
          style={{ width: 168, flex: 'none' }}
          value={orden}
          onChange={(e) => setOrden(e.target.value as Orden)}
          aria-label="Ordenar por"
        >
          {(Object.keys(ORDEN_ETIQUETAS) as Orden[]).map((o) => (
            <option key={o} value={o}>
              {ORDEN_ETIQUETAS[o]}
            </option>
          ))}
        </select>

        {(filtroEstado || filtrosPuestos > 0) && (
          <button
            type="button"
            className="ctx-btn ctx-btn--fino ctx-t"
            style={{ flex: 'none' }}
            onClick={() => {
              setFiltroEstado(null)
              setBusca('')
              setLista(null)
            }}
          >
            <X size={12} aria-hidden />
            Limpiar filtros
          </button>
        )}
      </div>

      {/* ---------- La tabla ---------- */}
      <div className="ctx-tabla-caja">
        <table className="ctx-tabla">
          <thead>
            <tr>
              <th className="ctx-fija" style={{ minWidth: 200 }}>
                Tienda
              </th>
              <th style={{ minWidth: 170 }}>Empresa</th>
              <th data-ctx-num="true" style={{ minWidth: 104 }}>
                Facturación
              </th>
              <th style={{ minWidth: 168 }}>Estado</th>
              <th style={{ minWidth: 132 }}>Teléfono</th>
              <th style={{ minWidth: 96 }}>Rellamar</th>
              <th style={{ minWidth: 280 }}>Seguimiento</th>
              <th style={{ minWidth: 180 }}>Email</th>
              <th style={{ minWidth: 110 }}>Provincia</th>
              <th style={{ minWidth: 130 }}>Categoría</th>
              <th style={{ minWidth: 104 }}>Lista</th>
              <th style={{ width: 62 }} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {filas.map((l) => (
              <FilaLead
                key={l.id}
                lead={l}
                tema={tema}
                tinte={tinte}
                seleccionada={sel === l.id}
                onSel={() => setSel(l.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* ---------- Pie ---------- */}
      <div className="ctx-herramientas" style={{ height: 26, flex: 'none' }}>
        <span className="ctx-sm">
          Mostrando <span className="ctx-num ctx-fg2">{filas.length}</span> de{' '}
          <span className="ctx-num ctx-fg2">{CIFRAS_COLD.cartera.toLocaleString('es-ES')}</span> leads en cartera
        </span>
        <button type="button" className="ctx-btn ctx-btn--fino ctx-t">
          Ver más ({(CIFRAS_COLD.cartera - filas.length).toLocaleString('es-ES')} restantes)
        </button>
        <span className="ctx-crece" />
        <span className="ctx-sm" title="Calculado a partir del presupuesto de píxeles de metricas.ts, no a ojo">
          A {alto} px de alto caben <strong className="ctx-fg2">{caben}</strong> filas · con el diseño de hoy,{' '}
          <strong className="ctx-fg2">{cabenHoy}</strong>
        </span>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function FilaLead({
  lead,
  tema,
  tinte,
  seleccionada,
  onSel,
}: {
  lead: Lead
  tema: Tema
  tinte: boolean
  seleccionada: boolean
  onSel: () => void
}) {
  const color = ESTADO_COLOR[tema][lead.estado]
  const hoy = '2026-08-08'
  const vence = lead.rellamar !== null && lead.rellamar <= hoy

  return (
    <tr
      onClick={onSel}
      data-ctx-sel={seleccionada ? 'true' : 'false'}
      data-ctx-estado={lead.estado}
      style={tinte ? ({ ['--ctx-tinte-fila' as string]: hexAlfa(color, tema === 'claro' ? 0.1 : 0.16) } as React.CSSProperties) : undefined}
    >
      {/* La primera celda lleva el FILO con el color del estado: es lo que sustituye
          al tinte de la fila entera y se barre con la vista igual de rápido.
          Y lleva el BOTÓN que selecciona la fila. El onClick del <tr> se queda —con
          el ratón se pincha en cualquier sitio—, pero un manejador en el <tr> no
          se dispara con el teclado: al tabular hasta un <input> de dentro de la
          fila, la fila no llegaba a seleccionarse nunca. O sea que el resaltado de
          «la fila en la que estás», que las tres propuestas venden como mejora de
          jerarquía, era inalcanzable sin ratón.
          Va en botón y no en tabIndex sobre el <tr> a propósito: mantiene la
          semántica de tabla y no mete 4.000 paradas de tabulador. */}
      <td className="ctx-fija ctx-filo" style={{ ['--ctx-filo-color' as string]: color } as React.CSSProperties}>
        <button
          type="button"
          className="ctx-trunc ctx-sel-fila"
          style={{ fontWeight: 500 }}
          aria-pressed={seleccionada}
          title={`${lead.tienda} — seleccionar esta fila`}
          onClick={(ev) => {
            ev.stopPropagation()
            onSel()
          }}
        >
          {lead.tienda}
        </button>
      </td>

      <td className="ctx-fg2">
        <span className="ctx-trunc" style={{ display: 'block', maxWidth: 170 }}>
          {lead.empresa}
        </span>
      </td>

      <td data-ctx-num="true">{formatEuros(lead.facturacion)}</td>

      <td>
        <EstadoLead estado={lead.estado} etiqueta={COLD_STATUS_LABELS[lead.estado]} />
      </td>

      <td className="ctx-num">
        {lead.telefono ? (
          <span className="ctx-fila-flex" style={{ gap: 5 }}>
            {lead.telefono}
            <Copy size={11} aria-hidden style={{ color: 'var(--ctx-mute)' }} />
          </span>
        ) : (
          <SinDato />
        )}
      </td>

      <td>
        {lead.rellamar ? (
          <span
            className="ctx-num"
            style={vence ? { color: 'var(--ctx-aviso)', fontWeight: 600 } : undefined}
            title={vence ? 'Toca hoy o está pasada' : undefined}
          >
            {vence && '• '}
            {formatFecha(lead.rellamar)}
          </span>
        ) : (
          <SinDato />
        )}
      </td>

      {/* Celda editable: sigue sin parecer un campo hasta que se pasa por encima.
          El foco se pinta con box-shadow por dentro, así que la fila NO cambia de
          alto al entrar en edición — hoy 6 de los 35,5 px de fila los pone el cromo
          de las celdas editables, no el dato. */}
      <td style={{ padding: '0 4px' }} onClick={(e) => e.stopPropagation()}>
        <input
          className={`ctx-celda ctx-t${lead.seguimiento ? '' : ' ctx-celda--vacia'}`}
          defaultValue={lead.seguimiento}
          placeholder="—"
          title={lead.seguimiento || undefined}
        />
      </td>

      <td className="ctx-fg2">{lead.email ?? <SinDato />}</td>
      <td className="ctx-fg2">{lead.provincia}</td>
      <td className="ctx-fg2">{lead.categoria}</td>

      <td>
        <span
          style={{
            display: 'inline-block',
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 'var(--ctx-r-chip)',
            background: 'var(--ctx-surface-3)',
            color: 'var(--ctx-fg-2)',
            boxShadow: 'inset 0 0 0 1px var(--ctx-line-2)',
          }}
        >
          {lead.lista}
        </span>
      </td>

      <td onClick={(e) => e.stopPropagation()}>
        <span className="ctx-fila-flex" style={{ gap: 2 }}>
          <button type="button" className="ctx-btn ctx-btn--icono ctx-t" style={{ height: 20, width: 20, border: 0 }} title="Abrir la ficha">
            <Maximize2 size={12} aria-hidden />
          </button>
          <button type="button" className="ctx-btn ctx-btn--icono ctx-t" style={{ height: 20, width: 20, border: 0 }} title="Ver en Amazon">
            <ExternalLink size={12} aria-hidden />
          </button>
        </span>
      </td>
    </tr>
  )
}

/** #RRGGBB + alfa → rgba(). Para el tinte opcional de fila */
function hexAlfa(hex: string, alfa: number): string {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alfa})`
}

/** Se exporta para la memoria: la pista de cada estado, que se conserva tal cual */
export const PISTAS = COLD_STATUS_HINTS
