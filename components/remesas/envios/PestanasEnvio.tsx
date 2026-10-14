'use client'

import { useMemo, useState } from 'react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { RemesaDePanel, SkuDePanel } from '@/lib/fba/datos'
import { analizarProductos, resumenDeRitmo, serieDeRemesa, type FilaProducto, type ResumenRitmo } from '@/lib/fba/analisis'
import { cx } from '../comun/ui'
import { TabAlmacen } from './TabAlmacen'
import { TablaReferencias } from './TablaReferencias'
import { TabResumen } from './TabResumen'
import { TabRotacion } from './TabRotacion'
import { TabSeguimiento } from './TabSeguimiento'
import { TabVentas } from './TabVentas'

/**
 * EL DESGLOSE DE UN ENVÍO, EN PESTAÑAS.
 *
 *   Resumen      cómo va de un vistazo y el día a día.
 *   Ventas       las ventas de cada producto, día a día.
 *   Almacén      lo que queda de cada producto y si cuadra con Amazon.
 *   Rotación     a qué ritmo sale cada producto y cuándo se agota.
 *   Seguimiento  el historial del envío y lo que no ha llegado.
 *   Referencias  la tabla completa, con todas las columnas.
 *
 * Todo sale de lo que el panel ya trae (lib/fba/analisis.ts): ninguna pestaña
 * llama a nada por su cuenta, así que cambiar de una a otra es instantáneo. Una
 * marca de color en la pestaña avisa de lo que hay que mirar sin abrirla.
 */

export type IdPestana = 'resumen' | 'ventas' | 'almacen' | 'rotacion' | 'seguimiento' | 'referencias'

export function PestanasEnvio({ remesa, skus, hoy, conectado }: { remesa: RemesaDePanel; skus: SkuDePanel[]; hoy: string; conectado: boolean }) {
  const [pestana, setPestana] = useState<IdPestana>('resumen')

  const globales = useMemo(() => new Map(skus.map((s) => [s.sku, s])), [skus])
  const filas: FilaProducto[] = useMemo(() => analizarProductos(remesa, globales, hoy), [remesa, globales, hoy])
  const serie = useMemo(() => serieDeRemesa(remesa, hoy), [remesa, hoy])
  const ritmo: ResumenRitmo = useMemo(() => resumenDeRitmo(remesa, filas, hoy), [remesa, filas, hoy])

  const conDescuadre = filas.some((f) => f.descuadre !== null && f.descuadre !== 0)
  const nombreArchivo = remesa.referenciaEnvio ?? remesa.id.slice(0, 8)

  const pestanas: Array<{ id: IdPestana; texto: string; marca?: string; titulo?: string }> = [
    { id: 'resumen', texto: 'Resumen' },
    { id: 'ventas', texto: 'Ventas por día' },
    { id: 'almacen', texto: 'Almacén', marca: conDescuadre ? COLOR_ESTADO.ambar : undefined, titulo: conDescuadre ? 'Hay referencias que no cuadran con Amazon' : undefined },
    { id: 'rotacion', texto: 'Rotación', marca: ritmo.encaminoDeAgotarse > 0 ? COLOR_ESTADO.rojo : undefined, titulo: ritmo.encaminoDeAgotarse > 0 ? 'Hay referencias que se agotan en menos de una semana' : undefined },
    { id: 'seguimiento', texto: 'Seguimiento', marca: remesa.unidadesQueNoLlegaron > 0 ? COLOR_ESTADO.ambar : undefined, titulo: remesa.unidadesQueNoLlegaron > 0 ? 'Hay unidades que no han llegado' : undefined },
    { id: 'referencias', texto: 'Referencias' },
  ]

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div role="tablist" aria-label="Desglose del envío" className="flex shrink-0 items-end gap-1 overflow-x-auto border-b border-[var(--ls-linea)]">
        {pestanas.map((p) => {
          const activa = pestana === p.id
          return (
            <button
              key={p.id}
              type="button"
              role="tab"
              aria-selected={activa}
              title={p.titulo}
              onClick={() => setPestana(p.id)}
              className={cx(
                'relative -mb-px inline-flex h-[34px] items-center gap-[6px] whitespace-nowrap border-b-2 px-3 text-[12.5px] transition-colors',
                activa
                  ? 'border-[var(--ls-acc-graf)] font-medium text-[var(--ls-t1)]'
                  : 'border-transparent text-[var(--ls-t3)] hover:text-[var(--ls-t1)]'
              )}
            >
              {p.texto}
              {p.marca && <span className="h-[7px] w-[7px] rounded-full" style={{ background: p.marca }} aria-hidden />}
            </button>
          )
        })}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4 pr-[2px] pt-3">
        {pestana === 'resumen' && <TabResumen remesa={remesa} filas={filas} ritmo={ritmo} serie={serie} onIrA={setPestana} />}
        {pestana === 'ventas' && <TabVentas remesa={remesa} hoy={hoy} />}
        {pestana === 'almacen' && <TabAlmacen filas={filas} nombreArchivo={nombreArchivo} />}
        {pestana === 'rotacion' && <TabRotacion filas={filas} ritmo={ritmo} nombreArchivo={nombreArchivo} />}
        {pestana === 'seguimiento' && <TabSeguimiento remesa={remesa} />}
        {pestana === 'referencias' && <TablaReferencias filas={filas} conectado={conectado} nombreArchivo={nombreArchivo} />}
      </div>
    </div>
  )
}
