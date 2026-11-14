'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CornerDownLeft, FileText, Loader2, MessageSquare, Search, X } from 'lucide-react'
import { coincide, MIN_LETRAS_DE_BUSQUEDA, resaltar } from '@/lib/tareas-clientes/busqueda'
import type { ResultadoDeBusqueda } from '@/lib/tareas-clientes/busqueda-servidor'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { estadosDe, type ClienteTC } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'
import { Etiqueta } from './ui'

/**
 * EL BUSCADOR (Ctrl/Cmd + K, o «/» fuera de un campo): una ventana arriba, al estilo de un buscador de comandos. Mientras se teclea salen al instante las tareas cuyo TÍTULO
 * lleva todas las palabras (ya están todas cargadas, sin acentos ni mayúsculas); medio segundo después llegan las que lo llevan en su cuerpo o en un comentario (las busca el
 * servidor). Flechas para moverse, Intro para abrir, Escape para cerrar. Solo busca en los clientes que ve quien busca.
 */

type Fila =
  | { clave: string; tipo: 'tarea'; tarea: TareaLigera; fragmento: string; donde: 'titulo' | 'cuerpo' | 'comentario' }
  | { clave: string; tipo: 'cliente'; cliente: ClienteTC }

const RETRASO_DEL_SERVIDOR_MS = 280

function Resaltado({ texto, consulta }: { texto: string; consulta: string }) {
  return (
    <>
      {resaltar(texto, consulta).map((t, i) => (t.resaltado ? <mark key={i} className="tc-marca-busqueda">{t.texto}</mark> : <span key={i}>{t.texto}</span>))}
    </>
  )
}

