'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createLocalAudioTrack, DisconnectReason, Room, RoomEvent, ScreenSharePresets, Track, type LocalAudioTrack } from 'livekit-client'

/**
 * LA PANTALLA COMPARTIDA, NÍTIDA (11 nov 2026: «no es de alta calidad»).
 *
 * Lo de LiveKit por defecto era 1080p a 2,5 Mbps, pensado para movimiento: el texto de una hoja o de Seller Central salía emborronado. Ahora:
 * hasta 1440p, `contentHint: 'detail'` (el navegador prioriza la nitidez sobre la fluidez), 15 fotogramas por segundo (para enseñar pantallas
 * sobran) y hasta 6 Mbps; si la conexión no da, baja los fotogramas antes que la resolución. Debajo queda una capa de 720p para quien tenga
 * la conexión floja o el recuadro pequeño.
 */
const CAPTURA_DE_PANTALLA = { audio: false, contentHint: 'detail' as const, resolution: { width: 2560, height: 1440, frameRate: 15 } }
const PUBLICACION_DE_PANTALLA = {
  screenShareEncoding: { maxBitrate: 6_000_000, maxFramerate: 15 },
  screenShareSimulcastLayers: [ScreenSharePresets.h720fps15],
  degradationPreference: 'maintain-resolution' as const,
}
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { AJUSTES_DE_AUDIO_POR_DEFECTO, CLAVE_DE_AUDIO, CLAVE_DE_VOLUMENES, leerAjustesDeAudio, leerVolumenes, limitarVolumen, limpiarAjustesDeAudio, restriccionesDeMicro, volumenEfectivo, type AjustesDeAudio, type Volumenes } from '@/lib/chat/audio'
import { CLAVE_DE_VUELTA, conCambiosRecientes, leerMetadatosDeSala, leerVuelta, MENSAJE_DE_SALA_CON_CANDADO, VIDA_DE_UN_CAMBIO_MS, type CambioDeSala, type JuntaActiva } from '@/lib/chat/junta'
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
  // La música de la sala viaja en los metadatos: cuando cambian, las pantallas se repintan (components/chat/MusicaProvider.tsx)
  RoomEvent.RoomMetadataChanged,
] as const

/** Cuántas veces se intenta volver sola a la junta si se corta sin que la persona la haya dejado (la red, el portátil que se duerme un momento) */
const INTENTOS_DE_VUELTA = 4
/** Las razones por las que NO se vuelve: alguien la ha cerrado a propósito o se ha entrado desde otro sitio con la misma persona (volver haría que las dos pestañas se echaran sin parar) */
const NO_VOLVER_POR = new Set<DisconnectReason | undefined>([DisconnectReason.CLIENT_INITIATED, DisconnectReason.DUPLICATE_IDENTITY, DisconnectReason.PARTICIPANT_REMOVED, DisconnectReason.ROOM_DELETED])

const mensajeDe = (e: unknown, por: string) => (e instanceof Error && e.message ? e.message : por)

/**
 * AL INSTANTE (12 nov 2026, «tiene que ir instantáneo»):
 *   · Al pulsar para entrar, tu presencia dice YA que estás en esa sala (los demás te ven sin esperar a la conexión), y el micrófono se pide a la vez que la llave y la conexión.
 *   · Quien entra o sale avisa con `accion` y el candado viaja dentro del aviso: los demás lo pintan al momento y lo mantienen unos segundos encima de lo que diga el servidor
 *     (conCambiosRecientes), porque LiveKit tarda un poco en contarlo y una lectura a destiempo lo deshacía.
 *   · Las lecturas de las juntas que llegan tarde (empezaron antes que otra más nueva) se tiran.
 *   · Si la página se recarga (tras un despliegue, Next recarga al cambiar de pantalla; «Actualizar»; un aviso que abre otra ruta), se vuelve sola a la misma junta.
 */
