'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Room, RoomEvent, Track, type LocalAudioTrack } from 'livekit-client'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { AJUSTES_DE_AUDIO_POR_DEFECTO, CLAVE_DE_AUDIO, CLAVE_DE_VOLUMENES, leerAjustesDeAudio, leerVolumenes, limitarVolumen, limpiarAjustesDeAudio, restriccionesDeMicro, volumenEfectivo, type AjustesDeAudio, type Volumenes } from '@/lib/chat/audio'
import type { JuntaActiva } from '@/lib/chat/junta'
import { useChat } from './ChatProvider'

const BASE = '/api/chat'
const RELEER_JUNTAS_MS = 15_000

interface ContextoDeJunta {
  /** Las juntas están configuradas en el servidor (LiveKit) */
  disponible: boolean
  /** Las juntas abiertas ahora, por canal */
  activas: Record<string, JuntaActiva>
  /** Donde estoy ahora */
  actual: { canalId: string; estado: 'conectando' | 'conectada' } | null
  room: Room | null
  /** Sube con cada cambio de la sala (alguien entra, se calla, comparte…): la pantalla se repinta */
  version: number
  puedePantalla: boolean
  entrar: (canalId: string) => Promise<void>
  salir: () => void
  alternarMicro: () => Promise<void>
  alternarCamara: () => Promise<void>
  alternarPantalla: () => Promise<void>
  /** Tus ajustes de audio (supresión de ruido, eco, nivelación, micrófono y altavoz) */
  audio: AjustesDeAudio
  cambiarAudio: (cambios: Partial<AjustesDeAudio>) => Promise<void>
  /** Cuánto oyes a cada persona (de 0 a 1; 0 = silenciada solo para ti) */
  volumenes: Volumenes
  ponerVolumen: (id: string, volumen: number) => void
  /** No oyes a nadie (y tu micrófono se apaga) hasta que lo quites */
  ensordecido: boolean
  alternarEnsordecer: () => Promise<void>
}

const Contexto = createContext<ContextoDeJunta | null>(null)

const SIN_JUNTAS: ContextoDeJunta = { disponible: false, activas: {}, actual: null, room: null, version: 0, puedePantalla: false, entrar: async () => undefined, salir: () => undefined, alternarMicro: async () => undefined, alternarCamara: async () => undefined, alternarPantalla: async () => undefined, audio: AJUSTES_DE_AUDIO_POR_DEFECTO, cambiarAudio: async () => undefined, volumenes: {}, ponerVolumen: () => undefined, ensordecido: false, alternarEnsordecer: async () => undefined }

export const useJunta = (): ContextoDeJunta => useContext(Contexto) ?? SIN_JUNTAS
/** Solo para probar las pantallas con datos inventados (la vista de pruebas) */
export const ContextoDeJuntaParaPruebas = Contexto

const EVENTOS_QUE_REPINTAN = [
  RoomEvent.ParticipantConnected,
  RoomEvent.ParticipantDisconnected,
  RoomEvent.TrackSubscribed,
  RoomEvent.TrackUnsubscribed,
  RoomEvent.TrackMuted,
  RoomEvent.TrackUnmuted,
  RoomEvent.TrackPublished,
  RoomEvent.TrackUnpublished,
  RoomEvent.LocalTrackPublished,
  RoomEvent.LocalTrackUnpublished,
  RoomEvent.ActiveSpeakersChanged,
  RoomEvent.ConnectionStateChanged,
] as const

const mensajeDe = (e: unknown, por: string) => (e instanceof Error && e.message ? e.message : por)

