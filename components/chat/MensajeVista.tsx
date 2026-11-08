'use client'

import { memo, useState } from 'react'
import { CornerUpLeft, MessageSquareReply, Pencil, SmilePlus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { horaDe } from '@/lib/chat/agrupar'
import { aTextoEditable, desdeTextoEditable, type Mencionado } from '@/lib/chat/mensajes'
import type { MensajeChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { TextoDeMensaje } from './TextoDeMensaje'

const RAPIDAS = ['👍', '❤️', '😂', '🎉', '👀', '🙏']

interface Props {
  m: MensajeChat
  continuacion: boolean
  /** Dentro del panel de un hilo no se vuelve a abrir otro hilo */
  enHilo?: boolean
  /** Ha llegado ahora, con el canal ya abierto: entra con animación (el historial no) */
  nuevo?: boolean
  puedeBorrarAjeno?: boolean
  alAbrirHilo?: (m: MensajeChat) => void
  /** Responder citando este mensaje */
  alCitar?: (m: MensajeChat) => void
  /** Ir al mensaje citado */
  alIrALaCita?: (id: number) => void
}

export const MensajeVista = memo(function MensajeVista({ m, continuacion, enHilo, nuevo, puedeBorrarAjeno, alAbrirHilo, alCitar, alIrALaCita }: Props) {
  const { yo, persona, nombreDe, editar, borrar, reaccionar } = useChat()
  const [editando, setEditando] = useState<{ texto: string; mencionados: Mencionado[] } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const autor = persona(m.autor_id)
  const mio = m.autor_id === yo.id
  const eliminado = m.borrado_en !== null

  const guardar = async () => {
    if (!editando) return
    const cuerpo = desdeTextoEditable(editando.texto, editando.mencionados).trim()
    if (!cuerpo) return toast.error('El mensaje no puede quedar vacío: bórralo si ya no lo quieres.')
    setGuardando(true)
    try {
      await editar(m.id, cuerpo)
      setEditando(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido editar')
    } finally {
      setGuardando(false)
    }
  }

  const alReaccionar = (emoji: string) => void reaccionar(m.id, emoji).catch((e: Error) => toast.error(e.message))
  const alBorrar = () => {
    if (!window.confirm('¿Borrar este mensaje? No se puede deshacer.')) return
    void borrar(m.id).catch((e: Error) => toast.error(e.message))
  }

  if (eliminado) {
    return (
      <div className="chat-mensaje" data-mensaje-id={m.id} data-continuacion={continuacion ? 'true' : undefined} data-eliminado="true" data-mio={mio ? 'true' : undefined}>
        <span className="chat-mensaje-lado" />
        <p className="chat-eliminado">Mensaje eliminado</p>
      </div>
    )
  }

  const reacciones = Object.entries(m.reacciones).filter(([, quienes]) => quienes.length > 0)
  return (
    <div
      className="chat-mensaje"
      data-mensaje-id={m.id}
      data-continuacion={continuacion ? 'true' : undefined}
      data-mio={mio ? 'true' : undefined}
      data-nuevo={nuevo ? 'true' : undefined}
      data-menciona-me={m.menciones.includes(yo.id) ? 'true' : undefined}
    >
      <span className="chat-mensaje-lado">
        {continuacion ? <time className="chat-hora-lado" dateTime={m.creado_en}>{horaDe(m.creado_en)}</time> : <Avatar id={m.autor_id ?? 'x'} nombre={autor?.nombre ?? 'Alguien'} tamano={34} />}
      </span>
      <div className="chat-mensaje-cuerpo">
        {!continuacion && (
          <p className="chat-mensaje-cabecera">
            <b>{mio ? 'Tú' : autor?.nombre ?? nombreDe(m.autor_id)}</b>
            <time dateTime={m.creado_en}>{horaDe(m.creado_en)}</time>
          </p>
        )}
        <div className="chat-burbuja">
          {m.cita && (
            <button type="button" className="chat-cita" onClick={() => alIrALaCita?.(m.cita!.id)} title="Ir al mensaje original" data-borrada={m.cita.borrado ? 'true' : undefined}>
              <CornerUpLeft className="h-3 w-3 shrink-0" />
              <b>{m.cita.autor_id === yo.id ? 'Tú' : nombreDe(m.cita.autor_id)}</b>
              <span>{m.cita.borrado ? 'Mensaje eliminado' : m.cita.texto}</span>
            </button>
          )}
          {editando ? (
            <div className="chat-edicion">
              <textarea
                autoFocus
                value={editando.texto}
                rows={Math.min(8, editando.texto.split('\n').length + 1)}
                maxLength={8000}
                onChange={(e) => setEditando({ ...editando, texto: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setEditando(null)
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault()
                    void guardar()
                  }
                }}
                aria-label="Editar el mensaje"
              />
              <span className="chat-edicion-botones">
                <button type="button" onClick={() => setEditando(null)}>Cancelar</button>
                <button type="button" onClick={() => void guardar()} disabled={guardando} data-primario="true">Guardar</button>
              </span>
            </div>
          ) : (
            m.cuerpo && <TextoDeMensaje cuerpo={m.cuerpo} editado={m.editado_en !== null} />
          )}
          {m.adjuntos.length > 0 && (
            <ul className="chat-adjuntos">
              {m.adjuntos.map((a) => (
                <li key={a.url}>
                  {a.tipo.startsWith('image/') ? (
                    <a href={a.url} target="_blank" rel="noopener noreferrer"><img src={a.url} alt={a.nombre} loading="lazy" className="chat-imagen" /></a>
                  ) : (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="chat-archivo">📎 {a.nombre}</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {reacciones.length > 0 && (
          <div className="chat-reacciones">
            {reacciones.map(([emoji, quienes]) => (
              // La clave lleva la cuenta: al cambiar, el botón se vuelve a montar y «salta»
              <button key={`${emoji}-${quienes.length}`} type="button" onClick={() => alReaccionar(emoji)} data-mia={quienes.includes(yo.id) ? 'true' : undefined} title={quienes.map((q) => nombreDe(q)).join(', ')}>
                <span>{emoji}</span> {quienes.length}
              </button>
            ))}
          </div>
        )}
        {!enHilo && m.respuestas > 0 && (
          <button type="button" className="chat-hilo-enlace" onClick={() => alAbrirHilo?.(m)}>
            <MessageSquareReply className="h-3 w-3" /> {m.respuestas} {m.respuestas === 1 ? 'respuesta' : 'respuestas'}
          </button>
        )}
      </div>
      {!editando && (
        <div className="chat-herramientas" role="toolbar" aria-label="Acciones del mensaje">
          {RAPIDAS.slice(0, 4).map((e) => (
            <button key={e} type="button" onClick={() => alReaccionar(e)} aria-label={`Reaccionar con ${e}`}>{e}</button>
          ))}
          <ReaccionarConOtra alElegir={alReaccionar} />
          {alCitar && (
            <button type="button" onClick={() => alCitar(m)} aria-label="Responder a este mensaje" title="Responder a este mensaje"><CornerUpLeft className="h-3.5 w-3.5" /></button>
          )}
          {!enHilo && (
            <button type="button" onClick={() => alAbrirHilo?.(m)} aria-label="Abrir un hilo" title="Responder en un hilo"><MessageSquareReply className="h-3.5 w-3.5" /></button>
          )}
          {mio && (
            <button type="button" onClick={() => setEditando(aTextoEditable(m.cuerpo, nombreDe))} aria-label="Editar" title="Editar"><Pencil className="h-3.5 w-3.5" /></button>
          )}
          {(mio || puedeBorrarAjeno) && (
            <button type="button" onClick={alBorrar} aria-label="Borrar" title="Borrar" data-peligro="true"><Trash2 className="h-3.5 w-3.5" /></button>
          )}
        </div>
      )}
    </div>
  )
})

const MAS_EMOJIS = ['😀', '😅', '🤔', '😮', '😢', '🔥', '💯', '✅', '❌', '⚡', '🚀', '👏', '💪', '🤝', '📌', '👌', '🙌', '😎']

function ReaccionarConOtra({ alElegir }: { alElegir: (emoji: string) => void }) {
  const [abierto, setAbierto] = useState(false)
  return (
    <span className="chat-mas-emojis">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-label="Más reacciones" aria-expanded={abierto} title="Más reacciones"><SmilePlus className="h-3.5 w-3.5" /></button>
      {abierto && (
        <span className="chat-emojis-menu" onMouseLeave={() => setAbierto(false)}>
          {[...RAPIDAS, ...MAS_EMOJIS].map((e) => (
            <button key={e} type="button" onClick={() => { alElegir(e); setAbierto(false) }}>{e}</button>
          ))}
        </span>
      )}
    </span>
  )
}
