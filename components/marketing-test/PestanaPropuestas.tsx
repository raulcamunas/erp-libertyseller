'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Ban, CheckCircle2, ChevronDown, ChevronRight, CircleAlert, Lock, RefreshCw, Undo2, X } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { CAJA as TARJETA } from './piezas'
import { Cargando } from '@/components/plataforma/comun'
import type { ModoDelMotor, Propuesta } from '@/lib/ads/motor'
import type { EstadoDeTerminos } from '@/lib/ads/terminos'
import { filtroDe, type FiltroDePropuestas, type ResumenDeHoy, type TareaDeHoy } from '@/lib/ads/hoy'
import type { UmbralesEstimados } from '@/lib/ads/umbrales'
import { agruparPorProducto } from '@/lib/ads/productos-agrupar'
import { totalesDe } from '@/lib/ads/rendimiento-calculo'
import { decimal, dinero, entero, haceCuanto } from './formato'
import { llamar } from './llamar'
import { useProductosConocidos } from './useProductosConocidos'
import { QueHacerHoy } from './QueHacerHoy'
import { PanelDeUmbrales, type DatosDeFichaParaMotor } from './PanelDeUmbrales'

interface Datos {
  modo: ModoDelMotor
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

const MODOS: Array<{ id: ModoDelMotor; nombre: string; texto: string; aplica: boolean }> = [
  { id: 'apagado', nombre: 'Apagado', texto: 'El motor no hace nada en esta cuenta.', aplica: false },
  { id: 'sugiere', nombre: 'Solo sugiere', texto: 'Propone cambios y los enseña aquí. No toca nada en Amazon.', aplica: false },
  { id: 'aprueba', nombre: 'Aprueba y aplica', texto: 'Propone y, cuando tú pulsas «Aplicar», lo hace en Amazon. Todo se puede deshacer.', aplica: true },
  { id: 'autopiloto', nombre: 'Autopiloto de negativas', texto: 'Excluye solo los términos que gastan sin vender (tope diario). Lo demás siempre pide tu aprobación.', aplica: true },
]

const ESTILO_ESTADO: Record<string, { texto: string; color: string }> = {
  aplicada: { texto: 'Aplicada', color: COLOR_ESTADO.verde },
  descartada: { texto: 'Descartada', color: COLOR_ESTADO.gris },
  deshecha: { texto: 'Deshecha', color: COLOR_ESTADO.gris },
  error: { texto: 'Error', color: COLOR_ESTADO.rojo },
  caducada: { texto: 'Caducada', color: COLOR_ESTADO.gris },
  aprobada: { texto: 'Aprobada', color: COLOR_ESTADO.azul },
  pendiente: { texto: 'Pendiente', color: COLOR_ESTADO.ambar },
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

/**
 * LAS PROPUESTAS DEL MOTOR DE OPTIMIZACIÓN, pensadas para el día a día del administrativo:
 *
 *   1. «Qué hacer hoy» arriba: qué bloquea al motor y qué propuestas mueven más dinero, cada cosa con su botón.
 *   2. La lista, filtrable por tipo, agrupada por producto y con casillas: se revisa y se aprueba (o se descarta) una a una o EN BLOQUE.
 *   3. Las reglas y umbrales, plegados: los del SOP (ficha) y los estimados, editables por cuenta.
 *
 * Lo que se aplica escribe en la cuenta del cliente y se puede deshacer. El servidor vuelve a comprobar TODOS los candados (modo, ficha firmada, tope diario…) al aplicar: esta pantalla solo los
 * enseña.
 */
export function PestanaPropuestas({ perfilId, moneda, irA }: { perfilId: string; moneda: string | null; irA: (pestana: string) => void }) {
  const [datos, setDatos] = useState<Datos | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [verHistorial, setVerHistorial] = useState(false)
  const [filtro, setFiltro] = useState<FiltroDePropuestas>('todas')
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const conocidos = useProductosConocidos(perfilId)
  const vivo = useRef(true)
  const lista = useRef<HTMLDivElement>(null)

  const cargar = useCallback(async () => {
    try {
      const d = await llamar<Datos>(`/api/ads/cuenta/motor?perfilId=${perfilId}`)
      if (vivo.current) {
        setDatos(d)
        setError(null)
        // Lo marcado que ya no está pendiente (aplicado, descartado por otra persona…) se desmarca solo
        setMarcadas((m) => new Set([...m].filter((id) => d.propuestas.some((p) => p.id === id && (p.estado === 'pendiente' || p.estado === 'error')))))
      }
    } catch (e) {
      if (vivo.current) setError(e instanceof Error ? e.message : 'No se ha podido cargar el motor.')
    }
  }, [perfilId])

  useEffect(() => {
    vivo.current = true
    void cargar()
    return () => {
      vivo.current = false
    }
  }, [cargar])

  // Mientras Amazon prepara el informe de términos, se vuelve a preguntar solo
  useEffect(() => {
    if (!datos?.terminos.sincronizando) return
    const t = setTimeout(() => void cargar(), 8000)
    return () => clearTimeout(t)
  }, [datos, cargar])

  async function accion(id: string | null, nombre: string, cuerpo: Record<string, unknown>, ok: string) {
    setOcupado(id ?? nombre)
    try {
      await llamar('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, ...cuerpo } })
      toast.success(ok)
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
  const cuentas = useMemo(() => {
    const c: Record<string, number> = { todas: pendientes.length }
    for (const p of pendientes) c[filtroDe(p)] = (c[filtroDe(p)] ?? 0) + 1
    return c
  }, [pendientes])
  // Si el filtro elegido se queda sin nada (se han aplicado todas), se vuelve a «Todas» en vez de dejar la lista vacía
  const filtroActivo: FiltroDePropuestas = filtro !== 'todas' && !((cuentas[filtro] ?? 0) > 0) ? 'todas' : filtro
  const visibles = useMemo(() => (filtroActivo === 'todas' ? pendientes : pendientes.filter((p) => filtroDe(p) === filtroActivo)), [pendientes, filtroActivo])
  const grupos = useMemo(() => {
    // Se agrupan por el producto de la campaña de origen (el ASIN que lleva su nombre)
    const filas = visibles.map((p) => ({ ...p, nombre: p.campaignNombre, ...totalesDe([]) }))
    return agruparPorProducto(filas, new Map([...conocidos].map(([asin, c]) => [asin, c.resumen])))
  }, [visibles, conocidos])

  if (error) return <p className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>{error}</p>
  if (!datos) return <Cargando />

  const { modo, firmada, terminos } = datos
  const modoActual = MODOS.find((m) => m.id === modo) ?? MODOS[0]
  const aplicable = (p: Propuesta) => (datos.aplicables[p.id] ?? null) === null
  const marcablesVisibles = visibles.filter(aplicable)
  const todasMarcadas = marcablesVisibles.length > 0 && marcablesVisibles.every((p) => marcadas.has(p.id))
  const marcadasLista = pendientes.filter((p) => marcadas.has(p.id))

  const alternar = (id: string) =>
    setMarcadas((m) => {
      const n = new Set(m)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })

  function irDesdeTarea(t: TareaDeHoy) {
    if (!t.ir) return
    if ('pestana' in t.ir) return irA(t.ir.pestana)
    if ('accion' in t.ir) return void accion(null, 'terminos', { accion: 'actualizar-terminos' }, 'Pidiendo los términos a Amazon…')
    setFiltro(t.ir.filtro)
    lista.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex max-w-[1120px] flex-col gap-3 pb-24">
      {/* ------- el interruptor ------- */}
      <section className={TARJETA.base}>
        <header className={TARJETA.cabecera}>
          <h2 className={TITULO.seccion}>Motor de optimización · cuánto se le deja hacer</h2>
        </header>
        <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {MODOS.map((m) => {
              const bloqueado = m.aplica && !firmada
              const activo = m.id === modo
              return (
                <button
                  key={m.id}
                  type="button"
                  disabled={ocupado !== null || bloqueado}
                  onClick={() => !activo && cambiarModo(m.id)}
                  aria-pressed={activo}
                  title={bloqueado ? 'Para poder aplicar cambios, la ficha de cuenta tiene que estar firmada.' : undefined}
                  className={`rounded-[8px] border px-3 py-[9px] text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${activo ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:bg-[var(--ls-sup2)]'}`}
                >
                  <div className="flex items-center gap-[6px] text-[12.5px] font-semibold" style={{ color: activo ? 'var(--ls-acc-tinta)' : 'var(--ls-t1)' }}>
                    {bloqueado && <Lock className="h-3 w-3" />} {m.nombre}
                  </div>
                  <div className={`mt-[2px] text-[11px] leading-[1.4] ${activo ? 'text-[var(--ls-acc-tinta)] opacity-80' : TEXTO.t3}`}>{m.texto}</div>
                </button>
              )
            })}
          </div>
          {!firmada && (
            <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <CircleAlert className={AVISO.icono} />
              <span>
                La ficha de cuenta <span className={AVISO.fuerte}>no está firmada</span>: el motor puede proponer, pero no aplicar nada hasta que los umbrales estén firmados.{' '}
                <button type="button" className="underline" onClick={() => irA('ficha')}>Ir a la ficha</button>
              </span>
            </div>
          )}
          {modo === 'autopiloto' && (
            <p className={`${TIPO.s} ${TEXTO.t3}`}>
              El piloto excluye solo, como mucho <strong className={TEXTO.t1}>{datos.topeAutopiloto} términos al día</strong> en esta cuenta, y solo en campañas con la nomenclatura del SOP. Nunca los marcados «Revisar» ni las fichas de producto (ASIN). Todo queda en el log y se puede deshacer desde aquí.
            </p>
          )}
        </div>
      </section>

      {modo === 'apagado' ? (
        <section className={`${TARJETA.base} ${TARJETA.cuerpo}`}>
          <h3 className={TITULO.seccion}>Cómo funciona</h3>
          <ul className={`mt-2 flex list-disc flex-col gap-1 pl-5 ${TIPO.s} ${TEXTO.t2}`}>
            <li>Una vez al día lee de Amazon los términos de búsqueda de 30 días (sin los 3 últimos, que Amazon todavía está atribuyendo) y el rendimiento de cada keyword y ASIN.</li>
            <li><strong>Excluir</strong> lo que gasta sin pedidos (según la conversión real de la campaña, no un número fijo de clics) y lo que no tiene nada que ver con el producto (marcado para que lo revises).</li>
            <li><strong>Cosechar</strong> a EXACTA lo que ya vende dentro del objetivo, excluyéndolo a la vez de su campaña de origen.</li>
            <li><strong>Pujas</strong> hacia la que deja el ACoS en el objetivo (ventas por clic × ACoS objetivo), <strong>pausar</strong> lo que pasa el tope sin un pedido y <strong>subir presupuesto</strong> a lo rentable que se queda corto. Siempre con tu aprobación.</li>
            <li>Cada propuesta lleva su motivo y sus cifras. Empieza en «Solo sugiere» unos días para ver qué propondría, sin tocar nada.</li>
            <li>Necesita el <strong>ACoS objetivo de cada producto</strong> (pestaña Productos). Si falta el precio, usa el ticket medio de lo vendido por Ads y lo marca como estimación.</li>
          </ul>
        </section>
      ) : (
        <>
          <QueHacerHoy hoy={datos.hoy} moneda={moneda} aplicadasHoy={datos.aplicadasHoy} topeManual={datos.topeManual} ir={irDesdeTarea} />

          {/* ------- estado de los datos ------- */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`${TIPO.s} ${TEXTO.t3}`}>
              {terminos.actualizadoAt ? (
                <>
                  Términos {terminos.desde && terminos.hasta ? `del ${fechaCorta(terminos.desde)} al ${fechaCorta(terminos.hasta)}` : ''} ({entero(terminos.filas)} con clics) · leídos {haceCuanto(Date.parse(terminos.actualizadoAt))}
                </>
              ) : terminos.sincronizando ? (
                'Amazon está preparando los términos de búsqueda (la primera vez puede tardar unos minutos)…'
              ) : (
                'Todavía no se han leído los términos de búsqueda.'
              )}
            </span>
            {terminos.error && <span className={TIPO.xs} style={{ color: COLOR_ESTADO.ambar }}>Última lectura fallida: {terminos.error}</span>}
            <span className="ml-auto flex gap-2">
              <button type="button" disabled={ocupado !== null || terminos.sincronizando} onClick={() => accion(null, 'terminos', { accion: 'actualizar-terminos' }, 'Pidiendo los términos a Amazon…')} className={`${BOTON.base} ${BOTON.secundario}`} title="Pide a Amazon el informe de términos ahora (se hace solo una vez al día)">
                <RefreshCw className={`h-3 w-3 ${terminos.sincronizando ? 'animate-spin' : ''}`} /> Actualizar términos
              </button>
              <button type="button" disabled={ocupado !== null} onClick={() => accion(null, 'generar', { accion: 'generar' }, 'Propuestas revisadas con los datos de ahora.')} className={`${BOTON.base} ${BOTON.secundario}`} title="Vuelve a pasar las reglas con los datos guardados (no pide nada nuevo a Amazon)">
                {ocupado === 'generar' ? 'Revisando…' : 'Revisar ahora'}
              </button>
            </span>
          </div>

          {/* ------- la lista ------- */}
          <div ref={lista} className="flex scroll-mt-4 flex-wrap items-center gap-[6px]" role="tablist" aria-label="Tipo de propuesta">
            {FILTROS.filter((f) => f.id === 'todas' || (cuentas[f.id] ?? 0) > 0).map((f) => (
              <button key={f.id} type="button" role="tab" aria-selected={filtroActivo === f.id} onClick={() => setFiltro(f.id)} className={`${BOTON.chip} ${filtroActivo === f.id ? BOTON.chipEncendido : ''}`}>
                {f.texto} <span className="tabular-nums opacity-70">{cuentas[f.id] ?? 0}</span>
              </button>
            ))}
            {marcablesVisibles.length > 0 && (
              <label className={`ml-auto inline-flex cursor-pointer items-center gap-[6px] ${TIPO.s} ${TEXTO.t2}`}>
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
                  className="h-[14px] w-[14px] accent-[var(--ls-acc)]"
                />
                Marcar las {marcablesVisibles.length} que se pueden aplicar
              </label>
            )}
          </div>

          {pendientes.length === 0 ? (
            <section className={`${TARJETA.base} ${TARJETA.cuerpo}`}>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" style={{ color: COLOR_ESTADO.verde }} />
                <span className={`${TIPO.s} ${TEXTO.t2}`}>
                  {terminos.filas === 0 ? 'Cuando lleguen los términos, las propuestas aparecerán aquí.' : 'No hay nada que proponer ahora mismo: ningún término ni segmentación cumple una regla con muestra suficiente.'}
                </span>
              </div>
              <p className={`mt-2 ${TIPO.xs} ${TEXTO.t4}`}>Lo que ya se propuso o se resolvió hace poco no se repite (un cambio cada vez, y tiempo para ver su efecto).</p>
            </section>
          ) : (
            grupos.map((g) => (
              <section key={g.clave} className={TARJETA.base}>
                <header className={`${TARJETA.cabecera} justify-between`}>
                  <h3 className={`${TITULO.seccion} truncate`}>{g.titulo}</h3>
                  <span className={`${TIPO.xs} ${TEXTO.t4}`}>{g.asin ?? ''} · {g.campanas.length} {g.campanas.length === 1 ? 'propuesta' : 'propuestas'}</span>
                </header>
                <div className="divide-y divide-[var(--ls-linea)]">
                  {g.campanas.map((p) => (
                    <FilaDePropuesta
                      key={p.id}
                      p={p}
                      moneda={moneda}
                      bloqueo={datos.aplicables[p.id] ?? null}
                      ocupado={ocupado === p.id}
                      algoOcupado={ocupado !== null}
                      marcada={marcadas.has(p.id)}
                      marcar={() => alternar(p.id)}
                      aplicar={() => confirmarYAplicar(p)}
                      descartar={() => accion(p.id, 'descartar', { accion: 'descartar', id: p.id }, 'Descartada: no se vuelve a proponer en 14 días.')}
                    />
                  ))}
                </div>
              </section>
            ))
          )}

          <PanelDeUmbrales perfilId={perfilId} umbrales={datos.umbrales} guardables={datos.umbralesGuardables} ficha={datos.ficha} alGuardar={() => void cargar()} irA={irA} />

          {/* ------- el historial ------- */}
          {historial.length > 0 && (
            <section className={TARJETA.base}>
              <button type="button" onClick={() => setVerHistorial((v) => !v)} className={`${TARJETA.cabecera} w-full text-left`} aria-expanded={verHistorial}>
                {verHistorial ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <h3 className={TITULO.seccion}>Historial · últimos 30 días</h3>
                <span className={`ml-auto ${TIPO.xs} ${TEXTO.t4}`}>{historial.length}</span>
              </button>
              {verHistorial && (
                <div className="divide-y divide-[var(--ls-linea)]">
                  {historial.map((p) => (
                    <FilaDePropuesta key={p.id} p={p} moneda={moneda} bloqueo={null} ocupado={ocupado === p.id} algoOcupado={ocupado !== null} historial deshacer={() => confirmarYDeshacer(p)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </>
      )}
      <p className={`${TIPO.xs} ${TEXTO.t4}`}>Modo actual: <strong>{modoActual.nombre}</strong>. Cada cambio aplicado queda en el Log de cambios, desde donde se copia al Log del cliente.</p>

      {/* ------- la barra del lote: aparece al marcar algo ------- */}
      {marcadasLista.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-wrap items-center gap-2 rounded-[12px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-3 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.25)]" role="region" aria-label="Propuestas marcadas">
          <span className="text-[12.5px] font-semibold text-[var(--ls-t1)]">
            {marcadasLista.length} {marcadasLista.length === 1 ? 'marcada' : 'marcadas'}
          </span>
          <span className={`${TIPO.s} ${TEXTO.t3}`}>{resumenDeLote(marcadasLista)}</span>
          <span className="ml-auto flex gap-2">
            <button type="button" disabled={ocupado !== null} onClick={() => setMarcadas(new Set())} className={`${BOTON.base} ${BOTON.secundario}`}>
              <X className="h-3 w-3" /> Quitar marcas
            </button>
            <button type="button" disabled={ocupado !== null} onClick={() => descartarLote(marcadasLista)} className={`${BOTON.base} ${BOTON.secundario}`}>
              <Ban className="h-3 w-3" /> Descartar
            </button>
            <button type="button" disabled={ocupado !== null || datos.aplicadasHoy >= datos.topeManual} onClick={() => aplicarLote(marcadasLista)} className={`${BOTON.base} ${BOTON.primario}`}>
              {ocupado === 'lote' ? 'Aplicando…' : `Aplicar ${marcadasLista.length}`}
            </button>
          </span>
        </div>
      )}
    </div>
  )

  function confirmarYAplicar(p: Propuesta) {
    if (!window.confirm(`Se va a ${queHace(p)}.\n\nSe escribe en la cuenta de Amazon Ads del cliente. Se puede deshacer desde el historial.\n\n${p.motivo}\n\n¿Aplicar?`)) return
    void accion(p.id, 'aplicar', { accion: 'aplicar', id: p.id }, 'Aplicada en Amazon.')
  }

  async function aplicarLote(ps: Propuesta[]) {
    const quedan = Math.max(0, (datos?.topeManual ?? 40) - (datos?.aplicadasHoy ?? 0))
    const aviso = ps.length > quedan ? `\n\nOJO: hoy quedan ${quedan} cambios del tope diario; se aplicarán los ${quedan} primeros.` : ''
    const lineas = ps.slice(0, 8).map((p) => `· ${queHace(p).replace(/\n/g, ' ')}`).join('\n')
    if (!window.confirm(`Se van a aplicar ${ps.length} cambios en la cuenta de Amazon Ads del cliente:\n\n${lineas}${ps.length > 8 ? `\n… y ${ps.length - 8} más` : ''}${aviso}\n\nUno a uno, con todos sus controles. Cada uno se puede deshacer desde el historial. ¿Aplicar?`)) return
    setOcupado('lote')
    try {
      const r = await llamar<{ aplicadas: number; fallidas: number; resultados: Array<{ ok: boolean; error?: string }> }>('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, accion: 'aplicar-varias', ids: ps.map((p) => p.id) } })
      if (r.fallidas === 0) toast.success(`${r.aplicadas} ${r.aplicadas === 1 ? 'cambio aplicado' : 'cambios aplicados'} en Amazon.`)
      else toast.warning(`${r.aplicadas} aplicados y ${r.fallidas} con error (el motivo está en cada fila, filtro «Con error»). ${r.resultados.find((x) => !x.ok)?.error ?? ''}`.trim())
      setMarcadas(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar el lote.')
    } finally {
      await cargar()
      setOcupado(null)
    }
  }

  async function descartarLote(ps: Propuesta[]) {
    if (!window.confirm(`¿Descartar ${ps.length} ${ps.length === 1 ? 'propuesta' : 'propuestas'}? No se vuelven a proponer en 14 días. No se toca nada en Amazon.`)) return
    setOcupado('lote')
    try {
      const r = await llamar<{ descartadas: number }>('/api/ads/cuenta/motor', { metodo: 'POST', cuerpo: { perfilId, accion: 'descartar-varias', ids: ps.map((p) => p.id) } })
      toast.success(`${r.descartadas} ${r.descartadas === 1 ? 'descartada' : 'descartadas'}.`)
      setMarcadas(new Set())
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido descartar.')
    } finally {
      await cargar()
      setOcupado(null)
    }
  }

  function confirmarYDeshacer(p: Propuesta) {
    if (!window.confirm(`Se va a deshacer en Amazon lo que hizo esta propuesta («${p.termino}»). ¿Deshacer?`)) return
    void accion(p.id, 'deshacer', { accion: 'deshacer', id: p.id }, 'Deshecha.')
  }
}

/** «2026-11-08» → «8 nov» */
const fechaCorta = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Lo que hace una propuesta, en una frase (para la confirmación) */
function queHace(p: Propuesta): string {
  const n = (x: number | null) => (x == null ? '—' : x.toFixed(2).replace('.', ','))
  switch (p.tipo) {
    case 'negativizar':
      return p.esAsin ? `excluir la ficha ${p.termino.toUpperCase()} (segmentación negativa por productos) del grupo de anuncios de\n${p.campaignNombre}` : `excluir «${p.termino}» (negativa exacta) de la campaña\n${p.campaignNombre}`
    case 'puja':
      return `cambiar la puja de «${p.termino}» de ${n(p.valorActual)} a ${n(p.valorNuevo)} en\n${p.campaignNombre}`
    case 'presupuesto':
      return `cambiar el presupuesto diario de ${n(p.valorActual)} a ${n(p.valorNuevo)} en\n${p.campaignNombre}`
    case 'pausar':
      return `pausar «${p.termino}» en\n${p.campaignNombre}`
    default:
      return p.esAsin ? `atacar la ficha ${p.termino.toUpperCase()} en ${p.haciaCampaignNombre ?? 'ATAQUE ASIN'} y excluirla de ${p.campaignNombre}` : `añadir «${p.termino}» (exacta) a ${p.haciaCampaignNombre ?? '—'} y excluirlo de ${p.campaignNombre}`
  }
}

/** «3 excluir · 2 bajar puja» */
function resumenDeLote(ps: Propuesta[]): string {
  const c = new Map<string, number>()
  for (const p of ps) c.set(NOMBRE_DE_PROPUESTA(p).toLowerCase(), (c.get(NOMBRE_DE_PROPUESTA(p).toLowerCase()) ?? 0) + 1)
  return [...c].map(([k, v]) => `${v} ${k}`).join(' · ')
}

/** El color y el nombre de cada tipo: lo que sube gasto en verde, lo que lo recorta en rojo/ámbar */
const COLOR_DE_PROPUESTA = (p: Propuesta) =>
  p.tipo === 'negativizar' || p.tipo === 'pausar' ? COLOR_ESTADO.rojo : p.tipo === 'promover' ? COLOR_ESTADO.verde : p.tipo === 'presupuesto' ? COLOR_ESTADO.azul : (p.valorNuevo ?? 0) >= (p.valorActual ?? 0) ? COLOR_ESTADO.verde : COLOR_ESTADO.ambar
const NOMBRE_DE_PROPUESTA = (p: Propuesta) =>
  p.tipo === 'negativizar'
    ? p.esAsin
      ? 'Excluir ASIN'
      : 'Excluir'
    : p.tipo === 'promover'
      ? p.esAsin
        ? 'Atacar ASIN'
        : 'Cosechar a exacta'
      : p.tipo === 'pausar'
        ? 'Pausar'
        : p.tipo === 'presupuesto'
          ? (p.valorNuevo ?? 0) >= (p.valorActual ?? 0)
            ? 'Subir presupuesto'
            : 'Bajar presupuesto'
          : (p.valorNuevo ?? 0) >= (p.valorActual ?? 0)
            ? 'Subir puja'
            : 'Bajar puja'

function Etiqueta({ texto, color, titulo }: { texto: string; color: string; titulo?: string }) {
  return (
    <span className="inline-flex h-[18px] shrink-0 items-center rounded-[4px] px-[6px] text-[10.5px] font-semibold" style={{ background: `color-mix(in srgb, ${color} 16%, transparent)`, color }} title={titulo}>
      {texto}
    </span>
  )
}

function FilaDePropuesta({
  p,
  moneda,
  bloqueo,
  ocupado,
  algoOcupado,
  historial,
  marcada,
  marcar,
  aplicar,
  descartar,
  deshacer,
}: {
  p: Propuesta
  moneda: string | null
  bloqueo: string | null
  ocupado: boolean
  algoOcupado: boolean
  historial?: boolean
  marcada?: boolean
  marcar?: () => void
  aplicar?: () => void
  descartar?: () => void
  deshacer?: () => void
}) {
  const m = p.metricas
  const estilo = ESTILO_ESTADO[p.estado]
  return (
    <div className={`flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-[10px] ${marcada ? 'bg-[var(--ls-sel)]' : ''}`}>
      {!historial && (
        <input
          type="checkbox"
          checked={Boolean(marcada)}
          disabled={bloqueo !== null || algoOcupado}
          onChange={marcar}
          title={bloqueo ?? 'Marcar para aplicar o descartar en bloque'}
          aria-label={`Marcar «${p.termino}»`}
          className="mt-[3px] h-[14px] w-[14px] shrink-0 accent-[var(--ls-acc)] disabled:opacity-40"
        />
      )}
      <div className="min-w-[240px] flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Etiqueta texto={NOMBRE_DE_PROPUESTA(p)} color={COLOR_DE_PROPUESTA(p)} />
          {m.revisar && <Etiqueta texto="Revisar" color={COLOR_ESTADO.ambar} titulo="No comparte ninguna palabra con el producto: decide tú si es otra cosa (otro formato, otra categoría, una marca ajena) o una búsqueda buena" />}
          <span className="max-w-[460px] truncate text-[13px] font-semibold text-[var(--ls-t1)]" title={p.termino}>{p.tipo === 'presupuesto' ? 'Presupuesto diario' : p.esAsin ? p.termino.toUpperCase() : p.termino}</span>
          {(p.tipo === 'puja' || p.tipo === 'presupuesto') && p.valorActual != null && p.valorNuevo != null && (
            <span className="inline-flex items-center gap-1 text-[12.5px] tabular-nums text-[var(--ls-t2)]">
              {dinero(p.valorActual, moneda)} <ArrowRight className="h-3 w-3" /> <strong style={{ color: COLOR_DE_PROPUESTA(p) }}>{dinero(p.valorNuevo, moneda)}</strong>
            </span>
          )}
          {m.precioEstimado != null && <Etiqueta texto="Precio estimado" color={COLOR_ESTADO.gris} titulo={`El producto no tiene precio en su ficha: se usa el ticket medio de Ads (${decimal(m.precioEstimado)}). Ponle el precio en Productos para afinar.`} />}
          {historial && estilo && (
            <span className="inline-flex h-[17px] items-center rounded-full border px-[7px] text-[10.5px] font-medium" style={{ color: estilo.color, borderColor: estilo.color }}>
              {estilo.texto}
              {p.automatica ? ' · automática' : ''}
            </span>
          )}
        </div>
        <div className={`mt-[3px] flex flex-wrap items-center gap-[5px] ${TIPO.xs} ${TEXTO.t4}`}>
          <span className="max-w-[420px] truncate" title={p.campaignNombre}>{p.desdeRol ?? p.campaignNombre}</span>
          {p.tipo === 'promover' && (
            <>
              <ArrowRight className="h-3 w-3" />
              <span style={p.haciaCampaignId ? undefined : { color: COLOR_ESTADO.ambar }}>{p.haciaRol ?? '—'}{p.haciaCampaignId ? '' : ' (no existe: créala en «Crear campañas»)'}</span>
            </>
          )}
          {m.cvrPct != null && <span title="Conversión de referencia con la que se mide la muestra (la de la campaña, del producto o de la cuenta)">· CVR {decimal(m.cvrPct, 1)} %</span>}
        </div>
        <p className={`mt-1 ${TIPO.s} ${TEXTO.t2}`}>{p.motivo}</p>
        {p.error && <p className={`mt-1 ${TIPO.xs}`} style={{ color: COLOR_ESTADO.rojo }}>{p.error}</p>}
        {bloqueo && !historial && <p className={`mt-1 ${TIPO.xs}`} style={{ color: COLOR_ESTADO.ambar }}>{bloqueo}</p>}
      </div>
      <div className="flex shrink-0 gap-4 text-right">
        {p.tipo === 'presupuesto' ? <Dato etiqueta="Uso" valor={m.usoPct == null ? '—' : `${m.usoPct} %`} /> : <Dato etiqueta="Clics" valor={entero(m.clics)} />}
        <Dato etiqueta={p.tipo === 'presupuesto' ? 'Gasto 7 d' : 'Gasto'} valor={dinero(m.gasto, moneda)} />
        {p.tipo === 'presupuesto' ? <Dato etiqueta="Ventas 7 d" valor={dinero(m.ventas, moneda)} /> : <Dato etiqueta="Pedidos" valor={entero(m.pedidos)} />}
        <Dato etiqueta="ACoS" valor={m.acosPct == null ? '—' : `${decimal(m.acosPct, 1)} %`} />
      </div>
      <div className="flex shrink-0 items-center gap-[6px]">
        {!historial && (
          <>
            <button type="button" disabled={algoOcupado || bloqueo !== null} onClick={aplicar} title={bloqueo ?? undefined} className={`${BOTON.base} ${BOTON.primario}`}>
              {ocupado ? 'Aplicando…' : 'Aplicar'}
            </button>
            <button type="button" disabled={algoOcupado} onClick={descartar} className={`${BOTON.base} ${BOTON.secundario}`} title="No volverá a proponerse en 14 días">
              <Ban className="h-3 w-3" /> Descartar
            </button>
          </>
        )}
        {historial && p.estado === 'aplicada' && (
          <button type="button" disabled={algoOcupado} onClick={deshacer} className={`${BOTON.base} ${BOTON.secundario}`}>
            <Undo2 className="h-3 w-3" /> Deshacer
          </button>
        )}
      </div>
    </div>
  )
}

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div>
      <div className={`${TIPO.xs} ${TEXTO.t4}`}>{etiqueta}</div>
      <div className="text-[13px] font-medium tabular-nums text-[var(--ls-t1)]">{valor}</div>
    </div>
  )
}
