'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Briefcase, CheckCircle2, ChevronRight } from 'lucide-react'

/**
 * «TUS CUENTAS HOY», arriba de «Mi día»: por cada cuenta que lleva la persona (Cuentas de clientes), la semana del ciclo con los pasos que faltan y lo que espera
 * en PPC, SEO y Cumplimiento, cada cosa con su enlace. Lo calcula /api/trabajo/mis-cuentas. Si no lleva ninguna, no se pinta.
 */

interface Cuenta {
  amazonClientId: string
  slug: string
  nombre: string
  semana: string | null
  pasosPendientes: Array<{ id: string; titulo: string }>
  pasosTotal: number
  avisos: Array<{ modulo: string; texto: string; tono: 'rojo' | 'ambar'; href: string }>
  href: string
}

const COLOR = { rojo: '#F87171', ambar: '#F5B942' } as const
const MODULO: Record<string, string> = { ppc: 'PPC', seo: 'SEO', cumplimiento: 'Cumplimiento' }

export function TusCuentasHoy({ usuario }: { usuario: string | null }) {
  const [cuentas, setCuentas] = useState<Cuenta[] | null>(null)
  useEffect(() => {
    let vivo = true
    setCuentas(null)
    fetch(`/api/trabajo/mis-cuentas${usuario ? `?usuario=${encodeURIComponent(usuario)}` : ''}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ cuentas: Cuenta[] }>) : { cuentas: [] }))
      .then((d) => vivo && setCuentas(d.cuentas))
      .catch(() => vivo && setCuentas([]))
    return () => {
      vivo = false
    }
  }, [usuario])
  if (!cuentas || cuentas.length === 0) return null
  return (
    <section className="mb-4 rounded-[16px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3 sm:p-4" aria-label="Tus cuentas hoy">
      <h2 className="mb-2.5 flex items-center gap-2 text-[13px] font-semibold text-[var(--ls-t1)]">
        <Briefcase className="h-4 w-4 text-[var(--ls-acc)]" aria-hidden /> Tus cuentas hoy
        <span className="text-[12px] font-normal text-[var(--ls-t4)]">· {cuentas.length}</span>
      </h2>
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
        {cuentas.map((c) => {
          const hechos = c.pasosTotal - c.pasosPendientes.length
          return (
            <div key={c.amazonClientId} className="min-w-0 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
              <Link href={c.href} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-[var(--ls-t1)]">{c.nombre}</span>
                <span className="shrink-0 text-[11px] text-[var(--ls-t4)]">{c.semana ?? 'Sin ciclo'}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
              </Link>
              {c.pasosTotal > 0 && (
                <div className="mt-1.5 text-[11.5px] text-[var(--ls-t3)]">
                  {c.pasosPendientes.length === 0 ? (
                    <span className="inline-flex items-center gap-1 text-[#34D399]">
                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> Ciclo de la semana hecho
                    </span>
                  ) : (
                    <>
                      <span className="tabular-nums">
                        {hechos}/{c.pasosTotal}
                      </span>{' '}
                      · falta: {c.pasosPendientes.map((p) => p.titulo).join(' · ')}
                    </>
                  )}
                </div>
              )}
              {c.avisos.length > 0 && (
                <ul className="mt-1.5 space-y-1">
                  {c.avisos.map((a) => (
                    <li key={a.texto}>
                      <Link href={a.href} className="flex items-start gap-1.5 text-[11.5px] leading-snug hover:underline" style={{ color: COLOR[a.tono] }}>
                        <AlertTriangle className="mt-[1px] h-3 w-3 shrink-0" aria-hidden />
                        <span>
                          <span className="font-semibold">{MODULO[a.modulo] ?? a.modulo}:</span> {a.texto}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
