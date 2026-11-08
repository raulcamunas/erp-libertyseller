import { notFound, redirect } from 'next/navigation'
import { exigirTareas } from '@/lib/tareas-clientes/acceso'
import { EspacioDeTrabajo } from '@/components/tareas-clientes/EspacioDeTrabajo'
import type { Ambito } from '@/lib/tareas-clientes/ambito'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * EL ESPACIO DE TRABAJO: `/dashboard/tareas-clientes/<id del cliente>`, `/todas`, `/mis-tareas` o `/mi-dia`. Con `?tarea=<id>` se abre esa tarea a la derecha (así llevan hasta ella
 * los avisos de la campana).
 */
export default async function EspacioPage({ params, searchParams }: { params: { clienteId: string }; searchParams: { tarea?: string } }) {
  const permiso = await exigirTareas()
  if (!permiso.ok) redirect(permiso.estado === 401 ? '/auth/login' : '/dashboard')

  let ambito: Ambito
  if (params.clienteId === 'todas') ambito = { tipo: 'todas' }
  else if (params.clienteId === 'mis-tareas') ambito = { tipo: 'mias' }
  else if (params.clienteId === 'mi-dia') ambito = { tipo: 'dia' }
  else if (UUID.test(params.clienteId)) ambito = { tipo: 'cliente', id: params.clienteId.toLowerCase() }
  else notFound()

  const tarea = searchParams.tarea && UUID.test(searchParams.tarea) ? searchParams.tarea.toLowerCase() : null
  return <EspacioDeTrabajo ambito={ambito} miId={permiso.userId} esAdmin={permiso.esAdmin} tareaInicial={tarea} />
}
