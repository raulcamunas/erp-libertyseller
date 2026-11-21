'use client'

import { useId, useMemo, useState } from 'react'
import { BarChart3, Cloud, GanttChartSquare, LayoutGrid, Route, Table2 } from 'lucide-react'
import { PanelDePestana, Pestanas, Segmentado } from '@/components/ui-ls'
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
 *   Referencias  una pestaña con tres vistas: todas las columnas, almacén (lo que queda y si cuadra con Amazon) y rotación (ritmo y cuándo se agota).
 *   Seguimiento  lo que dice Amazon (recorrido y lo que no ha llegado) y, debajo, quién hizo qué en el equipo.
 *   Lotes        el FIFO de este envío: embudo, curva frente a los anteriores y referencias con «Lote vivo».
 *   Amazon (API) el plan creado desde el ERP (solo administradores, envíos en «enviada»).
 * Antes eran 9 pestañas (Almacén, Rotación e Historial sueltas); los enlaces del Resumen a ellas siguen llevando a su sitio.
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
  // «Referencias» junta lo que antes eran tres pestañas (tabla completa, almacén y rotación): se elige la vista dentro
  const [vistaRefs, setVistaRefs] = useState<'tabla' | 'almacen' | 'rotacion'>('tabla')
  // Los enlaces viejos (el Resumen lleva a «almacén», «rotación» o «historial») caen en su sitio nuevo
  const ir = (id: IdPestana) => {
    if (id === 'almacen' || id === 'rotacion') {
      setVistaRefs(id)
      setPestana('referencias')
    } else if (id === 'historial') setPestana('seguimiento')
    else setPestana(id)
  }
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
    { id: 'referencias' as const, texto: 'Referencias', icono: Table2, cuenta: conDescuadre + ritmo.encaminoDeAgotarse > 0 ? conDescuadre + ritmo.encaminoDeAgotarse : undefined },
    { id: 'seguimiento' as const, texto: 'Seguimiento', icono: Route, cuenta: conFaltantes > 0 ? conFaltantes : undefined },
    ...(clienteId ? [{ id: 'lotes' as const, texto: 'Lotes', icono: GanttChartSquare }] : []),
    // El envío por API (seguimiento y anulación dentro de plazo). Solo administradores
    ...(esAdmin && remesa.estado === 'enviada' ? [{ id: 'amazon' as const, texto: 'Amazon (API)', icono: Cloud }] : []),
  ]
  const activa: IdPestana = opciones.some((o) => o.id === pestana) ? pestana : 'resumen'

  return (
    <section aria-label="Desglose del envío" className="flex min-w-0 flex-col gap-3">
      {/* Con 9 pestañas en la columna de un portátil (1440 px con la barra lateral: ~784 px) «Referencias», «Historial» y «Amazon (API)»
          quedaban fuera, a la derecha, sin barra de desplazamiento. Por debajo de 2xl se aprieta (sin iconos) y, si aun así no caben,
          las que sobran bajan a otra fila (`envolver`): ninguna pestaña de siempre se queda sin ver */}
      <Pestanas
        etiqueta="Desglose del envío"
        acento="remesas"
        opciones={opciones}
        valor={activa}
        onCambio={ir}
        idPanel={idPanel}
        envolver
        className="gap-0.5 [&_[role=tab]]:px-2.5 max-2xl:[&_[role=tab]_svg]:hidden"
      />

      <PanelDePestana id={idPanel} key={activa} className="min-w-0">
        {activa === 'resumen' && <TabResumen remesa={remesa} filas={filas} ritmo={ritmo} serie={serie} onIrA={ir} />}
        {activa === 'ventas' && <TabVentas remesa={remesa} hoy={hoy} />}
        {activa === 'seguimiento' && (
          // Lo que dice Amazon (recorrido y lo que no ha llegado) y, debajo, quién hizo qué en el equipo: antes eran dos pestañas
          <div className="flex min-w-0 flex-col gap-4">
            <TabSeguimiento remesa={remesa} hoy={hoy} />
            <HistorialRemesa key={remesa.id} remesaId={remesa.id} />
          </div>
        )}
        {activa === 'lotes' && clienteId && <TabLotes remesaId={remesa.id} clienteId={clienteId} hoy={hoy} />}
        {activa === 'referencias' && (
          <div className="flex min-w-0 flex-col gap-3">
            <Segmentado<'tabla' | 'almacen' | 'rotacion'>
              etiqueta="Vista de las referencias"
              tamano="sm"
              opciones={[
                { id: 'tabla', texto: 'Todas las columnas' },
                { id: 'almacen', texto: `Almacén${conDescuadre > 0 ? ` (${conDescuadre})` : ''}` },
                { id: 'rotacion', texto: `Rotación${ritmo.encaminoDeAgotarse > 0 ? ` (${ritmo.encaminoDeAgotarse})` : ''}` },
              ]}
              valor={vistaRefs}
              onCambio={setVistaRefs}
            />
            {vistaRefs === 'tabla' && <TablaReferencias filas={filas} lineas={remesa.lineas} conectado={conectado} nombreArchivo={nombreArchivo} ritmoReferencia={ritmoReferencia} />}
            {vistaRefs === 'almacen' && <TabAlmacen filas={filas} lineas={remesa.lineas} nombreArchivo={nombreArchivo} />}
            {vistaRefs === 'rotacion' && <TabRotacion filas={filas} lineas={remesa.lineas} ritmo={ritmo} nombreArchivo={nombreArchivo} ritmoReferencia={ritmoReferencia} />}
          </div>
        )}
        {activa === 'amazon' && <EnviarAAmazon key={`a-${remesa.id}`} remesaId={remesa.id} soloSeguimiento />}
      </PanelDePestana>
    </section>
  )
}
