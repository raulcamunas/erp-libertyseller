'use client'

/**
 * PANTALLA 2 — /dashboard/cold-calling, vista tabla. La tabla larga.
 *
 * Lo que hay que resolver aquí, medido: 35,5 px por fila y 396,5 px de cromo
 * para ver de 10 a 19 filas de casi 4.000; siete tonos al 8 % de alfa como
 * código de estado; la cabecera de columna a 3,80:1; y el naranja de la fila
 * seleccionada compitiendo con el naranja de «En seguimiento» y con el del
 * chip de filtro encendido.
 *
 * Lo que NO se toca porque hoy funciona: `tabular-nums` en todo lo que se
 * compara en columna; la cadena de `min-w-0` que mantiene el scroll horizontal
 * dentro de la caja; el fondo OPACO de la celda congelada; la escalera de
 * z-index 30/20/10/0; la paginación con «Ver más» en vez de virtualización; la
 * celda que no parece un campo hasta que pasas por encima; los filtros que se
 * recuerdan con su salida clara para limpiarlos; y el formato español.
 */

import { useMemo, useState } from 'react'
import { Copy, ExternalLink, Eraser, Maximize2, Plus } from 'lucide-react'
import { EstadoLinea, ESTADOS_LEAD, ORDEN_ESTADOS } from './Estados'
import { LEADS, LISTAS_ORIGEN, ORDENES, euros, fechaCorta, type EstadoLead, type Lead } from './datos'

const PAGINA = 24

