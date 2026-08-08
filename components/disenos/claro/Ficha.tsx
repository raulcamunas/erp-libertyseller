'use client'

/**
 * LA FICHA: la memoria de la propuesta, pintada desde memoria.ts.
 *
 * Va dentro de la app a propósito. Una propuesta de diseño que solo se puede
 * juzgar mirando capturas se juzga por la primera impresión; con los ratios y
 * las filas por pantalla delante, se juzga por lo que va a costar trabajar ahí
 * dentro ocho horas.
 */

import { Check, Minus, X } from 'lucide-react'
import {
  APPS_VISIBLES, CONTRASTES, CONTRASTES_ESTADO, FILAS_COLD_CALLING, GANAS,
  IDEA, NIVELES_TINTA, PALETA, PIERDES, TIPOGRAFIA,
} from './memoria'

export function Ficha() {
  return (
    <main className="lsd-pantalla">
      <div className="lsd-cabecera">
        <div className="lsd-cabecera-txt">
          <h1 className="lsd-titulo">Claro y nítido — la ficha</h1>
          <p className="lsd-cabecera-sub">
            Modo principal: <strong style={{ color: 'var(--lsd-t1)' }}>claro</strong>. El oscuro es
            el alternativo, al revés de hoy.
          </p>
        </div>
      </div>

      <div className="lsd-ficha">
        <p style={{ fontSize: 15, color: 'var(--lsd-t1)', maxWidth: 720, lineHeight: 1.5, margin: 0 }}>
          {IDEA}
        </p>

        {/* ---------------- Densidad ---------------- */}
        <Bloque titulo="Filas de tabla que caben sin scroll — Cold Calling">
          <table>
            <thead>
              <tr>
                <th>Alto de ventana</th>
                <th>Equivale a</th>
                <th style={{ textAlign: 'right' }}>Hoy</th>
                <th style={{ textAlign: 'right' }}>Propuesta</th>
                <th style={{ textAlign: 'right' }}>Diferencia</th>
              </tr>
            </thead>
            <tbody>
              {FILAS_COLD_CALLING.map((f) => (
                <tr key={f.viewport}>
                  <td className="lsd-num">{f.viewport} px</td>
                  <td>{f.equivale || '—'}</td>
                  <td className="lsd-num" style={{ textAlign: 'right' }}>{f.hoy}</td>
                  <td className="lsd-num" style={{ textAlign: 'right', color: 'var(--lsd-t1)', fontWeight: 600 }}>{f.propuesta}</td>
                  <td className="lsd-num lsd-ok-t" style={{ textAlign: 'right' }}>
                    +{f.propuesta - f.hoy} (+{Math.round(((f.propuesta - f.hoy) / f.hoy) * 100)} %)
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lsd-nota">
            Y con el dato a 13 px en vez de a 11-12. La fila baja de 35,5 px a 32 porque los
            controles de la celda dejan de meter cromo propio, y el cromo total baja de 396,5 px a
            213 (245 en un portátil de 1440, donde la barra de filtros pasa a dos líneas: por eso ahí
            se ganan cinco filas y no siete). Medido en navegador contra una réplica del marcado de
            estos mismos componentes.
          </p>
        </Bloque>

        <Bloque titulo="Aplicaciones visibles sin scroll — Inicio">
          <table>
            <thead>
              <tr>
                <th>Alto de ventana</th>
                <th>Equivale a</th>
                <th style={{ textAlign: 'right' }}>Hoy</th>
                <th style={{ textAlign: 'right' }}>Propuesta</th>
              </tr>
            </thead>
            <tbody>
              {APPS_VISIBLES.map((f) => (
                <tr key={f.viewport}>
                  <td className="lsd-num">{f.viewport} px</td>
                  <td>{f.equivale}</td>
                  <td className="lsd-num" style={{ textAlign: 'right' }}>{f.hoy} de 18</td>
                  <td className="lsd-num" style={{ textAlign: 'right', color: 'var(--lsd-t1)', fontWeight: 600 }}>{f.propuesta} de 17</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lsd-nota">
            17 y no 18: «Inicio» se queda solo en el menú. Una tarjeta que lleva a la pantalla en la
            que ya estás es ruido. Los 17 caben siempre, en cualquier pantalla del equipo: el
            lanzador entero mide 525 px contra los 1.408 px de la página de hoy.
          </p>
        </Bloque>

        {/* ---------------- Contraste ---------------- */}
        <Bloque titulo="Contraste medido (WCAG 2.1) — el PEOR caso sobre las cuatro superficies de cada modo">
          <table>
            <thead>
              <tr>
                <th>Combinación</th>
                <th style={{ textAlign: 'right' }}>Claro</th>
                <th style={{ textAlign: 'right' }}>Oscuro</th>
                <th style={{ textAlign: 'right' }}>Hoy, claro</th>
                <th style={{ textAlign: 'right' }}>Hoy, oscuro</th>
              </tr>
            </thead>
            <tbody>
              {CONTRASTES.map((c) => (
                <tr key={c.par}>
                  <td>{c.par}</td>
                  <td style={{ textAlign: 'right' }}><Ratio v={c.claro} u={c.umbral} /></td>
                  <td style={{ textAlign: 'right' }}><Ratio v={c.oscuro} u={c.umbral} /></td>
                  <td style={{ textAlign: 'right' }}>{c.hoyClaro ? <Ratio v={c.hoyClaro} u={c.umbral} /> : '—'}</td>
                  <td style={{ textAlign: 'right' }}>{c.hoyOscuro ? <Ratio v={c.hoyOscuro} u={c.umbral} /> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lsd-nota">
            Umbral 4,5:1: en esta propuesta el texto más grande de una celda son 13 px, así que nada
            de esto califica como «texto grande». Todo lo de arriba pasa en los dos modos. Hoy fallan
            682 usos de <code>text-white/XX</code> en oscuro (el 31 %) y 804 en claro (el 37 %).
          </p>
        </Bloque>

        <Bloque titulo="Los siete estados de Cold Calling">
          <table>
            <thead>
              <tr>
                <th>Estado</th>
                <th style={{ textAlign: 'right' }}>Raíl claro (≥3)</th>
                <th style={{ textAlign: 'right' }}>Texto claro (≥4,5)</th>
                <th style={{ textAlign: 'right' }}>Raíl oscuro (≥3)</th>
                <th style={{ textAlign: 'right' }}>Texto oscuro (≥4,5)</th>
              </tr>
            </thead>
            <tbody>
              {CONTRASTES_ESTADO.map((c) => (
                <tr key={c.estado}>
                  <td>{c.estado}</td>
                  <td style={{ textAlign: 'right' }} title={c.railClaro === null ? 'Este estado no pinta raíl' : undefined}>
                    {c.railClaro === null ? 'sin raíl' : <Ratio v={c.railClaro} u={3} />}
                  </td>
                  <td style={{ textAlign: 'right' }}><Ratio v={c.textoClaro} u={4.5} /></td>
                  <td style={{ textAlign: 'right' }} title={c.railOscuro === null ? 'Este estado no pinta raíl' : undefined}>
                    {c.railOscuro === null ? 'sin raíl' : <Ratio v={c.railOscuro} u={3} />}
                  </td>
                  <td style={{ textAlign: 'right' }}><Ratio v={c.textoOscuro} u={4.5} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lsd-nota">
            En OSCURO el raíl usa el hue crudo del Excel: los seis que se pintan pasan de 3:1, así
            que el código de color aprendido se conserva entero. En CLARO no se puede —el amarillo
            #EAB308 da 1,92:1 sobre papel, el verde 2,28 y el cian 2,43—, así que se baja la
            luminosidad sin mover el tono más de 7°. Es la misma pelea que globals.css ya tiene con
            el ámbar, resuelta para los seis. El raíl se mide contra la FILA SELECCIONADA, que es la
            superficie más oscura sobre la que llega a caer, no contra el lienzo de la página: el
            caso más apretado es «No contesta» en claro, a 3,08:1, un 3 % por encima del suelo.
            «Sin contactar» no pinta raíl a propósito.
          </p>
        </Bloque>

        {/* ---------------- Tipografía ---------------- */}
        <Bloque titulo="La escala tipográfica — cinco tamaños y tres grosores (hoy: 28 tamaños)">
          <table>
            <thead>
              <tr>
                <th>Nivel</th>
                <th style={{ textAlign: 'right' }}>px</th>
                <th style={{ textAlign: 'right' }}>Grosor</th>
                <th>Para qué</th>
                <th>Muestra</th>
              </tr>
            </thead>
            <tbody>
              {TIPOGRAFIA.map((t) => (
                <tr key={t.nombre}>
                  <td>{t.nombre}</td>
                  <td className="lsd-num" style={{ textAlign: 'right' }}>{t.px}</td>
                  <td className="lsd-num" style={{ textAlign: 'right' }}>{t.grosor}</td>
                  <td>{t.para}</td>
                  <td style={{ fontSize: t.px, fontWeight: t.grosor, color: 'var(--lsd-t1)', whiteSpace: 'nowrap' }}>
                    8.431 líneas
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bloque>

        <Bloque titulo="Los niveles de tinta — TRES, no dieciséis">
          <table>
            <thead>
              <tr>
                <th>Nivel</th>
                <th>Claro</th>
                <th>Oscuro</th>
                <th>Para qué</th>
              </tr>
            </thead>
            <tbody>
              {NIVELES_TINTA.map((n) => (
                <tr key={n.nivel}>
                  <td>{n.nivel}</td>
                  <td><Muestra c={n.claro} /><code>{n.claro}</code></td>
                  <td><Muestra c={n.oscuro} /><code>{n.oscuro}</code></td>
                  <td>{n.para}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="lsd-nota">
            No hay un cuarto nivel, y no es un olvido: entre 4,5:1 y 18:1 no caben cuatro grises que
            alguien pueda distinguir de verdad sobre papel. Lo que hoy hace la opacidad número
            catorce, aquí lo hacen el tamaño y el grosor.
          </p>
        </Bloque>

        {/* ---------------- Paleta ---------------- */}
        <Bloque titulo="La paleta">
          <table>
            <thead>
              <tr>
                <th>Token</th>
                <th>Claro</th>
                <th>Oscuro</th>
                <th>Para qué sirve</th>
              </tr>
            </thead>
            <tbody>
              {PALETA.map((p) => (
                <tr key={p.nombre}>
                  <td><code>{p.nombre}</code></td>
                  <td><Muestra c={p.claro} /><code>{p.claro}</code></td>
                  <td><Muestra c={p.oscuro} /><code>{p.oscuro}</code></td>
                  <td>{p.para}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Bloque>

        {/* ---------------- Balance ---------------- */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(330px, 1fr))', gap: 14 }}>
          <Bloque titulo="Qué ganas">
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {GANAS.map((g) => (
                <li key={g} style={{ display: 'flex', gap: 7, fontSize: 'var(--lsd-apoyo)', color: 'var(--lsd-t2)', lineHeight: 1.5 }}>
                  <Check size={13} strokeWidth={2.5} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--lsd-ok)' }} aria-hidden />
                  {g}
                </li>
              ))}
            </ul>
          </Bloque>

          <Bloque titulo="Qué pierdes">
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 7 }}>
              {PIERDES.map((p) => (
                <li key={p} style={{ display: 'flex', gap: 7, fontSize: 'var(--lsd-apoyo)', color: 'var(--lsd-t2)', lineHeight: 1.5 }}>
                  <Minus size={13} strokeWidth={2.5} style={{ flex: '0 0 auto', marginTop: 2, color: 'var(--lsd-error)' }} aria-hidden />
                  {p}
                </li>
              ))}
            </ul>
          </Bloque>
        </div>
      </div>
    </main>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="lsd-caja">
      <div className="lsd-caja-cab">
        <h2 className="lsd-caja-tit">{titulo}</h2>
      </div>
      <div className="lsd-caja-cpo">{children}</div>
    </section>
  )
}

function Ratio({ v, u }: { v: number; u: number }) {
  const pasa = v >= u
  return (
    <span className={`lsd-num ${pasa ? 'lsd-ok-t' : 'lsd-mal-t'}`} style={{ whiteSpace: 'nowrap' }}>
      {pasa ? <Check size={11} strokeWidth={3} style={{ verticalAlign: -1 }} aria-hidden />
            : <X size={11} strokeWidth={3} style={{ verticalAlign: -1 }} aria-hidden />}
      {' '}{v.toFixed(2).replace('.', ',')}
    </span>
  )
}

function Muestra({ c }: { c: string }) {
  return <span className="lsd-muestra" style={{ background: c }} aria-hidden />
}
