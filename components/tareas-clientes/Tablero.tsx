'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { closestCenter, DndContext, DragOverlay, getFirstCollision, KeyboardSensor, MouseSensor, pointerWithin, rectIntersection, TouchSensor, useDroppable, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragOverEvent, type DragStartEvent, type UniqueIdentifier } from '@dnd-kit/core'
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import type { OpcionDeEstado, OpcionSimple, PersonaTC } from '@/lib/tareas-clientes/tipos'
import { Tarjeta } from './Tarjeta'
import { Etiqueta } from './ui'

/**
 * EL TABLERO: una columna por estado, y las tarjetas se arrastran entre ellas y dentro de ellas.
 *
 * Mientras se arrastra, el orden vive en este componente (`columnas`) y no se toca nada fuera; al soltar se avisa de UNA sola cosa: a qué columna ha ido y detrás de qué
 * tarjeta (`despuesDe`). El padre lo aplica de inmediato y lo manda al servidor. Si cambian las tareas desde fuera (otro compañero, Notion) y no se está arrastrando, el
 * tablero se recoloca solo.
 */

const COLUMNA = 'col:'
const idDeColumna = (estado: string) => `${COLUMNA}${estado}`

type Columnas = Record<string, string[]>

function agrupar(tareas: readonly TareaLigera[], estados: readonly OpcionDeEstado[]): Columnas {
  const salida: Columnas = {}
  for (const e of estados) salida[e.nombre] = []
  const ordenadas = [...tareas].sort((a, b) => Number(a.orden) - Number(b.orden))
  for (const t of ordenadas) (salida[t.estado] ??= []).push(t.id)
  return salida
}

export interface PropsDeTablero {
  /** Las columnas, en orden, y los departamentos con su color: los de UN cliente o la unión de varios */
  estados: readonly OpcionDeEstado[]
  departamentos: readonly OpcionSimple[]
  tareas: readonly TareaLigera[]
  personas: readonly PersonaTC[]
  tareaAbierta: string | null
  onAbrir: (id: string) => void
  onMover: (id: string, estado: string, despuesDe: string | null) => void
  onCrear: (estado: string, titulo: string) => Promise<void> | void
}

