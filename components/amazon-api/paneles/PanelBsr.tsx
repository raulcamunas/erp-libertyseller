'use client'

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BarChart3, Plug, TrendingDown } from 'lucide-react'
import { getAmazon } from '@/lib/amazon/client'
import type { FilaBsr, VistaBsr } from '@/lib/plataforma/bsr-vista'
import type { TipoRankBsr } from '@/lib/plataforma/tipos'
import {
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  LINEA,
  PANTALLA,
  RADIO,
  SUPERFICIE,
  TABLA,
  TEXTO,
  TIPO,
  TITULO,
} from '@/lib/estilo/denso'
import { marketplaceLabel } from '@/lib/types/amazon'
import { Aviso, Cargando, Vacio, cifra, fechaCorta, hace } from '@/components/plataforma/comun'
import { Serie, type Punto } from '@/components/plataforma/Serie'
import { ListaInfo, SeccionInfo } from '@/components/ui/BotonInfo'
import type { PropsPanel } from '../tipos'

/**
 * PESTAÑA «BSR» — LOS RANKINGS, Y CÓMO SE MUEVEN.
 *
 * Lo que se PIDE se decide en Seguimiento y en Cuentas; lo que se ha medido se
 * MIRA aquí. La ficha de SKU de la pestaña Ingesta ya pinta la serie de UNA
 * referencia: lo que hay aquí es la vista de conjunto —qué se mueve, qué lleva
 * semanas cayendo— y, sobre todo, de qué NO tenemos ranking y por qué.
 *
 *
 * ============ DOS COSAS QUE NO SE PUEDEN OLVIDAR AL PINTAR ESTO ============
 *
 * · EN EL BSR, MENOS ES MEJOR. El puesto 1 es el que más vende. Una gráfica con
 *   el eje hacia arriba dice lo contrario de lo que pasa, y eso ya ha engañado a
 *   gente con más experiencia que nosotros. Por eso la gráfica va INVERTIDA
 *   —Serie con `invertido`— y por eso el cambio se escribe con la palabra
 *   «mejora» o «cae» y no con un signo: un «−400» se lee como una pérdida
 *   cuando es justo lo contrario.
 *
 * · UN HUECO EN LA SERIE NO ES UN CERO NI UNA LÍNEA RECTA. El servidor devuelve
 *   una observación por día MEDIDO; los días sin medir se rellenan aquí con
 *   `null`, que es lo que parte la línea en Serie. Unir los dos extremos
 *   dibujaría una tendencia que nadie ha observado, en una pantalla desde la que
 *   se decide sobre el dinero de otro.
 *
 *
 * ============ UN HUECO EXPLICADO NO ES UN HUECO ============
 *
 * Cuando una referencia no tiene ranking, la pantalla dice POR QUÉ, con las
 * palabras de porQueSinBsr(): puede ser que su cliente sea de reventa y su BSR no
 * se mida a diario —una decisión tomada a propósito, que ahorra unas seis horas
 * de ventana nocturna midiendo el producto de otro— o que la referencia no sea de
 * marca propia en un cliente mixto. Un «sin datos» a secas se lee como una
 * avería y manda a alguien a arreglar lo que no está roto.
 */
/**
 * La barra de arriba. NO lleva la altura fija de PANTALLA.filtros a propósito:
 * son dos selectores y seis chips, así que en una ventana estrecha se parte en
 * dos líneas, y con `h-8` la segunda se pinta encima de lo que hay debajo.
 *
 * Los anchos van con `max-w` y no con `w-auto`: `CAMPO.input` trae `w-full`, y
 * cuál de las dos gana lo decide el orden de la hoja compilada de Tailwind, no
 * el orden en el atributo. Es el mismo problema que documenta BOTON.chipEncendido
 * en denso.ts, resuelto aquí sin `!` porque un tope de ancho basta.
 */
const BARRA = 'flex shrink-0 flex-wrap items-center gap-[6px] min-w-0'
const ANCHO_CUENTA = 'max-w-[240px]'
const ANCHO_PAIS = 'max-w-[170px]'

