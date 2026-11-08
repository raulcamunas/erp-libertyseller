'use client'

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as TeclaDeReact } from 'react'
import { createPortal } from 'react-dom'
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Bold, ChevronRight, Code, GripVertical, Heading1, ImagePlus, Heading2, Heading3, Info, Italic, Link2, List, ListChecks, ListOrdered, Minus, Plus, Quote, Strikethrough, Table2, Text, Underline, Lock, Terminal, X, type LucideIcon } from 'lucide-react'
import { bloqueNuevo, estaBloqueado, textoDe, tieneBloquesAjenos, type Bloque, type Segmento, type TipoDeBloque } from '@/lib/tareas-clientes/bloques'
import { atajoDeMarkdown, borrar, cambiarTipo, dividir, insertarDespues, mover, numeracion, reemplazar, retrocederAlInicio, sangrar } from '@/lib/tareas-clientes/edicion'
import { htmlASegmentos, segmentosAHtml } from './textoHtml'
import { toast } from 'sonner'
import { BASE, pedir } from './api'
import { TablaEditable } from './TablaEditable'
import { SelectorDeEmoji } from './ui'

/**
 * EL EDITOR DEL CUERPO DE UNA TAREA.
 *
 * Bloques como en Notion: se crean con «/», con atajos de Markdown («# », «- », «[] », «> », «---») o con el «+» de la izquierda; se reordenan arrastrando el asa; se
 * sangran con Tab; y al seleccionar texto aparece una barrita para negrita, cursiva, subrayado, tachado, código, enlace y color. Todo lo que cambia la estructura lo hacen
 * las funciones puras de lib/tareas-clientes/edicion.ts (probadas aparte): aquí solo se traducen teclas a esas operaciones y se coloca el cursor.
 *
 * Lo que Notion tiene y aquí no se sabe editar sale como un bloque con candado: se ve, no se toca y no se pierde.
 */

interface ElementoDelMenu {
  id: string
  nombre: string
  ayuda: string
  icono: LucideIcon
  tipo: TipoDeBloque
  busca: string
}

const ELEMENTOS: ElementoDelMenu[] = [
  { id: 'parrafo', nombre: 'Texto', ayuda: 'Un párrafo normal', icono: Text, tipo: 'parrafo', busca: 'texto parrafo normal' },
  { id: 'h1', nombre: 'Título 1', ayuda: 'Un título grande', icono: Heading1, tipo: 'h1', busca: 'titulo 1 h1 encabezado' },
  { id: 'h2', nombre: 'Título 2', ayuda: 'Un título mediano', icono: Heading2, tipo: 'h2', busca: 'titulo 2 h2 encabezado' },
  { id: 'h3', nombre: 'Título 3', ayuda: 'Un título pequeño', icono: Heading3, tipo: 'h3', busca: 'titulo 3 h3 encabezado' },
  { id: 'vineta', nombre: 'Lista con viñetas', ayuda: 'Una lista sencilla', icono: List, tipo: 'vineta', busca: 'lista vinetas puntos' },
  { id: 'numerada', nombre: 'Lista numerada', ayuda: 'Una lista con números', icono: ListOrdered, tipo: 'numerada', busca: 'lista numerada numeros' },
  { id: 'tarea', nombre: 'Lista de tareas', ayuda: 'Casillas que se marcan', icono: ListChecks, tipo: 'tarea', busca: 'tareas casillas checklist todo' },
  { id: 'cita', nombre: 'Cita', ayuda: 'Una frase destacada', icono: Quote, tipo: 'cita', busca: 'cita quote frase' },
  { id: 'aviso', nombre: 'Aviso', ayuda: 'Un recuadro con icono', icono: Info, tipo: 'aviso', busca: 'aviso callout nota' },
  { id: 'codigo', nombre: 'Código', ayuda: 'Texto con letra de código', icono: Terminal, tipo: 'codigo', busca: 'codigo code' },
  { id: 'desplegable', nombre: 'Desplegable', ayuda: 'Un título que esconde lo que lleva debajo', icono: ChevronRight, tipo: 'desplegable', busca: 'desplegable toggle plegable acordeon' },
  { id: 'tabla', nombre: 'Tabla', ayuda: 'Filas y columnas', icono: Table2, tipo: 'tabla', busca: 'tabla filas columnas' },
  { id: 'imagen', nombre: 'Imagen', ayuda: 'Sube una imagen', icono: ImagePlus, tipo: 'imagen', busca: 'imagen foto captura subir' },
  { id: 'divisor', nombre: 'Divisor', ayuda: 'Una línea que separa', icono: Minus, tipo: 'divisor', busca: 'divisor linea separador' },
]

const LENGUAJES = ['plain text', 'javascript', 'typescript', 'python', 'sql', 'json', 'html', 'css', 'bash']

