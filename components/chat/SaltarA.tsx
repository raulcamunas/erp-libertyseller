'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Hash, Lock, Loader2, MessageSquare, Search, UserRound } from 'lucide-react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { horaDe } from '@/lib/chat/agrupar'
import { nombreVisible } from '@/lib/chat/canales'
import type { ResultadoDeBusqueda } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'
import { describirInstante } from '@/lib/chat/tiempo'

const SIN_ACENTOS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

type Opcion =
  | { tipo: 'canal'; clave: string; canalId: string; etiqueta: string; privado: boolean; detalle: string }
  | { tipo: 'persona'; clave: string; personaId: string; etiqueta: string }
  | { tipo: 'mensaje'; clave: string; r: ResultadoDeBusqueda }

/** Cmd+K: saltar a un canal o a una persona, o buscar dentro de los mensajes */
export function SaltarA({ onCerrar }: { onCerrar: () => void }) {
  const { canales, personas, yo, persona, nombreDe, seleccionar, abrirDirecto, irAMensaje } = useChat()
  const [q, setQ] = useState('')
  const [resultados, setResultados] = useState<ResultadoDeBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [indice, setIndice] = useState(0)
  const lista = useRef<HTMLUListElement>(null)
  const consulta = SIN_ACENTOS(q.trim())

  // Buscar en los mensajes: a partir de 2 letras, y esperando a que dejes de escribir
  useEffect(() => {
    if (q.trim().length < 2) {
      setResultados([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    let vivo = true
    const t = setTimeout(() => {
      pedir<{ resultados: ResultadoDeBusqueda[] }>(`/api/chat/buscar?q=${encodeURIComponent(q.trim())}`)
        .then((r) => vivo && setResultados(r.resultados))
        .catch((e: Error) => vivo && toast.error(e.message))
        .finally(() => vivo && setBuscando(false))
    }, 250)
    return () => {
      vivo = false
      clearTimeout(t)
    }
  }, [q])

  const opciones = useMemo<Opcion[]>(() => {
    const visibles = canales.filter((c) => !c.archivado && c.tipo !== 'directo')
    const canalesCoinciden: Opcion[] = visibles
      .filter((c) => !consulta || SIN_ACENTOS(c.nombre ?? '').includes(consulta))
      .sort((a, b) => Date.parse(b.ultimo_mensaje_en ?? b.creado_en) - Date.parse(a.ultimo_mensaje_en ?? a.creado_en))
      .slice(0, consulta ? 6 : 5)
      .map((c) => ({ tipo: 'canal' as const, clave: `c-${c.id}`, canalId: c.id, etiqueta: c.nombre ?? '', privado: c.tipo === 'privado', detalle: c.soy_miembro ? '' : 'Te puedes unir' }))
    const gente: Opcion[] = personas
      .filter((p) => p.id !== yo.id && (!consulta || SIN_ACENTOS(p.nombre).includes(consulta)))
      .slice(0, consulta ? 6 : 4)
      .map((p) => ({ tipo: 'persona' as const, clave: `p-${p.id}`, personaId: p.id, etiqueta: p.nombre }))
    const mensajes: Opcion[] = resultados.map((r) => ({ tipo: 'mensaje' as const, clave: `m-${r.id}`, r }))
    return [...canalesCoinciden, ...gente, ...mensajes]
  }, [canales, personas, yo.id, consulta, resultados])

  useEffect(() => setIndice(0), [consulta, resultados.length])
  useEffect(() => {
    lista.current?.querySelector('[data-activa="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [indice])

  const elegir = async (o: Opcion) => {
    try {
      if (o.tipo === 'canal') seleccionar(o.canalId)
      else if (o.tipo === 'persona') seleccionar(await abrirDirecto(o.personaId))
      else await irAMensaje(o.r.canalId, o.r.id, o.r.hilo_de)
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido abrir')
    }
  }

  const alTeclear = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCerrar()
    else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndice((i) => (opciones.length ? (i + 1) % opciones.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice((i) => (opciones.length ? (i - 1 + opciones.length) % opciones.length : 0))
    } else if (e.key === 'Enter' && opciones[indice]) {
      e.preventDefault()
      void elegir(opciones[indice])
    }
  }

  const grupo = (titulo: string, tipo: Opcion['tipo']) => (opciones.some((o) => o.tipo === tipo) ? <li className="chat-saltar-titulo" role="presentation">{titulo}</li> : null)
  const dondeEs = (canalId: string) => {
    const c = canales.find((x) => x.id === canalId)
    return c ? (c.tipo === 'directo' ? `Con ${nombreVisible(c, yo.id, persona)}` : `${c.tipo === 'privado' ? '🔒' : '#'}${c.nombre}`) : ''
  }

  const cuerpo = (
    <div className="tc-modal-fondo chat-saltar-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="chat-saltar" role="dialog" aria-modal="true" aria-label="Buscar en el chat" onKeyDown={alTeclear}>
        <label className="chat-saltar-entrada">
          <Search className="h-4 w-4" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Salta a un canal o una persona, o busca en los mensajes…" aria-label="Buscar" role="combobox" aria-expanded="true" aria-controls="chat-saltar-lista" />
          {buscando && <Loader2 className="h-4 w-4 animate-spin" />}
          <kbd>Esc</kbd>
        </label>
        <ul id="chat-saltar-lista" ref={lista} className="chat-saltar-lista" role="listbox">
          {grupo('Canales', 'canal')}
          {opciones.map((o, i) =>
            o.tipo === 'canal' ? (
              <li key={o.clave} role="option" aria-selected={i === indice}>
                <button type="button" data-activa={i === indice ? 'true' : undefined} onMouseEnter={() => setIndice(i)} onClick={() => void elegir(o)}>
                  {o.privado ? <Lock className="h-4 w-4" /> : <Hash className="h-4 w-4" />}
                  <span>{o.etiqueta}</span>
                  {o.detalle && <i>{o.detalle}</i>}
                </button>
              </li>
            ) : null
          )}
          {grupo('Personas', 'persona')}
          {opciones.map((o, i) =>
            o.tipo === 'persona' ? (
              <li key={o.clave} role="option" aria-selected={i === indice}>
                <button type="button" data-activa={i === indice ? 'true' : undefined} onMouseEnter={() => setIndice(i)} onClick={() => void elegir(o)}>
                  <Avatar id={o.personaId} nombre={o.etiqueta} tamano={20} />
                  <span>{o.etiqueta}</span>
                  <i><UserRound className="h-3 w-3" /> Mensaje directo</i>
                </button>
              </li>
            ) : null
          )}
          {grupo('Mensajes', 'mensaje')}
          {opciones.map((o, i) =>
            o.tipo === 'mensaje' ? (
              <li key={o.clave} role="option" aria-selected={i === indice}>
                <button type="button" className="chat-saltar-mensaje" data-activa={i === indice ? 'true' : undefined} onMouseEnter={() => setIndice(i)} onClick={() => void elegir(o)}>
                  <MessageSquare className="h-4 w-4" />
                  <span className="chat-saltar-mensaje-texto">
                    <span><b>{o.r.autor_id === yo.id ? 'Tú' : nombreDe(o.r.autor_id)}</b> <i>{dondeEs(o.r.canalId)}</i> <time dateTime={o.r.creado_en}>{describirInstante(Date.parse(o.r.creado_en)).replace(/ a las .*/, '')} · {horaDe(o.r.creado_en)}</time></span>
                    <span>{o.r.cuerpo}</span>
                  </span>
                </button>
              </li>
            ) : null
          )}
          {opciones.length === 0 && !buscando && <li className="chat-saltar-vacio">Nada coincide con «{q}».</li>}
        </ul>
        <footer className="chat-saltar-pie"><span>↑↓ moverte</span><span>↵ abrir</span><span>Esc cerrar</span></footer>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(cuerpo, document.body)
}
