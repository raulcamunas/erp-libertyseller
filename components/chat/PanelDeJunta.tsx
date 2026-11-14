'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Room, Track, type Participant, type TrackPublication } from 'livekit-client'
import { HeadphoneOff, Headphones, Lock, LockOpen, Maximize, Maximize2, Mic, MicOff, Minimize2, Music2, MonitorUp, MonitorX, PhoneOff, Settings2, Video, VideoOff, Volume2, VolumeX } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible } from '@/lib/chat/canales'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'
import { useMusica } from './MusicaProvider'
import { abrirDialogoDeVoz } from '@/lib/chat/dialogo-voz'
import { TEMA_VEO_TU_PANTALLA } from '@/lib/chat/sonidos-voz'

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

export interface Tesela {
  clave: string
  persona: Participant
  /** Si es la pantalla compartida de esa persona */
  pantalla: boolean
  pub: TrackPublication | null
}

/**
 * UN CUADRO A CASI TODA LA VENTANA: la pantalla compartida (o una cámara) en grande, sobre un fondo oscuro que deja ver apenas el chat de detrás. Se cierra con Esc, con la X o pulsando fuera; «Pantalla
 * completa» la lleva además a toda la pantalla del equipo. Es el mismo vídeo de la sala enganchado a un segundo elemento, así que no pide nada más a la red.
 */
function VisorGrande({ t, nombre, alCerrar }: { t: Tesela; nombre: string; alCerrar: () => void }) {
  const caja = useRef<HTMLDivElement>(null)
  const [completa, setCompleta] = useState(false)
  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      // Si está a pantalla completa, el primer Esc lo quita el navegador; el segundo cierra el visor
      if (e.key === 'Escape' && !document.fullscreenElement) alCerrar()
    }
    const cambio = () => setCompleta(document.fullscreenElement === caja.current)
    window.addEventListener('keydown', tecla)
    document.addEventListener('fullscreenchange', cambio)
    return () => {
      window.removeEventListener('keydown', tecla)
      document.removeEventListener('fullscreenchange', cambio)
      if (document.fullscreenElement === caja.current) void document.exitFullscreen().catch(() => undefined)
    }
  }, [alCerrar])
  const alternarCompleta = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined)
    else void caja.current?.requestFullscreen?.().catch(() => undefined)
  }, [])
  if (typeof document === 'undefined' || !t.pub?.track) return null
  return createPortal(
    <div className="visor-grande" role="dialog" aria-modal="true" aria-label={`${t.pantalla ? 'Pantalla' : 'Cámara'} de ${nombre} en grande`} ref={caja} onMouseDown={(e) => e.target === e.currentTarget && alCerrar()}>
      <div className="visor-grande-imagen" data-pantalla={t.pantalla ? 'true' : undefined} onDoubleClick={alternarCompleta}>
        <Imagen pub={t.pub} silenciado />
      </div>
      <div className="visor-grande-barra">
        <b>{t.pantalla ? `Pantalla de ${nombre}` : nombre}</b>
        <span>
          <button type="button" onClick={alternarCompleta} aria-label={completa ? 'Salir de la pantalla completa' : 'Pantalla completa'} title={completa ? 'Salir de la pantalla completa' : 'Llevarla a toda la pantalla del equipo (doble clic)'}>
            {completa ? <Minimize2 className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
          <button type="button" onClick={alCerrar} aria-label="Cerrar la vista grande" title="Cerrar (Esc)">
            <Minimize2 className="h-4 w-4" /> Cerrar
          </button>
        </span>
      </div>
    </div>,
    document.body
  )
}

