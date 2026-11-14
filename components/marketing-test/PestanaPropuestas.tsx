'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { AnimatePresence, motion } from 'framer-motion'
import { Ban, Check, CheckCircle2, CircleDollarSign, FlaskConical, History, Inbox, ListChecks, Sparkles, X } from 'lucide-react'
import { Boton, Confirmacion, EsqueletoTarjeta, EstadoVacio, FilaDeKpis, Kpi, PanelLateral, Segmentado, Tarjeta, formatoEntero } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { ModoDelMotor, Propuesta, ResultadoDeEnsayo } from '@/lib/ads/motor'
import type { EstadoDelMotor as EstadoMotor } from '@/lib/ads/motor-estado'
import type { EstadoDeTerminos } from '@/lib/ads/terminos'
import { filtroDe, type FiltroDePropuestas, type ResumenDeHoy, type TareaDeHoy } from '@/lib/ads/hoy'
import type { UmbralesEstimados } from '@/lib/ads/umbrales'
import { agruparPorProducto } from '@/lib/ads/productos-agrupar'
import { totalesDe } from '@/lib/ads/rendimiento-calculo'
import { dinero } from './formato'
import { llamar } from './llamar'
import { useProductosConocidos } from './useProductosConocidos'
import { QueHacerHoy } from './QueHacerHoy'
import { PanelDeUmbrales, type DatosDeFichaParaMotor } from './PanelDeUmbrales'
import { EstadoDelMotor, MODOS } from './propuestas/EstadoDelMotor'
import { TarjetaDePropuesta } from './propuestas/TarjetaDePropuesta'
import { queHace, resumenDeLote } from './propuestas/textos'

interface Datos {
  modo: ModoDelMotor
  esAdmin?: boolean
  motor?: EstadoMotor
  minutosReservaColgada?: number
  firmada: boolean
  terminos: EstadoDeTerminos
  propuestas: Propuesta[]
  aplicables: Record<string, string | null>
  topeAutopiloto: number
  topeManual: number
  aplicadasHoy: number
  hoy: ResumenDeHoy
  umbrales: UmbralesEstimados
  umbralesGuardables: boolean
  ficha: DatosDeFichaParaMotor
}

/** Los filtros de la lista, en el orden en que se trabajan: lo que pierde dinero primero */
const FILTROS: Array<{ id: FiltroDePropuestas; texto: string }> = [
  { id: 'todas', texto: 'Todas' },
  { id: 'negativizar', texto: 'Excluir' },
  { id: 'pausar', texto: 'Pausar' },
  { id: 'bajar-puja', texto: 'Bajar puja' },
  { id: 'promover', texto: 'Cosechar' },
  { id: 'subir-puja', texto: 'Subir puja' },
  { id: 'presupuesto', texto: 'Presupuesto' },
  { id: 'error', texto: 'Con error' },
]

/** Cuántas tarjetas se pintan de una vez (la lista puede tener cientos: se pagina con «Ver más», no se anima fila a fila) */
const POR_TANDA = 24
const DIA_MS = 86_400_000

/** Lo que pide confirmación: una propuesta, un lote o deshacer */
type Pendiente = { tipo: 'aplicar'; p: Propuesta } | { tipo: 'lote'; ps: Propuesta[] } | { tipo: 'deshacer'; p: Propuesta } | { tipo: 'descartar-lote'; ps: Propuesta[] }

/** Una serie diaria de 14 días (para las sparklines de los KPI): cuántas propuestas cumplen `de` cada día */
function serieDiaria(ps: readonly Propuesta[], fecha: (p: Propuesta) => string | null, ahora = Date.now()): number[] {
  const dias = Array.from({ length: 14 }, () => 0)
  for (const p of ps) {
    const f = fecha(p)
    if (!f) continue
    const hace = Math.floor((ahora - Date.parse(f)) / DIA_MS)
    if (hace >= 0 && hace < 14) dias[13 - hace] += 1
  }
  return dias
}

