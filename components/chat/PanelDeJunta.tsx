'use client'

import { useEffect, useRef, useState } from 'react'
import { Track, type Participant, type TrackPublication } from 'livekit-client'
import { Headphones, Maximize2, Mic, MicOff, Minimize2, MonitorUp, MonitorX, PhoneOff, Video, VideoOff } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible } from '@/lib/chat/canales'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'

/** Un vídeo (cámara o pantalla) pegado a su elemento: se desengancha solo al cambiar o irse */
function Imagen({ pub, silenciado }: { pub: TrackPublication; silenciado?: boolean }) {
  const el = useRef<HTMLVideoElement>(null)
  const track = pub.track
  useEffect(() => {
    const v = el.current
    if (!v || !track) return
    track.attach(v)
    return () => {
      track.detach(v)
    }
  }, [track])
  return <video ref={el} autoPlay playsInline muted={silenciado} />
}

interface Tesela {
  clave: string
  persona: Participant
  /** Si es la pantalla compartida de esa persona */
  pantalla: boolean
  pub: TrackPublication | null
}

function Cuadro({ t, foco }: { t: Tesela; foco?: boolean }) {
  const { yo, nombreDe } = useChat()
  const nombre = nombreDe(t.persona.identity)
  const habla = t.persona.isSpeaking && !t.pantalla
  return (
    <div className="chat-tesela" data-foco={foco ? 'true' : undefined} data-habla={habla ? 'true' : undefined} data-pantalla={t.pantalla ? 'true' : undefined}>
      {t.pub?.track && !t.pub.isMuted ? <Imagen pub={t.pub} silenciado={t.persona.identity === yo.id || t.pantalla} /> : (
        <span className="chat-tesela-avatar"><Avatar id={t.persona.identity} nombre={nombre} tamano={foco ? 88 : 64} /></span>
      )}
      <span className="chat-tesela-nombre">
        {!t.pantalla && !t.persona.isMicrophoneEnabled && <MicOff className="h-3 w-3" aria-label="Micrófono apagado" />}
        {t.pantalla ? `Pantalla de ${nombre}` : t.persona.identity === yo.id ? `${nombre} (tú)` : nombre}
      </span>
    </div>
  )
}

/** La junta en curso: cuadros de cada persona, quien comparte pantalla en grande, y los mandos. Se queda abierta aunque cambies de canal */
export function PanelDeJunta() {
  const { actual, room, version, salir, alternarMicro, alternarCamara, alternarPantalla, puedePantalla } = useJunta()
  const { canales, yo, persona } = useChat()
  const [grande, setGrande] = useState(false)
  void version
  if (!actual) return null
  const canal = canales.find((c) => c.id === actual.canalId)
  const nombre = canal ? nombreVisible(canal, yo.id, persona) : 'Junta'
  const lp = room?.localParticipant
  const gente: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : []
  const teselas: Tesela[] = []
  for (const p of gente) {
    const pantalla = p.getTrackPublication(Track.Source.ScreenShare)
    if (pantalla?.track) teselas.push({ clave: `${p.identity}-pantalla`, persona: p, pantalla: true, pub: pantalla })
  }
  for (const p of gente) teselas.push({ clave: p.identity, persona: p, pantalla: false, pub: p.getTrackPublication(Track.Source.Camera) ?? null })
  const hayPantalla = teselas.some((t) => t.pantalla)

  return (
    <section className="chat-junta" data-grande={grande ? 'true' : undefined} data-con-pantalla={hayPantalla ? 'true' : undefined} role="region" aria-label={`Junta en ${nombre}`}>
      <header className="chat-junta-cabecera">
        <Headphones className="h-4 w-4 text-[var(--ls-e-verde)]" />
        <b>{nombre}</b>
        <span>{actual.estado === 'conectando' ? 'Conectando…' : `${gente.length} ${gente.length === 1 ? 'persona' : 'personas'}`}</span>
        <button type="button" className="chat-icono ml-auto" onClick={() => setGrande((g) => !g)} aria-label={grande ? 'Hacer pequeña la junta' : 'Agrandar la junta'} title={grande ? 'Hacer pequeña' : 'Agrandar'}>
          {grande ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
        </button>
      </header>
      <div className="chat-junta-cuadros">
        {teselas.length === 0 && <div className="tc-esqueleto h-full w-full" role="status" aria-label="Conectando" />}
        {teselas.map((t, i) => (
          <Cuadro key={t.clave} t={t} foco={hayPantalla && i === 0} />
        ))}
      </div>
      <footer className="chat-junta-mandos">
        <button type="button" onClick={() => void alternarMicro()} data-apagado={lp && !lp.isMicrophoneEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isMicrophoneEnabled)} aria-label={lp?.isMicrophoneEnabled ? 'Silenciar el micrófono' : 'Activar el micrófono'} title={lp?.isMicrophoneEnabled ? 'Silenciar' : 'Activar el micrófono'}>
          {lp?.isMicrophoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => void alternarCamara()} data-apagado={lp && !lp.isCameraEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isCameraEnabled)} aria-label={lp?.isCameraEnabled ? 'Apagar la cámara' : 'Encender la cámara'} title={lp?.isCameraEnabled ? 'Apagar la cámara' : 'Encender la cámara'}>
          {lp?.isCameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </button>
        {puedePantalla && (
          <button type="button" onClick={() => void alternarPantalla()} data-activo={lp?.isScreenShareEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isScreenShareEnabled)} aria-label={lp?.isScreenShareEnabled ? 'Dejar de compartir la pantalla' : 'Compartir la pantalla'} title={lp?.isScreenShareEnabled ? 'Dejar de compartir' : 'Compartir la pantalla'}>
            {lp?.isScreenShareEnabled ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          </button>
        )}
        <button type="button" className="chat-colgar" onClick={salir} aria-label="Salir de la junta" title="Salir de la junta">
          <PhoneOff className="h-4 w-4" /> Salir
        </button>
      </footer>
    </section>
  )
}
