'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, ListChecks, Plus, Sparkles, Trash2 } from 'lucide-react'
import { bloqueNuevo, textoDe, type Bloque } from '@/lib/tareas-clientes/bloques'

/**
 * LA LISTA DE TAREAS de una tarea: casillas con su propia interfaz en vez de bloques de texto. Cada fila es una casilla del cuerpo (un bloque «tarea», lo que se manda a Notion y de lo
 * que sale el progreso). Enter añade otra debajo, Retroceso en una vacía la quita, Tab la mete a un nivel, se arrastran para reordenar y se pueden pegar varias líneas de golpe.
 */

const MAX_NIVEL = 2

/** Las líneas de un texto pegado como tareas: sin viñetas, casillas de Markdown ni numeración delante */
export function lineasComoTareas(texto: string): string[] {
  return texto
    .split(/\r?\n/)
    .map((l) => l.replace(/^\s*(?:[-*•]\s*(?:\[[ xX]?\]\s*)?|\d+[.)]\s+|\[[ xX]?\]\s*)/, '').trim())
    .filter(Boolean)
}

function Fila({ b, indice, enfocar, reordenar, registrar, onTexto, onMarcar, onTecla, onPegar, onQuitar }: { b: Bloque; indice: number; enfocar: boolean; reordenar: boolean; registrar: (id: string, el: HTMLInputElement | null) => void; onTexto: (id: string, v: string) => void; onMarcar: (id: string, v: boolean) => void; onTecla: (e: React.KeyboardEvent<HTMLInputElement>, indice: number) => void; onPegar: (e: React.ClipboardEvent<HTMLInputElement>, indice: number) => void; onQuitar: (id: string) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: b.id })
  const estilo: CSSProperties = { transform: CSS.Transform.toString(transform), transition, marginLeft: `${(b.nivel ?? 0) * 22}px`, zIndex: isDragging ? 5 : undefined }
  const hecha = b.hecho === true
  return (
    <li ref={setNodeRef} style={estilo} className="tc-tarea-fila group/r" data-hecha={hecha ? 'true' : undefined} data-arrastrando={isDragging ? 'true' : undefined}>
      {reordenar ? <button type="button" ref={setActivatorNodeRef} {...attributes} {...listeners} className="tc-tarea-asa" aria-label="Arrastrar para cambiar de sitio"><GripVertical className="h-3.5 w-3.5" /></button> : <span className="w-[18px] shrink-0" aria-hidden />}
      <button type="button" role="checkbox" aria-checked={hecha} aria-label={hecha ? 'Marcar como pendiente' : 'Marcar como hecha'} onClick={() => onMarcar(b.id, !hecha)} className="tc-tarea-marca" data-on={hecha ? 'true' : undefined}>
        <Check className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <input
        ref={(el) => registrar(b.id, el)}
        value={textoDe(b.texto)}
        onChange={(e) => onTexto(b.id, e.target.value)}
        onKeyDown={(e) => onTecla(e, indice)}
        onPaste={(e) => onPegar(e, indice)}
        autoFocus={enfocar}
        aria-label="Tarea"
        placeholder="Escribe la tarea…"
        className="tc-tarea-texto"
      />
      <button type="button" onClick={() => onQuitar(b.id)} className="tc-tarea-quitar" aria-label="Quitar la tarea"><Trash2 className="h-3.5 w-3.5" /></button>
    </li>
  )
}

