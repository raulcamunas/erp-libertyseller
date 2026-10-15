'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ClipboardCheck,
  Download,
  ExternalLink,
  EyeOff,
  Info,
  Loader2,
  Play,
  RefreshCw,
  Search,
  XCircle,
} from 'lucide-react'
import {
  AVISO,
  BOTON,
  CAMPO,
  CIFRAS,
  COLOR_ESTADO,
  ESTADO,
  LINEA,
  PANTALLA,
  TABLA,
  TEXTO,
  TIPO,
  type TonoEstado,
} from '@/lib/estilo/denso'
import { Barra, Vacio, cifra, hace, nombreMarketplace } from '@/components/plataforma/comun'
import { estaExenta, ocultaAhora } from '@/lib/cumplimiento/incidencias'
import { urlInventario, urlProducto } from '@/lib/cumplimiento/enlaces'
import {
  ACCION_ES,
  FILTROS_POR_DEFECTO,
  ROTULO_TEMA,
  TEMAS,
  estadoDeFicha,
  type FilaCumplimiento,
  type FiltroGravedad,
  type FiltrosCumplimiento,
  type Incidencia,
  type PaginaCumplimiento,
  type RespuestaResumen,
} from '@/lib/cumplimiento/tipos'

/**
 * CUMPLIMIENTO — LA PANTALLA DE UN CLIENTE.
 *
 * Arriba, las cifras: lo que tiene stock y no se puede vender es lo primero. Debajo,
 * los filtros, y la lista de listings con lo que Amazon dice de cada uno; al abrir
 * una fila salen las incidencias con su mensaje original, lo que Amazon hace por
 * ellas y desde cuándo.
 *
 * LO REVISADO NO ES LO TODO, y la pantalla lo dice: una cuenta grande tarda horas en
 * revisarse entera, y «0 con problemas» sobre la mitad del catálogo no es lo mismo
 * que «0 con problemas». Por eso la barra de cobertura está siempre que falte algo.
 *
 * Se actualiza sola: cada dos minutos, y cada pocos segundos mientras hay una
 * revisión en marcha.
 */

type Ultimo = {
  at: string
  resultado: { estado: string; mensaje: string; leidos: number; llamadas: number; sinCampo?: number }
} | null

interface Props {
  slug: string
  nombre: string
  resumenInicial: RespuestaResumen
  paginaInicial: PaginaCumplimiento
  enCursoInicial: boolean
}

const claveFila = (f: Pick<FilaCumplimiento, 'marketplace_id' | 'sku'>) => `${f.marketplace_id}|${f.sku}`

const GRAVEDADES: Array<{ id: FiltroGravedad; rotulo: string; ayuda: string }> = [
  { id: 'atencion', rotulo: 'Necesitan atención', ayuda: 'Con errores, o que Amazon tiene ocultos' },
  { id: 'avisos', rotulo: 'Solo avisos', ayuda: 'Con recomendaciones de Amazon pero sin errores ni ocultación' },
  { id: 'todo', rotulo: 'Todo', ayuda: 'Cualquier listing con alguna incidencia' },
]

