'use client'

import { Lock, Hash, Settings2, X } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { EVENTO_AJUSTES_DEL_CANAL, ponerMiembrosVisibles, useMiembrosVisibles } from '@/lib/chat/miembros-estado'
import { useChat } from './ChatProvider'
import { EmojiDeEstado } from './Paneles'
import { HoraLocalDe } from './Extras'

/** ¿Hay que enseñar la barra de miembros? Solo en canales (no en directos), con el chat en su vista de canal y sin un hilo abierto (el hilo ocupa su sitio) */
export function useMiembrosALaVista(): boolean {
  const { actual, hilo, vista } = useChat()
  const visible = useMiembrosVisibles()
  return visible && !hilo && vista === 'canal' && Boolean(actual) && actual!.tipo !== 'directo'
}

/** Quién tiene acceso al canal y quién está conectado, como la lista de miembros de Discord */
export function PanelDeMiembros() {
  const { actual, nombreDe, conectados, yo, abrirDirecto, seleccionar, estadoDe } = useChat()
  const aLaVista = useMiembrosALaVista()
  if (!aLaVista || !actual) return null
  const ordenados = [...actual.miembros].sort((a, b) => nombreDe(a).localeCompare(nombreDe(b), 'es'))
  const enLinea = ordenados.filter((id) => conectados.has(id))
  const sinConexion = ordenados.filter((id) => !conectados.has(id))
  const abrir = async (id: string) => {
    if (id === yo.id) return
    try {
      seleccionar(await abrirDirecto(id))
    } catch {
      /* el aviso de error ya lo enseña el chat */
    }
  }
  const fila = (id: string) => {
    const e = estadoDe(id)
    return (
      <li key={id}>
        <button type="button" className="chat-miembro" data-en-linea={conectados.has(id) ? 'true' : undefined} onClick={() => void abrir(id)} title={id === yo.id ? 'Eres tú' : `Escribir a ${nombreDe(id)}`}>
          <span className="chat-persona-avatar" data-en-linea={conectados.has(id) ? 'true' : undefined}><Avatar id={id} nombre={nombreDe(id)} tamano={30} /></span>
          <span className="chat-miembro-datos">
            <span className="chat-miembro-nombre">{nombreDe(id)}{id === yo.id ? ' (tú)' : ''}<EmojiDeEstado id={id} /></span>
            <span className="chat-miembro-sub">{e?.texto ? e.texto : <HoraLocalDe id={id} />}</span>
          </span>
        </button>
      </li>
    )
  }
  return (
    <aside className="chat-miembros" aria-label="Miembros del canal">
      <header className="chat-miembros-cabecera">
        <b>Miembros · {actual.miembros.length}</b>
        <span className="ml-auto flex items-center">
          {actual.soy_miembro && <button type="button" className="chat-icono" onClick={() => window.dispatchEvent(new Event(EVENTO_AJUSTES_DEL_CANAL))} aria-label="Ajustes del canal y miembros" title="Añadir o quitar gente, ajustes"><Settings2 className="h-4 w-4" /></button>}
          <button type="button" className="chat-icono" onClick={() => ponerMiembrosVisibles(false)} aria-label="Ocultar la barra de miembros" title="Ocultar"><X className="h-4 w-4" /></button>
        </span>
      </header>
      <p className="chat-miembros-acceso">
        {actual.tipo === 'privado' ? <Lock className="h-3 w-3 shrink-0" /> : <Hash className="h-3 w-3 shrink-0" />}
        {actual.tipo === 'privado' ? 'Canal privado: solo estas personas lo ven.' : 'Canal abierto: cualquiera del chat puede unirse.'}
      </p>
      <div className="chat-miembros-lista">
        {enLinea.length > 0 && (
          <section>
            <h3 className="chat-miembros-titulo">En línea — {enLinea.length}</h3>
            <ul>{enLinea.map(fila)}</ul>
          </section>
        )}
        {sinConexion.length > 0 && (
          <section>
            <h3 className="chat-miembros-titulo">Sin conexión — {sinConexion.length}</h3>
            <ul>{sinConexion.map(fila)}</ul>
          </section>
        )}
      </div>
    </aside>
  )
}
