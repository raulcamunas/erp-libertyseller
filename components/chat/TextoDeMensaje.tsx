'use client'

import { Fragment } from 'react'
import { esEnlaceSeguro, partirCuerpo } from '@/lib/chat/mensajes'
import { useChat } from './ChatProvider'

/** El texto de un mensaje, pintado trozo a trozo: nada de lo escrito se interpreta como HTML */
export function TextoDeMensaje({ cuerpo, editado }: { cuerpo: string; editado?: boolean }) {
  const { yo, nombreDe } = useChat()
  return (
    <p className="chat-texto">
      {partirCuerpo(cuerpo).map((t, i) => {
        switch (t.t) {
          case 'negrita':
            return <strong key={i}>{t.v}</strong>
          case 'cursiva':
            return <em key={i}>{t.v}</em>
          case 'codigo':
            return <code key={i} className="chat-codigo">{t.v}</code>
          case 'bloque':
            return <pre key={i} className="chat-bloque"><code>{t.v}</code></pre>
          case 'mencion':
            return <span key={i} className="chat-mencion" data-yo={t.id === yo.id || t.id === 'todos' ? 'true' : undefined}>@{t.id === 'todos' ? 'todos' : nombreDe(t.id)}</span>
          case 'enlace':
            return esEnlaceSeguro(t.url) ? <a key={i} href={t.url} target="_blank" rel="noopener noreferrer nofollow" className="chat-enlace">{t.v}</a> : <Fragment key={i}>{t.v}</Fragment>
          default:
            return <Fragment key={i}>{t.v}</Fragment>
        }
      })}
      {editado && <span className="chat-editado">(editado)</span>}
    </p>
  )
}
