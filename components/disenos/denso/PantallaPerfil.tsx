'use client'

import { useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CircleSlash,
  FlaskConical,
  Info,
  Play,
} from 'lucide-react'
import { BarraLateral, BarraSuperior, Estado, Pildora } from './Marco'
import { COLUMNAS, EJECUCIONES, FRENOS, HISTORIAL, PRUEBA } from './datos'

/* ------------------------------------------------------------------ */
/* Piezas del formulario                                               */
/* ------------------------------------------------------------------ */

/**
 * Un campo que se guarda al salir de él.
 *
 * El patrón «sin botón de guardar» del ERP es correcto y se conserva: un
 * formulario de cincuenta campos con un botón al final es un formulario que se
 * pierde entero cuando alguien cierra la pestaña a medias.
 *
 * Lo que le faltaba era la otra mitad: si no hay botón que pulsar, tampoco hay
 * nada que confirme que lo tecleado ha quedado escrito. Aquí, al salir del
 * campo, aparece «Guardado» durante dos segundos en el sitio de la nota —no
 * encima de ella, para que el texto no salte— y el borde parpadea. Es la señal
 * que hoy no existe en ninguna de las dos pantallas de guardado automático.
 */
function Campo({
  etiqueta,
  nota,
  valor,
  marcador,
  sufijo,
  numerico,
  obligatorio,
}: {
  etiqueta: string
  nota?: string
  valor?: string
  marcador?: string
  sufijo?: string
  numerico?: boolean
  obligatorio?: boolean
}) {
  const [v, setV] = useState(valor ?? '')
  const [guardado, setGuardado] = useState(false)
  const inicial = useRef(valor ?? '')
  const reloj = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (reloj.current) clearTimeout(reloj.current) }, [])

  return (
    <div className="dz-campo">
      <label className="dz-label">
        {etiqueta}
        {obligatorio && (
          <span style={{ color: 'var(--dz-acc)' }} title="Obligatorio">
            {' '}
            *
          </span>
        )}
      </label>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          className={`dz-input${numerico ? ' dz-input--num' : ''}`}
          value={v}
          placeholder={marcador}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            if (v === inicial.current) return
            inicial.current = v
            setGuardado(true)
            if (reloj.current) clearTimeout(reloj.current)
            reloj.current = setTimeout(() => setGuardado(false), 2000)
          }}
          style={guardado ? { borderColor: 'var(--dz-e-verde)' } : undefined}
        />
        {sufijo && (
          <span className="dz-xs dz-t4" style={{ flex: '0 0 auto' }}>
            {sufijo}
          </span>
        )}
      </div>
      <div className="dz-nota" style={{ minHeight: 17 }}>
        {guardado ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              color: 'var(--dz-e-verde)',
            }}
          >
            <Check aria-hidden style={{ width: 11, height: 11, strokeWidth: 3 }} />
            Guardado
          </span>
        ) : (
          nota
        )}
      </div>
    </div>
  )
}

function Seccion({
  titulo,
  pista,
  id,
  children,
  extra,
}: {
  titulo: string
  pista?: string
  id: string
  children: React.ReactNode
  extra?: React.ReactNode
}) {
  return (
    <section className="dz-panel" id={id} style={{ scrollMarginTop: 8 }}>
      <div className="dz-panel-cab">
        <span className="dz-l">{titulo}</span>
        {pista && <span className="dz-s dz-t3">{pista}</span>}
        <span className="dz-crece" />
        {extra}
      </div>
      <div className="dz-panel-cuerpo" style={{ display: 'grid', gap: 9 }}>
        {children}
      </div>
    </section>
  )
}

const SECCIONES = [
  { id: 'sec-perfil', nombre: 'El perfil' },
  { id: 'sec-origen', nombre: 'De dónde sale' },
  { id: 'sec-formato', nombre: 'Dónde están los datos' },
  { id: 'sec-columnas', nombre: 'Las columnas' },
  { id: 'sec-frenos', nombre: 'Frenos' },
  { id: 'sec-envio', nombre: 'Envío automático' },
]

/* ------------------------------------------------------------------ */

