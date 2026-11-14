'use client'

import { memo, useState } from 'react'
import { Bookmark, BookmarkCheck, Clock, Copy, CornerUpLeft, FileText, Image as ImageIcon, MessageSquareReply, MoreHorizontal, Paperclip, Pencil, Pin, PinOff, SmilePlus, Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { pedir } from '@/components/tareas-clientes/api'
import { esImagen, formatoDeTamano } from '@/lib/chat/archivos'
import { esMensajeTemporal, horaDe } from '@/lib/chat/agrupar'
import { aTextoEditable, desdeTextoEditable, type Mencionado } from '@/lib/chat/mensajes'
import { describirInstante } from '@/lib/chat/tiempo'
import type { AdjuntoChat, MensajeChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { esAvisoDeUnion, separarArchivosDeSlack } from '@/lib/chat/importado'
import { EtiquetaDeSlack, NotaDeVoz, TarjetaDeEncuesta } from './Extras'
import { ElegirHora, EmojiDeEstado, VisorDeImagen } from './Paneles'
import { TextoDeMensaje } from './TextoDeMensaje'
import { useMenuContextual, type OpcionDeMenu } from '@/components/ui/menu-contextual'

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
  const { yo, persona, nombreDe, editar, borrar, reaccionar, guardados, guardar: marcarGuardado, fijar } = useChat()
  const [editando, setEditando] = useState<{ texto: string; mencionados: Mencionado[] } | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [visor, setVisor] = useState<AdjuntoChat | null>(null)
  const [recordando, setRecordando] = useState(false)
  const menu = useMenuContextual()
  const guardado = guardados.has(m.id)
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

  // El clic derecho sobre un mensaje: lo mismo que la barra que sale al pasar el ratón, y copiar el texto
  const opcionesDelMenu = (): OpcionDeMenu[] => {
    if (eliminado || editando || esMensajeTemporal(m.id)) return []
    const lista: OpcionDeMenu[] = []
    if (alCitar) lista.push({ id: 'citar', nombre: 'Responder', icono: CornerUpLeft, accion: () => alCitar(m) })
    if (!enHilo) lista.push({ id: 'hilo', nombre: 'Responder en un hilo', icono: MessageSquareReply, accion: () => alAbrirHilo?.(m) })
    lista.push({ id: 'copiar', nombre: 'Copiar el texto', icono: Copy, accion: () => void navigator.clipboard?.writeText(aTextoEditable(m.cuerpo, nombreDe).texto).then(() => toast.success('Texto copiado')) })
    if (mio) lista.push({ id: 'editar', nombre: 'Editar', icono: Pencil, separar: true, accion: () => setEditando(aTextoEditable(m.cuerpo, nombreDe)) })
    lista.push({ id: 'guardar', nombre: guardado ? 'Quitar de guardados' : 'Guardar', icono: guardado ? BookmarkCheck : Bookmark, separar: !mio, accion: () => void marcarGuardado(m.id, !guardado).then(() => toast.success(guardado ? 'Quitado de guardados' : 'Guardado')).catch((e: Error) => toast.error(e.message)) })
    if (alCitar) lista.push({ id: 'fijar', nombre: m.fijado_en === null ? 'Fijar en el canal' : 'Quitar de fijados', icono: m.fijado_en === null ? Pin : PinOff, accion: () => void fijar(m.id, m.fijado_en === null).then(() => toast.success(m.fijado_en === null ? 'Fijado arriba del canal' : 'Quitado de fijados')).catch((e: Error) => toast.error(e.message)) })
    lista.push({ id: 'recordar', nombre: 'Recordármelo', icono: Clock, accion: () => setRecordando(true) })
    if (mio || puedeBorrarAjeno) lista.push({ id: 'borrar', nombre: 'Borrar', icono: Trash2, peligro: true, separar: true, accion: alBorrar })
    return lista
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
  const importado = Boolean(m.autor_externo && !m.autor_id)
  // Un «se ha unido al canal» de Slack es un aviso, no un mensaje: una línea discreta
  if (importado && esAvisoDeUnion(m.cuerpo)) {
    return (
      <div className="chat-sistema" data-mensaje-id={m.id}>
        <UserPlus className="h-3 w-3" /> <span>{m.cuerpo.trim().replace(/^@/, '')}</span> <time dateTime={m.creado_en}>{horaDe(m.creado_en)}</time>
      </div>
    )
  }
  // Los archivos de Slack no se han traído: se enseñan como etiquetas, no como líneas de texto
  const { texto: cuerpoLimpio, archivos: archivosDeSlack } = importado ? separarArchivosDeSlack(m.cuerpo) : { texto: m.cuerpo, archivos: [] }
  return (
    <div
      className="chat-mensaje"
      data-mensaje-id={m.id}
      data-continuacion={continuacion ? 'true' : undefined}
      data-mio={mio ? 'true' : undefined}
      data-nuevo={nuevo ? 'true' : undefined}
      data-enviando={esMensajeTemporal(m.id) ? 'true' : undefined}
      data-menciona-me={m.menciones.includes(yo.id) ? 'true' : undefined}
      onContextMenu={(e) => menu.abrir(e, opcionesDelMenu())}
    >
      <span className="chat-mensaje-lado">
        {continuacion ? <time className="chat-hora-lado" dateTime={m.creado_en}>{horaDe(m.creado_en)}</time> : <Avatar id={m.autor_id ?? `slack-${m.autor_externo ?? 'x'}`} nombre={autor?.nombre ?? m.autor_externo ?? 'Alguien'} tamano={34} />}
      </span>
      <div className="chat-mensaje-cuerpo">
        {!continuacion && (
          <p className="chat-mensaje-cabecera">
            <b>{mio ? 'Tú' : autor?.nombre ?? m.autor_externo ?? nombreDe(m.autor_id)}</b>
            {m.autor_externo && !m.autor_id && <EtiquetaDeSlack />}
            <EmojiDeEstado id={m.autor_id} />
            <time dateTime={m.creado_en}>{horaDe(m.creado_en)}</time>
            {m.fijado_en && <span className="chat-marca-fijado" title="Fijado arriba del canal"><Pin className="h-3 w-3" /> Fijado</span>}
            {guardado && <BookmarkCheck className="h-3 w-3 text-[var(--c-acc,var(--ls-acc))]" aria-label="Guardado" />}
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
            cuerpoLimpio && !m.encuesta && <TextoDeMensaje cuerpo={cuerpoLimpio} editado={m.editado_en !== null} />
          )}
          {archivosDeSlack.length > 0 && (
            <ul className="chat-archivos-slack">
              {archivosDeSlack.map((a, i) => (
                <li key={i} className="chat-archivo-slack" data-tipo={a.tipo} title={`${a.nombre} (archivo de Slack, no importado)`}>
                  {a.tipo === 'imagen' ? <ImageIcon className="h-3.5 w-3.5" /> : <Paperclip className="h-3.5 w-3.5" />}
                  <span>{{ imagen: 'Imagen', pdf: 'PDF', audio: 'Audio', video: 'Vídeo', hoja: 'Hoja de cálculo', archivo: 'Archivo' }[a.tipo]}{a.extension && a.tipo !== 'pdf' ? ` · ${a.extension}` : ''}</span>
                </li>
              ))}
            </ul>
          )}
          {m.encuesta && <TarjetaDeEncuesta m={m} />}
          {m.adjuntos.length > 0 && (
            <ul className="chat-adjuntos">
              {m.adjuntos.map((a) => (
                <li key={a.ruta ?? a.url}>
                  {a.voz ? (
                    <NotaDeVoz a={a} reciente={Date.now() - Date.parse(m.creado_en) < 180_000} />
                  ) : esImagen(a.tipo, a.nombre) ? (
                    <button type="button" className="chat-imagen-boton" onClick={() => setVisor(a)} aria-label={`Ver ${a.nombre}`}><img src={a.url} alt={a.nombre} loading="lazy" className="chat-imagen" /></button>
                  ) : (
                    <a href={a.url} target="_blank" rel="noopener noreferrer" className="chat-archivo" download={a.nombre}>
                      <FileText className="h-4 w-4 shrink-0" />
                      <span><b>{a.nombre}</b><i>{formatoDeTamano(a.tamano)}</i></span>
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        {visor && <VisorDeImagen adjunto={visor} onCerrar={() => setVisor(null)} />}
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
      {!editando && !esMensajeTemporal(m.id) && (
        <div className="chat-herramientas" role="toolbar" aria-label="Acciones del mensaje">
          {RAPIDAS.slice(0, 3).map((e) => (
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
          <MasAcciones
            guardado={guardado}
            fijado={m.fijado_en !== null}
            puedeFijar={Boolean(alCitar)}
            alGuardar={() => void marcarGuardado(m.id, !guardado).then(() => toast.success(guardado ? 'Quitado de guardados' : 'Guardado')).catch((e: Error) => toast.error(e.message))}
            alFijar={() => void fijar(m.id, m.fijado_en === null).then(() => toast.success(m.fijado_en === null ? 'Fijado arriba del canal' : 'Quitado de fijados')).catch((e: Error) => toast.error(e.message))}
            alRecordar={() => setRecordando(true)}
          />
        </div>
      )}
      {recordando && (
        <ElegirHora
          titulo="Recordármelo"
          ayuda="Te avisaré por la campana (y el móvil) a esa hora."
          onElegir={async (avisarEn) => {
            await pedir('/api/chat/recordatorios', { metodo: 'POST', cuerpo: { mensajeId: m.id, avisarEn } })
            toast.success(`Te lo recordaré ${describirInstante(Date.parse(avisarEn))}`)
          }}
          onCerrar={() => setRecordando(false)}
        />
      )}
      {menu.elemento}
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

function MasAcciones({ guardado, fijado, puedeFijar, alGuardar, alFijar, alRecordar }: { guardado: boolean; fijado: boolean; puedeFijar: boolean; alGuardar: () => void; alFijar: () => void; alRecordar: () => void }) {
  const [abierto, setAbierto] = useState(false)
  const elegir = (f: () => void) => () => {
    setAbierto(false)
    f()
  }
  return (
    <span className="chat-mas-emojis">
      <button type="button" onClick={() => setAbierto((v) => !v)} aria-label="Más acciones" aria-expanded={abierto} title="Más acciones"><MoreHorizontal className="h-3.5 w-3.5" /></button>
      {abierto && (
        <span className="chat-menu-mensaje" role="menu" onMouseLeave={() => setAbierto(false)}>
          <button type="button" role="menuitem" onClick={elegir(alGuardar)}>{guardado ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />} {guardado ? 'Quitar de guardados' : 'Guardar'}</button>
          {puedeFijar && <button type="button" role="menuitem" onClick={elegir(alFijar)}>{fijado ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />} {fijado ? 'Quitar de fijados' : 'Fijar en el canal'}</button>}
          <button type="button" role="menuitem" onClick={elegir(alRecordar)}><Clock className="h-3.5 w-3.5" /> Recordármelo</button>
        </span>
      )}
    </span>
  )
}
