'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, Hash, Loader2, Lock, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { normalizarNombreDeCanal } from '@/lib/chat/canales'
import type { CanalChat, PersonaChat } from '@/lib/chat/tipos'
import { useChat } from './ChatProvider'

const SIN_ACENTOS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function Ventana({ titulo, onCerrar, children, pie }: { titulo: string; onCerrar: () => void; children: ReactNode; pie?: ReactNode }) {
  const cuerpo = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()} onKeyDown={(e) => e.key === 'Escape' && onCerrar()}>
      <div className="tc-modal chat-dialogo" role="dialog" aria-modal="true" aria-label={titulo}>
        <header className="tc-modal-cabecera">
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">{titulo}</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="chat-dialogo-cuerpo">{children}</div>
        {pie && <footer className="tc-modal-pie">{pie}</footer>}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(cuerpo, document.body)
}

/** Una lista de personas con casilla y buscador */
function SelectorDePersonas({ personas, elegidas, alCambiar, deshabilitadas = [] }: { personas: readonly PersonaChat[]; elegidas: ReadonlySet<string>; alCambiar: (ids: Set<string>) => void; deshabilitadas?: readonly string[] }) {
  const { conectados } = useChat()
  const [q, setQ] = useState('')
  const visibles = useMemo(() => personas.filter((p) => SIN_ACENTOS(p.nombre).includes(SIN_ACENTOS(q.trim()))), [personas, q])
  return (
    <div className="chat-selector">
      <label className="chat-buscar">
        <Search className="h-3.5 w-3.5" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar a alguien…" aria-label="Buscar a alguien" />
      </label>
      <ul className="chat-selector-lista">
        {visibles.map((p) => {
          const dentro = deshabilitadas.includes(p.id)
          const marcada = elegidas.has(p.id)
          return (
            <li key={p.id}>
              <button
                type="button"
                disabled={dentro}
                aria-pressed={marcada}
                onClick={() => {
                  const n = new Set(elegidas)
                  if (n.has(p.id)) n.delete(p.id)
                  else n.add(p.id)
                  alCambiar(n)
                }}
                data-marcada={marcada ? 'true' : undefined}
              >
                <span className="chat-persona-avatar" data-en-linea={conectados.has(p.id) ? 'true' : undefined}><Avatar id={p.id} nombre={p.nombre} tamano={26} /></span>
                <span className="min-w-0 flex-1 truncate text-left">{p.nombre}</span>
                {dentro ? <span className="text-[11px] text-[var(--ls-t4)]">Ya está</span> : marcada ? <Check className="h-4 w-4 text-[var(--ls-acc)]" /> : null}
              </button>
            </li>
          )
        })}
        {visibles.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-[var(--ls-t4)]">Nadie coincide.</li>}
      </ul>
    </div>
  )
}

export function DialogoNuevoCanal({ onCerrar, alCrear }: { onCerrar: () => void; alCrear: (id: string) => void }) {
  const { personas, yo, crearCanal } = useChat()
  const [tipo, setTipo] = useState<'canal' | 'privado'>('canal')
  const [nombre, setNombre] = useState('')
  const [descripcion, setDescripcion] = useState('')
  const [miembros, setMiembros] = useState<Set<string>>(new Set())
  const [guardando, setGuardando] = useState(false)
  const normalizado = normalizarNombreDeCanal(nombre)

  const crear = async () => {
    if (!normalizado) return toast.error('Ponle un nombre al canal.')
    setGuardando(true)
    try {
      const id = await crearCanal({ tipo, nombre: normalizado, descripcion, miembros: tipo === 'privado' ? [...miembros] : [] })
      alCrear(id)
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear el canal')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana
      titulo="Crear un canal"
      onCerrar={onCerrar}
      pie={
        <>
          <button type="button" className="chat-boton-secundario" onClick={onCerrar}>Cancelar</button>
          <button type="button" className="tc-boton-primario ml-auto disabled:opacity-50" disabled={guardando || !normalizado} onClick={() => void crear()}>
            {guardando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Crear canal
          </button>
        </>
      }
    >
      <div className="chat-opciones-tipo" role="radiogroup" aria-label="Tipo de canal">
        <button type="button" role="radio" aria-checked={tipo === 'canal'} onClick={() => setTipo('canal')}><Hash className="h-4 w-4" /><b>Abierto</b><span>Cualquiera del equipo puede verlo y entrar</span></button>
        <button type="button" role="radio" aria-checked={tipo === 'privado'} onClick={() => setTipo('privado')}><Lock className="h-4 w-4" /><b>Privado</b><span>Solo ven y entran quienes añadas</span></button>
      </div>
      <label className="chat-campo">
        <span>Nombre</span>
        <input autoFocus value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} placeholder="p. ej. ventas-españa" onKeyDown={(e) => e.key === 'Enter' && tipo === 'canal' && void crear()} />
        {nombre && normalizado !== nombre && <small>Se llamará «{normalizado ?? '…'}» (en minúsculas y con guiones).</small>}
      </label>
      <label className="chat-campo">
        <span>Descripción <i>(opcional)</i></span>
        <input value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="¿De qué se habla aquí?" />
      </label>
      {tipo === 'privado' && (
        <div className="chat-campo">
          <span>Quién entra <i>({miembros.size} + tú)</i></span>
          <SelectorDePersonas personas={personas.filter((p) => p.id !== yo.id)} elegidas={miembros} alCambiar={setMiembros} />
        </div>
      )}
    </Ventana>
  )
}

export function DialogoNuevoDirecto({ onCerrar, alAbrir }: { onCerrar: () => void; alAbrir: (id: string) => void }) {
  const { personas, yo, abrirDirecto, conectados } = useChat()
  const [q, setQ] = useState('')
  const [abriendo, setAbriendo] = useState<string | null>(null)
  const visibles = useMemo(() => personas.filter((p) => p.id !== yo.id && SIN_ACENTOS(p.nombre).includes(SIN_ACENTOS(q.trim()))), [personas, yo.id, q])
  const abrir = async (id: string) => {
    setAbriendo(id)
    try {
      alAbrir(await abrirDirecto(id))
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido abrir la conversación')
      setAbriendo(null)
    }
  }
  return (
    <Ventana titulo="Nuevo mensaje directo" onCerrar={onCerrar}>
      <label className="chat-buscar">
        <Search className="h-3.5 w-3.5" />
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="¿Con quién quieres hablar?" aria-label="Buscar a alguien" />
      </label>
      <ul className="chat-selector-lista">
        {visibles.map((p) => (
          <li key={p.id}>
            <button type="button" disabled={abriendo !== null} onClick={() => void abrir(p.id)}>
              <span className="chat-persona-avatar" data-en-linea={conectados.has(p.id) ? 'true' : undefined}><Avatar id={p.id} nombre={p.nombre} tamano={28} /></span>
              <span className="min-w-0 flex-1 truncate text-left">{p.nombre}</span>
              {abriendo === p.id && <Loader2 className="h-4 w-4 animate-spin" />}
            </button>
          </li>
        ))}
        {visibles.length === 0 && <li className="px-3 py-4 text-center text-[12.5px] text-[var(--ls-t4)]">Nadie coincide.</li>}
      </ul>
    </Ventana>
  )
}

/** Quién está en el canal, para añadir gente y para cambiarle el nombre o archivarlo */
export function DialogoMiembros({ canal, onCerrar }: { canal: CanalChat; onCerrar: () => void }) {
  const { personas, persona, conectados, anadir, cambiar, yo } = useChat()
  const [nuevos, setNuevos] = useState<Set<string>>(new Set())
  const [nombre, setNombre] = useState(canal.nombre ?? '')
  const [descripcion, setDescripcion] = useState(canal.descripcion)
  const [guardando, setGuardando] = useState(false)
  const dentro = canal.miembros.map((id) => persona(id)).filter((p): p is PersonaChat => Boolean(p))
  const cambios = normalizarNombreDeCanal(nombre) !== canal.nombre || descripcion.trim() !== canal.descripcion

  const hacer = async (f: () => Promise<unknown>, ok: string) => {
    setGuardando(true)
    try {
      await f()
      toast.success(ok)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <Ventana titulo={`${canal.tipo === 'privado' ? '🔒' : '#'} ${canal.nombre ?? ''}`} onCerrar={onCerrar}>
      <section className="chat-campo">
        <span>Nombre y descripción</span>
        <input value={nombre} maxLength={60} onChange={(e) => setNombre(e.target.value)} aria-label="Nombre del canal" />
        <input value={descripcion} maxLength={300} onChange={(e) => setDescripcion(e.target.value)} placeholder="¿De qué se habla aquí?" aria-label="Descripción" />
        <div className="chat-fila-botones">
          <button type="button" className="tc-boton-primario disabled:opacity-50" disabled={!cambios || guardando} onClick={() => void hacer(() => cambiar(canal.id, { nombre, descripcion }), 'Canal actualizado')}>Guardar cambios</button>
          {!canal.auto_unirse && (yo.esAdmin || canal.miembros.includes(yo.id)) && (
            <button type="button" className="chat-peligro" disabled={guardando} onClick={() => window.confirm('¿Archivar este canal? Dejará de salir en la lista de todos.') && void hacer(async () => { await cambiar(canal.id, { archivar: true }); onCerrar() }, 'Canal archivado')}>Archivar canal</button>
          )}
        </div>
      </section>
      <section className="chat-campo">
        <span>En el canal <i>({dentro.length})</i></span>
        <ul className="chat-selector-lista chat-lista-corta">
          {dentro.map((p) => (
            <li key={p.id}>
              <span className="chat-persona-fila">
                <span className="chat-persona-avatar" data-en-linea={conectados.has(p.id) ? 'true' : undefined}><Avatar id={p.id} nombre={p.nombre} tamano={26} /></span>
                <span className="min-w-0 flex-1 truncate">{p.nombre}{p.id === yo.id ? ' (tú)' : ''}</span>
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section className="chat-campo">
        <span>Añadir gente</span>
        <SelectorDePersonas personas={personas} elegidas={nuevos} alCambiar={setNuevos} deshabilitadas={canal.miembros} />
        <div className="chat-fila-botones">
          <button type="button" className="tc-boton-primario disabled:opacity-50" disabled={nuevos.size === 0 || guardando} onClick={() => void hacer(async () => { await anadir(canal.id, [...nuevos]); setNuevos(new Set()) }, 'Personas añadidas')}>
            Añadir {nuevos.size > 0 ? `(${nuevos.size})` : ''}
          </button>
        </div>
      </section>
    </Ventana>
  )
}
