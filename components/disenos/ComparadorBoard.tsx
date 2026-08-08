'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeftRight, Contrast, Droplet, Info, Maximize2, Minimize2, Monitor, Moon, Sun } from 'lucide-react'

import { ESTILOS_COMPARADOR } from './comparador/estilos'
import { Ficha } from './comparador/Ficha'
import { Maqueta } from './comparador/Maquetas'
import { TablaComparativa } from './comparador/TablaComparativa'
import {
  PANTALLAS,
  PROPUESTAS,
  propuestaPorId,
  type IdPantalla,
  type IdPropuesta,
  type Modo,
} from './comparador/propuestas'

/**
 * EL COMPARADOR DE DISEÑOS.
 *
 * Dos ejes y nada más: QUÉ PANTALLA se mira (las tres del diagnóstico) y QUÉ
 * PROPUESTA se le aplica (las tres, más «como está hoy» de referencia).
 *
 * La decisión no se toma leyendo: se toma viendo la MISMA pantalla saltar de una
 * propuesta a otra sin que se mueva nada más. Por eso:
 *
 *   · Las cuatro variantes de la pantalla que estás mirando se quedan MONTADAS
 *     y se ocultan con `display:none`. Cambiar de propuesta es un cambio de
 *     estilo, no un montaje: es instantáneo, no recarga, y cada maqueta conserva
 *     su scroll, su fila elegida y sus filtros. Al volver a ella está donde la
 *     dejaste, que es lo que hace que se puedan comparar dos estados iguales.
 *   · Se montan según se visitan, no las cuatro de golpe, para que la primera
 *     pintada sea la de una sola.
 *   · Las teclas 1, 2, 3 y 4 saltan entre propuestas, y el botón ⇄ alterna con
 *     la última que miraste. Alternar dos veces seguidas entre dos candidatas es
 *     literalmente cómo se decide esto.
 *
 * ESTO NO CAMBIA EL ERP. Las cuatro maquetas viven dentro de esta pantalla, cada
 * una bajo su propia clase raíz y con su propia hoja de estilos prefijada. Nada
 * de aquí toca app/globals.css, ni el layout, ni ningún módulo.
 */

/** Se usa layout effect en el navegador para que la escala no dé un salto */
const useMedida = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Las alturas de ventana reales del equipo, del informe de diagnóstico */
const ALTURAS: { alto: number; nombre: string; que: string }[] = [
  { alto: 1080, nombre: '1080', que: 'Monitor 1080 a pantalla completa' },
  { alto: 940, nombre: '940', que: 'Monitor 1920×1080 con Chrome y la barra de macOS' },
  { alto: 780, nombre: '780', que: 'Portátil 1440×900 con Chrome — la pantalla de un comercial' },
]

const ANCHOS: { ancho: number; nombre: string; que: string }[] = [
  { ancho: 1920, nombre: '1920', que: 'Monitor de sobremesa' },
  { ancho: 1440, nombre: '1440', que: 'Portátil de 14 pulgadas' },
]

