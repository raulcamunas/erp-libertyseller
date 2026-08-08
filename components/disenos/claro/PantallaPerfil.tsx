'use client'

/**
 * PANTALLA 3 — Amazon API → Automatización → configuración de un perfil de
 * lectura (hoy, components/amazon/PerfilConfig.tsx, 1.471 líneas).
 *
 * Es el formulario más denso del ERP y el que más estados tiene que comunicar a
 * la vez. Aquí caen los peores contrastes medidos: las etiquetas de los ~50
 * campos y las notas que explican qué hace cada uno van a `text-white/35`, o
 * sea 3,17:1 en oscuro. Y ese texto no es decorativo: es lo único que evita
 * que alguien deje un freno apagado sin enterarse.
 *
 * Los tres problemas concretos y cómo los resuelve esta propuesta:
 *
 *  1. ETIQUETAS Y NOTAS ILEGIBLES → las notas suben a tinta 2 (6,68:1 en el
 *     peor fondo claro, 6,50:1 en oscuro) y las etiquetas de campo dejan de
 *     ser versales de 10 px al 35 % para ser texto normal de 12 px.
 *
 *  2. NO HAY BOTÓN DE GUARDAR, así que tampoco hay confirmación de que lo que
 *     acabas de teclear se ha escrito → cada campo enseña «Guardado» al salir,
 *     y el índice de la izquierda lleva la cuenta de la sección.
 *
 *  3. «FRENO PUESTO» Y «FRENO APAGADO» solo se distinguen hoy por un marcador
 *     de posición gris → ahora son dos cajas distintas: borde continuo con
 *     escudo lleno contra borde discontinuo con escudo tachado, más la palabra
 *     PUESTO o APAGADO. Tres canales, ninguno de ellos el color.
 */

import { useState } from 'react'
import {
  AlertTriangle, Check, CheckCircle2, FlaskConical, Shield, ShieldOff,
  Upload, X, XCircle,
} from 'lucide-react'
import { PastillaRun } from './Estados'
import {
  ALIAS, EJECUCIONES, FRENOS, PRUEBA_COLUMNAS, PRUEBA_FILAS,
  entero, importe, type Alias, type Freno,
} from './datos'

const SECCIONES = [
  { id: 'perfil', titulo: 'El perfil', hint: 'Qué fichero es y de qué cliente' },
  { id: 'datos', titulo: 'Dónde están los datos', hint: 'Hoja, cabecera y formato' },
  { id: 'columnas', titulo: 'Las columnas', hint: 'Por nombre, nunca por posición' },
  { id: 'frenos', titulo: 'Frenos', hint: 'Si salta uno, no se manda nada' },
  { id: 'probar', titulo: 'Probar', hint: 'Qué entiende el perfil con este fichero' },
  { id: 'historial', titulo: 'Últimas ejecuciones', hint: 'Cómo acabó cada ciclo' },
]

