import { BotonDelMenu } from '@/components/tareas-clientes/BotonDelMenu'
import { PresenciaProvider } from '@/components/tareas-clientes/PresenciaProvider'
import { exigirTareas } from '@/lib/tareas-clientes/acceso'

/**
 * TAREAS DE CLIENTES SE ABRE A PANTALLA COMPLETA, como otra aplicación: la barra lateral del ERP se esconde (AppSidebar, lib/layout/inmersivo.ts) y este recuadro ocupa toda
 * la ventana. El único rastro del ERP es el botón de arriba a la derecha, que abre su menú como un cajón. Aquí también se abre el canal de presencia (quién está dónde): vive en el
 * diseño y no en cada pantalla para que no se corte al ir del inicio a un cliente.
 */
export default async function TareasClientesLayout({ children }: { children: React.ReactNode }) {
  const permiso = await exigirTareas()
  const contenido = (
    <div className="tc-inmersivo">
      <BotonDelMenu />
      {children}
    </div>
  )
  if (!permiso.ok) return contenido
  return <PresenciaProvider yo={{ id: permiso.userId, nombre: permiso.nombre }}>{contenido}</PresenciaProvider>
}
