import { acos, cpc, cvr, decimal, dinero, entero, fechaLarga, NOMBRE_DEL_INFORME, paisesConInversion, pct, periodoEnTexto, roas, variacion, type DatosDelInforme, type LineaEjecutada } from '@/lib/cuentas/informe'

/**
 * EL INFORME AL CLIENTE, PINTADO. Lo mismo en el ERP (al revisar el borrador) que en la página del cliente (/informe/<token>), y en el PDF que sale
 * al imprimir. Sin hooks: lo puede pintar el servidor.
 *
 * Identidad de Liberty Seller (skill «identidad-documentos-liberty-seller»): negro 141414 y naranja F26212 sobre blanco, crema EDE6DC, gris 5E5852,
 * líneas E5E1DB; nada de verdes; el rojo C0432E solo para lo que empeora. Sin vocabulario interno.
 */
/** «JAMON ENTERO 7-8KG» → «Jamon entero 7-8KG»: los nombres salen de las campañas, que van en mayúsculas */
const nombreBonito = (t: string) => (t === t.toUpperCase() && /[A-ZÁÉÍÓÚÑ]{3}/.test(t) ? t.charAt(0) + t.slice(1).toLowerCase().replace(/\b(\d+(?:[.,]\d+)?)(kg|g|ml|l|cm|mm|m)\b/gi, (_, a, b) => a + b.toLowerCase()) : t)

const C = { negro: '#141414', negro2: '#0E0E0E', naranja: '#F26212', naranja2: '#FF8A3D', crema: '#EDE6DC', gris: '#5E5852', gris2: '#B8AE9F', linea: '#E5E1DB', soft: '#F7F5F2', naranjaBg: '#FEF3EC', rojo: '#C0432E' }
const TITULAR = "Sora, Inter, 'Helvetica Neue', Arial, sans-serif"
const CUERPO = "Inter, 'Helvetica Neue', Arial, sans-serif"