/**
 * LAS PROPUESTAS DEL MOTOR DE OPTIMIZACIÓN, pensadas para el día a día del administrativo:
 *
 *   1. El estado del motor: modo (solo un administrador lo cambia), de cuándo son los datos, la última generación, el próximo paso y la salud del proceso de fondo.
 *   2. Cifras (pendientes, gasto sin pedidos en juego, aplicadas hoy, aplicadas en 30 días) y «Qué hacer hoy».
 *   3. Las propuestas en TARJETAS agrupadas por producto: qué, por qué con sus cifras, el impacto, y aplicar · ensayo · descartar (o en bloque con la barra de abajo).
 *   4. Reglas y umbrales (plegados) y el historial, con deshacer.
 *
 * Ya NO se consulta cada 8 s mientras Amazon prepara el informe: lo recoge el proceso de fondo, y al volver a la pestaña del navegador se relee. Tras aplicar o descartar
 * UNA propuesta se actualiza solo esa (el servidor la devuelve), sin volver a pedir todo.
 */
export function PestanaPropuestas({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [ocupadaId, setOcupadaId] = useState<{ id: string; que: string } | null>(null)
  const [filtro, setFiltro] = useState<FiltroDePropuestas>('todas')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [cuantas, setCuantas] = useState(POR_TANDA)
  const [cuantasHistorial, setCuantasHistorial] = useState(12)
  const [verHistorial, setVerHistorial] = useState(false)
  const [confirmar, setConfirmar] = useState<Pendiente | null>(null)
  const [ensayo, setEnsayo] = useState<{ p: Propuesta; r: ResultadoDeEnsayo } | null>(null)
  const [montado, setMontado] = useState(false)
  const conocidos = useProductosConocidos(perfilId)
  const vivo = useRef(true)
  const lista = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async () => {
    try {
      const d = await llamar<Datos>(`/api/ads/cuenta/motor?perfilId=${perfilId}`)
      if (!vivo.current) return
      setDatos(d)
      setError(null)
      // Lo marcado que ya no está pendiente (aplicado, descartado por otra persona…) se desmarca solo
      setMarcadas((m) => new Set([...m].filter((id) => d.propuestas.some((p) => p.id === id && (p.estado === 'pendiente' || p.estado === 'error')))))
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el motor.')
    }
  }, [perfilId])

  useEffect(() => {
    vivo.current = true
    setMontado(true)
    void cargar()
    // Sin sondeo: al volver a la pestaña del navegador (tras más de 1 minuto fuera) se relee una vez
    let oculta = 0
    const alCambiar = () => {
      if (document.visibilityState === 'hidden') oculta = Date.now()
      else if (oculta && Date.now() - oculta > 60_000) void cargar()
    }
    document.addEventListener('visibilitychange', alCambiar)
    return () => {
      vivo.current = false
      document.removeEventListener('visibilitychange', alCambiar)
    }
  }, [cargar])

  /** Cambia UNA propuesta en lo cargado (lo que devuelve el servidor, o un estado nuevo) sin volver a pedir todo */
  const sustituir = useCallback((id: string, cambio: Partial<Propuesta>) => {
    setDatos((d) => (d ? { ...d, propuestas: d.propuestas.map((p) => (p.id === id ? { ...p, ...cambio } : p)), aplicadasHoy: cambio.estado === 'aplicada' ? d.aplicadasHoy + 1 : d.aplicadasHoy } : d))
    setMarcadas((m) => {
      if (!m.has(id)) return m
      const n = new Set(m)
      n.delete(id)
      return n
    })
  }, [])

  async function post<T>(cuerpo: Record<string, unknown>): Promise<T> {
    return llamar<T>('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, ...cuerpo } })
  }

  async function aplicarUna(p: Propuesta) {
    setOcupadaId({ id: p.id, que: 'aplicar' })
    try {
      const r = await post<{ propuesta: Propuesta }>({ accion: 'aplicar', id: p.id })
      sustituir(p.id, r.propuesta)
      toast.success('Aplicada en Amazon. Queda en el log y se puede deshacer desde el historial.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar.')
      await cargar()
    } finally {
      setOcupadaId(null)
    }
  }

  const ensayar = useCallback(
    async (p: Propuesta) => {
      setOcupadaId({ id: p.id, que: 'ensayar' })
      try {
        const r = await llamar<{ ensayo: ResultadoDeEnsayo }>('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, accion: 'ensayar', id: p.id } })
        setEnsayo({ p, r: r.ensayo })
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido ensayar.')
      } finally {
        setOcupadaId(null)
      }
    },
    [perfilId],
  )

  const descartar = useCallback(
    async (p: Propuesta) => {
      setOcupadaId({ id: p.id, que: 'descartar' })
      try {
        await llamar('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, accion: 'descartar', id: p.id } })
        sustituir(p.id, { estado: 'descartada', resueltaAt: new Date().toISOString() })
        toast.success('Descartada: no se vuelve a proponer en 14 días.')
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido descartar.')
      } finally {
        setOcupadaId(null)
      }
    },
    [perfilId, sustituir],
  )

  async function deshacer(p: Propuesta) {
    setOcupadaId({ id: p.id, que: 'deshacer' })
    try {
      await post({ accion: 'deshacer', id: p.id })
      sustituir(p.id, { estado: 'deshecha', resueltaAt: new Date().toISOString() })
      toast.success('Deshecha en Amazon.')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido deshacer.')
      await cargar()
    } finally {
      setOcupadaId(null)
    }
  }

  async function aplicarLote(ps: Propuesta[]) {
    setOcupado('lote')
    try {
      const r = await post<{ aplicadas: number; fallidas: number; resultados: Array<{ ok: boolean; error?: string }> }>({ accion: 'aplicar-varias', ids: ps.map((p) => p.id) })
      if (r.fallidas === 0) toast.success(`${r.aplicadas} ${r.aplicadas === 1 ? 'cambio aplicado' : 'cambios aplicados'} en Amazon.`)
      else toast.warning(`${r.aplicadas} aplicados y ${r.fallidas} con error (el motivo está en cada tarjeta, filtro «Con error»). ${r.resultados.find((x) => !x.ok)?.error ?? ''}`.trim())
      setMarcadas(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar el lote.')
    } finally {
      await cargar()
      setOcupado(null)
    }
  }

  async function descartarLote(ps: Propuesta[]) {
    setOcupado('lote')
    try {
      const r = await post<{ descartadas: number }>({ accion: 'descartar-varias', ids: ps.map((p) => p.id) })
      toast.success(`${r.descartadas} ${r.descartadas === 1 ? 'descartada' : 'descartadas'}.`)
      const ahora = new Date().toISOString()
      for (const p of ps) sustituir(p.id, { estado: 'descartada', resueltaAt: ahora })
      setMarcadas(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido descartar.')
      await cargar()
    } finally {
      setOcupado(null)
    }
  }

  async function accionGeneral(nombre: 'terminos' | 'generar') {
    setOcupado(nombre)
    try {
      if (nombre === 'terminos') {
        const r = await post<{ accion: string }>({ accion: 'actualizar-terminos' })
        toast.success(r.accion === 'pedido' ? 'Informe pedido a Amazon. El proceso de fondo lo recoge y genera las propuestas en cuanto esté (suele tardar unos minutos).' : r.accion === 'esperando' ? 'Amazon ya lo está preparando: se recoge solo.' : 'Hace muy poco que se pidió: espera un poco.')
      } else {
        const r = await post<{ resumen: { nuevas: number } }>({ accion: 'generar' })
        toast.success(r.resumen.nuevas > 0 ? `${r.resumen.nuevas} ${r.resumen.nuevas === 1 ? 'propuesta nueva' : 'propuestas nuevas'}.` : 'Revisado: nada nuevo que proponer.')
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido completar.')
    } finally {
      await cargar()
      setOcupado(null)
    }
  }

  async function cambiarModo(modo: ModoDelMotor) {
    setOcupado('modo')
    try {
      await llamar('/api/ads/cuenta/motor', { metodo: 'PUT', cuerpo: { perfilId, modo } })
      toast.success(`Motor: ${MODOS.find((m) => m.id === modo)?.nombre.toLowerCase()}.`)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido cambiar el modo.')
    } finally {
      setOcupado(null)
    }
  }

  const pendientes = useMemo(() => datos?.propuestas.filter((p) => p.estado === 'pendiente' || p.estado === 'error') ?? [], [datos])
  const historial = useMemo(() => datos?.propuestas.filter((p) => p.estado !== 'pendiente' && p.estado !== 'error') ?? [], [datos])
  const cuentasPorFiltro = useMemo(() => {
    const c: Record<string, number> = { todas: pendientes.length }
    for (const p of pendientes) c[filtroDe(p)] = (c[filtroDe(p)] ?? 0) + 1
    return c
  }, [pendientes])
  // Si el filtro elegido se queda sin nada (se han aplicado todas), se vuelve a «Todas» en vez de dejar la lista vacía
  const filtroActivo: FiltroDePropuestas = filtro !== 'todas' && !((cuentasPorFiltro[filtro] ?? 0) > 0) ? 'todas' : filtro
  const visibles = useMemo(() => (filtroActivo === 'todas' ? pendientes : pendientes.filter((p) => filtroDe(p) === filtroActivo)), [pendientes, filtroActivo])
  const tanda = useMemo(() => visibles.slice(0, cuantas), [visibles, cuantas])
  const grupos = useMemo(() => {
    // Se agrupan por el producto de la campaña de origen (el ASIN que lleva su nombre)
    const filas = tanda.map((p) => ({ ...p, nombre: p.campaignNombre, ...totalesDe([]) }))
    return agruparPorProducto(filas, new Map([...conocidos].map(([asin, c]) => [asin, c.resumen])))
  }, [tanda, conocidos])
  const series = useMemo(() => {
    const ps = datos?.propuestas ?? []
    return {
      creadas: serieDiaria(ps, (p) => p.creadaAt),
      aplicadas: serieDiaria(ps, (p) => (p.estado === 'aplicada' ? p.resueltaAt : null)),
      gasto: (() => {
        const dias = Array.from({ length: 14 }, () => 0)
        for (const p of ps) {
          if (p.tipo !== 'negativizar' && p.tipo !== 'pausar') continue
          const hace = Math.floor((Date.now() - Date.parse(p.creadaAt)) / DIA_MS)
          if (hace >= 0 && hace < 14) dias[13 - hace] += p.metricas.gasto
        }
        return dias
      })(),
    }
  }, [datos])

  const alternar = useCallback((id: string) =>
    setMarcadas((m) => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    }), [])
  const pedirAplicar = useCallback((p: Propuesta) => setConfirmar({ tipo: 'aplicar', p }), [])
  const pedirDeshacer = useCallback((p: Propuesta) => setConfirmar({ tipo: 'deshacer', p }), [])

  if (error) return <EstadoVacio icono={Inbox} titulo="No se ha podido cargar el motor" descripcion={error} acento="marketing" accion={{ texto: 'Reintentar', onClick: () => void cargar() }} />
  if (!datos) {
    return (
      <div className="flex flex-col gap-4">
        <EsqueletoTarjeta />
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <EsqueletoTarjeta key={i} />
          ))}
        </div>
        <EsqueletoTarjeta />
      </div>
    )
  }

  const { modo, firmada, terminos } = datos
  const esAdmin = datos.esAdmin !== false
  const minutos = datos.minutosReservaColgada ?? 15
  const aplicable = (p: Propuesta) => (datos.aplicables[p.id] ?? null) === null
  const marcablesVisibles = visibles.filter(aplicable)
  const todasMarcadas = marcablesVisibles.length > 0 && marcablesVisibles.every((p) => marcadas.has(p.id))
  const marcadasLista = pendientes.filter((p) => marcadas.has(p.id))
  const aplicadas30 = historial.filter((p) => p.estado === 'aplicada').length
  const algoOcupado = ocupado !== null || ocupadaId !== null

  function irDesdeTarea(t: TareaDeHoy) {
    if (!t.ir) return
    if ('pestana' in t.ir) return irA(t.ir.pestana)
    if ('accion' in t.ir) return void accionGeneral('terminos')
    setFiltro(t.ir.filtro)
    lista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  let indice = 0

  return (
    <div className="flex flex-col gap-4 pb-28">
      <EstadoDelMotor
        modo={modo}
        firmada={firmada}
        esAdmin={esAdmin}
        terminos={terminos}
        motor={datos.motor}
        ocupado={ocupado}
        topeAutopiloto={datos.topeAutopiloto}
        onModo={(m) => void cambiarModo(m)}
        onActualizarTerminos={() => void accionGeneral('terminos')}
        onRevisar={() => void accionGeneral('generar')}
        irA={irA}
      />

      {modo === 'apagado' ? (
        <Tarjeta titulo="Cómo funciona" icono={Sparkles} acento="marketing">
          <ul className="flex list-disc flex-col gap-[6px] pl-5 text-[13px] leading-[1.55] text-[var(--ls-t2)]">
            <li>Una vez al día lee de Amazon los términos de búsqueda de 30 días (sin los 3 últimos, que Amazon todavía está atribuyendo) y el rendimiento de cada keyword y ASIN.</li>
            <li><strong>Excluir</strong> lo que gasta sin pedidos (según la conversión real de la campaña, no un número fijo de clics) y lo que no tiene nada que ver con el producto (marcado para que lo revises).</li>
            <li><strong>Cosechar</strong> a EXACTA lo que ya vende dentro del objetivo, excluyéndolo a la vez de su campaña de origen.</li>
            <li><strong>Pujas</strong> hacia la que deja el ACoS en el objetivo, <strong>pausar</strong> lo que pasa el tope sin un pedido y <strong>subir presupuesto</strong> a lo rentable que se queda corto. Siempre con aprobación.</li>
            <li>Cada propuesta lleva su motivo y sus cifras, y se puede <strong>ensayar</strong>: se recorre el camino de aplicar sin escribir nada en Amazon y queda en el log.</li>
            <li>Necesita el <strong>ACoS objetivo de cada producto</strong> (pestaña Productos). Si falta el precio, usa el ticket medio de lo vendido por Ads y lo marca como estimación.</li>
          </ul>
        </Tarjeta>
      ) : (
        <>
          <FilaDeKpis minimo={200}>
            <Kpi indice={0} acento="marketing" icono={ListChecks} etiqueta="Propuestas pendientes" valor={pendientes.length} serie={series.creadas} nota="creadas por día, 14 días" onClick={() => lista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
            <Kpi indice={1} acento={COLOR_ESTADO.rojo} icono={CircleDollarSign} etiqueta="Gasto sin pedidos en juego" valor={datos.hoy.gastoSinVentaRecuperable} formato={(n) => dinero(n, moneda, 0)} serie={series.gasto} nota="lo que se deja de tirar si se aprueba" />
            <Kpi indice={2} acento={COLOR_ESTADO.verde} icono={Check} etiqueta="Aplicadas hoy" valor={datos.aplicadasHoy} formato={(n) => `${formatoEntero(n)} de ${datos.topeManual}`} nota="tope diario por cuenta" />
            <Kpi indice={3} acento={COLOR_ESTADO.azul} icono={History} etiqueta="Aplicadas en 30 días" valor={aplicadas30} serie={series.aplicadas} nota="por día, 14 días" onClick={() => setVerHistorial(true)} />
          </FilaDeKpis>

          <QueHacerHoy hoy={datos.hoy} moneda={moneda} aplicadasHoy={datos.aplicadasHoy} topeManual={datos.topeManual} ir={irDesdeTarea} />

          {/* ------- la lista ------- */}
          <div ref={lista} className="flex scroll-mt-28 flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h3 className="text-[16px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Propuestas</h3>
              {marcablesVisibles.length > 0 && (
                <label className="ml-auto inline-flex min-h-[36px] cursor-pointer items-center gap-2 rounded-[10px] px-2 text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] [@media(pointer:coarse)]:min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={todasMarcadas}
                    onChange={() =>
                      setMarcadas((m) => {
                        const n = new Set(m)
                        for (const p of marcablesVisibles) {
                          if (todasMarcadas) n.delete(p.id)
                          else n.add(p.id)
                        }
                        return n
                      })
                    }
                    className="h-4 w-4 accent-[var(--ls-acc)]"
                  />
                  Marcar las {marcablesVisibles.length} que se pueden aplicar
                </label>
              )}
            </div>
            {pendientes.length > 0 && (
              <div className="ls-sin-barra -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                <Segmentado
                  etiqueta="Tipo de propuesta"
                  opciones={FILTROS.filter((f) => f.id === 'todas' || (cuentasPorFiltro[f.id] ?? 0) > 0).map((f) => ({ id: f.id, texto: f.texto, cuenta: cuentasPorFiltro[f.id] ?? 0 }))}
                  valor={filtroActivo}
                  onCambio={(v) => {
                    setFiltro(v)
                    setCuantas(POR_TANDA)
                  }}
                />
              </div>
            )}

            {pendientes.length === 0 ? (
              <EstadoVacio
                icono={CheckCircle2}
                acento="marketing"
                titulo={terminos.filas === 0 ? 'Todavía no hay propuestas' : 'Nada que proponer ahora mismo'}
                descripcion={terminos.filas === 0 ? 'Cuando lleguen los términos de búsqueda, el proceso de fondo genera las propuestas y aparecen aquí.' : 'Ningún término ni segmentación cumple una regla con muestra suficiente. Lo que ya se propuso o se resolvió hace poco no se repite (un cambio cada vez).'}
                accion={terminos.filas === 0 ? { texto: 'Pedir términos ahora', onClick: () => void accionGeneral('terminos') } : { texto: 'Revisar ahora', onClick: () => void accionGeneral('generar') }}
              />
            ) : (
              <>
                {grupos.map((g) => (
                  <section key={g.clave} className="flex flex-col gap-3">
                    <header className="flex min-w-0 items-baseline gap-2 pt-1">
                      <h4 className="truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">{g.titulo}</h4>
                      <span className="shrink-0 text-[12px] text-[var(--ls-t4)]">
                        {g.asin ?? ''} · {g.campanas.length} {g.campanas.length === 1 ? 'propuesta' : 'propuestas'}
                      </span>
                    </header>
                    <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                      {g.campanas.map((p) => (
                        <TarjetaDePropuesta
                          key={p.id}
                          p={p}
                          moneda={moneda}
                          indice={indice++}
                          bloqueo={datos.aplicables[p.id] ?? null}
                          ocupado={ocupadaId?.id === p.id ? ocupadaId.que : null}
                          algoOcupado={algoOcupado}
                          marcada={marcadas.has(p.id)}
                          minutosReservaColgada={minutos}
                          onMarcar={alternar}
                          onAplicar={pedirAplicar}
                          onEnsayar={ensayar}
                          onDescartar={descartar}
                        />
                      ))}
                    </div>
                  </section>
                ))}
                {visibles.length > cuantas && (
                  <div className="flex justify-center">
                    <Boton variante="secundario" onClick={() => setCuantas((c) => c + POR_TANDA)}>
                      Ver {Math.min(POR_TANDA, visibles.length - cuantas)} más (quedan {visibles.length - cuantas})
                    </Boton>
                  </div>
                )}
              </>
            )}
          </div>

          <PanelDeUmbrales perfilId={perfilId} umbrales={datos.umbrales} guardables={datos.umbralesGuardables} ficha={datos.ficha} alGuardar={() => void cargar()} irA={irA} esAdmin={esAdmin} />

          {/* ------- el historial ------- */}
          {historial.length > 0 && (
            <Tarjeta
              icono={History}
              titulo="Historial · últimos 30 días"
              subtitulo={`${historial.length} resueltas · ${aplicadas30} aplicadas`}
              acciones={
                <Boton variante="fantasma" tamano="sm" onClick={() => setVerHistorial((v) => !v)} aria-expanded={verHistorial}>
                  {verHistorial ? 'Ocultar' : 'Ver'}
                </Boton>
              }
              sinRelleno={!verHistorial}
            >
              {verHistorial && (
                <div className="flex flex-col gap-3">
                  <div className="grid gap-3 lg:grid-cols-2 2xl:grid-cols-3">
                    {historial.slice(0, cuantasHistorial).map((p) => (
                      <TarjetaDePropuesta key={p.id} p={p} moneda={moneda} bloqueo={null} ocupado={ocupadaId?.id === p.id ? ocupadaId.que : null} algoOcupado={algoOcupado} historial minutosReservaColgada={minutos} onDeshacer={pedirDeshacer} />
                    ))}
                  </div>
                  {historial.length > cuantasHistorial && (
                    <div className="flex justify-center">
                      <Boton variante="secundario" onClick={() => setCuantasHistorial((c) => c + 24)}>
                        Ver más ({historial.length - cuantasHistorial})
                      </Boton>
                    </div>
                  )}
                  <p className="text-[12px] text-[var(--ls-t4)]">Cada cambio, con la petición y la respuesta de Amazon, está en la pestaña «Log de cambios».</p>
                </div>
              )}
            </Tarjeta>
          )}
        </>
      )}

      {/* ------- la barra del lote: aparece al marcar algo (en portal: el contenedor de la ruta deja un transform puesto) ------- */}
      {montado &&
        createPortal(
          <AnimatePresence>
            {marcadasLista.length > 0 && (
              <motion.div
                initial={{ y: 24, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 24, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="fixed inset-x-3 bottom-3 z-40 mx-auto flex max-w-[860px] flex-wrap items-center gap-2 rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-4 py-3 shadow-[var(--ls-sombra-3)] [padding-bottom:max(0.75rem,env(safe-area-inset-bottom))]"
                role="region"
                aria-label="Propuestas marcadas"
              >
                <span className="text-[13px] font-semibold text-[var(--ls-t1)]">
                  {marcadasLista.length} {marcadasLista.length === 1 ? 'marcada' : 'marcadas'}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-[var(--ls-t3)]">{resumenDeLote(marcadasLista)}</span>
                <span className="flex w-full flex-wrap justify-end gap-2 sm:w-auto">
                  <Boton variante="fantasma" tamano="sm" icono={X} disabled={algoOcupado} onClick={() => setMarcadas(new Set())}>
                    Quitar marcas
                  </Boton>
                  <Boton variante="secundario" tamano="sm" icono={Ban} disabled={algoOcupado} onClick={() => setConfirmar({ tipo: 'descartar-lote', ps: marcadasLista })}>
                    Descartar
                  </Boton>
                  <Boton variante="primario" tamano="sm" icono={Check} disabled={algoOcupado || datos.aplicadasHoy >= datos.topeManual} cargando={ocupado === 'lote'} onClick={() => setConfirmar({ tipo: 'lote', ps: marcadasLista })}>
                    Aplicar {marcadasLista.length}
                  </Boton>
                </span>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}

      {/* ------- las confirmaciones ------- */}
      <Confirmacion
        abierto={confirmar !== null}
        onCambio={(a) => !a && setConfirmar(null)}
        palabra={null}
        tono={confirmar?.tipo === 'descartar-lote' ? 'normal' : 'peligro'}
        titulo={confirmar?.tipo === 'aplicar' ? 'Aplicar en Amazon' : confirmar?.tipo === 'lote' ? `Aplicar ${confirmar.ps.length} cambios en Amazon` : confirmar?.tipo === 'deshacer' ? 'Deshacer en Amazon' : confirmar?.tipo === 'descartar-lote' ? `Descartar ${confirmar.ps.length} propuestas` : ''}
        descripcion={
          confirmar?.tipo === 'aplicar'
            ? 'Se escribe en la cuenta de Amazon Ads del cliente. Queda en el log y se puede deshacer desde el historial.'
            : confirmar?.tipo === 'lote'
              ? 'Una a una, con todos sus controles. Cada una se puede deshacer desde el historial.'
              : confirmar?.tipo === 'deshacer'
                ? 'Se quita en Amazon lo que hizo esta propuesta. Si alguien cambió después ese valor, no se pisa.'
                : 'No se toca nada en Amazon. No se vuelven a proponer en 14 días.'
        }
        textoConfirmar={confirmar?.tipo === 'deshacer' ? 'Deshacer' : confirmar?.tipo === 'descartar-lote' ? 'Descartar' : 'Aplicar'}
        onConfirmar={async () => {
          const c = confirmar
          setConfirmar(null)
          if (!c) return
          if (c.tipo === 'aplicar') await aplicarUna(c.p)
          else if (c.tipo === 'lote') await aplicarLote(c.ps)
          else if (c.tipo === 'deshacer') await deshacer(c.p)
          else await descartarLote(c.ps)
        }}
      >
        {confirmar?.tipo === 'aplicar' || confirmar?.tipo === 'deshacer' ? (
          <div className="rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
            <strong className="text-[var(--ls-t1)]">{queHace(confirmar.p)}</strong>
            <span className="mt-1 block text-[var(--ls-t3)]">{confirmar.p.motivo}</span>
          </div>
        ) : confirmar?.tipo === 'lote' || confirmar?.tipo === 'descartar-lote' ? (
          <ul className="max-h-[220px] overflow-auto rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
            {confirmar.ps.slice(0, 12).map((p) => (
              <li key={p.id} className="truncate">· {queHace(p)}</li>
            ))}
            {confirmar.ps.length > 12 && <li className="text-[var(--ls-t4)]">… y {confirmar.ps.length - 12} más</li>}
            {confirmar.tipo === 'lote' && confirmar.ps.length > datos.topeManual - datos.aplicadasHoy && (
              <li className="mt-1" style={{ color: COLOR_ESTADO.ambar }}>
                Hoy quedan {Math.max(0, datos.topeManual - datos.aplicadasHoy)} del tope diario: se aplican las primeras.
              </li>
            )}
          </ul>
        ) : null}
      </Confirmacion>

      {/* ------- el resultado de un ensayo ------- */}
      <PanelLateral
        abierto={ensayo !== null}
        onCambio={(a) => !a && setEnsayo(null)}
        icono={FlaskConical}
        acento="marketing"
        titulo="Ensayo: lo que se haría en Amazon"
        descripcion={ensayo ? queHace(ensayo.p) : undefined}
        ancho={520}
        pie={
          ensayo && (datos.aplicables[ensayo.p.id] ?? null) === null && ensayo.r.error === null ? (
            <Boton
              variante="primario"
              icono={Check}
              onClick={() => {
                const p = ensayo.p
                setEnsayo(null)
                setConfirmar({ tipo: 'aplicar', p })
              }}
            >
              Aplicar de verdad
            </Boton>
          ) : undefined
        }
      >
        {ensayo && <ResultadoDelEnsayo r={ensayo.r} />}
      </PanelLateral>
    </div>
  )
}

function ResultadoDelEnsayo({ r }: { r: ResultadoDeEnsayo }) {
  return (
    <div className="flex flex-col gap-3 text-[13px] text-[var(--ls-t2)]">
      {r.error ? (
        <p className="rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in srgb, var(--ls-e-rojo) 10%, transparent)', color: COLOR_ESTADO.rojo }}>
          El camino se para antes de escribir: {r.error}
        </p>
      ) : (
        <p className="rounded-[10px] px-3 py-2" style={{ background: 'color-mix(in srgb, var(--ls-e-verde) 10%, transparent)', color: COLOR_ESTADO.verde }}>
          El camino llega hasta el final. No se ha escrito nada en Amazon; queda en el log como «Ensayo».
        </p>
      )}
      {r.avisos.length > 0 && (
        <ul className="flex flex-col gap-1">
          {r.avisos.map((a) => (
            <li key={a} style={{ color: COLOR_ESTADO.ambar }}>
              · {a}
            </li>
          ))}
        </ul>
      )}
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">Llamadas que se harían ({r.llamadas.length})</div>
        {r.llamadas.length === 0 ? (
          <p className="text-[var(--ls-t3)]">Ninguna escritura (se ha parado antes, o la propuesta no necesita escribir).</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {r.llamadas.map((l, i) => (
              <li key={i} className="overflow-hidden rounded-[10px] border border-[var(--ls-linea)]">
                <div className="flex items-center gap-2 bg-[var(--ls-sup2)] px-3 py-[6px] font-mono text-[12px]">
                  <span className="font-semibold text-[var(--ls-acc)]">{l.metodo}</span>
                  <span className="truncate text-[var(--ls-t1)]">{l.ruta}</span>
                </div>
                <pre className="max-h-[200px] overflow-auto px-3 py-2 font-mono text-[11.5px] leading-[1.5] text-[var(--ls-t2)]">{JSON.stringify(l.cuerpo, null, 2)}</pre>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  )
}
