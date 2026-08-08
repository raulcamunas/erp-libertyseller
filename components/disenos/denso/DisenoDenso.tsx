'use client'

import { useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useEstilosDenso, type Tema } from './Marco'
import { PantallaInicio } from './PantallaInicio'
import { PantallaColdCalling } from './PantallaColdCalling'
import { PantallaPerfil } from './PantallaPerfil'

export type PantallaDenso = 'inicio' | 'cold-calling' | 'perfil'

const PANTALLAS: { id: PantallaDenso; nombre: string; ruta: string }[] = [
  { id: 'inicio', nombre: 'Inicio', ruta: '/dashboard' },
  { id: 'cold-calling', nombre: 'Cold Calling', ruta: '/dashboard/cold-calling' },
  { id: 'perfil', nombre: 'Perfil de stock', ruta: '/dashboard/amazon-api' },
]

/** Alturas de ventana reales del equipo, medidas en el informe de diagnóstico */
const ALTURAS: { alto: number; nombre: string; nota: string }[] = [
  { alto: 1080, nombre: '1080', nota: 'monitor a pantalla completa' },
  { alto: 940, nombre: '940', nota: 'monitor 1920×1080 con Chrome' },
  { alto: 780, nombre: '780', nota: 'portátil 1440×900 con Chrome' },
]

/**
 * El conmutador de la propuesta «Denso y sobrio».
 *
 * Trae encima un regulador de altura de ventana porque la densidad no se
 * discute con adjetivos: se pone la tabla a 780 px, que es lo que tiene un
 * portátil de un comercial, y se cuentan las filas. La cuenta que aparece
 * arriba a la derecha de Cold Calling está medida en el DOM en ese momento.
 */
export function DisenoDenso({
  pantallaInicial = 'cold-calling',
  temaInicial = 'oscuro',
}: {
  pantallaInicial?: PantallaDenso
  temaInicial?: Tema
}) {
  useEstilosDenso()
  const [tema, setTema] = useState<Tema>(temaInicial)
  const [pantalla, setPantalla] = useState<PantallaDenso>(pantallaInicial)
  const [alto, setAlto] = useState<number | null>(940)

  return (
    <div className="dz-raiz" data-dz-tema={tema} style={{ padding: 12, borderRadius: 12 }}>
      {/* ---------- Regulador de la maqueta ---------- */}
      <div className="dz-regla">
        <div className="dz-ops">
          {PANTALLAS.map((p) => (
            <button
              key={p.id}
              type="button"
              data-on={pantalla === p.id ? '1' : undefined}
              onClick={() => setPantalla(p.id)}
              title={p.ruta}
            >
              {p.nombre}
            </button>
          ))}
        </div>

        <span className="dz-sep" aria-hidden />

        <div className="dz-ops" title="Altura de ventana simulada">
          {ALTURAS.map((a) => (
            <button
              key={a.alto}
              type="button"
              data-on={alto === a.alto ? '1' : undefined}
              onClick={() => setAlto(a.alto)}
              title={a.nota}
            >
              {a.nombre}
            </button>
          ))}
          <button
            type="button"
            data-on={alto === null ? '1' : undefined}
            onClick={() => setAlto(null)}
            title="Usa el alto que haya"
          >
            Ventana
          </button>
        </div>

        <span className="dz-crece" />

        <span className="dz-regla-tag">
          Hoy en esta altura: <b>{alto === 1080 ? 19 : alto === 780 ? 10 : 15}</b> filas
        </span>

        <button type="button" className="dz-btn" onClick={() => setTema(tema === 'oscuro' ? 'claro' : 'oscuro')}>
          {tema === 'oscuro' ? <Sun aria-hidden /> : <Moon aria-hidden />}
          {tema === 'oscuro' ? 'Ver en claro' : 'Ver en oscuro'}
        </button>
      </div>

      {/* ---------- La maqueta ---------- */}
      <div
        className="dz-marco"
        style={alto ? { height: alto } : { height: 'min(78vh, 900px)' }}
      >
        {pantalla === 'inicio' && <PantallaInicio />}
        {pantalla === 'cold-calling' && <PantallaColdCalling />}
        {pantalla === 'perfil' && <PantallaPerfil />}
      </div>
    </div>
  )
}
