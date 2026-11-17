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
    <nav aria-label="Apartados de contabilidad" className="mb-3 flex min-w-0 items-center gap-3 overflow-x-auto pb-1">
      <span className="flex shrink-0 items-center gap-2 pr-1">
        <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]">
          <BookOpenText className="h-4 w-4" />
        </span>
        <span className="text-[15px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)]">Contabilidad</span>
      </span>
      <div className="flex shrink-0 items-center gap-0.5 rounded-xl border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1">
        {APARTADOS.filter((a) => !a.soloAdmin || rol === 'admin').map((a) => {
          const on = activo(a)
          const Icono = a.icono
          return (
            <Link
              key={a.id}
              href={a.pestana ? `${a.ruta}?pestana=${a.pestana}` : a.ruta}
              aria-current={on ? 'page' : undefined}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-medium transition-all ${
                on ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)] shadow-[inset_0_0_0_1px_var(--ls-linea2)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
              }`}
            >
              <Icono className="h-[14px] w-[14px]" style={on ? { color: 'var(--ls-acc)' } : undefined} />
              {a.nombre}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
