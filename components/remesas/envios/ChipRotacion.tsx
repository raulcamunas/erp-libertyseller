'use client'

import type { LucideIcon } from 'lucide-react'
import { Gauge, Hourglass, Moon, PackageX, Zap } from 'lucide-react'
import { Insignia } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { CLASE_TEXTO, type Clase } from '@/lib/fba/analisis'

/** Cómo rota un producto en ESTE envío: glifo, palabra y después color. Ver CLASE_TEXTO */
const VISUAL: Record<Clase, { tono: TonoEstado; Icono: LucideIcon }> = {
  sin_stock: { tono: 'gris', Icono: PackageX },
  rapida: { tono: 'rojo', Icono: Zap },
  media: { tono: 'ambar', Icono: Gauge },
  lenta: { tono: 'azul', Icono: Hourglass },
  sin_ventas: { tono: 'gris', Icono: Moon },
}

export function ChipRotacion({ clase }: { clase: Clase }) {
  const v = VISUAL[clase]
  return (
    <Insignia tono={v.tono} icono={v.Icono} title={CLASE_TEXTO[clase].ayuda} tamano="sm" variante={clase === 'sin_stock' ? 'contorno' : 'suave'}>
      {CLASE_TEXTO[clase].texto}
    </Insignia>
  )
}
