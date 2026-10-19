'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Boxes, Loader2, RefreshCw, Search, Sparkles } from 'lucide-react'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import { costeMensual, estimarAlmacenaje, mesDe, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import type { EstadoSku, InventarioDeCliente, SkuInventario } from '@/lib/fba/inventario'
import { Clave, cx, Tarjeta, Vacio } from '../comun/ui'
import { descargarCsv, VIZ } from '../comun/graficos'
import { fecha } from '../formato'
import { FichaSku } from './FichaSku'
import { AjusteAlmacenaje, ChipEstado, EdadDelStock, GraficoVentas, Kpi } from './piezas'
import { ESTADO_SKU, eur, hace, m3, n0, n1, n2, pct } from './formato'
import { useInventario, useSupuestosAlmacenaje } from './useInventario'

/**
 * EL INVENTARIO DE UN CLIENTE, ENTERO.
 *
 * Todo lo que tiene en los almacenes de Amazon, referencia a referencia: cuánto stock hay,
 * a qué ritmo se vende, cuánto se devuelve, cuánto lleva parado y cuánto puede estar
 * costando que siga ahí. Sale del libro mayor de inventario y del espejo del catálogo
 * (lib/fba/inventario.ts), no de lo que alguien haya apuntado.
 *
 * Es la pantalla para decidir QUÉ reponer y QUÉ NO: lo que se agota pide un envío, y lo que
 * lleva meses quieto es dinero parado —y almacenaje que se paga cada mes—.
 */

type IdFiltro = 'con_stock' | 'todas' | 'agotadas' | 'urgentes' | 'parado' | 'exceso' | 'devoluciones' | 'antiguas' | 'no_vendibles'

interface Filtro {
  id: IdFiltro
  texto: string
  ayuda: string
  admite: (s: SkuInventario) => boolean
  /** Se pinta con un punto de color cuando hay algo */
  alerta?: boolean
}

const FILTROS: Filtro[] = [
  { id: 'con_stock', texto: 'Con stock', ayuda: 'Lo que hay ahora en la red de Amazon', admite: (s) => s.enAmazon > 0 },
  { id: 'agotadas', texto: 'Agotadas', ayuda: ESTADO_SKU.agotado.ayuda, admite: (s) => s.estado === 'agotado', alerta: true },
  { id: 'urgentes', texto: 'Se agotan en 14 días', ayuda: ESTADO_SKU.urgente.ayuda, admite: (s) => s.estado === 'urgente', alerta: true },
  { id: 'parado', texto: 'Paradas', ayuda: ESTADO_SKU.parado.ayuda, admite: (s) => s.estado === 'parado' },
  { id: 'exceso', texto: 'Exceso', ayuda: ESTADO_SKU.exceso.ayuda, admite: (s) => s.estado === 'exceso' },
  { id: 'devoluciones', texto: 'Devoluciones altas', ayuda: 'Se devuelve el 12 % o más de lo que se vende', admite: (s) => s.alertas.includes('devoluciones altas') },
  { id: 'antiguas', texto: 'Más de 270 días', ayuda: 'Tiene unidades de más de 270 días en Amazon: zona de recargo por antigüedad', admite: (s) => s.porTramo.t271 + s.porTramo.t366 > 0 },
  { id: 'no_vendibles', texto: 'No vendibles', ayuda: 'Tiene unidades en la red de Amazon que no se pueden vender ahora: en tránsito sin registrar, reservadas o dañadas', admite: (s) => s.noDisponibles > 0 },
  { id: 'todas', texto: 'Todas', ayuda: 'Todas las referencias que han tenido stock o ventas', admite: () => true },
]

interface Ctx {
  mes: number
  supuestos: SupuestosAlmacenaje
}

interface Columna {
  id: string
  titulo: string
  ayuda?: string
  /** El valor con el que se ordena y se exporta. null va siempre al final */
  valor: (s: SkuInventario, c: Ctx) => number | string | null
  celda: (s: SkuInventario, c: Ctx) => ReactNode
}

const ORDEN_ESTADO: Record<EstadoSku, number> = { agotado: 0, urgente: 1, bajo: 2, parado: 3, exceso: 4, sin_ventas: 5, ok: 6, sin_datos: 7 }

