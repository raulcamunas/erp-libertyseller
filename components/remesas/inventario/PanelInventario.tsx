'use client'

import { useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Boxes, CloudDownload, FileSpreadsheet, Loader2, RefreshCw, Search, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { AVISO, BOTON, CAMPO, COLOR_ESTADO, TABLA, TIPO } from '@/lib/estilo/denso'
import { costeMensual, estimarAlmacenaje, mesDe, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { informeDeAntiguedad, productosDeTramo, tramoDelInforme, unidadesEnTramo, type IdTramoInforme } from '@/lib/fba/antiguedad'
import { AVISO_ANTERIOR_AL_LIBRO, AVISO_LIBRO_SIN_LEER, AVISO_VENTAS_ATRASADAS, diasEntreInv, type EstadoSku, type InventarioDeCliente, type SkuInventario } from '@/lib/fba/inventario'
import { TRAMOS_AMAZON, TRAMOS_MAS_DE_90 } from '@/lib/fba/planificacion'
import { Clave, cx, Tarjeta, Vacio } from '../comun/ui'
import { bajarRespuesta } from '../comun/descargar'
import { descargarCsv, VIZ } from '../comun/graficos'
import { fecha } from '../formato'
import { FichaSku } from './FichaSku'
import { AjusteAlmacenaje, ChipEstado, EdadDelStock, EdadDelStockAmazon, GraficoVentas, Kpi } from './piezas'
import { COLOR_TRAMO, COLOR_TRAMO_AMAZON, ESTADO_SKU, eur, eurFino, hace, m3, n0, n1, n2, pct } from './formato'
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

/**
 * Con el informe de Amazon leído, «antiguas» pasa a ser lo que Seller Central llama inventario
 * antiguo —más de 90 días—, que es lo que se compara con su pantalla. Mismo id: el filtro elegido
 * se conserva.
 */
const FILTRO_ANTIGUAS_AMAZON: Filtro = {
  id: 'antiguas',
  texto: 'Más de 90 días',
  ayuda: 'Tiene unidades de más de 90 días en Amazon (de 91 días en adelante), según su informe de planificación: lo que Seller Central llama inventario antiguo',
  admite: (s) => (s.edadAmazon?.masDe90 ?? 0) > 0,
}

interface Ctx {
  mes: number
  supuestos: SupuestosAlmacenaje
  /** Hay antigüedad leída del informe de Amazon: las columnas de edad y de almacenaje usan esa */
  conAmazon: boolean
}

const textoDe = (v: string | ((c: Ctx) => string | undefined) | undefined, c: Ctx): string | undefined => (typeof v === 'function' ? v(c) : v)

interface Columna {
  id: string
  titulo: string | ((c: Ctx) => string)
  ayuda?: string | ((c: Ctx) => string | undefined)
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
    titulo: (c) => (c.conAmazon ? 'Antigüedad' : 'Edad'),
    ayuda: (c) =>
      c.conAmazon
        ? 'El tramo de antigüedad más viejo en el que tiene unidades, según Amazon. Con el ratón encima se ve el reparto'
        : 'Días medios que llevan en Amazon las unidades que quedan (estimado con el libro mayor)',
    valor: (s, c) => (c.conAmazon ? (s.edadAmazon?.masAntiguo ? TRAMOS_AMAZON.findIndex((t) => t.id === s.edadAmazon?.masAntiguo) : null) : s.edadMediaDias),
    celda: (s, c) => {
      if (!c.conAmazon) return s.edadMediaDias === null ? <span className="text-[var(--ls-t4)]">—</span> : `${n0(s.edadMediaDias)} d`
      const e = s.edadAmazon
      const tramo = TRAMOS_AMAZON.find((t) => t.id === e?.masAntiguo)
      if (!e || !tramo) return <span className="text-[var(--ls-t4)]">—</span>
      const reparto = TRAMOS_AMAZON.filter((t) => e.edad[t.id] > 0).map((t) => `${t.texto}: ${n0(e.edad[t.id])}`).join(' · ')
      return (
        <span title={reparto} className="inline-flex items-center justify-end gap-[6px]">
          <span className="h-[7px] w-[7px] rounded-full" style={{ background: COLOR_TRAMO_AMAZON[tramo.id] }} aria-hidden />
          {tramo.texto.replace(' días', '')} d
        </span>
      )
    },
  },
  {
    id: 'antiguas',
    titulo: (c) => (c.conAmazon ? '> 90 d' : '> 270 d'),
    ayuda: (c) =>
      c.conAmazon
        ? 'Unidades que llevan más de 90 días en Amazon: lo que Seller Central llama inventario antiguo'
        : 'Unidades que llevan más de 270 días: la zona donde Amazon puede cobrar de más',
    valor: (s, c) => (c.conAmazon ? (s.edadAmazon?.masDe90 ?? 0) : s.porTramo.t271 + s.porTramo.t366),
    celda: (s, c) => {
      const v = c.conAmazon ? (s.edadAmazon?.masDe90 ?? 0) : s.porTramo.t271 + s.porTramo.t366
      // Con los tramos de Amazon, de 181 días en adelante ya hay recargo por antigüedad: eso va en rojo
      const conRecargo = c.conAmazon && s.edadAmazon ? s.edadAmazon.edad.a181 + s.edadAmazon.edad.a331 + s.edadAmazon.edad.a366 + s.edadAmazon.edad.a456 > 0 : !c.conAmazon
      return v > 0 ? <b className="font-semibold" style={{ color: conRecargo ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>{n0(v)}</b> : <span className="text-[var(--ls-t4)]">—</span>
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
    ayuda: (c) => (c.conAmazon ? 'Lo que Amazon calcula que costará guardar esta referencia el mes que viene, recargos incluidos' : 'Estimación: ver los supuestos de volumen y tarifa'),
    valor: (s, c) => (c.conAmazon ? (s.edadAmazon?.costeMes ?? null) : costeMensual(Math.max(0, s.enAmazon - s.entrante), c.mes, c.supuestos)),
    celda: (s, c) =>
      c.conAmazon ? (
        <span className="text-[var(--ls-t3)]">{s.edadAmazon?.costeMes != null ? eurFino(s.edadAmazon.costeMes) : '—'}</span>
      ) : (
        <span className="text-[var(--ls-t3)]">{eur(costeMensual(Math.max(0, s.enAmazon - s.entrante), c.mes, c.supuestos))}</span>
      ),
  },
]

export function PanelInventario({
  clienteId,
  clienteNombre,
  hoy,
  onProponer,
  puedeLeerVentas = false,
}: {
  clienteId: string
  clienteNombre: string
  hoy: string
  /** Salta a Propuestas con el generador de IA. Solo la agencia lo tiene */
  onProponer?: () => void
  /** Pedirle a Amazon el libro mayor ahora mismo, sin esperar a la pasada de la noche. Solo un administrador */
  puedeLeerVentas?: boolean
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

  return (
    <Contenido
      datos={datos}
      clienteId={clienteId}
      clienteNombre={clienteNombre}
      hoy={hoy}
      supuestos={supuestos}
      onSupuestos={guardarSupuestos}
      actualizando={cargando}
      onActualizar={() => void recargar()}
      onProponer={onProponer}
      puedeLeerVentas={puedeLeerVentas}
    />
  )
}

/**
 * PEDIRLE A AMAZON EL LIBRO MAYOR AHORA.
 *
 * La pasada de la noche lo lee sola, una vez al día. Este botón es para cuando hace falta
 * antes —se va a montar un envío y las ventas de los últimos días cuentan— o cuando la
 * pasada ha fallado y el aviso dice que las ventas llevan días atrasadas.
 *
 * Amazon tarda entre uno y varios minutos en preparar el informe, y la petición espera a que
 * esté. Si la conexión se corta por el camino, el servidor sigue con lo suyo: el informe no
 * depende de que esta pestaña siga abierta. Por eso un fallo de red no se cuenta como un
 * fallo de la lectura, y se dice que mire más tarde.
 */
function LeerVentas({ conexionId, destacado, onLeido }: { conexionId: string; destacado: boolean; onLeido: () => void }) {
  const [leyendo, setLeyendo] = useState(false)

  async function leer() {
    setLeyendo(true)
    try {
      const res = await fetch(`/api/fba/sincronizar?conexion=${encodeURIComponent(conexionId)}`, { method: 'POST' })
      const cuerpo = (await res.json().catch(() => null)) as { error?: string; hasta?: string; movimientos?: number; planificacion?: { guardadas: number; guardado: boolean; aviso: string | null; error: string | null } } | null
      if (!res.ok) {
        toast.error(cuerpo?.error ?? 'No se ha podido leer el libro mayor de Amazon')
        return
      }
      toast.success(`Ventas al día: leídas hasta el ${fecha(cuerpo?.hasta)} (${n0(cuerpo?.movimientos ?? 0)} movimientos)`)
      // La antigüedad se lee a la vez y puede fallar sola: se cuenta aparte, no se esconde
      const p = cuerpo?.planificacion
      if (p?.error) toast.warning(`No se ha podido leer la antigüedad de Amazon: ${p.error}`, { duration: 15_000 })
      else if (p && !p.guardado && p.aviso) toast.warning(p.aviso, { duration: 15_000 })
      else if (p?.guardado) toast.success(`Antigüedad de Amazon al día: ${n0(p.guardadas)} referencias`)
      onLeido()
    } catch {
      toast.warning('Se ha cortado la conexión con el servidor, pero la lectura puede seguir en marcha. Pulsa «Actualizar» dentro de unos minutos.', { duration: 12_000 })
    } finally {
      setLeyendo(false)
    }
  }

  return (
    <>
      {leyendo && <span className="hidden text-[11px] text-[var(--ls-t4)] xl:inline">Amazon tarda unos minutos en preparar el informe</span>}
      <button
        type="button"
        onClick={() => void leer()}
        disabled={leyendo}
        className={cx(BOTON.base, BOTON.alto, destacado ? BOTON.primario : BOTON.secundario)}
        title="Le pide a Amazon, y guarda, el libro mayor de este cliente hasta hoy —ventas y devoluciones— y su informe de antigüedad del stock. Tarda unos minutos"
      >
        {leyendo ? <Loader2 className="h-3 w-3 animate-spin" /> : <CloudDownload className="h-3 w-3" />}
        {leyendo ? 'Leyendo de Amazon…' : 'Leer de Amazon'}
      </button>
    </>
  )
}

function Contenido({
  datos,
  clienteId,
  clienteNombre,
  hoy,
  supuestos,
  onSupuestos,
  actualizando,
  onActualizar,
  onProponer,
  puedeLeerVentas,
}: {
  datos: InventarioDeCliente
  clienteId: string
  clienteNombre: string
  hoy: string
  supuestos: SupuestosAlmacenaje
  onSupuestos: (s: SupuestosAlmacenaje) => void
  actualizando: boolean
  onActualizar: () => void
  onProponer?: () => void
  puedeLeerVentas: boolean
}) {
  const [filtro, setFiltro] = useState<IdFiltro>('con_stock')
  const [busca, setBusca] = useState('')
  const [orden, setOrden] = useState<{ id: string; dir: 'asc' | 'desc' } | null>(null)
  const [abierta, setAbierta] = useState<string | null>(null)
  // El tramo de la tarjeta de antigüedad que se ha pulsado: la tabla de abajo enseña sus productos
  const [tramoSel, setTramoSel] = useState<IdTramoInforme | null>(null)
  const [bajandoExcel, setBajandoExcel] = useState(false)
  const zonaTabla = useRef<HTMLDivElement>(null)

  const mes = mesDe(hoy)
  // La pasada de la noche lee cada día: pasar de un día sin leer ya es raro, y el botón se destaca
  const ventasAtrasadas = datos.leidoHasta === null || diasEntreInv(datos.leidoHasta, hoy) > 1
  const ea = datos.edadAmazon
  const conAmazon = ea !== null
  // Con la antigüedad de Amazon, el aviso de las unidades «anteriores al libro» ya no describe lo que se ve
  const avisos = ea ? datos.avisos.filter((a) => !a.includes(AVISO_ANTERIOR_AL_LIBRO)) : datos.avisos
  const ctx: Ctx = useMemo(() => ({ mes, supuestos, conAmazon }), [mes, supuestos, conAmazon])
  const r = datos.resumen
  const sinLibro = datos.libro === 'sin_leer'

  const filtros = useMemo(() => (conAmazon ? FILTROS.map((f) => (f.id === 'antiguas' ? FILTRO_ANTIGUAS_AMAZON : f)) : FILTROS), [conAmazon])
  const cuentas = useMemo(() => Object.fromEntries(filtros.map((f) => [f.id, datos.skus.filter(f.admite).length])) as Record<IdFiltro, number>, [filtros, datos.skus])

  // La antigüedad como una lista de tramos, venga de Amazon o estimada: lo que se pulsa y lo que se exporta
  const informe = useMemo(() => informeDeAntiguedad(datos, { costeDe: (u) => costeMensual(u, mes, supuestos) }), [datos, mes, supuestos])
  // Un tramo que ya no existe (se ha vuelto a leer y la fuente es otra) deja de estar elegido solo
  const tramoActivo = tramoDelInforme(informe, tramoSel)
  const productosDelTramo = useMemo(() => (tramoActivo ? productosDeTramo(datos.skus, informe, tramoActivo.id) : []), [datos.skus, informe, tramoActivo])

  const visibles = useMemo(() => {
    const f = filtros.find((x) => x.id === filtro) ?? filtros[0]
    const q = busca.trim().toLowerCase()
    const base = tramoActivo ? productosDelTramo.map((p) => p.sku) : datos.skus.filter(f.admite)
    const lista = base.filter((s) => !q || s.sku.toLowerCase().includes(q) || (s.nombre ?? '').toLowerCase().includes(q) || (s.asin ?? '').toLowerCase().includes(q))
    // Con un tramo elegido y sin otro orden pedido, ya vienen por unidades en ese tramo (productosDeTramo)
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
  }, [datos.skus, filtros, filtro, busca, orden, ctx, tramoActivo, productosDelTramo])

  // El almacenaje se cobra por lo que está DENTRO del almacén: lo que viene de camino no paga
  const enAlmacen = Math.max(0, r.unidadesEnAmazon - r.entrante)
  // Lo que la tarjeta de antigüedad no recoge: lo que Amazon tiene dentro y no está fechado ni es «anterior al libro»
  const sinClasificar = ea ? Math.max(0, enAlmacen - ea.unidades) : Math.max(0, enAlmacen - Object.values(r.porTramo).reduce((s, v) => s + v, 0) - r.anteriorALaLectura)
  const valorMasDe90 = ea ? ea.tramos.filter((t) => TRAMOS_MAS_DE_90.includes(t.id)).reduce((acc, t) => acc + t.valor, 0) : 0
  const est = useMemo(() => estimarAlmacenaje({ unidades: enAlmacen, unidadesAntiguas: r.unidadesAntiguas }, mes, supuestos), [enAlmacen, r.unidadesAntiguas, mes, supuestos])
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
  const mesSiguiente = MESES[mes % 12]

  const ficha = abierta ? datos.skus.find((s) => s.sku === abierta) ?? null : null

  function elegirTramo(id: string) {
    const nuevo = tramoSel === id ? null : (id as IdTramoInforme)
    setTramoSel(nuevo)
    setBusca('')
    setOrden(null)
    // La tabla está más abajo: se lleva a la vista para que se vea que ha pasado algo
    if (nuevo) requestAnimationFrame(() => zonaTabla.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  /** El Excel de antigüedad con la marca: de todos los tramos, o solo del que se ha pulsado */
  async function bajarExcel(tramo: string | null) {
    setBajandoExcel(true)
    try {
      const q = new URLSearchParams({ cliente: clienteId })
      if (tramo) q.set('tramo', tramo)
      const res = await fetch(`/api/fba/inventario/excel?${q.toString()}`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? 'No se ha podido generar el Excel')
        return
      }
      await bajarRespuesta(res, 'antiguedad-del-stock.xlsx')
      const filas = Number(res.headers.get('X-Filas') ?? 0)
      toast.success(`Excel descargado: ${filas} fila${filas === 1 ? '' : 's'} de productos`)
    } catch {
      toast.error('No se ha podido descargar el Excel. Revisa la conexión y vuelve a probar.')
    } finally {
      setBajandoExcel(false)
    }
  }

  function ordenarPor(id: string) {
    setOrden((o) => (o?.id !== id ? { id, dir: 'desc' } : o.dir === 'desc' ? { id, dir: 'asc' } : null))
  }

  function exportar() {
    descargarCsv(
      `inventario-${clienteNombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hoy}.csv`,
      [
        'SKU', 'Producto', 'ASIN', ...(tramoActivo ? [`Uds en ${tramoActivo.texto}`] : []), 'Estado', 'En Amazon', 'Vendibles', 'De camino', 'No vendibles', 'Vendidas 7 d', 'Vendidas 30 d', 'Vendidas 90 d', 'Ud/día', 'Días de stock', 'Se agota', 'Última venta', 'Días sin venta',
        ...(conAmazon ? [...TRAMOS_AMAZON.map((t) => `Antigüedad ${t.texto.replace(' días', '')} (uds)`), 'Más de 90 d (uds)'] : ['Edad media (d)', 'Más de 270 d (uds)']),
        'Devueltas 90 d', 'Tasa de devolución', 'Precio', 'Valor del stock', conAmazon ? 'Almacenaje/mes (Amazon)' : 'Almacenaje/mes (est.)',
      ],
      visibles.map((s) => [
        s.sku, s.nombre, s.asin, ...(tramoActivo ? [unidadesEnTramo(s, informe, tramoActivo.id)] : []), ESTADO_SKU[s.estado].texto, s.enAmazon, s.vendibles, s.entrante, s.noDisponibles,
        s.vendidas.d7, s.vendidas.d30, s.vendidas.d90, s.ritmoPlan, s.cobertura, s.seAgotaEl, s.ultimaVenta, s.diasSinVenta,
        ...(conAmazon ? [...TRAMOS_AMAZON.map((t) => s.edadAmazon?.edad[t.id] ?? null), s.edadAmazon?.masDe90 ?? null] : [s.edadMediaDias, s.porTramo.t271 + s.porTramo.t366]),
        s.devueltas.d90, s.tasaDevolucion90, s.precio, s.valorStock,
        conAmazon ? (s.edadAmazon?.costeMes ?? null) : costeMensual(Math.max(0, s.enAmazon - s.entrante), mes, supuestos),
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
          <h2 className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>Panel de {clienteNombre}</h2>
          <p className="text-[11.5px] text-[var(--ls-t3)]">
            Inventario FBA en Amazon.es · {datos.leidoHasta ? `ventas y devoluciones leídas hasta el ${fecha(datos.leidoHasta)}` : 'libro mayor sin leer'}
            {datos.libroDesde && <span className="text-[var(--ls-t4)]"> · libro desde el {fecha(datos.libroDesde)}</span>}
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {onProponer && (
            // Con las ventas atrasadas lo primero es ponerlas al día: el botón destacado es el de leerlas
            <button type="button" onClick={onProponer} className={cx(BOTON.base, BOTON.alto, puedeLeerVentas && datos.conexionId && ventasAtrasadas ? BOTON.secundario : BOTON.primario)} title="Que la IA proponga qué mandar a Amazon, con este inventario delante">
              <Sparkles className="h-3 w-3" />
              Proponer reposición con IA
            </button>
          )}
          {puedeLeerVentas && datos.conexionId && <LeerVentas conexionId={datos.conexionId} destacado={ventasAtrasadas} onLeido={onActualizar} />}
          <button type="button" onClick={onActualizar} disabled={actualizando} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Volver a leer el inventario">
            <RefreshCw className={cx('h-3 w-3', actualizando && 'animate-spin')} />
            Actualizar
          </button>
        </div>
      </div>

      {(avisos.length > 0 || datos.lectura?.error || datos.planificacion.error || (puedeLeerVentas && !datos.planificacion.tabla)) && (
        <ul className="shrink-0 space-y-[6px]">
          {puedeLeerVentas && !datos.planificacion.tabla && (
            <li className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              <span>
                <b className={AVISO.fuerte}>Falta lanzar la migración 231_fba_planificacion.sql en Supabase.</b> Sin ella no se guarda la antigüedad que cuenta Amazon y la tarjeta enseña la estimada con el libro mayor.
              </span>
            </li>
          )}
          {datos.planificacion.error && (
            <li className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
              <span>
                <b className={AVISO.fuerte}>La última lectura de la antigüedad de Amazon ha fallado{datos.planificacion.leidoAt ? ` (${fecha(datos.planificacion.leidoAt)})` : ''}:</b> {datos.planificacion.error}
              </span>
            </li>
          )}
          {datos.lectura?.error && (
            <li className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.rojo }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.rojo }} />
              <span>
                <b className={AVISO.fuerte}>La última lectura de Amazon ha fallado{datos.lectura.intentoAt ? ` (${fecha(datos.lectura.intentoAt)})` : ''}:</b> {datos.lectura.error}
              </span>
            </li>
          )}
          {avisos.map((a) => (
            <li key={a} className={cx(AVISO.base, AVISO.conTono, 'items-center')} style={{ borderLeftColor: COLOR_ESTADO.ambar }}>
              <AlertTriangle className={AVISO.icono} style={{ color: COLOR_ESTADO.ambar }} />
              <span>
                {a}
                {/* Las ventas se leen solas cada noche: si pasan de unos días, algo ha fallado. El botón las pone al día */}
                {puedeLeerVentas && datos.conexionId && (a.startsWith(AVISO_VENTAS_ATRASADAS) || a.startsWith(AVISO_LIBRO_SIN_LEER)) && (
                  <span className="text-[var(--ls-t3)]"> Se leen solas cada noche; con «Leer de Amazon» se ponen al día ahora.</span>
                )}
              </span>
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
            {ea ? (
              <Kpi
                rotulo="Más de 90 días"
                valor={`${n0(ea.masDe90)} uds`}
                tono={ea.masDe180 > 0 ? 'rojo' : ea.masDe90 > 0 ? 'ambar' : undefined}
                sub={`${eur(valorMasDe90)} · ${n0(ea.masDe180)} con más de 180 d`}
                ayuda="Unidades que llevan más de 90 días en Amazon según su informe de planificación: lo que Seller Central llama inventario antiguo. A partir de 181 días hay recargo por antigüedad"
              />
            ) : (
              <Kpi
                rotulo="Edad media"
                valor={r.edadMediaDias === null ? '—' : `${n0(r.edadMediaDias)} días`}
                tono={r.unidadesAntiguas > 0 ? 'rojo' : undefined}
                sub={sinLibro ? 'sin libro mayor' : `${n0(r.unidadesAntiguas)} uds con más de 270 d`}
                ayuda="Días medios que llevan en Amazon las unidades que quedan (las que tienen entrada en el libro mayor)"
              />
            )}
            {ea && ea.costeMes !== null ? (
              <Kpi
                rotulo="Almacenaje (Amazon)"
                valor={`${eurFino(ea.costeMes)}/mes`}
                sub={
                  <>
                    Lo que calcula Amazon{ea.recargoMes > 0 && ` · recargo ${eurFino(ea.recargoMes)}`}
                    <br />
                    foto del {fecha(ea.fecha)}
                  </>
                }
                ayuda="Lo que Amazon calcula que costará guardar este stock el mes que viene, con los recargos. Viene de su informe de planificación de inventario"
              />
            ) : (
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
            )}
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
            <Tarjeta
              titulo="Cuánto lleva el stock en Amazon"
              ayuda={ea ? `Por tramos de antigüedad, como los cuenta Amazon · foto del ${fecha(ea.fecha)}` : 'Estimada con el libro mayor (lo más antiguo se vende primero): Amazon todavía no ha dado la suya'}
              derecha={
                <button
                  type="button"
                  onClick={() => void bajarExcel(null)}
                  disabled={bajandoExcel || informe.unidades === 0}
                  className={cx(BOTON.base, BOTON.secundario)}
                  title="Descargar la antigüedad del stock en Excel, con la marca de Liberty Seller: los tramos y los productos de cada uno"
                >
                  {bajandoExcel ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
                  Excel
                </button>
              }
            >
              {ea ? (
                <EdadDelStockAmazon resumen={ea} sinClasificar={sinClasificar} seleccion={tramoActivo?.id ?? null} onSeleccion={elegirTramo} />
              ) : (
                <EdadDelStock
                  porTramo={r.porTramo}
                  valorPorTramo={r.valorPorTramo}
                  anterior={r.anteriorALaLectura}
                  diasDeLibro={datos.diasDeLibro}
                  sinLibro={sinLibro}
                  costeDe={(u) => costeMensual(u, mes, supuestos)}
                  sinClasificar={sinClasificar}
                  seleccion={tramoActivo?.id ?? null}
                  onSeleccion={elegirTramo}
                />
              )}
              <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">Pulsa un tramo para ver debajo los productos que lo forman.</p>
            </Tarjeta>
          </div>

          {/* ================= FILTROS ================= */}
          <div ref={zonaTabla} className="flex shrink-0 scroll-mt-1 flex-wrap items-center gap-[6px]">
            {tramoActivo && (
              <>
                <span
                  className="inline-flex h-6 items-center gap-[7px] rounded-[6px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] pl-2 pr-1 text-[11.5px] text-[var(--ls-t1)]"
                  title="Los productos de abajo son los que tienen unidades en este tramo de antigüedad"
                >
                  <span className="h-[8px] w-[8px] shrink-0 rounded-[2px]" style={{ background: ea ? COLOR_TRAMO_AMAZON[tramoActivo.id as keyof typeof COLOR_TRAMO_AMAZON] : tramoActivo.id === 'anterior' ? 'var(--ls-t4)' : COLOR_TRAMO[tramoActivo.id as keyof typeof COLOR_TRAMO] }} />
                  <b className="font-semibold">{tramoActivo.texto}</b>
                  <span className="text-[var(--ls-t3)]">
                    {n0(productosDelTramo.length)} referencia{productosDelTramo.length === 1 ? '' : 's'} · {n0(tramoActivo.unidades)} uds{tramoActivo.valor > 0 ? ` · ${eur(tramoActivo.valor)}` : ''}
                  </span>
                  <button type="button" onClick={() => setTramoSel(null)} className={BOTON.icono} aria-label="Quitar el filtro de antigüedad" title="Quitar el filtro y volver a ver todos los productos">
                    <X className="h-3 w-3" />
                  </button>
                </span>
                <button
                  type="button"
                  onClick={() => void bajarExcel(tramoActivo.id)}
                  disabled={bajandoExcel}
                  className={cx(BOTON.base, BOTON.secundario)}
                  title="Descargar en Excel, con la marca, solo los productos de este tramo"
                >
                  {bajandoExcel ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileSpreadsheet className="h-3 w-3" />}
                  Excel de este tramo
                </button>
                <span className="mx-1 h-4 w-px shrink-0 bg-[var(--ls-linea2)]" aria-hidden />
              </>
            )}
            {filtros.map((f) => (
              <button
                key={f.id}
                type="button"
                title={f.ayuda}
                onClick={() => {
                  // Un filtro de los de siempre y un tramo elegido no se mezclan: se elige uno u otro
                  setTramoSel(null)
                  setFiltro(f.id)
                }}
                className={cx(BOTON.chip, filtro === f.id && !tramoActivo && BOTON.chipEncendido)}
              >
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
                    {tramoActivo && (
                      <th className={cx(TABLA.cabecera, TABLA.derecha)} title={`Unidades de cada producto que están en el tramo ${tramoActivo.texto}`}>
                        {tramoActivo.id === 'anterior' ? 'Sin edad' : `En ${tramoActivo.texto.replace(' días', '')}`}
                      </th>
                    )}
                    {COLUMNAS.map((c) => {
                      const activa = orden?.id === c.id
                      return (
                        <th key={c.id} className={cx(TABLA.cabecera, c.id !== 'estado' && TABLA.derecha)} title={textoDe(c.ayuda, ctx)}>
                          <button type="button" onClick={() => ordenarPor(c.id)} className="inline-flex items-center gap-[3px] hover:text-[var(--ls-t1)]">
                            {textoDe(c.titulo, ctx)}
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
                      {tramoActivo && (
                        <td className={cx(TABLA.celda, TABLA.numero)}>
                          <b className="font-semibold text-[var(--ls-t1)]">{n0(unidadesEnTramo(s, informe, tramoActivo.id))}</b>
                          <span className="text-[var(--ls-t4)]"> / {n0(s.enAmazon)}</span>
                        </td>
                      )}
                      {COLUMNAS.map((c) => (
                        <td key={c.id} className={cx(TABLA.celda, c.id !== 'estado' && TABLA.numero)}>
                          {c.celda(s, ctx)}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {visibles.length === 0 && (
                    <tr>
                      <td colSpan={COLUMNAS.length + 1 + (tramoActivo ? 1 : 0)} className={cx(TABLA.celda, 'h-16 text-center text-[var(--ls-t4)]')}>
                        Nada con este filtro.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Tarjeta>
          <p className="shrink-0 text-[11px] leading-[1.5] text-[var(--ls-t4)]">
            Las ventas y devoluciones salen del libro mayor de inventario de Amazon, que se lee una vez al día.{' '}
            {ea
              ? 'La antigüedad y el coste de almacenaje salen del informe de planificación de inventario de Amazon, que se lee a la vez.'
              : 'La edad del stock se estima con la convención FIFO: lo más antiguo se vende primero.'}{' '}
            * ritmo orientativo (poca historia).
          </p>
        </>
      )}

      {ficha && <FichaSku sku={ficha} hoy={hoy} leidoHasta={datos.leidoHasta} supuestos={supuestos} onCerrar={() => setAbierta(null)} />}
    </div>
  )
}
