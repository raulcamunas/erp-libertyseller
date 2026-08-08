'use client'

import React, { useState } from 'react'
import { AlertTriangle, Check, CircleDashed, Play, Undo2 } from 'lucide-react'
import { COLUMNAS_DETECTADAS, EJECUCIONES, FRENOS, PRUEBA, type Cuenta, type Freno } from './datos'
import { Caja, ESTADO_EJECUCION, Interruptor, SinDato } from './piezas'

/**
 * PANTALLA 3 — la configuración de un perfil de lectura de stock.
 *
 * Es el formulario más denso del ERP —unos 50 campos— y el que más consecuencia
 * tiene: de aquí sale lo que se escribe en el stock y en el precio de la tienda de un
 * cliente. Hoy es también donde caen los peores contrastes medidos: las etiquetas de
 * los campos y las notas que explican qué hace cada uno están a `text-white/35`, que
 * es 3,17:1 en oscuro y 4,05:1 en claro, a 10 px. Es decir: el texto que hace la
 * pantalla usable es el que peor se lee de todo el ERP.
 *
 * Cuatro cosas cambian, y ninguna es de color:
 *
 *  1. LA ETIQUETA Y LA NOTA SUBEN DE NIVEL. Etiqueta a 11 px 600 sobre `fg-2`
 *     (7,78:1 en claro · 7,93:1 en oscuro) y nota a 12 px sobre `fg-3` (5,41 · 5,79).
 *     No es que ahora «pasen»: es que pasan con margen, que es lo que hace falta a la
 *     hora séptima.
 *
 *  2. UN FRENO APAGADO LO DICE. Hoy la diferencia entre «este freno está puesto en el
 *     30 %» y «este freno está apagado» es un marcador de posición gris dentro de una
 *     casilla vacía. Aquí cada freno tiene un interruptor explícito y, apagado, la fila
 *     entera se marca con su icono de aviso y la palabra APAGADO. Es el mismo dato,
 *     dicho de una forma que no se puede pasar por alto de reojo.
 *
 *  3. HAY CONFIRMACIÓN DE GUARDADO. El patrón de «sin botón de guardar» se conserva
 *     —es correcto, y está bien razonado en el código: un formulario de cincuenta
 *     campos con un botón al final es un formulario que se pierde entero cuando
 *     alguien cierra la pestaña a medias—, pero se le añade lo que le faltaba: cada
 *     campo dice «Guardado» al salir, y abajo hay una franja con los últimos cambios y
 *     un deshacer por campo. Guardar sin decirlo es lo mismo que no guardar, desde el
 *     lado de quien teclea.
 *
 *  4. EL ÍNDICE. Cincuenta campos en una columna son cinco pantallas de scroll. Con el
 *     índice a la izquierda se ve la forma entera del perfil de un vistazo y se salta
 *     a «Frenos» sin buscarlo.
 *
 * Y una que NO cambia: `simulacro` sigue en gris y con icono de espera, nunca de visto
 * bueno. Es una decisión de significado que ya está tomada en el ERP y que esta
 * propuesta no toca: es el estado de un cliente que NO está mandando nada.
 */

const SECCIONES = [
  { id: 'perfil', titulo: 'El perfil', hint: 'Qué fichero es y de qué cliente' },
  { id: 'origen', titulo: 'Dónde están los datos', hint: 'Hoja, cabecera y formato' },
  { id: 'columnas', titulo: 'Las columnas', hint: 'Por nombre, nunca por posición' },
  { id: 'frenos', titulo: 'Frenos', hint: 'Si salta uno, no se manda nada' },
  { id: 'envio', titulo: 'Envío automático', hint: 'Nace apagado' },
]

