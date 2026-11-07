'use client'

import { Menu } from 'lucide-react'
import { EVENTO_ABRIR_MENU } from '@/lib/layout/inmersivo'

/** El único rastro del ERP en la pantalla completa: arriba a la derecha, abre su menú como un cajón. */
export function BotonDelMenu() {
  return (
    <button type="button" className="tc-menu-erp" aria-label="Abrir el menú del ERP" title="Menú del ERP" onClick={() => window.dispatchEvent(new Event(EVENTO_ABRIR_MENU))}>
      <Menu className="h-4 w-4" aria-hidden />
    </button>
  )
}
