'use client'

/**
 * EL ARMAZÓN de la propuesta: barra superior, menú lateral y el hueco de la
 * pantalla. Aquí se inyecta la hoja de estilo, que va toda con prefijo `lsd-`
 * y bajo `.lsd-raiz`, para no pisar al ERP ni a las otras dos propuestas.
 */

import { useId } from 'react'
import { Bell, Search, User } from 'lucide-react'
import { CSS } from './estilos'
import { MENU, type AppMaqueta } from './datos'

export type Modo = 'claro' | 'oscuro'

export function Estilos() {
  // Un solo <style>. Sin `dangerouslySetInnerHTML` no hay forma de meter CSS
  // literal en React sin que escape las comillas y los `>`.
  return <style dangerouslySetInnerHTML={{ __html: CSS }} />
}

interface MarcoProps {
  modo: Modo
  sinColor: boolean
  /** id del módulo abierto, para pintar el activo del menú */
  activo: string
  onNavegar: (id: string) => void
  children: React.ReactNode
}

/**
 * La barra superior no existe hoy: hoy hay dos iconos en `position: fixed`
 * flotando sobre el contenido, sin contenedor. Cuesta 48 px fijos y a cambio
 * se lleva por delante el bloque de título de 76-79 px que hoy repite CADA
 * pantalla, y mete el buscador global que hoy no está en ninguna parte
 * (0 resultados de `cmdk`, `CommandPalette` o `Ctrl+K` en el repositorio).
 */
export function Marco({ modo, sinColor, activo, onNavegar, children }: MarcoProps) {
  const idBusca = useId()

  return (
    <div
      className="lsd-raiz"
      data-modo={modo}
      data-sincolor={sinColor ? 'si' : 'no'}
      style={{ height: '100%' }}
    >
      <Estilos />

      <header className="lsd-barra">
        <span className="lsd-marca-logo">
          <span className="lsd-marca-barra lsd-sincolor" aria-hidden />
          Liberty Seller Hub
        </span>

        <label className="lsd-buscador" htmlFor={idBusca}>
          <Search size={14} aria-hidden />
          <span>Buscar módulo, cliente, lead o SKU</span>
          <kbd className="lsd-tecla">Ctrl K</kbd>
          <input id={idBusca} style={{ display: 'none' }} readOnly />
        </label>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
          <button type="button" className="lsd-icono-btn" title="Avisos" aria-label="Avisos">
            <Bell size={15} />
          </button>
          <button type="button" className="lsd-icono-btn" title="Raúl Camuñas · admin" aria-label="Tu cuenta">
            <User size={15} />
          </button>
        </div>
      </header>

      <div className="lsd-cuerpo">
        <nav className="lsd-menu" aria-label="Módulos">
          <MenuItems activo={activo} onNavegar={onNavegar} />
        </nav>
        {children}
      </div>
    </div>
  )
}

/**
 * 28 px por módulo contra los 41 de hoy: los 18 caben en unos 700 px y el menú
 * deja de scrollear solo. Hoy mide 1.049 px y en un portátil de 1440×900 se ven
 * once de dieciocho.
 */
function MenuItems({ activo, onNavegar }: { activo: string; onNavegar: (id: string) => void }) {
  return (
    <>
      {MENU.map((app: AppMaqueta) => {
        const Icono = app.icono
        const esActivo = app.id === activo
        return (
          <button
            key={app.id}
            type="button"
            className="lsd-menu-item"
            data-activo={esActivo ? 'si' : 'no'}
            onClick={() => onNavegar(app.id)}
            title={app.descripcion}
          >
            <Icono size={15} strokeWidth={2} aria-hidden />
            <span className="lsd-menu-texto">{app.nombre}</span>
            {/* La única insignia viva del menú, y va en naranja de relleno con
                etiqueta oscura: 6,26:1. Es lo que de verdad pide acción hoy. */}
            {app.vivo ? (
              <span className="lsd-menu-cuenta lsd-sincolor" title={`${app.vivo} sin atender`}>
                {app.vivo}
              </span>
            ) : null}
          </button>
        )
      })}
    </>
  )
}