export function PantallaPerfil({ cuenta }: { cuenta: Cuenta }) {
  const [seccion, setSeccion] = useState('frenos')
  const [frenos, setFrenos] = useState<Freno[]>(FRENOS)
  const [activo, setActivo] = useState(true)
  const [envioAuto, setEnvioAuto] = useState(false)
  const [cambios, setCambios] = useState<{ campo: string; de: string; a: string; hora: string }[]>([
    { campo: 'Caída máxima de líneas del fichero', de: '20', a: '25', hora: '09:14' },
  ])

  const apagados = frenos.filter((f) => !f.puesto)

  function anota(campo: string, de: string, a: string) {
    const hora = new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
    setCambios((c) => [{ campo, de, a, hora }, ...c].slice(0, 4))
  }

  return (
    <>
      {/* ---------- Barra de la pantalla ---------- */}
      <div className="ctx-herramientas" style={{ flex: 'none' }}>
        <div className="ctx-cifras">
          <div className="ctx-cifra">
            <span className="ctx-cifra-et">Perfil</span>
            <span className="ctx-cifra-v" style={{ fontSize: 12 }}>
              Stock diario
            </span>
          </div>
          <div className="ctx-cifra">
            <span className="ctx-cifra-et">Origen</span>
            <span className="ctx-cifra-v" style={{ fontSize: 12 }}>
              Google Drive · XLSX
            </span>
          </div>
          <div className="ctx-cifra">
            <span className="ctx-cifra-et">Mapeos</span>
            <span className="ctx-cifra-v">480</span>
            <span className="ctx-cifra-sub">88 sin referencia</span>
          </div>
          <div className="ctx-cifra">
            <span className="ctx-cifra-et">Última lectura</span>
            <span className="ctx-cifra-v" style={{ fontSize: 12, color: 'var(--ctx-aviso)' }}>
              Frenado
            </span>
            <span className="ctx-cifra-sub">hoy 06:20</span>
          </div>
        </div>

        <span className="ctx-crece" />

        {cambios.length > 0 && (
          <span className="ctx-guardado">
            <Check size={13} strokeWidth={2.6} aria-hidden />
            Guardado {cambios[0].hora}
          </span>
        )}

        <button type="button" className="ctx-btn ctx-btn--primario ctx-t">
          <Play size={13} strokeWidth={2.4} aria-hidden />
          Probar con el fichero de hoy
        </button>
      </div>

      {/* ---------- Tres columnas: índice · formulario · lo que pasa ---------- */}
      <div style={{ display: 'flex', gap: 8, flex: 1, minHeight: 0 }}>
        {/* Índice */}
        <nav className="ctx-panel" style={{ width: 178, flex: 'none', padding: 6 }} aria-label="Secciones del perfil">
          <div className="ctx-indice">
            {SECCIONES.map((s) => (
              <button
                key={s.id}
                type="button"
                className="ctx-indice-item ctx-t"
                data-ctx-activo={seccion === s.id ? 'true' : 'false'}
                onClick={() => setSeccion(s.id)}
              >
                <span className="ctx-trunc ctx-crece">{s.titulo}</span>
                {s.id === 'frenos' && apagados.length > 0 && (
                  <AlertTriangle size={12} strokeWidth={2.4} aria-hidden style={{ color: 'var(--ctx-aviso)' }} />
                )}
              </button>
            ))}
          </div>

          <div style={{ borderTop: '1px solid var(--ctx-line)', margin: '8px 0', paddingTop: 8 }}>
            <div className="ctx-xs" style={{ padding: '0 8px 6px' }}>
              ÚLTIMOS CAMBIOS
            </div>
            {cambios.map((c, i) => (
              <div key={i} style={{ padding: '4px 8px' }}>
                <div className="ctx-sm ctx-trunc" style={{ color: 'var(--ctx-fg-2)' }} title={c.campo}>
                  {c.campo}
                </div>
                <div className="ctx-fila-flex" style={{ gap: 4, fontSize: 11, color: 'var(--ctx-fg-3)' }}>
                  <span className="ctx-num" style={{ textDecoration: 'line-through' }}>
                    {c.de || '(vacío)'}
                  </span>
                  <span aria-hidden>→</span>
                  <span className="ctx-num ctx-fg2" style={{ fontWeight: 600 }}>
                    {c.a || '(vacío)'}
                  </span>
                  <button
                    type="button"
                    className="ctx-btn ctx-btn--icono ctx-t"
                    style={{ height: 18, width: 18, border: 0, marginLeft: 'auto' }}
                    title="Deshacer este cambio"
                  >
                    <Undo2 size={11} aria-hidden />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </nav>

        {/* Formulario */}
        <div className="ctx-panel ctx-scroll" style={{ flex: 1, minWidth: 0 }}>
          <div className="ctx-panel-cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 720 }}>
            {seccion === 'perfil' && (
              <Seccion titulo="El perfil" hint="Qué fichero es y de qué cliente">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Campo etiqueta="Nombre" guardado>
                    <input className="ctx-input" defaultValue="Stock diario" onBlur={() => anota('Nombre', 'Stock diario', 'Stock diario')} />
                  </Campo>
                  <Campo etiqueta="Cliente">
                    <input className="ctx-input" value={cuenta.nombre} readOnly style={{ color: 'var(--ctx-fg-3)' }} />
                  </Campo>
                </div>

                <Campo
                  etiqueta="Qué trae este fichero"
                  nota="El volcado principal: referencia, unidades y, si lo trae, precio."
                >
                  <div className="ctx-fila-flex" style={{ gap: 4 }}>
                    <button type="button" className="ctx-chip ctx-t" data-ctx-activo="true" style={{ height: 28 }}>
                      Stock (y precio)
                    </button>
                    <button type="button" className="ctx-chip ctx-t" style={{ height: 28 }}>
                      Códigos de barras
                    </button>
                  </div>
                </Campo>

                <Interruptor
                  on={activo}
                  onChange={setActivo}
                  etiqueta="Perfil activo"
                  nota="Apagado, ni se lee ni se procesa. El historial se conserva."
                />
              </Seccion>
            )}

            {seccion === 'origen' && (
              <Seccion titulo="Dónde están los datos dentro del fichero" hint="Hoja, cabecera y formato">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Campo etiqueta="Hoja (por nombre)" nota="Vacío = se reconoce por las columnas.">
                    <input className="ctx-input" defaultValue="Stock" />
                  </Campo>
                  <Campo etiqueta="Hoja (por posición)" nota="Se usa solo si la de arriba está vacía.">
                    <input className="ctx-input ctx-input--num" placeholder="Vacío" />
                  </Campo>
                  <Campo
                    etiqueta="Fila de la cabecera"
                    nota="Vacío = se busca en las primeras 20 filas la primera con dos celdas llenas."
                  >
                    <input className="ctx-input ctx-input--num" defaultValue="1" />
                  </Campo>
                  <Campo etiqueta="Primera fila de datos">
                    <input className="ctx-input ctx-input--num" defaultValue="2" />
                  </Campo>
                  <Campo etiqueta="Separador del CSV" nota="Solo aplica si el fichero es CSV.">
                    <input className="ctx-input" placeholder="Automático" />
                  </Campo>
                  <Campo
                    etiqueta="Codificación del CSV"
                    nota="Si las tildes salen como símbolos raros en la prueba, es latin1 o windows-1252."
                  >
                    <select className="ctx-input" defaultValue="auto">
                      <option value="auto">Automática (utf-8)</option>
                      <option value="utf-8">utf-8</option>
                      <option value="latin1">latin1</option>
                      <option value="windows-1252">windows-1252</option>
                    </select>
                  </Campo>
                </div>
              </Seccion>
            )}

            {seccion === 'columnas' && (
              <Seccion titulo="Las columnas" hint="Por nombre, nunca por posición">
                <Caja tipo="info">
                  Se aceptan varios nombres separados por comas y no distingue tildes ni mayúsculas.
                  Se coge el primero que aparezca en el fichero.
                </Caja>

                <div className="ctx-tabla-caja" style={{ maxHeight: 210 }}>
                  <table className="ctx-tabla">
                    <thead>
                      <tr>
                        <th style={{ minWidth: 190 }}>Campo</th>
                        <th style={{ minWidth: 240 }}>Nombres que acepta</th>
                        <th style={{ minWidth: 170 }}>Se ha llevado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {COLUMNAS_DETECTADAS.map((c) => {
                        const encontrada = !c.columna.startsWith('—')
                        return (
                          <tr key={c.campo}>
                            <td>
                              {c.campo}
                              {c.obligatorio && (
                                <span style={{ color: 'var(--ctx-marca-texto)', fontWeight: 600 }} title="Obligatorio">
                                  {' '}
                                  *
                                </span>
                              )}
                            </td>
                            <td className="ctx-fg3">{c.alias}</td>
                            <td>
                              <span className="ctx-fila-flex" style={{ gap: 6 }}>
                                {encontrada ? (
                                  <Check size={12} strokeWidth={2.6} aria-hidden style={{ color: 'var(--ctx-ok)' }} />
                                ) : (
                                  <CircleDashed size={12} strokeWidth={2.4} aria-hidden style={{ color: 'var(--ctx-mute)' }} />
                                )}
                                {/* `ctx-fg3` y no `ctx-mute`: «no encontrada» es
                                    el resultado de la comprobación, o sea el
                                    dato de esta celda. */}
                                <span className={encontrada ? '' : 'ctx-fg3'}>
                                  {encontrada ? c.columna : 'no encontrada'}
                                </span>
                              </span>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </Seccion>
            )}

            {seccion === 'frenos' && (
              <Seccion titulo="Frenos" hint="Si salta uno, no se manda nada">
                <Caja tipo="info">
                  Un fichero mal exportado un martes por la noche{' '}
                  <strong>no puede vaciar el inventario de un cliente quince minutos después</strong> sin
                  que nadie lo vea. Los límites son por cliente: uno con 400 referencias y otro con 40.000
                  no toleran lo mismo.
                </Caja>

                {apagados.length > 0 && (
                  <Caja tipo="aviso">
                    {apagados.length === 1
                      ? 'Hay un freno sin límite puesto, así que está apagado: '
                      : `Hay ${apagados.length} frenos sin límite puesto, así que están apagados: `}
                    <strong>{apagados.map((f) => f.etiqueta.toLowerCase()).join(', ')}</strong>. Con el envío
                    automático encendido, un freno que no se puede comprobar impide mandar.
                  </Caja>
                )}

                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {frenos.map((f) => (
                    <FilaFreno
                      key={f.codigo}
                      freno={f}
                      onCambio={(nuevo) => {
                        anota(f.etiqueta, f.puesto ? f.valor : '(apagado)', nuevo.puesto ? nuevo.valor : '(apagado)')
                        setFrenos((fs) => fs.map((x) => (x.codigo === f.codigo ? nuevo : x)))
                      }}
                    />
                  ))}
                </div>
              </Seccion>
            )}

            {seccion === 'envio' && (
              <Seccion titulo="Envío automático" hint="Nace apagado, y hay que encenderlo a conciencia">
                <Interruptor
                  on={envioAuto}
                  onChange={setEnvioAuto}
                  etiqueta="Enviar solo, sin que nadie mire"
                  nota="Mientras esté apagado, cada ejecución queda en simulacro: se lee, se calcula y se enseña, pero no se escribe nada en Amazon."
                />
                {apagados.length > 0 && (
                  <Caja tipo="error">
                    No se puede encender: quedan <strong>{apagados.length} frenos sin límite</strong>. Un
                    freno que no se puede comprobar no es un freno.
                  </Caja>
                )}
              </Seccion>
            )}
          </div>
        </div>

        {/* Lo que pasa: prueba e historial */}
        <div className="ctx-panel ctx-scroll" style={{ width: 320, flex: 'none' }}>
          <div className="ctx-panel-cab">
            <span className="ctx-lg">Qué entiende con este fichero</span>
          </div>
          <div className="ctx-panel-cuerpo" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="ctx-sm">
              Hoja <strong className="ctx-fg2">Stock</strong> · cabecera en la fila{' '}
              <strong className="ctx-fg2">1</strong> · <strong className="ctx-fg2">392</strong> líneas leídas
            </div>

            <div className="ctx-tabla-caja" style={{ maxHeight: 230, flex: 'none' }}>
              <table className="ctx-tabla">
                <thead>
                  <tr>
                    <th style={{ minWidth: 118 }}>SKU</th>
                    <th data-ctx-num="true" style={{ minWidth: 54 }}>
                      Stock
                    </th>
                    <th data-ctx-num="true" style={{ minWidth: 68 }}>
                      Precio
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {PRUEBA.map((p) => (
                    <tr key={p.sku} title={`${p.descripcion} · ref ${p.referencia}`}>
                      <td className="ctx-num">
                        <span className="ctx-fila-flex" style={{ gap: 5 }}>
                          {p.aviso && (
                            <AlertTriangle
                              size={11}
                              strokeWidth={2.4}
                              aria-label={p.aviso}
                              style={{ color: 'var(--ctx-aviso)', flex: 'none' }}
                            />
                          )}
                          {p.sku}
                        </span>
                      </td>
                      <td data-ctx-num="true" style={p.stock === 0 ? { color: 'var(--ctx-aviso)', fontWeight: 600 } : undefined}>
                        {p.stock}
                      </td>
                      <td data-ctx-num="true">
                        {p.precio == null ? <SinDato /> : `${p.precio.toLocaleString('es-ES', { minimumFractionDigits: 2 })} €`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ctx-xs">ÚLTIMAS EJECUCIONES</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {EJECUCIONES.map((e, i) => {
                const est = ESTADO_EJECUCION[e.estado]
                const Icono = est.icono
                return (
                  <div key={i} className="ctx-fila-flex" style={{ gap: 8, alignItems: 'flex-start' }}>
                    <Icono
                      size={13}
                      strokeWidth={2.4}
                      aria-hidden
                      style={{ color: `var(--ctx-${est.tono})`, flex: 'none', marginTop: 2 }}
                    />
                    <span style={{ minWidth: 0 }}>
                      <span className="ctx-fila-flex" style={{ gap: 6 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: `var(--ctx-${est.tono})` }}>
                          {est.etiqueta}
                        </span>
                        <span className="ctx-sm">{e.fecha}</span>
                        <span className="ctx-sm ctx-num">· {e.lineas} líneas</span>
                      </span>
                      <span className="ctx-sm" style={{ display: 'block' }}>
                        {e.detalle}
                      </span>
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ------------------------------------------------------------------ */

function Seccion({ titulo, hint, children }: { titulo: string; hint: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div>
        <h3 className="ctx-lg">{titulo}</h3>
        <p className="ctx-sm">{hint}</p>
      </div>
      {children}
    </section>
  )
}

function Campo({
  etiqueta,
  nota,
  guardado,
  children,
}: {
  etiqueta: string
  nota?: string
  guardado?: boolean
  children: React.ReactNode
}) {
  return (
    <div className="ctx-campo">
      <label className="ctx-etiqueta">
        {etiqueta}
        {guardado && (
          <span className="ctx-guardado" style={{ fontWeight: 500 }}>
            <Check size={11} strokeWidth={2.6} aria-hidden />
            Guardado
          </span>
        )}
      </label>
      {children}
      {nota && <p className="ctx-nota">{nota}</p>}
    </div>
  )
}

/**
 * La fila de un freno.
 *
 * Aquí está el arreglo que más cambia el trabajo diario de esta pantalla: PUESTO y
 * APAGADO son dos estados distintos y se dicen con tres cosas a la vez —el
 * interruptor, el icono y la palabra—, no con una casilla vacía y un marcador de
 * posición gris. Un freno apagado además se recuadra en ámbar, porque un freno
 * apagado no es una casilla sin rellenar: es un cliente sin protección.
 */
function FilaFreno({ freno, onCambio }: { freno: Freno; onCambio: (f: Freno) => void }) {
  const apagado = !freno.puesto
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 150px',
        gap: 12,
        alignItems: 'start',
        padding: '8px 10px',
        borderRadius: 'var(--ctx-r-control)',
        border: '1px solid',
        borderColor: apagado ? 'var(--ctx-aviso-line)' : 'var(--ctx-line)',
        background: apagado ? 'var(--ctx-aviso-bg)' : 'transparent',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div className="ctx-etiqueta" style={{ marginBottom: 2 }}>
          {freno.etiqueta}
          {/* 12 px y en caja baja, no 10 px en versales. Esta palabra decide si a
              un cliente se le vacía el inventario, y estaba escrita con la letra
              más pequeña de la pantalla y en el formato más lento de leer. El
              contraste ya era correcto (5,23 claro / 9,46 oscuro sobre su tinte):
              el problema era el tamaño. Cuesta 2 px de alto por freno. */}
          {apagado ? (
            <span className="ctx-fila-flex" style={{ gap: 4, color: 'var(--ctx-aviso)', fontWeight: 700, fontSize: 12 }}>
              <AlertTriangle size={12} strokeWidth={2.6} aria-hidden />
              Apagado
            </span>
          ) : (
            <span className="ctx-fila-flex" style={{ gap: 4, color: 'var(--ctx-ok)', fontWeight: 700, fontSize: 12 }}>
              <Check size={12} strokeWidth={2.6} aria-hidden />
              Puesto
            </span>
          )}
        </div>
        {freno.nota && <p className="ctx-nota">{freno.nota}</p>}
      </div>

      <div className="ctx-fila-flex" style={{ gap: 8, justifyContent: 'flex-end' }}>
        <input
          className="ctx-input ctx-input--num"
          style={{ width: 74, opacity: apagado ? 0.5 : 1 }}
          value={freno.valor}
          disabled={apagado}
          placeholder="—"
          onChange={(e) => onCambio({ ...freno, valor: e.target.value })}
        />
        <span className="ctx-sm" style={{ width: 44, flex: 'none' }}>
          {freno.unidad}
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={freno.puesto}
          aria-label={`${freno.etiqueta}: ${freno.puesto ? 'puesto' : 'apagado'}`}
          onClick={() => onCambio({ ...freno, puesto: !freno.puesto, valor: freno.puesto ? '' : freno.valor || '10' })}
          className="ctx-t"
        >
          <span className="ctx-switch ctx-t" data-ctx-on={freno.puesto ? 'true' : 'false'} aria-hidden />
        </button>
      </div>
    </div>
  )
}