export function PantallaPerfil() {
  const [seccion, setSeccion] = useState('frenos')
  const [frenos, setFrenos] = useState<Freno[]>(FRENOS)
  const [alias, setAlias] = useState<Alias[]>(ALIAS)
  const [guardados, setGuardados] = useState<Record<string, boolean>>({})

  const apagados = frenos.filter((f) => !f.valor.trim())

  function marcarGuardado(clave: string) {
    setGuardados((g) => ({ ...g, [clave]: true }))
    setTimeout(() => setGuardados((g) => ({ ...g, [clave]: false })), 2400)
  }

  return (
    <main className="lsd-pantalla">
      <div className="lsd-cabecera">
        <div className="lsd-cabecera-txt">
          <h1 className="lsd-titulo">Shoplamp · volcado de stock</h1>
          <p className="lsd-cabecera-sub">
            Perfil de lectura · amazon.es · EUR · 8.431 líneas el último día bueno
          </p>
        </div>
        <div className="lsd-cabecera-fin">
          <PastillaRun estado="frenado" />
          {/* No hay botón de guardar a propósito: un formulario de cincuenta
              campos con un botón al final es un formulario que se pierde
              entero cuando alguien cierra la pestaña a medias. Lo que sí hace
              falta es decir que se está guardando solo. */}
          <span className="lsd-tenue">
            <Check size={12} style={{ verticalAlign: -2, marginRight: 4 }} aria-hidden />
            Cada campo se guarda al salir de él
          </span>
        </div>
      </div>

      <div className="lsd-perfil">
        {/* Índice: en un formulario de ~50 campos hace falta saber dónde estás
            y cuánto queda. El número de la derecha son los frenos apagados. */}
        <nav className="lsd-indice" aria-label="Secciones del perfil">
          {SECCIONES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lsd-indice-i"
              data-activo={seccion === s.id ? 'si' : 'no'}
              onClick={() => setSeccion(s.id)}
            >
              {s.titulo}
              {s.id === 'frenos' && apagados.length > 0 && (
                <span className="lsd-indice-n" style={{ color: 'var(--lsd-aviso)' }}>
                  {apagados.length} off
                </span>
              )}
            </button>
          ))}
        </nav>

        <div className="lsd-form">
          {seccion === 'perfil' && <SeccionPerfil onGuardar={marcarGuardado} guardados={guardados} />}
          {seccion === 'datos' && <SeccionDatos onGuardar={marcarGuardado} guardados={guardados} />}
          {seccion === 'columnas' && <SeccionColumnas alias={alias} setAlias={setAlias} />}
          {seccion === 'frenos' && (
            <SeccionFrenos frenos={frenos} setFrenos={setFrenos} onGuardar={marcarGuardado} guardados={guardados} />
          )}
          {seccion === 'probar' && <SeccionProbar />}
          {seccion === 'historial' && <SeccionHistorial />}
        </div>
      </div>
    </main>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function Caja({ titulo, hint, children }: { titulo: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="lsd-caja">
      <div className="lsd-caja-cab">
        <h2 className="lsd-caja-tit">{titulo}</h2>
        {hint && <span className="lsd-caja-hint">{hint}</span>}
      </div>
      <div className="lsd-caja-cpo">{children}</div>
    </section>
  )
}

/** La etiqueta del campo y, cuando toca, el «Guardado» que confirma la escritura. */
function Campo({
  etiqueta, nota, guardado, children,
}: { etiqueta: string; nota?: string; guardado?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ minWidth: 0 }}>
      <label className="lsd-etiq">
        {etiqueta}
        {guardado && (
          <span className="lsd-guardado">
            <Check size={11} strokeWidth={3} aria-hidden /> Guardado
          </span>
        )}
      </label>
      {children}
      {nota && <p className="lsd-nota">{nota}</p>}
    </div>
  )
}

function SeccionPerfil({ onGuardar, guardados }: { onGuardar: (k: string) => void; guardados: Record<string, boolean> }) {
  const [tipo, setTipo] = useState('stock')
  const [activo, setActivo] = useState(true)
  return (
    <Caja titulo="El perfil" hint="Qué fichero es y de qué cliente">
      <div className="lsd-rejilla">
        <Campo etiqueta="Nombre" guardado={guardados.nombre}>
          <input className="lsd-campo" defaultValue="Shoplamp · volcado de stock" onBlur={() => onGuardar('nombre')} />
        </Campo>
        <Campo
          etiqueta="Qué trae este fichero"
          nota={tipo === 'stock'
            ? 'El volcado principal: referencia, unidades y, si lo trae, precio.'
            : 'El índice de códigos de barras del ERP. No se envía a Amazon: alimenta la vía de cruce por EAN, que es la que desempata las referencias que solo se diferencian en los ceros.'}
        >
          <div style={{ display: 'flex', gap: 6 }}>
            {[{ v: 'stock', e: 'Stock (y precio)' }, { v: 'ean', e: 'Códigos de barras' }].map((o) => (
              <button
                key={o.v}
                type="button"
                className="lsd-chip"
                data-on={tipo === o.v ? 'si' : 'no'}
                onClick={() => setTipo(o.v)}
              >
                {o.e}
              </button>
            ))}
          </div>
        </Campo>
      </div>

      <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          className="lsd-chip"
          data-on={activo ? 'si' : 'no'}
          onClick={() => setActivo(!activo)}
        >
          {activo ? <Check size={12} aria-hidden /> : <X size={12} aria-hidden />}
          Perfil {activo ? 'activo' : 'apagado'}
        </button>
        <span className="lsd-nota" style={{ margin: 0 }}>
          Apagado, ni se lee ni se procesa. El historial se conserva.
        </span>
      </div>
    </Caja>
  )
}

