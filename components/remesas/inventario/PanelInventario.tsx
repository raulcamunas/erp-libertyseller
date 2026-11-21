'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp, Boxes, FileSpreadsheet, Loader2, RefreshCw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { EsqueletoTarjeta, EstadoVacio, TablaAdaptable, type Columna } from '@/components/ui-ls'
import { BOTON, CAMPO, COLOR_ESTADO } from '@/lib/estilo/denso'
import { costeMensual, estimarAlmacenaje, mesDe, type SupuestosAlmacenaje } from '@/lib/fba/almacenaje'
import { informeDeAntiguedad, productosDeTramo, tramoDelInforme, unidadesEnTramo, type IdTramoInforme } from '@/lib/fba/antiguedad'
import { AVISO_ANTERIOR_AL_LIBRO, AVISO_LIBRO_SIN_LEER, AVISO_VENTAS_ATRASADAS, dentroDe, type InventarioDeCliente } from '@/lib/fba/inventario'
import { TRAMOS_AMAZON, TRAMOS_MAS_DE_90 } from '@/lib/fba/planificacion'
import type { EnCamino, PlanCliente, PlanParaCliente } from '@/lib/fba/plan-tipos'
import { marketplaceLabel } from '@/lib/types/amazon'
import { BandaDeCalidad, type BandaDeCalidadProps } from '../comun/BandaDeCalidad'
import { bajarRespuesta } from '../comun/descargar'
import { AVISO_LINEA, CONFIANZA, ESTADO_STOCK, PRIORIDAD } from '../comun/estilo-plan'
import { descargarCsv, VIZ } from '../comun/graficos'
import type { CallbacksRemesas, ClienteRemesas, SesionRemesas } from '../comun/tipos-ui'
import { esPlanDeAgencia, usePlan } from '../comun/usePlan'
import { Clave, cx, Tarjeta } from '../comun/ui'
import { fecha, fechaCorta } from '../formato'
import { FichaSku } from './FichaSku'
import { AjusteAlmacenaje, EdadDelStock, EdadDelStockAmazon, GraficoVentas, InsigniaEstadoStock, Kpi, MenuColumnas, NotaDeOrigen } from './piezas'
import { COLOR_TRAMO, COLOR_TRAMO_AMAZON, calidadDeInventario, din, diasDesde, eurFino, filasDeStock, hace, m3, n0, n1, n2, pct, type FilaStock, type LineaDeStock } from './formato'
import { useConfirmarPlazos, useInventario, useLeerDeAmazon, useSupuestosAlmacenaje } from './useInventario'

/**
 * LA SECCIÓN «STOCK» DE UN CLIENTE (antes «Panel del cliente»; spec remesas-pro §8, §6.5, D11, D25, D26, D39 y D41).
 *
 * Todo lo que tiene en los almacenes de Amazon, referencia a referencia: cuánto stock hay, a qué ritmo se vende, cuánto
 * dura, cuánto se devuelve, cuánto lleva parado y cuánto cuesta que siga ahí. Se CONSERVA todo lo del panel de antes:
 *   · «Leer de Amazon» (solo admin: gasta cupo de informes), «Actualizar» y «Propuesta a medida (IA)» (agencia que edita);
 *   · las cifras, el gráfico de ventas y devoluciones y la antigüedad (de Amazon o estimada) con clic en un tramo para ver
 *     sus productos y su Excel (todos o el tramo);
 *   · los supuestos de almacenaje, que el cliente externo SIGUE viendo y ajustando (D39);
 *   · los filtros, el buscador y el CSV, y la ficha de cada referencia (ahora en un PanelLateral, con su proyección).
 *
 * Lo nuevo:
 *   · La banda de calidad arriba (D41), con los avisos del inventario dentro y sin repetir los del plan.
 *   · La tabla es `TablaAdaptable` con 7 columnas (producto, vendible, camino, ritmo, cobertura, rotura, estado) y
 *     «Columnas ▾» para el resto en el escritorio; tarjetas en el móvil.
 *   · Ritmo, cobertura y rotura salen de la ÚLTIMA PASADA del plan (un único número por pregunta, §1.1), con su origen y
 *     el aviso «stock de hace N días» si la pasada no es de hoy; sin pasada (o sin esa referencia), del inventario.
 *   · El título dice el mercado de la lectura, no «Amazon.es» fijo.
 *
 * API
 *   <PanelInventario sesion cliente hoy callbacks? />
 *     callbacks.onPropuestaAMedida(clienteId)   «Propuesta a medida (IA)» (agencia con editar)
 *     callbacks.onIrA('cliente', 'reposicion')  «Poner plazos» de la banda
 *   `?sku=` en la URL (lo pone el mapa de cobertura del Resumen) abre la ficha de esa referencia.
 */

export interface PanelInventarioProps {
  sesion: SesionRemesas
  cliente: ClienteRemesas
  /** YYYY-MM-DD en Madrid */
  hoy: string
  callbacks?: Partial<CallbacksRemesas>
}

