'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { DisconnectReason, Room, RoomEvent, Track, type LocalAudioTrack } from 'livekit-client'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { AJUSTES_DE_AUDIO_POR_DEFECTO, CLAVE_DE_AUDIO, CLAVE_DE_VOLUMENES, leerAjustesDeAudio, leerVolumenes, limitarVolumen, limpiarAjustesDeAudio, restriccionesDeMicro, volumenEfectivo, type AjustesDeAudio, type Volumenes } from '@/lib/chat/audio'
import { MENSAJE_DE_SALA_CON_CANDADO, type JuntaActiva } from '@/lib/chat/junta'
import { ponerJuntaConectada } from '@/lib/chat/dock-estado'
import { ponerSonidosDeVoz } from '@/lib/chat/sonidos-voz'
import { AJUSTES_DE_VOZ_POR_DEFECTO, CLAVE_DE_VOZ, leerAjustesDeVoz, limpiarAjustesDeVoz, necesitaProcesador, type AjustesDeVoz } from '@/lib/chat/voz-ajustes'
import { ProcesadorDeVoz } from '@/lib/chat/voz-procesador'
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
  /** Tu voz: volumen del micrófono y puerta de ruido (se guardan en este navegador) */
  voz: AjustesDeVoz
  cambiarVoz: (cambios: Partial<AjustesDeVoz>) => void
  /** La sala de este canal tiene candado */
  bloqueada: (canalId: string) => boolean
  /** Poner o quitar el candado de la sala en la que estás */
  ponerCandado: (canalId: string, bloqueada: boolean) => Promise<void>
  /** La sala a cuya puerta has llamado y estás esperando que te dejen entrar */
  esperandoPuerta: string | null
  /** Dejar entrar (o no) a quien ha llamado a la puerta de tu sala */
  responderPuerta: (canalId: string, usuarioId: string, permitir: boolean) => Promise<void>
  /** La ventana grande de la junta (cuadros, cámaras, pantalla compartida) está abierta. Por defecto la junta es una cápsula pequeña junto al chat */
  vistaGrande: boolean
  ponerVistaGrande: (v: boolean) => void
}

const Contexto = createContext<ContextoDeJunta | null>(null)

const SIN_JUNTAS: ContextoDeJunta = { disponible: false, activas: {}, actual: null, room: null, version: 0, puedePantalla: false, entrar: async () => undefined, salir: () => undefined, alternarMicro: async () => undefined, alternarCamara: async () => undefined, alternarPantalla: async () => undefined, audio: AJUSTES_DE_AUDIO_POR_DEFECTO, cambiarAudio: async () => undefined, volumenes: {}, ponerVolumen: () => undefined, ensordecido: false, alternarEnsordecer: async () => undefined, vistaGrande: false, ponerVistaGrande: () => undefined, voz: AJUSTES_DE_VOZ_POR_DEFECTO, cambiarVoz: () => undefined, bloqueada: () => false, ponerCandado: async () => undefined, esperandoPuerta: null, responderPuerta: async () => undefined }

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

/** Cuántas veces se intenta volver sola a la junta si se corta sin que la persona la haya dejado (la red, el portátil que se duerme un momento) */
const INTENTOS_DE_VUELTA = 4
/** Las razones por las que NO se vuelve: alguien la ha cerrado a propósito o se ha entrado desde otro sitio con la misma persona (volver haría que las dos pestañas se echaran sin parar) */
const NO_VOLVER_POR = new Set<DisconnectReason | undefined>([DisconnectReason.CLIENT_INITIATED, DisconnectReason.DUPLICATE_IDENTITY, DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED])

const mensajeDe = (e: unknown, por: string) => (e instanceof Error && e.message ? e.message : por)

