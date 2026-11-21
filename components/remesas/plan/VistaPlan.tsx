'use client'

import { useEffect, useMemo, useState } from 'react'
import { MotionConfig } from 'framer-motion'
import { AlertTriangle, CalendarRange, Coins, PackageCheck, RefreshCw, Search, Sparkles, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Confirmacion, EsqueletoTarjeta, EstadoVacio, FOCO, FilaDeKpis, Kpi, Segmentado, TACTIL, type Opcion } from '@/components/ui-ls'
import { diaEnEspana } from '@/lib/fba/fechas'
import type { EnvioPropuestoGuardado, EstadoEnvioPropuesto, MotivoDescarte } from '@/lib/fba/plan-tipos'
import { BandaDeCalidad } from '../comun/BandaDeCalidad'
import type { CallbacksRemesas, ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { ESTADO_ENVIO, compararPrioridad, dineroPorMoneda, entero, sumarDias } from '../comun/estilo-plan'
import { useEnviosPropuestos } from '../comun/useEnviosPropuestos'
import { usePlan } from '../comun/usePlan'
import { cx } from '../comun/ui'
import { CalendarioDeSalidas } from './CalendarioDeSalidas'
import { DescartarDialog } from './DescartarDialog'
import { TarjetaEnvioPropuesto, type CambioDesdeTarjeta } from './TarjetaEnvioPropuesto'

/**
 * LA VISTA «PLAN» DE REMESAS (spec remesas-pro §1.2, §1.5, §4 y §6.3): ¿qué hay que enviar, cuánto y antes de qué
 * fecha, en todos los clientes (o en uno)?
 *
 *   [Segmentado: Próximos 7 días · 14 días · 30 días · Todo]  [Cliente ▾] [Estado ▾] [Quién ▾] [Buscar]
 *   KPI: envíos · unidades · € en juego (por moneda) · vencidos
 *   CALENDARIO DE SALIDAS (rejilla desde xl; lista por semanas por debajo)
 *   TARJETAS de los envíos propuestos (vencidos primero, luego por prioridad y fecha de decidir)
 *
 * Con la prop `clienteId`, solo ese cliente (sin selector de cliente), con su banda de calidad y «Recalcular plan».
 * Al pulsar una tarjeta se llama `callbacks.onAbrirEnvioPropuesto(id)`: el `PanelEnvioPropuesto` lo monta UNA vez la
 * página (oleada 4). Descartar desde una tarjeta abre `DescartarDialog` (motivo obligatorio); convertir pide
 * confirmación y lleva a la remesa con `onIrA('cliente', 'propuestas', { cliente, remesa })`.
 * Los filtros se guardan en la URL con `history.replaceState` (pperiodo, pestado, pquien, pcliente, q): no dejan
 * historial ni recargan la página.
 *
 * API
 *   <VistaPlan sesion callbacks clientes? clienteId? hoy? />
 *
 * Puro (con prueba en plan.prueba.ts):
 *   filtrarEnvios(envios, filtro, hoy, usuarioId) · ordenarEnvios(envios) · cuentasPorPeriodo(envios, hoy) · estadoParaApi(filtro)
 */

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

export type PeriodoPlan = 'semana' | 'dos' | 'mes' | 'todo'
export type EstadoFiltro = 'activos' | 'vencidos' | EstadoEnvioPropuesto | 'todos'
export type QuienFiltro = 'todos' | 'mios' | 'sin_responsable'

export interface FiltroPlan {
  periodo: PeriodoPlan
  estado: EstadoFiltro
  quien: QuienFiltro
  clienteId: string | null
  buscar: string
}

const DIAS_PERIODO: Record<Exclude<PeriodoPlan, 'todo'>, number> = { semana: 7, dos: 14, mes: 30 }
const ACTIVOS_FILTRO: readonly string[] = ['activos', 'vencidos', 'nuevo', 'hablado', 'esperando_cliente', 'en_preparacion']

/** Qué se le pide a la API: los activos se piden de una vez y se filtran aquí; el resto, por su estado */
export function estadoParaApi(estado: EstadoFiltro): string {
  if (ACTIVOS_FILTRO.includes(estado)) return 'activos'
  return estado
}

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

/** ¿Entra el envío en el periodo? Lo vencido entra siempre: es lo primero que hay que ver */
function enPeriodo(e: Pick<EnvioPropuestoGuardado, 'salirAntesDe' | 'vencido'>, periodo: PeriodoPlan, hoy: string): boolean {
  if (periodo === 'todo' || e.vencido) return true
  return e.salirAntesDe <= sumarDias(hoy, DIAS_PERIODO[periodo])
}

export function filtrarEnvios(envios: readonly EnvioPropuestoGuardado[], f: FiltroPlan, hoy: string, usuarioId: string | null): EnvioPropuestoGuardado[] {
  const q = normalizar(f.buscar)
  return envios.filter((e) => {
    if (f.clienteId && e.clienteId !== f.clienteId) return false
    if (f.estado === 'vencidos' && !e.vencido) return false
    if (f.estado !== 'activos' && f.estado !== 'vencidos' && f.estado !== 'todos' && e.estado !== f.estado) return false
    if (f.quien === 'mios' && (!usuarioId || e.responsableId !== usuarioId)) return false
    if (f.quien === 'sin_responsable' && e.responsableId) return false
    if (!enPeriodo(e, f.periodo, hoy)) return false
    if (q) {
      const texto = normalizar(
        [e.clienteNombre, e.responsableNombre ?? '', ...e.porque, ...e.lineas.map((l) => `${l.sku} ${l.nombre ?? ''} ${l.modelo ?? ''}`)].join(' ')
      )
      if (!q.split(/\s+/).every((p) => texto.includes(p))) return false
    }
    return true
  })
}

/** Vencidos primero; después por prioridad, fecha de decidir y € en juego */
export function ordenarEnvios<T extends Pick<EnvioPropuestoGuardado, 'vencido' | 'prioridad' | 'decidirAntesDe' | 'eurosEnRiesgo' | 'clienteNombre'>>(envios: readonly T[]): T[] {
  return [...envios].sort(
    (a, b) =>
      Number(b.vencido) - Number(a.vencido) ||
      compararPrioridad(a.prioridad, b.prioridad) ||
      a.decidirAntesDe.localeCompare(b.decidirAntesDe) ||
      (b.eurosEnRiesgo ?? 0) - (a.eurosEnRiesgo ?? 0) ||
      a.clienteNombre.localeCompare(b.clienteNombre, 'es')
  )
}

/** Cuántos caen en cada periodo (para el número del Segmentado) */
export function cuentasPorPeriodo(envios: readonly Pick<EnvioPropuestoGuardado, 'salirAntesDe' | 'vencido'>[], hoy: string): Record<PeriodoPlan, number> {
  const c: Record<PeriodoPlan, number> = { semana: 0, dos: 0, mes: 0, todo: envios.length }
  for (const e of envios) for (const p of ['semana', 'dos', 'mes'] as const) if (enPeriodo(e, p, hoy)) c[p]++
  return c
}

/* ------------------------------------------------------------------ */
/* URL (replaceState)                                                  */
/* ------------------------------------------------------------------ */

const PERIODOS: readonly PeriodoPlan[] = ['semana', 'dos', 'mes', 'todo']
const ESTADOS_FILTRO: ReadonlyArray<{ id: EstadoFiltro; texto: string }> = [
  { id: 'activos', texto: 'Todos los activos' },
  { id: 'vencidos', texto: 'Vencidos' },
  { id: 'nuevo', texto: ESTADO_ENVIO.nuevo.texto },
  { id: 'hablado', texto: ESTADO_ENVIO.hablado.texto },
  { id: 'esperando_cliente', texto: ESTADO_ENVIO.esperando_cliente.texto },
  { id: 'en_preparacion', texto: ESTADO_ENVIO.en_preparacion.texto },
  { id: 'enviado', texto: ESTADO_ENVIO.enviado.texto },
  { id: 'descartado', texto: ESTADO_ENVIO.descartado.texto },
  { id: 'caducado', texto: ESTADO_ENVIO.caducado.texto },
  { id: 'todos', texto: 'Todos (también cerrados)' },
]

function leerFiltroDeUrl(): Partial<FiltroPlan> {
  if (typeof window === 'undefined') return {}
  const p = new URLSearchParams(window.location.search)
  const salida: Partial<FiltroPlan> = {}
  const periodo = p.get('pperiodo')
  if (periodo && (PERIODOS as readonly string[]).includes(periodo)) salida.periodo = periodo as PeriodoPlan
  const estado = p.get('pestado')
  if (estado && ESTADOS_FILTRO.some((x) => x.id === estado)) salida.estado = estado as EstadoFiltro
  const quien = p.get('pquien')
  if (quien === 'mios' || quien === 'sin_responsable') salida.quien = quien
  const cliente = p.get('pcliente')
  if (cliente) salida.clienteId = cliente
  const q = p.get('q')
  if (q) salida.buscar = q
  return salida
}

function escribirFiltroEnUrl(f: FiltroPlan, conCliente: boolean) {
  if (typeof window === 'undefined') return
  try {
    const url = new URL(window.location.href)
    const poner = (k: string, v: string | null, porDefecto: string | null) => {
      if (v && v !== porDefecto) url.searchParams.set(k, v)
      else url.searchParams.delete(k)
    }
    poner('pperiodo', f.periodo, 'todo')
    poner('pestado', f.estado, 'activos')
    poner('pquien', f.quien, 'todos')
    poner('pcliente', conCliente ? f.clienteId : null, null)
    poner('q', f.buscar.trim() || null, null)
    if (url.href !== window.location.href) window.history.replaceState(window.history.state, '', url.href)
  } catch {
    /* sin URL que tocar: los filtros siguen en memoria */
  }
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

const SELECT = cx(
  'h-9 min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] text-[13px] text-[var(--ls-t1)] [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[16px]',
  FOCO
)

export interface VistaPlanProps {
  sesion: SesionRemesas
  callbacks: CallbacksRemesas
  /** Para el selector de cliente y saber dónde se puede editar; si no se pasa, sale de los envíos */
  clientes?: readonly ClienteRemesas[]
  /** Solo este cliente (sin selector), con su banda de calidad y «Recalcular plan» */
  clienteId?: string | null
  hoy?: string
}

export function VistaPlan({ sesion, callbacks, clientes = [], clienteId = null, hoy: hoyDado }: VistaPlanProps) {
  const hoy = hoyDado ?? diaEnEspana()
  const [filtro, setFiltro] = useState<FiltroPlan>({ periodo: 'todo', estado: 'activos', quien: 'todos', clienteId: null, buscar: '' })
  const [descartando, setDescartando] = useState<EnvioPropuestoGuardado | null>(null)
  const [convirtiendo, setConvirtiendo] = useState<EnvioPropuestoGuardado | null>(null)

  // Los filtros de la URL, una vez montado (en el servidor no hay window)
  useEffect(() => {
    const deUrl = leerFiltroDeUrl()
    if (Object.keys(deUrl).length) setFiltro((f) => ({ ...f, ...deUrl }))
  }, [])
  useEffect(() => {
    escribirFiltroEnUrl(filtro, !clienteId)
  }, [filtro, clienteId])

  // C6: el Plan es la agenda de TODOS los clientes; entrar con un cliente («Ver en el plan» desde Reponer) solo pone el filtro de cliente (se puede quitar).
  // El modo «cliente fijo» con su banda y «Recalcular» repetía lo que ya está en Cliente → Reponer
  const clienteFijo: string | null = null
  useEffect(() => {
    if (clienteId) setFiltro((f) => ({ ...f, clienteId }))
  }, [clienteId])
  const datos = useEnviosPropuestos(sesion.esAgencia ? { clienteId: clienteFijo, estado: estadoParaApi(filtro.estado) } : null)
  const plan = usePlan(sesion.esAgencia ? clienteFijo : null)

  const puedeEditar = (cId: string) => {
    if (!sesion.esAgencia) return false
    const c = clientes.find((x) => x.id === cId)
    if (c) return c.puedeEditar
    return sesion.editables === null || sesion.editables.includes(cId)
  }

  const opcionesCliente = useMemo(() => {
    const m = new Map<string, string>()
    for (const c of clientes) m.set(c.id, c.nombre)
    for (const e of datos.envios) if (!m.has(e.clienteId)) m.set(e.clienteId, e.clienteNombre)
    return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'))
  }, [clientes, datos.envios])

  const filtroEfectivo: FiltroPlan = { ...filtro, clienteId: clienteFijo ?? filtro.clienteId }
  // Para las cuentas del Segmentado: todo menos el periodo
  const sinPeriodo = useMemo(() => filtrarEnvios(datos.envios, { ...filtroEfectivo, periodo: 'todo' }, hoy, sesion.usuarioId), [datos.envios, filtroEfectivo.estado, filtroEfectivo.quien, filtroEfectivo.clienteId, filtroEfectivo.buscar, hoy, sesion.usuarioId]) // eslint-disable-line react-hooks/exhaustive-deps
  const cuentas = cuentasPorPeriodo(sinPeriodo, hoy)
  const visibles = useMemo(() => ordenarEnvios(filtrarEnvios(sinPeriodo, { ...filtroEfectivo, estado: 'todos', quien: 'todos', buscar: '' }, hoy, sesion.usuarioId)), [sinPeriodo, filtroEfectivo.periodo, hoy, sesion.usuarioId]) // eslint-disable-line react-hooks/exhaustive-deps

  const unidades = visibles.reduce((s, e) => s + e.unidades, 0)
  const porMoneda = new Map<string, number>()
  for (const e of visibles) if (e.eurosEnRiesgo) porMoneda.set(e.moneda, (porMoneda.get(e.moneda) ?? 0) + e.eurosEnRiesgo)
  const monedas = [...porMoneda.entries()].map(([moneda, total]) => ({ moneda, total })).sort((a, b) => b.total - a.total)
  const vencidos = visibles.filter((e) => e.vencido).length
  const sinDueno = visibles.filter((e) => !e.responsableId && (e.estado === 'nuevo' || e.estado === 'hablado' || e.estado === 'esperando_cliente')).length

  const opcionesPeriodo: ReadonlyArray<Opcion<PeriodoPlan>> = [
    // Días corridos desde hoy (no «esta semana» hasta el domingo, que es lo que cuenta el KPI de Hoy)
    { id: 'semana', texto: 'Próximos 7 días', cuenta: cuentas.semana },
    { id: 'dos', texto: '14 días', cuenta: cuentas.dos },
    { id: 'mes', texto: '30 días', cuenta: cuentas.mes },
    { id: 'todo', texto: 'Todo', cuenta: cuentas.todo },
  ]

  /* ---------------- Acciones de las tarjetas ---------------- */

  async function cambiar(e: EnvioPropuestoGuardado, cambio: CambioDesdeTarjeta & { motivoDescarte?: MotivoDescarte; nota?: string | null }, exito: string): Promise<boolean> {
    const r = await datos.cambiar(e, cambio)
    if (r.ok) {
      if (r.aviso) toast.warning(r.aviso)
      else toast.success(exito)
      return true
    }
    if (r.estado === 409 && r.conflicto) {
      toast.error('Alguien ha cambiado este envío mientras lo mirabas: lo recargo para que veas lo último.')
      void datos.recargar()
      return false
    }
    toast.error(r.error)
    return false
  }

  const alCambiarDesdeTarjeta = (e: EnvioPropuestoGuardado, c: CambioDesdeTarjeta) => {
    const texto =
      c.responsableId !== undefined
        ? c.responsableId
          ? 'Ahora es tuyo'
          : 'Lo has soltado'
        : c.estado === 'hablado'
          ? e.estado === 'esperando_cliente'
            ? 'Vuelve a «Hablado»'
            : 'Marcado como hablado: se congela lo hablado'
          : c.estado === 'esperando_cliente'
            ? 'Esperando al cliente'
            : c.estado === 'nuevo'
              ? 'Recuperado'
              : 'Hecho'
    void cambiar(e, c, texto)
  }

  async function hacerConvertir(e: EnvioPropuestoGuardado) {
    const r = await datos.convertir(e)
    if (!r.ok) {
      if (r.conflicto) void datos.recargar()
      throw new Error(r.error)
    }
    toast.success(r.yaExistia ? 'Este envío ya tenía su remesa: te llevo a ella' : 'Remesa creada en borrador')
    callbacks.onIrA('cliente', 'propuestas', { cliente: e.clienteId, remesa: r.remesaId })
  }

  const abrirRemesa = (e: EnvioPropuestoGuardado) => {
    if (!e.remesaId) return
    callbacks.onIrA('cliente', e.estado === 'enviado' ? 'envios' : 'propuestas', { cliente: e.clienteId, remesa: e.remesaId })
  }

  /* ---------------- Pantalla ---------------- */

  if (!sesion.esAgencia) {
    return <EstadoVacio icono={CalendarRange} titulo="El plan de envíos lo gestiona Liberty Seller" descripcion="Aquí ves tu stock y tus envíos en la sección de tu cuenta." />
  }

  const calidad = clienteFijo && plan.deAgencia && plan.plan && 'calidad' in plan.plan ? plan.plan.calidad : null
  const puedeRecalcular = !!clienteFijo && puedeEditar(clienteFijo)
  const hayFiltros = filtro.estado !== 'activos' || filtro.quien !== 'todos' || filtro.buscar.trim() !== '' || (!clienteFijo && filtro.clienteId !== null) || filtro.periodo !== 'todo'

  return (
    <MotionConfig reducedMotion="user">
      <div className="min-w-0 space-y-5">
        {clienteFijo && calidad && (
          <BandaDeCalidad
            calidad={calidad}
            esAdmin={sesion.esAdmin}
            puedeEditar={puedeRecalcular}
            hoy={hoy}
            onPonerPlazos={() => callbacks.onIrA('cliente', 'reposicion', { cliente: clienteFijo })}
          />
        )}
        {datos.migracion316 === false && (
          <p className="rounded-[12px] border border-[color-mix(in_srgb,var(--ls-e-ambar)_40%,transparent)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_9%,transparent)] px-4 py-3 text-[13px] text-[var(--ls-t2)]">
            {datos.aviso ?? 'Falta lanzar la migración 316: el plan se ve pero no se puede gestionar.'}
          </p>
        )}

        {/* Filtros */}
        <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
          <Segmentado etiqueta="Cuándo tiene que salir" opciones={opcionesPeriodo} valor={filtro.periodo} onCambio={(p) => setFiltro((f) => ({ ...f, periodo: p }))} className="max-w-full" />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {!clienteFijo && (
              <select className={cx(SELECT, 'min-w-[140px] flex-[1_1_140px] sm:max-w-[220px] sm:flex-none')} aria-label="Cliente" value={filtro.clienteId ?? ''} onChange={(ev) => setFiltro((f) => ({ ...f, clienteId: ev.target.value || null }))}>
                <option value="">Todos los clientes</option>
                {opcionesCliente.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre}
                  </option>
                ))}
              </select>
            )}
            <select className={cx(SELECT, 'min-w-[140px] flex-[1_1_140px] sm:flex-none')} aria-label="Estado" value={filtro.estado} onChange={(ev) => setFiltro((f) => ({ ...f, estado: ev.target.value as EstadoFiltro }))}>
              {ESTADOS_FILTRO.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.texto}
                </option>
              ))}
            </select>
            <select className={cx(SELECT, 'min-w-[140px] flex-[1_1_140px] sm:flex-none')} aria-label="Responsable" value={filtro.quien} onChange={(ev) => setFiltro((f) => ({ ...f, quien: ev.target.value as QuienFiltro }))}>
              <option value="todos">De todos</option>
              <option value="mios">Mis envíos</option>
              <option value="sin_responsable">Sin responsable</option>
            </select>
            <label className="relative flex min-w-0 basis-full items-center sm:max-w-[260px] sm:flex-[1_1_180px] sm:basis-auto">
              <Search className="pointer-events-none absolute left-[10px] h-[14px] w-[14px] text-[var(--ls-t4)]" aria-hidden />
              <input
                type="search"
                value={filtro.buscar}
                onChange={(ev) => setFiltro((f) => ({ ...f, buscar: ev.target.value }))}
                placeholder="Buscar cliente, SKU…"
                aria-label="Buscar en el plan"
                className={cx(SELECT, 'w-full pl-8 placeholder:text-[var(--ls-t4)]')}
              />
            </label>
            {puedeRecalcular && (
              <Boton variante="secundario" icono={Sparkles} cargando={plan.recalculando} onClick={() => void plan.recalcular()} className={TACTIL}>
                Recalcular plan
              </Boton>
            )}
            <Boton variante="fantasma" soloIcono icono={RefreshCw} aria-label="Actualizar" title="Actualizar" cargando={datos.cargando && datos.envios.length > 0} onClick={() => void datos.recargar()} />
          </div>
        </div>

        {/* KPI */}
        <FilaDeKpis minimo={170}>
          <Kpi etiqueta="Envíos propuestos" valor={datos.cargando && datos.envios.length === 0 ? null : visibles.length} cargando={datos.cargando && datos.envios.length === 0} icono={Truck} acento="remesas" nota={sinDueno > 0 ? `${sinDueno} sin responsable` : 'todos con responsable'} indice={0} />
          <Kpi etiqueta="Unidades" valor={visibles.length ? unidades : 0} cargando={datos.cargando && datos.envios.length === 0} icono={PackageCheck} acento="remesas" nota="lo hablado o lo que pide el plan" indice={1} />
          <Kpi
            etiqueta="En juego si no salen"
            valor={monedas[0]?.total ?? 0}
            formato={(n) => dineroPorMoneda([{ moneda: monedas[0]?.moneda ?? 'EUR', total: n }])}
            cargando={datos.cargando && datos.envios.length === 0}
            icono={Coins}
            acento="remesas"
            nota={monedas.length > 1 ? dineroPorMoneda(monedas) : 'ventas perdidas a precio actual'}
            indice={2}
          />
          <Kpi etiqueta="Vencidos" valor={vencidos} cargando={datos.cargando && datos.envios.length === 0} icono={AlertTriangle} acento={vencidos > 0 ? 'var(--ls-e-rojo)' : 'remesas'} nota={vencidos > 0 ? 'ya pasó su fecha límite' : 'nada vencido'} indice={3} />
        </FilaDeKpis>

        {datos.error && datos.envios.length === 0 ? (
          <EstadoVacio icono={AlertTriangle} titulo="No se ha podido leer el plan" descripcion={datos.error} accion={{ texto: 'Volver a probar', onClick: () => void datos.recargar(), icono: RefreshCw }} />
        ) : datos.cargando && datos.envios.length === 0 ? (
          <div className="grid gap-3 xl:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <EsqueletoTarjeta key={i} alto={200} />
            ))}
          </div>
        ) : visibles.length === 0 ? (
          <EstadoVacio
            icono={CalendarRange}
            titulo={hayFiltros ? 'Nada con estos filtros' : 'No hay nada que enviar ahora'}
            descripcion={
              hayFiltros
                ? 'Prueba con «Todo» o quita algún filtro.'
                : 'El plan no propone ningún envío: el stock y lo que viene de camino cubren hasta la siguiente ventana. Se recalcula solo cuando hay ventas nuevas.'
            }
            accion={hayFiltros ? { texto: 'Quitar filtros', onClick: () => setFiltro({ periodo: 'todo', estado: 'activos', quien: 'todos', clienteId: null, buscar: '' }) } : undefined}
          />
        ) : (
          <>
            <section className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4 shadow-[var(--ls-sombra-1)] sm:p-5">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-[14px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Calendario de salidas</h2>
                <p className="text-[12px] tabular-nums text-[var(--ls-t3)]">
                  {entero(visibles.length)} {visibles.length === 1 ? 'envío' : 'envíos'} · {entero(unidades)} ud
                </p>
              </div>
              <CalendarioDeSalidas envios={visibles} hoy={hoy} onAbrir={callbacks.onAbrirEnvioPropuesto} mostrarCliente={!clienteFijo} />
            </section>

            <section className="min-w-0" aria-label="Envíos propuestos">
              <ul className="grid min-w-0 gap-3 xl:grid-cols-2">
                {visibles.map((e, i) => (
                  <li key={e.id} className="min-w-0">
                    <TarjetaEnvioPropuesto
                      envio={e}
                      hoy={hoy}
                      usuarioId={sesion.usuarioId}
                      puedeEditar={puedeEditar(e.clienteId)}
                      ocupado={datos.ocupado === e.id}
                      mostrarCliente={!clienteFijo}
                      indice={i < 12 ? i : undefined}
                      onAbrir={callbacks.onAbrirEnvioPropuesto}
                      onCambiar={alCambiarDesdeTarjeta}
                      onConvertir={(x) => setConvirtiendo(x)}
                      onDescartar={(x) => setDescartando(x)}
                      onAbrirRemesa={abrirRemesa}
                    />
                  </li>
                ))}
              </ul>
            </section>
          </>
        )}

        <DescartarDialog
          abierto={descartando !== null}
          onCambio={(a) => !a && setDescartando(null)}
          titulo={descartando ? `Descartar el envío de ${descartando.clienteNombre}` : undefined}
          unidades={descartando?.unidades ?? null}
          onConfirmar={async (motivo, nota) => {
            if (!descartando) return false
            return cambiar(descartando, { estado: 'descartado', motivoDescarte: motivo, nota }, motivo === 'descatalogada' ? 'Descartado: sus referencias dejan de planificarse' : 'Envío descartado')
          }}
        />

        <Confirmacion
          abierto={convirtiendo !== null}
          onCambio={(a) => !a && setConvirtiendo(null)}
          palabra={null}
          tono="normal"
          titulo={convirtiendo ? `¿Convertir en remesa el envío de ${convirtiendo.clienteNombre}?` : '¿Convertir en remesa?'}
          descripcion={
            convirtiendo
              ? `Se crea una remesa en borrador con ${entero(convirtiendo.unidades)} ud (${convirtiendo.lineasAceptadas ? 'lo hablado' : 'el plan de hoy'}) y te llevo a ella. Después sigue el flujo de siempre: enlace al cliente, etiquetas, cajas y envío.`
              : undefined
          }
          textoConfirmar="Crear la remesa"
          onConfirmar={async () => {
            if (!convirtiendo) return
            try {
              await hacerConvertir(convirtiendo)
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'No se ha podido convertir el envío')
              throw err
            }
          }}
        />
      </div>
    </MotionConfig>
  )
}
