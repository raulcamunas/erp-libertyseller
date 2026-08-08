'use client'

import { useEffect } from 'react'
import { Bell, LogOut, Moon, Sun, Users } from 'lucide-react'
import { ESTILOS_HOY } from './estilos'
import { MODULOS_HOY, LEADS_SIN_LEER } from './datos'

export type TemaHoy = 'oscuro' | 'claro'

/**
 * La hoja de la réplica se inyecta una vez en un `<style>` con id propio, igual
 * que hace la propuesta «denso». No toca app/globals.css: todo cuelga de
 * `.hoy-raiz`.
 */
export function useEstilosHoy() {
  useEffect(() => {
    const ID = 'hoy-estilos'
    if (document.getElementById(ID)) return
    const el = document.createElement('style')
    el.id = ID
    el.textContent = ESTILOS_HOY
    document.head.appendChild(el)
  }, [])
}

/**
 * LA BARRA LATERAL DE HOY, medida: 256 px de ancho, ítems de 41 px, y con los
 * 18 módulos suma 1.049 px de alto. Por debajo de esa altura de ventana scrollea
 * sola: en un portátil de 1440×900 se ven once de dieciocho.
 *
 * La única insignia viva del ERP es la de CRM Leads Web, y es correcta. El
 * problema no es ella: es que compite con dieciocho iconos naranjas idénticos en
 * la pantalla de al lado.
 */
export function BarraLateralHoy({ activo }: { activo: string }) {
  return (
    <nav className="hoy-side" aria-label="Módulos">
      <div className="hoy-side-cab">
        <span className="hoy-logo" aria-hidden>
          LS
        </span>
        <span style={{ fontSize: 15, fontWeight: 700 }}>Liberty Seller</span>
      </div>

      <div className="hoy-side-nav">
        {MODULOS_HOY.map((app) => {
          const Icono = app.icon
          const on = app.id === activo
          return (
            <button
              key={app.id}
              type="button"
              className="hoy-nav"
              data-on={on ? '1' : undefined}
              aria-current={on ? 'page' : undefined}
            >
              <Icono aria-hidden />
              <span className="hoy-nav-texto">{app.name}</span>
              {app.id === 'web-leads' && <span className="hoy-insignia">{LEADS_SIN_LEER}</span>}
            </button>
          )
        })}
      </div>

      <div className="hoy-side-pie">
        <button type="button" className="hoy-nav">
          <Users aria-hidden />
          <span className="hoy-nav-texto">Gestión de usuarios</span>
        </button>
        <button type="button" className="hoy-nav">
          <LogOut aria-hidden />
          <span className="hoy-nav-texto">Cerrar sesión</span>
        </button>
      </div>
    </nav>
  )
}

/**
 * EL ARMAZÓN DE HOY. No hay cabecera: hay dos iconos en `position: fixed` sobre
 * el contenido, sin contenedor ni fondo. No hay título de página, ni migas, ni
 * avatar, ni buscador global (0 resultados de `cmdk`, `CommandPalette` o
 * `Ctrl+K` en el repositorio). El único punto de entrada a un módulo es la barra
 * lateral o la rejilla de inicio.
 *
 * Aquí los dos iconos van en `absolute` y no en `fixed` porque la maqueta está
 * dentro de una caja escalada; el sitio y el tamaño son los mismos.
 */
export function MarcoHoy({
  tema,
  activo,
  scroll = true,
  children,
}: {
  tema: TemaHoy
  activo: string
  /** false en las pantallas cuyo scroll vive dentro de la tabla */
  scroll?: boolean
  children: React.ReactNode
}) {
  useEstilosHoy()

  return (
    <div className="hoy-raiz" data-hoy-tema={tema}>
      <BarraLateralHoy activo={activo} />
      <div className="hoy-main">
        <div className="hoy-flotantes">
          <span className="hoy-flotante" aria-hidden>
            {tema === 'oscuro' ? <Sun /> : <Moon />}
          </span>
          <span className="hoy-flotante" aria-hidden>
            <Bell />
          </span>
        </div>
        <div className="hoy-lienzo" data-scroll={scroll ? 'si' : 'no'}>
          {children}
        </div>
      </div>
    </div>
  )
}

/** El bloque de título que repite cada pantalla: 36 px + párrafo = 76-79 px */
export function TituloHoy({ titulo, sub }: { titulo: string; sub: string }) {
  return (
    <div style={{ marginBottom: 12, flex: '0 0 auto' }}>
      <h1 className="hoy-h1">{titulo}</h1>
      <p className="hoy-sub">{sub}</p>
    </div>
  )
}
