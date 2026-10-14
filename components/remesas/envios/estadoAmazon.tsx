'use client'

import type { ReactNode } from 'react'
import { CheckCircle2, CircleDashed, Clock, PackageCheck, PackageOpen, Truck, XCircle, AlertTriangle } from 'lucide-react'
import type { TonoEstado } from '@/lib/estilo/denso'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { ESTADO_INBOUND_TEXTO } from '@/lib/fba/inbound-estados'
import { ESTADOS_AMAZON_MALOS, estaEnlazada } from '@/lib/fba/vista'
import { Insignia } from '../comun/ui'

/**
 * EL ESTADO REAL DE UN ENVÍO, PARA PINTARLO.
 *
 * Lo dice Amazon, no el ERP. Tres casos que se leen distinto:
 *   · sin número de envío  → no es una avería: nunca se enlazó con Amazon;
 *   · con número y un error → lo que contestó Amazon, no un genérico;
 *   · con número y estado   → el estado, en cristiano.
 */

export interface VisualEstado {
  texto: string
  tono: TonoEstado
  icono: ReactNode
  titulo?: string
}

const I = 'h-3 w-3'

export function visualDeEstado(r: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>): VisualEstado {
  if (!estaEnlazada(r)) {
    return { texto: 'Sin enlazar', tono: 'gris', icono: <CircleDashed className={I} />, titulo: 'No tiene número de envío FBA: no se puede seguir en Amazon' }
  }
  if (r.seguimientoError) {
    return { texto: 'Amazon no lo reconoce', tono: 'rojo', icono: <AlertTriangle className={I} />, titulo: r.seguimientoError }
  }
  const e = r.estadoAmazon
  if (!e) {
    return { texto: 'Sin consultar', tono: 'gris', icono: <Clock className={I} />, titulo: 'Todavía no se ha preguntado a Amazon por este envío' }
  }
  if (ESTADOS_AMAZON_MALOS.includes(e)) {
    return { texto: ESTADO_INBOUND_TEXTO[e]?.texto ?? e, tono: 'rojo', icono: <XCircle className={I} /> }
  }
  switch (e) {
    case 'CLOSED':
      return { texto: 'Cerrado', tono: 'verde', icono: <CheckCircle2 className={I} />, titulo: 'Amazon ha terminado de recibirlo' }
    case 'RECEIVING':
      return { texto: 'Recibiendo', tono: 'cian', icono: <PackageOpen className={I} />, titulo: 'Amazon está contando y colocando las unidades' }
    case 'CHECKED_IN':
      return { texto: 'Registrado', tono: 'cian', icono: <PackageCheck className={I} /> }
    case 'DELIVERED':
      return { texto: 'Entregado', tono: 'azul', icono: <PackageCheck className={I} />, titulo: 'Ha llegado al centro de Amazon; falta registrarlo' }
    case 'SHIPPED':
    case 'IN_TRANSIT':
      return { texto: 'En tránsito', tono: 'azul', icono: <Truck className={I} /> }
    default:
      return { texto: ESTADO_INBOUND_TEXTO[e]?.texto ?? e, tono: 'ambar', icono: <Clock className={I} /> }
  }
}

export function InsigniaAmazon({ remesa, className }: { remesa: Pick<RemesaDePanel, 'referenciaEnvio' | 'estadoAmazon' | 'seguimientoError'>; className?: string }) {
  const v = visualDeEstado(remesa)
  return (
    <Insignia tono={v.tono} icono={v.icono} titulo={v.titulo} className={className}>
      {v.texto}
    </Insignia>
  )
}
