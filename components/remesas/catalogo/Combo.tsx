'use client'

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown } from 'lucide-react'
import { CELDA } from '@/lib/estilo/denso'
import { claveTexto } from '@/lib/fba/catalogo/tipos'
import { cx } from '../comun/ui'

/**
 * UN DESPLEGABLE QUE SE ESCRIBE.
 *
 * El «chip» de las hojas de cálculo con el que se monta un envío: se hace clic, o
 * se empieza a teclear, y la lista se acota. Está pensado para trabajar SIN
 * RATÓN —se teclea «84», Enter, y el foco salta a la casilla siguiente— porque un
 * envío de ShoesF son cuarenta líneas y cada línea son tres elecciones.
 *
 *
 * ============ LA LISTA VA FUERA DE LA TABLA ============
 *
 * Se pinta en un portal, pegada a la casilla con `position: fixed`. Dentro de la
 * tabla la cortaría el `overflow` de su caja (y la del diálogo que la contiene), que
 * es justo lo que hace que un desplegable «no se vea entero» en una cuadrícula con
 * scroll. Si abajo no hay sitio, se abre hacia arriba.
 *
 *
 * ============ EL TECLADO ============
 *
 *   ↑ ↓       moverse por la lista
 *   Enter     elegir la marcada y avisar (`alTerminar`) para que el foco avance
 *   Tab       elegir la marcada SI se ha escrito algo, y seguir de largo
 *   Esc       cerrar y volver a lo que había (no cierra el diálogo de debajo)
 *
 * Una opción deshabilitada se ve y se explica —«ya está en la fila 3»—, pero no se
 * puede elegir: esconderla haría pensar que la talla no existe.
 */

export interface OpcionCombo {
  /** Lo que se devuelve al elegirla */
  valor: string
  /** Lo que se escribe para encontrarla, y lo que se enseña en la casilla al elegirla */
  texto: string
  /** Cómo se pinta en la lista. Si falta, el texto */
  etiqueta?: ReactNode
  /** Una nota gris a la derecha: «3 colores», «ya está en la fila 2». No se busca en ella */
  detalle?: string
  /** Texto extra por el que SÍ se puede encontrar: los colores de una REF, por ejemplo */
  claves?: string
  deshabilitada?: boolean
  /** Se ve, pero apagada: un modelo sin continuidad */
  atenuada?: boolean
  /** Una acción más que una opción («Todas las tallas»): va destacada */
  especial?: boolean
}

