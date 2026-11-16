'use client'

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, CheckCircle2, CircleDashed, Clock, PackageCheck, PackageOpen, Truck, XCircle } from 'lucide-react'
import { Insignia } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { ESTADOS_AMAZON_MALOS, estaEnlazada } from '@/lib/fba/vista'

/**
 * EL ESTADO REAL DE UN ENVÍO, PARA PINTARLO.
 *
 * Lo dice Amazon, no el ERP. Tres casos que se leen distinto:
 *   · sin número de envío  → no es una avería: nunca se enlazó con Amazon;
 *   · con número y un error → lo que contestó Amazon, no un genérico;
 *   · con número y estado   → el estado, en cristiano.
 *
 * API
 *   visualDeEstado(remesa) → { texto, tono, Icono, icono, titulo, enMarcha }   (`icono` como nodo, por compatibilidad)
 *   <InsigniaAmazon remesa tamano? />                                        la insignia del kit
 */

export interface VisualEstado {
  texto: string
  tono: TonoEstado
  Icono: LucideIcon
  /** El mismo glifo como nodo (h-3), para quien lo pinta a mano */
  icono: ReactNode
  titulo?: string
  /** Algo está pasando ahora (de camino, recibiendo) */
  enMarcha: boolean
}

function v(texto: string, tono: TonoEstado, Icono: LucideIcon, titulo?: string, enMarcha = false): VisualEstado {
  return { texto, tono, Icono, icono: <Icono className="h-3 w-3" />, titulo, enMarcha }
}

export function visualDeEstado(r: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>): VisualEstado {
  if (!estaEnlazada(r)) return v('Sin enlazar', 'gris', CircleDashed, 'No tiene número de envío FBA: no se puede seguir en Amazon')
  if (r.seguimientoError) return v('Amazon no lo reconoce', 'rojo', AlertTriangle, r.seguimientoError)
  const e = r.estadoAmazon
  if (!e) return v('Sin consultar', 'gris', Clock, 'Todavía no se ha preguntado a Amazon por este envío')
  if (ESTADOS_AMAZON_MALOS.includes(e)) return v(ESTADO_INBOUND_TEXTO[e]?.texto ?? e, 'rojo', XCircle)
  switch (e) {
    case 'CLOSED':
      return v('Cerrado', 'verde', CheckCircle2, 'Amazon ha terminado de recibirlo')
    case 'RECEIVING':
      return v('Recibiendo', 'cian', PackageOpen, 'Amazon está contando y colocando las unidades', true)
    case 'CHECKED_IN':
      return v('Registrado', 'cian', PackageCheck, 'Ha llegado y Amazon lo ha registrado; falta contar las unidades', true)
    case 'DELIVERED':
      return v('Entregado', 'azul', PackageCheck, 'Ha llegado al centro de Amazon; falta registrarlo', true)
    case 'SHIPPED':
    case 'IN_TRANSIT':
      return v('En tránsito', 'azul', Truck, 'De camino al centro de Amazon', true)
    default:
      return v(ESTADO_INBOUND_TEXTO[e]?.texto ?? e, 'ambar', Clock)
  }
}

export function InsigniaAmazon({
  remesa,
  className,
  tamano = 'sm',
}: {
  remesa: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>
  className?: string
  tamano?: 'sm' | 'md'
}) {
  const e = visualDeEstado(remesa)
  return (
    <Insignia tono={e.tono} icono={e.Icono} title={e.titulo} tamano={tamano} className={className}>
      {e.texto}
    </Insignia>
  )
}
