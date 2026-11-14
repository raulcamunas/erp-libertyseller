import { redirect } from 'next/navigation'
import { exigirTareas } from '@/lib/tareas-clientes/acceso'
import { cargarInicio } from '@/lib/tareas-clientes/servidor'
import { Inicio } from '@/components/tareas-clientes/Inicio'

/**
 * TAREAS DE CLIENTES: EL INICIO. Los clientes en tarjetas, con lo que tienen por hacer. El permiso (administradores y la casilla «Tareas de clientes») se comprueba aquí y
 * otra vez en cada ruta de /api/tareas-clientes y en las políticas de la base: esta página solo evita enseñar una pantalla vacía a quien no puede entrar.
 */
export default async function TareasClientesPage() {
  const permiso = await exigirTareas()
  if (!permiso.ok) redirect(permiso.estado === 401 ? '/auth/login' : '/dashboard')
  // Los datos se leen AQUÍ, al servir la página: llega ya con todo pintado (sin pantalla de carga ni una segunda petición) y el navegador solo la refresca por detrás
  const inicial = await cargarInicio(permiso.userId, permiso.clientes).catch(() => null)
  return <Inicio esAdmin={permiso.esAdmin} inicial={inicial as never} />
}
