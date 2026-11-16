'use client'

import { useId, useMemo, useState } from 'react'
import { Activity, BarChart3, Boxes, Cloud, GanttChartSquare, History, LayoutGrid, Route, Table2 } from 'lucide-react'
import { PanelDePestana, Pestanas } from '@/components/ui-ls'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import { analizarProductos, resumenDeRitmo, serieDeRemesa, type FilaProducto, type ResumenRitmo } from '@/lib/fba/analisis'
import { HistorialRemesa } from '../propuestas/HistorialRemesa'
import { EnviarAAmazon } from '../amazon/EnviarAAmazon'
import { TabAlmacen } from './TabAlmacen'
import { TablaReferencias } from './TablaReferencias'
import { TabLotes } from './TabLotes'
import { TabResumen } from './TabResumen'
import { TabRotacion } from './TabRotacion'
import { TabSeguimiento } from './TabSeguimiento'
import { TabVentas } from './TabVentas'

/**
 * EL DESGLOSE DE UN ENVÍO, EN PESTAÑAS (las del kit, con el acento de Remesas).
 *
 *   Resumen      cómo va de un vistazo y el día a día.
 *   Ventas       las salidas de cada producto, día a día.
 *   Almacén      lo que queda de cada producto y si cuadra con Amazon.
 *   Rotación     a qué ritmo sale cada producto de ESTE envío (y el de su referencia al lado) y cuándo se agota.
 *   Seguimiento  el historial del envío y lo que no ha llegado.
 *   Lotes        (nuevo, §5.3) el FIFO de este envío: embudo, curva frente a los anteriores y referencias con «Lote vivo».
 *   Referencias  la tabla completa, con todas las columnas.
 *   Historial    quién hizo qué, de la propuesta al envío.
 *   Amazon (API) el plan creado desde el ERP (solo administradores, envíos en «enviada»).
 *
 * Todo sale de lo que el panel ya trae (lib/fba/analisis.ts), salvo Lotes (GET /api/fba/lotes, con memoria de 5 min) y
 * el Historial. Cada pestaña se monta solo cuando está abierta, así que sus gráficos no gastan nada escondidos. La cuenta
 * de una pestaña avisa de lo que hay que mirar sin abrirla.
 */

export type IdPestana = 'resumen' | 'ventas' | 'almacen' | 'rotacion' | 'seguimiento' | 'lotes' | 'referencias' | 'historial' | 'amazon'

export function PestanasEnvio({
  remesa,
  skus,
  hoy,
  conectado,
  esAdmin = false,
  clienteId,
  ritmoReferencia = null,
  filas: filasDadas,
  ritmo: ritmoDado,
}: {
  remesa: RemesaDePanel
  skus: SkuDePanel[]
  hoy: string
  conectado: boolean
  esAdmin?: boolean
  /** Sin él no hay pestaña Lotes (se piden por cliente) */
  clienteId?: string
  /** Ritmo de cada referencia (planificador, o panel si no hay plan) para ponerlo al lado del de este envío */
  ritmoReferencia?: Map<string, number> | null
  /** Si quien monta ya los ha calculado, no se repite */
  filas?: FilaProducto[]
  ritmo?: ResumenRitmo
}) {
  const [pestana, setPestana] = useState<IdPestana>('resumen')
  const idPanel = `panel-envio-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`

  const globales = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])
  const filas: FilaProducto[] = useMemo(() => filasDadas ?? analizarProductos(remesa, globales, hoy), [filasDadas, remesa, globales, hoy])
  const serie = useMemo(() => serieDeRemesa(remesa, hoy), [remesa, hoy])
  const ritmo: ResumenRitmo = useMemo(() => ritmoDado ?? resumenDeRitmo(remesa, filas, hoy), [ritmoDado, remesa, filas, hoy])

  const conDescuadre = filas.filter((f) => f.descuadre !== null && f.descuadre !== 0).length
  const conFaltantes = remesa.lineas.filter((l) => l.recibidas !== null && l.recibidas < l.enviadas).length
  const nombreArchivo = remesa.referenciaEnvio ?? remesa.id.slice(0, 8)

  const opciones = [
    { id: 'resumen' as const, texto: 'Resumen', icono: LayoutGrid },
    { id: 'ventas' as const, texto: 'Ventas por día', icono: BarChart3 },
    { id: 'almacen' as const, texto: 'Almacén', icono: Boxes, cuenta: conDescuadre > 0 ? conDescuadre : undefined },
    { id: 'rotacion' as const, texto: 'Rotación', icono: Activity, cuenta: ritmo.encaminoDeAgotarse > 0 ? ritmo.encaminoDeAgotarse : undefined },
    { id: 'seguimiento' as const, texto: 'Seguimiento', icono: Route, cuenta: conFaltantes > 0 ? conFaltantes : undefined },
    ...(clienteId ? [{ id: 'lotes' as const, texto: 'Lotes', icono: GanttChartSquare }] : []),
    { id: 'referencias' as const, texto: 'Referencias', icono: Table2 },
    { id: 'historial' as const, texto: 'Historial', icono: History },
    // El envío por API (seguimiento y anulación dentro de plazo). Solo administradores
    ...(esAdmin && remesa.estado === 'enviada' ? [{ id: 'amazon' as const, texto: 'Amazon (API)', icono: Cloud }] : []),
  ]
  const activa: IdPestana = opciones.some((o) => o.id === pestana) ? pestana : 'resumen'

  return (
    <section aria-label="Desglose del envío" className="flex min-w-0 flex-col gap-3">
      {/* Con 9 pestañas en la columna de un portátil (1440 px con la barra lateral: ~784 px) los iconos y el relleno sacaban «Historial» fuera de la vista; por debajo de 2xl se aprieta para que se vean todas las de siempre */}
      <Pestanas
        etiqueta="Desglose del envío"
        acento="remesas"
        opciones={opciones}
        valor={activa}
        onCambio={setPestana}
        idPanel={idPanel}
        className="gap-0.5 [&_[role=tab]]:px-2.5 max-2xl:[&_[role=tab]_svg]:hidden"
      />

      <PanelDePestana id={idPanel} key={activa} className="min-w-0">
        {activa === 'resumen' && <TabResumen remesa={remesa} filas={filas} ritmo={ritmo} serie={serie} onIrA={setPestana} />}
        {activa === 'ventas' && <TabVentas remesa={remesa} hoy={hoy} />}
        {activa === 'almacen' && <TabAlmacen filas={filas} lineas={remesa.lineas} nombreArchivo={nombreArchivo} />}
        {activa === 'rotacion' && <TabRotacion filas={filas} lineas={remesa.lineas} ritmo={ritmo} nombreArchivo={nombreArchivo} ritmoReferencia={ritmoReferencia} />}
        {activa === 'seguimiento' && <TabSeguimiento remesa={remesa} hoy={hoy} />}
        {activa === 'lotes' && clienteId && <TabLotes remesaId={remesa.id} clienteId={clienteId} hoy={hoy} />}
        {activa === 'referencias' && <TablaReferencias filas={filas} lineas={remesa.lineas} conectado={conectado} nombreArchivo={nombreArchivo} ritmoReferencia={ritmoReferencia} />}
        {activa === 'historial' && <HistorialRemesa key={remesa.id} remesaId={remesa.id} abierto />}
        {activa === 'amazon' && <EnviarAAmazon key={`a-${remesa.id}`} remesaId={remesa.id} soloSeguimiento />}
      </PanelDePestana>
    </section>
  )
}
