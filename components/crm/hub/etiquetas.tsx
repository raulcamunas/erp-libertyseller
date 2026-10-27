'use client'

import type { TonoEstado } from '@/lib/estilo/denso'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EstadoDeNota, InteresDelCliente, MetodoDeCita, ModeloDeNegocio } from '@/lib/crm/gemini/tipos'

/** Cómo se llama y de qué color se pinta cada valor que sale de las notas de Gemini y de su análisis. Un solo sitio para las seis pestañas */

export const INTERES: Record<InteresDelCliente, { texto: string; tono: TonoEstado }> = {
  alto: { texto: 'Interés alto', tono: 'verde' },
  medio: { texto: 'Interés medio', tono: 'cian' },
  bajo: { texto: 'Interés bajo', tono: 'ambar' },
  ninguno: { texto: 'Sin interés', tono: 'rojo' },
  no_claro: { texto: 'Interés sin determinar', tono: 'gris' },
}

export const ESTADO_DE_NOTA: Record<EstadoDeNota, { texto: string; tono: TonoEstado }> = {
  procesada: { texto: 'Analizada', tono: 'verde' },
  pendiente: { texto: 'Por analizar', tono: 'ambar' },
  sin_cita: { texto: 'Sin cliente', tono: 'naranja' },
  error: { texto: 'Con error', tono: 'rojo' },
  ignorada: { texto: 'Interna', tono: 'gris' },
}

export const METODO_DE_CITA: Record<MetodoDeCita, string> = {
  evento: 'Enlazada por el evento del calendario',
  invitado: 'Enlazada por el correo del invitado',
  nombre: 'Enlazada por el nombre y la fecha',
  manual: 'Asignada a mano',
}

export const MODELO_DE_NEGOCIO: Record<ModeloDeNegocio, string> = {
  marca_propia: 'Marca propia',
  arbitraje: 'Arbitraje',
  dropshipping: 'Dropshipping',
  mixto: 'Mixto',
  otro: 'Otro',
  no_claro: 'Sin determinar',
}

/** «sábado 17 de octubre» -> «Sábado 17 de octubre» (la clase `capitalize` de CSS pondría mayúscula también a «De») */
export const conMayuscula = (texto: string) => texto.charAt(0).toUpperCase() + texto.slice(1)

/** El medidor de seis tramos de la propuesta: cuántas de sus piezas están hechas */
export function Medidor({ hechas, total = 6 }: { hechas: number; total?: number }) {
  return (
    <div className="flex items-center gap-[3px]" role="img" aria-label={`${hechas} de ${total}`}>
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-[5px] flex-1 rounded-[2px]" style={{ backgroundColor: i < hechas ? COLOR_ESTADO.verde : 'var(--ls-linea2)' }} />
      ))}
    </div>
  )
}