export function JuntaProvider({ children }: { children: ReactNode }) {
  const { versionDeJuntas, anunciarVoz } = useChat()
  const [disponible, setDisponible] = useState(false)
  const [activas, setActivas] = useState<Record<string, JuntaActiva>>({})
  const [actual, setActual] = useState<ContextoDeJunta['actual']>(null)
  const [version, setVersion] = useState(0)
  const room = useRef<Room | null>(null)
  const audios = useRef<HTMLDivElement>(null)
  const conectando = useRef(false)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // Lo que decides para ti (se guarda en este navegador): el audio y cuánto oyes a cada persona
  const [audio, setAudio] = useState<AjustesDeAudio>(AJUSTES_DE_AUDIO_POR_DEFECTO)
  const [volumenes, setVolumenes] = useState<Volumenes>({})
  const [ensordecido, setEnsordecido] = useState(false)
  const audioRef = useRef(audio)
  const volumenesRef = useRef(volumenes)
  const ensordecidoRef = useRef(false)
  const microAntesDeEnsordecer = useRef(false)
  useEffect(() => {
    try {
      const a = leerAjustesDeAudio(window.localStorage.getItem(CLAVE_DE_AUDIO))
      const v = leerVolumenes(window.localStorage.getItem(CLAVE_DE_VOLUMENES))
      audioRef.current = a
      volumenesRef.current = v
      setAudio(a)
      setVolumenes(v)
    } catch {
      /* sin almacenamiento: lo de siempre */
    }
  }, [])
  const guardar = (clave: string, valor: unknown) => {
    try {
      window.localStorage.setItem(clave, JSON.stringify(valor))
    } catch {
      /* no se guarda, pero vale para esta junta */
    }
  }
  /** Pone a cada persona de la sala al volumen que le toca */
  const aplicarVolumenes = useCallback(() => {
    for (const p of room.current?.remoteParticipants.values() ?? []) p.setVolume(volumenEfectivo(volumenesRef.current, p.identity, ensordecidoRef.current))
  }, [])
  const ponerVolumen = useCallback(
    (id: string, volumen: number) => {
      const nuevos = { ...volumenesRef.current, [id]: limitarVolumen(volumen) }
      volumenesRef.current = nuevos
      setVolumenes(nuevos)
      guardar(CLAVE_DE_VOLUMENES, nuevos)
      room.current?.remoteParticipants.get(id)?.setVolume(volumenEfectivo(nuevos, id, ensordecidoRef.current))
    },
    []
  )
  const cambiarAudio = useCallback(async (cambios: Partial<AjustesDeAudio>) => {
    const antes = audioRef.current
    const despues = limpiarAjustesDeAudio({ ...antes, ...cambios })
    audioRef.current = despues
    setAudio(despues)
    guardar(CLAVE_DE_AUDIO, despues)
    const r = room.current
    if (!r) return
    try {
      if (despues.entrada !== antes.entrada) await r.switchActiveDevice('audioinput', despues.entrada || 'default')
      if (despues.salida !== antes.salida) await r.switchActiveDevice('audiooutput', despues.salida || 'default')
      if (despues.supresion !== antes.supresion || despues.eco !== antes.eco || despues.nivelacion !== antes.nivelacion) {
        const pista = r.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined
        await pista?.restartTrack(restriccionesDeMicro(despues))
      }
    } catch {
      toast.error('Ese cambio de audio no ha podido aplicarse en este navegador.')
    }
  }, [])
  const alternarEnsordecer = useCallback(async () => {
    const lp = room.current?.localParticipant
    const ahora = !ensordecidoRef.current
    ensordecidoRef.current = ahora
    setEnsordecido(ahora)
    aplicarVolumenes()
    // Ensordecido no se oye ni se habla: el micrófono se apaga, y al quitarlo vuelve como estaba
    try {
      if (ahora) {
        microAntesDeEnsordecer.current = Boolean(lp?.isMicrophoneEnabled)
        if (lp?.isMicrophoneEnabled) await lp.setMicrophoneEnabled(false)
      } else if (microAntesDeEnsordecer.current) await lp?.setMicrophoneEnabled(true)
    } catch {
      /* el micrófono se queda como esté */
    }
    bump()
  }, [aplicarVolumenes, bump])

  const leerActivas = useCallback(async () => {
    try {
      const r = await pedir<{ disponible: boolean; activas: JuntaActiva[] }>(`${BASE}/junta`)
      setDisponible(r.disponible)
      setActivas(Object.fromEntries(r.activas.map((a) => [a.canalId, a])))
    } catch {
      /* sin red: se queda lo que había */
    }
  }, [])

  useEffect(() => {
    void leerActivas()
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') void leerActivas()
    }, RELEER_JUNTAS_MS)
    return () => clearInterval(t)
  }, [leerActivas])
  useEffect(() => {
    if (versionDeJuntas > 0) void leerActivas()
  }, [versionDeJuntas, leerActivas])

  const limpiar = useCallback(() => {
    const r = room.current
    room.current = null
    conectando.current = false
    if (r) {
      r.removeAllListeners()
      void r.disconnect()
    }
    audios.current?.replaceChildren()
    ensordecidoRef.current = false
    setEnsordecido(false)
    anunciarVoz(null)
    setActual(null)
    bump()
    void leerActivas()
  }, [anunciarVoz, bump, leerActivas])

  const salir = useCallback(() => limpiar(), [limpiar])

  const entrar = useCallback(
    async (canalId: string) => {
      if (conectando.current) return
      if (room.current && actual?.canalId === canalId) return
      if (room.current) limpiar()
      conectando.current = true
      setActual({ canalId, estado: 'conectando' })
      try {
        const llave = await pedir<{ token: string; url: string }>(`${BASE}/junta`, { metodo: 'POST', cuerpo: { canalId } })
        const nueva = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: restriccionesDeMicro(audioRef.current), ...(audioRef.current.salida ? { audioOutput: { deviceId: audioRef.current.salida } } : {}) })
        room.current = nueva
        for (const e of EVENTOS_QUE_REPINTAN) nueva.on(e, bump)
        // El sonido de los demás: cada pista de audio se cuelga de un <audio> oculto
        nueva.on(RoomEvent.TrackSubscribed, (track, _publicacion, participante) => {
          if (track.kind === Track.Kind.Audio) {
            audios.current?.appendChild(track.attach())
            // Cada persona a su volumen (y a cero si estás ensordecido)
            participante.setVolume(volumenEfectivo(volumenesRef.current, participante.identity, ensordecidoRef.current))
          }
        })
        nueva.on(RoomEvent.TrackUnsubscribed, (track) => {
          for (const el of track.detach()) el.remove()
        })
        nueva.on(RoomEvent.Disconnected, () => {
          if (room.current === nueva) limpiar()
        })
        await nueva.connect(llave.url, llave.token)
        if (room.current !== nueva) return
        setActual({ canalId, estado: 'conectada' })
        anunciarVoz(canalId)
        try {
          await nueva.localParticipant.setMicrophoneEnabled(true)
        } catch {
          toast.error('No se ha podido activar el micrófono: mira el permiso del navegador. Entras escuchando.')
        }
        bump()
      } catch (e) {
        if (room.current) {
          room.current.removeAllListeners()
          void room.current.disconnect()
          room.current = null
        }
        setActual(null)
        toast.error(mensajeDe(e, 'No se ha podido entrar a la junta.'))
      } finally {
        conectando.current = false
      }
    },
    [actual?.canalId, anunciarVoz, bump, limpiar]
  )

  const alternar = useCallback(
    async (que: 'micro' | 'camara' | 'pantalla') => {
      const lp = room.current?.localParticipant
      if (!lp) return
      try {
        if (que === 'micro') await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
        else if (que === 'camara') await lp.setCameraEnabled(!lp.isCameraEnabled)
        else await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: false })
      } catch (e) {
        // Cerrar el cuadro de «¿qué quieres compartir?» no es un fallo
        const cancelado = e instanceof Error && /permission|denied|dismissed|abort|cancel/i.test(`${e.name} ${e.message}`)
        if (!(que === 'pantalla' && cancelado)) toast.error(que === 'micro' ? 'No se ha podido usar el micrófono.' : que === 'camara' ? 'No se ha podido encender la cámara: mira el permiso del navegador.' : 'No se ha podido compartir la pantalla.')
      }
      bump()
    },
    [bump]
  )

  // Si se cierra la pestaña o se sale del chat, la junta se corta
  useEffect(() => () => limpiar(), [limpiar])
  useEffect(() => {
    const alCerrar = () => void room.current?.disconnect()
    window.addEventListener('pagehide', alCerrar)
    return () => window.removeEventListener('pagehide', alCerrar)
  }, [])

  const puedePantalla = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getDisplayMedia === 'function'
  const valor = useMemo<ContextoDeJunta>(
    () => ({
      disponible,
      activas,
      actual,
      room: room.current,
      version,
      puedePantalla,
      entrar,
      salir,
      alternarMicro: () => alternar('micro'),
      alternarCamara: () => alternar('camara'),
      alternarPantalla: () => alternar('pantalla'),
      audio,
      cambiarAudio,
      volumenes,
      ponerVolumen,
      ensordecido,
      alternarEnsordecer,
    }),
    [disponible, activas, actual, version, puedePantalla, entrar, salir, alternar, audio, cambiarAudio, volumenes, ponerVolumen, ensordecido, alternarEnsordecer]
  )
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div ref={audios} hidden aria-hidden />
    </Contexto.Provider>
  )
}