export function Combo({
  valor,
  opciones,
  onElegir,
  alTerminar,
  etiqueta,
  placeholder,
  deshabilitado,
  sinResultados = 'Nada que coincida',
  pie,
  inputRef,
  className,
  anchoLista = 190,
}: {
  valor: string | null
  opciones: OpcionCombo[]
  onElegir: (valor: string) => void
  /** Se llama tras elegir con Enter o con el ratón: ahí el foco debe saltar a la siguiente casilla */
  alTerminar?: () => void
  etiqueta: string
  placeholder?: string
  deshabilitado?: boolean
  sinResultados?: string
  /** Una acción fija al pie de la lista: «+ Nueva referencia…» */
  pie?: { texto: ReactNode; onClick: (escrito: string) => void }
  inputRef?: (el: HTMLInputElement | null) => void
  className?: string
  anchoLista?: number
}) {
  const id = useId()
  const envoltura = useRef<HTMLDivElement>(null)
  const lista = useRef<HTMLUListElement>(null)

  const [abierto, setAbierto] = useState(false)
  const [consulta, setConsulta] = useState('')
  const [escribiendo, setEscribiendo] = useState(false)
  const [activa, setActiva] = useState(0)
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number; ancho: number; alto: number } | null>(null)

  const elegida = useMemo(() => opciones.find((o) => o.valor === valor) ?? null, [opciones, valor])
  const textoMostrado = escribiendo ? consulta : (elegida?.texto ?? valor ?? '')

  /** Las que encajan con lo escrito; las que EMPIEZAN por ello, antes */
  const visibles = useMemo(() => {
    const q = claveTexto(consulta)
    if (!escribiendo || q === '') return opciones
    const palabras = q.split(' ')
    const encajan = opciones.filter((o) => {
      if (o.especial) return false
      // El texto de la opción y sus `claves`; la nota gris («1 color», «ya está en la fila 2») no se
      // busca, o escribir un 1 encontraría todas las REF con «1 color»
      const t = claveTexto(`${o.texto} ${o.claves ?? ''}`)
      return palabras.every((p) => t.includes(p))
    })
    return encajan.sort((a, b) => Number(claveTexto(b.texto).startsWith(q)) - Number(claveTexto(a.texto).startsWith(q)))
  }, [opciones, consulta, escribiendo])

  const marcada = Math.min(activa, Math.max(visibles.length - 1, 0))

  const medir = useCallback(() => {
    const el = envoltura.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const ancho = Math.max(r.width, anchoLista)
    const abajo = window.innerHeight - r.bottom
    const arriba = r.top
    const haciaArriba = abajo < 190 && arriba > abajo
    setPos({
      left: Math.max(8, Math.min(r.left, window.innerWidth - ancho - 8)),
      top: haciaArriba ? undefined : r.bottom + 2,
      bottom: haciaArriba ? window.innerHeight - r.top + 2 : undefined,
      ancho,
      alto: Math.max(120, Math.min(288, (haciaArriba ? arriba : abajo) - 12)),
    })
  }, [anchoLista])

  useLayoutEffect(() => {
    if (!abierto) return
    medir()
    window.addEventListener('resize', medir)
    window.addEventListener('scroll', medir, true)
    return () => {
      window.removeEventListener('resize', medir)
      window.removeEventListener('scroll', medir, true)
    }
  }, [abierto, medir])

  // La marcada siempre a la vista
  useEffect(() => {
    if (!abierto) return
    lista.current?.querySelector('[data-marcada="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [abierto, marcada, visibles])

  function abrir() {
    if (deshabilitado) return
    setAbierto(true)
    // Al abrir sin escribir, se marca la que ya estaba elegida
    const i = opciones.findIndex((o) => o.valor === valor)
    setActiva(i >= 0 ? i : 0)
  }

  function cerrar() {
    setAbierto(false)
    setEscribiendo(false)
    setConsulta('')
  }

  function elegir(o: OpcionCombo | undefined): boolean {
    if (!o || o.deshabilitada) return false
    onElegir(o.valor)
    cerrar()
    return true
  }

  function alPulsar(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!abierto) return abrir()
        setActiva(Math.min(marcada + 1, visibles.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!abierto) return abrir()
        setActiva(Math.max(marcada - 1, 0))
        break
      case 'Enter':
        if (!abierto) {
          e.preventDefault()
          abrir()
          return
        }
        e.preventDefault()
        if (elegir(visibles[marcada])) alTerminar?.()
        break
      case 'Tab':
        // Tab acepta lo marcado solo si se ha escrito algo; si no, deja pasar
        if (abierto && escribiendo && consulta.trim() !== '') elegir(visibles[marcada])
        else cerrar()
        break
      case 'Escape':
        if (abierto) {
          // Que el Esc no llegue al diálogo de debajo: cerraría todo el envío
          e.preventDefault()
          e.stopPropagation()
          e.nativeEvent.stopImmediatePropagation()
          cerrar()
        }
        break
    }
  }

  const idLista = `${id}-lista`

  return (
    <div ref={envoltura} className={cx('group/combo relative min-w-0', className)}>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={etiqueta}
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        aria-activedescendant={abierto && visibles[marcada] ? `${id}-o${marcada}` : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        disabled={deshabilitado}
        value={textoMostrado}
        placeholder={placeholder}
        onFocus={(e) => {
          e.currentTarget.select()
          abrir()
        }}
        onClick={() => {
          if (!abierto) abrir()
        }}
        onChange={(e) => {
          setEscribiendo(true)
          setConsulta(e.target.value)
          setActiva(0)
          if (!abierto) setAbierto(true)
        }}
        onKeyDown={alPulsar}
        onBlur={cerrar}
        className={cx(CELDA.editable, 'pr-[18px]', !elegida && !escribiendo && 'placeholder:text-[var(--ls-t4)]', deshabilitado && 'cursor-default opacity-50')}
      />
      <ChevronDown
        aria-hidden
        className={cx(
          'pointer-events-none absolute right-[4px] top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)] transition-opacity',
          abierto ? 'opacity-100' : 'opacity-0 group-hover/combo:opacity-100'
        )}
      />

      {abierto &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            // Los clics en la lista no le quitan el foco a la casilla: si no, el blur la cerraría antes de elegir
            onMouseDown={(e) => e.preventDefault()}
            style={{ position: 'fixed', left: pos.left, top: pos.top, bottom: pos.bottom, width: pos.ancho, maxHeight: pos.alto, zIndex: 300 }}
            className="flex flex-col overflow-hidden rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] shadow-[0_10px_30px_-8px_rgba(0,0,0,0.55)]"
          >
            <ul ref={lista} id={idLista} role="listbox" aria-label={etiqueta} className="min-h-0 flex-1 overflow-y-auto py-[3px]">
              {visibles.length === 0 && <li className="px-[10px] py-[7px] text-[11.5px] text-[var(--ls-t4)]">{sinResultados}</li>}
              {visibles.map((o, i) => {
                const esMarcada = i === marcada
                const esElegida = o.valor === valor
                return (
                  <li
                    key={o.valor}
                    id={`${id}-o${i}`}
                    role="option"
                    aria-selected={esElegida}
                    aria-disabled={o.deshabilitada || undefined}
                    data-marcada={esMarcada}
                    onMouseEnter={() => setActiva(i)}
                    onClick={() => {
                      if (elegir(o)) alTerminar?.()
                    }}
                    className={cx(
                      'mx-[3px] flex cursor-pointer items-center gap-2 rounded-[5px] px-[7px] py-[4px] text-[12.5px]',
                      esMarcada && 'bg-[var(--ls-sup3)]',
                      o.especial && 'font-medium text-[var(--ls-acc)]',
                      o.deshabilitada ? 'cursor-not-allowed text-[var(--ls-t4)]' : o.atenuada ? 'text-[var(--ls-t3)]' : !o.especial && 'text-[var(--ls-t1)]',
                      o.especial && visibles[i + 1] && !visibles[i + 1].especial && 'mb-[3px] border-b border-[var(--ls-linea)] pb-[6px] rounded-b-none'
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{o.etiqueta ?? o.texto}</span>
                    {o.detalle && <span className="max-w-[55%] shrink-0 truncate text-[11px] text-[var(--ls-t4)]">{o.detalle}</span>}
                    {esElegida && <Check className="h-3 w-3 shrink-0 text-[var(--ls-acc)]" />}
                  </li>
                )
              })}
            </ul>
            {pie && (
              <button
                type="button"
                onClick={() => {
                  const escrito = escribiendo ? consulta.trim() : ''
                  cerrar()
                  pie.onClick(escrito)
                }}
                className="flex shrink-0 items-center gap-2 border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-[10px] py-[6px] text-left text-[12px] font-medium text-[var(--ls-acc)] hover:bg-[var(--ls-sup3)]"
              >
                {pie.texto}
              </button>
            )}
          </div>,
          document.body
        )}
    </div>
  )
}
