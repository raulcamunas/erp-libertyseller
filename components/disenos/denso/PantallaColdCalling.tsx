'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronDown,
  Copy,
  ExternalLink,
  Filter,
  Maximize2,
  Search,
  SlidersHorizontal,
} from 'lucide-react'
import { BarraLateral, BarraSuperior, Estado } from './Marco'
import {
  ESTADOS,
  ETIQUETA_CORTA,
  LEADS,
  ORDEN_ESTADOS,
  RECUENTO_ESTADO,
  TOTAL_LEADS,
  type EstadoFrio,
  type Lead,
} from './datos'

/* ------------------------------------------------------------------ */

function importe(n: number | null): string {
  if (n == null) return '—'
  return `${Math.round(n).toLocaleString('es-ES')} €`
}

function fecha(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso + 'T12:00:00')
  return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
}

/** Celda editable: no parece un campo hasta que pasas por encima */
function Celda({
  valor,
  marcador,
  numerica,
}: {
  valor: string
  marcador?: string
  numerica?: boolean
}) {
  const [v, setV] = useState(valor)
  return (
    <input
      className={`dz-celda${numerica ? ' dz-celda--num' : ''}`}
      data-vacia={v ? undefined : '1'}
      value={v}
      placeholder={marcador}
      title={v || undefined}
      onChange={(e) => setV(e.target.value)}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

/**
 * El estado de un lead.
 *
 * Se ve un glifo y una palabra; encima, un `<select>` nativo transparente que
 * hace el trabajo de verdad. Así el control se puede usar con teclado y con
 * ratón sin pintar un cuadro de 26,5 px dentro de la fila — que es exactamente
 * lo que hoy manda la altura de la fila de esta tabla.
 */
function SelectorEstado({
  valor,
  onChange,
}: {
  valor: EstadoFrio
  onChange: (v: EstadoFrio) => void
}) {
  const est = ESTADOS[valor]
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
      <Estado
        icono={est.icono}
        color={est.varColor}
        texto={ETIQUETA_CORTA[valor]}
        titulo={`${est.etiqueta} — ${est.pista}`}
      />
      <ChevronDown aria-hidden style={{ width: 11, height: 11, color: 'var(--dz-t4)' }} />
      <select
        value={valor}
        aria-label="Estado del lead"
        onChange={(e) => onChange(e.target.value as EstadoFrio)}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
        }}
      >
        {ORDEN_ESTADOS.map((s) => (
          <option key={s} value={s}>
            {ESTADOS[s].etiqueta}
          </option>
        ))}
      </select>
    </span>
  )
}

/* ------------------------------------------------------------------ */

