'use client'

import { useMemo } from 'react'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound'
import { fecha as formatoFecha } from './formato'

/**
 * EL RECORRIDO DE UN ENVÍO, COMO EL «PROGRESO DEL ENVÍO» DE SELLER CENTRAL.
 *
 * Mezcla cuatro cosas, todas con su fecha:
 *   - cuándo se vio cambiar el estado del envío (en tránsito, entregado, en
 *     recepción…) y cuándo se vieron llegar unidades;
 *   - la llegada confirmada por el libro mayor de inventario;
 *   - la primera venta de la remesa, que es cuándo empieza a venderse de verdad.
 *
 * Amazon NO da por API las horas de su propio «Progreso del envío»: solo el estado
 * de ahora. Estas horas son las de cuándo se VIO el cambio (se consulta cada hora
 * mientras el envío está vivo), con una hora de margen como mucho.
 */

const hora = new Intl.DateTimeFormat('es-ES', {
  timeZone: 'Europe/Madrid',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

interface Paso {
  cuando: string
  texto: string
  detalle?: string
  tono: 'normal' | 'bueno'
  /** Si la hora es de verdad o solo se sabe el día */
  soloDia?: boolean
}

export function SeguimientoEnvio({ remesa }: { remesa: RemesaDePanel }) {
  const pasos = useMemo(() => {
    const out: Paso[] = [
      { cuando: `${remesa.fechaEnvio}T00:00:00`, texto: 'Fecha de envío de la remesa', tono: 'normal', soloDia: true },
    ]

    let estadoAnterior: string | null = null
    for (const e of remesa.eventos) {
      const unidades =
        e.recibidas !== null && e.enviadas !== null ? `${e.recibidas} de ${e.enviadas} unidades recibidas` : undefined
      if (e.estadoAmazon !== estadoAnterior) {
        out.push({
          cuando: e.vistoAt,
          texto: ESTADO_INBOUND_TEXTO[e.estadoAmazon ?? '']?.texto ?? e.estadoAmazon ?? 'Estado desconocido',
          detalle: unidades,
          tono: 'normal',
        })
        estadoAnterior = e.estadoAmazon
      } else {
        out.push({ cuando: e.vistoAt, texto: 'Amazon sigue registrando unidades', detalle: unidades, tono: 'normal' })
      }
    }

    if (remesa.llegadaAt) {
      out.push({
        cuando: remesa.llegadaAt,
        texto: 'Llegada al almacén confirmada',
        detalle: 'Según el libro mayor de inventario de Amazon',
        tono: 'bueno',
        soloDia: remesa.llegadaAt.length <= 10,
      })
    }

    const primera = remesa.ventasPorDia.find((v) => v.vendidas > 0)
    if (primera) {
      const total = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
      out.push({
        cuando: `${primera.fecha}T00:00:00`,
        texto: 'Primera venta de esta remesa',
        detalle: `${total} unidades vendidas hasta hoy`,
        tono: 'bueno',
        soloDia: true,
      })
    }

    return out.sort((a, b) => Date.parse(a.cuando) - Date.parse(b.cuando))
  }, [remesa])

  const sinHistorial = remesa.eventos.length === 0

  return (
    <div className="glass-card px-3 py-2.5">
      <p className="text-[11px] font-medium text-white/60">Seguimiento del envío</p>

      <ol className="mt-2 space-y-1.5">
        {pasos.map((p, i) => (
          <li key={`${p.cuando}|${i}`} className="flex items-start gap-2">
            <span
              className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${p.tono === 'bueno' ? 'bg-emerald-400' : 'bg-[#FF6600]'}`}
            />
            <div className="min-w-0">
              <p className="text-[12px] text-white/85">
                {p.texto}
                <span className="ml-2 text-[10px] text-white/35">
                  {p.soloDia ? formatoFecha(p.cuando) : hora.format(new Date(p.cuando))}
                </span>
              </p>
              {p.detalle && <p className="text-[10px] text-white/40">{p.detalle}</p>}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-2 text-[10px] leading-relaxed text-white/30">
        {sinHistorial
          ? remesa.referenciaEnvio
            ? 'Todavía no se ha apuntado ningún cambio del envío. Se mira cada hora mientras siga vivo, o al pulsar «Consultar en Amazon».'
            : 'Esta remesa no tiene número de envío FBA, así que no se puede seguir su estado en Amazon.'
          : 'Las horas son las de cuándo se vio el cambio —se consulta cada hora—, no las que muestra Seller Central.'}
      </p>
    </div>
  )
}
