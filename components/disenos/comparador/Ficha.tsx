'use client'

import { useState } from 'react'
import { AlertTriangle, Check, Layers, Ruler, X } from 'lucide-react'
import type { Modo, Propuesta } from './propuestas'

/**
 * LA FICHA. Es lo que separa esto de un concurso de belleza.
 *
 * Al lado de cada maqueta van los números con los que se decide: la idea en una
 * frase, la escala tipográfica, la paleta, los contrastes MEDIDOS, las filas que
 * caben por pantalla, qué se gana, qué se pierde y qué costaría adoptarla.
 *
 * Todo sale de la memoria de cada propuesta (`propuestas.ts` solo las
 * normaliza), incluido «cómo se midió»: tres personas midieron de tres maneras
 * distintas y eso hay que poder leerlo antes de comparar dos cifras.
 */

type Pestana = 'idea' | 'letra' | 'contraste' | 'densidad' | 'balance' | 'adoptar'

const PESTANAS: { id: Pestana; nombre: string }[] = [
  { id: 'idea', nombre: 'La idea' },
  { id: 'letra', nombre: 'Letra y color' },
  { id: 'contraste', nombre: 'Contraste' },
  { id: 'densidad', nombre: 'Densidad' },
  { id: 'balance', nombre: 'Gana / pierde' },
  { id: 'adoptar', nombre: 'Adoptarla' },
]

function ratio(v: number): string {
  return `${v.toFixed(2).replace('.', ',')}:1`
}

/** Un ratio no se dice solo con color: lleva icono y, si falla, palabra. */
function Ratio({ valor, umbral }: { valor: number; umbral: number }) {
  const ok = valor >= umbral
  return (
    <span className="cmp-ratio" data-ok={ok ? 'si' : 'no'} title={`Umbral ${umbral.toString().replace('.', ',')}:1`}>
      {ok ? <Check aria-hidden /> : <X aria-hidden />}
      {ratio(valor)}
    </span>
  )
}

function Bloque({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="cmp-bloque">
      <h4 className="cmp-bloque-tit">{titulo}</h4>
      {children}
    </section>
  )
}

