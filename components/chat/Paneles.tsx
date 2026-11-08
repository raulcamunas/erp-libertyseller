'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bookmark, CalendarClock, Clock, Download, Loader2, Pin, PinOff, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { horaDe } from '@/lib/chat/agrupar'
import { DURACIONES, ESTADOS_RAPIDOS } from '@/lib/chat/estado'
import { textoPlano } from '@/lib/chat/mensajes'
import { OPCIONES_RAPIDAS, instanteDeOpcion } from '@/lib/chat/recordatorios'
import { desdeCampoDeFecha, describirInstante, haciaCampoDeFecha } from '@/lib/chat/tiempo'
import type { AdjuntoChat, ItemDeBandeja, ResumenDeCanal } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { Ventana } from './Dialogos'

/** El emoji del estado de una persona («📅»), con su texto al pasar el ratón. Nada si no tiene */
export function EmojiDeEstado({ id }: { id: string | null | undefined }) {
  const { estadoDe } = useChat()
  const e = estadoDe(id)
  if (!e || !e.emoji) return null
  return <span className="chat-emoji-estado" title={e.texto || undefined} aria-label={e.texto ? `Estado: ${e.texto}` : 'Estado'}>{e.emoji}</span>
}

/** Elegir una hora: opciones rápidas («en 1 hora», «mañana a las 9»…) o una fecha y hora concretas. Todo en hora de España */
export function ElegirHora({ titulo, ayuda, onElegir, onCerrar, children }: { titulo: string; ayuda?: string; onElegir: (iso: string) => Promise<void> | void; onCerrar: () => void; children?: React.ReactNode }) {
  const [personalizada, setPersonalizada] = useState(() => haciaCampoDeFecha(Date.now() + 3_600_000))
  const [ocupado, setOcupado] = useState(false)
  const ahora = Date.now()
  const elegir = async (ms: number) => {
    setOcupado(true)
    try {
      await onElegir(new Date(ms).toISOString())
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
      setOcupado(false)
    }
  }
  const propia = desdeCampoDeFecha(personalizada)
  return (
    <Ventana titulo={titulo} onCerrar={onCerrar}>
      {ayuda && <p className="text-[12.5px] text-[var(--ls-t3)]">{ayuda}</p>}
      {children}
      <ul className="chat-horas">
        {OPCIONES_RAPIDAS.map((o) => {
          const ms = instanteDeOpcion(o.id, ahora)
          return (
            <li key={o.id}>
              <button type="button" disabled={ocupado} onClick={() => void elegir(ms)}>
                <Clock className="h-3.5 w-3.5" /> <b>{o.nombre}</b> <span>{o.id === 'manana' || o.id === 'lunes' ? new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(ms)) : describirInstante(ms, ahora)}</span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="chat-campo">
        <span>O elige una fecha y una hora</span>
        <div className="chat-fila-botones">
          <input type="datetime-local" value={personalizada} onChange={(e) => setPersonalizada(e.target.value)} className="chat-fecha" aria-label="Fecha y hora" />
          <button type="button" className="tc-boton-primario disabled:opacity-50" disabled={ocupado || propia === null} onClick={() => propia !== null && void elegir(propia)}>
            {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Elegir
          </button>
        </div>
        {propia !== null && <small>{describirInstante(propia, ahora)} (hora de España)</small>}
      </div>
    </Ventana>
  )
}

/** Una imagen a pantalla completa */
export function VisorDeImagen({ adjunto, onCerrar }: { adjunto: AdjuntoChat; onCerrar: () => void }) {
  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])
  const visor = (
    <div className="chat-visor" role="dialog" aria-modal="true" aria-label={adjunto.nombre} onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <header>
        <span>{adjunto.nombre}</span>
        <a href={adjunto.url} target="_blank" rel="noopener noreferrer" download={adjunto.nombre} className="chat-icono" aria-label="Abrir o descargar"><Download className="h-4 w-4" /></a>
        <button type="button" className="chat-icono" onClick={onCerrar} aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </header>
      <img src={adjunto.url} alt={adjunto.nombre} />
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(visor, document.body)
}

/** Una línea de una lista de mensajes (fijados, menciones, guardados): quién, dónde, cuándo y el principio del texto */
export function FilaDeMensaje({ item, extra, onAbrir }: { item: ItemDeBandeja; extra?: React.ReactNode; onAbrir: () => void }) {
  const { persona, nombreDe, canales, yo } = useChat()
  const m = item.mensaje
  const canal = canales.find((c) => c.id === item.canalId)
  const donde = !canal ? '' : canal.tipo === 'directo' ? `Con ${nombreDe(canal.miembros.find((x) => x !== yo.id))}` : `${canal.tipo === 'privado' ? '🔒' : '#'}${canal.nombre}`
  return (
    <li className="chat-fila-mensaje">
      <button type="button" onClick={onAbrir}>
        <Avatar id={m.autor_id ?? 'x'} nombre={persona(m.autor_id)?.nombre ?? 'Alguien'} tamano={30} />
        <span className="chat-fila-mensaje-cuerpo">
          <span className="chat-fila-mensaje-cabecera"><b>{m.autor_id === yo.id ? 'Tú' : nombreDe(m.autor_id)}</b><i>{donde}</i><time dateTime={m.creado_en}>{describirInstante(Date.parse(m.creado_en)).replace(/ a las .*/, '')} · {horaDe(m.creado_en)}</time></span>
          <span className="chat-fila-mensaje-texto">{textoPlano(m.cuerpo, (id) => nombreDe(id).split(' ')[0], 200) || (m.adjuntos.length > 0 ? '📎 Archivo adjunto' : 'Mensaje')}</span>
        </span>
      </button>
      {extra}
    </li>
  )
}

/** Los mensajes fijados de un canal */
export function DialogoDeFijados({ canalId, nombre, onCerrar }: { canalId: string; nombre: string; onCerrar: () => void }) {
  const { irAMensaje, fijar } = useChat()
  const [items, setItems] = useState<ItemDeBandeja[] | null>(null)
  useEffect(() => {
    let vivo = true
    pedir<{ items: ItemDeBandeja[] }>(`/api/chat/bandeja?tipo=fijados&canalId=${canalId}`)
      .then((r) => vivo && setItems(r.items))
      .catch((e: Error) => {
        toast.error(e.message)
        if (vivo) setItems([])
      })
    return () => {
      vivo = false
    }
  }, [canalId])
  return (
    <Ventana titulo={`Fijados en ${nombre}`} onCerrar={onCerrar}>
      {items === null && <div className="tc-esqueleto h-16 w-full" role="status" aria-label="Cargando" />}
      {items?.length === 0 && <p className="chat-sin-nada"><Pin className="h-5 w-5" /> Aún no hay nada fijado. Fija un mensaje desde el menú «⋯» del propio mensaje.</p>}
      <ul className="chat-lista-mensajes">
        {items?.map((it) => (
          <FilaDeMensaje
            key={it.mensaje.id}
            item={it}
            onAbrir={() => {
              onCerrar()
              void irAMensaje(it.canalId, it.mensaje.id, it.mensaje.hilo_de)
            }}
            extra={
              <button type="button" className="chat-icono" aria-label="Quitar de fijados" title="Quitar de fijados" onClick={() => void fijar(it.mensaje.id, false).then(() => setItems((l) => l && l.filter((x) => x.mensaje.id !== it.mensaje.id))).catch((e: Error) => toast.error(e.message))}>
                <PinOff className="h-4 w-4" />
              </button>
            }
          />
        ))}
      </ul>
    </Ventana>
  )
}

/** «Ponme al día»: lo que la IA resume de lo que no has leído */
export function DialogoDeResumen({ canalId, nombre, onCerrar }: { canalId: string; nombre: string; onCerrar: () => void }) {
  const [r, setR] = useState<ResumenDeCanal | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let vivo = true
    pedir<ResumenDeCanal>('/api/chat/resumen', { metodo: 'POST', cuerpo: { canalId } })
      .then((x) => vivo && setR(x))
      .catch((e: Error) => vivo && setError(e.message))
    return () => {
      vivo = false
    }
  }, [canalId])
  const Lista = ({ titulo, puntos }: { titulo: string; puntos: string[] }) =>
    puntos.length === 0 ? null : (
      <section className="chat-resumen-bloque">
        <h3>{titulo}</h3>
        <ul>{puntos.map((p, i) => <li key={i}>{p}</li>)}</ul>
      </section>
    )
  return (
    <Ventana titulo={`Ponme al día · ${nombre}`} onCerrar={onCerrar}>
      {!r && !error && (
        <p className="chat-resumen-espera"><Sparkles className="h-4 w-4" /> Leyendo la conversación…</p>
      )}
      {error && <p role="alert" className="text-[var(--ls-e-rojo)]">{error}</p>}
      {r && (
        <div className="chat-resumen">
          {r.resumen && <p className="chat-resumen-texto">{r.resumen}</p>}
          <Lista titulo="Se ha decidido" puntos={r.decisiones} />
          <Lista titulo="Pendiente" puntos={r.pendientes} />
          <Lista titulo="Sin contestar" puntos={r.preguntas} />
          <small>Resumen automático de {r.mensajes} {r.mensajes === 1 ? 'mensaje' : 'mensajes'}. Puede tener errores: ante la duda, mira el canal.</small>
        </div>
      )}
    </Ventana>
  )
}

/** Tu estado: elegir uno rápido o escribir el tuyo, y cuándo se quita solo */
export function EstadoPropio({ onCerrar }: { onCerrar: () => void }) {
  const { yo, estadoDe, ponerEstado } = useChat()
  const actual = estadoDe(yo.id)
  const [emoji, setEmoji] = useState(actual?.emoji ?? '💬')
  const [texto, setTexto] = useState(actual?.texto ?? '')
  const [duracion, setDuracion] = useState('1h')
  const [ocupado, setOcupado] = useState(false)
  const guardar = async (e: string, t: string, d: string) => {
    setOcupado(true)
    try {
      await ponerEstado(e, t, d)
      onCerrar()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'No se ha podido guardar')
      setOcupado(false)
    }
  }
  return (
    <div className="chat-estado-panel" role="dialog" aria-label="Tu estado">
      <header>
        <b>Tu estado</b>
        <button type="button" className="chat-icono" onClick={onCerrar} aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </header>
      <ul className="chat-estados-rapidos">
        {ESTADOS_RAPIDOS.map((e) => (
          <li key={e.texto}>
            <button type="button" disabled={ocupado} onClick={() => void guardar(e.emoji, e.texto, e.duracion)}>
              <span>{e.emoji}</span> {e.texto}
            </button>
          </li>
        ))}
      </ul>
      <div className="chat-estado-propio">
        <input className="chat-estado-emoji" value={emoji} maxLength={8} onChange={(e) => setEmoji(e.target.value)} aria-label="Emoji" />
        <input value={texto} maxLength={60} onChange={(e) => setTexto(e.target.value)} placeholder="¿Qué estás haciendo?" aria-label="Texto del estado" onKeyDown={(e) => e.key === 'Enter' && void guardar(emoji, texto, duracion)} />
      </div>
      <label className="chat-estado-duracion">
        <span>Quitarlo</span>
        <select value={duracion} onChange={(e) => setDuracion(e.target.value)}>
          {DURACIONES.map((d) => <option key={d.id} value={d.id}>{d.nombre}</option>)}
        </select>
      </label>
      <div className="chat-fila-botones">
        <button type="button" className="tc-boton-primario disabled:opacity-50" disabled={ocupado || (!emoji.trim() && !texto.trim())} onClick={() => void guardar(emoji, texto, duracion)}>Guardar</button>
        {actual && <button type="button" className="chat-boton-secundario" disabled={ocupado} onClick={() => void guardar('', '', 'siempre')}>Quitar estado</button>}
      </div>
    </div>
  )
}

export const ICONOS_DE_BANDEJA = { guardados: Bookmark, recordatorios: Clock, programados: CalendarClock }