export function PanelInventario({ sesion, cliente, hoy, callbacks }: PanelInventarioProps) {
  const { cargando, error, datos, recargar } = useInventario(cliente.id)
  const planR = usePlan(cliente.id, { todas: true })
  const [supuestos, guardarSupuestos] = useSupuestosAlmacenaje(cliente.id)

  if (!datos) {
    return error ? (
      <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
        <EstadoVacio icono={Boxes} titulo="No se ha podido leer el inventario" descripcion={error} accion={{ texto: 'Reintentar', icono: RefreshCw, onClick: () => void recargar() }} />
      </div>
    ) : (
      <div className="flex flex-col gap-3" role="status" aria-label={`Leyendo el inventario de ${cliente.nombre}`}>
        <p className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t3)]">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />
          Leyendo el inventario de {cliente.nombre}…
        </p>
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <EsqueletoTarjeta key={i} alto={92} />
          ))}
        </div>
        <EsqueletoTarjeta alto={260} />
      </div>
    )
  }

  return (
    <Contenido
      datos={datos}
      sesion={sesion}
      cliente={cliente}
      hoy={hoy}
      plan={planR.plan}
      planError={planR.error}
      planCalculadoAt={planR.pasada?.calculadoAt ?? null}
      supuestos={supuestos}
      onSupuestos={guardarSupuestos}
      actualizando={cargando || planR.cargando}
      onActualizar={() => {
        void recargar()
        void planR.recargar()
      }}
      onPlanCambiado={() => void planR.recargar()}
      callbacks={callbacks}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Filtros                                                             */
/* ------------------------------------------------------------------ */

type IdFiltro = 'con_stock' | 'todas' | 'agotadas' | 'urgentes' | 'parado' | 'exceso' | 'devoluciones' | 'antiguas' | 'no_vendibles'

interface Filtro {
  id: IdFiltro
  texto: string
  ayuda: string
  admite: (f: FilaStock) => boolean
  /** Se pinta con un punto de color cuando hay algo */
  alerta?: boolean
}

const FILTROS: Filtro[] = [
  { id: 'con_stock', texto: 'Con stock', ayuda: 'Lo que hay ahora en la red de Amazon', admite: (f) => f.sku.enAmazon > 0 },
  { id: 'agotadas', texto: 'Agotadas', ayuda: 'Sin stock vendible y con ventas: se están perdiendo ventas', admite: (f) => f.estado === 'agotado', alerta: true },
  { id: 'urgentes', texto: 'Rompen pronto', ayuda: 'Se quedan sin stock antes de que pueda llegar un envío, o casi', admite: (f) => f.estado === 'urgente', alerta: true },
  { id: 'parado', texto: 'Paradas', ayuda: 'Llevan mucho sin venderse y siguen ocupando almacén', admite: (f) => f.estado === 'parado' },
  { id: 'exceso', texto: 'De sobra', ayuda: 'Más stock del que se vende en la cobertura máxima', admite: (f) => f.estado === 'exceso' },
  { id: 'devoluciones', texto: 'Devoluciones altas', ayuda: 'Se devuelve el 12 % o más de lo que se vende', admite: (f) => f.sku.alertas.includes('devoluciones altas') },
  { id: 'antiguas', texto: 'Más de 270 días', ayuda: 'Tiene unidades de más de 270 días en Amazon: zona de recargo por antigüedad', admite: (f) => f.sku.porTramo.t271 + f.sku.porTramo.t366 > 0 },
  { id: 'no_vendibles', texto: 'No vendibles', ayuda: 'Tiene unidades en Amazon que no se pueden vender: dañadas o defectuosas (sin el desglose de Amazon, también reservadas o en tránsito sin registrar)', admite: (f) => f.sku.noDisponibles > 0 },
  { id: 'todas', texto: 'Todas', ayuda: 'Todas las referencias que han tenido stock o ventas', admite: () => true },
]

/** Con el informe de Amazon leído, «antiguas» es lo que Seller Central llama inventario antiguo (más de 90 días). Mismo id */
const FILTRO_ANTIGUAS_AMAZON: Filtro = {
  id: 'antiguas',
  texto: 'Más de 90 días',
  ayuda: 'Tiene unidades de más de 90 días en Amazon según su informe de planificación: lo que Seller Central llama inventario antiguo',
  admite: (f) => (f.sku.edadAmazon?.masDe90 ?? 0) > 0,
}

/* ------------------------------------------------------------------ */
/* Columnas                                                            */
/* ------------------------------------------------------------------ */

interface Ctx {
  mes: number
  supuestos: SupuestosAlmacenaje
  conAmazon: boolean
  moneda: string
  hoy: string
  esAgencia: boolean
}

const tonoCobertura = (dias: number | null): string => {
  if (dias === null) return 'var(--ls-t4)'
  if (dias <= 14) return COLOR_ESTADO.rojo
  if (dias <= 30) return COLOR_ESTADO.ambar
  if (dias > 120) return COLOR_ESTADO.violeta
  return COLOR_ESTADO.verde
}

const ORDEN_ESTADO: Record<FilaStock['estado'], number> = { agotado: 0, urgente: 1, bajo: 2, parado: 3, exceso: 4, sin_ventas: 5, ok: 6, sin_datos: 7 }
const enAlmacen = (f: FilaStock) => dentroDe(f.sku)
const raya = <span className="text-[var(--ls-t4)]">—</span>

/** Marca de «no sale del plan» junto a una cifra */
const deInventario = (f: FilaStock) =>
  f.origen === 'inventario' ? (
    <span className="ml-[3px] align-super text-[9.5px] text-[var(--ls-t4)]" title="Del inventario: esta referencia no está en el plan">
      inv
    </span>
  ) : null

/** Las 7 de siempre */
function columnasBase(c: Ctx): Columna<FilaStock>[] {
  return [
    {
      id: 'producto',
      cabecera: 'Producto',
      movil: 'titulo',
      ordenar: (f) => f.sku.sku,
      ancho: '34%',
      celda: (f) => (
        <span className="flex min-w-0 max-w-[420px] items-baseline gap-2 overflow-hidden">
          <span className="shrink-0 font-mono text-[12px] text-[var(--ls-t3)]">{f.sku.sku}</span>
          <span className="truncate font-normal text-[var(--ls-t1)]" title={f.sku.nombre ?? ''}>
            {f.sku.nombre ?? '—'}
          </span>
        </span>
      ),
    },
    {
      id: 'vendibles',
      cabecera: 'Vendible',
      alinear: 'derecha',
      ordenar: (f) => f.sku.vendibles,
      celda: (f) => <span style={f.sku.noDisponibles > 0 ? { color: COLOR_ESTADO.ambar } : undefined} title={f.sku.noDisponibles > 0 ? `${n0(f.sku.noDisponibles)} no vendibles aparte` : undefined}>{n0(f.sku.vendibles)}</span>,
    },
    {
      id: 'camino',
      cabecera: 'Camino',
      rotuloMovil: 'De camino',
      alinear: 'derecha',
      ordenar: (f) => f.linea?.deCamino ?? f.sku.entrante,
      celda: (f) => {
        const v = f.linea?.deCamino ?? f.sku.entrante
        const dudoso = f.linea?.dudoso ?? 0
        return v > 0 ? (
          <span title={dudoso > 0 ? `${n0(dudoso)} en un envío dudoso que no cuenta` : 'Enviado y todavía sin recibir'}>
            {n0(v)}
            {dudoso > 0 && <span className="ml-[3px] text-[10px]" style={{ color: COLOR_ESTADO.rojo }}>!</span>}
          </span>
        ) : (
          raya
        )
      },
    },
    {
      id: 'ritmo',
      cabecera: 'Ud/día',
      rotuloMovil: 'Ritmo',
      alinear: 'derecha',
      ordenar: (f) => f.ritmo,
      celda: (f) => {
        if (f.ritmo === null) return raya
        const conf = f.confianza ? CONFIANZA[f.confianza] : null
        const s = f.sku
        return (
          <span className="inline-flex items-center justify-end gap-[4px]" title={f.ritmoExplicacion ?? 'Mezcla de las dos últimas semanas y el último mes (inventario)'}>
            {s.tendencia === 'sube' && <ArrowUp className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} aria-label="al alza" />}
            {s.tendencia === 'baja' && <ArrowDown className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} aria-label="a la baja" />}
            {n2(f.ritmo)}
            {(conf?.corto === 'baja' || (f.origen === 'inventario' && s.muestraCorta && s.vendidas.d30 > 0)) && (
              <span className="text-[var(--ls-t4)]" title="Poca historia: ritmo orientativo">
                *
              </span>
            )}
            {deInventario(f)}
          </span>
        )
      },
    },
    {
      id: 'cobertura',
      cabecera: 'Cobertura',
      alinear: 'derecha',
      ordenar: (f) => f.cobertura,
      celda: (f) => {
        if (f.estado === 'sin_datos' && f.cobertura === null) return raya
        if ((f.cobertura ?? 0) <= 0 && f.sku.vendibles <= 0)
          return <span className="text-[var(--ls-t3)]">{f.sku.entrante > 0 ? 'de camino' : f.sku.enAmazon > 0 ? 'no vendible' : 'agotado'}</span>
        if (f.cobertura === null) return <span className="text-[var(--ls-t4)]">sin ventas</span>
        return (
          <span className="inline-flex items-center justify-end gap-[6px]" title={f.origen === 'plan' ? 'Días que dura con lo que viene de camino (plan)' : 'Días que dura lo vendible al ritmo actual (inventario)'}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: tonoCobertura(f.cobertura) }} aria-hidden />
            {n0(f.cobertura)} d
          </span>
        )
      },
    },
    {
      id: 'rotura',
      cabecera: 'Rotura',
      rotuloMovil: 'Sin stock el',
      alinear: 'derecha',
      ordenar: (f) => f.rotura ?? '9999-12-31',
      celda: (f) => (f.rotura ? <span className="text-[var(--ls-t2)]">{fechaCorta(f.rotura, c.hoy)}</span> : raya),
    },
    {
      id: 'estado',
      cabecera: 'Estado',
      movil: 'insignia',
      ordenar: (f) => ORDEN_ESTADO[f.estado],
      celda: (f) => (
        <span className="inline-flex items-center gap-[6px]">
          <InsigniaEstadoStock estado={f.estado} />
          {f.stockViejo && (
            <span className="text-[10.5px] text-[var(--ls-t4)]" title="El stock de esta referencia sale de otro mercado y no es de hoy (D11)">
              viejo
            </span>
          )}
        </span>
      ),
    },
  ]
}

