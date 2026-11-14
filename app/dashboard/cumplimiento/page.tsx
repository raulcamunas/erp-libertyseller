import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { paisesDeCliente } from '@/lib/cumplimiento/panel'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { CumplimientoApp, TODOS } from '@/components/cumplimiento/CumplimientoApp'

/**
 * /dashboard/cumplimiento — CUMPLIMIENTO (antes, un submódulo de Growth Partner). SOLO ADMIN (un CEO, solo con la casilla).
 *
 * Lo que Amazon dice de cada listing de un cliente (errores, ocultos, avisos de GPSR y RAP…), con un panel por cliente y país. Solo LEE de Amazon. Ninguna vista junta ni compara clientes.
 */
export const dynamic = 'force-dynamic'

export default async function CumplimientoPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/auth/login')
  const perfil = await getUserProfile()
  if (!perfil) redirect('/auth/login')
  // Administradores y quien lleve cuentas con la casilla (lib/cuentas/acceso.ts); un partner o un cliente, nunca
  if (!(await entraEnApp(supabase, user.id, perfil.role, perfil.puesto, 'cumplimiento'))) redirect('/dashboard')

  const uno = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
  const conCuenta = (await clientesGrowth()).filter((c) => c.amazonClientId)
  // Los países de cada cliente, cada uno por su lado (nada se cruza entre clientes)
  const clientes = (
    await Promise.all(
      conCuenta.map(async (c) => {
        const paises = await paisesDeCliente(c.amazonClientId as string).catch(() => [])
        const cuentas = paises.map((p) => ({ id: p.id, pais: p.pais, moneda: null, nombre: p.nombre }))
        return { slug: c.slug, nombre: c.nombre, cuentas: cuentas.length > 1 ? [{ id: TODOS, pais: '*', moneda: null, nombre: null, etiqueta: 'Todos los países' }, ...cuentas] : cuentas }
      })
    )
  ).filter((c) => c.cuentas.length > 0)

  if (clientes.length === 0) {
    return (
      <Vacio icono={<ClipboardCheck />} titulo="Ningún cliente tiene la cuenta de vendedor conectada">
        Se conectan en <strong>Amazon API · Cuentas</strong>.
      </Vacio>
    )
  }

  const cliente = clientes.find((c) => c.slug === uno(searchParams.c)) ?? clientes[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  return (
    <div className="flex flex-col h-[calc(100dvh-8rem)] lg:h-[calc(100vh-4rem)] min-w-0">
      <CumplimientoApp clientes={clientes} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'hoy'} />
    </div>
  )
}
