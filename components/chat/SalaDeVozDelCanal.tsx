'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Headphones, Lock, Volume2 } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import type { CanalChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'
import { Cuadro, MandosDeLaJunta, teselasDe } from './PanelDeJunta'

/**
 * LA SALA DE VOZ, ARRIBA DEL CHAT DEL CANAL, COMO EN DISCORD. Al abrir un canal de voz se ve primero quién está dentro (cuadros con su cara o su cámara, un aro verde en quien habla, el micrófono tachado
 * en quien lo tiene apagado, y la pantalla compartida en grande) con los mandos debajo; más abajo, el chat de texto del canal. Si no estás dentro, se ve quién está y un botón para unirte; si la
 * sala tiene candado, el botón llama a la puerta. Se puede plegar para dejar todo el sitio al chat.
 */
export function SalaDeVozDelCanal({ canal }: { canal: CanalChat }) {
  const { actual, room, version, entrar, activas, disponible, bloqueada, esperandoPuerta } = useJunta()
  const { enVoz, conectados, yo, nombreDe } = useChat()
  const [plegada, setPlegada] = useState(false)
  void version
  const dentroAqui = actual?.canalId === canal.id
  const conectada = dentroAqui && actual?.estado === 'conectada'
  const conCandado = bloqueada(canal.id)
  const { gente, teselas, hayPantalla } = teselasDe(dentroAqui ? room : null)
  // Quién está dentro ahora: la presencia (al instante) y, si no hay, lo que dice LiveKit
  const base = conectados.size > 0 ? enVoz[canal.id] ?? [] : activas[canal.id]?.personas ?? []
  const otros = [...new Set(base)].filter((id) => dentroAqui || id !== yo.id)
  const cuenta = dentroAqui ? gente.length : otros.length
  const llamando = esperandoPuerta === canal.id
  const puedeEntrar = disponible && canal.soy_miembro

  return (
    <section className="sala-voz" data-plegada={plegada ? 'true' : undefined} data-con-pantalla={hayPantalla ? 'true' : undefined} aria-label={`Sala de voz ${canal.nombre}`}>
      <header className="sala-voz-cabecera">
        <Headphones className="h-4 w-4 text-[var(--ls-e-verde)]" />
        <b>Sala de voz</b>
        <span>{cuenta === 0 ? 'Nadie dentro' : `${cuenta} ${cuenta === 1 ? 'persona' : 'personas'}`}</span>
        {conCandado && (
          <span className="sala-voz-candado" title="La sala tiene candado: para entrar hay que llamar a la puerta">
            <Lock className="h-3 w-3" /> Con candado
          </span>
        )}
        <button type="button" className="chat-icono ml-auto" onClick={() => setPlegada((p) => !p)} aria-label={plegada ? 'Desplegar la sala de voz' : 'Plegar la sala de voz'} title={plegada ? 'Desplegar' : 'Plegar para ver solo el chat'}>
          {plegada ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </header>

      {!plegada && (
        <>
          <div className="sala-voz-cuadros">
            {dentroAqui ? (
              teselas.length === 0 ? (
                <div className="tc-esqueleto h-full w-full" role="status" aria-label="Conectando" />
              ) : (
                teselas.map((t, i) => <Cuadro key={t.clave} t={t} foco={hayPantalla && i === 0} />)
              )
            ) : otros.length > 0 ? (
              otros.map((id) => (
                <div key={id} className="chat-tesela">
                  <span className="chat-tesela-avatar"><Avatar id={id} nombre={nombreDe(id)} tamano={64} /></span>
                  <span className="chat-tesela-nombre">{nombreDe(id)}</span>
                </div>
              ))
            ) : (
              <p className="sala-voz-vacia">
                <Volume2 className="h-5 w-5" />
                Nadie en la sala. Entra tú el primero.
              </p>
            )}
          </div>

          {dentroAqui ? (
            <MandosDeLaJunta canalId={canal.id} />
          ) : puedeEntrar ? (
            <div className="sala-voz-unirse">
              <button type="button" className="tc-boton-primario" onClick={() => void entrar(canal.id)} disabled={llamando || (actual?.estado === 'conectando')}>
                {llamando ? 'Esperando a que te dejen entrar…' : conCandado ? <><Lock className="mr-1.5 inline h-3.5 w-3.5" />Llamar a la puerta</> : actual ? 'Cambiar a esta sala' : 'Unirme a la voz'}
              </button>
              {conCandado && !llamando && <small>Esta sala tiene candado: quienes están dentro decidirán si te dejan pasar.</small>}
            </div>
          ) : null}
        </>
      )}
      {conectada && plegada && <span className="sr-only">Estás conectado a la sala de voz</span>}
    </section>
  )
}
