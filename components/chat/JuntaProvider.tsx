'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Room, RoomEvent, Track } from 'livekit-client'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import type { JuntaActiva } from '@/lib/chat/junta'
import { useChat } from './ChatProvider'

const BASE = '/api/chat'
const RELEER_JUNTAS_MS = 30_000

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
}

const Contexto = createContext<ContextoDeJunta | null>(null)

const SIN_JUNTAS: ContextoDeJunta = { disponible: false, activas: {}, actual: null, room: null, version: 0, puedePantalla: false, entrar: async () => undefined, salir: () => undefined, alternarMicro: async () => undefined, alternarCamara: async () => undefined, alternarPantalla: async () => undefined }

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
  const { versionDeJuntas } = useChat()
  const [disponible, setDisponible] = useState(false)
  const [activas, setActivas] = useState<Record<string, JuntaActiva>>({})
  const [actual, setActual] = useState<ContextoDeJunta['actual']>(null)
  const [version, setVersion] = useState(0)
  const room = useRef<Room | null>(null)
  const audios = useRef<HTMLDivElement>(null)
  const conectando = useRef(false)
  const bump = useCallback(() => setVersion((v) => v + 1), [])

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
    setActual(null)
    bump()
    void leerActivas()
  }, [bump, leerActivas])

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
        const nueva = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
        room.current = nueva
        for (const e of EVENTOS_QUE_REPINTAN) nueva.on(e, bump)
        // El sonido de los demás: cada pista de audio se cuelga de un <audio> oculto
        nueva.on(RoomEvent.TrackSubscribed, (track) => {
          if (track.kind === Track.Kind.Audio) audios.current?.appendChild(track.attach())
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
    [actual?.canalId, bump, limpiar]
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
    }),
    [disponible, activas, actual, version, puedePantalla, entrar, salir, alternar]
  )
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div ref={audios} hidden aria-hidden />
    </Contexto.Provider>
  )
}