export function BuscadorGlobal({ tareas, clientes, clienteActual, onElegirTarea, onElegirCliente, onCerrar }: { tareas: readonly TareaLigera[]; clientes: readonly ClienteTC[]; clienteActual: ClienteTC | null; onElegirTarea: (tareaId: string, clienteId: string) => void; onElegirCliente: (clienteId: string) => void; onCerrar: () => void }) {
  const [q, setQ] = useState('')
  const [soloCliente, setSoloCliente] = useState(false)
  const [delServidor, setDelServidor] = useState<ResultadoDeBusqueda[]>([])
  const [buscando, setBuscando] = useState(false)
  const [indice, setIndice] = useState(0)
  const entrada = useRef<HTMLInputElement>(null)
  const lista = useRef<HTMLDivElement>(null)
  const porId = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas])
  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes])

  useEffect(() => entrada.current?.focus(), [])

  // Lo que está en el cuerpo y en los comentarios lo busca el servidor, un instante después de dejar de teclear
  useEffect(() => {
    const consulta = q.trim()
    if ([...consulta].length < MIN_LETRAS_DE_BUSQUEDA) {
      setDelServidor([])
      setBuscando(false)
      return
    }
    setBuscando(true)
    let vigente = true
    const id = window.setTimeout(() => {
      const url = `${BASE}/buscar?q=${encodeURIComponent(consulta)}${soloCliente && clienteActual ? `&clienteId=${clienteActual.id}` : ''}`
      pedir<{ resultados: ResultadoDeBusqueda[] }>(url)
        .then((r) => vigente && setDelServidor(r.resultados))
        .catch(() => vigente && setDelServidor([]))
        .finally(() => vigente && setBuscando(false))
    }, RETRASO_DEL_SERVIDOR_MS)
    return () => {
      vigente = false
      window.clearTimeout(id)
    }
  }, [q, soloCliente, clienteActual])

  const filas = useMemo<Fila[]>(() => {
    const consulta = q.trim()
    if (!consulta) return []
    const alcance = soloCliente && clienteActual ? tareas.filter((t) => t.cliente_id === clienteActual.id) : tareas
    const hechas = new Map(clientes.map((c) => [c.id, new Set(estadosDe(c).filter((e) => e.grupo === 'hecho').map((e) => e.nombre))]))
    // Por título: las que aún están abiertas primero, y entre ellas las tocadas hace menos
    const porTitulo = alcance
      .filter((t) => coincide(t.titulo, consulta))
      .sort((a, b) => Number(hechas.get(a.cliente_id)?.has(a.estado) ?? false) - Number(hechas.get(b.cliente_id)?.has(b.estado) ?? false) || b.actualizado_en.localeCompare(a.actualizado_en))
      .slice(0, 12)
    const vistas = new Set(porTitulo.map((t) => t.id))
    const salida: Fila[] = []
    if (!soloCliente) for (const c of clientes.filter((x) => coincide(x.nombre, consulta)).slice(0, 4)) salida.push({ clave: `c-${c.id}`, tipo: 'cliente', cliente: c })
    for (const t of porTitulo) salida.push({ clave: `t-${t.id}`, tipo: 'tarea', tarea: t, fragmento: '', donde: 'titulo' })
    // Lo del servidor: una sola fila por tarea y sitio, y sin repetir las que ya han salido por título
    const dichas = new Set<string>()
    for (const r of delServidor) {
      const t = porId.get(r.tarea_id)
      if (!t || (r.donde === 'titulo' && vistas.has(r.tarea_id))) continue
      const clave = `${r.donde}-${r.tarea_id}`
      if (dichas.has(clave)) continue
      dichas.add(clave)
      salida.push({ clave, tipo: 'tarea', tarea: t, fragmento: r.fragmento, donde: r.donde })
    }
    return salida
  }, [q, soloCliente, clienteActual, tareas, clientes, delServidor, porId])

  useEffect(() => setIndice(0), [q, soloCliente])
  useEffect(() => {
    lista.current?.querySelector<HTMLElement>('[data-activo="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [indice])

  const elegir = (f: Fila | undefined) => {
    if (!f) return
    if (f.tipo === 'cliente') onElegirCliente(f.cliente.id)
    else onElegirTarea(f.tarea.id, f.tarea.cliente_id)
    onCerrar()
  }

  const alPulsar = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCerrar()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setIndice((i) => Math.min(filas.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setIndice((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      elegir(filas[indice])
    }
  }

  const rotulo = (donde: 'titulo' | 'cuerpo' | 'comentario') => (donde === 'cuerpo' ? 'En el texto' : donde === 'comentario' ? 'En un comentario' : '')

  const ventana = (
    <div className="tc-buscador-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-buscador" role="dialog" aria-modal="true" aria-label="Buscar" onKeyDown={alPulsar}>
        <div className="tc-buscador-entrada">
          <Search className="h-4 w-4 shrink-0 text-[var(--ls-t3)]" />
          <input ref={entrada} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar tareas, textos y comentarios…" aria-label="Buscar" role="combobox" aria-expanded="true" aria-controls="tc-resultados" />
          {buscando && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ls-t4)]" aria-label="Buscando" />}
          {q && <button type="button" onClick={() => { setQ(''); entrada.current?.focus() }} aria-label="Borrar" className="tc-icono-boton"><X className="h-3.5 w-3.5" /></button>}
        </div>
        {clienteActual && (
          <label className="tc-buscador-alcance">
            <input type="checkbox" className="tc-casilla" checked={soloCliente} onChange={(e) => setSoloCliente(e.target.checked)} />
            Solo en {clienteActual.icono ?? ''} {clienteActual.nombre}
          </label>
        )}
        <div className="tc-buscador-lista" id="tc-resultados" role="listbox" ref={lista}>
          {!q.trim() && <p className="tc-buscador-vacio">Escribe para buscar en el título, en el texto y en los comentarios de todas las tareas. No importan los acentos ni las mayúsculas.</p>}
          {q.trim() && filas.length === 0 && !buscando && <p className="tc-buscador-vacio">Nada con «{q.trim()}»{soloCliente ? ' en este cliente' : ''}.</p>}
          {filas.map((f, i) => {
            const activo = i === indice
            if (f.tipo === 'cliente') {
              return (
                <button key={f.clave} type="button" role="option" aria-selected={activo} data-activo={activo ? 'true' : undefined} onMouseEnter={() => setIndice(i)} onClick={() => elegir(f)} className="tc-buscador-fila">
                  <span className="tc-buscador-icono">{f.cliente.icono ?? '•'}</span>
                  <span className="min-w-0 flex-1 text-left"><span className="block truncate text-[13px] text-[var(--ls-t1)]"><Resaltado texto={f.cliente.nombre} consulta={q} /></span><span className="block text-[11px] text-[var(--ls-t4)]">Abrir el cliente</span></span>
                  {activo && <CornerDownLeft className="h-3.5 w-3.5 text-[var(--ls-t4)]" />}
                </button>
              )
            }
            const cliente = clientePorId.get(f.tarea.cliente_id)
            const estado = (cliente ? estadosDe(cliente) : []).find((e) => e.nombre === f.tarea.estado)
            return (
              <button key={f.clave} type="button" role="option" aria-selected={activo} data-activo={activo ? 'true' : undefined} onMouseEnter={() => setIndice(i)} onClick={() => elegir(f)} className="tc-buscador-fila">
                <span className="tc-buscador-icono">{f.donde === 'comentario' ? <MessageSquare className="h-3.5 w-3.5" /> : f.donde === 'cuerpo' ? <FileText className="h-3.5 w-3.5" /> : (f.tarea.icono ?? cliente?.icono ?? '•')}</span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block truncate text-[13px] text-[var(--ls-t1)]"><Resaltado texto={f.tarea.titulo || 'Sin título'} consulta={f.donde === 'titulo' ? q : ''} /></span>
                  {f.fragmento ? (
                    <span className="block truncate text-[11.5px] text-[var(--ls-t3)]"><span className="text-[var(--ls-t4)]">{rotulo(f.donde)} · </span>…<Resaltado texto={f.fragmento.replace(/\s+/g, ' ')} consulta={q} />…</span>
                  ) : (
                    <span className="block truncate text-[11px] text-[var(--ls-t4)]">{cliente?.nombre ?? ''}</span>
                  )}
                </span>
                {f.fragmento && <span className="hidden max-w-[110px] truncate text-[11px] text-[var(--ls-t4)] sm:block">{cliente?.nombre}</span>}
                {estado && <Etiqueta color={estado.color} pequena>{estado.nombre}</Etiqueta>}
                {activo && <CornerDownLeft className="h-3.5 w-3.5 text-[var(--ls-t4)]" />}
              </button>
            )
          })}
        </div>
        <div className="tc-buscador-pie"><span><kbd>↑</kbd><kbd>↓</kbd> moverse</span><span><kbd>Intro</kbd> abrir</span><span><kbd>Esc</kbd> cerrar</span></div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
