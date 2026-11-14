'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { MAX_COLA, MUSICA_VACIA, leerEnlaceDeYouTube, normalizarEstadoDeMusica, type EstadoDeMusica } from '@/lib/chat/musica'
import { expandirListaDeYouTube } from '@/lib/chat/youtube'
import { useJunta } from './JuntaProvider'

const URL_DE_MUSICA = '/api/chat/musica'
const PEDIR_HORA_CADA_MS = 60_000

interface ContextoDeMusica {
  /** Lo que suena en la sala en la que estás (vacío si no estás en ninguna) */
  estado: EstadoDeMusica
  /** La sala en la que estás conectado, o null */
  canalId: string | null
  /** La hora del servidor ahora: con ella cada navegador calcula por dónde va la pista */
  ahoraDelServidor: () => number
  /** Hacer algo con la música de la sala (ver app/api/chat/musica) */
  accion: (cuerpo: Record<string, unknown>) => Promise<void>
  /** Añadir un enlace de YouTube: un vídeo o una lista entera */
  anadirEnlace: (texto: string) => Promise<boolean>
  /** El reproductor está a la vista (y esta persona escucha) */
  visible: boolean
  /** Abrir o cerrar el reproductor (cerrarlo es dejar de escucharla, solo tú) */
  alternarPanel: () => void
  dejarDeEscuchar: () => void
  hayMusica: boolean
}

const Vacio: ContextoDeMusica = { estado: { ...MUSICA_VACIA, cola: [] }, canalId: null, ahoraDelServidor: () => Date.now(), accion: async () => undefined, anadirEnlace: async () => false, visible: false, alternarPanel: () => undefined, dejarDeEscuchar: () => undefined, hayMusica: false }
const Contexto = createContext<ContextoDeMusica>(Vacio)
export const useMusica = (): ContextoDeMusica => useContext(Contexto)

const mensajeDe = (e: unknown, por: string) => (e instanceof Error && e.message ? e.message : por)

/**
 * LA MÚSICA COMPARTIDA DE LA SALA DE VOZ: el estado (cola, pista, pausa, posición) viaja en los metadatos de la sala de LiveKit y llega a todos a la vez; cada persona lo reproduce en su navegador con el
 * reproductor de YouTube (components/chat/ReproductorDeMusica.tsx). Esto lee el estado, lo mantiene al día y manda las acciones al servidor (lib/chat/musica-servidor.ts). Vive con la junta, así que la música
 * sigue al cambiar de pantalla.
 */