export function Tablero({ estados: estadosBase, departamentos, tareas, personas, tareaAbierta, onAbrir, onMover, onCrear }: PropsDeTablero) {
  // Una tarea con un estado que la base ya no tiene (Notion lo cambió) no desaparece: sale en su propia columna al final
  const estados = useMemo(() => {
    const conocidos = new Set(estadosBase.map((e) => e.nombre))
    const extra = [...new Set(tareas.map((t) => t.estado))].filter((e) => !conocidos.has(e)).map((nombre) => ({ nombre, color: 'gray' as const, grupo: 'en_curso' as const }))
    return [...estadosBase, ...extra]
  }, [estadosBase, tareas])
  const porId = useMemo(() => new Map(tareas.map((t) => [t.id, t])), [tareas])

  const [columnas, setColumnas] = useState<Columnas>(() => agrupar(tareas, estados))
  const [activa, setActiva] = useState<string | null>(null)
  // Las entradas animadas (columnas y tarjetas que suben) solo corren al abrir el tablero. Si siguieran puestas, una tarjeta que cambia de columna al arrastrarla
  // se montaría de nuevo y volvería a entrar desde transparente: eso era lo que hacía que el arrastre pareciera ir a tirones.
  const [entrada, setEntrada] = useState(true)
  const arrastrando = useRef(false)
  const origen = useRef<{ estado: string; despuesDe: string | null } | null>(null)
  const columnasRef = useRef(columnas)
  columnasRef.current = columnas
  const ultimoSobre = useRef<UniqueIdentifier | null>(null)

  useEffect(() => {
    const t = window.setTimeout(() => setEntrada(false), 1500)
    return () => {
      window.clearTimeout(t)
      document.body.classList.remove('tc-agarrando')
    }
  }, [])

  useEffect(() => {
    if (!arrastrando.current) setColumnas(agrupar(tareas, estados))
  }, [tareas, estados])

  // Ratón con un pequeño umbral (así un clic abre la tarea y un arrastre la mueve); en el móvil, mantener pulsado un instante para no pelearse con el desplazamiento
  const sensores = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 170, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  /**
   * DÓNDE ESTÁ LA TARJETA QUE SE ARRASTRA. `closestCorners` (lo de antes) elegía mal en cuanto había varias columnas con tarjetas: medía esquinas contra todo. Ahora manda el
   * PUNTERO: si está dentro de una tarjeta, esa; si está dentro de una columna pero entre tarjetas (o la columna está vacía), la tarjeta de esa columna con el centro más cercano
   * (o la columna misma si no tiene ninguna); y si se suelta fuera de todo, se queda donde estaba la última vez.
   */
  const colision: CollisionDetection = useCallback((args) => {
    const delPuntero = pointerWithin(args)
    const candidatas = delPuntero.length > 0 ? delPuntero : rectIntersection(args)
    let sobreId = getFirstCollision(candidatas, 'id')
    if (sobreId != null) {
      const id = String(sobreId)
      if (id.startsWith(COLUMNA)) {
        const tarjetas = columnasRef.current[id.slice(COLUMNA.length)] ?? []
        if (tarjetas.length > 0) {
          const cercana = closestCenter({ ...args, droppableContainers: args.droppableContainers.filter((c) => tarjetas.includes(String(c.id))) })
          sobreId = cercana[0]?.id ?? sobreId
        }
      }
      ultimoSobre.current = sobreId
      return [{ id: sobreId }]
    }
    return ultimoSobre.current != null ? [{ id: ultimoSobre.current }] : []
  }, [])

  const contenedorDe = useCallback((id: string, c: Columnas): string | undefined => (id.startsWith(COLUMNA) ? id.slice(COLUMNA.length) : Object.keys(c).find((k) => c[k].includes(id))), [])

  const alEmpezar = (e: DragStartEvent) => {
    arrastrando.current = true
    ultimoSobre.current = null
    document.body.classList.add('tc-agarrando')
    const id = String(e.active.id)
    setActiva(id)
    const estado = contenedorDe(id, columnas) ?? ''
    const i = columnas[estado]?.indexOf(id) ?? -1
    origen.current = { estado, despuesDe: i > 0 ? columnas[estado][i - 1] : null }
  }

  const alPasarPor = (e: DragOverEvent) => {
    const { active, over } = e
    if (!over) return
    const id = String(active.id)
    const sobreId = String(over.id)
    // Si el centro de la tarjeta arrastrada ya está por debajo del centro de aquella sobre la que pasa, entra DETRÁS de ella (si no, siempre entraba delante y la posición saltaba)
    const t = active.rect.current.translated
    const detras = Boolean(t && t.top + t.height / 2 > over.rect.top + over.rect.height / 2)
    setColumnas((prev) => {
      const desde = contenedorDe(id, prev)
      const hacia = contenedorDe(sobreId, prev)
      if (!desde || !hacia || desde === hacia) return prev
      const destino = prev[hacia]
      const sobre = destino.indexOf(sobreId)
      const i = sobre >= 0 ? sobre + (detras ? 1 : 0) : destino.length
      return { ...prev, [desde]: prev[desde].filter((x) => x !== id), [hacia]: [...destino.slice(0, i), id, ...destino.slice(i)] }
    })
  }

  const alSoltar = (e: DragEndEvent) => {
    const id = String(e.active.id)
    const sobre = e.over ? String(e.over.id) : null
    let final = columnas
    const donde = contenedorDe(id, columnas)
    if (donde && sobre) {
      const a = columnas[donde].indexOf(id)
      const b = columnas[donde].indexOf(sobre)
      if (b >= 0 && a !== b) {
        final = { ...columnas, [donde]: arrayMove(columnas[donde], a, b) }
        setColumnas(final)
      }
    }
    arrastrando.current = false
    document.body.classList.remove('tc-agarrando')
    setActiva(null)
    const estado = contenedorDe(id, final)
    if (!estado) return
    const i = final[estado].indexOf(id)
    const despuesDe = i > 0 ? final[estado][i - 1] : null
    const antes = origen.current
    origen.current = null
    if (antes && antes.estado === estado && antes.despuesDe === despuesDe) return
    onMover(id, estado, despuesDe)
  }

  const alCancelar = () => {
    arrastrando.current = false
    document.body.classList.remove('tc-agarrando')
    setActiva(null)
    origen.current = null
    setColumnas(agrupar(tareas, estados))
  }

  const tareaActiva = activa ? porId.get(activa) : null

  return (
    <DndContext sensors={sensores} collisionDetection={colision} autoScroll={{ threshold: { x: 0.1, y: 0.14 }, acceleration: 7 }} onDragStart={alEmpezar} onDragOver={alPasarPor} onDragEnd={alSoltar} onDragCancel={alCancelar}>
      <div className="tc-tablero" role="group" aria-label="Tablero de tareas" data-entrada={entrada ? 'true' : undefined} data-arrastrando={activa ? 'true' : undefined}>
        {estados.map((estado, i) => (
          <Columna key={estado.nombre} estado={estado} indice={i} ids={columnas[estado.nombre] ?? []} onCrear={onCrear}>
            {(columnas[estado.nombre] ?? []).map((id, j) => {
              const t = porId.get(id)
              if (!t) return null
              return (
                <TarjetaOrdenable key={id} id={id}>
                  <Tarjeta tarea={t} estado={estados.find((x) => x.nombre === t.estado) ?? estado} personas={personas} departamentoColor={departamentos.find((d) => d.nombre === t.departamento)?.color} activa={tareaAbierta === id} fantasma={activa === id} indice={j} onAbrir={onAbrir} />
                </TarjetaOrdenable>
              )
            })}
          </Columna>
        ))}
      </div>
      <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' }}>
        {tareaActiva ? <Tarjeta tarea={tareaActiva} estado={estados.find((x) => x.nombre === tareaActiva.estado)} personas={personas} departamentoColor={departamentos.find((d) => d.nombre === tareaActiva.departamento)?.color} superpuesta /> : null}
      </DragOverlay>
    </DndContext>
  )
}

