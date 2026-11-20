'use client'

import { Bell, ChevronLeft, Menu } from 'lucide-react'

/**
 * LA CABECERA DEL MÓVIL: «Atrás», el nombre de la aplicación en la que se está y la campana. Sustituye al botón flotante del menú que había antes.
 *
 * La pinta AppSidebar (que sabe en qué aplicación se está, también al instante de pulsar, antes de que cargue). La campana de verdad, con sus avisos y
 * sus sonidos, vive en la hoja «Más»: esta solo enseña la cuenta y pide abrirla. Debajo del reloj y de la muesca del iPhone deja su hueco
 * (`env(safe-area-inset-top)`). Se esconde desde `lg` y en las pantallas a pantalla completa (Chat, Tareas).
 */
export function CabeceraMovil({
  titulo,
  enInicio,
  avisos,
  alVolver,
  alAbrirAvisos,
  alAbrirMenu,
}: {
  titulo: string
  enInicio: boolean
  avisos: number
  alVolver: () => void
  alAbrirAvisos: () => void
  /** Solo para quien no tiene barra de abajo (un cliente): el menú, para su cuenta y el tema */
  alAbrirMenu?: () => void
}) {
  return (
    <header className="cab-movil lg:hidden">
      {enInicio ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="cab-movil-logo" src="/logos/logo.png" alt="Liberty Seller Hub" width={112} height={18} draggable={false} />
      ) : (
        <button type="button" className="cab-movil-boton" onClick={alVolver} aria-label="Volver">
          <ChevronLeft aria-hidden />
        </button>
      )}
      {!enInicio && <p className="cab-movil-titulo">{titulo}</p>}
      <span className="cab-movil-hueco" />
      <button type="button" className="cab-movil-boton" onClick={alAbrirAvisos} aria-label={avisos > 0 ? `Notificaciones: ${avisos} sin leer` : 'Notificaciones'}>
        <Bell aria-hidden />
        {avisos > 0 && (
          <span className="cab-movil-insignia" aria-hidden>
            {avisos > 9 ? '9+' : avisos}
          </span>
        )}
      </button>
      {alAbrirMenu && (
        <button type="button" className="cab-movil-boton" onClick={alAbrirMenu} aria-label="Abrir el menú">
          <Menu aria-hidden />
        </button>
      )}
    </header>
  )
}