export function PantallaColdCalling() {
  const [leads, setLeads] = useState<Lead[]>(LEADS)
  const [filtro, setFiltro] = useState<EstadoLead | null>(null)
  const [lista, setLista] = useState<string | null>(null)
  const [orden, setOrden] = useState('revenue_desc')
  const [sel, setSel] = useState<string | null>('l03')
  const [visibles, setVisibles] = useState(PAGINA)

  const cuentas = useMemo(() => {
    const m = {} as Record<EstadoLead, number>
    for (const e of ORDEN_ESTADOS) m[e] = 0
    for (const l of leads) m[l.estado]++
    return m
  }, [leads])

  const filtrados = useMemo(() => {
    let f = leads
    if (filtro) f = f.filter((l) => l.estado === filtro)
    if (lista) f = f.filter((l) => l.lista === lista)
    const copia = [...f]
    if (orden === 'revenue_desc') copia.sort((a, b) => (b.facturacion ?? 0) - (a.facturacion ?? 0))
    if (orden === 'revenue_asc') copia.sort((a, b) => (a.facturacion ?? 0) - (b.facturacion ?? 0))
    if (orden === 'name') copia.sort((a, b) => a.tienda.localeCompare(b.tienda, 'es'))
    if (orden === 'due_first') copia.sort((a, b) => (a.rellamar ?? '9999').localeCompare(b.rellamar ?? '9999'))
    return copia
  }, [leads, filtro, lista, orden])

  const mostrados = filtrados.slice(0, visibles)
  const restantes = filtrados.length - mostrados.length
  const hayFiltro = filtro !== null || lista !== null

  function editar(id: string, campo: keyof Lead, valor: string | null) {
    setLeads((prev) => prev.map((l) => (l.id === id ? { ...l, [campo]: valor } : l)))
  }

  /* Los indicadores de la cabecera van con las cifras de la cartera ENTERA
     —3.914 leads—, no con las de las 30 filas de esta maqueta: lo que se está
     juzgando es cómo se leen cuatro cifras en una banda de 44 px, y con 30 leads
     saldrían números que no se parecen a los de la pantalla real. */

  return (
    <main className="lsd-pantalla">
      {/* ---------- Título e indicadores EN LA MISMA BANDA ----------
          Hoy son dos bloques: 76 px de bloque de título más 69,5 px de rejilla
          de cuatro tarjetas. Aquí es una banda de 44 px. El dato pesa; el
          envoltorio desaparece: los indicadores no llevan tarjeta, se separan
          con una línea vertical. */}
      <div className="lsd-cabecera">
        <div className="lsd-cabecera-txt">
          <h1 className="lsd-titulo">Cold Calling</h1>
          <p className="lsd-cabecera-sub">Cartera de sellers a prospectar</p>
        </div>

        <div className="lsd-kpis">
          <div className="lsd-kpi">
            <div className="lsd-kpi-et">Leads en cartera</div>
            <div>
              <span className="lsd-kpi-val">3.914</span>
            </div>
          </div>
          <div className="lsd-kpi">
            <div className="lsd-kpi-et">Trabajados</div>
            <div>
              <span className="lsd-kpi-val">2.187</span>{' '}
              <span className="lsd-kpi-pie">de 3.914</span>
            </div>
          </div>
          <div className="lsd-kpi">
            <div className="lsd-kpi-et">Citas cualificadas</div>
            <div>
              <span className="lsd-kpi-val">142</span>{' '}
              <span className="lsd-kpi-pie">6,5 % de conversión</span>
            </div>
          </div>
          {/* El ÚNICO indicador con acento de toda la pantalla: es el que pide
              acción hoy. Si lo llevaran los cuatro, no lo llevaría ninguno. */}
          <div className="lsd-kpi" data-acento="si">
            <div className="lsd-kpi-et">Rellamadas para hoy</div>
            <div>
              <span className="lsd-kpi-val">23</span>{' '}
              <span className="lsd-kpi-pie">4 vencidas</span>
            </div>
          </div>
        </div>

        <div className="lsd-cabecera-fin">
          <button type="button" className="lsd-btn" data-tipo="primario">
            <Plus size={14} aria-hidden /> Nuevo lead
          </button>
        </div>
      </div>

      {/* ---------- Una sola barra de filtros ----------
          Hoy son tres filas (117 px). Los chips de estado llevan su recuento y
          su icono, así que también aquí el estado se lee sin color. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', flex: '0 0 auto' }}>
        <button
          type="button"
          className="lsd-chip"
          data-on={filtro === null ? 'si' : 'no'}
          onClick={() => setFiltro(null)}
        >
          Todos <span className="lsd-chip-n">{leads.length}</span>
        </button>

        {ORDEN_ESTADOS.map((e) => {
          const d = ESTADOS_LEAD[e]
          const Icono = d.icono
          return (
            <button
              key={e}
              type="button"
              className={`lsd-chip lsd-e-${e}`}
              data-on={filtro === e ? 'si' : 'no'}
              onClick={() => setFiltro(filtro === e ? null : e)}
              title={d.pista}
            >
              <Icono
                size={12}
                strokeWidth={2.5}
                className="lsd-sincolor"
                style={{ color: filtro === e ? 'inherit' : 'var(--lsd-est)' }}
                aria-hidden
              />
              {d.etiqueta} <span className="lsd-chip-n">{cuentas[e]}</span>
            </button>
          )
        })}

        <span className="lsd-mando-sep" />

        <select
          className="lsd-campo"
          style={{ width: 'auto', height: 26 }}
          value={lista ?? ''}
          onChange={(ev) => setLista(ev.target.value || null)}
          aria-label="Lista de origen"
        >
          <option value="">Todas las listas</option>
          {LISTAS_ORIGEN.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>

        <select
          className="lsd-campo"
          style={{ width: 'auto', height: 26 }}
          value={orden}
          onChange={(ev) => setOrden(ev.target.value)}
          aria-label="Orden"
        >
          {ORDENES.map((o) => (
            <option key={o.valor} value={o.valor}>{o.etiqueta}</option>
          ))}
        </select>

        {/* Los filtros se recuerdan de un día para otro, así que hace falta una
            salida clara o alguien acabará pensando que ha perdido leads. */}
        {hayFiltro && (
          <button
            type="button"
            className="lsd-chip"
            onClick={() => { setFiltro(null); setLista(null) }}
          >
            <Eraser size={12} aria-hidden /> Limpiar filtros
          </button>
        )}
      </div>

      {/* ---------- La tabla ----------
          `min-w-0` + `overflow: auto` en la caja: el scroll horizontal vive
          aquí dentro, la caja no crece y el menú no se mueve. */}
      <div className="lsd-tabla-caja">
        <table className="lsd-tabla">
          <thead>
            <tr>
              <th data-fija="si" style={{ minWidth: 210 }}>Tienda</th>
              <th style={{ minWidth: 175 }}>Empresa</th>
              <th data-der="si" style={{ minWidth: 105 }}>Facturación</th>
              <th style={{ minWidth: 180 }}>Estado</th>
              <th style={{ minWidth: 135 }}>Teléfono</th>
              <th style={{ minWidth: 105 }}>Rellamar</th>
              <th style={{ minWidth: 280 }}>Seguimiento</th>
              <th style={{ minWidth: 175 }}>Email</th>
              <th style={{ minWidth: 105 }}>Provincia</th>
              <th style={{ minWidth: 150 }}>Categoría</th>
              <th style={{ minWidth: 100 }}>Lista</th>
              <th style={{ width: 64 }} aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {mostrados.map((l) => {
              const activo = l.id === sel
              return (
                <tr
                  key={l.id}
                  data-sel={activo ? 'si' : 'no'}
                  onClick={() => setSel(l.id)}
                  className={`lsd-e-${l.estado}`}
                  style={{ cursor: 'pointer' }}
                >
                  {/* Celda congelada con fondo opaco y el raíl del estado
                      pegado al borde. El color aprendido del Excel se queda,
                      pero deja de teñir la fila entera: en 3 px se distingue,
                      y al 8 % sobre doce columnas no.

                      El nombre de la tienda es además EL BOTÓN que selecciona la
                      fila. El onClick del <tr> se queda para el ratón, pero un
                      manejador en el <tr> no se dispara con el teclado: al tabular
                      hasta un campo de dentro de la fila, la fila no llegaba a
                      seleccionarse nunca, así que el resaltado de «la fila en la
                      que estás» era inalcanzable sin ratón. Va en botón y no con
                      tabIndex sobre el <tr> para no meter 4.000 paradas de
                      tabulador ni romper la semántica de tabla. */}
                  <td data-fija="si">
                    <span className="lsd-rail">
                      <span
                        className="lsd-rail-b lsd-sincolor"
                        data-vacio={l.estado === 'pendiente' ? 'si' : 'no'}
                        aria-hidden
                      />
                      <button
                        type="button"
                        className="lsd-rail-txt lsd-sel-fila"
                        title={`${l.tienda} — seleccionar esta fila`}
                        aria-pressed={activo}
                        onClick={(ev) => {
                          ev.stopPropagation()
                          setSel(l.id)
                        }}
                      >
                        {l.tienda}
                      </button>
                    </span>
                  </td>

                  <td data-2="si">
                    <span style={{ display: 'block', maxWidth: 175, overflow: 'hidden', textOverflow: 'ellipsis' }} title={l.empresa ?? ''}>
                      {l.empresa ?? '—'}
                    </span>
                  </td>

                  {/* tabular-nums: sin esto no se comparan importes en columna */}
                  <td data-der="si" className="lsd-num">{euros(l.facturacion)}</td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <CeldaEstado valor={l.estado} onCambio={(v) => editar(l.id, 'estado', v)} />
                  </td>

                  <td data-2="si" onClick={(e) => e.stopPropagation()}>
                    {l.telefono ? (
                      <button
                        type="button"
                        className="lsd-celda"
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, width: 'auto' }}
                        title="Copiar el teléfono"
                        onClick={() => navigator.clipboard?.writeText(l.telefono!)}
                      >
                        <span className="lsd-num">{l.telefono}</span>
                        <Copy size={11} style={{ opacity: 0.5 }} aria-hidden />
                      </button>
                    ) : (
                      <span style={{ color: 'var(--lsd-t3)' }}>—</span>
                    )}
                  </td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <CeldaFecha
                      valor={l.rellamar}
                      etiqueta={`Rellamar a ${l.tienda}`}
                      onCambio={(v) => editar(l.id, 'rellamar', v)}
                    />
                  </td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <CeldaTexto
                      valor={l.seguimiento ?? ''}
                      marcador="Añadir seguimiento…"
                      onGuardar={(v) => editar(l.id, 'seguimiento', v.trim() || null)}
                    />
                  </td>

                  <td data-2="si" onClick={(e) => e.stopPropagation()}>
                    {l.email ? (
                      <a
                        href={`mailto:${l.email}`}
                        style={{ color: 'inherit', textDecoration: 'none', display: 'block', maxWidth: 175, overflow: 'hidden', textOverflow: 'ellipsis' }}
                        title={l.email}
                      >
                        {l.email}
                      </a>
                    ) : (
                      <span style={{ color: 'var(--lsd-t3)' }}>—</span>
                    )}
                  </td>

                  <td data-2="si">{l.provincia ?? '—'}</td>
                  <td data-2="si">{l.categoria ?? '—'}</td>

                  {/* La lista de origen ya no es una píldora de color derivado
                      por hash: es texto. Un color que nadie puede predecir no
                      informa, solo ocupa. */}
                  <td data-3="si">{l.lista}</td>

                  <td onClick={(e) => e.stopPropagation()}>
                    <span style={{ display: 'flex', gap: 2 }}>
                      <button type="button" className="lsd-icono-btn" title="Abrir la ficha" aria-label="Abrir la ficha">
                        <Maximize2 size={13} />
                      </button>
                      <button type="button" className="lsd-icono-btn" title="Ver en Amazon" aria-label="Ver en Amazon">
                        <ExternalLink size={13} />
                      </button>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Paginación incremental, como en todas las tablas del ERP: nada de
          virtualización, para que Ctrl+F, el scroll y la impresión se
          comporten igual en todas. */}
      <div className="lsd-tabla-pie">
        <span>
          <strong className="lsd-num" style={{ color: 'var(--lsd-t1)', fontWeight: 600 }}>{mostrados.length}</strong>
          {' '}de{' '}
          <span className="lsd-num">{filtrados.length}</span>
          {hayFiltro ? ' (filtrados)' : ' leads'}
        </span>
        {restantes > 0 && (
          <button type="button" className="lsd-btn" onClick={() => setVisibles((v) => v + PAGINA)}>
            Ver más ({restantes} restantes)
          </button>
        )}
        <span className="lsd-tenue" style={{ marginLeft: 'auto' }}>
          Fila de 32 px · 26 visibles en un monitor de 1080 contra las 19 de hoy
        </span>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */

/**
 * El estado, editable en la propia tabla. El `select` va invisible encima del
 * icono y la palabra: se edita en un clic, pero la celda sigue leyéndose como
 * un dato y no como un formulario.
 */
function CeldaEstado({ valor, onCambio }: { valor: EstadoLead; onCambio: (v: EstadoLead) => void }) {
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
      <EstadoLinea estado={valor} />
      <select
        value={valor}
        onChange={(e) => onCambio(e.target.value as EstadoLead)}
        aria-label="Estado del lead"
        style={{
          position: 'absolute', inset: 0, width: '100%', height: '100%',
          opacity: 0, cursor: 'pointer', border: 0, padding: 0,
        }}
      >
        {ORDEN_ESTADOS.map((e) => (
          <option key={e} value={e}>{ESTADOS_LEAD[e].etiqueta}</option>
        ))}
      </select>
    </span>
  )
}

/**
 * La fecha de rellamada.
 *
 * Un `input type="date"` vacío pinta «dd/mm/aaaa» en gris, y en una columna de
 * cuatrocientas filas donde la mayoría están vacías eso son cuatrocientas
 * repeticiones de un texto que no dice nada: tapa las pocas fechas que sí hay,
 * que es justo el dato que se viene a buscar. Vacío se enseña un guion; el
 * campo aparece al pulsarlo.
 */
function CeldaFecha({
  valor, etiqueta, onCambio,
}: { valor: string | null; etiqueta: string; onCambio: (v: string | null) => void }) {
  const [editando, setEditando] = useState(false)

  if (!valor && !editando) {
    return (
      <button
        type="button"
        className="lsd-celda"
        data-vacia="si"
        aria-label={etiqueta}
        onClick={() => setEditando(true)}
      >
        —
      </button>
    )
  }

  return (
    <input
      type="date"
      className="lsd-celda lsd-num"
      value={valor ?? ''}
      autoFocus={editando && !valor}
      aria-label={etiqueta}
      onChange={(e) => onCambio(e.target.value || null)}
      onBlur={() => setEditando(false)}
    />
  )
}

/**
 * Celda de texto editable al vuelo, como una hoja de cálculo. No parece un
 * campo hasta que pasas por encima: es lo único que impide que doce columnas
 * editables se lean como un formulario. Es el patrón del ERP de hoy y se
 * conserva tal cual.
 */
function CeldaTexto({
  valor, marcador, onGuardar,
}: { valor: string; marcador: string; onGuardar: (v: string) => void }) {
  const [borrador, setBorrador] = useState(valor)
  const [editando, setEditando] = useState(false)

  if (!editando) {
    return (
      <button
        type="button"
        className="lsd-celda"
        data-vacia={valor ? 'no' : 'si'}
        title={valor || undefined}
        onClick={() => { setBorrador(valor); setEditando(true) }}
      >
        {valor || marcador}
      </button>
    )
  }

  return (
    <input
      className="lsd-celda"
      value={borrador}
      autoFocus
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={() => { setEditando(false); if (borrador !== valor) onGuardar(borrador) }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setBorrador(valor); setEditando(false) }
      }}
    />
  )
}

export { fechaCorta }
