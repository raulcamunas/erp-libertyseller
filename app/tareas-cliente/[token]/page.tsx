import { PanelPublico, PanelNoValido } from '@/components/tareas-clientes/portal/PanelPublico'
import { abrirPanelDelCliente } from '@/lib/tareas-clientes/portal-servidor'

/** EL PANEL DEL CLIENTE: se resuelve en el servidor; a la pantalla solo llega lo que portal.ts deja ver. Un enlace que no vale enseña una pantalla que dice qué hacer y nada más. */
export const dynamic = 'force-dynamic'

export default async function PaginaDelPanelDelCliente({ params }: { params: { token: string } }) {
  const r = await abrirPanelDelCliente(params.token)
  if (!r.ok) return <PanelNoValido />
  return <PanelPublico panel={r.panel} />
}