export function DocumentoInforme({ d, lectura, extra = [] }: { d: DatosDelInforme; lectura: string; extra?: LineaEjecutada[] }) {
  const t = d.total
  const a = d.totalAnterior
  const m = d.moneda
  const ejecutado = [...d.ejecutado, ...extra.filter((x) => x.accion.trim())]
  const tacos = d.ventasTotales ? t.gasto / d.ventasTotales : null
  let seccion = 0
  const sig = () => String(++seccion).padStart(2, '0')

  return (
    <article className="informe-a4" style={{ background: '#FFFFFF', color: C.negro, fontFamily: CUERPO, maxWidth: 820, margin: '0 auto', boxShadow: '0 1px 3px rgba(0,0,0,.08)' }}>
      <style>{`
        .informe-a4 table { border-collapse: collapse; width: 100%; }
        .informe-a4 th { text-align: left; font-weight: 600; font-size: 11px; color: ${C.gris}; text-transform: uppercase; letter-spacing: .04em; padding: 8px 10px; border-bottom: 1px solid ${C.linea}; }
        .informe-a4 td { font-size: 13px; padding: 9px 10px; border-bottom: 1px solid ${C.linea}; vertical-align: top; }
        .informe-a4 .num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
        @media print {
          @page { size: A4; margin: 12mm; }
          body { background: #fff !important; }
          .informe-a4 { box-shadow: none !important; max-width: none !important; }
          .no-imprimir { display: none !important; }
          .informe-a4 section { break-inside: avoid; }
        }
        @media (max-width: 640px) { .informe-a4 .rejilla-kpi { grid-template-columns: repeat(2, minmax(0,1fr)) !important; } .informe-a4 .pad { padding-left: 18px !important; padding-right: 18px !important; } }
      `}</style>

      {/* Banda de cabecera */}
      <header className="pad" style={{ background: C.negro2, color: '#fff', padding: '28px 36px 24px', borderTop: `4px solid ${C.naranja}` }}>
        <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color: C.gris2 }}>Liberty Seller · {NOMBRE_DEL_INFORME[d.tipo]}</div>
        <h1 style={{ fontFamily: TITULAR, fontSize: 28, fontWeight: 700, margin: '8px 0 2px', letterSpacing: '-.01em' }}>{d.cliente}</h1>
        <div style={{ color: C.naranja2, fontSize: 15, fontWeight: 600 }}>Amazon · {periodoEnTexto(d.desde, d.hasta)}</div>
        <div className="rejilla-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 1, marginTop: 20, background: '#2a2a2a', border: '1px solid #2a2a2a' }}>
          <Banda etiqueta="Inversión" valor={dinero(t.gasto, m)} />
          <Banda etiqueta="Ventas de publicidad" valor={dinero(t.ventas, m)} />
          <Banda etiqueta="ACoS" valor={pct(acos(t))} destacado />
          <Banda etiqueta="ROAS" valor={decimal(roas(t))} />
        </div>
      </header>

      <div className="pad" style={{ padding: '8px 36px 32px' }}>
        {/* Lectura */}
        <Seccion n={sig()} rotulo="Lectura del periodo" titulo="Lo que ha pasado">
          {lectura.trim() ? (
            lectura
              .split(/\n{2,}/)
              .map((p, i) => (
                <p key={i} style={{ fontSize: 14.5, lineHeight: 1.65, margin: '0 0 12px' }}>
                  {p.trim()}
                </p>
              ))
          ) : (
            <p style={{ fontSize: 14, color: C.gris }}>—</p>
          )}
        </Seccion>

        {/* Publicidad */}
        <Seccion n={sig()} rotulo="Publicidad" titulo="Qué ha hecho la publicidad" subtitulo={`Comparado con los ${d.dias} días anteriores (${fechaLarga(d.anterior.desde)} – ${fechaLarga(d.anterior.hasta)})`}>
          <div className="rejilla-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 10 }}>
            <Kpi etiqueta="Inversión" valor={dinero(t.gasto, m)} antes={dinero(a.gasto, m)} cambio={variacion(t.gasto, a.gasto)} />
            <Kpi etiqueta="Ventas de publicidad" valor={dinero(t.ventas, m)} antes={dinero(a.ventas, m)} cambio={variacion(t.ventas, a.ventas)} bueno="sube" />
            <Kpi etiqueta="ACoS" valor={pct(acos(t))} antes={pct(acos(a))} cambio={variacion(acos(t), acos(a))} bueno="baja" hero />
            <Kpi etiqueta="Pedidos" valor={entero(t.pedidos)} antes={entero(a.pedidos)} cambio={variacion(t.pedidos, a.pedidos)} bueno="sube" />
            <Kpi etiqueta="Clics" valor={entero(t.clics)} antes={entero(a.clics)} cambio={variacion(t.clics, a.clics)} />
            <Kpi etiqueta="Coste por clic" valor={dinero(cpc(t), m, 2)} antes={dinero(cpc(a), m, 2)} cambio={variacion(cpc(t), cpc(a))} bueno="baja" />
            <Kpi etiqueta="Conversión" valor={pct(cvr(t))} antes={pct(cvr(a))} cambio={variacion(cvr(t), cvr(a))} bueno="sube" />
            <Kpi etiqueta="TACoS" valor={pct(tacos)} antes={d.ventasTotales ? `sobre ${dinero(d.ventasTotales, m)} de ventas totales` : 'sin ventas totales'} cambio={null} />
          </div>
          {d.diario.length > 1 && <Grafico diario={d.diario} moneda={m} />}
          {paisesConInversion(d).length > 1 && (
            <div style={{ overflowX: 'auto', marginTop: 16 }}><table>
              <thead>
                <tr>
                  <th>País</th>
                  <th className="num">Inversión</th>
                  <th className="num">Ventas</th>
                  <th className="num">ACoS</th>
                  <th className="num">Antes</th>
                  <th className="num">Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {paisesConInversion(d).map((p) => (
                  <tr key={p.pais}>
                    <td style={{ fontWeight: 600 }}>{p.pais}</td>
                    <td className="num">{dinero(p.actual.gasto, p.moneda)}</td>
                    <td className="num">{dinero(p.actual.ventas, p.moneda)}</td>
                    <td className="num">{pct(acos(p.actual))}</td>
                    <td className="num" style={{ color: C.gris }}>{pct(acos(p.anterior))}</td>
                    <td className="num">{entero(p.actual.pedidos)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )}
          {paisesConInversion(d).some((p) => (p.moneda ?? 'EUR') !== m) && <Nota>Los totales de arriba son de los países en {m}; el resto está en la tabla, cada uno en su moneda.</Nota>}
          {!d.ventasTotales && d.ventasTotalesNota && <Nota>TACoS: {d.ventasTotalesNota.toLowerCase().replace(/\.$/, '')}.</Nota>}
        </Seccion>

        {/* Productos */}
        {d.productos.length > 0 && (
          <Seccion n={sig()} rotulo="Productos" titulo="Por producto" subtitulo="Los productos con más inversión en el periodo">
            <div style={{ overflowX: 'auto' }}><table>
              <thead>
                <tr>
                  <th>Producto</th>
                  <th className="num">Inversión</th>
                  <th className="num">Ventas</th>
                  <th className="num">ACoS</th>
                  <th className="num">Pedidos</th>
                </tr>
              </thead>
              <tbody>
                {d.productos.filter((p) => p.gasto > 0).map((p) => (
                  <tr key={p.asin}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{p.nombre ? nombreBonito(p.nombre) : p.asin}</div>
                      <div style={{ fontSize: 11, color: C.gris }}>{p.asin}</div>
                    </td>
                    <td className="num">{dinero(p.gasto, m)}</td>
                    <td className="num">{dinero(p.ventas, m)}</td>
                    <td className="num">{pct(acos(p))}</td>
                    <td className="num">{entero(p.pedidos)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </Seccion>
        )}

        {/* Lo ejecutado: sin nada apuntado no sale (no se le dice al cliente que no se ha hecho nada si se hizo fuera del ERP) */}
        {ejecutado.length > 0 && (
        <Seccion n={sig()} rotulo="Trabajo en la cuenta" titulo="Lo que hemos hecho" subtitulo="Cambios aplicados en la cuenta durante el periodo">
            <div style={{ overflowX: 'auto' }}><table>
              <thead>
                <tr>
                  <th>Acción</th>
                  <th className="num">Cantidad</th>
                  <th>Por qué</th>
                </tr>
              </thead>
              <tbody>
                {ejecutado.map((e, i) => (
                  <tr key={i}>
                    <td style={{ fontWeight: 600 }}>{e.accion}</td>
                    <td className="num">{e.cantidad ? entero(e.cantidad) : '—'}</td>
                    <td style={{ color: C.gris }}>{e.criterio}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
        </Seccion>
        )}

        {/* Visibilidad */}
        {d.tipo !== 'semanal' && (
          <Seccion n={sig()} rotulo="Búsquedas" titulo="Cómo nos encuentran" subtitulo={d.visibilidad ? `Búsquedas de Amazon con más volumen (Brand Analytics, ${d.visibilidad.periodo})` : undefined}>
            {d.visibilidad?.busquedas.length ? (
              <div style={{ overflowX: 'auto' }}><table>
                <thead>
                  <tr>
                    <th>Búsqueda</th>
                    <th className="num">Impresiones</th>
                    <th className="num">Clics</th>
                    <th className="num">Compras</th>
                    <th>Lectura</th>
                  </tr>
                </thead>
                <tbody>
                  {d.visibilidad.busquedas.map((b) => {
                    const v = variacion(b.cuotaCompras, b.cuotaComprasAntes)
                    return (
                      <tr key={b.consulta}>
                        <td style={{ fontWeight: 600 }}>{b.consulta}</td>
                        <td className="num">{pct(b.cuotaImpresiones)}</td>
                        <td className="num">{pct(b.cuotaClics)}</td>
                        <td className="num">
                          {pct(b.cuotaCompras)}
                          {v != null && <div style={{ fontSize: 10.5, color: v < 0 ? C.rojo : C.gris }}>antes {pct(b.cuotaComprasAntes)}</div>}
                        </td>
                        <td style={{ color: C.gris }}>{b.etiqueta}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table></div>
            ) : (
              <p style={{ fontSize: 13.5, color: C.gris, margin: 0 }}>{d.visibilidadNota ?? 'Sin datos de búsquedas en este periodo.'}</p>
            )}
            {d.visibilidad?.busquedas.length ? <Nota>Cada porcentaje es la parte de esa búsqueda que se lleva tu producto en todo Amazon: de cada 100 veces que alguien la busca y compra, cuántas compra lo tuyo.</Nota> : null}
          </Seccion>
        )}

        {/* Salud */}
        {d.salud && (
          <Seccion n={sig()} rotulo="Fichas" titulo="Salud de las fichas" subtitulo="Lo que Amazon señala en tus productos publicados">
            <div className="rejilla-kpi" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 10 }}>
              <Kpi etiqueta="Fichas revisadas" valor={entero(d.salud.revisadas)} />
              <Kpi etiqueta="Con algo que resolver" valor={entero(d.salud.conProblemasFin)} antes={d.salud.conProblemasInicio != null ? entero(d.salud.conProblemasInicio) : undefined} cambio={variacion(d.salud.conProblemasFin, d.salud.conProblemasInicio)} bueno="baja" />
              <Kpi etiqueta="Ocultas en Amazon" valor={entero(d.salud.ocultasFin)} />
            </div>
          </Seccion>
        )}

        <footer style={{ marginTop: 28, paddingTop: 14, borderTop: `1px solid ${C.linea}`, fontSize: 11, color: C.gris, display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <span>Liberty Seller · libertyseller.com</span>
          <span>Datos de Amazon Ads y Seller Central · preparado el {fechaLarga(d.generadoAt.slice(0, 10))}</span>
        </footer>
      </div>
    </article>
  )
}

function Banda({ etiqueta, valor, destacado }: { etiqueta: string; valor: string; destacado?: boolean }) {
  return (
    <div style={{ background: C.negro2, padding: '12px 14px' }}>
      <div style={{ fontSize: 10.5, color: C.gris2, textTransform: 'uppercase', letterSpacing: '.06em' }}>{etiqueta}</div>
      <div style={{ fontFamily: TITULAR, fontSize: 21, fontWeight: 700, marginTop: 2, color: destacado ? C.naranja : '#fff', fontVariantNumeric: 'tabular-nums' }}>{valor}</div>
    </div>
  )
}

function Seccion({ n, rotulo, titulo, subtitulo, children }: { n: string; rotulo: string; titulo: string; subtitulo?: string; children: React.ReactNode }) {
  return (
    <section style={{ marginTop: 26 }}>
      <div style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', color: C.gris }}>
        <span style={{ color: C.naranja, fontWeight: 700 }}>{n}</span> · {rotulo}
      </div>
      <h2 style={{ fontFamily: TITULAR, fontSize: 19, fontWeight: 700, margin: '4px 0 2px' }}>{titulo}</h2>
      <div style={{ width: 44, height: 3, background: C.naranja, margin: '6px 0 10px' }} />
      {subtitulo && <div style={{ fontSize: 12.5, color: C.gris, margin: '-2px 0 12px' }}>{subtitulo}</div>}
      {children}
    </section>
  )
}

function Kpi({ etiqueta, valor, antes, cambio, bueno, hero }: { etiqueta: string; valor: string; antes?: string; cambio?: number | null; bueno?: 'sube' | 'baja'; hero?: boolean }) {
  const malo = cambio != null && bueno != null && ((bueno === 'sube' && cambio < -0.02) || (bueno === 'baja' && cambio > 0.02))
  return (
    <div style={{ background: hero ? C.negro : C.soft, color: hero ? '#fff' : C.negro, borderRadius: 6, padding: '12px 14px', minWidth: 0 }}>
      <div style={{ fontSize: 11, color: hero ? C.gris2 : C.gris }}>{etiqueta}</div>
      <div style={{ fontFamily: TITULAR, fontSize: 20, fontWeight: 700, color: hero ? C.naranja : C.negro, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{valor}</div>
      {(antes || cambio != null) && (
        <div style={{ fontSize: 11, color: malo ? C.rojo : hero ? C.gris2 : C.gris, marginTop: 2 }}>
          {cambio != null ? `${cambio >= 0 ? '+' : '−'}${pct(Math.abs(cambio), 0)} · ` : ''}
          {antes ? (antes.startsWith('sobre') || antes.startsWith('sin') ? antes : `antes ${antes}`) : ''}
        </div>
      )}
    </div>
  )
}

function Nota({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 11.5, color: C.gris, margin: '10px 0 0', lineHeight: 1.5 }}>{children}</p>
}

/** Inversión (barras grises) y ventas de publicidad (línea naranja) día a día */
function Grafico({ diario, moneda }: { diario: DatosDelInforme['diario']; moneda: string }) {
  const W = 740
  const H = 150
  const pad = { l: 8, r: 8, t: 10, b: 22 }
  const max = Math.max(1, ...diario.map((x) => Math.max(x.gasto, x.ventas)))
  const ancho = (W - pad.l - pad.r) / diario.length
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max)
  const puntos = diario.map((x, i) => `${pad.l + ancho * i + ancho / 2},${y(x.ventas)}`).join(' ')
  const cada = Math.ceil(diario.length / 8)
  return (
    <figure style={{ margin: '16px 0 0' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Inversión y ventas de publicidad por día">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={pad.l} x2={W - pad.r} y1={y(max * f)} y2={y(max * f)} stroke={C.linea} strokeWidth="1" />
        ))}
        {diario.map((x, i) => (
          <rect key={x.fecha} x={pad.l + ancho * i + ancho * 0.2} width={ancho * 0.6} y={y(x.gasto)} height={Math.max(0, H - pad.b - y(x.gasto))} fill="#9C9289" opacity="0.55" />
        ))}
        <polyline points={puntos} fill="none" stroke={C.naranja} strokeWidth="2.2" strokeLinejoin="round" />
        {diario.map((x, i) =>
          i % cada === 0 ? (
            <text key={`t${x.fecha}`} x={pad.l + ancho * i + ancho / 2} y={H - 6} fontSize="10" textAnchor="middle" fill={C.gris} fontFamily={CUERPO}>
              {new Date(`${x.fecha}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })}
            </text>
          ) : null
        )}
      </svg>
      <figcaption style={{ fontSize: 11, color: C.gris, display: 'flex', gap: 14 }}>
        <span>
          <span style={{ display: 'inline-block', width: 10, height: 10, background: '#9C9289', opacity: 0.55, marginRight: 5 }} />
          Inversión diaria
        </span>
        <span>
          <span style={{ display: 'inline-block', width: 14, height: 2, background: C.naranja, marginRight: 5, verticalAlign: 'middle' }} />
          Ventas de publicidad
        </span>
        <span>Máximo del gráfico: {dinero(max, moneda)}</span>
      </figcaption>
    </figure>
  )
}