function SeccionDatos({ onGuardar, guardados }: { onGuardar: (k: string) => void; guardados: Record<string, boolean> }) {
  return (
    <Caja titulo="Dónde están los datos dentro del fichero" hint="Hoja, cabecera y formato">
      <div className="lsd-rejilla">
        <Campo
          etiqueta="Hoja (por nombre)"
          guardado={guardados.hoja}
          nota="Lo preferido: sobrevive a que el cliente reordene el libro. Si no encaja, se prueban las demás hojas por sus columnas."
        >
          <input className="lsd-campo" defaultValue="Stock" placeholder="Vacío = se reconoce por las columnas" onBlur={() => onGuardar('hoja')} />
        </Campo>
        <Campo etiqueta="Hoja (por posición)" nota="Empezando en 1, y solo si no hay nombre: un libro cuya primera hoja cambia de sitio leería otra cosa sin avisar.">
          <input className="lsd-campo" data-num="si" placeholder="Último recurso" />
        </Campo>
        <Campo etiqueta="Fila de la cabecera" guardado={guardados.fc} nota="Vacío = se busca en las primeras 20 filas la primera con dos celdas llenas.">
          <input className="lsd-campo" data-num="si" defaultValue="3" onBlur={() => onGuardar('fc')} />
        </Campo>
        <Campo etiqueta="Primera fila de datos">
          <input className="lsd-campo" data-num="si" placeholder="Vacío = la siguiente a la cabecera" />
        </Campo>
        <Campo etiqueta="Separador del CSV" nota="Solo para CSV. Normalmente «;» en los ficheros españoles.">
          <input className="lsd-campo" placeholder="Vacío = automático" maxLength={3} />
        </Campo>
        <Campo etiqueta="Codificación del CSV" nota="Si las tildes salen como símbolos raros en la prueba, es latin1 o windows-1252.">
          <select className="lsd-campo" defaultValue="">
            <option value="">Automática (utf-8)</option>
            <option value="utf-8">utf-8</option>
            <option value="latin1">latin1</option>
            <option value="windows-1252">windows-1252</option>
          </select>
        </Campo>
      </div>
    </Caja>
  )
}

/**
 * Los alias son una LISTA de nombres aceptados, y hoy se editan como una cadena
 * con comas dentro de un `input`. Pintarlos como fichas dice lo que son sin
 * ninguna nota que lo explique, y deja ver de un golpe cuáles están vacíos.
 */
function SeccionColumnas({ alias, setAlias }: { alias: Alias[]; setAlias: (a: Alias[]) => void }) {
  function quitar(campo: string, i: number) {
    setAlias(alias.map((a) => (a.campo === campo ? { ...a, valores: a.valores.filter((_, j) => j !== i) } : a)))
  }
  function anadir(campo: string, v: string) {
    const t = v.trim()
    if (!t) return
    setAlias(alias.map((a) => (a.campo === campo ? { ...a, valores: [...a.valores, t] } : a)))
  }

  return (
    <Caja titulo="Las columnas" hint="Por nombre, nunca por posición">
      <div className="lsd-info-caja" style={{ marginBottom: 12 }}>
        Se busca <strong>por nombre</strong> y se aceptan varias alternativas por campo. No distingue
        tildes, mayúsculas ni puntuación: «Artículo», «ARTICULO» y «Cód.Artículo» casan solas. Ir por
        posición escribiría el dato en el sitio equivocado el día que el cliente añade una columna, y{' '}
        <strong>sin dar ningún error</strong>.
      </div>

      <div className="lsd-rejilla">
        {alias.map((a) => (
          <Campo
            key={a.campo}
            etiqueta={a.obligatorio ? `${a.etiqueta} *` : a.etiqueta}
            nota={a.nota}
          >
            <FichasAlias
              valores={a.valores}
              onQuitar={(i) => quitar(a.campo, i)}
              onAnadir={(v) => anadir(a.campo, v)}
            />
          </Campo>
        ))}
      </div>
    </Caja>
  )
}

function FichasAlias({
  valores, onQuitar, onAnadir,
}: { valores: string[]; onQuitar: (i: number) => void; onAnadir: (v: string) => void }) {
  const [borrador, setBorrador] = useState('')
  return (
    <div className="lsd-alias">
      {valores.map((v, i) => (
        <span key={`${v}-${i}`} className="lsd-alias-c">
          {v}
          <button type="button" className="lsd-alias-x" onClick={() => onQuitar(i)} aria-label={`Quitar ${v}`}>
            <X size={11} strokeWidth={2.5} />
          </button>
        </span>
      ))}
      <input
        className="lsd-alias-in"
        value={borrador}
        placeholder={valores.length ? 'Otro nombre…' : 'Sin nombres apuntados'}
        onChange={(e) => setBorrador(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); onAnadir(borrador); setBorrador('') }
        }}
        onBlur={() => { onAnadir(borrador); setBorrador('') }}
      />
    </div>
  )
}

