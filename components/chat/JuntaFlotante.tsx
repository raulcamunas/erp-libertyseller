'use client'

import { useState } from 'react'
import { usePathname } from 'next/navigation'
import type { Participant } from 'livekit-client'
import { HeadphoneOff, Headphones, Maximize2, Mic, MicOff, MonitorUp, PhoneOff, Settings2, Volume2, VolumeX } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible } from '@/lib/chat/canales'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'
import { AjustesDeAudioPanel, BotonDeCandado, PanelDeJunta } from './PanelDeJunta'

/** Cuántas caras caben en la cápsula; el resto va en un «+N» */
const MAX_CARAS = 4

/**
 * LA JUNTA EN CURSO, EN PEQUEÑO, JUNTO A LA PASTILLA DEL CHAT: una cápsula con quién está dentro (con un aro verde en quien habla y un micrófono tachado en quien lo tiene apagado), tu micrófono,
 * ensordecer, los ajustes de audio, «ver la junta» (la ventana grande, con cámaras y pantalla compartida) y salir. Pulsar la cara de alguien deja silenciarlo o subirle y bajarle el volumen
 * (solo para ti).
 *
 * VIVE EN EL LAYOUT DE TODO EL ERP (ProveedoresDelChat), igual que la conexión: cambiar de pantalla o de pestaña no la corta. En la pantalla del Chat no se pinta la cápsula (allí la barra de la
 * izquierda ya tiene «Voz conectada» con sus mandos), pero sí la ventana grande si se ha abierto.
 */
