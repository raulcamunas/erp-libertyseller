'use client'

import { Gauge, Hourglass, Moon, PackageX, Zap } from 'lucide-react'
import type { TonoEstado } from '@/lib/estilo/denso'
import { CLASE_TEXTO, type Clase } from '@/lib/fba/analisis'
import { Insignia } from '../comun/ui'

/** Cómo rota un producto: glifo, palabra y después color. Ver CLASE_TEXTO */
const VISUAL: Record<Clase, { tono: TonoEstado; icono: React.ReactNode }> = {
  sin_stock: { tono: 'gris', icono: <PackageX className="h-3 w-3" /> },
  rapida: { tono: 'rojo', icono: <Zap className="h-3 w-3" /> },
  media: { tono: 'ambar', icono: <Gauge className="h-3 w-3" /> },
  lenta: { tono: 'azul', icono: <Hourglass className="h-3 w-3" /> },
  sin_ventas: { tono: 'gris', icono: <Moon className="h-3 w-3" /> },
}

export function ChipRotacion({ clase }: { clase: Clase }) {
  const v = VISUAL[clase]
  return (
    <Insignia tono={v.tono} icono={v.icono} titulo={CLASE_TEXTO[clase].ayuda}>
      {CLASE_TEXTO[clase].texto}
    </Insignia>
  )
}