/**
 * EL BLOQUE QUE MÁS IMPORTA. Un freno sin límite puesto está APAGADO, y hoy la
 * única diferencia visible entre «puesto en 30 %» y «apagado» es que el segundo
 * enseña un marcador de posición gris que dice «Vacío = no se evalúa».
 */
function SeccionFrenos({
  frenos, setFrenos, onGuardar, guardados,
}: {
  frenos: Freno[]
  setFrenos: (f: Freno[]) => void
  onGuardar: (k: string) => void
  guardados: Record<string, boolean>
}) {
  const apagados = frenos.filter((f) => !f.valor.trim())

  return (
    <Caja titulo="Frenos" hint="Si salta uno, no se manda nada">
      <div className="lsd-info-caja">
        Un fichero mal exportado un martes por la noche{' '}
        <strong>no puede vaciar el inventario de un cliente quince minutos después</strong> sin que
        nadie lo vea. Los límites son por cliente: uno con 400 referencias y otro con 40.000 no
        toleran lo mismo.
      </div>

      {apagados.length > 0 && (
        <div className="lsd-aviso-caja" style={{ marginTop: 10 }}>
          <AlertTriangle size={13} style={{ verticalAlign: -2, marginRight: 5 }} aria-hidden />
          {apagados.length === 1
            ? 'Hay un freno sin límite puesto, así que está apagado: '
            : `Hay ${apagados.length} frenos sin límite puesto, así que están apagados: `}
          <strong>{apagados.map((f) => f.etiqueta.toLowerCase()).join(', ')}</strong>. Con el envío
          automático encendido, un freno que no se puede comprobar impide mandar.
        </div>
      )}

      <div className="lsd-rejilla" style={{ marginTop: 12 }}>
        {frenos.map((f) => {
          const off = !f.valor.trim()
          return (
            <div key={f.clave} className="lsd-freno" data-off={off ? 'si' : 'no'}>
              <div className="lsd-freno-cab">
                <span className="lsd-freno-et">{f.etiqueta}</span>
                {/* Tres canales para el mismo hecho: el icono (escudo lleno
                    contra escudo tachado), la palabra, y el borde de la caja
                    (continuo contra discontinuo). Ninguno es el color. */}
                <span className="lsd-freno-est">
                  {off
                    ? <><ShieldOff size={12} strokeWidth={2.5} aria-hidden /> Apagado</>
                    : <><Shield size={12} strokeWidth={2.5} aria-hidden /> Puesto</>}
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input
                  className="lsd-campo"
                  data-num="si"
                  value={f.valor}
                  placeholder="Sin límite"
                  inputMode="decimal"
                  aria-label={f.etiqueta}
                  onChange={(e) => setFrenos(frenos.map((x) => (x.clave === f.clave ? { ...x, valor: e.target.value } : x)))}
                  onBlur={() => onGuardar(f.clave)}
                />
                <span className="lsd-tenue" style={{ flex: '0 0 auto' }}>{f.unidad}</span>
                {guardados[f.clave] && (
                  <span className="lsd-guardado">
                    <Check size={11} strokeWidth={3} aria-hidden /> Guardado
                  </span>
                )}
              </div>

              {f.nota && <p className="lsd-nota">{f.nota}</p>}
            </div>
          )
        })}
      </div>
    </Caja>
  )
}

