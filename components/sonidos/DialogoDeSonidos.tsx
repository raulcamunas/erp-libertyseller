'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { Play, RotateCcw, X } from 'lucide-react'
import { BIBLIOTECA, INTERACCIONES, SIN_SONIDO, sonidoElegidoPara, type FamiliaDeSonido, type Interaccion } from '@/lib/sonidos/biblioteca'
import { dialogoDeSonidosAbierto, ponerDialogoDeSonidos, suscribirDialogoDeSonidos } from '@/lib/sonidos/dialogo'
import { eleccionGuardada, elegirSonido, prepararAudio, reproducirSonido, restablecerSonidos, suscribirEleccion } from '@/lib/sonidos/reproductor'

const GRUPOS: ReadonlyArray<Interaccion['grupo']> = ['Avisos', 'Junta de voz', 'Llamadas']

/** Los sonidos de una familia, por grupos y en el orden del catálogo */
function gruposDe(familia: FamiliaDeSonido) {
  const grupos = new Map<string, typeof BIBLIOTECA[number][]>()
  for (const s of BIBLIOTECA) if (s.familia === familia) grupos.set(s.grupo, [...(grupos.get(s.grupo) ?? []), s])
  return [...grupos.entries()]
}

function Fila({ i }: { i: Interaccion }) {
  const eleccion = useSyncExternalStore(suscribirEleccion, eleccionGuardada, eleccionGuardada)
  const valor = sonidoElegidoPara(eleccion, i.id)
  return (
    <div className="sonidos-fila">
      <span className="sonidos-fila-texto">
        <b>{i.nombre}</b>
        <small>{i.cuando}</small>
      </span>
      <span className="sonidos-fila-mando">
        <select value={valor} onChange={(e) => { elegirSonido(i.id, e.target.value); if (e.target.value !== SIN_SONIDO) void reproducirSonido(e.target.value, i.volumen) }} aria-label={`Sonido: ${i.nombre}`}>
          <option value={SIN_SONIDO}>Silencio (no suena)</option>
          {gruposDe(i.familia).map(([grupo, sonidos]) => (
            <optgroup key={grupo} label={grupo}>
              {sonidos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                  {s.id === i.defecto ? ' · de fábrica' : ''}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button type="button" onClick={() => void reproducirSonido(valor, i.volumen)} disabled={valor === SIN_SONIDO} aria-label={`Escuchar el sonido de: ${i.nombre}`} title="Escuchar">
          <Play className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  )
}

/**
 * LA BIBLIOTECA DE SONIDOS: para cada cosa que suena en el ERP (un mensaje, el correo, entrar a una junta, mutearte, que te llamen…), el sonido que quieres, con botón para escucharlo. Lo elegido
 * se guarda en este navegador y solo lo oyes tú. Se abre desde la campana, la apariencia del chat y los ajustes de audio de la junta (lib/sonidos/dialogo.ts); un solo componente lo pinta.
 */
export function DialogoDeSonidos() {
  const abierto = useSyncExternalStore(suscribirDialogoDeSonidos, dialogoDeSonidosAbierto, () => false)
  useEffect(() => {
    if (!abierto) return
    const quitar = prepararAudio()
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && ponerDialogoDeSonidos(false)
    document.addEventListener('keydown', alTeclear)
    return () => {
      quitar()
      document.removeEventListener('keydown', alTeclear)
    }
  }, [abierto])
  if (!abierto || typeof document === 'undefined') return null
  const cerrar = () => ponerDialogoDeSonidos(false)
  return createPortal(
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && cerrar()}>
      <div className="tc-modal chat-dialogo sonidos-dialogo" role="dialog" aria-modal="true" aria-label="Sonidos">
        <header className="tc-modal-cabecera">
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Sonidos</span>
          <button type="button" onClick={restablecerSonidos} className="tc-icono-boton ml-auto" title="Volver a los sonidos de fábrica" aria-label="Volver a los sonidos de fábrica">
            <RotateCcw className="h-4 w-4" />
          </button>
          <button type="button" onClick={cerrar} aria-label="Cerrar" className="tc-icono-boton">
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="chat-dialogo-cuerpo">
          <p className="sonidos-intro">Elige qué suena en cada caso y pulsa ▶ para escucharlo. Solo lo oyes tú y se guarda en este navegador.</p>
          {GRUPOS.map((g) => (
            <section key={g} className="sonidos-grupo">
              <h3>{g}</h3>
              {INTERACCIONES.filter((i) => i.grupo === g).map((i) => (
                <Fila key={i.id} i={i} />
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>,
    document.body
  )
}