/* ------------------------------------------------------------------ */
/* El cursor                                                           */
/* ------------------------------------------------------------------ */

function colocarCursor(el: HTMLElement, posicion: number | 'inicio' | 'final') {
  el.focus()
  const sel = window.getSelection()
  if (!sel) return
  const rango = document.createRange()
  if (posicion === 'inicio') {
    rango.setStart(el, 0)
    rango.collapse(true)
  } else if (posicion === 'final') {
    rango.selectNodeContents(el)
    rango.collapse(false)
  } else {
    let resto = posicion
    const recorrido = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let colocado = false
    for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
      const largo = n.textContent?.length ?? 0
      if (resto <= largo) {
        rango.setStart(n, resto)
        rango.collapse(true)
        colocado = true
        break
      }
      resto -= largo
    }
    if (!colocado) {
      rango.selectNodeContents(el)
      rango.collapse(false)
    }
  }
  sel.removeAllRanges()
  sel.addRange(rango)
}

/** Lo que hay antes y después del cursor dentro de un bloque, con su formato */
function partirEnElCursor(el: HTMLElement): { antes: Segmento[]; despues: Segmento[] } | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return null
  const hasta = document.createRange()
  hasta.selectNodeContents(el)
  hasta.setEnd(r.startContainer, r.startOffset)
  const desde = document.createRange()
  desde.selectNodeContents(el)
  desde.setStart(r.endContainer, r.endOffset)
  const a = document.createElement('div')
  const d = document.createElement('div')
  a.appendChild(hasta.cloneContents())
  d.appendChild(desde.cloneContents())
  return { antes: htmlASegmentos(a), despues: htmlASegmentos(d) }
}

function cursorEnElBorde(el: HTMLElement, borde: 'inicio' | 'final'): boolean {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false
  const r = sel.getRangeAt(0)
  if (!el.contains(r.startContainer)) return false
  const probe = document.createRange()
  probe.selectNodeContents(el)
  if (borde === 'inicio') probe.setEnd(r.startContainer, r.startOffset)
  else probe.setStart(r.startContainer, r.startOffset)
  return probe.toString().length === 0
}

/* ------------------------------------------------------------------ */
/* El texto de un bloque                                               */
/* ------------------------------------------------------------------ */