/** `reordenar` es false cuando el cuerpo tiene contenido de Notion que aquí solo se ve: Notion no puede reordenar sin tocarlo, y el orden volvería a como estaba */
export function ListaDeTareas({ tareas, onCambio, reordenar = true }: { tareas: Bloque[]; onCambio: (nuevas: Bloque[]) => void; reordenar?: boolean }) {
  const [nueva, setNueva] = useState('')
  const [enfocarId, setEnfocarId] = useState<string | null>(null)
  const entradas = useRef(new Map<string, HTMLInputElement>())
  const entradaNueva = useRef<HTMLInputElement>(null)
  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const hechas = tareas.filter((t) => t.hecho === true).length
  const porcentaje = tareas.length === 0 ? 0 : Math.round((hechas / tareas.length) * 100)
  const ids = useMemo(() => tareas.map((t) => t.id), [tareas])

  // Tras añadir una tarea se pone el cursor en ella
  useEffect(() => {
    if (!enfocarId) return
    const el = entradas.current.get(enfocarId)
    if (el) {
      el.focus()
      const fin = el.value.length
      el.setSelectionRange(fin, fin)
      setEnfocarId(null)
    }
  }, [enfocarId, tareas])

  const registrar = (id: string, el: HTMLInputElement | null) => {
    if (el) entradas.current.set(id, el)
    else entradas.current.delete(id)
  }

  const cambiar = (id: string, parcial: Partial<Bloque>) => onCambio(tareas.map((t) => (t.id === id ? { ...t, ...parcial } : t)))
  // El texto solo se reescribe si cambia de verdad: así una tarea con negritas o enlaces (de Notion) los conserva mientras no se toque
  const alTexto = (id: string, v: string) => cambiar(id, { texto: [{ t: v }] })
  const insertarDespues = (indice: number, textos: string[], nivel: number) => {
    const nuevas = textos.map((t) => ({ ...bloqueNuevo('tarea', t), nivel }))
    const lista = [...tareas]
    lista.splice(indice + 1, 0, ...nuevas)
    onCambio(lista)
    setEnfocarId(nuevas[nuevas.length - 1].id)
  }
  const quitar = (id: string) => onCambio(tareas.filter((t) => t.id !== id))

  const alTecla = (e: React.KeyboardEvent<HTMLInputElement>, indice: number) => {
    const b = tareas[indice]
    if (e.key === 'Enter') {
      e.preventDefault()
      insertarDespues(indice, [''], b.nivel ?? 0)
    } else if (e.key === 'Backspace' && textoDe(b.texto) === '') {
      e.preventDefault()
      const anterior = tareas[indice - 1]
      quitar(b.id)
      if (anterior) setEnfocarId(anterior.id)
      else entradaNueva.current?.focus()
    } else if (e.key === 'Tab') {
      e.preventDefault()
      const nivel = Math.max(0, Math.min(MAX_NIVEL, (b.nivel ?? 0) + (e.shiftKey ? -1 : 1)))
      if (indice > 0 || nivel === 0) cambiar(b.id, { nivel })
    } else if (e.key === 'ArrowUp' && tareas[indice - 1]) {
      e.preventDefault()
      entradas.current.get(tareas[indice - 1].id)?.focus()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      const siguiente = tareas[indice + 1]
      if (siguiente) entradas.current.get(siguiente.id)?.focus()
      else entradaNueva.current?.focus()
    }
  }

  const alPegar = (e: React.ClipboardEvent<HTMLInputElement>, indice: number) => {
    const lineas = lineasComoTareas(e.clipboardData.getData('text/plain'))
    if (lineas.length < 2) return
    e.preventDefault()
    const b = tareas[indice]
    // Si la fila está vacía la primera línea la rellena; el resto va detrás
    if (textoDe(b.texto).trim() === '') {
      const resto = lineas.slice(1)
      const lista = tareas.map((t) => (t.id === b.id ? { ...t, texto: [{ t: lineas[0] }] } : t))
      const nuevas = resto.map((t) => ({ ...bloqueNuevo('tarea', t), nivel: b.nivel ?? 0 }))
      lista.splice(indice + 1, 0, ...nuevas)
      onCambio(lista)
      setEnfocarId(nuevas.length > 0 ? nuevas[nuevas.length - 1].id : b.id)
    } else insertarDespues(indice, lineas, b.nivel ?? 0)
  }

  const añadir = (texto: string) => {
    const lineas = lineasComoTareas(texto)
    const textos = lineas.length > 0 ? lineas : texto.trim() ? [texto.trim()] : []
    if (textos.length === 0) return
    onCambio([...tareas, ...textos.map((t) => bloqueNuevo('tarea', t))])
    setNueva('')
  }

  const alArrastrar = (e: DragEndEvent) => {
    if (!reordenar || !e.over || e.active.id === e.over.id) return
    const de = ids.indexOf(String(e.active.id))
    const a = ids.indexOf(String(e.over.id))
    if (de >= 0 && a >= 0) onCambio(arrayMove(tareas, de, a))
  }

  return (
    <section className="tc-cuerpo-tarjeta" aria-label="Lista de tareas">
      <header className="tc-cuerpo-cabecera">
        <span className="tc-cuerpo-icono" data-tono="verde"><ListChecks className="h-3.5 w-3.5" /></span>
        <h3>Tareas</h3>
        {tareas.length > 0 && <span className="tc-contador">{hechas}/{tareas.length}</span>}
        {hechas > 0 && <button type="button" onClick={() => onCambio(tareas.filter((t) => t.hecho !== true))} className="tc-boton-suave tc-discreto ml-auto">Quitar las hechas</button>}
      </header>

      {tareas.length > 0 && (
        <div className="tc-lista-progreso" data-completa={porcentaje === 100 ? 'true' : undefined} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={porcentaje} aria-label="Progreso de la lista">
          <div className="tc-lista-progreso-barra"><span style={{ width: `${porcentaje}%` }} /></div>
          <span className="tabular-nums">{porcentaje === 100 ? <><Sparkles className="mr-1 inline h-3 w-3" />Todo hecho</> : `${porcentaje} %`}</span>
        </div>
      )}

      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alArrastrar}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          <ul className="flex flex-col gap-0.5">
            {tareas.map((b, i) => (
              <Fila key={b.id} b={b} indice={i} enfocar={false} reordenar={reordenar} registrar={registrar} onTexto={alTexto} onMarcar={(id, v) => cambiar(id, { hecho: v })} onTecla={alTecla} onPegar={alPegar} onQuitar={quitar} />
            ))}
          </ul>
        </SortableContext>
      </DndContext>

      <div className="tc-tarea-nueva" data-vacia={tareas.length === 0 ? 'true' : undefined}>
        <Plus className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" />
        <input
          ref={entradaNueva}
          value={nueva}
          onChange={(e) => setNueva(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              añadir(nueva)
            } else if (e.key === 'ArrowUp' && tareas.length > 0) {
              e.preventDefault()
              entradas.current.get(tareas[tareas.length - 1].id)?.focus()
            }
          }}
          onPaste={(e) => {
            const t = e.clipboardData.getData('text/plain')
            if (lineasComoTareas(t).length > 1) {
              e.preventDefault()
              añadir(t)
            }
          }}
          placeholder={tareas.length === 0 ? 'Escribe la primera tarea y pulsa Enter… (puedes pegar varias líneas)' : 'Añadir una tarea… (Enter)'}
          aria-label="Nueva tarea"
        />
      </div>
    </section>
  )
}