export function MusicaProvider({ children }: { children: ReactNode }) {
  const { actual, room, version } = useJunta()
  const canalId = actual?.estado === 'conectada' ? actual.canalId : null
  const [sobrescrito, setSobrescrito] = useState<EstadoDeMusica | null>(null)
  const [panel, setPanel] = useState(false)
  const [escuchando, setEscuchando] = useState(true)
  const desfase = useRef(0)

  const delaSala = useMemo<EstadoDeMusica>(() => {
    if (!canalId || !room) return { ...MUSICA_VACIA, cola: [] }
    try {
      return normalizarEstadoDeMusica((JSON.parse(room.metadata || '{}') as { musica?: unknown }).musica)
    } catch {
      return { ...MUSICA_VACIA, cola: [] }
    }
    // `version` sube con cada cambio de la sala (también los metadatos)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room, version, canalId])
  // La respuesta de lo que acabas de hacer se ve al instante; después manda lo que dice la sala (si es más nuevo)
  const estado = sobrescrito && sobrescrito.v > delaSala.v ? sobrescrito : delaSala

  // Al cambiar de sala (o salir), se olvida lo local
  useEffect(() => {
    setSobrescrito(null)
    setEscuchando(true)
    setPanel(false)
  }, [canalId])

  // La hora del servidor, para saber por dónde va la pista aunque el reloj de este equipo vaya adelantado o atrasado
  useEffect(() => {
    if (!canalId) return
    let vivo = true
    const pedirHora = () => {
      const antes = Date.now()
      pedir<{ ahora: number }>(`${URL_DE_MUSICA}?canalId=${canalId}`)
        .then((r) => vivo && (desfase.current = r.ahora - (antes + Date.now()) / 2))
        .catch(() => undefined)
    }
    pedirHora()
    const t = setInterval(pedirHora, PEDIR_HORA_CADA_MS)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [canalId])
  const ahoraDelServidor = useCallback(() => Date.now() + desfase.current, [])

  const accion = useCallback(
    async (cuerpo: Record<string, unknown>) => {
      if (!canalId) return
      try {
        const r = await pedir<{ estado: EstadoDeMusica; ahora: number }>(URL_DE_MUSICA, { metodo: 'POST', cuerpo: { canalId, ...cuerpo } })
        setSobrescrito(normalizarEstadoDeMusica(r.estado))
      } catch (e) {
        toast.error(mensajeDe(e, 'No se ha podido hacer eso con la música.'))
      }
    },
    [canalId]
  )

  const anadirIds = useCallback(
    async (ids: string[]): Promise<boolean> => {
      if (!canalId || ids.length === 0) return false
      try {
        const r = await pedir<{ estado: EstadoDeMusica; anadidas?: number; descartadas?: number }>(URL_DE_MUSICA, { metodo: 'POST', cuerpo: { canalId, accion: 'anadir', ids } })
        setSobrescrito(normalizarEstadoDeMusica(r.estado))
        const n = r.anadidas ?? ids.length
        const d = r.descartadas ?? 0
        toast.success(`${n === 1 ? 'Añadida 1 canción' : `Añadidas ${n} canciones`}${d > 0 ? ` (${d} no se pueden reproducir aquí)` : ''}`)
        return true
      } catch (e) {
        toast.error(mensajeDe(e, 'No se ha podido añadir.'))
        return false
      }
    },
    [canalId]
  )

  const anadirLista = useCallback(
    async (listaId: string) => {
      const cargando = toast.loading('Leyendo la lista de YouTube…')
      try {
        const ids = await expandirListaDeYouTube(listaId, MAX_COLA)
        toast.dismiss(cargando)
        if (ids.length === 0) return void toast.error('No he podido leer esa lista (¿es privada o no existe?).')
        await anadirIds(ids)
      } catch {
        toast.dismiss(cargando)
        toast.error('No se ha podido leer la lista.')
      }
    },
    [anadirIds]
  )

  const anadirEnlace = useCallback(
    async (texto: string): Promise<boolean> => {
      const e = leerEnlaceDeYouTube(texto)
      if (!e) {
        toast.error('Eso no parece un enlace de YouTube (un vídeo, una canción de YouTube Music o una lista).')
        return false
      }
      if (e.esPaginaDeLista && e.listaId) {
        await anadirLista(e.listaId)
        return true
      }
      if (!e.videoId) return false
      const ok = await anadirIds([e.videoId])
      // Un vídeo dentro de una lista: se añade el vídeo y se ofrece traerse la lista entera
      if (ok && e.listaId) toast.message('Ese vídeo está dentro de una lista.', { action: { label: 'Añadir toda la lista', onClick: () => void anadirLista(e.listaId as string) } })
      return ok
    },
    [anadirIds, anadirLista]
  )

  const hayMusica = estado.cola.length > 0
  const visible = canalId !== null && escuchando && (panel || hayMusica)
  const valor = useMemo<ContextoDeMusica>(
    () => ({
      estado,
      canalId,
      ahoraDelServidor,
      accion,
      anadirEnlace,
      visible,
      alternarPanel: () => {
        // Si no estabas escuchando, pulsar «Música» vuelve a abrirla; si estaba a la vista, la cierra (dejas de escucharla tú solo)
        if (visible) {
          setPanel(false)
          setEscuchando(false)
        } else {
          setEscuchando(true)
          setPanel(true)
        }
      },
      dejarDeEscuchar: () => {
        setPanel(false)
        setEscuchando(false)
      },
      hayMusica,
    }),
    [estado, canalId, ahoraDelServidor, accion, anadirEnlace, visible, hayMusica]
  )
  return <Contexto.Provider value={valor}>{children}</Contexto.Provider>
}