const Editable = memo(function Editable({
  valor,
  onTexto,
  onTecla,
  onPegar,
  onEnfoque,
  registrar,
  marcador,
  soloLectura,
  className,
  id,
}: {
  valor: Segmento[]
  onTexto: (s: Segmento[]) => void
  onTecla: (e: TeclaDeReact<HTMLDivElement>) => void
  onPegar: (texto: string) => boolean
  onEnfoque: () => void
  registrar: (el: HTMLDivElement | null) => void
  marcador: string
  soloLectura: boolean
  className: string
  id: string
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const emitido = useRef('')

  // Lo que viene de fuera (otro compañero, deshacer, Notion) se pinta; lo que se acaba de escribir aquí no se vuelve a pintar, o el cursor saltaría
  useLayoutEffect(() => {
    const json = JSON.stringify(valor)
    if (ref.current && json !== emitido.current) {
      ref.current.innerHTML = segmentosAHtml(valor)
      emitido.current = json
    }
  }, [valor])

  const alEscribir = () => {
    if (!ref.current) return
    const s = htmlASegmentos(ref.current)
    emitido.current = JSON.stringify(s)
    onTexto(s)
  }

  return (
    <div
      ref={(el) => {
        ref.current = el
        registrar(el)
      }}
      id={`bq-${id}`}
      role="textbox"
      aria-multiline="true"
      aria-label="Bloque de texto"
      contentEditable={!soloLectura}
      suppressContentEditableWarning
      spellCheck
      data-marcador={marcador}
      className={`tc-editable ${className}`}
      onInput={alEscribir}
      onKeyDown={onTecla}
      onFocus={onEnfoque}
      onPaste={(e) => {
        const texto = e.clipboardData.getData('text/plain')
        e.preventDefault()
        if (!onPegar(texto)) document.execCommand('insertText', false, texto)
      }}
    />
  )
})

/* ------------------------------------------------------------------ */
/* Una fila del editor                                                 */
/* ------------------------------------------------------------------ */

interface PropsDeFila {
  bloque: Bloque
  numero: number | null
  soloLectura: boolean
  puedeArrastrar: boolean
  registrar: (id: string, el: HTMLDivElement | null) => void
  onTexto: (id: string, s: Segmento[]) => void
  onTecla: (e: TeclaDeReact<HTMLDivElement>, id: string) => void
  onPegar: (id: string, texto: string) => boolean
  onEnfoque: (id: string) => void
  onMarcar: (id: string, hecho: boolean) => void
  onCambio: (id: string, cambios: Partial<Bloque>) => void
  onMas: (id: string) => void
  /** Un desplegable: si está plegado, y cómo plegarlo o desplegarlo; y quitar una imagen o tabla */
  colapsado: boolean
  onAlternar: (id: string) => void
  onQuitar: (id: string) => void
}

const CLASE_DE_TIPO: Partial<Record<TipoDeBloque, string>> = {
  h1: 'text-[22px] font-semibold leading-[1.3] tracking-[-0.01em] mt-4',
  h2: 'text-[18px] font-semibold leading-[1.35] tracking-[-0.008em] mt-3',
  h3: 'text-[15px] font-semibold leading-[1.4] mt-2',
  cita: 'text-[14px] italic',
  codigo: 'font-mono text-[12.5px] whitespace-pre-wrap',
}

const MARCADOR_DE_TIPO: Partial<Record<TipoDeBloque, string>> = {
  parrafo: "Escribe «/» para ver los bloques",
  h1: 'Título 1',
  h2: 'Título 2',
  h3: 'Título 3',
  vineta: 'Elemento de la lista',
  numerada: 'Elemento de la lista',
  tarea: 'Tarea',
  cita: 'Escribe una cita',
  aviso: 'Escribe un aviso',
  codigo: 'Código',
  desplegable: 'Desplegable',
}

const Fila = memo(function Fila({ bloque: b, numero, soloLectura, puedeArrastrar, registrar, onTexto, onTecla, onPegar, onEnfoque, onMarcar, onCambio, onMas, colapsado, onAlternar, onQuitar }: PropsDeFila) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: b.id, disabled: !puedeArrastrar || estaBloqueado(b) })
  const nivel = b.nivel ?? 0
  const bloqueado = estaBloqueado(b)

  const cuerpo = (() => {
    if (b.tipo === 'divisor') return <hr className="my-3 border-[var(--ls-linea2)]" />
    if (b.tipo === 'notion') {
      return (
        <div className="tc-ajeno" title="Este contenido solo se edita en Notion">
          <Lock className="h-3 w-3 shrink-0" />
          <span className="truncate">{b.vista ?? 'Contenido de Notion'}</span>
          <span className="ml-auto shrink-0 text-[11px] text-[var(--ls-t4)]">solo en Notion</span>
        </div>
      )
    }
    if (b.tipo === 'tabla') return <TablaEditable bloque={b} soloLectura={soloLectura} onCambio={(c) => onCambio(b.id, c)} />
    if (b.tipo === 'imagen') {
      return b.url ? (
        <figure className="tc-imagen my-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={b.url} alt={textoDe(b.texto) || 'Imagen de la tarea'} loading="lazy" className="max-h-[420px] max-w-full rounded-[8px] border border-[var(--ls-linea)]" />
          {b.texto.length > 0 && <figcaption className="mt-1 text-[11.5px] text-[var(--ls-t3)]">{textoDe(b.texto)}</figcaption>}
          {!bloqueado && !soloLectura && <button type="button" onClick={() => onQuitar(b.id)} aria-label="Quitar la imagen" className="tc-imagen-quitar"><X className="h-3 w-3" /></button>}
        </figure>
      ) : (
        <div className="tc-ajeno">
          <Lock className="h-3 w-3" /> Imagen subida a Notion (solo se ve allí)
        </div>
      )
    }
    const texto = (
      <Editable
        id={b.id}
        valor={b.texto}
        onTexto={(s) => onTexto(b.id, s)}
        onTecla={(e) => onTecla(e, b.id)}
        onPegar={(t) => onPegar(b.id, t)}
        onEnfoque={() => onEnfoque(b.id)}
        registrar={(el) => registrar(b.id, el)}
        marcador={MARCADOR_DE_TIPO[b.tipo] ?? ''}
        soloLectura={soloLectura}
        className={`${CLASE_DE_TIPO[b.tipo] ?? 'text-[13.5px] leading-[1.6]'} ${b.tipo === 'tarea' && b.hecho ? 'tc-hecha' : ''}`}
      />
    )
    if (b.tipo === 'desplegable') {
      return (
        <div className="flex gap-1">
          <button type="button" aria-expanded={!colapsado} aria-label={colapsado ? 'Desplegar' : 'Plegar'} onClick={() => onAlternar(b.id)} className="tc-asa mt-[3px] !h-5 !w-5 shrink-0 !text-[var(--ls-t2)]">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${colapsado ? '' : 'rotate-90'}`} />
          </button>
          {texto}
        </div>
      )
    }
    if (b.tipo === 'vineta') return <div className="flex gap-2"><span aria-hidden className="mt-[0.62em] h-[5px] w-[5px] shrink-0 rounded-full bg-[var(--ls-t2)]" />{texto}</div>
    if (b.tipo === 'numerada') return <div className="flex gap-1.5"><span aria-hidden className="w-5 shrink-0 text-right text-[13.5px] tabular-nums leading-[1.6] text-[var(--ls-t3)]">{numero}.</span>{texto}</div>
    if (b.tipo === 'tarea') {
      return (
        <div className="flex gap-2">
          <input type="checkbox" checked={Boolean(b.hecho)} disabled={soloLectura} onChange={(e) => onMarcar(b.id, e.target.checked)} aria-label="Marcar como hecha" className="tc-casilla mt-[3px]" />
          {texto}
        </div>
      )
    }
    if (b.tipo === 'cita') return <div className="border-l-[3px] border-[var(--ls-linea2)] pl-3">{texto}</div>
    if (b.tipo === 'aviso') {
      return (
        <div className="tc-aviso">
          <SelectorDeEmoji valor={b.icono ?? null} onElegir={(e) => onCambio(b.id, { icono: e ?? '💡' })}>
            <button type="button" aria-label="Cambiar el icono del aviso" disabled={soloLectura} className="mt-px text-[17px] leading-none">{b.icono ?? '💡'}</button>
          </SelectorDeEmoji>
          {texto}
        </div>
      )
    }
    if (b.tipo === 'codigo') {
      return (
        <div className="tc-codigo">
          <select value={b.lenguaje ?? 'plain text'} disabled={soloLectura} onChange={(e) => onCambio(b.id, { lenguaje: e.target.value })} aria-label="Lenguaje" className="tc-lenguaje">
            {LENGUAJES.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
          {texto}
        </div>
      )
    }
    return texto
  })()

  return (
    <div ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, marginLeft: nivel * 24 } as CSSProperties} data-arrastrando={isDragging ? 'true' : undefined} className="tc-bloque group/b">
      {!soloLectura && (
        <div className="tc-asas">
          <button type="button" aria-label="Añadir un bloque debajo" onClick={() => onMas(b.id)} className="tc-asa"><Plus className="h-3.5 w-3.5" /></button>
          <button type="button" ref={setActivatorNodeRef} aria-label="Arrastrar el bloque" disabled={!puedeArrastrar || bloqueado} {...attributes} {...listeners} className="tc-asa cursor-grab active:cursor-grabbing"><GripVertical className="h-3.5 w-3.5" /></button>
        </div>
      )}
      <div className="min-w-0 flex-1">{cuerpo}</div>
    </div>
  )
})

/* ------------------------------------------------------------------ */
/* El editor                                                           */
/* ------------------------------------------------------------------ */

export interface PropsDeEditor {
  bloques: Bloque[]
  onCambio: (bloques: Bloque[]) => void
  soloLectura?: boolean
}

export function Editor({ bloques, onCambio, soloLectura = false }: PropsDeEditor) {
  const elementos = useRef(new Map<string, HTMLDivElement>())
  const ultimoEnfocado = useRef<string | null>(null)
  const [cursor, setCursor] = useState<{ id: string; posicion: number | 'inicio' | 'final'; n: number } | null>(null)
  const [menu, setMenu] = useState<{ id: string; filtro: string; x: number; y: number; indice: number } | null>(null)
  const raiz = useRef<HTMLDivElement>(null)

  // El deshacer es del editor y no del navegador: un cambio de estructura (partir, unir, mover) no lo deshace el del navegador
  const historia = useRef<Bloque[][]>([])
  const futuro = useRef<Bloque[][]>([])
  const ultimoApunte = useRef(0)
  const actual = useRef(bloques)
  useEffect(() => {
    actual.current = bloques
  }, [bloques])

  const aplicar = useCallback(
    (nuevos: Bloque[], enfocar?: { id: string; posicion: number | 'inicio' | 'final' }, junta = false) => {
      const ahora = Date.now()
      // Escribir seguido es un solo paso para deshacer; una acción de estructura, uno aparte
      if (!junta || ahora - ultimoApunte.current > 600) {
        historia.current.push(actual.current)
        if (historia.current.length > 100) historia.current.shift()
        futuro.current = []
      }
      ultimoApunte.current = ahora
      actual.current = nuevos
      onCambio(nuevos)
      if (enfocar) setCursor({ ...enfocar, n: ahora })
    },
    [onCambio]
  )

  useEffect(() => {
    if (!cursor) return
    const el = elementos.current.get(cursor.id)
    if (el) colocarCursor(el, cursor.posicion)
  }, [cursor])

  const registrar = useCallback((id: string, el: HTMLDivElement | null) => {
    if (el) elementos.current.set(id, el)
    else elementos.current.delete(id)
  }, [])

  const sensores = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const hayAjenos = tieneBloquesAjenos(bloques)
  const numeros = useMemo(() => numeracion(bloques), [bloques])

  const abrirMenu = useCallback((id: string, filtro: string) => {
    const el = elementos.current.get(id)
    const r = el?.getBoundingClientRect()
    setMenu({ id, filtro, x: r?.left ?? 0, y: (r?.bottom ?? 0) + 4, indice: 0 })
  }, [])

  const elementosFiltrados = useMemo(() => {
    const f = (menu?.filtro ?? '').toLowerCase()
    return f ? ELEMENTOS.filter((e) => e.busca.includes(f) || e.nombre.toLowerCase().includes(f)) : ELEMENTOS
  }, [menu?.filtro])

  const elegirDelMenu = useCallback(
    (e: ElementoDelMenu, id: string) => {
      setMenu(null)
      let lista = reemplazar(actual.current, id, { texto: [] })
      if (e.tipo === 'imagen') {
        // El bloque queda como un párrafo vacío mientras se elige el fichero; al subirse se vuelve imagen
        aplicar(lista, { id, posicion: 'inicio' })
        bloqueDeImagen.current = id
        entradaDeImagen.current?.click()
        return
      }
      if (e.tipo === 'tabla') {
        const vacia = () => [[], [], []] as Segmento[][]
        lista = cambiarTipo(lista, id, 'tabla', { filas: [vacia(), vacia(), vacia()], filaIds: [null, null, null], encabezadoFila: true, encabezadoColumna: false })
        const detras = bloqueNuevo('parrafo')
        aplicar(insertarDespues(lista, id, detras), { id: detras.id, posicion: 'inicio' })
        return
      }
      lista = cambiarTipo(lista, id, e.tipo)
      if (e.tipo === 'divisor') {
        const nuevo = bloqueNuevo('parrafo')
        aplicar(insertarDespues(lista, id, nuevo), { id: nuevo.id, posicion: 'inicio' })
      } else aplicar(lista, { id, posicion: 'inicio' })
    },
    [aplicar]
  )

  const alTexto = useCallback(
    (id: string, s: Segmento[]) => {
      const b = actual.current.find((x) => x.id === id)
      if (!b) return
      const plano = textoDe(s)
      // Los atajos de Markdown solo valen en un párrafo: «# Plan» lo vuelve título y se come el «# »
      if (b.tipo === 'parrafo' && s.length > 0 && !s.some((x) => x.b || x.i || x.u || x.s || x.c || x.l)) {
        const atajo = atajoDeMarkdown(plano)
        // Se convierte cuando el atajo se acaba de completar al teclear («- ») o llega de golpe (un pegado, un dictado); un párrafo que ya lo llevaba antes y se edita no cambia
        if (atajo && !atajoDeMarkdown(textoDe(b.texto))) {
          setMenu(null)
          let lista = reemplazar(actual.current, id, { texto: atajo.resto ? [{ t: atajo.resto }] : [] })
          lista = cambiarTipo(lista, id, atajo.tipo, atajo.extra)
          if (atajo.tipo === 'divisor') {
            const nuevo = bloqueNuevo('parrafo')
            aplicar(insertarDespues(lista, id, nuevo), { id: nuevo.id, posicion: 'inicio' })
          } else aplicar(lista, { id, posicion: 'final' })
          return
        }
      }
      // La «/» al principio de un bloque vacío abre el menú de bloques, y lo que se sigue escribiendo lo filtra
      const barra = /^\/(\S{0,20})$/.exec(plano)
      if (barra && (b.tipo === 'parrafo' || b.tipo === 'vineta' || b.tipo === 'numerada' || b.tipo === 'tarea')) abrirMenu(id, barra[1])
      else setMenu((m) => (m?.id === id ? null : m))
      aplicar(reemplazar(actual.current, id, { texto: s }), undefined, true)
    },
    [aplicar, abrirMenu]
  )

  const alTecla = useCallback(
    (e: TeclaDeReact<HTMLDivElement>, id: string) => {
      const el = e.currentTarget
      const lista = actual.current
      const i = lista.findIndex((x) => x.id === id)
      const b = lista[i]
      if (!b) return
      const meta = e.metaKey || e.ctrlKey

      if (menu && menu.id === id) {
        if (e.key === 'ArrowDown') { e.preventDefault(); setMenu({ ...menu, indice: (menu.indice + 1) % Math.max(1, elementosFiltrados.length) }); return }
        if (e.key === 'ArrowUp') { e.preventDefault(); setMenu({ ...menu, indice: (menu.indice - 1 + elementosFiltrados.length) % Math.max(1, elementosFiltrados.length) }); return }
        if (e.key === 'Escape') { e.preventDefault(); setMenu(null); return }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const elegido = elementosFiltrados[menu.indice]
          if (elegido) elegirDelMenu(elegido, id)
          else setMenu(null)
          return
        }
      }

      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        const pila = e.shiftKey ? futuro : historia
        const otra = e.shiftKey ? historia : futuro
        const siguiente = pila.current.pop()
        if (siguiente) {
          otra.current.push(actual.current)
          actual.current = siguiente
          onCambio(siguiente)
        }
        return
      }
      if (meta && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        poner('enlace')
        return
      }
      if (meta && e.shiftKey && e.key.toLowerCase() === 'x') {
        e.preventDefault()
        poner('tachado')
        return
      }
      if (meta && e.key.toLowerCase() === 'e') {
        e.preventDefault()
        poner('codigo')
        return
      }

      if (e.key === 'Enter' && !e.shiftKey && !meta) {
        if (b.tipo === 'codigo') {
          // En un bloque de código Enter es un salto de línea; para salir, Ctrl/Cmd+Enter
          e.preventDefault()
          document.execCommand('insertLineBreak')
          return
        }
        e.preventDefault()
        const partes = partirEnElCursor(el)
        if (!partes) return
        const r = dividir(lista, id, partes.antes, partes.despues)
        aplicar(r.bloques, r.cursor)
        return
      }
      if (e.key === 'Enter' && meta) {
        e.preventDefault()
        const nuevo = bloqueNuevo('parrafo')
        aplicar(insertarDespues(lista, id, nuevo), { id: nuevo.id, posicion: 'inicio' })
        return
      }
      if (e.key === 'Backspace' && cursorEnElBorde(el, 'inicio')) {
        const sel = window.getSelection()
        if (sel?.isCollapsed) {
          e.preventDefault()
          const r = retrocederAlInicio(lista, id)
          aplicar(r.bloques, r.cursor)
          return
        }
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        aplicar(sangrar(lista, id, e.shiftKey ? -1 : 1), { id, posicion: 'final' })
        return
      }
      if (e.key === 'ArrowUp' && cursorEnElBorde(el, 'inicio') && i > 0) {
        const previo = [...lista.slice(0, i)].reverse().find((x) => !estaBloqueado(x) && x.tipo !== 'divisor')
        if (previo) { e.preventDefault(); setCursor({ id: previo.id, posicion: 'final', n: Date.now() }) }
        return
      }
      if (e.key === 'ArrowDown' && cursorEnElBorde(el, 'final') && i < lista.length - 1) {
        const siguiente = lista.slice(i + 1).find((x) => !estaBloqueado(x) && x.tipo !== 'divisor')
        if (siguiente) { e.preventDefault(); setCursor({ id: siguiente.id, posicion: 'inicio', n: Date.now() }) }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [aplicar, menu, elementosFiltrados, elegirDelMenu, onCambio]
  )

  /** Pegar varias líneas crea varios bloques (y una lista de Markdown pegada sale como lista) */
  const alPegar = useCallback(
    (id: string, texto: string): boolean => {
      const lineas = texto.replace(/\r/g, '').split('\n')
      if (lineas.length < 2) return false
      let lista = actual.current
      const partes = partirEnElCursor(elementos.current.get(id) as HTMLElement)
      if (!partes) return false
      const [primera, ...resto] = lineas
      let ultimo = id
      lista = reemplazar(lista, id, { texto: [...partes.antes, { t: primera }] })
      for (const linea of resto) {
        if (!linea.trim() && resto.indexOf(linea) === resto.length - 1) continue
        const atajo = atajoDeMarkdown(linea)
        const nuevo: Bloque = atajo ? { ...bloqueNuevo(atajo.tipo), texto: atajo.resto ? [{ t: atajo.resto }] : [], ...atajo.extra } : { ...bloqueNuevo('parrafo'), texto: linea ? [{ t: linea }] : [] }
        lista = insertarDespues(lista, ultimo, nuevo)
        ultimo = nuevo.id
      }
      if (partes.despues.length > 0) lista = reemplazar(lista, ultimo, { texto: [...(lista.find((x) => x.id === ultimo)?.texto ?? []), ...partes.despues] })
      aplicar(lista, { id: ultimo, posicion: 'final' })
      return true
    },
    [aplicar]
  )

  /* La barrita de formato sobre el texto seleccionado */
  const [barra, setBarra] = useState<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (soloLectura) return
    const alCambiarSeleccion = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !raiz.current?.contains(sel.anchorNode) || !raiz.current.contains(sel.focusNode)) return setBarra(null)
      const r = sel.getRangeAt(0).getBoundingClientRect()
      if (r.width === 0) return setBarra(null)
      setBarra({ x: r.left + r.width / 2, y: r.top })
    }
    document.addEventListener('selectionchange', alCambiarSeleccion)
    return () => document.removeEventListener('selectionchange', alCambiarSeleccion)
  }, [soloLectura])

  const poner = useCallback((cual: 'negrita' | 'cursiva' | 'subrayado' | 'tachado' | 'codigo' | 'enlace' | { color: string | null }) => {
    const sel = window.getSelection()
    const activo = document.activeElement as HTMLElement | null
    if (!sel || sel.isCollapsed || !activo) return
    if (cual === 'negrita') document.execCommand('bold')
    else if (cual === 'cursiva') document.execCommand('italic')
    else if (cual === 'subrayado') document.execCommand('underline')
    else if (cual === 'tachado') document.execCommand('strikeThrough')
    else if (cual === 'codigo') document.execCommand('insertHTML', false, `<code>${sel.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;')}</code>`)
    else if (cual === 'enlace') {
      const url = window.prompt('Dirección del enlace (https://…)', 'https://')
      if (url && /^(https?:\/\/|mailto:)/i.test(url.trim())) document.execCommand('createLink', false, url.trim())
    } else {
      const texto = sel.toString().replace(/&/g, '&amp;').replace(/</g, '&lt;')
      document.execCommand('insertHTML', false, cual.color ? `<span data-k="${cual.color}">${texto}</span>` : texto)
    }
    activo.dispatchEvent(new Event('input', { bubbles: true }))
  }, [])

  const alArrastrar = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const desde = actual.current.findIndex((b) => b.id === e.active.id)
    const hasta = actual.current.findIndex((b) => b.id === e.over?.id)
    aplicar(mover(actual.current, desde, hasta))
  }

  const alMas = (id: string) => {
    const nuevo = bloqueNuevo('parrafo')
    nuevo.texto = [{ t: '/' }]
    aplicar(insertarDespues(actual.current, id, nuevo), { id: nuevo.id, posicion: 'final' })
    window.setTimeout(() => abrirMenu(nuevo.id, ''), 0)
  }

  const alCambiarBloque = useCallback((id: string, cambios: Partial<Bloque>) => aplicar(reemplazar(actual.current, id, cambios)), [aplicar])
  const alMarcar = useCallback((id: string, hecho: boolean) => aplicar(reemplazar(actual.current, id, { hecho })), [aplicar])
  const alEnfocar = useCallback((id: string) => {
    ultimoEnfocado.current = id
  }, [])

  const vacio = bloques.length === 0

  /* ---- Desplegables: lo que cuelga de uno plegado (los bloques siguientes con más sangría) no se enseña ---- */
  const [plegados, setPlegados] = useState<ReadonlySet<string>>(() => new Set())
  const alternarPlegado = useCallback((id: string) => setPlegados((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n }), [])
  const ocultos = useMemo(() => {
    const salida = new Set<string>()
    let tope: number | null = null
    for (const b of bloques) {
      const nivel = b.nivel ?? 0
      if (tope !== null && nivel > tope) { salida.add(b.id); continue }
      tope = null
      if (b.tipo === 'desplegable' && plegados.has(b.id)) tope = nivel
    }
    return salida
  }, [bloques, plegados])

  const alQuitar = useCallback((id: string) => aplicar(borrar(actual.current, id)), [aplicar])

  /* ---- Imágenes: el menú «/» abre el selector de ficheros y la imagen se sube al almacén de las tareas ---- */
  const entradaDeImagen = useRef<HTMLInputElement>(null)
  const bloqueDeImagen = useRef<string | null>(null)
  const [subiendo, setSubiendo] = useState(false)
  async function subirImagen(fichero: File) {
    const id = bloqueDeImagen.current
    bloqueDeImagen.current = null
    if (!id) return
    setSubiendo(true)
    try {
      const f = new FormData()
      f.set('fichero', fichero)
      const { url } = await pedir<{ url: string }>(`${BASE}/subir`, { metodo: 'POST', formulario: f })
      const lista = reemplazar(actual.current, id, { tipo: 'imagen', texto: [], url })
      const detras = bloqueNuevo('parrafo')
      aplicar(insertarDespues(lista, id, detras), { id: detras.id, posicion: 'inicio' })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido subir la imagen')
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <div ref={raiz} className="tc-editor" onClick={(e) => {
      // Pulsar en el hueco de debajo del último bloque pone el cursor al final, o crea un párrafo si el último ya tiene algo
      if (soloLectura || e.target !== e.currentTarget) return
      const ultimo = actual.current[actual.current.length - 1]
      if (ultimo && ultimo.tipo === 'parrafo' && ultimo.texto.length === 0) return setCursor({ id: ultimo.id, posicion: 'final', n: Date.now() })
      const nuevo = bloqueNuevo('parrafo')
      aplicar([...actual.current, nuevo], { id: nuevo.id, posicion: 'inicio' })
    }}>
      {hayAjenos && (
        <p className="mb-2 flex items-start gap-1.5 rounded-[7px] bg-[var(--ls-sup2)] px-2.5 py-1.5 text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">
          <Lock className="mt-px h-3 w-3 shrink-0" />
          Hay contenido de Notion que aquí solo se ve (marcado con un candado). Puedes editar el texto de los demás bloques; para reordenar o añadir en medio, usa Notion.
        </p>
      )}
      <DndContext sensors={sensores} collisionDetection={closestCenter} onDragEnd={alArrastrar}>
        <SortableContext items={bloques.map((b) => b.id)} strategy={verticalListSortingStrategy}>
          {bloques.map((b, i) => (ocultos.has(b.id) ? null : (
            <Fila key={b.id} bloque={b} numero={numeros[i]} soloLectura={soloLectura} puedeArrastrar={!hayAjenos} registrar={registrar} onTexto={alTexto} onTecla={alTecla} onPegar={alPegar} onEnfoque={alEnfocar} onMarcar={alMarcar} onCambio={alCambiarBloque} onMas={alMas} colapsado={plegados.has(b.id)} onAlternar={alternarPlegado} onQuitar={alQuitar} />
          )))}
        </SortableContext>
      </DndContext>
      <input ref={entradaDeImagen} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="sr-only" tabIndex={-1} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void subirImagen(f) }} />
      {subiendo && <p className="my-1 text-[12px] text-[var(--ls-t3)]" role="status">Subiendo la imagen…</p>}
      {vacio && !soloLectura && (
        <button type="button" onClick={() => { const n = bloqueNuevo('parrafo'); aplicar([n], { id: n.id, posicion: 'inicio' }) }} className="tc-vacio">
          Escribe aquí… o pulsa «/» para elegir un bloque
        </button>
      )}

      {menu && typeof document !== 'undefined' && createPortal(
        <div role="listbox" aria-label="Bloques" className="tc-menu-slash" style={{ left: Math.min(menu.x, window.innerWidth - 280), top: Math.min(menu.y, window.innerHeight - 320) }} onMouseDown={(e) => e.preventDefault()}>
          {elementosFiltrados.length === 0 && <p className="px-3 py-3 text-[12px] text-[var(--ls-t4)]">Ningún bloque se llama así</p>}
          {elementosFiltrados.map((e, i) => {
            const Icono = e.icono
            return (
              <button key={e.id} type="button" role="option" aria-selected={i === menu.indice} data-activo={i === menu.indice ? 'true' : undefined} onMouseEnter={() => setMenu({ ...menu, indice: i })} onClick={() => elegirDelMenu(e, menu.id)} className="tc-menu-item">
                <span className="tc-menu-icono"><Icono className="h-4 w-4" /></span>
                <span className="min-w-0 flex-1 text-left"><span className="block text-[12.5px] text-[var(--ls-t1)]">{e.nombre}</span><span className="block truncate text-[11px] text-[var(--ls-t4)]">{e.ayuda}</span></span>
              </button>
            )
          })}
        </div>,
        document.body
      )}

      {barra && typeof document !== 'undefined' && createPortal(
        <div className="tc-formato" style={{ left: Math.max(8, Math.min(barra.x, window.innerWidth - 8)), top: Math.max(8, barra.y - 8) }} onMouseDown={(e) => e.preventDefault()} role="toolbar" aria-label="Formato del texto">
          <button type="button" title="Negrita (Ctrl+B)" aria-label="Negrita" onClick={() => poner('negrita')}><Bold className="h-3.5 w-3.5" /></button>
          <button type="button" title="Cursiva (Ctrl+I)" aria-label="Cursiva" onClick={() => poner('cursiva')}><Italic className="h-3.5 w-3.5" /></button>
          <button type="button" title="Subrayado (Ctrl+U)" aria-label="Subrayado" onClick={() => poner('subrayado')}><Underline className="h-3.5 w-3.5" /></button>
          <button type="button" title="Tachado (Ctrl+Mayús+X)" aria-label="Tachado" onClick={() => poner('tachado')}><Strikethrough className="h-3.5 w-3.5" /></button>
          <button type="button" title="Código (Ctrl+E)" aria-label="Código" onClick={() => poner('codigo')}><Code className="h-3.5 w-3.5" /></button>
          <button type="button" title="Enlace (Ctrl+K)" aria-label="Enlace" onClick={() => poner('enlace')}><Link2 className="h-3.5 w-3.5" /></button>
          <span className="tc-formato-sep" />
          {(['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const).map((c) => (
            <button key={c} type="button" title={`Color ${c}`} aria-label={`Texto de color ${c}`} onClick={() => poner({ color: c })} className="tc-formato-color" style={{ '--tono': `var(--tc-${c})` } as CSSProperties} />
          ))}
          <button type="button" title="Quitar el color" aria-label="Quitar el color" onClick={() => poner({ color: null })} className="tc-formato-color" style={{ '--tono': 'var(--ls-t3)' } as CSSProperties}>
            <span className="text-[10px] leading-none">A</span>
          </button>
        </div>,
        document.body
      )}
    </div>
  )
}

