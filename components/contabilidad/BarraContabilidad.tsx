'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { BookOpenText, Calculator, FileSpreadsheet, HandCoins, Landmark, Receipt, Scale, type LucideIcon } from 'lucide-react'

/**
 * CONTABILIDAD: UN SOLO PANEL CON SUS APARTADOS.
 *
 * Cada apartado sigue siendo su pantalla de siempre, en su dirección de siempre (los enlaces guardados, los avisos de la campana y los permisos no cambian):
 * esta barra va encima de todas y las une. Solo la ven administradores y socios; quien entra a Comisiones o a Tax Reports por su permiso suelto ve su
 * pantalla sin la barra, igual que antes. «Empleados» es solo de administradores (enseña el sueldo de cada persona).
 */

interface Apartado {
  id: string
  nombre: string
  ruta: string
  icono: LucideIcon
  soloAdmin?: boolean
  /** Para Facturación → pestaña concreta */
  pestana?: string
}

const APARTADOS: Apartado[] = [
  { id: 'resumen', nombre: 'Resumen', ruta: '/dashboard/contabilidad', icono: BookOpenText },
  { id: 'tesoreria', nombre: 'Tesorería', ruta: '/dashboard/tesoreria', icono: Landmark },
  { id: 'facturacion', nombre: 'Facturas y cobros', ruta: '/dashboard/facturacion', icono: Receipt },
  { id: 'bancos', nombre: 'Bancos', ruta: '/dashboard/facturacion', pestana: 'extractos', icono: Scale },
  { id: 'empleados', nombre: 'Pagos a empleados', ruta: '/dashboard/empleados', icono: HandCoins, soloAdmin: true },
  { id: 'comisiones', nombre: 'Comisiones', ruta: '/dashboard/commissions', icono: Calculator },
  { id: 'tax', nombre: 'Tax Reports', ruta: '/dashboard/tax-reports', icono: FileSpreadsheet },
]

/** useSearchParams pide un Suspense alrededor (si no, Next deja la página entera sin prerender) */
export function BarraContabilidad({ rol }: { rol: string | null | undefined }) {
  return (
    <Suspense fallback={null}>
      <Barra rol={rol} />
    </Suspense>
  )
}

function Barra({ rol }: { rol: string | null | undefined }) {
  const ruta = usePathname()
  const q = useSearchParams()
  if (rol !== 'admin' && rol !== 'partner') return null
  const activo = (a: Apartado) => {
    if (a.ruta !== ruta && !(a.ruta !== '/dashboard/contabilidad' && ruta?.startsWith(`${a.ruta}/`))) return false
    if (a.ruta === '/dashboard/facturacion') return (q?.get('pestana') === 'extractos') === (a.pestana === 'extractos')
    return true
  }
  return (
    <nav aria-label="Apartados de contabilidad" className="mb-2 flex min-w-0 items-center gap-1 overflow-x-auto border-b border-[var(--ls-linea)] pb-[6px]">
      <span className="mr-2 shrink-0 text-[13px] font-semibold text-[var(--ls-t1)]">Contabilidad</span>
      {APARTADOS.filter((a) => !a.soloAdmin || rol === 'admin').map((a) => {
        const on = activo(a)
        const Icono = a.icono
        return (
          <Link
            key={a.id}
            href={a.pestana ? `${a.ruta}?pestana=${a.pestana}` : a.ruta}
            aria-current={on ? 'page' : undefined}
            className={`inline-flex h-7 shrink-0 items-center gap-[6px] rounded-[6px] border px-[10px] text-[12px] font-medium transition-colors ${
              on ? 'border-[var(--ls-acc-borde)] bg-[var(--ls-sel)] text-[var(--ls-t1)]' : 'border-transparent text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
            }`}
          >
            <Icono className="h-[14px] w-[14px]" />
            {a.nombre}
          </Link>
        )
      })}
    </nav>
  )
}