export function JuntaFlotante() {
  const ruta = usePathname() ?? ''
  const { actual, room, version, salir, alternarMicro, ensordecido, alternarEnsordecer, vistaGrande, ponerVistaGrande, volumenes, ponerVolumen, puedePantalla } = useJunta()
  const { canales, yo, persona, nombreDe } = useChat()
  const [ajustes, setAjustes] = useState(false)
  const [abierta, setAbierta] = useState<string | null>(null)
  void version
  if (!actual) return null
  if (vistaGrande) return <PanelDeJunta />
  if (ruta.startsWith('/dashboard/chat')) return null

  const canal = canales.find((c) => c.id === actual.canalId)
  const nombre = canal ? nombreVisible(canal, yo.id, persona) : 'Junta'
  const lp = room?.localParticipant
  const gente: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : []
  // Primero quien habla, para que su cara no se quede fuera del «+N»
  const ordenada = [...gente].sort((a, b) => Number(b.isSpeaking) - Number(a.isSpeaking))
  const caras = ordenada.slice(0, MAX_CARAS)
  const resto = Math.max(0, gente.length - caras.length)
  const quienHabla = gente.filter((p) => p.isSpeaking && p.identity !== yo.id)
  const hayPantalla = gente.some((p) => p.isScreenShareEnabled)
  const microApagado = lp ? !lp.isMicrophoneEnabled : false
  const conectando = actual.estado === 'conectando'
  const linea = conectando
    ? 'Conectando…'
    : quienHabla.length > 0
      ? `${nombreDe(quienHabla[0].identity).split(' ')[0]}${quienHabla.length > 1 ? ` y ${quienHabla.length - 1} más` : ''} hablando`
      : `${gente.length} ${gente.length === 1 ? 'persona' : 'personas'}`
  const persona_ = abierta ? gente.find((p) => p.identity === abierta) ?? null : null
  const volumenDe = persona_ ? (volumenes[persona_.identity] ?? 1) : 1

  return (
    <section className="junta-capsula" role="region" aria-label={`Junta en ${nombre}`} data-hablando={quienHabla.length > 0 ? 'true' : undefined}>
      <span className="junta-capsula-estado">
        <Headphones className="h-4 w-4" />
        <span>
          <b>{nombre}</b>
          <i>{linea}</i>
        </span>
      </span>

      <span className="junta-capsula-caras">
        {caras.map((p) => {
          const mio = p.identity === yo.id
          return (
            <button
              key={p.identity}
              type="button"
              className="junta-cara"
              data-habla={p.isSpeaking ? 'true' : undefined}
              data-abierta={abierta === p.identity ? 'true' : undefined}
              onClick={() => (mio ? undefined : setAbierta((a) => (a === p.identity ? null : p.identity)))}
              aria-label={mio ? 'Tú' : `${nombreDe(p.identity)}: volumen`}
              title={mio ? 'Tú' : `${nombreDe(p.identity)} · pulsa para ajustar su volumen`}
              tabIndex={mio ? -1 : 0}
            >
              <Avatar id={p.identity} nombre={nombreDe(p.identity)} tamano={26} />
              {!p.isMicrophoneEnabled && (
                <span className="junta-cara-mute" aria-label="Micrófono apagado">
                  <MicOff className="h-2.5 w-2.5" />
                </span>
              )}
            </button>
          )
        })}
        {resto > 0 && <span className="junta-mas">+{resto}</span>}
        {hayPantalla && (
          <button type="button" className="junta-pantalla" onClick={() => ponerVistaGrande(true)} aria-label="Alguien comparte pantalla: ver la junta" title="Alguien comparte pantalla: ver la junta">
            <MonitorUp className="h-3.5 w-3.5" />
          </button>
        )}
      </span>

      <span className="junta-capsula-mandos">
        <button type="button" onClick={() => void alternarMicro()} data-apagado={microApagado ? 'true' : undefined} aria-pressed={!microApagado} aria-label={microApagado ? 'Activar el micrófono' : 'Silenciar el micrófono'} title={microApagado ? 'Activar el micrófono' : 'Silenciar el micrófono'}>
          {microApagado ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => void alternarEnsordecer()} data-apagado={ensordecido ? 'true' : undefined} aria-pressed={ensordecido} aria-label={ensordecido ? 'Volver a oír' : 'Ensordecer'} title={ensordecido ? 'Volver a oír' : 'Ensordecer: dejar de oír a todos'}>
          {ensordecido ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        </button>
        <BotonDeCandado canalId={actual.canalId} />
        <button type="button" data-abre-ajustes-audio data-activo={ajustes ? 'true' : undefined} onClick={() => setAjustes((a) => !a)} aria-expanded={ajustes} aria-label="Ajustes de audio" title="Ajustes de audio: ruido, eco, micrófono y altavoz">
          <Settings2 className="h-4 w-4" />
        </button>
        <button type="button" onClick={() => ponerVistaGrande(true)} aria-label="Ver la junta en grande" title={puedePantalla ? 'Ver la junta en grande (cámaras y pantalla compartida)' : 'Ver la junta en grande'}>
          <Maximize2 className="h-4 w-4" />
        </button>
        <button type="button" className="junta-colgar" onClick={salir} aria-label="Salir de la junta" title="Salir de la junta">
          <PhoneOff className="h-4 w-4" />
        </button>
      </span>

      {persona_ && (
        <div className="junta-persona" role="dialog" aria-label={`Volumen de ${nombreDe(persona_.identity)}`}>
          <b>{nombreDe(persona_.identity)}</b>
          <span>
            <button
              type="button"
              onClick={() => ponerVolumen(persona_.identity, volumenDe === 0 ? 1 : 0)}
              data-silenciada={volumenDe === 0 ? 'true' : undefined}
              aria-label={volumenDe === 0 ? `Dejar de silenciar a ${nombreDe(persona_.identity)}` : `Silenciar a ${nombreDe(persona_.identity)} (solo para ti)`}
              title={volumenDe === 0 ? 'Dejar de silenciar' : 'Silenciar (solo para ti)'}
            >
              {volumenDe === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input type="range" min={0} max={100} value={Math.round(volumenDe * 100)} onChange={(e) => ponerVolumen(persona_.identity, Number(e.target.value) / 100)} aria-label={`Volumen de ${nombreDe(persona_.identity)}`} />
          </span>
          <small>Solo cambia lo que oyes tú</small>
        </div>
      )}
      {ajustes && (
        <div className="junta-ajustes">
          <AjustesDeAudioPanel onCerrar={() => setAjustes(false)} />
        </div>
      )}
    </section>
  )
}