export function ComparadorBoard() {
  const [pantalla, setPantalla] = useState<IdPantalla>('cold')
  const [propuesta, setPropuesta] = useState<IdPropuesta>('hoy')
  const [anterior, setAnterior] = useState<IdPropuesta>('denso')
  const [modo, setModo] = useState<Modo>('oscuro')
  const [alto, setAlto] = useState(940)
  const [ancho, setAncho] = useState(1920)
  /**
   * EL CRITERIO 5, y por eso está aquí arriba y no dentro de una propuesta.
   *
   * «Los estados se distinguen sin color» es el único de los siete criterios del
   * encargo que solo se puede juzgar apagando el color. La propuesta clara traía
   * su propio interruptor, pero el comparador la montaba con `sinColor={false}`
   * fijo, así que desde la app donde se decide era inalcanzable — y las otras
   * tres no tenían equivalente. Resultado: se elegía a ojo en color y el problema
   * aparecía en producción.
   *
   * Ahora es un mando más, al lado de Tema y Ventana, y se aplica a las CUATRO a
   * la vez desde el envoltorio de la ventana simulada: mismo tratamiento para
   * todas, que es lo que hace que la comparación signifique algo.
   */
  const [sinColor, setSinColor] = useState(false)
  /**
   * «encajar» mete la ventana entera en el hueco que haya; los otros dos la
   * dejan a un tamaño fijo y te mueves por ella. En un móvil, encajar una
   * ventana de 1920 deja un sello de correos: el 50 % es lo que hace que se
   * pueda mirar de verdad una propuesta detrás de otra desde el teléfono.
   *
   * Por eso en una pantalla estrecha se arranca en el 50 %. Empezando siempre en
   * «encajar», un teléfono de 375 px pintaba de salida una ventana de 1920 al
   * 19,5 % —375x211 px, ni una fila legible— y el 50 % había que ir a buscarlo:
   * para entonces la primera impresión ya era que la app no funciona en el móvil.
   *
   * Se decide en un efecto y no en el estado inicial a propósito: el estado
   * inicial corre también en el servidor, donde no hay `window`, y devolver dos
   * valores distintos rompe la hidratación. `tocado` hace que esto ocurra una
   * sola vez y nunca por encima de una elección del usuario.
   */
  const [zoom, setZoom] = useState<'encajar' | 'medio' | 'real'>('encajar')
  const zoomTocado = useRef(false)
  useEffect(() => {
    if (zoomTocado.current) return
    if (window.innerWidth < 700) setZoom('medio')
  }, [])
  const elegirZoom = useCallback((z: 'encajar' | 'medio' | 'real') => {
    zoomTocado.current = true
    setZoom(z)
  }, [])

  /* --- La hoja del cromo del comparador --- */
  useEffect(() => {
    const ID = 'cmp-estilos'
    if (document.getElementById(ID)) return
    const el = document.createElement('style')
    el.id = ID
    el.textContent = ESTILOS_COMPARADOR
    document.head.appendChild(el)
  }, [])

  /* --- Qué variantes hay montadas ya --- */
  const [vistos, setVistos] = useState<Set<string>>(() => new Set(['cold:hoy']))
  useEffect(() => {
    const clave = `${pantalla}:${propuesta}`
    setVistos((s) => (s.has(clave) ? s : new Set(s).add(clave)))
  }, [pantalla, propuesta])

  const cambiarPropuesta = useCallback(
    (id: IdPropuesta) => {
      setPropuesta((actual) => {
        if (actual === id) return actual
        setAnterior(actual)
        return id
      })
    },
    []
  )

  const alternar = useCallback(() => cambiarPropuesta(anterior), [anterior, cambiarPropuesta])

  /* --- Teclas 1-4 y ⇄ --- */
  useEffect(() => {
    function alPulsar(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      // Las maquetas tienen campos de verdad: si estás escribiendo en uno, un «3»
      // es un tres y no un cambio de propuesta.
      const destino = e.target as HTMLElement | null
      if (destino && (destino.isContentEditable || /^(INPUT|SELECT|TEXTAREA)$/.test(destino.tagName))) return

      const indice = ['1', '2', '3', '4'].indexOf(e.key)
      if (indice >= 0) {
        e.preventDefault()
        cambiarPropuesta(PROPUESTAS[indice].id)
        return
      }
      if (e.key === 'x' || e.key === 'X') {
        e.preventDefault()
        alternar()
      }
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [alternar, cambiarPropuesta])

  /* --- La escala: la ventana simulada se encoge para caber, sin deformarse --- */
  const caja = useRef<HTMLDivElement>(null)
  const [disponible, setDisponible] = useState(0)
  useMedida(() => {
    const el = caja.current
    if (!el) return
    const medir = () => setDisponible(el.clientWidth)
    medir()
    const ro = new ResizeObserver(medir)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const escala = useMemo(() => {
    if (zoom === 'real') return 1
    if (zoom === 'medio') return 0.5
    if (!disponible) return 1
    return Math.min(1, disponible / ancho)
  }, [zoom, disponible, ancho])

  /* --- CUÁNTAS FILAS CABEN, CONTADAS EN PANTALLA ---
     Las tres propuestas ponen esta métrica por delante de todo lo demás, y hasta
     ahora había que fiarse: para comprobar el «32 filas» tocaba contarlas a mano
     sobre una maqueta escalada al 40 %. Esto NO recalcula la fórmula de cada
     propuesta —eso sería volver a fiarse de un número escrito— sino que mide el
     DOM de la maqueta que se está mirando: cuenta las filas del cuerpo de la
     tabla que caben ENTERAS y sin scroll.

     El suelo NO es el borde de la ventana simulada: es el más alto de todos los
     bordes inferiores que recortan la tabla —su propia caja con overflow, los
     paneles de en medio y la ventana—. Medir contra la ventana daba una fila de
     más en la referencia (16 donde se ven 15), porque la última quedaba dentro de
     la ventana pero por debajo del recorte de la caja de la tabla, escondida
     detrás del pie de «Ver más». Los rectángulos vienen ya escalados por el
     transform, todos igual, así que la cuenta no depende del zoom. */
  const [filas, setFilas] = useState<{ visibles: number; total: number } | null>(null)
  useEffect(() => {
    const medir = () => {
      const cont = caja.current
      const ventana = cont?.querySelector<HTMLElement>('.cmp-ventana[data-visible="si"]')
      const cuerpo = ventana?.querySelector('tbody')
      if (!ventana || !cuerpo) {
        setFilas(null)
        return
      }

      let suelo = ventana.getBoundingClientRect().bottom
      for (let n: HTMLElement | null = cuerpo; n && n !== ventana; n = n.parentElement) {
        const ov = getComputedStyle(n).overflowY
        if (ov === 'auto' || ov === 'scroll' || ov === 'hidden') {
          suelo = Math.min(suelo, n.getBoundingClientRect().bottom)
        }
      }

      const todas = Array.from(cuerpo.rows)
      const dentro = todas.filter((tr) => {
        const r = tr.getBoundingClientRect()
        return r.height > 0 && r.bottom <= suelo + 0.5
      })
      setFilas({ visibles: dentro.length, total: todas.length })
    }

    /* Dos medidas y no una. Cambiar el alto de la ventana simulada dispara una
       cadena: cambia el alto del lienzo, puede aparecer o irse la barra
       horizontal, el ResizeObserver recalcula el ancho disponible y con él la
       escala, y solo entonces la maqueta queda quieta. Midiendo una sola vez a
       los 150 ms se pillaba a veces la geometría anterior y el pie enseñaba el
       número de la altura de antes. La segunda pasada la corrige. */
    const a = window.setTimeout(medir, 150)
    const b = window.setTimeout(medir, 600)
    return () => {
      window.clearTimeout(a)
      window.clearTimeout(b)
    }
  }, [pantalla, propuesta, modo, alto, ancho, escala, vistos, sinColor])

  /** Cuando la ventana no cabe, el hueco se mueve con las barras */
  const cabe = ancho * escala <= disponible + 1

  const ficha = propuestaPorId(propuesta)
  const info = PANTALLAS.find((p) => p.id === pantalla)!

  /* NO se pone al lado el número que declara la ficha, y no por pudor: las
     tablas de densidad de las tres memorias mezclan anchos. La fila de 780 px de
     la propuesta clara, por ejemplo, está medida a 1440 de ancho —ahí la barra de
     filtros pasa a dos líneas y cuesta 32 px más de cromo—, mientras que la de
     940 está medida a 1920. Comparar el contado con el declarado sin mirar
     también el ancho daría por falso un número que es correcto en su contexto.
     Lo que se enseña aquí es lo que se ve en ESTA ventana, que es lo que hacía
     falta y lo que no había. */
  const fueraDeSuModo = ficha.id !== 'hoy' && ficha.modoPrincipal !== modo

  return (
    <div className="cmp-raiz">
      {/* ------------------------------------------------------------ */}
      {/* Cabecera                                                      */}
      {/* ------------------------------------------------------------ */}
      <div style={{ marginBottom: 10 }}>
        <h1 className="cmp-h1">Diseños del ERP</h1>
        <p className="cmp-p" style={{ marginTop: 3 }}>
          Tres propuestas de cambio de imagen sobre las pantallas reales, para elegir una.
        </p>
      </div>

      <div className="cmp-aviso" style={{ marginBottom: 10 }}>
        <Info aria-hidden />
        <p className="cmp-s">
          <strong className="cmp-t1">Esto no cambia nada del ERP.</strong> Es una app de decisión: las
          cuatro versiones que ves aquí son maquetas que viven dentro de esta pantalla. Nadie va a ver
          Cold Calling distinto mañana por haber pulsado aquí. Cuando esté elegida una, la ficha de
          cada propuesta dice —en la pestaña «Adoptarla»— qué ficheros habría que tocar y en qué
          orden.{' '}
          <strong className="cmp-t2">
            Las cuentas y los clientes que se ven son los reales de la agencia; las cifras, los
            estados y las notas están inventados.
          </strong>{' '}
          Van con nombre real a propósito: con relleno no se puede mirar una tabla y decir si se
          trabaja mejor o peor con ella. Por eso esta pantalla es solo para los socios.
        </p>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Mandos                                                        */}
      {/* ------------------------------------------------------------ */}
      <div className="cmp-mandos">
        {/* Eje 1: qué pantalla */}
        <div className="cmp-fila">
          <span className="cmp-et">Pantalla</span>
          <div className="cmp-grupo" role="group" aria-label="Qué pantalla se mira">
            {PANTALLAS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="cmp-op"
                data-on={pantalla === p.id ? '1' : undefined}
                onClick={() => setPantalla(p.id)}
                title={p.ruta}
              >
                {p.nombre}
              </button>
            ))}
          </div>
          <span className="cmp-crece" />
          <span className="cmp-s" style={{ textAlign: 'right', maxWidth: 520 }}>
            {info.ruta}
          </span>
        </div>

        {/* Eje 2: qué propuesta */}
        <div className="cmp-fila">
          <span className="cmp-et">Propuesta</span>
          <div className="cmp-grupo" role="group" aria-label="Qué propuesta se le aplica">
            {PROPUESTAS.map((p, i) => (
              <button
                key={p.id}
                type="button"
                className="cmp-op"
                data-on={propuesta === p.id ? '1' : undefined}
                onClick={() => cambiarPropuesta(p.id)}
                title={p.lema}
              >
                <span className="cmp-tecla" aria-hidden>
                  {i + 1}
                </span>
                {p.nombre}
              </button>
            ))}
          </div>

          <button
            type="button"
            className="cmp-btn"
            onClick={alternar}
            title="Alterna con la última propuesta que miraste (tecla X). Ir y volver dos veces entre dos candidatas es como se decide esto."
          >
            <ArrowLeftRight aria-hidden />
            Volver a {propuestaPorId(anterior).nombre}
          </button>
        </div>

        {/* Tema y tamaño de ventana */}
        <div className="cmp-fila">
          <span className="cmp-et">Tema</span>
          <div className="cmp-grupo" role="group" aria-label="Claro u oscuro">
            <button
              type="button"
              className="cmp-op"
              data-on={modo === 'claro' ? '1' : undefined}
              onClick={() => setModo('claro')}
            >
              <Sun aria-hidden />
              Claro
            </button>
            <button
              type="button"
              className="cmp-op"
              data-on={modo === 'oscuro' ? '1' : undefined}
              onClick={() => setModo('oscuro')}
            >
              <Moon aria-hidden />
              Oscuro
            </button>
          </div>

          <span className="cmp-marca-modo" data-fuera={fueraDeSuModo ? '1' : undefined}>
            {ficha.id === 'hoy'
              ? 'Hoy solo el oscuro está diseñado; el claro es una capa de traducción'
              : fueraDeSuModo
                ? `Ojo: esta propuesta defiende el ${ficha.modoPrincipal}`
                : `Es el modo principal de esta propuesta`}
          </span>

          <span className="cmp-crece" />

          <span className="cmp-et">Ventana</span>
          <div className="cmp-grupo" role="group" aria-label="Alto de la ventana simulada">
            {ALTURAS.map((a) => (
              <button
                key={a.alto}
                type="button"
                className="cmp-op"
                data-on={alto === a.alto ? '1' : undefined}
                onClick={() => setAlto(a.alto)}
                title={a.que}
              >
                {a.nombre}
              </button>
            ))}
          </div>
          <div className="cmp-grupo" role="group" aria-label="Ancho de la ventana simulada">
            {ANCHOS.map((a) => (
              <button
                key={a.ancho}
                type="button"
                className="cmp-op"
                data-on={ancho === a.ancho ? '1' : undefined}
                onClick={() => setAncho(a.ancho)}
                title={a.que}
              >
                <Monitor aria-hidden />
                {a.nombre}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="cmp-btn"
            data-on={sinColor ? '1' : undefined}
            aria-pressed={sinColor}
            onClick={() => setSinColor((v) => !v)}
            title="Pinta las cuatro maquetas en gris. Es la única forma de juzgar el criterio 5: si un estado solo se distingue por color, aquí desaparece."
          >
            {sinColor ? <Droplet aria-hidden /> : <Contrast aria-hidden />}
            {sinColor ? 'Devolver el color' : 'Sin color'}
          </button>

          <div className="cmp-grupo" role="group" aria-label="Cuánto se acerca la maqueta">
            <button
              type="button"
              className="cmp-op"
              data-on={zoom === 'encajar' ? '1' : undefined}
              onClick={() => elegirZoom('encajar')}
              title="La ventana entera, encogida para caber en el hueco que haya"
            >
              <Minimize2 aria-hidden />
              Encajar
            </button>
            <button
              type="button"
              className="cmp-op"
              data-on={zoom === 'medio' ? '1' : undefined}
              onClick={() => elegirZoom('medio')}
              title="Al 50 %: en un móvil o en una ventana estrecha es lo que hace que se pueda mirar de verdad"
            >
              50 %
            </button>
            <button
              type="button"
              className="cmp-op"
              data-on={zoom === 'real' ? '1' : undefined}
              onClick={() => elegirZoom('real')}
              title="Tamaño real, píxel a píxel. Te mueves por la maqueta con las barras."
            >
              <Maximize2 aria-hidden />
              Real
            </button>
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* La maqueta y su ficha                                         */}
      {/* ------------------------------------------------------------ */}
      <div className="cmp-obra" style={{ marginTop: 12 }}>
        <div className="cmp-lienzo-caja">
          <div
            ref={caja}
            className="cmp-escala"
            style={{
              height: Math.round(alto * escala),
              overflowX: cabe ? 'hidden' : 'auto',
              overflowY: 'hidden',
            }}
          >
            {PROPUESTAS.map((p) => {
              const clave = `${pantalla}:${p.id}`
              if (!vistos.has(clave)) return null
              const visible = p.id === propuesta
              return (
                <div
                  key={clave}
                  className="cmp-ventana"
                  data-visible={visible ? 'si' : 'no'}
                  data-sincolor={sinColor ? 'si' : undefined}
                  aria-hidden={!visible}
                  style={{
                    width: ancho,
                    height: alto,
                    transform: `scale(${escala})`,
                  }}
                >
                  <Maqueta
                    propuesta={p.id}
                    pantalla={pantalla}
                    modo={modo}
                    alto={alto}
                    sinColor={sinColor}
                  />
                </div>
              )
            })}
          </div>

          <div className="cmp-lienzo-pie">
            <span>
              Ventana simulada de{' '}
              <strong className="cmp-num cmp-t1">
                {ancho} × {alto}
              </strong>{' '}
              px
              {escala < 1 && (
                <>
                  , vista al <span className="cmp-num">{Math.round(escala * 100)} %</span>
                </>
              )}
            </span>

            {/* La métrica que las tres propuestas ponen por delante, CONTADA aquí
                y no declarada: cambiar de 1080 a 780 la enseña como número.
                Y al lado, lo que la ficha dice para esa misma altura. Si no
                coinciden se ve, que es justo para lo que sirve contar. */}
            {filas && (
              <span
                title={
                  filas.visibles === filas.total
                    ? 'Caben todas las filas que la maqueta tiene cargadas, así que este número es un suelo, no el tope.'
                    : 'Filas del cuerpo de la tabla que caben enteras y sin scroll, contadas en el DOM de la maqueta.'
                }
              >
                <strong className="cmp-num cmp-t1">{filas.visibles}</strong> filas contadas en
                pantalla
                {filas.visibles === filas.total && (
                  <span className="cmp-t3"> · caben todas las cargadas, así que es un suelo</span>
                )}
              </span>
            )}

            {sinColor && <span className="cmp-t2">Sin color</span>}
            <span className="cmp-crece" />
            <span>
              Mirando: <strong className="cmp-t1">{ficha.nombre}</strong> · {ficha.lema}
            </span>
          </div>
        </div>

        <Ficha propuesta={ficha} modo={modo} />
      </div>

      {/* ------------------------------------------------------------ */}
      {/* Por qué esta pantalla                                         */}
      {/* ------------------------------------------------------------ */}
      <div
        className="cmp-tabla-caja"
        style={{ marginTop: 12, padding: 12, display: 'flex', flexDirection: 'column', gap: 6 }}
      >
        <h2 className="cmp-h2">Por qué se rediseña «{info.nombre}»</h2>
        <p className="cmp-p">{info.porQue}</p>
        <p className="cmp-s">
          <strong className="cmp-t2">Lo que cualquier propuesta tiene que resolver aquí:</strong>{' '}
          {info.queResolver}
        </p>
      </div>

      {/* ------------------------------------------------------------ */}
      {/* La tabla                                                      */}
      {/* ------------------------------------------------------------ */}
      {/* Puestas en tres columnas paralelas, las tres parecen tres opciones
          equidistantes, y no lo son. Decirlo antes de la tabla evita que la
          elección se haga por el color, que es justo lo que no las separa. */}
      <div className="cmp-aviso" style={{ marginTop: 12 }}>
        <Info aria-hidden />
        <p className="cmp-s">
          <strong className="cmp-t1">No son tres estéticas, son dos y media.</strong> «Denso» es una
          dirección aparte: modo oscuro, fila de 28 px, cuatro niveles de texto. Pero «Claro» y
          «Estructurado» coinciden en casi todo lo que define una estética —modo claro las dos, tres
          niveles de texto las dos, barra superior de 48 px las dos, tira de cifras en vez de las
          cuatro tarjetas las dos, y el mismo reparto del naranja con dos décimas de diferencia en el
          hex—. Lo que de verdad las separa es la temperatura del papel, la altura de fila y una cosa
          que no es estética:{' '}
          <strong className="cmp-t2">
            «Estructurado» es la única que además rehace la navegación entera
          </strong>
          . O sea que la decisión son dos preguntas, no una: primero oscuro-denso o claro, y después,
          si es claro, si además se cambia el menú. Las filas «Qué mueve», «Estrategia del naranja» y
          «Temperatura del papel» de la tabla de abajo son las que hay que mirar para eso.
        </p>
      </div>

      <div style={{ marginTop: 12 }}>
        <TablaComparativa activa={propuesta} />
      </div>

      <p className="cmp-s" style={{ marginTop: 10, marginBottom: 4 }}>
        Las tres propuestas viven en <code>components/disenos/denso</code>,{' '}
        <code>components/disenos/claro</code> y <code>components/disenos/estructurado</code>, cada una
        con su README y su memoria en datos. Esta app solo las monta: no las modifica, y ninguna de
        las cuatro toca <code>app/globals.css</code>.
      </p>
    </div>
  )
}

export default ComparadorBoard
