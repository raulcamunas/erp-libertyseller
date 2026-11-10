'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { FastForward, ListMusic, Music2, Pause, Play, Plus, Rewind, SkipBack, SkipForward, Trash2, Volume2, VolumeX, X } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { posicionActual, textoDeDuracion, type PistaDeMusica } from '@/lib/chat/musica'
import { cargarApiDeYouTube, type JugadorDeYouTube } from '@/lib/chat/youtube'
import { useChat } from './ChatProvider'
import { useMusica } from './MusicaProvider'

const CLAVE_DE_VOLUMEN = 'chat:musica-volumen'
const SALTO_MS = 10_000
/** Si la pista de este navegador se desvía de la de la sala más que esto, se recoloca */
const DESVIACION_MAXIMA_S = 2

const leerVolumen = (): number => {
  try {
    const v = Number(window.localStorage.getItem(CLAVE_DE_VOLUMEN))
    return Number.isFinite(v) && v >= 0 && v <= 100 && window.localStorage.getItem(CLAVE_DE_VOLUMEN) !== null ? v : 70
  } catch {
    return 70
  }
}

/** Un botón de los mandos */
function Mando({ titulo, alPulsar, children, grande, activo }: { titulo: string; alPulsar: () => void; children: React.ReactNode; grande?: boolean; activo?: boolean }) {
  return (
    <button type="button" className="musica-mando" data-grande={grande ? 'true' : undefined} data-activo={activo ? 'true' : undefined} onClick={alPulsar} aria-label={titulo} title={titulo}>
      {children}
    </button>
  )
}

/**
 * LA MÚSICA DE LA SALA: una tarjeta con el vídeo de YouTube (el reproductor oficial, a la vista: así lo exigen sus condiciones), los mandos (anterior, rebobinar 10 s, pausa, adelantar 10 s, siguiente), la barra
 * de progreso, un campo para pegar un enlace de YouTube (vídeo o lista entera) y la cola, donde se ve qué viene, se salta a una pista o se quita. Todo lo que se toca es COMPARTIDO: lo ve y lo oye toda la sala.
 * Lo único local es el volumen y cerrarla (dejas de escucharla tú solo). Cada navegador reproduce el vídeo por su cuenta y se recoloca si se desvía más de 2 segundos de la sala.
 */