export function Cuadro({ t, foco }: { t: Tesela; foco?: boolean }) {
  const { yo, nombreDe } = useChat()
  const [grande, setGrande] = useState(false)
  const cerrarGrande = useCallback(() => setGrande(false), [])
  const { volumenes, ponerVolumen, room } = useJunta()
  const nombre = nombreDe(t.persona.identity)
  // Ves la pantalla de otra persona: se le dice a ella sola, para que le suene «alguien ve tu pantalla» (components/chat/SonidosDeLaJunta.tsx)
  const pantallaAjena = t.pantalla && t.persona.identity !== yo.id ? t.persona.identity : null
  const pistaDePantalla = t.pantalla ? (t.pub?.trackSid ?? null) : null
  useEffect(() => {
    if (!room || !pantallaAjena || !pistaDePantalla) return
    void room.localParticipant.publishData(new TextEncoder().encode('1'), { reliable: true, destinationIdentities: [pantallaAjena], topic: TEMA_VEO_TU_PANTALLA }).catch(() => undefined)
  }, [room, pantallaAjena, pistaDePantalla])
  const volumen = volumenes[t.persona.identity] ?? 1
  const esOtra = t.persona.identity !== yo.id && !t.pantalla
  const habla = t.persona.isSpeaking && !t.pantalla
  const conImagen = Boolean(t.pub?.track && !t.pub.isMuted)
  return (
    <div className="chat-tesela" onDoubleClick={conImagen ? () => setGrande(true) : undefined} data-foco={foco ? 'true' : undefined} data-habla={habla ? 'true' : undefined} data-pantalla={t.pantalla ? 'true' : undefined}>
      {t.pub?.track && !t.pub.isMuted ? <Imagen pub={t.pub} silenciado={t.persona.identity === yo.id || t.pantalla} /> : (
        <span className="chat-tesela-avatar"><Avatar id={t.persona.identity} nombre={nombre} tamano={foco ? 88 : 64} /></span>
      )}
      {conImagen && (
        <button type="button" className="chat-tesela-ampliar" data-destacado={t.pantalla ? 'true' : undefined} onClick={() => setGrande(true)} aria-label={`Ver ${t.pantalla ? 'la pantalla' : 'la cámara'} de ${nombre} en grande`} title={t.pantalla ? 'Ver la pantalla en grande (doble clic)' : 'Ver en grande (doble clic)'}>
          <Maximize2 className="h-4 w-4" />
          {t.pantalla && <span>Ampliar</span>}
        </button>
      )}
      {grande && <VisorGrande t={t} nombre={nombre} alCerrar={cerrarGrande} />}
      <span className="chat-tesela-nombre">
        {!t.pantalla && !t.persona.isMicrophoneEnabled && <MicOff className="h-3 w-3" aria-label="Micrófono apagado" />}
        {t.pantalla ? `Pantalla de ${nombre}` : t.persona.identity === yo.id ? `${nombre} (tú)` : nombre}
      </span>
      {esOtra && (
        <span className="chat-tesela-volumen" data-silenciada={volumen === 0 ? 'true' : undefined}>
          <button type="button" onClick={() => ponerVolumen(t.persona.identity, volumen === 0 ? 1 : 0)} aria-label={volumen === 0 ? `Dejar de silenciar a ${nombre}` : `Silenciar a ${nombre} (solo para ti)`} title={volumen === 0 ? 'Quitar el silencio' : 'Silenciar (solo para ti)'}>
            {volumen === 0 ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
          </button>
          <input type="range" min={0} max={100} value={Math.round(volumen * 100)} onChange={(e) => ponerVolumen(t.persona.identity, Number(e.target.value) / 100)} aria-label={`Volumen de ${nombre}`} />
        </span>
      )}
    </div>
  )
}

/** Los cuadros de una sala: la pantalla compartida de cada persona (si la hay) y, después, la cara o la cámara de cada una */
export function teselasDe(room: Room | null): { gente: Participant[]; teselas: Tesela[]; hayPantalla: boolean } {
  const gente: Participant[] = room ? [room.localParticipant, ...room.remoteParticipants.values()] : []
  const teselas: Tesela[] = []
  for (const p of gente) {
    const pantalla = p.getTrackPublication(Track.Source.ScreenShare)
    if (pantalla?.track) teselas.push({ clave: `${p.identity}-pantalla`, persona: p, pantalla: true, pub: pantalla })
  }
  for (const p of gente) teselas.push({ clave: p.identity, persona: p, pantalla: false, pub: p.getTrackPublication(Track.Source.Camera) ?? null })
  return { gente, teselas, hayPantalla: teselas.some((t) => t.pantalla) }
}

/** La música compartida de la sala: abre o cierra el reproductor (cerrarlo es dejar de escucharla tú solo). Lleva un punto si está sonando algo */
export function BotonDeMusica() {
  const { visible, alternarPanel, estado } = useMusica()
  return (
    <button type="button" onClick={alternarPanel} data-activo={visible ? 'true' : undefined} data-suena={estado.reproduciendo ? 'true' : undefined} aria-pressed={visible} aria-label={visible ? 'Cerrar la música de la sala' : 'Abrir la música de la sala'} title={visible ? 'Cerrar el reproductor (dejas de escucharla tú solo)' : 'Música: pon música de YouTube a toda la sala con un enlace'}>
      <Music2 className="h-4 w-4" />
    </button>
  )
}

/** El candado de la sala en la que estás: puesto, para entrar hay que llamar a la puerta; quitado, la sala está abierta */
export function BotonDeCandado({ canalId }: { canalId: string }) {
  const { bloqueada, ponerCandado } = useJunta()
  const puesto = bloqueada(canalId)
  return (
    <button type="button" onClick={() => void ponerCandado(canalId, !puesto)} data-activo={puesto ? 'true' : undefined} aria-pressed={puesto} aria-label={puesto ? 'Quitar el candado de la sala' : 'Poner un candado a la sala'} title={puesto ? 'Sala con candado: quien quiera entrar tiene que llamar a la puerta. Pulsa para quitarlo' : 'Poner un candado: quien quiera entrar tendrá que llamar a la puerta y tú decides'}>
      {puesto ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4" />}
    </button>
  )
}

/**
 * LOS MANDOS DE LA JUNTA (micrófono, cámara, pantalla, ensordecer, música, candado, ajustes de voz y salir), los mismos en la ventana grande y en la sala del canal. Los ajustes se abren en una ventana
 * en mitad de la pantalla (components/chat/DialogoDeAjustesDeVoz.tsx), no en un panelito pegado al botón: ahí se cortaba dentro del chat.
 */
export function MandosDeLaJunta({ canalId }: { canalId: string }) {
  const { room, version, salir, alternarMicro, alternarCamara, alternarPantalla, puedePantalla, ensordecido, alternarEnsordecer } = useJunta()
  void version
  const lp = room?.localParticipant
  return (
    <>
      <footer className="chat-junta-mandos">
        <button type="button" onClick={() => void alternarMicro()} data-apagado={lp && !lp.isMicrophoneEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isMicrophoneEnabled)} aria-label={lp?.isMicrophoneEnabled ? 'Silenciar el micrófono' : 'Activar el micrófono'} title={lp?.isMicrophoneEnabled ? 'Silenciar el micrófono' : 'Activar el micrófono'}>
          {lp?.isMicrophoneEnabled ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
        </button>
        <button type="button" onClick={() => void alternarCamara()} data-apagado={lp && !lp.isCameraEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isCameraEnabled)} aria-label={lp?.isCameraEnabled ? 'Apagar la cámara' : 'Encender la cámara'} title={lp?.isCameraEnabled ? 'Apagar la cámara' : 'Encender la cámara'}>
          {lp?.isCameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
        </button>
        {puedePantalla && (
          <button type="button" onClick={() => void alternarPantalla()} data-activo={lp?.isScreenShareEnabled ? 'true' : undefined} aria-pressed={Boolean(lp?.isScreenShareEnabled)} aria-label={lp?.isScreenShareEnabled ? 'Dejar de compartir la pantalla' : 'Compartir la pantalla'} title={lp?.isScreenShareEnabled ? 'Dejar de compartir la pantalla' : 'Compartir la pantalla'}>
            {lp?.isScreenShareEnabled ? <MonitorX className="h-4 w-4" /> : <MonitorUp className="h-4 w-4" />}
          </button>
        )}
        <button type="button" onClick={() => void alternarEnsordecer()} data-apagado={ensordecido ? 'true' : undefined} aria-pressed={ensordecido} aria-label={ensordecido ? 'Volver a oír' : 'Ensordecer: dejar de oír a todos'} title={ensordecido ? 'Volver a oír' : 'Ensordecer: dejar de oír a todos'}>
          {ensordecido ? <HeadphoneOff className="h-4 w-4" /> : <Headphones className="h-4 w-4" />}
        </button>
        <BotonDeMusica />
        <BotonDeCandado canalId={canalId} />
        <button type="button" onClick={abrirDialogoDeVoz} aria-label="Ajustes de voz" title="Ajustes de voz: volumen y sensibilidad del micrófono, prueba en tiempo real, dispositivos y sonidos">
          <Settings2 className="h-4 w-4" />
        </button>
        <button type="button" className="chat-colgar" onClick={salir} aria-label="Salir de la junta" title="Salir de la junta">
          <PhoneOff className="h-4 w-4" /> Salir
        </button>
      </footer>
    </>
  )
}

/**
 * LA VENTANA GRANDE DE LA JUNTA: cuadros de cada persona, cámaras, quien comparte pantalla en grande, y los mandos. La junta es por defecto una cápsula pequeña junto al chat
 * (components/chat/JuntaFlotante.tsx); esta ventana se abre solo si se pide («Ver la junta») y se vuelve a la cápsula con «Minimizar». Se queda abierta aunque cambies de canal o de pantalla.
 */
export function PanelDeJunta() {
  const { actual, room, version, ponerVistaGrande } = useJunta()
  const { canales, yo, persona } = useChat()
  void version
  if (!actual) return null
  const canal = canales.find((c) => c.id === actual.canalId)
  const nombre = canal ? nombreVisible(canal, yo.id, persona) : 'Junta'
  const { gente, teselas, hayPantalla } = teselasDe(room)

  return (
    <section className="chat-junta" data-grande="true" data-con-pantalla={hayPantalla ? 'true' : undefined} role="region" aria-label={`Junta en ${nombre}`}>
      <header className="chat-junta-cabecera">
        <Headphones className="h-4 w-4 text-[var(--ls-e-verde)]" />
        <b>{nombre}</b>
        <span>{actual.estado === 'conectando' ? 'Conectando…' : `${gente.length} ${gente.length === 1 ? 'persona' : 'personas'}`}</span>
        <button type="button" className="chat-icono ml-auto" onClick={() => ponerVistaGrande(false)} aria-label="Minimizar la junta" title="Minimizar: seguir en la junta con la cápsula pequeña">
          <Minimize2 className="h-4 w-4" />
        </button>
      </header>
      <div className="chat-junta-cuadros">
        {teselas.length === 0 && <div className="tc-esqueleto h-full w-full" role="status" aria-label="Conectando" />}
        {teselas.map((t, i) => (
          <Cuadro key={t.clave} t={t} foco={hayPantalla && i === 0} />
        ))}
      </div>
      <MandosDeLaJunta canalId={actual.canalId} />
    </section>
  )
}