export function PantallaColdCalling() {
  const [sel, setSel] = useState<string | null>('l02')
  const [filtro, setFiltro] = useState<EstadoFrio | null>(null)
  const [tinte, setTinte] = useState(false)
  const [estados, setEstados] = useState<Record<string, EstadoFrio>>({})
  const caja = useRef<HTMLDivElement>(null)
  const [filasVisibles, setFilasVisibles] = useState(0)

  /**
   * Cuántas filas caben AHORA MISMO, medido en el DOM.
   *
   * No es una estimación: se lee la altura interior de la caja de la tabla, se
   * le quita la cabecera pegajosa y se divide entre la altura de fila. Es la
   * métrica de producto de esta pantalla y por eso está a la vista, no en un
   * documento.
   */
  useEffect(() => {
    const el = caja.current
    if (!el) return
    const medir = () => {
      const estilo = getComputedStyle(el)
      const alturaFila = parseFloat(estilo.getPropertyValue('--dz-fila')) || 28
      const alturaCab = parseFloat(estilo.getPropertyValue('--dz-cabecera')) || 26
      setFilasVisibles(Math.max(0, Math.floor((el.clientHeight - alturaCab) / alturaFila)))
    }
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const estadoDe = (l: Lead): EstadoFrio => estados[l.id] ?? l.estado

  const filas = useMemo(
    () => (filtro ? LEADS.filter((l) => estadoDe(l) === filtro) : LEADS),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [filtro, estados]
  )

  return (
    <div className="dz-app">
      <BarraLateral activo="cold-calling" />

      <div className="dz-main">
        <BarraSuperior
          titulo="Cold Calling"
          contexto={`${filas.length} de ${TOTAL_LEADS.toLocaleString('es-ES')} · Alejandro`}
        >
          {filasVisibles > 0 && (
            <>
              <span className="dz-s dz-num dz-t3" title="Medido en el navegador, no estimado">
                {filasVisibles} filas visibles
              </span>
              <span className="dz-sep" aria-hidden />
            </>
          )}
          <button type="button" className="dz-btn" onClick={() => setTinte((t) => !t)}>
            <SlidersHorizontal aria-hidden />
            Tinte Excel {tinte ? 'sí' : 'no'}
          </button>
          <button type="button" className="dz-btn dz-btn--pri">
            Nueva llamada
          </button>
        </BarraSuperior>

        <div className="dz-cuerpo">
          {/*
            Las cuatro cifras en 28 px de tira, no en cuatro tarjetas de 57,5
            con su separación. Es el mismo dato y cuesta 30 px menos de
            pantalla, que es una fila más de trabajo.
          */}
          <div className="dz-cifras">
            <span className="dz-cifra">
              <b>3.847</b>
              <span>en cartera</span>
            </span>
            <span className="dz-cifra">
              <b>2.429</b>
              <span>trabajados</span>
            </span>
            <span className="dz-cifra">
              <b>97</b>
              <span>citas cualificadas · 4,0 % de conversión</span>
            </span>
            <span className="dz-cifra" data-urg="1">
              <b>12</b>
              <span>rellamadas para hoy</span>
            </span>
          </div>

          {/*
            Una sola fila de filtros de 32 px. Hoy son tres filas —chips de
            estado, chips de lista, y orden más rango de facturación— que suman
            117 px. Lo que no cabe se va detrás de «Filtros», que es donde tiene
            que estar lo que se toca una vez al día.
          */}
          <div className="dz-filtros">
            <div className="dz-buscar">
              <Search aria-hidden />
              <input placeholder="Buscar tienda, empresa o teléfono" />
            </div>
            <span className="dz-sep" aria-hidden />
            <button
              type="button"
              className="dz-chip"
              data-on={filtro === null ? '1' : undefined}
              onClick={() => setFiltro(null)}
            >
              Todos <b>{TOTAL_LEADS.toLocaleString('es-ES')}</b>
            </button>
            {ORDEN_ESTADOS.map((s) => {
              const e = ESTADOS[s]
              const Icono = e.icono
              return (
                <button
                  key={s}
                  type="button"
                  className="dz-chip"
                  data-on={filtro === s ? '1' : undefined}
                  title={e.pista}
                  onClick={() => setFiltro(filtro === s ? null : s)}
                  style={{ ['--dz-c' as string]: e.varColor }}
                >
                  <Icono aria-hidden style={{ color: e.varColor }} />
                  {ETIQUETA_CORTA[s]} <b>{RECUENTO_ESTADO[s].toLocaleString('es-ES')}</b>
                </button>
              )
            })}
            <span className="dz-crece" />
            <button type="button" className="dz-btn">
              <Filter aria-hidden />
              Filtros
            </button>
          </div>

          {/* La tabla */}
          <div className="dz-tablabox" ref={caja}>
            <table className="dz-tabla">
              <thead>
                <tr>
                  <th className="dz-fija" style={{ minWidth: 178 }}>
                    Tienda
                  </th>
                  {/*
                    Estado sube a la segunda columna, pegado al ancla.
                    Antes estaba la cuarta y el estado se leía por el tinte de
                    la fila entera: siete tonos al 8 % de alfa que con
                    deuteranopía son el mismo beige. Aquí se lee por el glifo,
                    que está siempre en la misma x y se barre con la vista igual
                    de rápido que un color — y además dice cuál es.
                  */}
                  <th style={{ minWidth: 152 }}>Estado</th>
                  <th className="dz-der" style={{ minWidth: 104 }}>
                    Facturación
                  </th>
                  <th style={{ minWidth: 86 }}>Rellamar</th>
                  <th style={{ minWidth: 132 }}>Teléfono</th>
                  <th style={{ minWidth: 300 }}>Seguimiento</th>
                  <th style={{ minWidth: 170 }}>Empresa</th>
                  <th style={{ minWidth: 180 }}>Email</th>
                  <th style={{ minWidth: 112 }}>Provincia</th>
                  <th style={{ minWidth: 152 }}>Categoría</th>
                  <th style={{ minWidth: 96 }}>Lista</th>
                  <th style={{ width: 56 }} aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {filas.map((l) => {
                  const s = estadoDe(l)
                  const e = ESTADOS[s]
                  const activa = l.id === sel
                  return (
                    <tr
                      key={l.id}
                      data-sel={activa ? '1' : undefined}
                      onClick={() => setSel(l.id)}
                      /*
                        El tinte de fila del Excel, apagado por defecto y
                        disponible con un botón. Es lo que más pierde esta
                        propuesta respecto a lo de hoy y no se resuelve
                        fingiendo que no importa: quien lo tenga aprendido lo
                        enciende y sigue trabajando igual.
                      */
                      style={
                        tinte && !activa && s !== 'pendiente'
                          ? { background: `color-mix(in srgb, ${e.varColor} 11%, transparent)` }
                          : undefined
                      }
                    >
                      {/* El nombre de la tienda es también EL BOTÓN que selecciona
                          la fila. El onClick del <tr> se queda para el ratón, pero
                          un manejador en el <tr> no se dispara con el teclado: al
                          tabular hasta un campo de dentro de la fila, la fila no
                          llegaba a seleccionarse nunca, así que el resaltado de «la
                          fila en la que estás» era inalcanzable sin ratón. En botón
                          y no con tabIndex sobre el <tr>: no mete 4.000 paradas de
                          tabulador. */}
                      <td className="dz-fija">
                        <button
                          type="button"
                          className="dz-corta"
                          style={{ maxWidth: 162, fontWeight: 500, color: 'var(--dz-t1)' }}
                          title={`${l.tienda} — seleccionar esta fila`}
                          aria-pressed={activa}
                          onClick={(ev) => {
                            ev.stopPropagation()
                            setSel(l.id)
                          }}
                        >
                          {l.tienda}
                        </button>
                      </td>
                      <td>
                        <SelectorEstado
                          valor={s}
                          onChange={(v) => setEstados((m) => ({ ...m, [l.id]: v }))}
                        />
                      </td>
                      <td className="dz-der dz-num" style={{ color: 'var(--dz-t1)' }}>
                        {importe(l.facturacion)}
                      </td>
                      <td className="dz-num dz-t3">{fecha(l.rellamar) || '—'}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        {l.telefono ? (
                          <button type="button" className="dz-celda" title="Copiar">
                            {l.telefono}
                          </button>
                        ) : (
                          <span className="dz-t4">Sin teléfono</span>
                        )}
                      </td>
                      <td style={{ maxWidth: 300 }}>
                        <Celda valor={l.seguimiento} marcador="Añadir seguimiento" />
                      </td>
                      <td className="dz-t3">
                        <span className="dz-corta" style={{ maxWidth: 162 }} title={l.empresa}>
                          {l.empresa}
                        </span>
                      </td>
                      <td className="dz-t3">
                        <span className="dz-corta" style={{ maxWidth: 172 }} title={l.email ?? ''}>
                          {l.email ?? 'Sin email'}
                        </span>
                      </td>
                      <td className="dz-t3">{l.provincia}</td>
                      <td className="dz-t3">
                        <span className="dz-corta" style={{ maxWidth: 144 }}>
                          {l.categoria}
                        </span>
                      </td>
                      <td className="dz-t3">{l.lista}</td>
                      <td onClick={(ev) => ev.stopPropagation()}>
                        <span style={{ display: 'flex', gap: 2 }}>
                          <button type="button" className="dz-iconbtn" title="Abrir ficha">
                            <Maximize2 aria-hidden />
                          </button>
                          <button type="button" className="dz-iconbtn" title="Ver en Amazon">
                            <ExternalLink aria-hidden />
                          </button>
                        </span>
                      </td>
                    </tr>
                  )
                })}
                {/*
                  «Ver más» va DENTRO del scroll, no debajo de la caja: así no
                  cuesta ni un píxel de cromo permanente. Se conserva la
                  paginación incremental del ERP en vez de virtualizar, para que
                  Ctrl+F, el scroll y la impresión se comporten igual en todas
                  las tablas.
                */}
                <tr>
                  <td colSpan={12} style={{ height: 30, textAlign: 'center' }}>
                    <button type="button" className="dz-btn">
                      <Copy aria-hidden />
                      Ver más ({(TOTAL_LEADS - filas.length).toLocaleString('es-ES')} restantes)
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
