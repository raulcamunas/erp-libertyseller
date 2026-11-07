import { BotonDelMenu } from '@/components/tareas-clientes/BotonDelMenu'

/**
 * TAREAS DE CLIENTES SE ABRE A PANTALLA COMPLETA, como otra aplicación: la barra lateral del ERP se esconde (AppSidebar, lib/layout/inmersivo.ts) y este recuadro ocupa toda
 * la ventana. El único rastro del ERP es el botón de arriba a la derecha, que abre su menú como un cajón.
 */
export default function TareasClientesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="tc-inmersivo">
      <BotonDelMenu />
      {children}
    </div>
  )
}
