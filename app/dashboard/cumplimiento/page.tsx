import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getUserProfile } from '@/lib/supabase/get-user-profile'
import { clientesGrowth } from '@/lib/growth/clientes'
import { paisesDeCliente } from '@/lib/cumplimiento/panel'
import { entraEnApp } from '@/lib/cuentas/acceso'
import { Vacio } from '@/components/plataforma/comun'
import { CumplimientoApp, TODOS } from '@/components/cumplimiento/CumplimientoApp'
import { PanelDeClientes, VolverATodos } from '@/components/plataforma/PanelDeClientes'
import { panelCumplimiento } from '@/lib/cumplimiento/panel-clientes'

/**
 * /dashboard/cumplimiento — CUMPLIMIENTO (antes, un submódulo de Growth Partner). SOLO ADMIN (un CEO, solo con la casilla).
 *
 * Lo que Amazon dice de cada listing de un cliente (errores, ocultos, avisos de GPSR y RAP…), con un panel por cliente y país. Lee de Amazon; solo ESCRIBE desde el panel «Corregir» de una incidencia (validar primero, con
 * confirmación y registro: lib/cumplimiento/correccion-servidor.ts). Ninguna vista junta ni compara clientes.
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

  // SIN CLIENTE EN LA URL: el panel de todos (la pantalla de inicio del módulo, vista de pájaro con lo de cada uno)
  if (!uno(searchParams.c)) {
    const porSlug = new Map(conCuenta.map((c) => [c.slug, c.amazonClientId as string]))
    const { clientes: tarjetas, resumen } = await panelCumplimiento(clientes.map((c) => ({ slug: c.slug, nombre: c.nombre, amazonClientId: porSlug.get(c.slug) as string, paises: c.cuentas.filter((x) => x.pais !== '*').map((x) => x.pais) })))
    return <PanelDeClientes titulo="Cumplimiento" subtitulo="Todos los clientes: cuántos listings están bien, cuáles necesitan atención y cuáles tienen ventas en juego. Pulsa uno para entrar." icono="cumplimiento" clientes={tarjetas} resumen={resumen} />
  }

  const cliente = clientes.find((c) => c.slug === uno(searchParams.c)) ?? clientes[0]
  const cuenta = cliente.cuentas.find((c) => c.id === uno(searchParams.p)) ?? cliente.cuentas[0] ?? null

  // Alto fijo (y scroll por dentro) solo desde md, donde está la barra de clientes. En el móvil la página crece y hace scroll la ventana: con el alto fijo
  // la cabecera y las pestañas se quedaban quietas (~330 px de 740) y el contenido bajaba en una caja de 375 px; deslizar sobre la cabecera no movía nada
  return (
    <div className="flex flex-col md:h-[var(--alto-util)] lg:h-[calc(100vh-4rem)] min-w-0">
      <VolverATodos href="/dashboard/cumplimiento" />
      <CumplimientoApp clientes={clientes} clienteInicial={cliente.slug} cuentaInicial={cuenta?.id ?? null} pestana={uno(searchParams.t) ?? 'bloqueos'} />
    </div>
  )
}