function TarjetaOrdenable({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id })
  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition }} {...attributes} {...listeners} className="tc-ordenable">
      {children}
    </div>
  )
}

function Columna({ estado, indice, ids, onCrear, children }: { estado: OpcionDeEstado; indice: number; ids: string[]; onCrear: PropsDeTablero['onCrear']; children: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id: idDeColumna(estado.nombre) })
  const [escribiendo, setEscribiendo] = useState(false)
  const [titulo, setTitulo] = useState('')
  const [creando, setCreando] = useState(false)

  async function crear() {
    const t = titulo.trim()
    if (!t || creando) return
    setCreando(true)
    try {
      await onCrear(estado.nombre, t)
      setTitulo('')
    } finally {
      setCreando(false)
    }
  }

  return (
    <section ref={setNodeRef} className="tc-columna" data-sobre={isOver ? 'true' : undefined} style={{ '--tono': `var(--tc-${estado.color})`, '--i': indice } as CSSProperties} aria-label={`Columna ${estado.nombre}`}>
      <header className="tc-columna-cabecera">
        <Etiqueta color={estado.color}>
          <span className="tc-punto" style={{ '--tono': `var(--tc-${estado.color})` } as CSSProperties} />
          {estado.nombre}
        </Etiqueta>
        <span className="text-[12px] tabular-nums text-[var(--ls-t3)]">{ids.length}</span>
        <button type="button" aria-label={`Añadir una tarea en ${estado.nombre}`} onClick={() => setEscribiendo(true)} className="tc-icono-boton ml-auto">
          <Plus className="h-3.5 w-3.5" />
        </button>
      </header>
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <div className="tc-columna-cuerpo">
          {children}
          {escribiendo ? (
            <div className="tc-nueva">
              <textarea
                autoFocus
                rows={2}
                value={titulo}
                onChange={(e) => setTitulo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault()
                    void crear()
                  }
                  if (e.key === 'Escape') {
                    setEscribiendo(false)
                    setTitulo('')
                  }
                }}
                onBlur={() => {
                  if (!titulo.trim()) setEscribiendo(false)
                }}
                placeholder="Título de la tarea… (Enter para crear)"
                className="w-full resize-none bg-transparent text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]"
              />
            </div>
          ) : (
            <button type="button" onClick={() => setEscribiendo(true)} className="tc-anadir">
              <Plus className="h-3.5 w-3.5" /> Nueva tarea
            </button>
          )}
        </div>
      </SortableContext>
    </section>
  )
}