interface ColumnaExtra {
  id: string
  texto: string
  columna: (c: Ctx) => Columna<FilaStock>
  /** Solo la agencia */
  agencia?: boolean
}

const EXTRA: ColumnaExtra[] = [
  {
    id: 'enAmazon',
    texto: 'En Amazon (dentro)',
    columna: () => ({ id: 'enAmazon', cabecera: 'En Amazon', alinear: 'derecha', movil: 'oculto', ordenar: enAlmacen, celda: (f) => <b className="font-semibold text-[var(--ls-t1)]">{n0(enAlmacen(f))}</b> }),
  },
  {
    id: 'reservadas',
    texto: 'Reservado',
    columna: () => ({ id: 'reservadas', cabecera: 'Reservado', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.reservadas ?? null, celda: (f) => (f.sku.reservadas == null ? raya : n0(f.sku.reservadas)) }),
  },
  {
    id: 'noVendibles',
    texto: 'No vendibles',
    columna: () => ({ id: 'noVendibles', cabecera: 'No vend.', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.noDisponibles, celda: (f) => (f.sku.noDisponibles > 0 ? <span style={{ color: COLOR_ESTADO.ambar }}>{n0(f.sku.noDisponibles)}</span> : raya) }),
  },
  { id: 'v7', texto: 'Vendidas 7 días', columna: () => ({ id: 'v7', cabecera: '7 d', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.vendidas.d7, celda: (f) => n0(f.sku.vendidas.d7) }) },
  { id: 'v30', texto: 'Vendidas 30 días', columna: () => ({ id: 'v30', cabecera: '30 d', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.vendidas.d30, celda: (f) => n0(f.sku.vendidas.d30) }) },
  { id: 'v90', texto: 'Vendidas 90 días', columna: () => ({ id: 'v90', cabecera: '90 d', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.vendidas.d90, celda: (f) => n0(f.sku.vendidas.d90) }) },
  {
    id: 'ultima',
    texto: 'Última venta',
    columna: () => ({
      id: 'ultima',
      cabecera: 'Última venta',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => f.sku.diasSinVenta,
      celda: (f) => (
        <span className={f.estado === 'parado' ? undefined : 'text-[var(--ls-t3)]'} style={f.estado === 'parado' ? { color: COLOR_ESTADO.magenta } : undefined}>
          {f.sku.ultimaVenta ? hace(f.sku.diasSinVenta) : 'nunca'}
        </span>
      ),
    }),
  },
  {
    id: 'edad',
    texto: 'Antigüedad',
    columna: (c) => ({
      id: 'edad',
      cabecera: c.conAmazon ? 'Antigüedad' : 'Edad',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => (c.conAmazon ? (f.sku.edadAmazon?.masAntiguo ? TRAMOS_AMAZON.findIndex((t) => t.id === f.sku.edadAmazon?.masAntiguo) : null) : f.sku.edadMediaDias),
      celda: (f) => {
        if (!c.conAmazon) return f.sku.edadMediaDias === null ? raya : `${n0(f.sku.edadMediaDias)} d`
        const e = f.sku.edadAmazon
        const tramo = TRAMOS_AMAZON.find((t) => t.id === e?.masAntiguo)
        if (!e || !tramo) return raya
        const reparto = TRAMOS_AMAZON.filter((t) => e.edad[t.id] > 0).map((t) => `${t.texto}: ${n0(e.edad[t.id])}`).join(' · ')
        return (
          <span title={reparto} className="inline-flex items-center justify-end gap-[6px]">
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: COLOR_TRAMO_AMAZON[tramo.id] }} aria-hidden />
            {tramo.texto.replace(' días', '')} d
          </span>
        )
      },
    }),
  },
  {
    id: 'antiguas',
    texto: 'Unidades antiguas',
    columna: (c) => ({
      id: 'antiguas',
      cabecera: c.conAmazon ? '> 90 d' : '> 270 d',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => (c.conAmazon ? (f.sku.edadAmazon?.masDe90 ?? 0) : f.sku.porTramo.t271 + f.sku.porTramo.t366),
      celda: (f) => {
        const s = f.sku
        const v = c.conAmazon ? (s.edadAmazon?.masDe90 ?? 0) : s.porTramo.t271 + s.porTramo.t366
        // Con los tramos de Amazon, de 181 días en adelante ya hay recargo por antigüedad: eso va en rojo
        const conRecargo = c.conAmazon && s.edadAmazon ? s.edadAmazon.edad.a181 + s.edadAmazon.edad.a331 + s.edadAmazon.edad.a366 + s.edadAmazon.edad.a456 > 0 : !c.conAmazon
        return v > 0 ? <b className="font-semibold" style={{ color: conRecargo ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>{n0(v)}</b> : raya
      },
    }),
  },
  {
    id: 'devol',
    texto: 'Devoluciones 90 días',
    columna: () => ({
      id: 'devol',
      cabecera: 'Devol. 90 d',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => f.sku.devueltas.d90,
      celda: (f) =>
        f.sku.devueltas.d90 === 0 ? (
          raya
        ) : (
          <span style={f.sku.alertas.includes('devoluciones altas') ? { color: COLOR_ESTADO.ambar } : undefined}>
            {n0(f.sku.devueltas.d90)} <span className="text-[var(--ls-t4)]">({pct(f.sku.tasaDevolucion90)})</span>
          </span>
        ),
    }),
  },
  { id: 'valor', texto: 'Valor del stock', columna: (c) => ({ id: 'valor', cabecera: 'Valor', alinear: 'derecha', movil: 'oculto', ordenar: (f) => f.sku.valorStock, celda: (f) => din(f.sku.valorStock, f.sku.moneda ?? c.moneda) }) },
  {
    id: 'almacenaje',
    texto: 'Almacenaje al mes',
    columna: (c) => ({
      id: 'almacenaje',
      cabecera: 'Almac./mes',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => (c.conAmazon ? (f.sku.edadAmazon?.costeMes ?? null) : costeMensual(enAlmacen(f), c.mes, c.supuestos)),
      celda: (f) => <span className="text-[var(--ls-t3)]">{c.conAmazon ? eurFino(f.sku.edadAmazon?.costeMes ?? null) : eurFino(costeMensual(enAlmacen(f), c.mes, c.supuestos))}</span>,
    }),
  },
  {
    id: 'plan',
    texto: 'Lo que propone el plan',
    agencia: true,
    columna: (c) => ({
      id: 'plan',
      cabecera: 'Plan',
      alinear: 'derecha',
      movil: 'oculto',
      ordenar: (f) => f.linea?.cantidad ?? null,
      celda: (f) => {
        const l = f.linea
        if (!l || !l.cantidad || !l.prioridad) return raya
        const p = PRIORIDAD[l.prioridad]
        return (
          <span className="inline-flex items-center justify-end gap-[6px]" title={l.salirAntesDe ? `Que salga antes del ${fechaCorta(l.salirAntesDe, c.hoy)}` : undefined}>
            <span className="h-[7px] w-[7px] rounded-full" style={{ background: COLOR_ESTADO[p.tono] }} aria-hidden />
            {n0(l.cantidad)} ud
          </span>
        )
      },
    }),
  },
]

const CLAVE_COLUMNAS = 'fba-stock-columnas'

/** Las columnas de más que se ven, recordadas en este navegador (una comodidad: sin almacenamiento, ninguna) */
function useColumnasExtra(): [Set<string>, (id: string, visible: boolean) => void] {
  const [visibles, setVisibles] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    try {
      const crudo = window.localStorage.getItem(CLAVE_COLUMNAS)
      if (crudo) setVisibles(new Set((JSON.parse(crudo) as unknown[]).filter((x): x is string => typeof x === 'string')))
    } catch {
      // Sin almacenamiento: las de siempre
    }
  }, [])
  const cambiar = useCallback((id: string, visible: boolean) => {
    setVisibles((v) => {
      const n = new Set(v)
      if (visible) n.add(id)
      else n.delete(id)
      try {
        window.localStorage.setItem(CLAVE_COLUMNAS, JSON.stringify([...n]))
      } catch {
        // Vale mientras la pantalla esté abierta
      }
      return n
    })
  }, [])
  return [visibles, cambiar]
}