export function JuntaProvider({ children }: { children: ReactNode }) {
  const { cambioDeJunta, anunciarVoz, ponerVozDeLiveKit, respuestaDePuerta, yo } = useChat()
  const [disponible, setDisponible] = useState(false)
  // Lo que dice el servidor, y los cambios recién sabidos que se aplican encima
  const [activasDelServidor, setActivasDelServidor] = useState<Record<string, JuntaActiva>>({})
  const [cambios, setCambios] = useState<CambioDeSala[]>([])
  const [reloj, setReloj] = useState(0)
  const activas = useMemo(
    () => conCambiosRecientes(activasDelServidor, cambios, Date.now()),
    // `reloj` sube cuando un cambio caduca: se recalcula sin él
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activasDelServidor, cambios, reloj]
  )
  const apuntarCambio = useCallback((c: Omit<CambioDeSala, 'en'>) => {
    const en = Date.now()
    setCambios((l) => [...l.filter((x) => en - x.en < VIDA_DE_UN_CAMBIO_MS), { ...c, en }])
    setTimeout(() => setReloj((n) => n + 1), VIDA_DE_UN_CAMBIO_MS + 50)
  }, [])
  const [actual, setActual] = useState<ContextoDeJunta['actual']>(null)
  const [version, setVersion] = useState(0)
  const room = useRef<Room | null>(null)
  const audios = useRef<HTMLDivElement>(null)
  const conectando = useRef(false)
  const yoId = useRef(yo.id)
  yoId.current = yo.id
  const bump = useCallback(() => setVersion((v) => v + 1), [])

  // Lo que decides para ti (se guarda en este navegador): el audio y cuánto oyes a cada persona
  const [audio, setAudio] = useState<AjustesDeAudio>(AJUSTES_DE_AUDIO_POR_DEFECTO)
  const [volumenes, setVolumenes] = useState<Volumenes>({})
  const [ensordecido, setEnsordecido] = useState(false)
  const [vistaGrande, setVistaGrande] = useState(false)
  const [esperandoPuerta, setEsperandoPuerta] = useState<string | null>(null)
  // El candado que acabas de poner o quitar se ve AL INSTANTE, sin esperar al servidor; lo confirma lo que dice la sala y, si falla, se deshace
  const [candadoAlInstante, setCandadoAlInstante] = useState<Record<string, boolean>>({})
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

  // Cada lectura lleva su número: si llega después otra que empezó antes, se tira (traería lo de antes)
  const ultimaLectura = useRef(0)
  const leerActivas = useCallback(async () => {
    const n = ++ultimaLectura.current
    try {
      const r = await pedir<{ disponible: boolean; activas: JuntaActiva[] }>(`${BASE}/junta`)
      if (n !== ultimaLectura.current) return
      setDisponible(r.disponible)
      setActivasDelServidor(Object.fromEntries(r.activas.map((a) => [a.canalId, a])))
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
  // Un aviso de junta: si dice quién entra o sale o cómo queda el candado, se pinta YA y se relee un poco después (cuando LiveKit ya lo cuenta); si no, se relee ahora
  useEffect(() => {
    if (!cambioDeJunta) return
    const { canalId, de, accion, bloqueada } = cambioDeJunta
    if (accion || bloqueada !== undefined) {
      apuntarCambio({ canalId, ...(accion ? { persona: de, accion } : {}), ...(bloqueada !== undefined ? { bloqueada } : {}) })
      const t = setTimeout(() => void leerActivas(), 1500)
      return () => clearTimeout(t)
    }
    void leerActivas()
  }, [cambioDeJunta, leerActivas, apuntarCambio])
  // Lo que ve LiveKit se lo pasa al chat, que lo suma a la presencia (quién está en cada sala y quién cuenta como conectado)
  useEffect(() => {
    ponerVozDeLiveKit(Object.fromEntries(Object.values(activas).map((a) => [a.canalId, a.personas ?? []])))
  }, [activas, ponerVozDeLiveKit])
  // Al entrar o salir de una sala se avisa al servidor, que lo reparte a los del canal para que lo vean al momento
  const canalDeLaSala = useRef<string | null>(null)
  const avisarDeLaSala = useCallback((canalId: string, accion: 'entra' | 'sale') => {
    void pedir(`${BASE}/junta/aviso`, { metodo: 'POST', cuerpo: { canalId, accion } }).catch(() => undefined)
  }, [])

  const limpiar = useCallback(() => {
    const r = room.current
    room.current = null
    conectando.current = false
    const salida = canalDeLaSala.current
    canalDeLaSala.current = null
    if (salida) apuntarCambio({ canalId: salida, persona: yoId.current, accion: 'sale' })
    if (r) {
      r.removeAllListeners()
      // Se avisa en cuanto LiveKit ha soltado la conexión (los demás lo pintan al momento con `accion`)
      void r.disconnect().finally(() => salida && avisarDeLaSala(salida, 'sale'))
    } else if (salida) avisarDeLaSala(salida, 'sale')
    procesadorRef.current = null
    audios.current?.replaceChildren()
    ensordecidoRef.current = false
    setEnsordecido(false)
    anunciarVoz(null)
    setActual(null)
    bump()
  }, [anunciarVoz, avisarDeLaSala, apuntarCambio, bump])

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
      // Los demás te ven YA en la sala (la presencia viaja en milisegundos); si no se llega a entrar, se deshace
      anunciarVoz(canalId)
      // El micrófono se pide A LA VEZ que la llave y la conexión, no después: es lo que más tardaba en notarse
      let micro: LocalAudioTrack | null = null
      const pidiendoMicro = createLocalAudioTrack(restriccionesDeMicro(audioRef.current))
        .then((t) => (micro = t))
        .catch(() => null)
      const soltarMicro = () => void pidiendoMicro.then((t) => t?.stop())
      try {
        const llave = await pedir<{ token: string; url: string }>(`${BASE}/junta`, { metodo: 'POST', cuerpo: { canalId } })
        // `pixelDensity: 'screen'`: la calidad que se pide de cada vídeo va por los píxeles REALES del recuadro. Con el valor por defecto (1), en una pantalla Retina se
        // pedía la mitad de resolución y la pantalla compartida se veía borrosa (11 nov 2026)
        const nueva = new Room({ adaptiveStream: { pixelDensity: 'screen' }, dynacast: true, audioCaptureDefaults: restriccionesDeMicro(audioRef.current), ...(audioRef.current.salida ? { audioOutput: { deviceId: audioRef.current.salida } } : {}) })
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
        // El navegador no deja sonar hasta que se toca la página (pasa al volver solo tras una recarga): se ofrece un botón para oír a los demás
        nueva.on(RoomEvent.AudioPlaybackStatusChanged, () => {
          if (nueva.canPlaybackAudio) toast.dismiss('junta-audio')
          else toast.message('El navegador ha silenciado la junta', { id: 'junta-audio', duration: Infinity, action: { label: 'Activar el sonido', onClick: () => void nueva.startAudio() } })
        })
        await nueva.connect(llave.url, llave.token)
        if (room.current !== nueva) {
          soltarMicro()
          return
        }
        volverA.current = canalId
        intentosDeVuelta.current = 0
        setActual({ canalId, estado: 'conectada' })
        anunciarVoz(canalId)
        canalDeLaSala.current = canalId
        apuntarCambio({ canalId, persona: yoId.current, accion: 'entra' })
        avisarDeLaSala(canalId, 'entra')
        try {
          const pista = (await pidiendoMicro) ?? micro
          if (room.current !== nueva) {
            pista?.stop()
            return
          }
          if (pista) await nueva.localParticipant.publishTrack(pista, { source: Track.Source.Microphone })
          else await nueva.localParticipant.setMicrophoneEnabled(true)
          await aplicarVozAlMicro()
        } catch {
          toast.error('No se ha podido activar el micrófono: mira el permiso del navegador. Entras escuchando.')
        }
        bump()
      } catch (e) {
        soltarMicro()
        anunciarVoz(null)
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
    [actual?.canalId, anunciarVoz, avisarDeLaSala, apuntarCambio, aplicarVozAlMicro, bump, limpiar]
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
      const quitarAviso = () =>
        setCandadoAlInstante((o) => {
          if (!(canalId in o)) return o
          const n = { ...o }
          delete n[canalId]
          return n
        })
      setCandadoAlInstante((o) => ({ ...o, [canalId]: bloqueada }))
      toast.message(bloqueada ? 'Candado puesto: para entrar tendrán que llamar a la puerta.' : 'Candado quitado: la sala vuelve a estar abierta.')
      // Si por lo que sea la sala no llega a confirmarlo, el aviso local no se queda para siempre
      setTimeout(quitarAviso, 8000)
      try {
        await pedir(`${BASE}/junta/candado`, { metodo: 'POST', cuerpo: { canalId, bloqueada } })
      } catch (e) {
        quitarAviso()
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
        else if (lp.isScreenShareEnabled) await lp.setScreenShareEnabled(false)
        else await lp.setScreenShareEnabled(true, CAPTURA_DE_PANTALLA, PUBLICACION_DE_PANTALLA)
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
      // Si la página se va estando en una junta (una recarga, una navegación completa), se apunta en la pestaña para volver sola al cargar. Al cerrar la pestaña, la pestaña se lleva la nota
      const canal = room.current && volverA.current
      try {
        if (canal) window.sessionStorage.setItem(CLAVE_DE_VUELTA, JSON.stringify({ canalId: canal, en: Date.now() }))
      } catch {
        /* sin almacenamiento: no se vuelve sola */
      }
      volverA.current = null
      void room.current?.disconnect()
    }
    window.addEventListener('pagehide', alCerrar)
    return () => window.removeEventListener('pagehide', alCerrar)
  }, [])
  // Al cargar: si se estaba en una junta hace nada (la página se ha recargado), se vuelve a ella
  useEffect(() => {
    let canal: string | null = null
    try {
      canal = leerVuelta(window.sessionStorage.getItem(CLAVE_DE_VUELTA), Date.now())
    } catch {
      canal = null
    }
    if (!canal) return
    const id = canal
    const t = setTimeout(() => {
      // La nota se borra al usarla (no antes: en desarrollo React monta dos veces y se perdía)
      try {
        window.sessionStorage.removeItem(CLAVE_DE_VUELTA)
      } catch {
        /* nada */
      }
      if (!room.current) {
        volverA.current = id
        void entrarRef.current(id)
      }
    }, 300)
    return () => clearTimeout(t)
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

  /** ¿Tiene candado esta sala? Si estás dentro, lo dicen los metadatos de la sala (LiveKit los reparte al momento); si no, la lista de juntas */
  const bloqueadaDe = useCallback(
    (canalId: string): boolean => (actual?.canalId === canalId && room.current ? leerMetadatosDeSala(room.current.metadata).bloqueada : activas[canalId]?.bloqueada === true),
    // `version` sube con cada cambio de la sala (también los metadatos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actual?.canalId, activas, version]
  )
  // El aviso local se quita en cuanto la sala dice lo mismo
  useEffect(() => {
    setCandadoAlInstante((o) => {
      const n = { ...o }
      let cambia = false
      for (const [canalId, v] of Object.entries(o)) if (bloqueadaDe(canalId) === v) { delete n[canalId]; cambia = true }
      return cambia ? n : o
    })
  }, [bloqueadaDe])

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
      bloqueada: (canalId: string) => candadoAlInstante[canalId] ?? bloqueadaDe(canalId),
      ponerCandado,
      esperandoPuerta,
      responderPuerta,
    }),
    [candadoAlInstante, bloqueadaDe, voz, cambiarVoz, esperandoPuerta, ponerCandado, responderPuerta, disponible, activas, actual, version, puedePantalla, entrar, salir, alternar, audio, cambiarAudio, volumenes, ponerVolumen, ensordecido, alternarEnsordecer, vistaGrande]
  )
  return (
    <Contexto.Provider value={valor}>
      {children}
      <div ref={audios} hidden aria-hidden />
    </Contexto.Provider>
  )
}
