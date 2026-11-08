'use client'

import { useEffect, useRef, useState } from 'react'
import { BarChart3, Bell, BellOff, BellRing, Check, Lock, Moon, Pause, Play, Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { contarVotos, MAX_OPCIONES, MIN_OPCIONES } from '@/lib/chat/encuesta'
import type { NivelDeAvisos } from '@/lib/chat/avisos'
import type { AdjuntoChat, CanalChat, MensajeChat } from '@/lib/chat/tipos'
import { frasePorZona } from '@/lib/chat/zonas'
import { useChat } from './ChatProvider'
import { Ventana } from './Dialogos'

/* ------------------------------------------------------------------ */
/* Encuestas                                                           */
/* ------------------------------------------------------------------ */

export function TarjetaDeEncuesta({ m }: { m: MensajeChat }) {
  const { yo, votar, cerrarEncuesta, nombreDe } = useChat()
  const enc = m.encuesta
  if (!enc) return null
  const rec = contarVotos(enc, m.votos, yo.id)
  const puedeCerrar = !enc.cerrada && (m.autor_id === yo.id || yo.esAdmin)
  return (
    <div className="chat-encuesta" data-cerrada={enc.cerrada ? 'true' : undefined}>
      <div className="chat-encuesta-cabecera"><BarChart3 className="h-4 w-4" /><b>{enc.pregunta}</b></div>
      <small>{enc.cerrada ? 'Encuesta cerrada' : enc.multiple ? 'Puedes elegir varias opciones' : 'Elige una opción'}</small>
      <ul>
        {enc.opciones.map((o, i) => {
          const quienes = m.votos[i] ?? []
          return (
            <li key={i}>
              <button
                type="button"
                disabled={enc.cerrada}
                data-mia={rec.opciones[i].mio ? 'true' : undefined}
                title={quienes.length > 0 ? quienes.map((q) => nombreDe(q)).join(', ') : 'Sin votos todavía'}
                onClick={() => void votar(m.id, i).catch((e: Error) => toast.error(e.message))}
              >
                <span className="chat-encuesta-barra" style={{ width: `${rec.opciones[i].porcentaje}%` }} />
                <span className="chat-encuesta-marca">{rec.opciones[i].mio && <Check className="h-3.5 w-3.5" strokeWidth={3} />}</span>
                <span className="chat-encuesta-texto">{o}</span>
                <span className="chat-encuesta-cuenta">{rec.opciones[i].votos} · {rec.opciones[i].porcentaje}%</span>
              </button>
            </li>
          )
        })}
      </ul>
      <footer>
        <span>{rec.votantes} {rec.votantes === 1 ? 'persona ha votado' : 'personas han votado'}</span>
        {puedeCerrar && <button type="button" onClick={() => void cerrarEncuesta(m.id).catch((e: Error) => toast.error(e.message))}>Cerrar encuesta</button>}
      </footer>
    </div>
  )
}

export function DialogoDeEncuesta({ onCerrar, alCrear }: { onCerrar: () => void; alCrear: (e: { pregunta: string; opciones: string[]; multiple: boolean }) => Promise<void> }) {
  const [pregunta, setPregunta] = useState('')
  const [opciones, setOpciones] = useState(['', ''])
  const [multiple, setMultiple] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const validas = opciones.map((o) => o.trim()).filter(Boolean)
  const crear = async () => {
    setGuardando(true)
    try {
      await alCrear({ pregunta, opciones: validas, multiple })
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear la encuesta')
      setGuardando(false)
    }
  }
  return (
    <Ventana
      titulo="Crear una encuesta"
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" className="chat-boton-secundario" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="tc-boton-primario ml-auto disabled:opacity-50" disabled={guardando || !pregunta.trim() || validas.length < MIN_OPCIONES} onClick={() => void crear()}>Publicar encuesta</button>
        </>
      }
    >
      <label className="chat-campo">
        <span>Pregunta</span>
        <input autoFocus value={pregunta} maxLength={200} onChange={(e) => setPregunta(e.target.value)} placeholder="¿Comemos a las 14:00 o a las 15:00?" />
      </label>
      <div className="chat-campo">
        <span>Opciones <i>({validas.length} de {MAX_OPCIONES} como máximo)</i></span>
        {opciones.map((o, i) => (
          <div key={i} className="chat-fila-botones">
            <input value={o} maxLength={80} onChange={(e) => setOpciones((l) => l.map((x, j) => (j === i ? e.target.value : x)))} placeholder={`Opción ${i + 1}`} className="chat-opcion-encuesta" />
            {opciones.length > MIN_OPCIONES && <button type="button" className="chat-icono" onClick={() => setOpciones((l) => l.filter((_, j) => j !== i))} aria-label={`Quitar la opción ${i + 1}`}><X className="h-4 w-4" /></button>}
          </div>
        ))}
        {opciones.length < MAX_OPCIONES && <button type="button" className="chat-boton-secundario self-start" onClick={() => setOpciones((l) => [...l, ''])}><Plus className="inline h-3.5 w-3.5" /> Añadir una opción</button>}
      </div>
      <label className="chat-casilla"><input type="checkbox" checked={multiple} onChange={(e) => setMultiple(e.target.checked)} /> Se pueden elegir varias opciones</label>
    </Ventana>
  )
}

/* ------------------------------------------------------------------ */
/* Notas de voz                                                        */
/* ------------------------------------------------------------------ */

