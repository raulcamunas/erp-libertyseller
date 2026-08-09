'use client'

import { useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Loader2,
  Play,
  ShieldAlert,
  Upload,
} from 'lucide-react'
import { toast } from 'sonner'
import { subirAmazon, type SimulacroResponse } from '@/lib/amazon/client'
import {
  ESTADO_FILA_LABELS,
  MOTIVO_HUERFANO_LABELS,
  type EstadoFila,
  type FilaSimulacro,
} from '@/lib/stock-sync/simulacro'
import {
  STOCK_BRAKE_LABELS,
  STOCK_MATCH_METHOD_LABELS,
  matchMethodColor,
  type StockReadProfile,
} from '@/lib/types/stock-sync'
import {
  cardShell,
  fieldInput,
  filterChip,
  formatImporte,
  formatInt,
  ghostButton,
  infoBox,
  primaryButton,
  warnBox,
} from './shared'

/**
 * EL SIMULACRO EN PANTALLA.
 *
 * Enseña lo que se mandaría CONTRASTADO CONTRA EL CATÁLOGO QUE AMAZON TIENE
 * AHORA MISMO, y no lo manda. Arriba el resumen, en medio los frenos y abajo el
 * detalle línea a línea, filtrable.
 *
 * Las tres listas están separadas y no mezcladas en una tabla con un filtro,
 * porque son tres preguntas distintas:
 *
 *   · Detalle    — qué le pasaría a cada SKU que el fichero sí resuelve.
 *   · Sin casar  — filas del mapeo que no encuentran su artículo en el fichero.
 *   · Huérfanos  — SKU que Amazon tiene y el fichero NO menciona. Es la pregunta
 *                  que nadie hace y la que explica un listing que se queda con
 *                  stock viejo para siempre.
 *
 * NOTA SOBRE LOS IMPORTS: de lib/stock-sync solo se toca simulacro.ts, que no
 * arrastra la librería xlsx (el motor sí, y son cerca de un mega en el paquete
 * del navegador). Por eso las etiquetas salen de allí y no de engine.ts.
 */

/** Las vistas del detalle. Cada una contesta una pregunta distinta */
type Vista = 'detalle' | 'sin_casar' | 'huerfanos'

/** Filtros del detalle */
type Filtro = 'todos' | 'cambian' | 'a_cero' | 'suben' | 'bajan' | 'precio' | 'problemas'

const FILTRO_LABELS: Record<Filtro, string> = {
  todos: 'Todos',
  cambian: 'Cambian',
  a_cero: 'Se van a cero',
  suben: 'Sube el stock',
  bajan: 'Baja el stock',
  precio: 'Cambia el precio',
  problemas: 'No se pueden escribir',
}

/**
 * Espejo de UnmatchedReason de lib/stock-sync/engine.ts (ver la nota de arriba
 * sobre por qué no se importa). La respuesta ya trae la frase completa en
 * `detail`, así que un motivo nuevo del motor se seguiría enseñando bien: lo
 * único que se perdería es esta etiqueta corta.
 */
const SIN_CASAR_LABELS: Record<string, string> = {
  sin_referencia: 'Sin referencia en el mapeo',
  sin_articulo: 'No está en el fichero',
  ref_ambigua: 'Referencia ambigua',
  ean_ambiguo: 'EAN ambiguo',
  sku_vacio: 'Sin SKU',
}

