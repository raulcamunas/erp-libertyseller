'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as EventoDeRaton } from 'react'
import { createPortal } from 'react-dom'
import type { LucideIcon } from 'lucide-react'

/**
 * EL MENÚ DEL CLIC DERECHO, PARA CUALQUIER PANTALLA DEL ERP.
 *
 * `const menu = useMenuContextual()` y en el elemento `onContextMenu={(e) => menu.abrir(e, opciones)}`; después, `{menu.elemento}` en algún
 * sitio del árbol. Se abre donde está el ratón (sin salirse de la ventana), se cierra con Escape, al pulsar fuera, al desplazar o al cambiar
 * de ventana, y se maneja con las flechas y Enter.
 *
 * Respeta el menú del navegador cuando tiene sentido: sobre un enlace, sobre texto seleccionado o en un campo de texto sale el de siempre
 * (copiar, abrir en otra pestaña, corregir), que es lo que se busca ahí.
 */

export interface OpcionDeMenu {
  id: string
  nombre: string
  icono?: LucideIcon
  /** Lo que borra o saca de algo: en rojo */
  peligro?: boolean
  /** Una raya encima, para separar grupos */
  separar?: boolean
  deshabilitada?: boolean
  accion: () => void
}

/** ¿Hay que dejar el menú del navegador? Enlaces, texto seleccionado y campos de texto */
export function quiereElMenuDelNavegador(e: EventoDeRaton | MouseEvent): boolean {
  const destino = e.target as HTMLElement | null
  if (destino?.closest?.('a[href], input, textarea, [contenteditable="true"], select')) return true
  const seleccion = typeof window !== 'undefined' ? window.getSelection() : null
  return Boolean(seleccion && !seleccion.isCollapsed && seleccion.toString().trim())
}

export function useMenuContextual() {
  const [menu, setMenu] = useState<{ x: number; y: number; opciones: OpcionDeMenu[] } | null>(null)
  const cerrar = useCallback(() => setMenu(null), [])
  const abrir = useCallback((e: EventoDeRaton, opciones: OpcionDeMenu[]) => {
    if (quiereElMenuDelNavegador(e)) return
    const utiles = opciones.filter(Boolean)
    if (utiles.length === 0) return
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY, opciones: utiles })
  }, [])
  const elemento = menu ? <MenuContextual x={menu.x} y={menu.y} opciones={menu.opciones} onCerrar={cerrar} /> : null
  return { abrir, cerrar, abierto: menu !== null, elemento }
}

export function MenuContextual({ x, y, opciones, onCerrar }: { x: number; y: number; opciones: OpcionDeMenu[]; onCerrar: () => void }) {
  const caja = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y, visible: false })
  const [activo, setActivo] = useState(-1)

  // Que no se salga de la ventana: si no cabe a la derecha o abajo, se abre hacia el otro lado
  useLayoutEffect(() => {
    const r = caja.current?.getBoundingClientRect()
    if (!r) return
    const margen = 8
    const left = x + r.width + margen > window.innerWidth ? Math.max(margen, x - r.width) : x
    const top = y + r.height + margen > window.innerHeight ? Math.max(margen, y - r.height) : y
    setPos({ left, top, visible: true })
  }, [x, y])

  // Las flechas, Enter y Escape se escuchan en la página: el foco puede seguir donde estaba (un elemento oculto no se deja enfocar)
  const estado = useRef({ activo, opciones })
  estado.current = { activo, opciones }

  useEffect(() => {
    const fuera = (e: PointerEvent) => {
      if (!caja.current?.contains(e.target as Node)) onCerrar()
    }
    const tecla = (e: KeyboardEvent) => {
      const { activo: a, opciones: ops } = estado.current
      if (e.key === 'Escape') {
        e.preventDefault()
        onCerrar()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const habilitadas = ops.map((o, i) => (o.deshabilitada ? -1 : i)).filter((i) => i >= 0)
        if (habilitadas.length === 0) return
        const ahora = habilitadas.indexOf(a)
        const paso = e.key === 'ArrowDown' ? 1 : -1
        setActivo(ahora < 0 ? habilitadas[paso > 0 ? 0 : habilitadas.length - 1] : habilitadas[(ahora + paso + habilitadas.length) % habilitadas.length])
      } else if (e.key === 'Enter' && a >= 0 && !ops[a]?.deshabilitada) {
        e.preventDefault()
        onCerrar()
        ops[a].accion()
      }
    }
    const adios = () => onCerrar()
    document.addEventListener('pointerdown', fuera, true)
    document.addEventListener('keydown', tecla)
    window.addEventListener('blur', adios)
    window.addEventListener('resize', adios)
    window.addEventListener('scroll', adios, true)
    return () => {
      document.removeEventListener('pointerdown', fuera, true)
      document.removeEventListener('keydown', tecla)
      window.removeEventListener('blur', adios)
      window.removeEventListener('resize', adios)
      window.removeEventListener('scroll', adios, true)
    }
  }, [onCerrar])

  const elegir = (o: OpcionDeMenu) => {
    if (o.deshabilitada) return
    onCerrar()
    o.accion()
  }

  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      ref={caja}
      role="menu"
      tabIndex={-1}
      className="menu-contextual"
      style={{ left: pos.left, top: pos.top, visibility: pos.visible ? 'visible' : 'hidden' }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {opciones.map((o, i) => {
        const Icono = o.icono
        return (
          <div key={o.id} role="none">
            {o.separar && i > 0 && <div className="menu-contextual-raya" role="separator" />}
            <button
              type="button"
              role="menuitem"
              disabled={o.deshabilitada}
              data-peligro={o.peligro ? 'true' : undefined}
              data-activo={activo === i ? 'true' : undefined}
              onMouseEnter={() => setActivo(i)}
              onClick={() => elegir(o)}
            >
              {Icono ? <Icono className="h-3.5 w-3.5 shrink-0" /> : <span className="w-3.5 shrink-0" />}
              <span className="truncate">{o.nombre}</span>
            </button>
          </div>
        )
      })}
    </div>,
    document.body
  )
}