export function Ficha({ propuesta, modo }: { propuesta: Propuesta; modo: Modo }) {
  const [pestana, setPestana] = useState<Pestana>('idea')
  const esHoy = propuesta.id === 'hoy'

  return (
    <aside className="cmp-ficha" aria-label={`Ficha de ${propuesta.nombre}`}>
      <div className="cmp-ficha-cab">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
          <h3 className="cmp-h2">{propuesta.nombre}</h3>
          <span className="cmp-s">
            modo principal: <strong>{propuesta.modoPrincipal}</strong>
          </span>
        </div>
        <p className="cmp-p" style={{ marginTop: 6 }}>
          {propuesta.idea}
        </p>
      </div>

      <div className="cmp-pestanas" role="tablist">
        {PESTANAS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="tab"
            aria-selected={pestana === p.id}
            className="cmp-pestana"
            data-on={pestana === p.id ? '1' : undefined}
            onClick={() => setPestana(p.id)}
          >
            {p.nombre}
          </button>
        ))}
      </div>

      <div className="cmp-ficha-cuerpo">
        {pestana === 'idea' && (
          <>
            <Bloque titulo={esHoy ? 'Por qué el oscuro es el que está diseñado' : 'Por qué ese modo principal'}>
              <ul className="cmp-lista">
                {propuesta.porQueEseModo.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Bloque>

            <Bloque titulo="El acento: dónde sí">
              <ul className="cmp-lista" data-tono="bien">
                {propuesta.acento.si.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Bloque>

            <Bloque titulo="El acento: dónde no">
              <ul className="cmp-lista" data-tono="mal">
                {propuesta.acento.no.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Bloque>

            <Bloque titulo="En una línea">
              <p className="cmp-s">{propuesta.acento.resumen}</p>
            </Bloque>
          </>
        )}

        {pestana === 'letra' && (
          <>
            <Bloque titulo={`Escala tipográfica · ${propuesta.tamanosDeLetra} tamaños`}>
              <div>
                {propuesta.tipografia.map((n) => (
                  <div key={n.nombre} className="cmp-tipo">
                    <span className="cmp-tipo-px">
                      {n.px} px
                      <br />
                      {n.grosor}
                    </span>
                    <span
                      className="cmp-tipo-muestra"
                      style={{ fontSize: Math.min(n.px, 22), fontWeight: n.grosor }}
                    >
                      {n.nombre}
                    </span>
                    <span className="cmp-tipo-para">{n.para}</span>
                  </div>
                ))}
              </div>
              <p className="cmp-s">{propuesta.tipografiaNota}</p>
            </Bloque>

            <Bloque titulo={`Paleta · ${modo === 'claro' ? 'valores del modo claro' : 'valores del modo oscuro'}`}>
              <div className="cmp-colores">
                {propuesta.paleta.map((t) => {
                  const hex = modo === 'claro' ? t.claro : t.oscuro
                  return (
                    <div key={t.rol} className="cmp-color" title={t.para}>
                      <span
                        className="cmp-muestra"
                        style={{ background: hex.startsWith('#') || hex.startsWith('rgb') ? hex : 'transparent' }}
                        aria-hidden
                      />
                      <span className="cmp-color-rol">{t.rol}</span>
                      <span className="cmp-color-hex">{hex}</span>
                    </div>
                  )
                })}
              </div>
              <p className="cmp-s">
                Pasa el ratón por encima de un color para leer para qué sirve. La muestra está pintada
                con el valor real, no con una aproximación.
              </p>
            </Bloque>
          </>
        )}

        {pestana === 'contraste' && (
          <>
            <Bloque titulo="Contrastes medidos">
              <table className="cmp-tabla">
                <thead>
                  <tr>
                    <th>Par</th>
                    <th style={{ textAlign: 'right' }}>Claro</th>
                    <th style={{ textAlign: 'right' }}>Oscuro</th>
                  </tr>
                </thead>
                <tbody>
                  {propuesta.contrastes.map((c, i) => (
                    <tr key={c.par} data-zebra={i % 2 === 1 ? 'si' : undefined}>
                      <td>
                        {c.par}
                        {c.donde && (
                          <>
                            <br />
                            <span className="cmp-s">{c.donde}</span>
                          </>
                        )}
                        {(c.hoyClaro != null || c.hoyOscuro != null) && (
                          <>
                            <br />
                            <span className="cmp-s">
                              hoy: {c.hoyClaro != null ? ratio(c.hoyClaro) : '—'} claro ·{' '}
                              {c.hoyOscuro != null ? ratio(c.hoyOscuro) : '—'} oscuro
                            </span>
                          </>
                        )}
                      </td>
                      <td className="cmp-cifra">
                        <Ratio valor={c.claro} umbral={c.umbral} />
                      </td>
                      <td className="cmp-cifra">
                        <Ratio valor={c.oscuro} umbral={c.umbral} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloque>

            <Bloque titulo="El peor par de texto de toda la propuesta">
              <div style={{ display: 'flex', gap: 16 }}>
                <div>
                  <div className="cmp-s">Claro</div>
                  <Ratio valor={propuesta.contrasteMinimo.claro} umbral={4.5} />
                </div>
                <div>
                  <div className="cmp-s">Oscuro</div>
                  <Ratio valor={propuesta.contrasteMinimo.oscuro} umbral={4.5} />
                </div>
                <div>
                  <div className="cmp-s">Niveles de texto</div>
                  <span className="cmp-num cmp-t1" style={{ fontWeight: 600 }}>
                    {propuesta.nivelesDeTexto}
                  </span>
                </div>
              </div>
            </Bloque>

            <Bloque titulo="Cómo se midió">
              <p className="cmp-s">{propuesta.comoSeMidio}</p>
            </Bloque>
          </>
        )}

        {pestana === 'densidad' && (
          <>
            <Bloque titulo="Filas visibles sin scroll · Cold Calling">
              <table className="cmp-tabla">
                <thead>
                  <tr>
                    <th>Alto de ventana</th>
                    <th style={{ textAlign: 'right' }}>Hoy</th>
                    <th style={{ textAlign: 'right' }}>{esHoy ? 'Igual' : 'Con esta'}</th>
                  </tr>
                </thead>
                <tbody>
                  {propuesta.densidad.map((d, i) => (
                    <tr key={d.viewport} data-zebra={i % 2 === 1 ? 'si' : undefined}>
                      <td>
                        <span className="cmp-num cmp-t1">{d.viewport} px</span>
                        <br />
                        <span className="cmp-s">{d.contexto}</span>
                      </td>
                      <td className="cmp-cifra cmp-t3">{d.hoy}</td>
                      <td className="cmp-cifra">
                        <strong>{d.propuesta}</strong>
                        {!esHoy && d.propuesta > d.hoy && (
                          <span className="cmp-s"> +{Math.round(((d.propuesta - d.hoy) / d.hoy) * 100)} %</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Bloque>

            <Bloque titulo="De dónde salen esas filas">
              <table className="cmp-tabla">
                <tbody>
                  <tr>
                    <td>
                      <Ruler style={{ width: 13, height: 13, verticalAlign: '-2px' }} aria-hidden /> Altura de
                      fila
                    </td>
                    <td className="cmp-cifra cmp-t3">{propuesta.alturaFila.hoy.toString().replace('.', ',')} px</td>
                    <td className="cmp-cifra">
                      <strong>{propuesta.alturaFila.propuesta.toString().replace('.', ',')} px</strong>
                    </td>
                  </tr>
                  <tr data-zebra="si">
                    <td>
                      <Layers style={{ width: 13, height: 13, verticalAlign: '-2px' }} aria-hidden /> Cromo sobre
                      la tabla
                    </td>
                    <td className="cmp-cifra cmp-t3">{propuesta.cromo.hoy.toString().replace('.', ',')} px</td>
                    <td className="cmp-cifra">
                      <strong>{propuesta.cromo.propuesta.toString().replace('.', ',')} px</strong>
                    </td>
                  </tr>
                </tbody>
              </table>
              <p className="cmp-s">
                El cromo son los píxeles que hay por encima de la primera fila y que nunca son un dato:
                el título de la pantalla, los indicadores, las filas de filtros y el pie. Hoy son 396,5
                px en Cold Calling y 525 en el catálogo de Amazon.
              </p>
            </Bloque>
          </>
        )}

        {pestana === 'balance' && (
          <>
            <Bloque titulo={esHoy ? 'Lo que funciona hoy y no hay que perder' : 'Qué se gana'}>
              <ul className="cmp-lista" data-tono="bien">
                {propuesta.ganas.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Bloque>

            <Bloque titulo={esHoy ? 'Lo que falla, medido' : 'Qué se pierde'}>
              <ul className="cmp-lista" data-tono="mal">
                {propuesta.pierdes.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </Bloque>
          </>
        )}

        {pestana === 'adoptar' && (
          <>
            {esHoy ? (
              <Bloque titulo="Adoptarla">
                <p className="cmp-p">
                  No hay nada que adoptar: es lo que ya está desplegado. Esta columna existe para tener
                  contra qué comparar.
                </p>
              </Bloque>
            ) : (
              <>
                <Bloque titulo="Qué ficheros se tocarían">
                  <table className="cmp-tabla">
                    <tbody>
                      {propuesta.adopcion.ficheros.map((f, i) => (
                        <tr key={f.que} data-zebra={i % 2 === 1 ? 'si' : undefined}>
                          <td>{f.que}</td>
                          <td className="cmp-cifra">{f.cuantos}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Bloque>

                <Bloque titulo={propuesta.adopcion.porPartes ? 'Sí se puede hacer por partes' : 'Por partes'}>
                  <ol className="cmp-pasos">
                    {propuesta.adopcion.pasos.map((p) => (
                      <li key={p.titulo}>
                        <strong>{p.titulo}</strong>
                        <span>{p.que}</span>
                      </li>
                    ))}
                  </ol>
                </Bloque>

                {propuesta.adopcion.aviso && (
                  <div className="cmp-aviso">
                    <AlertTriangle aria-hidden />
                    <p className="cmp-s">{propuesta.adopcion.aviso}</p>
                  </div>
                )}

                <Bloque titulo="De dónde sale este apartado">
                  <p className="cmp-s">{propuesta.adopcion.fuente}</p>
                </Bloque>
              </>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