export function SimulacroPanel({ perfil }: { perfil: StockReadProfile }) {
  const [stockFile, setStockFile] = useState<File | null>(null)
  const [eanFile, setEanFile] = useState<File | null>(null)
  const [resultado, setResultado] = useState<SimulacroResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const resultadoRef = useRef<HTMLDivElement>(null)

  const manual = perfil.origen === 'manual'

  async function ejecutar() {
    if (manual && !stockFile) {
      toast.error('Elige el fichero de stock del cliente')
      return
    }
    setCargando(true)
    setError(null)

    const form = new FormData()
    if (stockFile) form.append('fichero', stockFile)
    if (eanFile) form.append('ean', eanFile)

    const res = await subirAmazon<SimulacroResponse>(
      `/api/amazon/perfiles/${perfil.id}/simulacro`,
      form
    )
    setCargando(false)

    if (!res.ok) {
      setError(res.error)
      setResultado(null)
      return
    }

    setResultado(res.data)
    const r = res.data.simulacro.resumen
    toast.success(
      `${r.skuCambian.toLocaleString('es-ES')} de ${r.skuEnFichero.toLocaleString('es-ES')} SKU cambiarían. No se ha enviado nada.`
    )
    requestAnimationFrame(() =>
      resultadoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    )
  }

  return (
    <div className="space-y-3 pb-6 min-w-0">
      {/* ---------------- Lanzar ---------------- */}
      <section className={`${cardShell} p-3 space-y-2.5`}>
        <div>
          <h3 className="text-[12px] font-semibold text-white">Simulacro</h3>
          <p className="text-[10px] text-white/35 mt-px">
            Lee, aplica las reglas, cruza y contrasta contra el catálogo de Amazon.{' '}
            <strong className="text-white/55">No envía nada.</strong>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {manual && (
            <SelectorFichero
              etiqueta="Fichero de stock"
              fichero={stockFile}
              onChange={setStockFile}
            />
          )}
          {/*
            EL DE EAN SE OFRECE SIEMPRE, no solo cuando el perfil de stock es
            manual. Un perfil nuevo nace con origen 'manual', así que lo normal
            es tener el de stock en Drive y el de códigos de barras todavía en
            manual — y con la condición de antes no había forma de aportarlo, así
            que el simulacro de ese cliente se hacía SIN la vía por EAN sin que
            nadie pudiera evitarlo. Con los datos reales eso son 245 de 395
            referencias que dejan de resolverse por su código de barras.
          */}
          <SelectorFichero
            etiqueta="Fichero de EAN (opcional)"
            fichero={eanFile}
            onChange={setEanFile}
          />

          <button type="button" onClick={ejecutar} disabled={cargando} className={primaryButton}>
            {cargando ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            Ejecutar simulacro
          </button>
        </div>

        {/* Una línea. El porqué —que sin el fichero de EAN el cruce pierde la vía
            por código de barras, que resuelve 245 de 395 referencias con los
            datos reales— está detrás del botón de información de la cabecera. */}
        <p className="text-[11px] text-white/45 leading-relaxed">
          {!manual && 'El de stock se coge del origen configurado. '}
          El de EAN es opcional y cambia mucho el resultado.
        </p>

        {error && (
          <div className={warnBox}>
            <p className="whitespace-pre-line">{error}</p>
          </div>
        )}
      </section>

      {resultado && (
        <div ref={resultadoRef} className="space-y-3 min-w-0">
          <Frenos resultado={resultado} />
          <Resumen resultado={resultado} />
          <Detalle resultado={resultado} />
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Frenos                                                              */
/* ------------------------------------------------------------------ */

/**
 * Lo primero que se ve, y a propósito: si un freno ha saltado, todo lo de abajo
 * es «lo que se habría mandado», no «lo que se va a mandar». Enterrarlo debajo
 * del resumen invita a leer los números como si fueran a ocurrir.
 */
function Frenos({ resultado }: { resultado: SimulacroResponse }) {
  const { frenos } = resultado.simulacro
  const saltaron = frenos.saltaron
  const huecos = frenos.huecos ?? []

  /**
   * «NINGÚN FRENO SALTA» NO SE PUEDE DECIR CUANDO NO SE HA MIRADO NINGUNO.
   *
   * El titular se decidía solo con `saltaron.length > 0`, así que un perfil
   * recién creado —sin saber cuántas líneas trae su fichero un día normal, sin
   * límite de cambios por lote y con el espejo del catálogo todavía vacío—
   * coronaba tres frenos sin evaluar con un tick verde y esa frase. Y es EL
   * momento en el que alguien decide encender el envío automático: lo que lee
   * es justo lo contrario de lo que pasa.
   */
  const tono =
    saltaron.length > 0 ? 'rojo' : huecos.length > 0 ? 'ambar' : 'verde'

  const titular =
    saltaron.length > 0
      ? `Ha saltado ${saltaron.length === 1 ? 'un freno' : `${saltaron.length} frenos`}: no se mandaría nada`
      : huecos.length > 0
        ? `Se ${frenos.medidos === 1 ? 'ha medido' : 'han medido'} ${frenos.medidos} de ${frenos.aplicables} frenos y no ha saltado ninguno`
        : 'Los frenos se han medido todos y no salta ninguno'

  return (
    <section
      className={`rounded-2xl border p-3 ${
        tono === 'rojo'
          ? 'border-red-500/30 bg-red-500/[0.08]'
          : tono === 'ambar'
            ? 'border-yellow-500/25 bg-yellow-400/[0.06]'
            : 'border-white/10 bg-white/[0.02]'
      }`}
    >
      <div className="flex items-start gap-2">
        {tono === 'rojo' ? (
          <ShieldAlert className="h-4 w-4 text-red-400 flex-shrink-0 mt-px" />
        ) : tono === 'ambar' ? (
          <AlertTriangle className="h-4 w-4 text-yellow-400 flex-shrink-0 mt-px" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-px" />
        )}
        <div className="min-w-0 flex-1">
          <p
            className={`text-[12px] font-semibold ${
              tono === 'rojo' ? 'text-red-300' : tono === 'ambar' ? 'text-yellow-300' : 'text-white'
            }`}
          >
            {titular}
          </p>

          {tono === 'ambar' && (
            <p className="mt-1 text-[11px] text-yellow-300/80 leading-relaxed">
              No es que no salten: es que no se han podido mirar. Con el envío automático encendido,
              un freno que no se puede comprobar impide mandar.
            </p>
          )}

          <ul className="mt-1.5 space-y-1">
            {frenos.todos.map((f) => {
              const hueco = f.estado === 'sin_umbral' || f.estado === 'sin_datos'
              const color = f.salta
                ? 'text-red-300'
                : hueco
                  ? 'text-yellow-300/90'
                  : 'text-white/45'
              return (
                <li key={f.codigo} className="text-[11px] leading-relaxed min-w-0 flex gap-1.5">
                  {/* Cada línea lleva su propio icono: sin él, un freno sin
                      medir se distinguía de uno medido solo por el gris, que es
                      justo lo que nadie mira. */}
                  <span className={`flex-shrink-0 ${color}`} aria-hidden>
                    {f.salta ? '■' : hueco ? '▲' : f.estado === 'no_aplica' ? '·' : '✓'}
                  </span>
                  <span className="min-w-0">
                    <span className={`${color} ${f.salta || hueco ? 'font-medium' : ''}`}>
                      {STOCK_BRAKE_LABELS[f.codigo]}:
                    </span>{' '}
                    <span className={color}>{f.frase}</span>
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

function Resumen({ resultado }: { resultado: SimulacroResponse }) {
  const { simulacro, fichero, destino, lectura } = resultado
  const r = simulacro.resumen

  const kpis: Array<{ label: string; valor: number; tono: string; hint: string }> = [
    {
      label: 'SKU que cambian',
      valor: r.skuCambian,
      tono: r.skuCambian > 0 ? 'text-[#FF6600]' : 'text-white/40',
      hint: 'SKU con al menos un cambio de stock o de precio respecto a lo que Amazon tiene ahora',
    },
    {
      label: 'Sube el stock',
      valor: r.stockSuben,
      tono: 'text-white',
      hint: 'Pasarían a tener más unidades de las publicadas',
    },
    {
      label: 'Baja el stock',
      valor: r.stockBajan,
      tono: 'text-white',
      hint: 'Pasarían a tener menos unidades, sin llegar a cero',
    },
    {
      label: 'Se van a cero',
      valor: r.stockACero,
      tono: r.stockACero > 0 ? 'text-red-300' : 'text-white/40',
      hint: 'Tienen unidades publicadas y pasarían a cero. Es el número que decide si esto se manda',
    },
    {
      label: 'Precios que cambian',
      valor: r.precioCambian,
      tono: r.precioCambian > 0 ? 'text-yellow-300' : 'text-white/40',
      hint: `${r.precioSuben} suben · ${r.precioBajan} bajan`,
    },
    {
      label: 'No casan',
      valor: r.sinCasar,
      tono: r.sinCasar > 0 ? 'text-yellow-300' : 'text-white/40',
      hint: 'Filas del mapeo que no encuentran su artículo en el fichero',
    },
    {
      label: 'Amazon no los trae el fichero',
      valor: r.huerfanos,
      tono: r.huerfanosConStock > 0 ? 'text-red-300' : 'text-white/40',
      hint: `${r.huerfanosConStock} de ellos tienen unidades publicadas: ese stock se queda como está para siempre`,
    },
    {
      label: 'No se pueden escribir',
      valor: r.bloqueados,
      tono: r.bloqueados > 0 ? 'text-yellow-300' : 'text-white/40',
      hint: 'Normalmente FBA, o listings de los que no conocemos el tipo de producto',
    },
  ]

  return (
    <section className="space-y-2.5 min-w-0">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-white/45 min-w-0">
        <span className="truncate max-w-[280px]">
          Fichero <strong className="text-white/75">{fichero.nombre}</strong>
        </span>
        <span>
          Hoja <strong className="text-white/75">{lectura.hoja}</strong>
        </span>
        <span>
          <strong className="text-white/75 tabular-nums">
            {r.skuEnFichero.toLocaleString('es-ES')}
          </strong>{' '}
          SKU resueltos de{' '}
          <strong className="text-white/75 tabular-nums">
            {r.skuEnAmazon.toLocaleString('es-ES')}
          </strong>{' '}
          en Amazon
        </span>
        <span>
          <strong className="text-white/75 tabular-nums">
            {r.unidadesTotal.toLocaleString('es-ES')}
          </strong>{' '}
          unidades
        </span>
        {destino ? (
          <span className="truncate">
            Contra <strong className="text-white/75">{destino.connectionName}</strong>
          </span>
        ) : (
          <span className="text-yellow-300">Sin conexión de Amazon: no hay contraste</span>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 min-w-0">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2 min-w-0"
            title={k.hint}
          >
            <p className="text-[10px] uppercase tracking-wider text-white/35 truncate">{k.label}</p>
            <p className={`font-bold text-[19px] mt-0.5 tabular-nums truncate ${k.tono}`}>
              {k.valor.toLocaleString('es-ES')}
            </p>
          </div>
        ))}
      </div>

      {simulacro.avisos.length > 0 && (
        <div className={warnBox}>
          <ul className="space-y-1">
            {simulacro.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}

      {simulacro.mayoresSaltos.length > 0 && (
        <div className={`${cardShell} p-3 min-w-0`}>
          <h4 className="text-[11px] font-semibold text-white mb-1.5">
            Los mayores saltos de precio
          </h4>
          <p className="text-[10px] text-white/35 mb-2">
            Se mira la línea peor y no la media: un solo precio dividido por diez es exactamente lo
            que hay que ver, y promediando no se nota.
          </p>
          <div className="space-y-1">
            {simulacro.mayoresSaltos.slice(0, 8).map((f) => (
              <div
                key={f.sku}
                className="flex items-center justify-between gap-2 text-[11px] min-w-0"
              >
                <span className="text-white/70 truncate min-w-0">{f.sku}</span>
                <span className="flex items-center gap-1.5 flex-shrink-0 tabular-nums">
                  <span className="text-white/45">{formatImporte(f.precio.amazon, simulacro.moneda)}</span>
                  <span className="text-white/25">→</span>
                  <span className="text-white">{formatImporte(f.precio.nuevo, simulacro.moneda)}</span>
                  <Variacion pct={f.variacionPrecioPct} />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Detalle                                                             */
/* ------------------------------------------------------------------ */

function Detalle({ resultado }: { resultado: SimulacroResponse }) {
  const { simulacro, recortado } = resultado
  const [vista, setVista] = useState<Vista>('detalle')
  const [filtro, setFiltro] = useState<Filtro>('cambian')
  const [busqueda, setBusqueda] = useState('')

  const termino = busqueda.trim().toLowerCase()

  const filas = useMemo(() => {
    let out = simulacro.filas

    switch (filtro) {
      case 'cambian':
        out = out.filter((f) => f.estado === 'cambia')
        break
      case 'a_cero':
        out = out.filter((f) => f.seVaACero)
        break
      case 'suben':
        out = out.filter(
          (f) => f.stock.cambia && !f.seVaACero && (f.stock.nuevo ?? 0) > (f.stock.amazon ?? 0)
        )
        break
      case 'bajan':
        out = out.filter(
          (f) => f.stock.cambia && !f.seVaACero && (f.stock.nuevo ?? 0) < (f.stock.amazon ?? 0)
        )
        break
      case 'precio':
        out = out.filter((f) => f.precio.cambia)
        break
      case 'problemas':
        out = out.filter((f) => f.estado === 'bloqueado' || f.estado === 'sin_listing')
        break
      default:
        break
    }

    if (termino) {
      out = out.filter(
        (f) =>
          f.sku.toLowerCase().includes(termino) ||
          f.articulo.toLowerCase().includes(termino) ||
          (f.titulo ?? '').toLowerCase().includes(termino) ||
          f.descripcion.toLowerCase().includes(termino)
      )
    }

    return out
  }, [simulacro.filas, filtro, termino])

  const huerfanos = useMemo(() => {
    if (!termino) return simulacro.huerfanos
    return simulacro.huerfanos.filter(
      (h) =>
        h.sku.toLowerCase().includes(termino) || (h.titulo ?? '').toLowerCase().includes(termino)
    )
  }, [simulacro.huerfanos, termino])

  const sinCasar = useMemo(() => {
    if (!termino) return simulacro.sinCasar
    return simulacro.sinCasar.filter(
      (u) =>
        u.sku.toLowerCase().includes(termino) || (u.refErp ?? '').toLowerCase().includes(termino)
    )
  }, [simulacro.sinCasar, termino])

  return (
    <section className={`${cardShell} p-3 space-y-2.5 min-w-0`}>
      {/* Las tres preguntas */}
      <div className="flex flex-wrap gap-1.5">
        <Pestana activa={vista === 'detalle'} onClick={() => setVista('detalle')}>
          Detalle ({simulacro.filas.length.toLocaleString('es-ES')})
        </Pestana>
        <Pestana activa={vista === 'sin_casar'} onClick={() => setVista('sin_casar')}>
          No casan ({simulacro.resumen.sinCasar.toLocaleString('es-ES')})
        </Pestana>
        <Pestana activa={vista === 'huerfanos'} onClick={() => setVista('huerfanos')}>
          Amazon sí, fichero no ({simulacro.resumen.huerfanos.toLocaleString('es-ES')})
        </Pestana>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 min-w-0">
        <input
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar por SKU, artículo o título…"
          className={`${fieldInput} max-w-[280px]`}
        />
        {vista === 'detalle' &&
          (Object.keys(FILTRO_LABELS) as Filtro[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFiltro(f)}
              className={filterChip(filtro === f)}
            >
              {FILTRO_LABELS[f]}
            </button>
          ))}
      </div>

      {vista === 'detalle' && (
        <TablaDetalle filas={filas} moneda={simulacro.moneda} recortado={recortado.filas} />
      )}
      {vista === 'sin_casar' && <TablaSinCasar filas={sinCasar} recortado={recortado.sinCasar} />}
      {vista === 'huerfanos' && (
        <TablaHuerfanos filas={huerfanos} moneda={simulacro.moneda} recortado={recortado.huerfanos} />
      )}
    </section>
  )
}

function TablaDetalle({
  filas,
  moneda,
  recortado,
}: {
  filas: FilaSimulacro[]
  moneda: string
  recortado: boolean
}) {
  if (filas.length === 0) return <Vacio>No hay ninguna línea que encaje con este filtro.</Vacio>

  return (
    <>
      <div className="overflow-x-auto min-w-0 rounded-xl border border-white/10">
        <table className="w-full min-w-[860px] text-[11px] border-collapse">
          <thead>
            <tr className="bg-white/[0.03]">
              <Th>SKU</Th>
              <Th>Artículo</Th>
              <Th>Producto</Th>
              <Th>Vía</Th>
              <Th className="text-right">Stock ahora</Th>
              <Th className="text-right">Stock nuevo</Th>
              <Th className="text-right">Precio ahora</Th>
              <Th className="text-right">Precio nuevo</Th>
              <Th>Qué pasaría</Th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 500).map((f) => (
              <tr
                key={f.sku}
                className="border-t border-white/[0.06] hover:bg-white/[0.03] transition-colors"
              >
                <Td className="text-white font-medium whitespace-nowrap">{f.sku}</Td>
                <Td className="text-white/55 whitespace-nowrap">{f.articulo}</Td>
                <Td className="text-white/45 max-w-[200px] truncate">
                  {f.titulo || f.descripcion || '—'}
                </Td>
                <Td>
                  <span
                    className="text-[10px] whitespace-nowrap"
                    style={{ color: matchMethodColor(f.via) }}
                    title={STOCK_MATCH_METHOD_LABELS[f.via]}
                  >
                    {STOCK_MATCH_METHOD_LABELS[f.via]}
                  </span>
                </Td>
                <Td className="text-right tabular-nums text-white/45">
                  {f.stock.amazon === null ? '—' : formatInt(f.stock.amazon)}
                  {f.esFba && <span className="text-white/25 ml-1">FBA</span>}
                </Td>
                <Td
                  className={`text-right tabular-nums font-semibold ${
                    f.seVaACero
                      ? 'text-red-300'
                      : f.stock.cambia
                        ? 'text-[#FF6600]'
                        : 'text-white/30'
                  }`}
                >
                  {f.stock.nuevo === null ? '—' : formatInt(f.stock.nuevo)}
                </Td>
                <Td className="text-right tabular-nums text-white/45">
                  {formatImporte(f.precio.amazon, moneda)}
                </Td>
                <Td
                  className={`text-right tabular-nums font-semibold ${
                    f.precio.cambia ? 'text-yellow-300' : 'text-white/30'
                  }`}
                >
                  {formatImporte(f.precio.nuevo, moneda)}
                  {f.precio.cambia && <Variacion pct={f.variacionPrecioPct} />}
                </Td>
                <Td>
                  <Estado estado={f.estado} motivo={f.motivo} />
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pie mostradas={Math.min(filas.length, 500)} total={filas.length} recortado={recortado} />
    </>
  )
}

function TablaSinCasar({
  filas,
  recortado,
}: {
  filas: SimulacroResponse['simulacro']['sinCasar']
  recortado: boolean
}) {
  if (filas.length === 0) {
    return <Vacio>Todas las filas del mapeo han encontrado su artículo en el fichero.</Vacio>
  }

  return (
    <>
      <div className={infoBox}>
        Estas filas del mapeo del cliente no encuentran su artículo en el fichero, así que su
        listing se queda como está. Se arreglan completando el mapeo o revisando el volcado, según
        el motivo.
      </div>
      <div className="overflow-x-auto min-w-0 rounded-xl border border-white/10">
        <table className="w-full min-w-[620px] text-[11px] border-collapse">
          <thead>
            <tr className="bg-white/[0.03]">
              <Th>SKU</Th>
              <Th>Referencia del ERP</Th>
              <Th>Motivo</Th>
              <Th>Detalle</Th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 500).map((u) => (
              <tr key={`${u.sku}-${u.reason}`} className="border-t border-white/[0.06]">
                <Td className="text-white font-medium whitespace-nowrap">{u.sku || '—'}</Td>
                <Td className="text-white/55 whitespace-nowrap">{u.refErp || '—'}</Td>
                <Td className="text-yellow-300 whitespace-nowrap">
                  {SIN_CASAR_LABELS[u.reason] ?? u.reason}
                </Td>
                <Td className="text-white/45">{u.detail}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pie mostradas={Math.min(filas.length, 500)} total={filas.length} recortado={recortado} />
    </>
  )
}

function TablaHuerfanos({
  filas,
  moneda,
  recortado,
}: {
  filas: SimulacroResponse['simulacro']['huerfanos']
  moneda: string
  recortado: boolean
}) {
  if (filas.length === 0) {
    return <Vacio>El fichero menciona todos los SKU que Amazon tiene publicados.</Vacio>
  }

  return (
    <>
      <div className={warnBox}>
        <strong>La pregunta que nadie hace.</strong> Estos SKU están publicados en Amazon y el
        fichero del cliente no los menciona, así que su stock se queda como está indefinidamente.
        Los que tienen unidades siguen vendiendo con un dato que ya no se actualiza.
      </div>
      <div className="overflow-x-auto min-w-0 rounded-xl border border-white/10">
        <table className="w-full min-w-[620px] text-[11px] border-collapse">
          <thead>
            <tr className="bg-white/[0.03]">
              <Th>SKU</Th>
              <Th>Producto</Th>
              <Th className="text-right">Stock publicado</Th>
              <Th className="text-right">Precio</Th>
              <Th>Por qué no se toca</Th>
            </tr>
          </thead>
          <tbody>
            {filas.slice(0, 500).map((h) => (
              <tr key={h.sku} className="border-t border-white/[0.06]">
                <Td className="text-white font-medium whitespace-nowrap">{h.sku}</Td>
                <Td className="text-white/45 max-w-[240px] truncate">{h.titulo || '—'}</Td>
                <Td
                  className={`text-right tabular-nums font-semibold ${
                    (h.stock ?? 0) > 0 ? 'text-red-300' : 'text-white/30'
                  }`}
                >
                  {h.stock === null ? '—' : formatInt(h.stock)}
                  {h.esFba && <span className="text-white/25 ml-1">FBA</span>}
                </Td>
                <Td className="text-right tabular-nums text-white/45">
                  {formatImporte(h.precio, moneda)}
                </Td>
                <Td className="text-white/45">{MOTIVO_HUERFANO_LABELS[h.motivo]}</Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pie mostradas={Math.min(filas.length, 500)} total={filas.length} recortado={recortado} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas                                                              */
/* ------------------------------------------------------------------ */

function SelectorFichero({
  etiqueta,
  fichero,
  onChange,
}: {
  etiqueta: string
  fichero: File | null
  onChange: (f: File | null) => void
}) {
  return (
    <label className={`${ghostButton} cursor-pointer`} title={etiqueta}>
      <Upload className="h-3.5 w-3.5" />
      <span className="truncate max-w-[180px]">{fichero ? fichero.name : etiqueta}</span>
      <input
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null)
          // Se limpia para que volver a elegir el MISMO fichero dispare el
          // change: sin esto, corregirlo y resubirlo no hace nada.
          e.target.value = ''
        }}
      />
    </label>
  )
}

function Pestana({
  activa,
  onClick,
  children,
}: {
  activa: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={activa}
      className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
        activa
          ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
          : 'border-white/10 bg-white/[0.02] text-white/45 hover:text-white hover:border-white/20'
      }`}
    >
      {children}
    </button>
  )
}

function Estado({ estado, motivo }: { estado: EstadoFila; motivo: string | null }) {
  const tono: Record<EstadoFila, string> = {
    cambia: 'text-[#FF6600]',
    igual: 'text-white/30',
    sin_listing: 'text-yellow-300',
    bloqueado: 'text-yellow-300',
    sin_envio: 'text-white/30',
  }

  return (
    <span className="flex items-center gap-1 min-w-0" title={motivo ?? undefined}>
      {(estado === 'bloqueado' || estado === 'sin_listing') && (
        <AlertTriangle className="h-3 w-3 flex-shrink-0 text-yellow-300" />
      )}
      <span className={`${tono[estado]} truncate max-w-[220px]`}>
        {motivo ?? ESTADO_FILA_LABELS[estado]}
      </span>
    </span>
  )
}

function Variacion({ pct }: { pct: number | null }) {
  if (pct === null || !Number.isFinite(pct)) return null
  const sube = pct > 0
  return (
    <span
      className={`ml-1 inline-flex items-center text-[10px] ${sube ? 'text-green-400' : 'text-red-400'}`}
    >
      {sube ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(pct) < 10 ? Math.abs(pct).toFixed(1) : Math.round(Math.abs(pct))}%
    </span>
  )
}

function Vacio({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.02] px-4 py-6 text-center">
      <p className="text-[12px] text-white/35">{children}</p>
    </div>
  )
}

function Pie({
  mostradas,
  total,
  recortado,
}: {
  mostradas: number
  total: number
  recortado: boolean
}) {
  return (
    <p className="text-[10px] text-white/35">
      Se ven {mostradas.toLocaleString('es-ES')} de {total.toLocaleString('es-ES')}.
      {recortado && ' El servidor ha recortado la lista; los totales de arriba sí son los de verdad.'}
    </p>
  )
}

function Th({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      className={`px-2 py-1.5 text-left text-[10px] font-semibold text-white/40 uppercase tracking-wider whitespace-nowrap ${className}`}
    >
      {children}
    </th>
  )
}

function Td({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <td className={`px-2 py-1 ${className}`}>{children}</td>
}