const VELOCIDADES = [1, 1.5, 2]
const formatoDeTiempo = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** Una nota de voz: reproducir, ir a un punto, cambiar la velocidad y, debajo, lo que dice (lo escribe la IA al terminar) */
export function NotaDeVoz({ a, reciente }: { a: AdjuntoChat; reciente: boolean }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [suena, setSuena] = useState(false)
  const [actual, setActual] = useState(0)
  const [duracion, setDuracion] = useState(a.duracion ?? 0)
  const [velocidad, setVelocidad] = useState(1)
  const alternar = () => {
    const el = audio.current
    if (!el) return
    if (el.paused) void el.play().catch(() => toast.error('No se ha podido reproducir el audio.'))
    else el.pause()
  }
  const cambiarVelocidad = () => {
    const v = VELOCIDADES[(VELOCIDADES.indexOf(velocidad) + 1) % VELOCIDADES.length]
    setVelocidad(v)
    if (audio.current) audio.current.playbackRate = v
  }
  return (
    <div className="chat-voz-caja">
      <div className="chat-voz">
        <button type="button" className="chat-voz-play" onClick={alternar} aria-label={suena ? 'Pausar' : 'Reproducir la nota de voz'}>{suena ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>
        <input type="range" min={0} max={Math.max(1, duracion)} step={0.1} value={Math.min(actual, Math.max(1, duracion))} onChange={(e) => { if (audio.current) audio.current.currentTime = Number(e.target.value) }} aria-label="Posición del audio" />
        <span className="chat-voz-tiempo">{formatoDeTiempo(suena || actual > 0 ? actual : duracion)}</span>
        <button type="button" className="chat-voz-velocidad" onClick={cambiarVelocidad} aria-label={`Velocidad ${velocidad}`}>{velocidad}×</button>
        <audio ref={audio} src={a.url} preload="metadata" onPlay={() => setSuena(true)} onPause={() => setSuena(false)} onEnded={() => { setSuena(false); setActual(0) }} onTimeUpdate={(e) => setActual(e.currentTarget.currentTime)} onLoadedMetadata={(e) => Number.isFinite(e.currentTarget.duration) && e.currentTarget.duration > 0 && setDuracion(e.currentTarget.duration)} />
      </div>
      {a.transcripcion ? <p className="chat-voz-texto">{a.transcripcion}</p> : a.transcripcion === undefined && reciente ? <p className="chat-voz-texto chat-voz-pendiente">Transcribiendo…</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Avisos por canal                                                    */
/* ------------------------------------------------------------------ */

const NIVELES: Array<{ id: NivelDeAvisos; nombre: string; detalle: string; icono: React.ReactNode }> = [
  { id: 'todo', nombre: 'Todos los mensajes', detalle: 'Te aviso de cada mensaje', icono: <BellRing className="h-4 w-4" /> },
  { id: 'menciones', nombre: 'Solo menciones', detalle: 'Cuando te nombran, te responden o hay un hilo tuyo', icono: <Bell className="h-4 w-4" /> },
  { id: 'nada', nombre: 'Nada', detalle: 'Silenciado: solo ves lo no leído', icono: <BellOff className="h-4 w-4" /> },
]

export function MenuDeAvisos({ canal }: { canal: CanalChat }) {
  const { cambiarAvisos } = useChat()
  const [abierto, setAbierto] = useState(false)
  const caja = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: PointerEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false)
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [abierto])
  const actual = NIVELES.find((n) => n.id === canal.avisos) ?? NIVELES[1]
  return (
    <span className="chat-menu-avisos" ref={caja}>
      <button type="button" className="chat-icono" onClick={() => setAbierto((v) => !v)} aria-label={`Avisos: ${actual.nombre}`} aria-expanded={abierto} title={`Avisos: ${actual.nombre}`} data-nivel={canal.avisos}>{actual.icono}</button>
      {abierto && (
        <span className="chat-menu-mensaje chat-menu-avisos-lista" role="menu">
          {NIVELES.map((n) => (
            <button key={n.id} type="button" role="menuitemradio" aria-checked={n.id === canal.avisos} onClick={() => { setAbierto(false); void cambiarAvisos(canal.id, n.id).catch((e: Error) => toast.error(e.message)) }}>
              {n.icono}
              <span><b>{n.nombre}</b><i>{n.detalle}</i></span>
              {n.id === canal.avisos && <Check className="ml-auto h-3.5 w-3.5" />}
            </button>
          ))}
        </span>
      )}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Hora local                                                          */
/* ------------------------------------------------------------------ */

/** «🕒 00:40 (lun)» con la hora que es allí; con una luna si es hora de descansar. Nada si la persona no ha puesto su zona */
export function HoraLocalDe({ id, conNombre }: { id: string | null | undefined; conNombre?: boolean }) {
  const { persona, yo } = useChat()
  const [, repintar] = useState(0)
  useEffect(() => {
    const t = setInterval(() => repintar((n) => n + 1), 60_000)
    return () => clearInterval(t)
  }, [])
  const p = persona(id)
  const miZona = persona(yo.id)?.zona ?? undefined
  const f = frasePorZona(p?.zona, Date.now(), miZona)
  if (!f || !id) return null
  return (
    <span className="chat-hora-local" data-descanso={f.descansando ? 'true' : undefined} title={`${f.nombreDeZona}${f.descansando ? ' · probablemente descansando' : ''}`}>
      {f.descansando ? <Moon className="h-3 w-3" /> : <span aria-hidden>🕒</span>} {f.texto}{conNombre ? ` · ${f.nombreDeZona}` : ''}
    </span>
  )
}

export function EtiquetaDeSlack() {
  return <span className="chat-etiqueta-slack" title="Mensaje importado de Slack"><Lock className="h-2.5 w-2.5" />Slack</span>
}