const tonoCobertura = (s: SkuInventario): string => {
  if (s.cobertura === null) return 'var(--ls-t4)'
  if (s.cobertura <= 14) return COLOR_ESTADO.rojo
  if (s.cobertura <= 30) return COLOR_ESTADO.ambar
  if (s.cobertura > 120) return COLOR_ESTADO.azul
  return COLOR_ESTADO.verde
}

const COLUMNAS: Columna[] = [
  { id: 'estado', titulo: 'Estado', valor: (s) => ORDEN_ESTADO[s.estado], celda: (s) => <ChipEstado estado={s.estado} /> },
  { id: 'enAmazon', titulo: 'En Amazon', ayuda: 'Total en la red de Amazon, con lo que viene de camino', valor: (s) => s.enAmazon, celda: (s) => <b className="font-semibold text-[var(--ls-t1)]">{n0(s.enAmazon)}</b> },
  {
    id: 'vendibles',
    titulo: 'Vendibles',
    ayuda: 'Lo que se puede vender ahora mismo',
    valor: (s) => s.vendibles,
    celda: (s) => <span style={s.noDisponibles > 0 ? { color: COLOR_ESTADO.ambar } : undefined}>{n0(s.vendibles)}</span>,
  },
  { id: 'entrante', titulo: 'De camino', ayuda: 'En envíos registrados que Amazon todavía no ha terminado de recibir', valor: (s) => s.entrante, celda: (s) => (s.entrante > 0 ? n0(s.entrante) : <span className="text-[var(--ls-t4)]">—</span>) },
  { id: 'v7', titulo: '7 d', ayuda: 'Unidades vendidas en los últimos 7 días', valor: (s) => s.vendidas.d7, celda: (s) => n0(s.vendidas.d7) },
  { id: 'v30', titulo: '30 d', ayuda: 'Unidades vendidas en los últimos 30 días', valor: (s) => s.vendidas.d30, celda: (s) => n0(s.vendidas.d30) },
  { id: 'v90', titulo: '90 d', ayuda: 'Unidades vendidas en los últimos 90 días', valor: (s) => s.vendidas.d90, celda: (s) => n0(s.vendidas.d90) },
  {
    id: 'ritmo',
    titulo: 'Ud/día',
    ayuda: 'Ritmo de venta con el que se planifica: mezcla de las dos últimas semanas y el último mes',
    valor: (s) => s.ritmoPlan,
    celda: (s) => (
      <span className="inline-flex items-center justify-end gap-[4px]">
        {s.tendencia === 'sube' && <ArrowUp className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} aria-label="al alza" />}
        {s.tendencia === 'baja' && <ArrowDown className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} aria-label="a la baja" />}
        {n2(s.ritmoPlan)}
        {s.muestraCorta && s.vendidas.d30 > 0 && <span className="text-[var(--ls-t4)]" title="Poca historia: ritmo orientativo">*</span>}
      </span>
    ),
  },
  {
    id: 'cobertura',
    titulo: 'Stock para',
    ayuda: 'Días que dura lo vendible al ritmo actual',
    valor: (s) => (s.vendibles <= 0 ? 0 : s.cobertura),
    celda: (s) =>
      s.estado === 'sin_datos' ? (
        <span className="text-[var(--ls-t4)]">—</span>
      ) : s.vendibles <= 0 ? (
        <span className="text-[var(--ls-t3)]">{s.entrante > 0 ? 'de camino' : s.enAmazon > 0 ? 'no vendible' : 'agotado'}</span>
      ) : s.cobertura === null ? (
        <span className="text-[var(--ls-t4)]">sin ventas</span>
      ) : (
        <span className="inline-flex items-center justify-end gap-[6px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: tonoCobertura(s) }} aria-hidden />
          {n0(s.cobertura)} d
        </span>
      ),
  },
  { id: 'agota', titulo: 'Se agota', valor: (s) => s.seAgotaEl, celda: (s) => <span className="text-[var(--ls-t3)]">{s.seAgotaEl ? fecha(s.seAgotaEl) : '—'}</span> },
  {
    id: 'ultima',
    titulo: 'Última venta',
    valor: (s) => s.diasSinVenta,
    celda: (s) => <span className={s.estado === 'parado' ? undefined : 'text-[var(--ls-t3)]'} style={s.estado === 'parado' ? { color: COLOR_ESTADO.magenta } : undefined}>{s.ultimaVenta ? hace(s.diasSinVenta) : 'nunca'}</span>,
  },
  {
    id: 'edad',
    titulo: 'Edad',
    ayuda: 'Días medios que llevan en Amazon las unidades que quedan',
    valor: (s) => s.edadMediaDias,
    celda: (s) => (s.edadMediaDias === null ? <span className="text-[var(--ls-t4)]">—</span> : `${n0(s.edadMediaDias)} d`),
  },
  {
    id: 'antiguas',
    titulo: '> 270 d',
    ayuda: 'Unidades que llevan más de 270 días: la zona donde Amazon puede cobrar de más',
    valor: (s) => s.porTramo.t271 + s.porTramo.t366,
    celda: (s) => {
      const v = s.porTramo.t271 + s.porTramo.t366
      return v > 0 ? <b className="font-semibold" style={{ color: COLOR_ESTADO.rojo }}>{n0(v)}</b> : <span className="text-[var(--ls-t4)]">—</span>
    },
  },
  {
    id: 'devol',
    titulo: 'Devol. 90 d',
    ayuda: 'Unidades devueltas por los clientes en 90 días y qué parte de lo vendido son',
    valor: (s) => s.devueltas.d90,
    celda: (s) =>
      s.devueltas.d90 === 0 ? (
        <span className="text-[var(--ls-t4)]">—</span>
      ) : (
        <span style={s.alertas.includes('devoluciones altas') ? { color: COLOR_ESTADO.ambar } : undefined}>
          {n0(s.devueltas.d90)} <span className="text-[var(--ls-t4)]">({pct(s.tasaDevolucion90)})</span>
        </span>
      ),
  },
  { id: 'valor', titulo: 'Valor', ayuda: 'Stock a precio de venta', valor: (s) => s.valorStock, celda: (s) => eur(s.valorStock) },
  {
    id: 'almacenaje',
    titulo: 'Almacenaje/mes',
    ayuda: 'Estimación: ver los supuestos de volumen y tarifa',
    valor: (s, c) => costeMensual(Math.max(0, s.enAmazon - s.entrante), c.mes, c.supuestos),
    celda: (s, c) => <span className="text-[var(--ls-t3)]">{eur(costeMensual(Math.max(0, s.enAmazon - s.entrante), c.mes, c.supuestos))}</span>,
  },
]