function SeccionProbar() {
  return (
    <>
      <Caja titulo="Probar" hint="Qué entiende el perfil con este fichero">
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="lsd-btn">
            <Upload size={13} aria-hidden /> Cambiar fichero
          </button>
          <span className="lsd-tenue">stock_shoplamp_2026-08-08.xlsx</span>
          <button type="button" className="lsd-btn" data-tipo="primario">
            <FlaskConical size={13} aria-hidden /> Probar
          </button>
        </div>

        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 12 }} className="lsd-apoyo">
          <span>Hoja <strong style={{ color: 'var(--lsd-t1)' }}>Stock</strong></span>
          <span>Cabecera en la fila <strong style={{ color: 'var(--lsd-t1)' }}>3</strong></span>
          <span><strong className="lsd-num" style={{ color: 'var(--lsd-t1)' }}>8.420</strong> líneas</span>
          <span><strong className="lsd-num" style={{ color: 'var(--lsd-t1)' }}>1.206</strong> cambiarían</span>
        </div>

        {/* TRES ESTADOS Y NO DOS, y el del medio es el que importa: una columna
            que casa solo porque EMPIEZA IGUAL se pintaba en verde con un tick,
            exactamente igual que un acierto exacto. Así es como un perfil nuevo
            acaba leyendo «Stock value» —un importe en euros— creyendo que son
            las unidades. Aquí cada uno tiene su icono y su palabra. */}
        <div className="lsd-rejilla" style={{ marginTop: 12 }}>
          {PRUEBA_COLUMNAS.map((c) => {
            const clase = c.como === 'falta' ? 'lsd-error-caja' : c.como === 'parcial' ? 'lsd-aviso-caja' : 'lsd-ok-caja'
            const Icono = c.como === 'falta' ? XCircle : c.como === 'parcial' ? AlertTriangle : CheckCircle2
            const dice = c.como === 'falta' ? 'No aparece' : c.como === 'parcial' ? 'Empieza igual' : 'Exacta'
            return (
              <div key={c.campo} className={clase}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icono size={13} strokeWidth={2.5} className="lsd-sincolor" aria-hidden />
                  <strong>{dice}</strong>
                </div>
                <div style={{ marginTop: 2 }}>
                  {c.campo} → <strong>{c.columna ?? 'ninguna columna'}</strong>
                </div>
              </div>
            )
          })}
        </div>
      </Caja>

      <Caja titulo="Las primeras filas, ya interpretadas" hint="Se comparan celda a celda contra el Excel del cliente">
        <div className="lsd-tabla-caja" style={{ maxHeight: 260 }}>
          <table className="lsd-tabla">
            <thead>
              <tr>
                <th data-fija="si" style={{ minWidth: 150 }}>Referencia</th>
                <th style={{ minWidth: 280 }}>Descripción</th>
                <th data-der="si" style={{ minWidth: 90 }}>Stock</th>
                <th data-der="si" style={{ minWidth: 100 }}>Precio</th>
                <th style={{ minWidth: 120 }}>Familia</th>
              </tr>
            </thead>
            <tbody>
              {PRUEBA_FILAS.map((f) => (
                <tr key={f.referencia}>
                  <td data-fija="si" className="lsd-num" style={{ paddingLeft: 10 }}>{f.referencia}</td>
                  <td data-2="si">{f.descripcion}</td>
                  <td data-der="si" className="lsd-num">{entero(f.stock)}</td>
                  {/* Un precio que no se puede editar hoy se pinta a 2,63:1.
                      Aquí va en tinta 3 (5,92:1) y lo que dice que no se toca
                      es la palabra, no la falta de contraste. */}
                  <td data-der="si" className="lsd-num" data-3={f.precio == null ? 'si' : undefined}>
                    {f.precio == null ? 'sin precio' : importe(f.precio)}
                  </td>
                  <td data-2="si">{f.familia}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Caja>
    </>
  )
}

function SeccionHistorial() {
  return (
    <Caja titulo="Últimas ejecuciones" hint="«Simulacro» va en gris y no en verde: ese cliente NO está mandando nada">
      <div className="lsd-tabla-caja">
        <table className="lsd-tabla">
          <thead>
            <tr>
              <th data-fija="si" style={{ minWidth: 130 }}>Cuándo</th>
              <th style={{ minWidth: 150 }}>Cómo acabó</th>
              <th data-der="si" style={{ minWidth: 90 }}>Líneas</th>
              <th data-der="si" style={{ minWidth: 90 }}>Cambios</th>
              <th style={{ minWidth: 420 }}>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {EJECUCIONES.map((e, i) => (
              <tr key={i}>
                <td data-fija="si" style={{ paddingLeft: 10 }}>{e.cuando}</td>
                <td><PastillaRun estado={e.estado} /></td>
                <td data-der="si" className="lsd-num">{entero(e.lineas)}</td>
                <td data-der="si" className="lsd-num">{entero(e.cambios)}</td>
                <td data-2="si" style={{ whiteSpace: 'normal' }}>{e.detalle}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lsd-nota">
        «Sin cambios» y «Simulacro» comparten color a conciencia —los dos significan que no ha salido
        nada hacia Amazon—, pero ahora tienen icono distinto: una raya contra un matraz. Hoy son dos
        pastillas grises idénticas que solo se diferencian leyendo la palabra.
      </p>
    </Caja>
  )
}