export function PantallaPerfil() {
  const [seccion, setSeccion] = useState('sec-perfil')
  const [activo, setActivo] = useState(true)
  const [tipo, setTipo] = useState<'stock' | 'barras'>('stock')
  const frenosApagados = FRENOS.filter((f) => !f.puesto)

  return (
    <div className="dz-app">
      <BarraLateral activo="amazon-api" />

      <div className="dz-main">
        <BarraSuperior titulo="Amazon API" contexto="Shoplamp · Perfil de lectura de stock">
          <span
            className="dz-s dz-t3"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
            title="Cada campo se guarda al salir de él"
          >
            <Check
              aria-hidden
              style={{ width: 12, height: 12, color: 'var(--dz-e-verde)', strokeWidth: 3 }}
            />
            Todo guardado
          </span>
          <span className="dz-sep" aria-hidden />
          <button type="button" className="dz-btn">
            <FlaskConical aria-hidden />
            Simulacro
          </button>
          <button type="button" className="dz-btn dz-btn--pri">
            <Play aria-hidden />
            Probar
          </button>
        </BarraSuperior>

        <div className="dz-cuerpo" style={{ flexDirection: 'row', gap: 10 }}>
          {/* ---------- Índice ---------- */}
          <nav style={{ width: 136, flex: '0 0 136px' }} aria-label="Secciones">
            {SECCIONES.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="dz-nav"
                data-on={seccion === s.id ? '1' : undefined}
                onClick={() => setSeccion(s.id)}
                style={{ textDecoration: 'none' }}
              >
                <span className="dz-crece">{s.nombre}</span>
                {s.id === 'sec-frenos' && frenosApagados.length > 0 && (
                  <AlertTriangle
                    aria-hidden
                    style={{ width: 12, height: 12, color: 'var(--dz-e-ama)' }}
                  />
                )}
              </a>
            ))}
          </nav>

          {/* ---------- El formulario ---------- */}
          <div
            className="dz-crece dz-scroll"
            style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
          >
            <Seccion
              id="sec-perfil"
              titulo="El perfil"
              pista="Qué fichero es y de qué cliente"
              extra={
                <button
                  type="button"
                  className="dz-sw"
                  data-on={activo ? '1' : undefined}
                  onClick={() => setActivo((a) => !a)}
                  aria-pressed={activo}
                >
                  <i aria-hidden />
                  {/* La palabra va SIEMPRE, no solo la posición del interruptor */}
                  <span>{activo ? 'Perfil activo' : 'Perfil apagado'}</span>
                </button>
              }
            >
              <div className="dz-rejilla">
                <Campo etiqueta="Nombre" valor="Shoplamp · stock diario" />
                <div className="dz-campo">
                  <span className="dz-label">Qué trae este fichero</span>
                  <div className="dz-ops">
                    <button
                      type="button"
                      data-on={tipo === 'stock' ? '1' : undefined}
                      onClick={() => setTipo('stock')}
                    >
                      Stock (y precio)
                    </button>
                    <button
                      type="button"
                      data-on={tipo === 'barras' ? '1' : undefined}
                      onClick={() => setTipo('barras')}
                    >
                      Códigos de barras
                    </button>
                  </div>
                  <div className="dz-nota">
                    Apagado, ni se lee ni se procesa. El historial se conserva.
                  </div>
                </div>
                <Campo
                  etiqueta="Conexión de Amazon"
                  valor="Shoplamp · ES"
                  nota="El puente entre el ERP del cliente y su tienda."
                />
                <Campo etiqueta="Moneda" valor="EUR" nota="La del mercado, no la del ERP." />
              </div>
            </Seccion>

            <Seccion id="sec-origen" titulo="De dónde sale el fichero" pista="El conector">
              <div className="dz-aviso" style={{ ['--dz-c' as string]: 'var(--dz-t3)' }}>
                <Info aria-hidden />
                <span>
                  Google Drive. El fichero tiene que estar compartido con la cuenta de servicio:
                  <br />
                  <b>erp-stock@liberty-seller.iam.gserviceaccount.com</b>
                </span>
              </div>
              <div className="dz-rejilla">
                <Campo etiqueta="Carpeta" valor="Clientes / Shoplamp / Stock" />
                <Campo etiqueta="Patrón del nombre" valor="stock_*.xlsx" nota="Se coge el más reciente." />
              </div>
            </Seccion>

            <Seccion
              id="sec-formato"
              titulo="Dónde están los datos dentro del fichero"
              pista="Hoja, cabecera y formato"
            >
              <div className="dz-rejilla">
                <Campo etiqueta="Hoja (por nombre)" valor="Stock" marcador="Vacío = la primera" />
                <Campo
                  etiqueta="Hoja (por posición)"
                  marcador="Vacío = no se usa"
                  numerico
                  nota="Solo si el nombre de la hoja cambia cada día."
                />
                <Campo
                  etiqueta="Fila de la cabecera"
                  valor="1"
                  numerico
                  nota="Vacío = se busca en las primeras 20 filas la primera con dos celdas llenas."
                />
                <Campo etiqueta="Primera fila de datos" valor="2" numerico />
                <Campo
                  etiqueta="Separador del CSV"
                  valor=";"
                  nota="Solo para CSV. Normalmente «;» en los ficheros españoles."
                />
                <Campo
                  etiqueta="Codificación del CSV"
                  valor="Automática (utf-8)"
                  nota="Si las tildes salen como símbolos raros en la prueba, es latin1 o windows-1252."
                />
              </div>
            </Seccion>

            <Seccion
              id="sec-columnas"
              titulo="Las columnas"
              pista="Por nombre, nunca por posición"
              extra={<span className="dz-s dz-t3">última prueba: hace 6 min</span>}
            >
              <div className="dz-aviso" style={{ ['--dz-c' as string]: 'var(--dz-t3)' }}>
                <Info aria-hidden />
                <span>
                  Se aceptan varios nombres separados por comas. No distingue tildes ni mayúsculas.
                </span>
              </div>
              {/*
                Lo que la prueba ha ENTENDIDO, al lado de lo que has escrito.
                Hoy eso vive en otro sitio de la pantalla y hay que ir a
                buscarlo; aquí cada campo dice qué columna real del fichero se
                ha llevado, con la flecha, o «ninguna» con su glifo.
              */}
              <div className="dz-rejilla">
                {COLUMNAS.map((c) => (
                  <div key={c.etiqueta} className="dz-campo">
                    <label className="dz-label">
                      {c.etiqueta}
                      {c.obligatoria && <span style={{ color: 'var(--dz-acc)' }}> *</span>}
                    </label>
                    <input className="dz-input" defaultValue={c.valor} placeholder="Sin configurar" />
                    <div className="dz-nota" style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
                      {c.resuelta ? (
                        <>
                          <ArrowRight
                            aria-hidden
                            style={{ width: 11, height: 11, color: 'var(--dz-e-verde)' }}
                          />
                          <span className="dz-num" style={{ color: 'var(--dz-t2)' }}>
                            {c.resuelta}
                          </span>
                        </>
                      ) : c.obligatoria ? (
                        <>
                          <AlertTriangle
                            aria-hidden
                            style={{ width: 11, height: 11, color: 'var(--dz-e-ama)' }}
                          />
                          <span>Ninguna columna del fichero encaja</span>
                        </>
                      ) : (
                        <>
                          <CircleSlash
                            aria-hidden
                            style={{ width: 11, height: 11, color: 'var(--dz-t4)' }}
                          />
                          <span>Sin usar — {c.nota}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Seccion>

            {/* ---------------- FRENOS ---------------- */}
            <Seccion
              id="sec-frenos"
              titulo="Frenos"
              pista="Si salta uno, no se manda nada"
              extra={
                <span className="dz-s dz-num dz-t3">
                  {FRENOS.length - frenosApagados.length} de {FRENOS.length} puestos
                </span>
              }
            >
              <div className="dz-aviso" style={{ ['--dz-c' as string]: 'var(--dz-t3)' }}>
                <Info aria-hidden />
                <span>
                  Un fichero mal exportado un martes por la noche{' '}
                  <b>no puede vaciar el inventario de un cliente quince minutos después</b> sin que
                  nadie lo vea. Los límites son por cliente: uno con 400 referencias y otro con
                  40.000 no toleran lo mismo.
                </span>
              </div>

              {frenosApagados.length > 0 && (
                <div className="dz-aviso" data-tipo="aviso" style={{ ['--dz-c' as string]: 'var(--dz-e-ama)' }}>
                  <AlertTriangle aria-hidden />
                  <span>
                    Hay <b>{frenosApagados.length} frenos sin límite puesto, así que están apagados</b>:{' '}
                    {frenosApagados.map((f) => f.etiqueta.toLowerCase()).join(', ')}. Con el envío
                    automático encendido, un freno que no se puede comprobar impide mandar.
                  </span>
                </div>
              )}

              <div className="dz-rejilla">
                {FRENOS.map((f) => (
                  <div key={f.etiqueta} className="dz-campo">
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        marginBottom: 3,
                        minWidth: 0,
                      }}
                    >
                      <span className="dz-label" style={{ margin: 0, minWidth: 0 }}>
                        {f.etiqueta}
                      </span>
                      <span className="dz-crece" />
                      {/*
                        LA DIFERENCIA ENTRE PUESTO Y APAGADO, CON TODAS LAS
                        LETRAS. Hoy un freno apagado se distingue de uno puesto
                        únicamente porque la casilla está vacía y el marcador de
                        posición gris dice «Vacío = no se evalúa» — a 3,17:1. Un
                        freno sin umbral es un freno que no protege nada, y eso
                        merece una etiqueta, no la ausencia de una.
                      */}
                      {f.puesto ? (
                        <Pildora
                          icono={Check}
                          color="var(--dz-e-verde)"
                          texto="Puesto"
                          titulo="Este freno se evalúa en cada ejecución"
                        />
                      ) : (
                        <Pildora
                          icono={CircleSlash}
                          color="var(--dz-e-ama)"
                          texto="Apagado"
                          titulo="Sin límite: este freno no se evalúa"
                        />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <input
                        className="dz-input dz-input--num"
                        defaultValue={f.valor}
                        placeholder="Sin límite"
                      />
                      <span className="dz-xs dz-t4" style={{ flex: '0 0 auto', minWidth: 34 }}>
                        {f.unidad}
                      </span>
                    </div>
                    <div className="dz-nota">{f.nota}</div>
                  </div>
                ))}
              </div>
            </Seccion>

            <Seccion
              id="sec-envio"
              titulo="Envío automático"
              pista="Nace apagado, y hay que encenderlo a conciencia"
            >
              <div className="dz-aviso" data-tipo="aviso" style={{ ['--dz-c' as string]: 'var(--dz-e-ama)' }}>
                <AlertTriangle aria-hidden />
                <span>
                  No se puede encender hasta que estén los cinco frenos y las líneas de referencia.
                  Faltan {frenosApagados.length}.
                </span>
              </div>
              <div className="dz-rejilla">
                <Campo
                  etiqueta="Cada cuántos minutos se mira el origen"
                  valor="15"
                  numerico
                  sufijo="min"
                  nota="Mínimo 5. El ciclo que ya existe va cada 15."
                />
              </div>
            </Seccion>
          </div>

          {/* ---------- Historial y prueba ---------- */}
          <div
            style={{
              width: 320,
              flex: '0 0 320px',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              minHeight: 0,
            }}
          >
            <section className="dz-panel" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="dz-panel-cab">
                <span className="dz-l">Últimas ejecuciones</span>
              </div>
              <div className="dz-scroll">
                <table className="dz-tabla" style={{ width: '100%' }}>
                  <tbody>
                    {HISTORIAL.map((h, i) => {
                      const e = EJECUCIONES[h.estado]
                      return (
                        <tr key={i}>
                          <td style={{ paddingRight: 0 }}>
                            {/*
                              `simulacro` y `sin_cambios` comparten color a
                              propósito —el gris de «esto NO ha mandado nada»— y
                              por eso NO comparten glifo: matraz contra raya. Es
                              justo el caso que pide el criterio 5: cuando el
                              color es idéntico, la forma es lo único que queda.
                            */}
                            <Estado
                              icono={e.icono}
                              color={e.varColor}
                              texto={e.etiqueta}
                              titulo={e.pista}
                              fuerte
                            />
                          </td>
                          <td className="dz-der dz-num dz-t4" style={{ fontSize: 11 }}>
                            {h.cuando}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <div
                style={{
                  borderTop: '1px solid var(--dz-linea)',
                  padding: '6px 10px',
                }}
              >
                <div className="dz-s">
                  <b style={{ color: 'var(--dz-t1)', fontWeight: 600 }}>Última: frenado.</b>{' '}
                  {HISTORIAL[0].detalle}.
                </div>
              </div>
            </section>

            <section className="dz-panel dz-crece" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              <div className="dz-panel-cab">
                <span className="dz-l">Probar</span>
                <span className="dz-s dz-t3">6 de 480 líneas</span>
              </div>
              <div className="dz-tablabox" style={{ border: 'none', borderRadius: 0 }}>
                <table className="dz-tabla">
                  {/*
                    Las dos identidades juntas y primero: la referencia del ERP
                    del cliente y el SKU de Amazon que se ha llevado. Es lo que
                    se compara celda a celda contra el Excel del cliente, y la
                    descripción —que es la columna larga— se va al final, donde
                    puede quedarse cortada sin que estorbe.
                  */}
                  <thead>
                    <tr>
                      <th style={{ minWidth: 64 }}>Ref.</th>
                      <th style={{ minWidth: 100 }}>SKU en Amazon</th>
                      <th className="dz-der" style={{ minWidth: 50 }}>
                        Stock
                      </th>
                      <th className="dz-der" style={{ minWidth: 66 }}>
                        Precio
                      </th>
                      <th style={{ minWidth: 170 }}>Descripción</th>
                    </tr>
                  </thead>
                  <tbody>
                    {PRUEBA.map((p) => (
                      <tr key={p.ref}>
                        <td className="dz-num" style={{ color: 'var(--dz-t1)' }}>
                          {p.ref}
                        </td>
                        <td className="dz-num dz-t2">{p.sku}</td>
                        <td
                          className="dz-der dz-num"
                          style={{ color: p.stock === '0' ? 'var(--dz-e-ama)' : 'var(--dz-t1)' }}
                          title={p.stock === '0' ? 'Se va a cero: cuenta para el freno' : undefined}
                        >
                          {p.stock}
                        </td>
                        <td className="dz-der dz-num dz-t2">{p.precio}</td>
                        <td className="dz-t3">
                          <span className="dz-corta" style={{ maxWidth: 166 }} title={p.descripcion}>
                            {p.descripcion}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  )
}
