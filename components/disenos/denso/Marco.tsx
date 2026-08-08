'use client'

import { useEffect } from 'react'
import { Home, type LucideIcon } from 'lucide-react'
import { ESTILOS_DENSO } from './estilos'
import { GRUPOS_APPS } from './datos'

/**
 * El armazón: hoja de estilo, tema y barra lateral.
 *
 * La hoja se inyecta una sola vez en un `<style>` con id propio. Todo lo que
 * hay dentro va prefijado con `dz-` y colgando de `.dz-raiz`, así que no toca
 * nada del ERP ni de las otras dos propuestas.
 */
export function useEstilosDenso() {
  useEffect(() => {
    const ID = 'dz-estilos'
    if (document.getElementById(ID)) return
    const el = document.createElement('style')
    el.id = ID
    el.textContent = ESTILOS_DENSO
    document.head.appendChild(el)
  }, [])
}

export type Tema = 'oscuro' | 'claro'

/* ------------------------------------------------------------------ */
/* Barra lateral                                                       */
/* ------------------------------------------------------------------ */

interface ItemNav {
  id: string
  nombre: string
  icono: LucideIcon
  marca?: number
}

/**
 * 208 px de ancho y 26 px por módulo.
 *
 * La de hoy mide 256 de ancho y 41 por ítem, y con los dieciocho módulos suma
 * 1.049 px de alto: por debajo de esa altura de ventana la propia barra lateral
 * scrollea, y en un portátil de 1440×900 se ven once de dieciocho. Esta suma
 * 38 (cabecera) + 4 grupos × 20 + 18 ítems × 26 + separaciones ≈ 604 px, así
 * que cabe entera en cualquier pantalla del equipo.
 */
export function BarraLateral({ activo }: { activo: string }) {
  const grupos: { grupo: string; items: ItemNav[] }[] = [
    { grupo: '', items: [{ id: 'home', nombre: 'Inicio', icono: Home }] },
    ...GRUPOS_APPS.map((g) => ({
      grupo: g.grupo,
      items: g.apps.map((a) => ({ id: a.id, nombre: a.nombre, icono: a.icono, marca: a.marca })),
    })),
  ]

  return (
    <nav className="dz-side" aria-label="Módulos">
      <div className="dz-side-cab">
        <span className="dz-logo" aria-hidden />
        <span className="dz-l" style={{ letterSpacing: '-0.01em' }}>
          Liberty Seller
        </span>
      </div>
      <div className="dz-side-nav">
        {grupos.map((g, i) => (
          <div key={g.grupo || `g${i}`}>
            {g.grupo && <div className="dz-grupo">{g.grupo}</div>}
            {g.items.map((it) => {
              const Icono = it.icono
              const on = it.id === activo
              return (
                <button
                  key={it.id}
                  type="button"
                  className="dz-nav"
                  data-on={on ? '1' : undefined}
                  aria-current={on ? 'page' : undefined}
                >
                  <Icono aria-hidden />
                  <span className="dz-crece">{it.nombre}</span>
                  {/* La única insignia naranja del menú: lo que está sin leer.
                      Hoy también es la única, y es lo correcto — lo que cambia
                      esta propuesta es que deje de competir con dieciocho
                      iconos naranjas idénticos en la pantalla de al lado. */}
                  {it.marca ? <span className="dz-marca">{it.marca}</span> : null}
                </button>
              )
            })}
          </div>
        ))}
      </div>
      <div className="dz-side-pie">
        <button type="button" className="dz-nav">
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: 'var(--dz-linea2)',
              flex: '0 0 14px',
            }}
          />
          <span className="dz-crece">Raúl Camuñas</span>
          <span className="dz-xs dz-t4">admin</span>
        </button>
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Barra superior                                                      */
/* ------------------------------------------------------------------ */

/**
 * 38 px, y dentro va TODO el cromo de cabecera.
 *
 * Hoy no hay cabecera: hay dos iconos flotando en `position: fixed` sobre el
 * contenido y, dentro de cada pantalla, un `<h1>` de 36 px con su párrafo
 * debajo que se come entre 76 y 79 px de cada pantalla, siempre con el mismo
 * peso y siempre por encima de los datos. El título de pantalla no es el dato:
 * ya sabes en qué módulo estás porque lo dice la barra lateral.
 */
export function BarraSuperior({
  titulo,
  contexto,
  children,
}: {
  titulo: string
  contexto?: string
  children?: React.ReactNode
}) {
  return (
    <div className="dz-top">
      <span className="dz-l">{titulo}</span>
      {contexto && (
        <>
          <span className="dz-sep" aria-hidden />
          <span className="dz-s dz-num">{contexto}</span>
        </>
      )}
      <span className="dz-crece" />
      {children}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Estado con forma antes que color                                    */
/* ------------------------------------------------------------------ */

/**
 * La pieza que resuelve el criterio 5.
 *
 * Orden de lectura: GLIFO → PALABRA → color. El color va en una variable CSS
 * local (`--dz-c`) y solo lo lleva el icono. Tapa el color con la mano y la
 * pantalla sigue diciendo lo mismo.
 */
export function Estado({
  icono: Icono,
  color,
  texto,
  titulo,
  fuerte,
}: {
  icono: LucideIcon
  color: string
  texto: string
  titulo?: string
  fuerte?: boolean
}) {
  return (
    <span
      className={`dz-est${fuerte ? ' dz-est--fuerte' : ''}`}
      style={{ ['--dz-c' as string]: color }}
      title={titulo}
    >
      <Icono aria-hidden />
      <b>{texto}</b>
    </span>
  )
}

export function Pildora({
  icono: Icono,
  color,
  texto,
  titulo,
}: {
  icono: LucideIcon
  color: string
  texto: string
  titulo?: string
}) {
  return (
    <span className="dz-pil" style={{ ['--dz-c' as string]: color }} title={titulo}>
      <Icono aria-hidden />
      {texto}
    </span>
  )
}
