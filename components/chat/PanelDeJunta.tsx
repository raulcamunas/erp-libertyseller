'use client'

import { useEffect, useRef, useState } from 'react'
import { Room, Track, type Participant, type TrackPublication } from 'livekit-client'
import { HeadphoneOff, Headphones, Lock, LockOpen, Mic, MicOff, Minimize2, MonitorUp, MonitorX, PhoneOff, Settings2, Video, VideoOff, Volume2, VolumeX } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible } from '@/lib/chat/canales'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'
import { abrirDialogoDeVoz } from '@/lib/chat/dialogo-voz'
import { BotonDeSonidos } from './BotonDeSonidos'

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

export function Cuadro({ t, foco }: { t: Tesela; foco?: boolean }) {
  const { yo, nombreDe } = useChat()
  const { volumenes, ponerVolumen } = useJunta()
  const nombre = nombreDe(t.persona.identity)
  const volumen = volumenes[t.persona.identity] ?? 1
  const esOtra = t.persona.identity !== yo.id && !t.pantalla
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

/** Los ajustes de tu audio: limpiar el micrófono, elegir micrófono y altavoz. Solo cambian lo tuyo */
export function AjustesDeAudioPanel({ onCerrar }: { onCerrar: () => void }) {
  const { audio, cambiarAudio } = useJunta()
  const [micros, setMicros] = useState<MediaDeviceInfo[]>([])
  const [altavoces, setAltavoces] = useState<MediaDeviceInfo[]>([])
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let vivo = true
    void Promise.all([Room.getLocalDevices('audioinput', false).catch(() => []), Room.getLocalDevices('audiooutput', false).catch(() => [])]).then(([m, a]) => {
      if (!vivo) return
      setMicros(m)
      setAltavoces(a)
    })
    const fuera = (e: PointerEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node) && !(e.target as Element).closest('[data-abre-ajustes-audio]')) onCerrar()
    }
    document.addEventListener('pointerdown', fuera)
    return () => {
      vivo = false
      document.removeEventListener('pointerdown', fuera)
    }
  }, [onCerrar])
  const interruptor = (clave: 'supresion' | 'eco' | 'nivelacion' | 'sonidos', titulo: string, ayuda: string) => (
    <label className="chat-audio-fila">
      <span><b>{titulo}</b><small>{ayuda}</small></span>
      <input type="checkbox" role="switch" checked={audio[clave]} onChange={(e) => void cambiarAudio({ [clave]: e.target.checked })} />
    </label>
  )
  return (
    <div className="chat-audio-ajustes" ref={panel} role="dialog" aria-label="Ajustes de audio">
      <p className="chat-audio-titulo">Tu audio <i>solo cambia lo tuyo</i></p>
      <button type="button" className="chat-boton-sonidos" onClick={abrirDialogoDeVoz}><Mic className="h-3.5 w-3.5" />Ajustes de voz y prueba de micrófono…</button>
      {interruptor('supresion', 'Supresión de ruido', 'Quita teclado, ventilador y ruido de fondo')}
      {interruptor('eco', 'Cancelar el eco', 'Evita que tu voz vuelva por los altavoces')}
      {interruptor('nivelacion', 'Nivelar mi micrófono', 'Sube o baja el volumen solo, para que se te oiga siempre igual')}
      {interruptor('sonidos', 'Sonidos de la junta', 'Un aviso cuando alguien entra o sale, y cuando te silencias o te ensordeces')}
      <label className="chat-audio-campo">
        <span>Micrófono</span>
        <select value={audio.entrada} onChange={(e) => void cambiarAudio({ entrada: e.target.value })}>
          <option value="">El del sistema</option>
          {micros.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Micrófono'}</option>)}
        </select>
      </label>
      {altavoces.length > 0 && (
        <label className="chat-audio-campo">
          <span>Altavoz</span>
          <select value={audio.salida} onChange={(e) => void cambiarAudio({ salida: e.target.value })}>
            <option value="">El del sistema</option>
            {altavoces.filter((d) => d.deviceId && d.deviceId !== 'default').map((d) => <option key={d.deviceId} value={d.deviceId}>{d.label || 'Altavoz'}</option>)}
          </select>
        </label>
      )}
      <BotonDeSonidos />
      <p className="chat-audio-nota">El volumen de cada persona se ajusta desde su cuadro.</p>
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
 * LOS MANDOS DE LA JUNTA (micrófono, cámara, pantalla, ensordecer, candado, ajustes y salir), los mismos en la ventana grande y en la sala del canal. `ajustes`: 'dentro' pinta los ajustes de audio
 * llenando el panel (la ventana grande), 'sobre' como una ventanita encima de los mandos (la sala del canal).
 */
export function MandosDeLaJunta({ canalId, ajustesEn }: { canalId: string; ajustesEn: 'dentro' | 'sobre' }) {
  const { room, version, salir, alternarMicro, alternarCamara, alternarPantalla, puedePantalla, ensordecido, alternarEnsordecer } = useJunta()
  const [ajustes, setAjustes] = useState(false)
  void version
  const lp = room?.localParticipant
  const panel = ajustes ? <AjustesDeAudioPanel onCerrar={() => setAjustes(false)} /> : null
  return (
    <>
      {ajustesEn === 'dentro' ? panel : panel && <div className="junta-ajustes">{panel}</div>}
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
        <BotonDeCandado canalId={canalId} />
        <button type="button" data-abre-ajustes-audio data-activo={ajustes ? 'true' : undefined} onClick={() => setAjustes((a) => !a)} aria-expanded={ajustes} aria-label="Ajustes de audio" title="Ajustes de audio: ruido, micrófono, altavoz">
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
      <MandosDeLaJunta canalId={actual.canalId} ajustesEn="dentro" />
    </section>
  )
}