export function PanelInventario({
  clienteId,
  clienteNombre,
  hoy,
  onProponer,
}: {
  clienteId: string
  clienteNombre: string
  hoy: string
  /** Salta a Propuestas con el generador de IA. Solo la agencia lo tiene */
  onProponer?: () => void
}) {
  const { cargando, error, datos, recargar } = useInventario(clienteId)
  const [supuestos, guardarSupuestos] = useSupuestosAlmacenaje(clienteId)

  if (!datos) {
    return (
      <div className="flex h-full items-center justify-center rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
        {error ? (
          <Vacio icono={<AlertTriangle />} titulo="No se ha podido leer el inventario" accion={<button type="button" onClick={() => void recargar()} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>Reintentar</button>}>
            {error}
          </Vacio>
        ) : (
          <div className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Leyendo el inventario de {clienteNombre}…
          </div>
        )}
      </div>
    )
  }

  return <Contenido datos={datos} clienteNombre={clienteNombre} hoy={hoy} supuestos={supuestos} onSupuestos={guardarSupuestos} actualizando={cargando} onActualizar={() => void recargar()} onProponer={onProponer} />
}

function Contenido({
  datos,
  clienteNombre,
  hoy,
  supuestos,
  onSupuestos,
  actualizando,
  onActualizar,
  onProponer,
}: {
  datos: InventarioDeCliente
  clienteNombre: string
  hoy: string
  supuestos: SupuestosAlmacenaje
  onSupuestos: (s: SupuestosAlmacenaje) => void
  actualizando: boolean
  onActualizar: () => void
  onProponer?: () => void
}) {
  const [filtro, setFiltro] = useState<IdFiltro>('con_stock')
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)

  const mes = mesDe(hoy)
  const ctx: Ctx = useMemo(() => ({ mes, supuestos }), [mes, supuestos])
  const r = datos.resumen
  const sinLibro = datos.libro === 'sin_leer'

  const cuentas = useMemo(() => Object.fromEntries(FILTROS.map((f) => [f.id, datos.skus.filter(f.admite).length])) as Record<IdFiltro, number>, [datos.skus])

  const visibles = useMemo(() => {
    const f = FILTROS.find((x) => x.id === filtro) ?? FILTROS[0]
    const q = busca.trim().toLowerCase()
    const lista = datos.skus.filter(f.admite).filter((s) => !q || s.sku.toLowerCase().includes(q) || (s.nombre ?? '').toLowerCase().includes(q) || (s.asin ?? '').toLowerCase().includes(q))
    if (!orden) return lista
    const col = COLUMNAS.find((c) => c.id === orden.id)
    if (!col) return lista
    const signo = orden.dir === 'asc' ? 1 : -1
    return [...lista].sort((a, b) => {
      const va = col.valor(a, ctx)
      const vb = col.valor(b, ctx)
      if (va === null && vb === null) return 0
      if (va === null) return 1
      if (vb === null) return -1
      return (typeof va === 'string' && typeof vb === 'string' ? va.localeCompare(vb) : Number(va) - Number(vb)) * signo
    })
  }, [datos.skus, filtro, busca, orden, ctx])

  // El almacenaje se cobra por lo que está DENTRO del almacén: lo que viene de camino no paga
  const enAlmacen = Math.max(0, r.unidadesEnAmazon - r.entrante)
  const est = useMemo(() => estimarAlmacenaje({ unidades: enAlmacen, unidadesAntiguas: r.unidadesAntiguas }, mes, supuestos), [enAlmacen, r.unidadesAntiguas, mes, supuestos])
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const mesSiguiente = MESES[mes % 12]

  const ficha = abierta ? datos.skus.find((s) => s.sku === abierta) ?? null : null

  function ordenarPor(id: string) {
    setOrden((o) => (o?.id !== id ? { id, dir: 'desc' } : o.dir === 'desc' ? { id, dir: 'asc' } : null))
  }

  function exportar() {
    descargarCsv(
      `inventario-${clienteNombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hoy}.csv`,
      ['SKU', 'Producto', 'ASIN', 'Estado', 'En Amazon', 'Vendibles', 'De camino', 'No vendibles', 'Vendidas 7 d', 'Vendidas 30 d', 'Vendidas 90 d', 'Ud/día', 'Días de stock', 'Se agota', 'Última venta', 'Días sin venta', 'Edad media (d)', 'Más de 270 d (uds)', 'Devueltas 90 d', 'Tasa de devolución', 'Precio', 'Valor del stock', 'Almacenaje/mes (est.)'],
      visibles.map((s) => [
        s.sku, s.nombre, s.asin, ESTADO_SKU[s.estado].texto, s.enAmazon, s.vendibles, s.entrante, s.noDisponibles,
        s.vendidas.d7, s.vendidas.d30, s.vendidas.d90, s.ritmoPlan, s.cobertura, s.seAgotaEl, s.ultimaVenta, s.diasSinVenta,
        s.edadMediaDias, s.porTramo.t271 + s.porTramo.t366, s.devueltas.d90, s.tasaDevolucion90, s.precio, s.valorStock,
        costeMensual(Math.max(0, s.enAmazon - s.entrante), mes, supuestos),
      ])
    )
  }

  if (!datos.conectado) {
    return (
      <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
        <Vacio icono={<Boxes />} titulo="Este cliente no tiene la cuenta de Amazon conectada">
          Sin la conexión no hay stock ni libro mayor de ventas que leer. Se conecta desde la ficha del cliente en Amazon.
        </Vacio>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto pb-3 pr-[2px]">
      {/* ================= CABECERA ================= */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>Inventario de {clienteNombre} en Amazon.es</h2>
          <p className="text-[11.5px] text-[var(--ls-t3)]">
            {datos.leidoHasta ? `Ventas y devoluciones leídas hasta el ${fecha(datos.leidoHasta)}` : 'Libro mayor sin leer'}
            {datos.libroDesde && <span className="text-[var(--ls-t4)]"> · libro desde el {fecha(datos.libroDesde)}</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onProponer && (
            <button type="button" onClick={onProponer} className={cx(BOTON.base, BOTON.alto, BOTON.primario)} title="Que la IA proponga qué mandar a Amazon, con este inventario delante">
              <Sparkles className="h-3 w-3" />
              Proponer reposición con IA
            </button>
          )}
          <button type="button" onClick={onActualizar} disabled={actualizando} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Volver a leer el inventario">
            <RefreshCw className={cx('h-3 w-3', actualizando && 'animate-spin')} />
            Actualizar
          </button>
        </div>
      </div>

      {datos.avisos.length > 0 && (
        <ul className="shrink-0 space-y-[6px]">
          {datos.avisos.map((a) => (
            <li key={a} className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              {a}
            </li>
          ))}
        </ul>
      )}

      {datos.skus.length === 0 ? (
        <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
          <Vacio icono={<Boxes />} titulo="Todavía no hay nada que enseñar">
            Ni stock en Amazon ni movimientos en el libro mayor de este cliente.
          </Vacio>
        </div>
      ) : (
        <>
          {/* ================= LAS CIFRAS ================= */}
          <div className="grid shrink-0 grid-cols-2 gap-2 lg:grid-cols-4 2xl:grid-cols-8">
            <Kpi
              rotulo="En Amazon"
              valor={n0(r.unidadesEnAmazon)}
              sub={`vendibles ${n0(r.vendibles)} · de camino ${n0(r.entrante)} · no vendibles ${n0(r.noDisponibles)}`}
              ayuda="Total en la red de Amazon (incluye lo que viene de camino). «No vendibles»: en tránsito sin registrar, reservadas o dañadas"
            />
            <Kpi rotulo="Valor del stock" valor={eur(r.valorStock)} sub={`a precio de venta · ${n0(r.referencias)} referencia${r.referencias === 1 ? '' : 's'}`} />
            <Kpi
              rotulo="Ventas (30 días)"
              valor={sinLibro ? '—' : n0(r.vendidas30)}
              sub={sinLibro ? 'sin libro mayor' : `${eur(r.valorVentas30)} · ${n1(r.ritmo30)} ud/día`}
            />
            <Kpi
              rotulo="Stock para"
              valor={sinLibro || r.coberturaMedia === null ? '—' : `${n0(r.coberturaMedia)} días`}
              tono={r.agotadas + r.urgentes > 0 ? 'ambar' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${n0(r.agotadas)} agotadas · ${n0(r.urgentes)} se agotan en 14 d`}
              ayuda="Días que duraría todo el stock vendible al ritmo actual de venta"
            />
            <Kpi
              rotulo="Devoluciones (90 días)"
              valor={sinLibro ? '—' : pct(r.tasaDevolucion90)}
              tono={r.tasaDevolucion90 !== null && r.tasaDevolucion90 >= 0.12 ? 'ambar' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${n0(r.devueltas90)} de ${n0(r.vendidas90)} vendidas`}
            />
            <Kpi
              rotulo="Parado"
              valor={sinLibro ? '—' : `${n0(r.paradasUnidades)} uds`}
              tono={r.paradas > 0 ? 'magenta' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${eur(r.paradasValor)} · ${n0(r.paradas)} referencia${r.paradas === 1 ? '' : 's'} sin vender`}
              ayuda="Stock de productos que llevan 60 días o más sin venderse"
            />
            <Kpi
              rotulo="Edad media"
              valor={r.edadMediaDias === null ? '—' : `${n0(r.edadMediaDias)} días`}
              tono={r.unidadesAntiguas > 0 ? 'rojo' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${n0(r.unidadesAntiguas)} uds con más de 270 d`}
              ayuda="Días medios que llevan en Amazon las unidades que quedan (las que tienen entrada en el libro mayor)"
            />
            <Kpi
              rotulo="Almacenaje (estimado)"
              valor={`${eur(est.almacenajeMes)}/mes`}
              sub={
                <>
                  {m3(est.m3)} · {n0(supuestos.litrosPorUnidad)} L/ud
                  {est.almacenajeMesSiguiente !== est.almacenajeMes && (
                    <>
                      <br />
                      {mesSiguiente}: {eur(est.almacenajeMesSiguiente)}
                    </>
                  )}
                  {est.recargoMes !== null && ` · recargo ${eur(est.recargoMes)}`}
                </>
              }
              ayuda="Estimación con un volumen medio por unidad y las tarifas por m³. Se ajusta con el lápiz"
              derecha={<AjusteAlmacenaje supuestos={supuestos} onGuardar={onSupuestos} />}
            />
          </div>

          {/* ================= LOS GRÁFICOS ================= */}
          <div className="grid shrink-0 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Tarjeta
              titulo="Ventas y devoluciones, día a día"
              ayuda={sinLibro ? 'Sin libro mayor leído' : `Últimos 90 días, hasta el ${fecha(datos.leidoHasta)}`}
              derecha={
                <>
                  <Clave color={VIZ.vendidas}>vendidas</Clave>
                  <Clave color={COLOR_ESTADO.magenta}>devueltas</Clave>
                </>
              }
            >
              {sinLibro ? <p className="py-8 text-center text-[12px] text-[var(--ls-t4)]">Sin libro mayor no hay ventas que dibujar.</p> : <GraficoVentas datos={datos.porDia} />}
            </Tarjeta>
            <Tarjeta titulo="Cuánto lleva el stock en Amazon" ayuda="Por tramos de antigüedad, como los cuenta Amazon">
              <EdadDelStock
                porTramo={r.porTramo}
                valorPorTramo={r.valorPorTramo}
                anterior={r.anteriorALaLectura}
                diasDeLibro={datos.diasDeLibro}
                sinLibro={sinLibro}
                costeDe={(u) => costeMensual(u, mes, supuestos)}
              />
            </Tarjeta>
          </div>

          {/* ================= FILTROS ================= */}
          <div className="flex shrink-0 flex-wrap items-center gap-[6px]">
            {FILTROS.map((f) => (
              <button key={f.id} type="button" title={f.ayuda} onClick={() => setFiltro(f.id)} className={cx(BOTON.chip, filtro === f.id && BOTON.chipEncendido)}>
                {f.alerta && cuentas[f.id] > 0 && <span className="h-[7px] w-[7px] rounded-full" style={{ background: f.id === 'agotadas' ? COLOR_ESTADO.rojo : COLOR_ESTADO.naranja }} />}
                {f.texto}
                <span className="tabular-nums text-[var(--ls-t4)]">{cuentas[f.id]}</span>
              </button>
            ))}
            <label className="relative ml-auto block w-[240px]">
              <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU, ASIN o nombre" className={cx(CAMPO.input, 'pl-[26px]')} />
            </label>
            <button type="button" onClick={exportar} disabled={visibles.length === 0} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}>
              CSV
            </button>
          </div>

          {/* ================= LA TABLA ================= */}
          <Tarjeta cuerpo={false} className="shrink-0 overflow-hidden">
            <div className="max-h-[640px] overflow-auto">
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={cx(TABLA.cabecera, TABLA.cabeceraFija, 'min-w-[300px]')}>Producto</th>
                    {COLUMNAS.map((c) => {
                      const activa = orden?.id === c.id
                      return (
                        <th key={c.id} className={cx(TABLA.cabecera, c.id !== 'estado' && TABLA.derecha)} title={c.ayuda}>
                          <button type="button" onClick={() => ordenarPor(c.id)} className="inline-flex items-center gap-[3px] hover:text-[var(--ls-t1)]">
                            {c.titulo}
                            {activa && (orden?.dir === 'desc' ? <ArrowDown className="h-[10px] w-[10px]" /> : <ArrowUp className="h-[10px] w-[10px]" />)}
                          </button>
                        </th>
                      )
                    })}
                  </tr>
                </thead>
                <tbody>
                  {visibles.map((s) => (
                    <tr key={s.sku} className={cx(TABLA.fila, 'cursor-pointer', s.enAmazon === 0 && 'opacity-70')} onClick={() => setAbierta(s.sku)}>
                      <td className={cx(TABLA.celda, TABLA.celdaFija, 'max-w-[360px]')}>
                        <div className="flex items-baseline gap-2 overflow-hidden">
                          <span className="shrink-0 font-mono text-[11.5px] text-[var(--ls-t3)]">{s.sku}</span>
                          <span className="truncate text-[var(--ls-t1)]" title={s.nombre ?? ''}>
                            {s.nombre ?? '—'}
                          </span>
                        </div>
                      </td>
                      {COLUMNAS.map((c) => (
                        <td key={c.id} className={cx(TABLA.celda, c.id !== 'estado' && TABLA.numero)}>
                          {c.celda(s, ctx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNAS.length + 1} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                        Nada con este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Tarjeta>
          <p className="shrink-0 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
            Las ventas y devoluciones salen del libro mayor de inventario de Amazon, que se lee una vez al día. La edad del stock sigue la convención FIFO: lo más antiguo se vende primero. * ritmo orientativo (poca historia).
          </p>
        </>
      )}

      {ficha && <FichaSku sku={ficha} hoy={hoy} leidoHasta={datos.leidoHasta} supuestos={supuestos} onCerrar={() => setAbierta(null)} />}
    </div>
  )
}