export function JuntaProvider({ children }: { children: ReactNode }) {
  const { versionDeJuntas, anunciarVoz, respuestaDePuerta } = useChat()
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
  const [vistaGrande, setVistaGrande] = useState(false)
  const [esperandoPuerta, setEsperandoPuerta] = useState<string | null>(null)
  const esperandoRef = useRef<string | null>(null)
  // La junta a la que hay que volver si se corta sola, y cuántas veces se ha intentado. null = no se vuelve (se salió a propósito)
  const volverA = useRef<string | null>(null)
  const intentosDeVuelta = useRef(0)
  const entrarRef = useRef<(canalId: string) => Promise<void>>(async () => undefined)
  const llamarALaPuertaRef = useRef<(canalId: string) => Promise<void>>(async () => undefined)
  const [voz, setVoz] = useState<AjustesDeVoz>(AJUSTES_DE_VOZ_POR_DEFECTO)
  const vozRef = useRef(voz)
  const procesadorRef = useRef<ProcesadorDeVoz | null>(null)
  const audioRef = useRef(audio)
  const volumenesRef = useRef(volumenes)
  const ensordecidoRef = useRef(false)
  const microAntesDeEnsordecer = useRef(false)
  useEffect(() => {
    try {
      const a = leerAjustesDeAudio(window.localStorage.getItem(CLAVE_DE_AUDIO))
      const v = leerVolumenes(window.localStorage.getItem(CLAVE_DE_VOLUMENES))
      const vz = leerAjustesDeVoz(window.localStorage.getItem(CLAVE_DE_VOZ))
      vozRef.current = vz
      setVoz(vz)
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

  /** Pone (o quita) el procesador de voz en el micrófono de la llamada según lo que se haya decidido: solo si se ha tocado el volumen o se usa la puerta de ruido */
  const aplicarVozAlMicro = useCallback(async () => {
    const pista = room.current?.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack as LocalAudioTrack | undefined
    if (!pista) return
    const v = vozRef.current
    try {
      if (necesitaProcesador(v)) {
        if (procesadorRef.current) procesadorRef.current.actualizar(v)
        else {
          const nuevo = new ProcesadorDeVoz(v)
          procesadorRef.current = nuevo
          await pista.setProcessor(nuevo)
        }
      } else if (procesadorRef.current) {
        procesadorRef.current = null
        await pista.stopProcessor()
      }
    } catch {
      procesadorRef.current = null
      toast.error('Ese ajuste de voz no ha podido aplicarse en este navegador.')
    }
  }, [])
  const cambiarVoz = useCallback(
    (cambios: Partial<AjustesDeVoz>) => {
      const nueva = limpiarAjustesDeVoz({ ...vozRef.current, ...cambios })
      vozRef.current = nueva
      setVoz(nueva)
      guardar(CLAVE_DE_VOZ, nueva)
      void aplicarVozAlMicro()
    },
    [aplicarVozAlMicro]
  )

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
    procesadorRef.current = null
    audios.current?.replaceChildren()
    ensordecidoRef.current = false
    setEnsordecido(false)
    anunciarVoz(null)
    setActual(null)
    bump()
    void leerActivas()
  }, [anunciarVoz, bump, leerActivas])

  // Salir a propósito: no se vuelve sola, y la ventana grande se cierra
  const salir = useCallback(() => {
    volverA.current = null
    intentosDeVuelta.current = 0
    setVistaGrande(false)
    limpiar()
  }, [limpiar])

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
        nueva.on(RoomEvent.Disconnected, (razon) => {
          if (room.current !== nueva) return
          // Se corta sin que la persona haya salido (la red, el equipo que se duerme un momento): se vuelve sola a la misma junta, unas pocas veces y con espera creciente
          const canalAlQueVolver = volverA.current
          limpiar()
          if (!canalAlQueVolver || NO_VOLVER_POR.has(razon) || intentosDeVuelta.current >= INTENTOS_DE_VUELTA) {
            volverA.current = null
            if (canalAlQueVolver && !NO_VOLVER_POR.has(razon)) toast.error('Se ha cortado la conexión de la junta y no se ha podido recuperar.')
            return
          }
          intentosDeVuelta.current += 1
          setActual({ canalId: canalAlQueVolver, estado: 'conectando' })
          setTimeout(() => {
            if (volverA.current === canalAlQueVolver && !room.current) void entrarRef.current(canalAlQueVolver)
          }, 1500 * intentosDeVuelta.current)
        })
        await nueva.connect(llave.url, llave.token)
        if (room.current !== nueva) return
        volverA.current = canalId
        intentosDeVuelta.current = 0
        setActual({ canalId, estado: 'conectada' })
        anunciarVoz(canalId)
        try {
          await nueva.localParticipant.setMicrophoneEnabled(true)
          await aplicarVozAlMicro()
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
        // La sala tiene candado: se llama a la puerta y se espera a que alguien de dentro te deje entrar
        if (e instanceof Error && e.message === MENSAJE_DE_SALA_CON_CANDADO) {
          volverA.current = null
          void llamarALaPuertaRef.current(canalId)
        } else if (volverA.current === canalId && intentosDeVuelta.current > 0 && intentosDeVuelta.current < INTENTOS_DE_VUELTA) {
          intentosDeVuelta.current += 1
          setActual({ canalId, estado: 'conectando' })
          setTimeout(() => {
            if (volverA.current === canalId && !room.current) void entrarRef.current(canalId)
          }, 1500 * intentosDeVuelta.current)
        } else {
          volverA.current = null
          toast.error(mensajeDe(e, 'No se ha podido entrar a la junta.'))
        }
      } finally {
        conectando.current = false
      }
    },
    [actual?.canalId, anunciarVoz, aplicarVozAlMicro, bump, limpiar]
  )
  entrarRef.current = entrar

  /** Llamar a la puerta de una sala con candado. Si en realidad ya se puede entrar (se quitó el candado), se entra; si no, se espera la respuesta (máximo un minuto y medio) */
  const llamarALaPuerta = useCallback(async (canalId: string) => {
    try {
      const r = await pedir<{ puedeEntrar: boolean }>(`${BASE}/junta/puerta`, { metodo: 'POST', cuerpo: { canalId, accion: 'tocar' } })
      if (r.puedeEntrar) return void entrarRef.current(canalId)
      esperandoRef.current = canalId
      setEsperandoPuerta(canalId)
      toast.message('Esa sala tiene candado: has llamado a la puerta. Esperando a que te dejen entrar…')
      setTimeout(() => {
        if (esperandoRef.current !== canalId) return
        esperandoRef.current = null
        setEsperandoPuerta(null)
        toast.message('Nadie ha contestado a la puerta todavía. Puedes volver a llamar.')
      }, 90_000)
    } catch (e) {
      toast.error(mensajeDe(e, 'No se ha podido llamar a la puerta.'))
    }
  }, [])
  llamarALaPuertaRef.current = llamarALaPuerta

  // La respuesta a la puerta a la que he llamado
  useEffect(() => {
    if (!respuestaDePuerta || esperandoRef.current !== respuestaDePuerta.canalId) return
    const canalId = respuestaDePuerta.canalId
    esperandoRef.current = null
    setEsperandoPuerta(null)
    if (respuestaDePuerta.estado === 'permitida') void entrarRef.current(canalId)
    else toast.error('No te han dejado entrar a la sala.')
  }, [respuestaDePuerta])

  const ponerCandado = useCallback(
    async (canalId: string, bloqueada: boolean) => {
      try {
        await pedir(`${BASE}/junta/candado`, { metodo: 'POST', cuerpo: { canalId, bloqueada } })
        // Se ve al instante, sin esperar a la siguiente lectura
        setActivas((a) => (a[canalId] ? { ...a, [canalId]: { ...a[canalId], bloqueada } } : a))
        toast.message(bloqueada ? 'Candado puesto: para entrar tendrán que llamar a la puerta.' : 'Candado quitado: la sala vuelve a estar abierta.')
      } catch (e) {
        toast.error(mensajeDe(e, 'No se ha podido cambiar el candado.'))
      }
    },
    []
  )
  const responderPuerta = useCallback(async (canalId: string, usuarioId: string, permitir: boolean) => {
    try {
      await pedir(`${BASE}/junta/puerta`, { metodo: 'POST', cuerpo: { canalId, accion: permitir ? 'permitir' : 'denegar', usuarioId } })
    } catch (e) {
      toast.error(mensajeDe(e, 'No se ha podido contestar a la puerta.'))
    }
  }, [])

  const alternar = useCallback(
    async (que: 'micro' | 'camara' | 'pantalla') => {
      const lp = room.current?.localParticipant
      if (!lp) return
      try {
        if (que === 'micro') {
          await lp.setMicrophoneEnabled(!lp.isMicrophoneEnabled)
          await aplicarVozAlMicro()
        }
        else if (que === 'camara') await lp.setCameraEnabled(!lp.isCameraEnabled)
        else await lp.setScreenShareEnabled(!lp.isScreenShareEnabled, { audio: false })
      } catch (e) {
        // Cerrar el cuadro de «¿qué quieres compartir?» no es un fallo
        const cancelado = e instanceof Error && /permission|denied|dismissed|abort|cancel/i.test(`${e.name} ${e.message}`)
        if (!(que === 'pantalla' && cancelado)) toast.error(que === 'micro' ? 'No se ha podido usar el micrófono.' : que === 'camara' ? 'No se ha podido encender la cámara: mira el permiso del navegador.' : 'No se ha podido compartir la pantalla.')
      }
      bump()
    },
    [aplicarVozAlMicro, bump]
  )

  // La junta solo se corta al cerrar la pestaña o al salir del ERP (este proveedor vive en el layout de todo el ERP): cambiar de pantalla o de pestaña no la toca
  const limpiarAlDesmontar = useRef(limpiar)
  limpiarAlDesmontar.current = limpiar
  useEffect(() => () => {
    volverA.current = null
    limpiarAlDesmontar.current()
  }, [])
  useEffect(() => {
    const alCerrar = () => {
      volverA.current = null
      void room.current?.disconnect()
    }
    window.addEventListener('pagehide', alCerrar)
    return () => window.removeEventListener('pagehide', alCerrar)
  }, [])

  // Lo que cada persona ha decidido de los sonidos de la junta (si suenan y por qué altavoz)
  useEffect(() => {
    ponerSonidosDeVoz({ activos: audio.sonidos, salida: audio.salida })
  }, [audio.sonidos, audio.salida])

  // Quien está en una junta está presente: el cierre por inactividad de los empleados no le cierra la sesión (y con ella la junta) por no tocar el ratón
  const conectada = actual?.estado === 'conectada'
  useEffect(() => {
    ponerJuntaConectada(conectada)
    return () => ponerJuntaConectada(false)
  }, [conectada])

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
      vistaGrande,
      ponerVistaGrande: setVistaGrande,
      voz,
      cambiarVoz,
      bloqueada: (canalId: string) => activas[canalId]?.bloqueada === true,
      ponerCandado,
      esperandoPuerta,
      responderPuerta,
    }),
    [voz, cambiarVoz, esperandoPuerta, ponerCandado, responderPuerta, disponible, activas, actual, version, puedePantalla, entrar, salir, alternar, audio, cambiarAudio, volumenes, ponerVolumen, ensordecido, alternarEnsordecer, vistaGrande]
  )
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div ref={audios} hidden aria-hidden />
    </Contexto.Provider>
  )
}