export function PanelBsr({ data, conexionId, onConexionId }: PropsPanel) {
  const conexiones = useMemo(
    () => data.connections.filter((c) => c.is_active),
    [data.connections]
  )
  const nombrePorCliente = useMemo(
    () => new Map(data.clients.map((c) => [c.id, c.name])),
    [data.clients]
  )

  const conexion = conexiones.find((c) => c.id === conexionId) ?? null

  const [marketplaceId, setMarketplaceId] = useState('')
  const [dias, setDias] = useState(30)
  const [tipo, setTipo] = useState<TipoRankBsr>('grupo')

  useEffect(() => {
    if (!conexion) {
      setMarketplaceId('')
      return
    }
    setMarketplaceId(
      conexion.default_marketplace_id && conexion.marketplace_ids.includes(conexion.default_marketplace_id)
        ? conexion.default_marketplace_id
        : (conexion.marketplace_ids[0] ?? '')
    )
  }, [conexion])

  if (conexiones.length === 0) {
    return (
      <Vacio icono={<Plug />} titulo="Todavía no hay ninguna cuenta conectada">
        El ranking se mide por cuenta y país, así que primero hay que conectar la cuenta de Amazon
        del cliente en la pestaña <span className={TEXTO.t1}>Cuentas</span>.
      </Vacio>
    )
  }

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* Sin `h-8`: esta barra lleva dos selectores y seis chips, así que en
          cuanto la ventana se estrecha tiene que poder partirse en dos líneas.
          Con la altura fija, la segunda línea se pinta encima de la tabla. */}
      <div className={BARRA}>
        <select
          value={conexionId ?? ''}
          onChange={(e) => onConexionId(e.target.value || null)}
          className={`${CAMPO.input} ${ANCHO_CUENTA}`}
          aria-label="Cuenta"
        >
          <option value="">Elige una cuenta…</option>
          {conexiones.map((c) => (
            <option key={c.id} value={c.id}>
              {nombrePorCliente.get(c.client_id) ?? c.name}
              {c.name && c.name !== nombrePorCliente.get(c.client_id) ? ` · ${c.name}` : ''}
            </option>
          ))}
        </select>

        {conexion && conexion.marketplace_ids.length > 0 && (
          <select
            value={marketplaceId}
            onChange={(e) => setMarketplaceId(e.target.value)}
            className={`${CAMPO.input} ${ANCHO_PAIS}`}
            aria-label="País"
          >
            {conexion.marketplace_ids.map((m) => (
              <option key={m} value={m}>
                {marketplaceLabel(m)}
              </option>
            ))}
          </select>
        )}

        <div className={PANTALLA.separador} />

        {[7, 30, 90, 365].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDias(d)}
            className={`${BOTON.chip} ${dias === d ? BOTON.chipEncendido : ''}`}
          >
            {d === 365 ? '1 año' : `${d} días`}
          </button>
        ))}

        <div className={PANTALLA.separador} />

        {(
          [
            ['grupo', 'Categoría raíz'],
            ['categoria', 'Subcategoría'],
          ] as Array<[TipoRankBsr, string]>
        ).map(([id, nombre]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTipo(id)}
            className={`${BOTON.chip} ${tipo === id ? BOTON.chipEncendido : ''}`}
          >
            {nombre}
          </button>
        ))}
      </div>

      {conexion && marketplaceId ? (
        <Rankings
          key={`${conexion.id}·${marketplaceId}·${dias}·${tipo}`}
          clientId={conexion.client_id}
          connectionId={conexion.id}
          marketplaceId={marketplaceId}
          dias={dias}
          tipo={tipo}
        />
      ) : (
        <Vacio icono={<BarChart3 />} titulo="Elige una cuenta">
          El ranking de un producto es de su categoría y de su país: no hay una vista que mezcle
          clientes.
        </Vacio>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La vista                                                            */
/* ------------------------------------------------------------------ */

type Orden = 'puesto' | 'mejora' | 'caida' | 'reciente'

const ORDENES: Array<[Orden, string]> = [
  ['puesto', 'Mejor puesto'],
  ['mejora', 'Más ha mejorado'],
  ['caida', 'Más ha caído'],
  ['reciente', 'Medido antes'],
]

function Rankings({
  clientId,
  connectionId,
  marketplaceId,
  dias,
  tipo,
}: {
  clientId: string
  connectionId: string
  marketplaceId: string
  dias: number
  tipo: TipoRankBsr
}) {
  const [vista, setVista] = useState<VistaBsr | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [orden, setOrden] = useState<Orden>('puesto')
  const [abierta, setAbierta] = useState<string | null>(null)

  useEffect(() => {
    let cancelado = false
    void (async () => {
      const query = new URLSearchParams({
        clientId,
        connectionId,
        marketplaceId,
        dias: String(dias),
        tipo,
      })
      const res = await getAmazon<VistaBsr>(`/api/plataforma/bsr?${query.toString()}`)
      if (cancelado) return
      if (!res.ok) {
        setError(res.error)
        return
      }
      setError(null)
      setVista(res.data)
    })()
    return () => {
      cancelado = true
    }
  }, [clientId, connectionId, marketplaceId, dias, tipo])

  const filas = useMemo(() => ordenar(vista?.filas ?? [], orden), [vista, orden])
  const seleccionada = filas.find((f) => claveDe(f) === abierta) ?? filas[0] ?? null

  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!vista) return <Cargando texto="Leyendo los rankings…" />

  if (vista.totales.catalogo === 0) {
    return (
      <Vacio icono={<BarChart3 />} titulo="El espejo del catálogo está vacío">
        Todavía no se ha traído ni una referencia de Amazon en esta cuenta y país. El ranking se pide
        referencia a referencia, así que hasta que corra el censo del catálogo —desde{' '}
        <span className={TEXTO.t1}>Ingesta</span>— no hay a quién medírselo.
      </Vacio>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className={CIFRAS.tira}>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifra(vista.totales.enSeguimiento)}</span>
            <span className={CIFRAS.rotulo}>en seguimiento</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifra(vista.totales.conRanking)}</span>
            <span className={CIFRAS.rotulo}>con ranking</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifra(vista.totales.sinRanking)}</span>
            <span className={CIFRAS.rotulo}>sin ranking</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{cifra(vista.filas.length)}</span>
            <span className={CIFRAS.rotulo}>series</span>
          </span>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-[4px]">
          {ORDENES.map(([id, nombre]) => (
            <button
              key={id}
              type="button"
              onClick={() => setOrden(id)}
              className={`${BOTON.chip} ${orden === id ? BOTON.chipEncendido : ''}`}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>

      {/* Se queda en pantalla porque es accionable HOY: o se amplía la ventana, o
          hay una ingesta parada. Lo que explica el porqué está detrás del botón. */}
      {vista.filas.length === 0 && (
        <SinNingunRanking vista={vista} />
      )}

      {vista.truncado && (
        <Aviso tono="azul" icono={AlertTriangle}>
          Se están enseñando las series medidas más recientemente; hay más. Estrecha la ventana para
          verlas todas.
        </Aviso>
      )}

      {vista.filas.length > 0 && (
        <div className="grid min-h-0 flex-1 gap-2 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Tabla
            filas={filas}
            abierta={seleccionada ? claveDe(seleccionada) : null}
            onAbrir={setAbierta}
            dias={dias}
          />
          <aside className="flex min-w-0 flex-col gap-2 lg:min-h-0 lg:overflow-auto">
            {seleccionada && <Detalle fila={seleccionada} dias={dias} />}
            <SinRanking vista={vista} />
          </aside>
        </div>
      )}

      {vista.filas.length === 0 && <SinRanking vista={vista} />}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* La tabla                                                            */
/* ------------------------------------------------------------------ */

function Tabla({
  filas,
  abierta,
  onAbrir,
  dias,
}: {
  filas: FilaBsr[]
  abierta: string | null
  onAbrir: (clave: string) => void
  dias: number
}) {
  return (
    <div className={TABLA.caja}>
      <table className={TABLA.tabla}>
        <thead>
          <tr>
            <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>Referencia</th>
            <th className={TABLA.cabecera}>Categoría</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Puesto</th>
            <th className={TABLA.cabecera}>Cambio</th>
            <th className={TABLA.cabecera}>Evolución</th>
            <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Medido</th>
          </tr>
        </thead>
        <tbody>
          {filas.map((f) => {
            const clave = claveDe(f)
            return (
              <tr
                key={clave}
                onClick={() => onAbrir(clave)}
                className={`${TABLA.fila} cursor-pointer ${abierta === clave ? TABLA.filaSel : ''}`}
              >
                <td className={`${TABLA.celda} ${TABLA.celdaFija} ${TEXTO.t1} max-w-[200px]`}>
                  <span className={TABLA.corta} title={f.title ?? f.sku}>
                    {f.sku}
                  </span>
                </td>
                <td className={`${TABLA.celda} ${TEXTO.t3} max-w-[200px]`}>
                  <span className={TABLA.corta} title={f.categoria}>
                    {f.categoria}
                  </span>
                </td>
                <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1}`}>
                  #{cifra(f.ultimo)}
                </td>
                <td className={TABLA.celda}>
                  <Cambio delta={f.delta} />
                </td>
                <td className={`${TABLA.celda} w-[120px]`}>
                  <Chispa fila={f} dias={dias} />
                </td>
                <td className={`${TABLA.celda} ${TABLA.derecha} ${TEXTO.t3}`}>
                  {fechaCorta(f.ultimoAt)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * El cambio en la ventana, EN PALABRAS.
 *
 * Nunca «−412» a secas: en el BSR bajar de número es mejorar, así que un signo
 * menos se lee al revés de lo que significa. La palabra manda y el color la
 * acompaña, no al revés.
 */
function Cambio({ delta }: { delta: number | null }) {
  if (delta === null) {
    return (
      <span className={`${TIPO.s} ${TEXTO.t4}`} title="Medido un solo día: todavía no hay tendencia">
        un solo día
      </span>
    )
  }
  if (delta === 0) return <span className={`${TIPO.s} ${TEXTO.t4}`}>igual</span>

  const mejora = delta < 0
  return (
    <span
      className={`${TIPO.s} tabular-nums`}
      style={{ color: mejora ? COLOR_ESTADO.verde : COLOR_ESTADO.rojo }}
    >
      {mejora ? 'mejora' : 'cae'} {cifra(Math.abs(delta))}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Las gráficas                                                        */
/* ------------------------------------------------------------------ */

const UN_DIA = 86400000

/**
 * Los puntos de la ventana, CON SUS HUECOS.
 *
 * El servidor devuelve una observación por día medido. Aquí, entre dos
 * observaciones que no son de días consecutivos se mete un `null`, que es lo que
 * PARTE LA LÍNEA en Serie y en la chispa de la tabla. Es la diferencia entre «esa
 * noche no se midió» y «esa noche el puesto no cambió», que no son lo mismo y no
 * se pueden dibujar igual.
 *
 * El eje va de hoy hacia atrás la ventana entera aunque no haya datos en todo
 * ese tramo: una serie de tres días dibujada a lo ancho de noventa parecería
 * noventa días de mediciones.
 *
 * Un separador por hueco y no una rejilla día a día: con la ventana de un año y
 * trescientas series, la rejilla son cien mil puntos que se recalculan en cada
 * repintado para dibujar exactamente lo mismo.
 */
function puntosDe(fila: FilaBsr, dias: number): { puntos: Punto[]; desde: number; hasta: number } {
  const hasta = Date.now()
  const desde = hasta - (dias - 1) * UN_DIA
  const puntos: Punto[] = []

  let anterior: number | null = null
  for (const p of fila.puntos) {
    // Mediodía y no medianoche: la fecha se pinta en la zona horaria del
    // navegador, y un instante a las 00:00 UTC cae en el día anterior en cuanto
    // el reloj va por detrás de Greenwich.
    const t = new Date(`${p.dia}T12:00:00Z`).getTime()
    if (anterior !== null && t - anterior > UN_DIA * 1.5) {
      puntos.push({ t: anterior + (t - anterior) / 2, v: null })
    }
    puntos.push({
      t,
      v: p.rank,
      nota: `#${p.rank.toLocaleString('es-ES')} · ${new Date(t).toLocaleDateString('es-ES')}`,
    })
    anterior = t
  }

  return { puntos, desde, hasta }
}

/**
 * La chispa de la tabla: la misma serie en 110 × 18 px.
 *
 * Escrita aquí y no con Serie porque Serie mide 120 px de alto y lleva ejes: en
 * una fila de 28 px no cabe. Comparte las dos reglas que importan —eje invertido
 * y los huecos parten la línea— y no dibuja ninguna otra cosa, porque a este
 * tamaño cualquier adorno tapa el dato.
 */
function Chispa({ fila, dias }: { fila: FilaBsr; dias: number }) {
  const ANCHO = 110
  const ALTO = 18

  const { puntos, desde, hasta } = puntosDe(fila, dias)
  const conValor = puntos.filter((p) => p.v !== null) as Array<Punto & { v: number }>
  if (conValor.length === 0) return <span className={TEXTO.t4}>—</span>

  let min = fila.mejor
  let max = fila.peor
  if (min === max) {
    const aire = Math.max(1, Math.abs(min) * 0.05)
    min -= aire
    max += aire
  }

  const ventana = Math.max(1, hasta - desde)
  const x = (t: number) => ((t - desde) / ventana) * (ANCHO - 2) + 1
  // Invertido: el puesto MÁS BAJO, arriba.
  const y = (v: number) => ((v - min) / (max - min)) * (ALTO - 4) + 2

  const tramos: Array<Array<Punto & { v: number }>> = []
  let actual: Array<Punto & { v: number }> = []
  for (const p of puntos) {
    if (p.v === null) {
      if (actual.length > 0) tramos.push(actual)
      actual = []
    } else {
      actual.push(p as Punto & { v: number })
    }
  }
  if (actual.length > 0) tramos.push(actual)

  const ultimo = conValor[conValor.length - 1]

  return (
    <svg width={ANCHO} height={ALTO} className="block" role="img" aria-label={`Evolución de ${fila.sku}`}>
      {tramos.map((tramo, i) => (
        <polyline
          key={i}
          fill="none"
          stroke={COLOR_ESTADO.cian}
          strokeWidth={1.25}
          strokeLinejoin="round"
          strokeLinecap="round"
          points={tramo.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')}
        />
      ))}
      <circle cx={x(ultimo.t)} cy={y(ultimo.v)} r={1.75} fill={COLOR_ESTADO.cian} />
    </svg>
  )
}

function Detalle({ fila, dias }: { fila: FilaBsr; dias: number }) {
  const { puntos, desde, hasta } = puntosDe(fila, dias)

  return (
    <section className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} min-w-0`}>
      <header className={`flex items-start gap-2 border-b px-[10px] py-[7px] ${LINEA.normal}`}>
        <div className="min-w-0">
          <p className={`${TITULO.seccion} truncate`} title={fila.title ?? fila.sku}>
            {fila.sku}
          </p>
          <p className={`${TIPO.s} ${TEXTO.t3} truncate`} title={fila.categoria}>
            {fila.categoria}
          </p>
        </div>
      </header>

      <div className="px-[6px] py-[8px]">
        <Serie
          puntos={puntos}
          desde={desde}
          hasta={hasta}
          tono="cian"
          invertido
          formato={(v) => `#${v.toLocaleString('es-ES')}`}
          etiqueta={`Ranking de ${fila.sku}`}
        />
      </div>

      <dl className={`grid grid-cols-2 gap-x-2 gap-y-[5px] border-t px-[10px] py-[8px] ${LINEA.normal}`}>
        <Dato rotulo="Puesto ahora" valor={`#${cifra(fila.ultimo)}`} />
        <Dato rotulo="Cambio" valor={<Cambio delta={fila.delta} />} />
        <Dato rotulo="Mejor" valor={`#${cifra(fila.mejor)}`} />
        <Dato rotulo="Peor" valor={`#${cifra(fila.peor)}`} />
        <Dato rotulo="Lecturas" valor={cifra(fila.observaciones)} />
        <Dato rotulo="Última" valor={hace(fila.ultimoAt)} />
        <Dato rotulo="ASIN" valor={fila.asin ?? '—'} />
        <Dato rotulo="Marca" valor={fila.marca ?? '—'} />
      </dl>

      {!fila.enSeguimiento && (
        <p className={`${TIPO.s} ${TEXTO.t3} border-t px-[10px] py-[7px] ${LINEA.normal}`}>
          Tiene histórico pero hoy no está en el refresco diario: su serie se va a quedar donde
          está.
        </p>
      )}
    </section>
  )
}

function Dato({ rotulo, valor }: { rotulo: string; valor: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className={TITULO.rotulo}>{rotulo}</dt>
      <dd className={`${TIPO.m} ${TEXTO.t2} truncate tabular-nums`}>{valor}</dd>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Los huecos, explicados                                              */
/* ------------------------------------------------------------------ */

function SinNingunRanking({ vista }: { vista: VistaBsr }) {
  if (vista.ultimaMedicion === null) {
    return (
      <Aviso tono="azul" icono={BarChart3}>
        <span className={TEXTO.t1}>Nunca se ha medido el ranking en esta cuenta y país.</span>{' '}
        {vista.porQueNoADiario ??
          'El barrido de BSR todavía no ha corrido: se planifica de noche y la primera pasada tarda una noche entera.'}
      </Aviso>
    )
  }
  return (
    <Aviso tono="ambar" icono={TrendingDown}>
      <span className={TEXTO.t1}>Sin ninguna lectura en esta ventana.</span> La última fue{' '}
      {hace(vista.ultimaMedicion)}. Amplía la ventana para verla, o mira si la ingesta está parada.
    </Aviso>
  )
}

function SinRanking({ vista }: { vista: VistaBsr }) {
  if (vista.totales.sinRanking === 0) return null

  return (
    <section
      className={`${RADIO.r2} border ${LINEA.normal} ${SUPERFICIE.sup} min-w-0 px-[10px] py-[8px]`}
    >
      <h3 className={`${TITULO.rotulo} mb-[5px]`}>
        Sin ranking · {cifra(vista.totales.sinRanking)}
      </h3>

      {vista.porQueNoADiario && (
        <p className={`${TIPO.s} ${TEXTO.t3} mb-[6px]`}>{vista.porQueNoADiario}</p>
      )}

      <ul className="space-y-[3px]">
        {vista.sinRankingMuestra.map((s) => (
          <li key={s.sku} className="min-w-0">
            <span className="flex items-baseline gap-[6px]">
              <span className={`${TIPO.s} ${TEXTO.t2} truncate`}>{s.sku}</span>
              <span className={`${TIPO.s} ${TEXTO.t4} ml-auto shrink-0`}>
                {s.esMarcaPropia ? 'marca propia' : 'reventa'}
              </span>
            </span>
            {s.motivo && (
              <span className={`${TIPO.s} ${TEXTO.t4} block truncate`} title={s.motivo}>
                {s.motivo}
              </span>
            )}
          </li>
        ))}
      </ul>

      {vista.sinRankingMuestra.length < vista.totales.sinRanking && (
        <p className={`${TIPO.s} ${TEXTO.t4} mt-[5px]`}>
          y {cifra(vista.totales.sinRanking - vista.sinRankingMuestra.length)} más
        </p>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Utilidad                                                            */
/* ------------------------------------------------------------------ */

/** Una serie es un SKU EN UNA CATEGORÍA: el mismo SKU puede tener dos */
function claveDe(fila: FilaBsr): string {
  return `${fila.sku}·${fila.categoriaId ?? fila.categoria}`
}

function ordenar(filas: FilaBsr[], orden: Orden): FilaBsr[] {
  const copia = [...filas]
  switch (orden) {
    case 'puesto':
      // Menos es mejor.
      return copia.sort((a, b) => a.ultimo - b.ultimo || a.sku.localeCompare(b.sku, 'es'))
    case 'mejora':
      // Delta negativo = ha mejorado. Sin tendencia, al final.
      return copia.sort(
        (a, b) => (a.delta ?? Infinity) - (b.delta ?? Infinity) || a.sku.localeCompare(b.sku, 'es')
      )
    case 'caida':
      return copia.sort(
        (a, b) => (b.delta ?? -Infinity) - (a.delta ?? -Infinity) || a.sku.localeCompare(b.sku, 'es')
      )
    case 'reciente':
      // La medida hace más tiempo primero: es la que más se está quedando atrás.
      return copia.sort((a, b) => (a.ultimoAt < b.ultimoAt ? -1 : a.ultimoAt > b.ultimoAt ? 1 : 0))
  }
}

/* ------------------------------------------------------------------ */
/* La información, detrás del botón                                    */
/* ------------------------------------------------------------------ */

export function InfoBsr() {
  return (
    <>
      <SeccionInfo titulo="Qué es el BSR">
        <p>
          El puesto que ocupa un producto en su categoría de Amazon por unidades vendidas.{' '}
          <strong>El 1 es el que más vende</strong>: aquí bajar de número es mejorar, y por eso la
          gráfica va del revés y el cambio se escribe «mejora» o «cae» en vez de con un signo.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Categoría raíz y subcategoría son dos series distintas">
        <p>
          Amazon devuelve las dos: el número grande de la categoría raíz («#72.855 en Electrónica»)
          y el de la subcategoría de la ficha («#113 en Televisores QLED»). Mezclarlas en una sola
          serie la deja sin significado, así que el interruptor de arriba elige una y la tabla
          separa una fila por cada categoría.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Qué significa según el cliente">
        <ListaInfo>
          <li>
            <strong>Marca propia</strong> — el producto es suyo, así que el ranking es su termómetro
            directo. Si sube o baja, es cosa suya.
          </li>
          <li>
            <strong>Reventa</strong> — el ranking es del <em>producto</em>, no de su cuenta. Puede
            mejorar mientras el cliente pierde todas sus ventas por no tener la Buy Box, y al revés.
            Ahí lo que decide es Buy Box y precio, no esto.
          </li>
        </ListaInfo>
        <p>
          Aun así se guarda en reventa: sin datos de velocidad de venta, es la única señal de
          rotación que queda para decidir si un producto FBM merece pasar a FBA.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="No todas las referencias tienen ranking, y es a propósito">
        <p>
          Medirlo cuesta una llamada por referencia y Amazon las sirve a dos por segundo: un catálogo
          de trece mil son unas <strong>seis horas cada noche</strong>. Qué se mide se decide en la
          pestaña <strong>Cuentas</strong> —la política del cliente— y se afina en{' '}
          <strong>Seguimiento</strong>.
        </p>
        <p>
          Cuando una referencia no tiene ranking, la pantalla dice <em>por qué</em>. Un hueco
          explicado no es un hueco; un «sin datos» a secas se lee como una avería y manda a alguien a
          arreglar lo que no está roto.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Los huecos de la serie se ven">
        <p>
          Si una noche no se midió, en la gráfica hay un hueco. No se une con una recta ni se rellena
          con el último valor: eso inventaría una tendencia que nadie ha observado, y estas gráficas
          se usan para decidir sobre el dinero de otros.
        </p>
        <p>
          Por lo mismo, una referencia medida un solo día no dice «0 de cambio»: dice{' '}
          <strong>«un solo día»</strong>. Con un punto no hay tendencia.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Una lectura por día, la última">
        <p>
          Si una noche se midió dos veces, se enseña la última y no la media: un puesto es la foto de
          un instante, y promediar dos fotos inventa un número que Amazon nunca dio.
        </p>
      </SeccionInfo>

      <SeccionInfo titulo="Un cliente por vista">
        <p>
          No hay ninguna pantalla que mezcle rankings de varios clientes, ni una media, ni una
          comparativa. Es el compromiso firmado ante Amazon: los datos de un vendedor se usan
          exclusivamente para operar <strong>su</strong> cuenta.
        </p>
      </SeccionInfo>
    </>
  )
}
