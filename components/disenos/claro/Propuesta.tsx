'use client'

/**
 * PROPUESTA «CLARO Y NÍTIDO» — el envoltorio con el que se compara.
 *
 * La barra de arriba del todo NO es parte del diseño: es el mando para poder
 * mirar las tres pantallas en los dos modos y, sobre todo, para apagar el color
 * y comprobar que los estados se siguen leyendo. Al montar esto dentro de una
 * app del ERP, esa barra es lo primero que se cae.
 */

import { useState } from 'react'
import { Contrast, Droplet, Moon, Sun } from 'lucide-react'
import { Marco, type Modo } from './Marco'
import { PantallaInicio } from './PantallaInicio'
import { PantallaColdCalling } from './PantallaColdCalling'
import { PantallaPerfil } from './PantallaPerfil'
import { Ficha } from './Ficha'

type Vista = 'inicio' | 'cold' | 'perfil' | 'ficha'

const VISTAS: { id: Vista; etiqueta: string }[] = [
  { id: 'inicio', etiqueta: 'Inicio' },
  { id: 'cold', etiqueta: 'Cold Calling' },
  { id: 'perfil', etiqueta: 'Perfil de stock' },
  { id: 'ficha', etiqueta: 'La ficha del diseño' },
]

/** Qué módulo del menú se pinta activo en cada vista */
const MODULO: Record<Vista, string> = {
  inicio: 'home',
  cold: 'cold-calling',
  perfil: 'amazon-api',
  ficha: 'home',
}

export default function Propuesta() {
  const [vista, setVista] = useState<Vista>('cold')
  const [modo, setModo] = useState<Modo>('claro')
  const [sinColor, setSinColor] = useState(false)

  function navegar(id: string) {
    if (id === 'home') setVista('inicio')
    else if (id === 'cold-calling') setVista('cold')
    else if (id === 'amazon-api' || id === 'stock-sync') setVista('perfil')
  }

  return (
    <div
      className="lsd-raiz"
      data-modo={modo}
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      {/* ---------- El mando ---------- */}
      <div className="lsd-mando">
        <span className="lsd-mando-et">Claro y nítido</span>
        <span className="lsd-mando-sep" />

        {VISTAS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="lsd-chip"
            data-on={vista === v.id ? 'si' : 'no'}
            onClick={() => setVista(v.id)}
          >
            {v.etiqueta}
          </button>
        ))}

        <span className="lsd-mando-sep" />

        <button
          type="button"
          className="lsd-chip"
          onClick={() => setModo(modo === 'claro' ? 'oscuro' : 'claro')}
          title="El modo principal de esta propuesta es el CLARO"
        >
          {modo === 'claro' ? <Sun size={13} aria-hidden /> : <Moon size={13} aria-hidden />}
          {modo === 'claro' ? 'Claro (principal)' : 'Oscuro (alternativo)'}
        </button>

        {/* La prueba del criterio 5: si al quitar el color se sigue sabiendo
            qué es cada estado, el color no era el único canal. */}
        <button
          type="button"
          className="lsd-chip"
          data-on={sinColor ? 'si' : 'no'}
          onClick={() => setSinColor(!sinColor)}
          title="Pinta en gris todo lo que lleva color de estado: si se sigue leyendo, el color no era el único canal"
        >
          {sinColor ? <Droplet size={13} aria-hidden /> : <Contrast size={13} aria-hidden />}
          Sin color
        </button>

        <span className="lsd-tenue" style={{ marginLeft: 'auto' }}>
          Fondo papel · tres niveles de tinta · el naranja, partido en dos usos
        </span>
      </div>

      {/* ---------- La propuesta ---------- */}
      <div style={{ flex: 1, minHeight: 0 }}>
        {vista === 'ficha' ? (
          <Marco modo={modo} sinColor={sinColor} activo={MODULO[vista]} onNavegar={navegar}>
            <Ficha />
          </Marco>
        ) : (
          <Marco modo={modo} sinColor={sinColor} activo={MODULO[vista]} onNavegar={navegar}>
            {vista === 'inicio' && <PantallaInicio onNavegar={navegar} />}
            {vista === 'cold' && <PantallaColdCalling />}
            {vista === 'perfil' && <PantallaPerfil />}
          </Marco>
        )}
      </div>
    </div>
  )
}