export function ReproductorDeMusica() {
  const m = useMusica()
  const { nombreDe } = useChat()
  const { estado, visible } = m
  const pista: PistaDeMusica | undefined = estado.cola[estado.indice]
  const caja = useRef<HTMLDivElement>(null)
  const jugador = useRef<JugadorDeYouTube | null>(null)
  const cargada = useRef<string | null>(null)
  const [listo, setListo] = useState(false)
  const [bloqueado, setBloqueado] = useState(false)
  const [prog, setProg] = useState({ pos: 0, dur: 0 })
  const [buscando, setBuscando] = useState<number | null>(null)
  const [volumen, setVolumen] = useState(70)
  const [enlace, setEnlace] = useState('')
  const [anadiendo, setAnadiendo] = useState(false)
  const [colaAbierta, setColaAbierta] = useState(true)
  // Lo último, siempre a mano para los avisos del reproductor (llegan con el estado de cuando se creó)
  const ultima = useRef({ pista, m, estado })
  ultima.current = { pista, m, estado }
  const volumenRef = useRef(volumen)
  volumenRef.current = volumen

  useEffect(() => setVolumen(leerVolumen()), [])

  // Se crea el reproductor al abrir la tarjeta y se destruye al cerrarla
  useEffect(() => {
    if (!visible || !caja.current) return
    let vivo = true
    void cargarApiDeYouTube()
      .then((YT) => {
        if (!vivo || !caja.current) return
        const hijo = document.createElement('div')
        caja.current.replaceChildren(hijo)
        jugador.current = new YT.Player(hijo, {
          width: 320,
          height: 200,
          playerVars: { playsinline: 1, rel: 0, modestbranding: 1, controls: 0, disablekb: 1, origin: window.location.origin },
          events: {
            onReady: () => {
              if (!vivo) return
              jugador.current?.setVolume(volumenRef.current)
              setListo(true)
            },
            onStateChange: (e: { data: number }) => {
              if (e.data !== YT.PlayerState.ENDED) return
              const { pista: p, m: mm } = ultima.current
              // Todos los navegadores avisan del final; el servidor solo hace caso al primero (`desde`)
              if (p) void mm.accion({ accion: 'siguiente', desde: p.id })
            },
            onError: () => {
              const { pista: p, m: mm } = ultima.current
              if (!p) return
              toast.error(`«${p.titulo}» no se puede reproducir aquí: se salta.`)
              void mm.accion({ accion: 'siguiente', desde: p.id })
            },
          },
        })
      })
      .catch(() => toast.error('No se ha podido cargar YouTube.'))
    return () => {
      vivo = false
      setListo(false)
      cargada.current = null
      try {
        jugador.current?.destroy()
      } catch {
        /* ya no estaba */
      }
      jugador.current = null
    }
  }, [visible])

  // El reproductor sigue a la sala: la pista que toca, si suena o está en pausa, y por dónde va
  useEffect(() => {
    const j = jugador.current
    if (!listo || !j) return
    if (!pista) {
      j.stopVideo()
      cargada.current = null
      setBloqueado(false)
      return
    }
    const objetivo = posicionActual(estado, m.ahoraDelServidor()) / 1000
    if (cargada.current !== pista.id) {
      cargada.current = pista.id
      if (estado.reproduciendo) j.loadVideoById({ videoId: pista.videoId, startSeconds: objetivo })
      else j.cueVideoById({ videoId: pista.videoId, startSeconds: objetivo })
    } else {
      if (Math.abs(j.getCurrentTime() - objetivo) > DESVIACION_MAXIMA_S) j.seekTo(objetivo, true)
      if (estado.reproduciendo) j.playVideo()
      else j.pauseVideo()
    }
    if (!estado.reproduciendo) return setBloqueado(false)
    // El navegador puede negarse a sonar solo la primera vez: se avisa para que la persona pulse
    const t = setTimeout(() => {
      const YT = window.YT
      const st = jugador.current?.getPlayerState()
      setBloqueado(st !== undefined && st !== YT?.PlayerState.PLAYING && st !== YT?.PlayerState.BUFFERING)
    }, 2500)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [estado, listo, pista?.id])

  // La barra de progreso y, de paso, la recolocación si el vídeo se va quedando atrás o adelantado
  useEffect(() => {
    if (!listo) return
    let n = 0
    const t = setInterval(() => {
      const j = jugador.current
      if (!j) return
      setProg({ pos: j.getCurrentTime() * 1000, dur: j.getDuration() * 1000 })
      if (++n % 20 === 0) {
        const { estado: e, m: mm, pista: p } = ultima.current
        if (p && e.reproduciendo && cargada.current === p.id && j.getPlayerState() === window.YT?.PlayerState.PLAYING) {
          const objetivo = posicionActual(e, mm.ahoraDelServidor()) / 1000
          if (Math.abs(j.getCurrentTime() - objetivo) > DESVIACION_MAXIMA_S) j.seekTo(objetivo, true)
        }
      }
    }, 250)
    return () => clearInterval(t)
  }, [listo])

  const cambiarVolumen = useCallback((v: number) => {
    setVolumen(v)
    jugador.current?.setVolume(v)
    try {
      window.localStorage.setItem(CLAVE_DE_VOLUMEN, String(v))
    } catch {
      /* se queda para esta sesión */
    }
  }, [])

  if (!visible) return null
  const dur = prog.dur > 0 ? prog.dur : 0
  const pos = buscando ?? Math.min(prog.pos, dur || prog.pos)
  const enviar = async (e: React.FormEvent) => {
    e.preventDefault()
    const texto = enlace.trim()
    if (!texto || anadiendo) return
    setAnadiendo(true)
    const bien = await m.anadirEnlace(texto)
    setAnadiendo(false)
    if (bien) setEnlace('')
  }

  return (
    <aside className="musica-card" aria-label="Música de la sala">
      <header className="musica-cabecera">
        <Music2 className="h-4 w-4" />
        <b>Música de la sala</b>
        <span>{estado.cola.length === 0 ? 'Nada en la cola' : `${estado.indice + 1} de ${estado.cola.length}`}</span>
        <button type="button" className="chat-icono ml-auto" onClick={m.dejarDeEscuchar} aria-label="Dejar de escuchar la música (solo tú)" title="Dejar de escuchar (solo tú; a los demás les sigue sonando)">
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="musica-video" data-vacio={!pista ? 'true' : undefined}>
        <div ref={caja} className="musica-video-caja" />
        {!pista && <p className="musica-vacia"><Music2 className="h-6 w-6" />Pega un enlace de YouTube abajo para poner música a toda la sala.</p>}
        {bloqueado && (
          <button type="button" className="musica-activar" onClick={() => { jugador.current?.playVideo(); setBloqueado(false) }}>
            <Play className="h-5 w-5" /> Pulsa para escuchar
          </button>
        )}
      </div>

      <div className="musica-ahora">
        <b title={pista?.titulo}>{pista ? pista.titulo : 'Nada suena'}</b>
        <small>{pista ? `${pista.autor}${pista.anadidaPor ? ` · la puso ${nombreDe(pista.anadidaPor).split(' ')[0]}` : ''}` : 'La música es para toda la sala'}</small>
      </div>

      <div className="musica-barra">
        <span>{textoDeDuracion(pos)}</span>
        <input
          type="range"
          min={0}
          max={Math.max(1, Math.round(dur))}
          value={Math.round(pos)}
          disabled={!pista || dur === 0}
          onChange={(e) => setBuscando(Number(e.target.value))}
          onPointerUp={() => { if (buscando !== null) void m.accion({ accion: 'buscar', posMs: buscando }); setBuscando(null) }}
          onKeyUp={() => { if (buscando !== null) void m.accion({ accion: 'buscar', posMs: buscando }); setBuscando(null) }}
          aria-label="Posición en la canción"
        />
        <span>{dur ? textoDeDuracion(dur) : '--:--'}</span>
      </div>

      <div className="musica-mandos">
        <Mando titulo="Canción anterior (o volver al principio)" alPulsar={() => void m.accion({ accion: 'anterior' })}><SkipBack className="h-4 w-4" /></Mando>
        <Mando titulo="Rebobinar 10 segundos" alPulsar={() => void m.accion({ accion: 'saltar', ms: -SALTO_MS })}><Rewind className="h-4 w-4" /></Mando>
        <Mando grande titulo={estado.reproduciendo ? 'Pausar para todos' : 'Seguir para todos'} alPulsar={() => void m.accion({ accion: estado.reproduciendo ? 'pausar' : 'reanudar' })}>
          {estado.reproduciendo ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
        </Mando>
        <Mando titulo="Adelantar 10 segundos" alPulsar={() => void m.accion({ accion: 'saltar', ms: SALTO_MS })}><FastForward className="h-4 w-4" /></Mando>
        <Mando titulo="Siguiente canción" alPulsar={() => void m.accion({ accion: 'siguiente' })}><SkipForward className="h-4 w-4" /></Mando>
        <span className="musica-volumen" title="Tu volumen de la música (solo tuyo)">
          <button type="button" onClick={() => cambiarVolumen(volumen === 0 ? 70 : 0)} aria-label={volumen === 0 ? 'Quitar el silencio' : 'Silenciar la música (solo para ti)'}>
            {volumen === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <input type="range" min={0} max={100} value={volumen} onChange={(e) => cambiarVolumen(Number(e.target.value))} aria-label="Volumen de la música (solo tuyo)" />
        </span>
      </div>

      <form className="musica-anadir" onSubmit={enviar}>
        <input value={enlace} onChange={(e) => setEnlace(e.target.value)} placeholder="Pega un enlace de YouTube (canción, vídeo o lista)…" aria-label="Enlace de YouTube" />
        <button type="submit" disabled={!enlace.trim() || anadiendo} title="Añadir a la cola"><Plus className="h-4 w-4" />{anadiendo ? '…' : 'Añadir'}</button>
      </form>

      <div className="musica-cola-cabecera">
        <button type="button" onClick={() => setColaAbierta((a) => !a)} aria-expanded={colaAbierta}><ListMusic className="h-4 w-4" />Cola ({estado.cola.length})</button>
        {estado.cola.length > 0 && (
          <button type="button" onClick={() => window.confirm('¿Vaciar la cola para toda la sala?') && void m.accion({ accion: 'vaciar' })} title="Vaciar la cola"><Trash2 className="h-3.5 w-3.5" />Vaciar</button>
        )}
      </div>
      {colaAbierta && estado.cola.length > 0 && (
        <ol className="musica-cola">
          {estado.cola.map((p, i) => (
            <li key={p.id} data-actual={i === estado.indice ? 'true' : undefined}>
              <button type="button" className="musica-cola-pista" onClick={() => void m.accion({ accion: 'irA', indice: i })} title="Poner esta canción ahora">
                <img src={`https://i.ytimg.com/vi/${p.videoId}/default.jpg`} alt="" width={48} height={36} loading="lazy" />
                <span><b>{p.titulo}</b><small>{p.autor}</small></span>
                {i === estado.indice && estado.reproduciendo && <span className="musica-ecualizador" aria-label="Suena ahora"><i /><i /><i /></span>}
              </button>
              {p.anadidaPor && <span className="musica-cola-quien" title={`La puso ${nombreDe(p.anadidaPor)}`}><Avatar id={p.anadidaPor} nombre={nombreDe(p.anadidaPor)} tamano={18} /></span>}
              <button type="button" className="musica-cola-quitar" onClick={() => void m.accion({ accion: 'quitar', id: p.id })} aria-label={`Quitar «${p.titulo}» de la cola`} title="Quitar de la cola"><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ol>
      )}
      <p className="musica-aviso">Suena a la vez para todos los de la sala, cada uno en su navegador (no pasa por el micrófono).</p>
    </aside>
  )
}