export function TableroCumplimiento({ slug, nombre, resumenInicial, paginaInicial, enCursoInicial }: Props) {
  const [resumen, setResumen] = useState<RespuestaResumen>(resumenInicial)
  const [filtros, setFiltros] = useState<FiltrosCumplimiento>(FILTROS_POR_DEFECTO)
  const [filas, setFilas] = useState<FilaCumplimiento[]>(paginaInicial.filas)
  const [hayMas, setHayMas] = useState(paginaInicial.hayMas)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const [enCurso, setEnCurso] = useState(enCursoInicial)
  const [lanzada, setLanzada] = useState(false)
  const [ultimo, setUltimo] = useState<Ultimo>(null)
  const [revisando, setRevisando] = useState<string | null>(null)
  const [nota, setNota] = useState<string | null>(null)

  const peticion = useRef(0)
  const primera = useRef(true)
  const lanzadaAt = useRef(0)
  const filtrosRef = useRef(filtros)
  filtrosRef.current = filtros
  // Se calcula en cada pintado: es lo que decide si un plazo de gracia sigue vigente
  const ahora = new Date()

  /* ---------------- Hablar con el servidor ---------------- */
  const llamar = useCallback(
    async <T,>(accion: string, extra: Record<string, unknown> = {}): Promise<T> => {
      const res = await fetch('/api/cumplimiento', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accion, cliente: slug, ...extra }),
      })
      const json = (await res.json().catch(() => ({}))) as T & { error?: string }
      if (!res.ok) throw new Error(json.error ?? `El servidor ha contestado ${res.status}`)
      return json
    },
    [slug]
  )

  const cargarFilas = useCallback(
    async (f: FiltrosCumplimiento, pag: number, acumular: boolean) => {
      const id = ++peticion.current
      setCargando(true)
      setError(null)
      try {
        const r = await llamar<PaginaCumplimiento>('filas', { filtros: f, pagina: pag })
        // Si mientras tanto se ha pedido otra cosa, esta respuesta ya no vale
        if (id !== peticion.current) return
        setFilas((prev) => (acumular ? [...prev, ...r.filas] : r.filas))
        setHayMas(r.hayMas)
        setPagina(pag)
      } catch (e) {
        if (id === peticion.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar la lista')
      } finally {
        if (id === peticion.current) setCargando(false)
      }
    },
    [llamar]
  )

  const refrescarResumen = useCallback(
    async (mercado: string) => {
      try {
        const r = await llamar<{ resumen: RespuestaResumen; enCurso: boolean; ultimo: Ultimo }>('resumen', { mercado })
        setResumen(r.resumen)
        setEnCurso(r.enCurso)
        setUltimo(r.ultimo)
        return r
      } catch {
        // Un fallo de red al refrescar no tira la pantalla: se ve lo último y se reintenta
        return null
      }
    },
    [llamar]
  )

  /* ---------------- Al cambiar los filtros ---------------- */
  useEffect(() => {
    if (primera.current) {
      primera.current = false
      return
    }
    const t = setTimeout(() => void cargarFilas(filtros, 0, false), filtros.busca ? 300 : 0)
    return () => clearTimeout(t)
  }, [filtros, cargarFilas])

  // Las cifras dependen del país elegido, y de nada más de los filtros
  const mercadoAnterior = useRef(filtros.mercado)
  useEffect(() => {
    if (mercadoAnterior.current === filtros.mercado) return
    mercadoAnterior.current = filtros.mercado
    void refrescarResumen(filtros.mercado)
  }, [filtros.mercado, refrescarResumen])

  /* ---------------- Refresco automático ---------------- */
  useEffect(() => {
    const cada = enCurso || lanzada ? 3_000 : 120_000
    const t = setInterval(async () => {
      const r = await refrescarResumen(filtrosRef.current.mercado)
      if (!r) return
      if (lanzada) {
        // Termina cuando llega el resultado, o si pasa demasiado sin que haya nada en marcha
        const caducada = Date.now() - lanzadaAt.current > 180_000
        if (r.ultimo || (caducada && !r.enCurso)) {
          setLanzada(false)
          void cargarFilas(filtrosRef.current, 0, false)
        }
      } else if (!r.enCurso && enCurso) {
        void cargarFilas(filtrosRef.current, 0, false)
      }
    }, cada)
    return () => clearInterval(t)
  }, [enCurso, lanzada, refrescarResumen, cargarFilas])

  /* ---------------- Acciones ---------------- */
  async function revisarAhora() {
    setNota(null)
    setError(null)
    try {
      const r = await llamar<{ iniciada: boolean; motivo?: string }>('ahora')
      if (!r.iniciada) {
        setNota(r.motivo ?? 'No se ha podido lanzar la revisión.')
        return
      }
      lanzadaAt.current = Date.now()
      setUltimo(null)
      setLanzada(true)
      setEnCurso(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido lanzar la revisión')
    }
  }

  async function revisarUno(f: FilaCumplimiento) {
    const k = claveFila(f)
    setRevisando(k)
    setNota(null)
    setError(null)
    try {
      const r = await llamar<{ encontrado: boolean }>('sku', { mercado: f.marketplace_id, sku: f.sku })
      setNota(
        r.encontrado
          ? `${f.sku} revisado de nuevo.`
          : `Amazon ya no devuelve ${f.sku}: ha dejado de existir en su catálogo.`
      )
      await Promise.all([cargarFilas(filtrosRef.current, 0, false), refrescarResumen(filtrosRef.current.mercado)])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido revisar el listing')
    } finally {
      setRevisando(null)
    }
  }

  const alternar = (k: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev)
      if (s.has(k)) s.delete(k)
      else s.add(k)
      return s
    })

  const urlCsv = useMemo(() => {
    const p = new URLSearchParams({ cliente: slug, mercado: filtros.mercado, gravedad: filtros.gravedad, tema: filtros.tema })
    if (filtros.soloStock) p.set('stock', '1')
    if (filtros.busca.trim()) p.set('q', filtros.busca.trim())
    return `/api/cumplimiento/exportar?${p.toString()}`
  }, [slug, filtros])

  /* ---------------- Sin tabla, o con un fallo ---------------- */
  if (!resumen.ok && resumen.faltaMigracion) {
    return (
      <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
        <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
        <div className={`${TIPO.s} ${TEXTO.t2}`}>
          Falta lanzar la migración <strong>227_cumplimiento_listings.sql</strong> en el editor SQL de Supabase: no hay
          dónde guardar las revisiones. En cuanto esté, esta pantalla se llena sola.
        </div>
      </div>
    )
  }
  if (!resumen.ok) {
    return (
      <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
        <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
        <div className={`${TIPO.s} ${TEXTO.t2}`}>{resumen.error}</div>
      </div>
    )
  }

  const r = resumen
  const ocupado = enCurso || lanzada
  const sinRevisar = r.revisados === 0

  return (
    <div className={`${PANTALLA.cuerpo} h-full`}>
      {/* Sin ninguna revisión, unas cifras a cero se leerían como «todo está bien»: no se enseñan */}
      {!sinRevisar && (
        <>
          {/* ---------- Cifras y botones ---------- */}
          <div className="flex shrink-0 flex-wrap items-center gap-[9px]">
            {/* En un móvil la tira no cabe: ocupa su fila y se desliza de lado, en vez de cortar las cifras */}
            <div
              className={`${CIFRAS.tira} w-full min-w-0 sm:w-auto sm:flex-1 !overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden`}
            >
              <div className={CIFRAS.celda} title="Necesitan atención y tienen stock: es lo que se está dejando de vender hoy">
                <span className={`${CIFRAS.valor} ${r.atencionConStock > 0 ? CIFRAS.urgente : ''}`}>
                  {cifra(r.atencionConStock)}
                </span>
                <span className={CIFRAS.rotulo}>con stock y con problema</span>
              </div>
              <div className={CIFRAS.celda} title="Amazon dice que algo obligatorio falta o está mal">
                <span className={CIFRAS.valor}>{cifra(r.conErrores)}</span>
                <span className={CIFRAS.rotulo}>con errores</span>
              </div>
              <div className={CIFRAS.celda} title="Amazon los ha sacado de las búsquedas o de la venta (sin plazo de gracia vigente)">
                <span className={CIFRAS.valor} style={{ color: r.suprimidos > 0 ? COLOR_ESTADO.rojo : undefined }}>
                  {cifra(r.suprimidos)}
                </span>
                <span className={CIFRAS.rotulo}>ocultos</span>
              </div>
              <div className={CIFRAS.celda} title="Solo recomendaciones de Amazon: no bloquean nada">
                <span className={CIFRAS.valor}>{cifra(r.soloAvisos)}</span>
                <span className={CIFRAS.rotulo}>solo avisos</span>
              </div>
              <div className={CIFRAS.celda} title="Cuándo se revisó por última vez cualquiera de los listings">
                <span className={CIFRAS.rotulo}>{r.ultimaRevision ? `revisado ${hace(r.ultimaRevision)}` : 'sin revisar'}</span>
              </div>
            </div>

            <a
              href={urlCsv}
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.secundario} ${sinRevisar ? 'pointer-events-none opacity-45' : ''}`}
              title="CSV con lo que se está viendo —los mismos filtros—, una fila por incidencia. Se puede mandar al cliente."
            >
              <Download className="h-3 w-3" />
              Descargar CSV
            </a>
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
              disabled={ocupado}
              onClick={revisarAhora}
              title="Vuelve a leer en Amazon los listings con problemas y los que tienen stock. Tarda un minuto o dos."
            >
              {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {ocupado ? 'Revisando…' : 'Revisar ahora'}
            </button>
          </div>

          {/* ---------- Cobertura: lo revisado no es lo todo ---------- */}
          {r.total > 0 && r.revisados < r.total && (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Barra
                valor={r.revisados}
                total={r.total}
                tono="azul"
                titulo="Listings revisados de los que tiene el catálogo del ERP"
              />
              <span className={`${TIPO.s} ${TEXTO.t3}`}>
                {sinRevisar
                  ? 'Todavía no se ha revisado ninguno.'
                  : 'Las cifras son las de lo revisado, no las de todo el catálogo.'}{' '}
                Se empieza por los que tienen stock y el resto se completa solo, unos miles cada hora.
              </span>
            </div>
          )}


        </>
      )}

      {/* ---------- Avisos ---------- */}
      {ultimo && !ocupado && (
        <Mensaje
          tono={ultimo.resultado.estado === 'error' ? 'rojo' : ultimo.resultado.estado === 'parcial' ? 'ambar' : 'verde'}
          onCerrar={() => setUltimo(null)}
        >
          <strong>
            {ultimo.resultado.estado === 'error'
              ? 'La revisión ha fallado.'
              : ultimo.resultado.estado === 'parcial'
                ? 'La revisión se ha quedado a medias.'
                : 'Revisión terminada.'}
          </strong>{' '}
          {ultimo.resultado.mensaje}
          {ultimo.resultado.llamadas > 0 && <> ({cifra(ultimo.resultado.llamadas)} llamadas a Amazon)</>}
          {(ultimo.resultado.sinCampo ?? 0) > 0 && (
            <>
              {' '}
              {cifra(ultimo.resultado.sinCampo)} llegaron sin el campo de incidencias de Amazon y se han dado por limpios.
            </>
          )}
        </Mensaje>
      )}
      {nota && (
        <Mensaje tono="azul" onCerrar={() => setNota(null)}>
          {nota}
        </Mensaje>
      )}
      {error && (
        <Mensaje tono="rojo" onCerrar={() => setError(null)}>
          {error}
        </Mensaje>
      )}

      {!sinRevisar && (
        <>
          {/* ---------- Filtros ---------- */}
          <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
            {GRAVEDADES.map((g) => (
              <button
                key={g.id}
                type="button"
                title={g.ayuda}
                className={`${BOTON.chip} ${filtros.gravedad === g.id ? BOTON.chipEncendido : ''}`}
                onClick={() => setFiltros((f) => ({ ...f, gravedad: g.id }))}
              >
                {g.rotulo}
                {g.id === 'atencion' && <span className="tabular-nums">{cifra(r.atencion)}</span>}
                {g.id === 'avisos' && <span className="tabular-nums">{cifra(r.soloAvisos)}</span>}
              </button>
            ))}

            <span className={PANTALLA.separador} />

            {/* Los `!` no son un adorno: CAMPO.input trae `w-full` y Tailwind ordena `w-[…]` de forma
                que a veces queda ANTES y pierde. Mismo motivo que en BOTON.chipEncendido. */}
            <select
              value={filtros.mercado}
              onChange={(e) => setFiltros((f) => ({ ...f, mercado: e.target.value }))}
              className={`${CAMPO.input} !w-[176px]`}
              aria-label="País"
            >
              <option value="todos">Todos los países</option>
              {r.mercados.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.nombre} · {cifra(m.revisados)}/{cifra(m.total)}
                </option>
              ))}
            </select>

            <select
              value={filtros.tema}
              onChange={(e) => setFiltros((f) => ({ ...f, tema: e.target.value as FiltrosCumplimiento['tema'] }))}
              className={`${CAMPO.input} !w-[150px]`}
              aria-label="Tema"
            >
              <option value="todos">Todos los temas</option>
              {TEMAS.map((t) => {
                const n = r.porTema.find((x) => x.tema === t)?.n
                return (
                  <option key={t} value={t}>
                    {ROTULO_TEMA[t].corto}
                    {filtros.gravedad === 'atencion' && n !== undefined ? ` (${cifra(n)})` : ''}
                  </option>
                )
              })}
            </select>

            <button
              type="button"
              className={`${BOTON.chip} ${filtros.soloStock ? BOTON.chipEncendido : ''}`}
              title="Solo los listings que tienen unidades para vender"
              onClick={() => setFiltros((f) => ({ ...f, soloStock: !f.soloStock }))}
            >
              Solo con stock
            </button>

            <label className="relative ml-auto">
              <Search className="pointer-events-none absolute left-[7px] top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input
                value={filtros.busca}
                onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))}
                placeholder="SKU, ASIN o título"
                className={`${CAMPO.input} !w-[200px] pl-[24px]`}
                aria-label="Buscar"
              />
            </label>
          </div>


        </>
      )}

      {/* ---------- La lista ---------- */}
      {sinRevisar ? (
        <Vacio
          icono={<ClipboardCheck />}
          titulo={`Todavía no se ha revisado ningún listing de ${nombre}`}
          accion={
            <button
              type="button"
              className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
              disabled={ocupado}
              onClick={revisarAhora}
            >
              {ocupado ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {ocupado ? 'Revisando…' : 'Revisar ahora'}
            </button>
          }
        >
          La primera revisión sale sola en la próxima hora, empezando por los listings con stock. También se puede
          lanzar ahora; tarda uno o dos minutos.
        </Vacio>
      ) : filas.length === 0 && !cargando ? (
        <Vacio
          icono={<CheckCircle2 />}
          titulo={filtros.gravedad === 'atencion' ? 'Nada que atender con estos filtros' : 'Ningún listing con estos filtros'}
        >
          {r.revisados < r.total
            ? 'Ojo: solo se ha revisado una parte del catálogo, así que esto no quiere decir que el resto esté bien.'
            : 'Amazon no ha puesto ninguna incidencia a los listings revisados.'}
        </Vacio>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-[6px]">
          <div className={`${TABLA.caja} relative`}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={`${TABLA.cabecera} ${TABLA.cabeceraFija}`}>SKU</th>
                  <th className={TABLA.cabecera}>Producto</th>
                  <th className={TABLA.cabecera}>País</th>
                  <th className={TABLA.cabecera}>Ficha</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Stock</th>
                  <th className={TABLA.cabecera}>Problemas</th>
                  <th className={TABLA.cabecera}>Tema</th>
                  <th className={TABLA.cabecera}>Desde</th>
                  <th className={TABLA.cabecera} />
                </tr>
              </thead>
              <tbody>
                {filas.map((f) => {
                  const k = claveFila(f)
                  const abierta = abiertas.has(k)
                  return (
                    <FilaLista
                      key={k}
                      f={f}
                      abierta={abierta}
                      ahora={ahora}
                      revisando={revisando === k}
                      alAbrir={() => alternar(k)}
                      alRevisar={() => void revisarUno(f)}
                    />
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className={`flex shrink-0 items-center gap-2 ${TIPO.s} ${TEXTO.t4}`}>
            <span>
              {cifra(filas.length)}
              {hayMas ? '+' : ''} listings
            </span>
            {hayMas && (
              <button
                type="button"
                className={`${BOTON.base} ${BOTON.secundario}`}
                disabled={cargando}
                onClick={() => void cargarFilas(filtros, pagina + 1, true)}
              >
                {cargando && <Loader2 className="h-3 w-3 animate-spin" />}
                Cargar más
              </button>
            )}
            {cargando && !hayMas && <Loader2 className="h-3 w-3 animate-spin" />}
          </div>
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Una fila, y sus incidencias al abrirla                              */
/* ------------------------------------------------------------------ */

function FilaLista({
  f,
  abierta,
  ahora,
  revisando,
  alAbrir,
  alRevisar,
}: {
  f: FilaCumplimiento
  abierta: boolean
  ahora: Date
  revisando: boolean
  alAbrir: () => void
  alRevisar: () => void
}) {
  const ficha = estadoDeFicha(f.estado)
  const fichaTono: TonoEstado = ficha === 'comprable' ? 'verde' : ficha === 'visible' ? 'gris' : 'rojo'
  const FichaIcono = ficha === 'comprable' ? CheckCircle2 : ficha === 'visible' ? Info : EyeOff
  const rotuloFicha = ficha === 'comprable' ? 'Comprable' : ficha === 'visible' ? 'Solo visible' : 'Oculto'
  const producto = urlProducto(f.marketplace_id, f.asin)
  const inventario = urlInventario(f.marketplace_id, f.sku)

  return (
    <>
      <tr className={`${TABLA.fila} cursor-pointer ${abierta ? TABLA.filaSel : ''}`} onClick={alAbrir}>
        <td className={`${TABLA.celda} ${TABLA.celdaFija}`}>
          <span className="flex items-center gap-[5px]">
            {abierta ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className={`${TIPO.m} ${TEXTO.t1} font-medium`}>{f.sku}</span>
            {f.es_padre && (
              <span className={`${TIPO.xs} ${TEXTO.t4}`} title="Es el padre de una variación: agrupa las tallas o colores">
                padre
              </span>
            )}
          </span>
        </td>
        <td className={TABLA.celda}>
          <span className={`${TABLA.corta} max-w-[320px]`} title={f.titulo ?? undefined}>
            {f.titulo ?? '—'}
          </span>
        </td>
        <td className={TABLA.celda}>{nombreMarketplace(f.marketplace_id)}</td>
        <td className={TABLA.celda}>
          <span className={ESTADO.linea}>
            <FichaIcono className={ESTADO.icono} style={{ color: COLOR_ESTADO[fichaTono] }} />
            <span className={ESTADO.palabra}>{rotuloFicha}</span>
          </span>
        </td>
        <td className={`${TABLA.celda} ${TABLA.numero}`}>{f.con_stock ? 'Sí' : <span className={TEXTO.t4}>—</span>}</td>
        <td className={TABLA.celda}>
          <span className="inline-flex items-center gap-[8px]">
            {f.suprimido && (
              <span className={ESTADO.linea} style={{ color: COLOR_ESTADO.rojo }}>
                <EyeOff className={ESTADO.icono} />
                Oculto
              </span>
            )}
            {f.errores > 0 && (
              <span className={ESTADO.linea}>
                <XCircle className={ESTADO.icono} style={{ color: COLOR_ESTADO.rojo }} />
                {f.errores} {f.errores === 1 ? 'error' : 'errores'}
              </span>
            )}
            {f.avisos > 0 && (
              <span className={ESTADO.linea}>
                <AlertTriangle className={ESTADO.icono} style={{ color: COLOR_ESTADO.ambar }} />
                {f.avisos} {f.avisos === 1 ? 'aviso' : 'avisos'}
              </span>
            )}
          </span>
        </td>
        <td className={TABLA.celda}>{f.tema ? ROTULO_TEMA[f.tema].corto : <span className={TEXTO.t4}>—</span>}</td>
        <td className={`${TABLA.celda} ${TEXTO.t3}`}>{f.desde ? hace(f.desde) : '—'}</td>
        <td className={TABLA.celda} onClick={(e) => e.stopPropagation()}>
          <span className="inline-flex items-center gap-[2px]">
            <button
              type="button"
              className={BOTON.icono}
              title="Revisar de nuevo este listing (una llamada a Amazon)"
              aria-label={`Revisar de nuevo ${f.sku}`}
              disabled={revisando}
              onClick={alRevisar}
            >
              {revisando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            </button>
            {inventario && (
              <a
                className={BOTON.icono}
                href={inventario}
                target="_blank"
                rel="noreferrer"
                title="Buscarlo en Seller Central (hay que tener abierta la cuenta del cliente)"
                aria-label={`Abrir ${f.sku} en Seller Central`}
              >
                <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {producto && (
              <a
                className={`${BOTON.icono} !w-auto px-[4px] text-[10.5px] font-semibold`}
                href={producto}
                target="_blank"
                rel="noreferrer"
                title="Ver la ficha en Amazon"
                aria-label={`Ver ${f.sku} en Amazon`}
              >
                ASIN
              </a>
            )}
          </span>
        </td>
      </tr>

      {abierta && (
        <tr>
          <td colSpan={9} className={`border-b ${LINEA.normal} bg-[var(--ls-sup2)] px-[28px] py-[9px]`}>
            {f.incidencias.length === 0 ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>Amazon no ha puesto ninguna incidencia a este listing.</p>
            ) : (
              <ul className="flex max-w-[900px] flex-col gap-[9px]">
                {f.incidencias.map((i, n) => (
                  <LineaIncidencia key={`${i.codigo}-${n}`} i={i} ahora={ahora} />
                ))}
              </ul>
            )}
            <p className={`mt-[8px] ${TIPO.s} ${TEXTO.t4}`}>
              Revisado {hace(f.revisado_at)}
              {f.asin && <> · ASIN {f.asin}</>}
            </p>
          </td>
        </tr>
      )}
    </>
  )
}

function LineaIncidencia({ i, ahora }: { i: Incidencia; ahora: Date }) {
  const oculta = ocultaAhora(i, ahora)
  const gracia = i.exencion !== null && estaExenta(i.exencion, ahora)
  const Icono = oculta ? EyeOff : i.gravedad === 'error' ? XCircle : i.gravedad === 'aviso' ? AlertTriangle : Info
  const tono: TonoEstado = oculta || i.gravedad === 'error' ? 'rojo' : i.gravedad === 'aviso' ? 'ambar' : 'gris'

  return (
    <li className="flex gap-[8px]">
      <Icono className="mt-[3px] h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[tono] }} />
      <div className="min-w-0">
        <p className={`${TIPO.m} ${TEXTO.t1}`}>{i.mensaje || 'Amazon no ha dado ningún texto para esta incidencia.'}</p>
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          {ROTULO_TEMA[i.tema].largo}
          {i.codigo && <> · código {i.codigo}</>}
          {i.atributos.length > 0 && <> · {i.atributos.join(', ')}</>}
          {' · '}abierta {hace(i.desde)}
        </p>
        {(i.acciones.length > 0 || i.exencion?.estado === 'EXEMPT_UNTIL_EXPIRY_DATE') && (
          <p className={`${TIPO.s} ${TEXTO.t2}`}>
            {i.acciones.map((a) => ACCION_ES[a] ?? a).join(' · ')}
            {gracia && i.exencion?.caduca && (
              <span style={{ color: COLOR_ESTADO.ambar }}>
                {i.acciones.length > 0 && ' · '}
                Plazo de gracia hasta el{' '}
                {new Date(i.exencion.caduca).toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
              </span>
            )}
            {!gracia && i.exencion?.estado === 'EXEMPT_UNTIL_EXPIRY_DATE' && (
              <span className={TEXTO.t4}> · el plazo de gracia ya ha caducado</span>
            )}
          </p>
        )}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Un aviso que se puede cerrar                                        */
/* ------------------------------------------------------------------ */

function Mensaje({
  tono,
  onCerrar,
  children,
}: {
  tono: TonoEstado
  onCerrar: () => void
  children: React.ReactNode
}) {
  const Icono = tono === 'rojo' ? XCircle : tono === 'ambar' ? AlertTriangle : tono === 'verde' ? CheckCircle2 : Info
  return (
    <div className={`${AVISO.base} ${AVISO.conTono} shrink-0`} style={{ borderLeftColor: COLOR_ESTADO[tono] }}>
      <Icono className={AVISO.icono} style={{ color: COLOR_ESTADO[tono] }} />
      <div className={`min-w-0 flex-1 ${TIPO.s} ${TEXTO.t2}`}>{children}</div>
      <button type="button" className={BOTON.icono} onClick={onCerrar} aria-label="Cerrar el aviso" title="Cerrar">
        ×
      </button>
    </div>
  )
}
