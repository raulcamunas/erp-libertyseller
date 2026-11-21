'use client'

import Link from 'next/link'
import type { MouseEvent } from 'react'
import { Home, Menu, type LucideIcon } from 'lucide-react'

/**
 * LA BARRA DE PESTAÑAS DE ABAJO, EN EL MÓVIL: Inicio, tres aplicaciones (las fijadas o las que más usa esa persona; lib/movil/pestanas.ts) y «Más», que
 * abre el menú completo como una hoja desde abajo (la misma barra lateral de siempre, con otro CSS).
 *
 * La pinta AppSidebar, que ya sabe qué ve cada persona, cuál está encendida y cuánto hay sin leer: aquí no se decide ningún permiso. Se esconde desde `lg`,
 * con el teclado abierto y en las pantallas a pantalla completa (Chat, Tareas), que tienen su propio pie. El aspecto, en el bloque «MÓVIL · SENSACIÓN
 * DE APP» de app/globals.css (`barra-inferior`).
 */
export interface PestanaDeLaBarra {
  id: string
  nombre: string
  ruta: string
  icono: LucideIcon
  insignia?: string | null
  urgente?: boolean
}

export function BarraInferior({
  pestanas,
  huecos = 0,
  rutaActiva,
  enInicio,
  masAbierto,
  alPulsar,
  alPulsarMas,
}: {
  pestanas: readonly PestanaDeLaBarra[]
  /** Sitios vacíos mientras se eligen las pestañas (para que la barra no cambie de forma) */
  huecos?: number
  rutaActiva: string | null
  enInicio: boolean
  masAbierto: boolean
  alPulsar: (ruta: string) => void
  alPulsarMas: () => void
}) {
  const algunaEncendida = enInicio || pestanas.some((p) => p.ruta === rutaActiva)
  // «Más» se enciende con la hoja abierta o estando en una aplicación que no tiene pestaña (como en el iPhone)
  const masEncendido = masAbierto || !algunaEncendida

  const pulsar = (ruta: string, activa: boolean) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
    // Tocar la pestaña en la que ya se está, en su pantalla principal, sube al principio (como en las aplicaciones del teléfono) sin volver a cargarla.
    // Desde una subpantalla (/dashboard/crm/123) sí navega a la principal de esa aplicación.
    if (activa && window.location.pathname === ruta) {
      e.preventDefault()
      window.scrollTo({ top: 0, behavior: 'smooth' })
      // Las pantallas de altura fija (Cold Calling, Correo, Agenda…) hacen scroll dentro de su propia caja
      document.querySelectorAll<HTMLElement>('[data-app-persistente] *, .pagina-de-ruta *').forEach((el) => {
        if (el.scrollTop > 0 && el.scrollHeight > el.clientHeight) el.scrollTo({ top: 0, behavior: 'smooth' })
      })
      return
    }
    alPulsar(ruta)
  }

  const pestana = (id: string, nombre: string, ruta: string, Icono: LucideIcon, activa: boolean, insignia?: string | null, urgente?: boolean) => (
    <Link key={id} href={ruta} className="bi-pestana" data-activa={activa ? 'true' : undefined} aria-current={activa ? 'page' : undefined} onClick={pulsar(ruta, activa)}>
      <span className="bi-icono">
        <Icono aria-hidden />
        {insignia && (
          <span className="bi-insignia" data-urgente={urgente ? 'true' : undefined}>
            {insignia}
          </span>
        )}
      </span>
      <span className="bi-nombre">{nombre}</span>
      {insignia && <span className="sr-only">, {insignia} sin leer</span>}
    </Link>
  )

  return (
    <nav className="barra-inferior lg:hidden" aria-label="Aplicaciones principales">
      {pestana('home', 'Inicio', '/dashboard', Home, enInicio && !masAbierto)}
      {pestanas.map((p) => pestana(p.id, p.nombre, p.ruta, p.icono, !masAbierto && p.ruta === rutaActiva, p.insignia, p.urgente))}
      {Array.from({ length: huecos }, (_, i) => (
        <span key={`hueco-${i}`} className="bi-pestana" aria-hidden />
      ))}
      <button type="button" className="bi-pestana" data-activa={masEncendido ? 'true' : undefined} aria-expanded={masAbierto} aria-haspopup="dialog" onClick={alPulsarMas}>
        <span className="bi-icono">
          <Menu aria-hidden />
        </span>
        <span className="bi-nombre">Más</span>
      </button>
    </nav>
  )
}