/* ------------------------------------------------------------------ */
/* La sección                                                          */
/* ------------------------------------------------------------------ */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function Contenido({
  datos,
  sesion,
  cliente,
  hoy,
  plan,
  planError,
  planCalculadoAt,
  supuestos,
  onSupuestos,
  actualizando,
  onActualizar,
  onPlanCambiado,
  callbacks,
}: {
  datos: InventarioDeCliente
  sesion: SesionRemesas
  cliente: ClienteRemesas
  hoy: string
  plan: PlanCliente | PlanParaCliente | null
  planError: string | null
  planCalculadoAt: string | null
  supuestos: SupuestosAlmacenaje
  onSupuestos: (s: SupuestosAlmacenaje) => void
  actualizando: boolean
  onActualizar: () => void
  onPlanCambiado: () => void
  callbacks?: Partial<CallbacksRemesas>
}) {
  const esAgencia = sesion.actor === 'agencia'
  const puedeEditar = esAgencia && cliente.puedeEditar
  const planAgencia = esAgencia && esPlanDeAgencia(plan) ? plan : null
  const moneda = planAgencia?.moneda ?? cliente.moneda
  const params = useSearchParams()
  const skuDeUrl = params?.get('sku') ?? null

  const [filtro, setFiltro] = useState<IdFiltro>('con_stock')
  const [busca, setBusca] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  // El tramo de la tarjeta de antigüedad que se ha pulsado: la tabla de abajo enseña sus productos
  const [tramoSel, setTramoSel] = useState<IdTramoInforme | null>(null)
  const [bajandoExcel, setBajandoExcel] = useState(false)
  const [extra, cambiarExtra] = useColumnasExtra()
  const zonaTabla = useRef<HTMLDivElement>(null)

  const lector = useLeerDeAmazon(cliente.id, onActualizar)
  const plazos = useConfirmarPlazos(cliente.id, onPlanCambiado)

  // El mapa de cobertura del Resumen manda aquí con ?sku=: se abre su ficha (una vez por sku)
  const skuAbiertoDeUrl = useRef<string | null>(null)
  useEffect(() => {
    if (!skuDeUrl || skuAbiertoDeUrl.current === skuDeUrl) return
    skuAbiertoDeUrl.current = skuDeUrl
    if (datos.skus.some((s) => s.sku === skuDeUrl)) {
      setFiltro('todas')
      setAbierta(skuDeUrl)
    }
  }, [skuDeUrl, datos.skus])

  const mes = mesDe(hoy)
  const ea = datos.edadAmazon
  const conAmazon = ea !== null
  const r = datos.resumen
  const sinLibro = datos.libro === 'sin_leer'
  const ctx: Ctx = useMemo(() => ({ mes, supuestos, conAmazon, moneda, hoy, esAgencia }), [mes, supuestos, conAmazon, moneda, hoy, esAgencia])

  /* ---------- plan + inventario ---------- */
  const filas = useMemo(
    () => filasDeStock(datos.skus, (plan?.lineas as LineaDeStock[] | undefined) ?? null, { coberturaMaxima: planAgencia?.ajustes.coberturaMaxima ?? null }),
    [datos.skus, plan, planAgencia]
  )
  const conPlan = filas.filter((f) => f.origen === 'plan').length
  const viejos = filas.filter((f) => f.stockViejo).length
  const diasPlan = plan ? diasDesde(plan.hoy, hoy) : null
  const mercado = cliente.mercadoLectura ?? plan?.calidad.mercado ?? datos.marketplaceId
  const enCamino: EnCamino[] = plan?.enCamino ?? []

  /* ---------- filtros ---------- */
  const filtros = useMemo(() => (conAmazon ? FILTROS.map((f) => (f.id === 'antiguas' ? FILTRO_ANTIGUAS_AMAZON : f)) : FILTROS), [conAmazon])
  const cuentas = useMemo(() => Object.fromEntries(filtros.map((f) => [f.id, filas.filter(f.admite).length])) as Record<IdFiltro, number>, [filtros, filas])

  // La antigüedad como una lista de tramos, venga de Amazon o estimada: lo que se pulsa y lo que se exporta
  const informe = useMemo(() => informeDeAntiguedad(datos, { costeDe: (u) => costeMensual(u, mes, supuestos) }), [datos, mes, supuestos])
  const tramoActivo = tramoDelInforme(informe, tramoSel)
  const productosDelTramo = useMemo(() => (tramoActivo ? productosDeTramo(datos.skus, informe, tramoActivo.id) : []), [datos.skus, informe, tramoActivo])

  const visibles = useMemo(() => {
    const f = filtros.find((x) => x.id === filtro) ?? filtros[0]
    const q = busca.trim().toLowerCase()
    const porSku = new Map(filas.map((x) => [x.sku.sku, x]))
    const base = tramoActivo ? productosDelTramo.map((p) => porSku.get(p.sku.sku)).filter((x): x is FilaStock => !!x) : filas.filter(f.admite)
    return base.filter((x) => !q || x.sku.sku.toLowerCase().includes(q) || (x.sku.nombre ?? '').toLowerCase().includes(q) || (x.sku.asin ?? '').toLowerCase().includes(q))
  }, [filas, filtros, filtro, busca, tramoActivo, productosDelTramo])

  /* ---------- columnas ---------- */
  const opcionesExtra = EXTRA.filter((e) => !e.agencia || esAgencia)
  const columnas = useMemo(() => {
    const base = columnasBase(ctx)
    const deTramo: Columna<FilaStock>[] = tramoActivo
      ? [
          {
            id: 'tramo',
            cabecera: tramoActivo.id === 'anterior' ? 'Sin edad' : `En ${tramoActivo.texto.replace(' días', '')}`,
            rotuloMovil: `En ${tramoActivo.texto}`,
            alinear: 'derecha',
            ordenar: (f) => unidadesEnTramo(f.sku, informe, tramoActivo.id),
            celda: (f) => (
              <span>
                <b className="font-semibold text-[var(--ls-t1)]">{n0(unidadesEnTramo(f.sku, informe, tramoActivo.id))}</b>
                <span className="text-[var(--ls-t4)]"> / {n0(enAlmacen(f))}</span>
              </span>
            ),
          },
        ]
      : []
    const mas = opcionesExtra.filter((e) => extra.has(e.id)).map((e) => e.columna(ctx))
    return [base[0], ...deTramo, ...base.slice(1), ...mas]
  }, [ctx, tramoActivo, informe, extra, opcionesExtra])

  /* ---------- almacenaje ---------- */
  // El almacenaje se cobra por lo que está DENTRO del almacén: lo que viene de camino no paga
  // Se suma por referencia: restar al total el camino de las remesas (que el total no lleva) daba menos que lo vendible
  const dentro = datos.skus.reduce((t, k) => t + dentroDe(k), 0)
  // Lo que la tarjeta de antigüedad no recoge: lo que Amazon tiene dentro y no está fechado ni es «anterior al libro»
  const sinClasificar = ea ? Math.max(0, dentro - ea.unidades) : Math.max(0, dentro - Object.values(r.porTramo).reduce((s, v) => s + v, 0) - r.anteriorALaLectura)
  const valorMasDe90 = ea ? ea.tramos.filter((t) => TRAMOS_MAS_DE_90.includes(t.id)).reduce((acc, t) => acc + t.valor, 0) : 0
  const est = useMemo(() => estimarAlmacenaje({ unidades: dentro, unidadesAntiguas: r.unidadesAntiguas }, mes, supuestos), [dentro, r.unidadesAntiguas, mes, supuestos])
  const mesSiguiente = MESES[mes % 12]

  const ficha = abierta ? filas.find((f) => f.sku.sku === abierta) ?? null : null

  function elegirTramo(id: string) {
    const nuevo = tramoSel === id ? null : (id as IdTramoInforme)
    setTramoSel(nuevo)
    setBusca('')
    // La tabla está más abajo: se lleva a la vista para que se vea que ha pasado algo
    if (nuevo) requestAnimationFrame(() => zonaTabla.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }))
  }

  /** El Excel de antigüedad con la marca: de todos los tramos, o solo del que se ha pulsado */
  async function bajarExcel(tramo: string | null) {
    setBajandoExcel(true)
    try {
      const q = new URLSearchParams({ cliente: cliente.id })
      if (tramo) q.set('tramo', tramo)
      const res = await fetch(`/api/fba/inventario/excel?${q.toString()}`)
      if (!res.ok) {
        const p = (await res.json().catch(() => null)) as { error?: string } | null
        toast.error(p?.error ?? 'No se ha podido generar el Excel')
        return
      }
      await bajarRespuesta(res, 'antiguedad-del-stock.xlsx')
      const nFilas = Number(res.headers.get('X-Filas') ?? 0)
      toast.success(`Excel descargado: ${nFilas} fila${nFilas === 1 ? '' : 's'} de productos`)
    } catch {
      toast.error('No se ha podido descargar el Excel. Revisa la conexión y vuelve a probar.')
    } finally {
      setBajandoExcel(false)
    }
  }

  function exportar() {
    descargarCsv(
      `stock-${cliente.nombre.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${hoy}.csv`,
      [
        'SKU', 'Producto', 'ASIN', ...(tramoActivo ? [`Uds en ${tramoActivo.texto}`] : []), 'Estado', 'En Amazon', 'Vendibles', 'De camino', 'No vendibles',
        'Vendidas 7 d', 'Vendidas 30 d', 'Vendidas 90 d', 'Ritmo (ud/día)', 'Cobertura (días)', 'Rotura', 'De dónde salen ritmo y cobertura',
        'Ud/día (inventario)', 'Días de stock (inventario)', 'Se agota (inventario)', 'Última venta', 'Días sin venta',
        ...(conAmazon ? [...TRAMOS_AMAZON.map((t) => `Antigüedad ${t.texto.replace(' días', '')} (uds)`), 'Más de 90 d (uds)'] : ['Edad media (d)', 'Más de 270 d (uds)']),
        'Devueltas 90 d', 'Tasa de devolución', 'Precio', 'Valor del stock', conAmazon ? 'Almacenaje/mes (Amazon)' : 'Almacenaje/mes (est.)',
        ...(esAgencia ? ['Propone el plan (ud)', 'Prioridad'] : []),
      ],
      visibles.map((f) => {
        const s = f.sku
        return [
          s.sku, s.nombre, s.asin, ...(tramoActivo ? [unidadesEnTramo(s, informe, tramoActivo.id)] : []), ESTADO_STOCK[f.estado].texto, s.enAmazon, s.vendibles, f.linea?.deCamino ?? s.entrante, s.noDisponibles,
          s.vendidas.d7, s.vendidas.d30, s.vendidas.d90, f.ritmo, f.cobertura, f.rotura, f.origen === 'plan' ? 'plan' : 'inventario',
          s.ritmoPlan, s.cobertura, s.seAgotaEl, s.ultimaVenta, s.diasSinVenta,
          ...(conAmazon ? [...TRAMOS_AMAZON.map((t) => s.edadAmazon?.edad[t.id] ?? null), s.edadAmazon?.masDe90 ?? null] : [s.edadMediaDias, s.porTramo.t271 + s.porTramo.t366]),
          s.devueltas.d90, s.tasaDevolucion90, s.precio, s.valorStock,
          conAmazon ? (s.edadAmazon?.costeMes ?? null) : costeMensual(enAlmacen(f), mes, supuestos),
          ...(esAgencia ? [f.linea?.cantidad ?? null, f.linea?.prioridad ? PRIORIDAD[f.linea.prioridad].texto : null] : []),
        ]
      })
    )
  }

  /* ---------- banda de calidad ---------- */
  const calidad = plan ? plan.calidad : calidadDeInventario(datos, hoy)
  const extraBanda: NonNullable<BandaDeCalidadProps['extra']> = []
  if (sesion.esAdmin && !datos.planificacion.tabla)
    extraBanda.push({ id: 'm231', tono: 'ambar', texto: 'Falta lanzar la migración 231_fba_planificacion.sql en Supabase: sin ella no se guarda la antigüedad que cuenta Amazon y se enseña la estimada con el libro mayor' })
  if (datos.planificacion.error)
    extraBanda.push({ id: 'planificacion', tono: 'rojo', texto: `La última lectura de la antigüedad de Amazon ha fallado${datos.planificacion.leidoAt ? ` (${fecha(datos.planificacion.leidoAt)})` : ''}: ${datos.planificacion.error}` })
  // El error de la lectura del libro ya lo da la banda con `ultimoError` si no hay plan; con plan, solo si el plan no lo trae
  if (plan && datos.lectura?.error && !('ultimoError' in plan.calidad && plan.calidad.ultimoError))
    extraBanda.push({ id: 'lectura', tono: 'rojo', texto: `La última lectura de Amazon ha fallado${datos.lectura.intentoAt ? ` (${fecha(datos.lectura.intentoAt)})` : ''}: ${datos.lectura.error}` })
  // Los avisos del inventario, sin los del libro (atraso, sin leer: los dice la banda) ni el de la edad estimada si Amazon da la suya
  for (const [i, a] of datos.avisos.entries()) {
    if (a.startsWith(AVISO_VENTAS_ATRASADAS) || a.startsWith(AVISO_LIBRO_SIN_LEER)) continue
    if (ea && a.includes(AVISO_ANTERIOR_AL_LIBRO)) continue
    extraBanda.push({ id: `inv_${i}`, tono: 'ambar', texto: a })
  }
  if (planError && !plan) extraBanda.push({ id: 'plan_error', tono: 'gris', texto: `El plan no se ha podido leer (${planError}): ritmo, cobertura y rotura salen del inventario` })

  if (!datos.conectado) {
    return (
      <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
        <EstadoVacio icono={Boxes} titulo="Este cliente no tiene la cuenta de Amazon conectada" descripcion="Sin la conexión no hay stock ni libro mayor de ventas que leer. Se conecta desde la ficha del cliente en Amazon." />
      </div>
    )
  }

  // «Propuesta a medida (IA)» está en la cabecera del cliente y «Leer de Amazon» en la banda de calidad de aquí debajo: no se repiten en esta cabecera
  const botonesCabecera: ReactNode = (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={onActualizar} disabled={actualizando} className={cx(BOTON.base, BOTON.alto, BOTON.secundario)} title="Volver a leer el inventario y el plan">
        <RefreshCw className={cx('h-3 w-3', actualizando && 'animate-spin motion-reduce:animate-none')} />
        Actualizar
      </button>
    </div>
  )

  return (
    <div className="flex min-w-0 flex-col gap-4 pb-3">
      {/* ================= CABECERA ================= */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="truncate text-[17px] font-semibold tracking-[-0.015em] text-[var(--ls-t1)]">Stock en Amazon {mercado ? marketplaceLabel(mercado) : ''}</h2>
          <p className="text-[12px] text-[var(--ls-t3)]">
            {cliente.nombre} · {datos.leidoHasta ? `ventas y devoluciones leídas hasta el ${fechaCorta(datos.leidoHasta, hoy)}` : 'libro mayor sin leer'}
            {datos.libroDesde && <span className="text-[var(--ls-t4)]"> · libro desde el {fechaCorta(datos.libroDesde, hoy)}</span>}
          </p>
        </div>
        {botonesCabecera}
      </div>

      <BandaDeCalidad
        calidad={calidad}
        esAdmin={sesion.esAdmin}
        puedeEditar={puedeEditar}
        hoy={hoy}
        onLeerAmazon={sesion.esAdmin && datos.conexionId ? () => lector.leer(datos.conexionId) : undefined}
        leyendo={lector.leyendo}
        onConfirmarPlazos={puedeEditar ? plazos.confirmar : undefined}
        confirmando={plazos.confirmando}
        onPonerPlazos={puedeEditar && callbacks?.onIrA ? () => callbacks.onIrA?.('cliente', 'reposicion') : undefined}
        extra={extraBanda}
      />

      {datos.skus.length === 0 ? (
        <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
          <EstadoVacio icono={Boxes} titulo="Todavía no hay nada que enseñar" descripcion="Ni stock en Amazon ni movimientos en el libro mayor de este cliente." />
        </div>
      ) : (
        <>
          {/* ================= LAS CIFRAS ================= */}
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4 2xl:grid-cols-8">
            <Kpi
              indice={0}
              rotulo="En Amazon"
              valor={n0(dentro)}
              sub={`vendibles ${n0(r.vendibles)} · de camino ${n0(r.entrante)} · no vendibles ${n0(r.noDisponibles)}`}
              ayuda="Lo que hay dentro de los almacenes de Amazon, sin lo que viene de camino. «No vendibles»: dañadas o defectuosas (si Amazon aún no ha dado el desglose, también reservadas o en tránsito sin registrar)"
            />
            <Kpi indice={1} rotulo="Valor del stock" valor={din(r.valorStock, moneda)} sub={`a precio de venta · ${n0(r.referencias)} referencia${r.referencias === 1 ? '' : 's'}`} />
            <Kpi indice={2} rotulo="Ventas (30 días)" valor={sinLibro ? '—' : n0(r.vendidas30)} sub={sinLibro ? 'sin libro mayor' : `${din(r.valorVentas30, moneda)} · ${n1(r.ritmo30)} ud/día`} />
            <Kpi
              indice={3}
              rotulo="Cobertura"
              valor={sinLibro ? '—' : plan?.resumen.coberturaMediana != null ? `${n0(plan.resumen.coberturaMediana)} días` : r.coberturaMedia === null ? '—' : `${n0(r.coberturaMedia)} días`}
              tono={cuentas.agotadas + cuentas.urgentes > 0 ? 'ambar' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${n0(cuentas.agotadas)} agotadas · ${n0(cuentas.urgentes)} rompen pronto`}
              ayuda={plan?.resumen.coberturaMediana != null ? 'Mediana de los días que dura cada referencia que vende, con lo que viene de camino (plan)' : 'Días que duraría todo el stock vendible al ritmo actual (inventario)'}
            />
            <Kpi
              indice={4}
              rotulo="Devoluciones (90 días)"
              valor={sinLibro ? '—' : pct(r.tasaDevolucion90)}
              tono={r.tasaDevolucion90 !== null && r.tasaDevolucion90 >= 0.12 ? 'ambar' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${n0(r.devueltas90)} de ${n0(r.vendidas90)} vendidas`}
            />
            <Kpi
              indice={5}
              rotulo="Parado"
              valor={sinLibro ? '—' : `${n0(r.paradasUnidades)} uds`}
              tono={r.paradas > 0 ? 'magenta' : undefined}
              sub={sinLibro ? 'sin libro mayor' : `${din(r.paradasValor, moneda)} · ${n0(r.paradas)} referencia${r.paradas === 1 ? '' : 's'} sin vender`}
              ayuda="Stock de productos que llevan 60 días o más sin venderse"
            />
            {ea ? (
              <Kpi
                indice={6}
                rotulo="Más de 90 días"
                valor={`${n0(ea.masDe90)} uds`}
                tono={ea.masDe180 > 0 ? 'rojo' : ea.masDe90 > 0 ? 'ambar' : undefined}
                sub={`${din(valorMasDe90, moneda)} · ${n0(ea.masDe180)} con más de 180 d`}
                ayuda="Unidades que llevan más de 90 días en Amazon según su informe de planificación: lo que Seller Central llama inventario antiguo. A partir de 181 días hay recargo por antigüedad"
              />
            ) : (
              <Kpi
                indice={6}
                rotulo="Edad media"
                valor={r.edadMediaDias === null ? '—' : `${n0(r.edadMediaDias)} días`}
                tono={r.unidadesAntiguas > 0 ? 'rojo' : undefined}
                sub={sinLibro ? 'sin libro mayor' : `${n0(r.unidadesAntiguas)} uds con más de 270 d`}
                ayuda="Días medios que llevan en Amazon las unidades que quedan (las que tienen entrada en el libro mayor)"
              />
            )}
            {ea && ea.costeMes !== null ? (
              <Kpi
                indice={7}
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
                indice={7}
                rotulo="Almacenaje (estimado)"
                valor={`${eurFino(est.almacenajeMes)}/mes`}
                sub={
                  <>
                    {m3(est.m3)} · {n0(supuestos.litrosPorUnidad)} L/ud
                    {est.almacenajeMesSiguiente !== est.almacenajeMes && (
                      <>
                        <br />
                        {mesSiguiente}: {eurFino(est.almacenajeMesSiguiente)}
                      </>
                    )}
                    {est.recargoMes !== null && ` · recargo ${eurFino(est.recargoMes)}`}
                  </>
                }
                ayuda="Estimación con un volumen medio por unidad y las tarifas por m³. Se ajusta con el lápiz"
                derecha={<AjusteAlmacenaje supuestos={supuestos} onGuardar={onSupuestos} />}
              />
            )}
          </div>

          {/* ================= LOS GRÁFICOS ================= */}
          <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
            <Tarjeta
              titulo="Ventas y devoluciones, día a día"
              ayuda={sinLibro ? 'Sin libro mayor leído' : `Últimos 90 días, hasta el ${fechaCorta(datos.leidoHasta, hoy)}`}
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
              ayuda={ea ? `Por tramos, como los cuenta Amazon · foto del ${fecha(ea.fecha)}` : 'Estimada con el libro mayor (lo más antiguo se vende primero)'}
              derecha={
                <button
                  type="button"
                  onClick={() => void bajarExcel(null)}
                  disabled={bajandoExcel || informe.unidades === 0}
                  className={cx(BOTON.base, BOTON.secundario)}
                  title="Descargar la antigüedad del stock en Excel, con la marca de Liberty Seller: los tramos y los productos de cada uno"
                >
                  {bajandoExcel ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <FileSpreadsheet className="h-3 w-3" />}
                  Excel
                </button>
              }
            >
              <div className="overflow-x-auto">
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
              </div>
              <p className="mt-2 text-[11px] leading-[1.5] text-[var(--ls-t4)]">Pulsa un tramo para ver debajo los productos que lo forman.</p>
            </Tarjeta>
          </div>

          {/* ================= DE DÓNDE SALEN LAS CIFRAS ================= */}
          <div className="flex flex-wrap items-center gap-2">
            {plan && conPlan > 0 ? (
              <NotaDeOrigen tono={diasPlan && diasPlan > 1 ? 'ambar' : undefined}>
                Ritmo, cobertura y rotura: plan de reposición
                {planCalculadoAt ? ` calculado el ${fechaCorta(planCalculadoAt.slice(0, 10), hoy)}` : ` del ${fechaCorta(plan.hoy, hoy)}`}
                {diasPlan && diasPlan > 0 ? ` · stock de hace ${diasPlan} día${diasPlan === 1 ? '' : 's'}` : ''}
                {conPlan < filas.length ? ` · ${n0(filas.length - conPlan)} del inventario («inv»)` : ''}
              </NotaDeOrigen>
            ) : (
              <NotaDeOrigen>Ritmo y cobertura del inventario: {plan ? 'el plan no trae estas referencias' : 'no hay plan calculado'}</NotaDeOrigen>
            )}
            {viejos > 0 && (
              <NotaDeOrigen tono="gris">
                {n0(viejos)} referencia{viejos === 1 ? '' : 's'} con {AVISO_LINEA.stock_viejo.texto.toLowerCase()}
              </NotaDeOrigen>
            )}
          </div>

          {/* ================= FILTROS ================= */}
          <div ref={zonaTabla} className="flex min-w-0 scroll-mt-20 flex-col gap-2">
            {tramoActivo && (
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className="inline-flex min-h-[28px] max-w-full items-center gap-[7px] rounded-[10px] border border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] pl-2 pr-1 text-[12px] text-[var(--ls-t1)]"
                  title="Los productos de abajo son los que tienen unidades en este tramo de antigüedad"
                >
                  <span
                    className="h-[8px] w-[8px] shrink-0 rounded-[2px]"
                    style={{ background: ea ? COLOR_TRAMO_AMAZON[tramoActivo.id as keyof typeof COLOR_TRAMO_AMAZON] : tramoActivo.id === 'anterior' ? 'var(--ls-t4)' : COLOR_TRAMO[tramoActivo.id as keyof typeof COLOR_TRAMO] }}
                  />
                  <b className="font-semibold">{tramoActivo.texto}</b>
                  <span className="truncate text-[var(--ls-t3)]">
                    {n0(productosDelTramo.length)} referencia{productosDelTramo.length === 1 ? '' : 's'} · {n0(tramoActivo.unidades)} uds{tramoActivo.valor > 0 ? ` · ${din(tramoActivo.valor, moneda)}` : ''}
                  </span>
                  <button type="button" onClick={() => setTramoSel(null)} className={BOTON.icono} aria-label="Quitar el filtro de antigüedad" title="Quitar el filtro y volver a ver todos los productos">
                    <X className="h-3 w-3" />
                  </button>
                </span>
                <button type="button" onClick={() => void bajarExcel(tramoActivo.id)} disabled={bajandoExcel} className={cx(BOTON.base, BOTON.secundario)} title="Descargar en Excel, con la marca, solo los productos de este tramo">
                  {bajandoExcel ? <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> : <FileSpreadsheet className="h-3 w-3" />}
                  Excel de este tramo
                </button>
              </div>
            )}
            <div className="ls-sin-barra -mx-4 flex gap-[6px] overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
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
                  aria-pressed={filtro === f.id && !tramoActivo}
                  className={cx(BOTON.chip, 'shrink-0 [@media(pointer:coarse)]:min-h-[36px]', filtro === f.id && !tramoActivo && BOTON.chipEncendido)}
                >
                  {f.alerta && cuentas[f.id] > 0 && <span className="h-[7px] w-[7px] rounded-full" style={{ background: f.id === 'agotadas' ? COLOR_ESTADO.rojo : COLOR_ESTADO.naranja }} />}
                  {f.texto}
                  <span className="tabular-nums text-[var(--ls-t4)]">{cuentas[f.id]}</span>
                </button>
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <label className="relative block min-w-0 flex-1 sm:max-w-[300px]">
                <span className="sr-only">Buscar</span>
                <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="SKU, ASIN o nombre" className={cx(CAMPO.input, 'pl-[26px] [@media(pointer:coarse)]:min-h-[44px]')} />
              </label>
              <span className="text-[12px] tabular-nums text-[var(--ls-t4)]">
                {n0(visibles.length)} referencia{visibles.length === 1 ? '' : 's'}
              </span>
              <div className="ml-auto flex items-center gap-2">
                <div className="hidden lg:block">
                  <MenuColumnas opciones={opcionesExtra.map((e) => ({ id: e.id, texto: e.texto }))} visibles={extra} onCambio={cambiarExtra} />
                </div>
                <button type="button" onClick={exportar} disabled={visibles.length === 0} className={cx(BOTON.base, BOTON.alto, BOTON.secundario, '[@media(pointer:coarse)]:min-h-[44px]')}>
                  CSV
                </button>
              </div>
            </div>
          </div>

          {/* ================= LA TABLA ================= */}
          <TablaAdaptable
            columnas={columnas}
            filas={visibles}
            claveDe={(f) => f.sku.sku}
            alPulsarFila={(f) => setAbierta(f.sku.sku)}
            filaActiva={abierta}
            porPagina={50}
            etiqueta={`Stock de ${cliente.nombre} por referencia`}
            vacio={{ icono: Search, titulo: 'Nada con este filtro', descripcion: busca ? `Ninguna referencia coincide con «${busca}».` : 'Prueba con otro filtro o con «Todas».' }}
          />
          <p className="text-[11px] leading-[1.5] text-[var(--ls-t4)]">
            Las ventas y devoluciones salen del libro mayor de inventario de Amazon, que se lee una vez al día.{' '}
            {ea
              ? 'La antigüedad y el coste de almacenaje salen del informe de planificación de inventario de Amazon, que se lee a la vez.'
              : 'La edad del stock se estima con la convención FIFO: lo más antiguo se vende primero.'}{' '}
            * ritmo orientativo (poca historia). «inv»: la referencia no está en el plan y sus cifras salen del inventario.
          </p>
        </>
      )}

      <FichaSku
        fila={ficha}
        hoy={hoy}
        leidoHasta={datos.leidoHasta}
        supuestos={supuestos}
        moneda={moneda}
        enCamino={enCamino}
        plazo={planAgencia ? { hastaLaVenta: planAgencia.plazo.hastaLaVenta, margen: planAgencia.plazo.margen } : null}
        esAgencia={esAgencia}
        onCerrar={() => setAbierta(null)}
        onVerEnReponer={callbacks?.onIrA ? (sku) => callbacks.onIrA?.('cliente', 'reposicion', { cliente: cliente.id, sku }) : undefined}
      />
    </div>
  )
}
