'use client'

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { Check, Search, X } from 'lucide-react'
import { Avatar } from '@/components/rendimiento/ui'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { COLORES_NOTION, type ColorNotion, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import { colorCss, NOMBRE_DE_COLOR } from '@/lib/tareas-clientes/colores'

/**
 * LAS PIEZAS COMUNES DE TAREAS DE CLIENTES: etiquetas de color, avatares, y los selectores (opción, personas, color, emoji) que se abren como un menú pequeño.
 * Todo se pinta con las variables de la paleta (`--tc-*`) y los tokens del ERP (`--ls-*`): ningún color suelto.
 */

export const estiloDeColor = (color: string | null | undefined) => ({ '--tono': colorCss(color) }) as CSSProperties

/** Una etiqueta con el color de su opción: el nombre de la columna, el departamento */
export function Etiqueta({ color, children, pequena = false, className = '' }: { color: string | null | undefined; children: ReactNode; pequena?: boolean; className?: string }) {
  return (
    <span className={`tc-etiqueta ${pequena ? 'tc-etiqueta-p' : ''} ${className}`} style={estiloDeColor(color)}>
      {children}
    </span>
  )
}

/** Un punto del color de una opción */
export const Punto = ({ color }: { color: string | null | undefined }) => <span aria-hidden className="tc-punto" style={estiloDeColor(color)} />

export function NombreDePersona(personas: readonly PersonaTC[], id: string): string {
  return personas.find((p) => p.id === id)?.nombre ?? 'Alguien'
}

/** Las caras de varias personas solapadas, con un «+2» si no caben */
export function PilaDeAvatares({ ids, personas, maximo = 3, tamano = 20 }: { ids: readonly string[]; personas: readonly PersonaTC[]; maximo?: number; tamano?: number }) {
  if (ids.length === 0) return null
  const visibles = ids.slice(0, maximo)
  return (
    <span className="inline-flex items-center" title={ids.map((i) => NombreDePersona(personas, i)).join(', ')}>
      {visibles.map((id, i) => (
        <span key={id} className="tc-avatar-pila rounded-full" style={{ marginLeft: i === 0 ? 0 : -6, zIndex: visibles.length - i }}>
          <Avatar id={id} nombre={NombreDePersona(personas, id)} tamano={tamano} />
        </span>
      ))}
      {ids.length > maximo && (
        <span className="tc-avatar-pila ml-[-6px] inline-flex items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[10px] font-semibold text-[var(--ls-t3)]" style={{ width: tamano, height: tamano }}>
          +{ids.length - maximo}
        </span>
      )}
    </span>
  )
}

/** El hueco que se pulsa para abrir un selector: parece un campo hasta que pasas por encima */
export const CAMPO_DE_PROPIEDAD =
  'tc-campo inline-flex min-h-[26px] min-w-0 max-w-full items-center gap-1.5 rounded-[6px] px-2 py-[3px] text-left text-[12.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup3)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)] disabled:cursor-default disabled:hover:bg-transparent'

const CAJA_DE_MENU = '!w-[240px] !rounded-[10px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-1.5 !text-[var(--ls-t1)] shadow-[0_14px_40px_rgba(0,0,0,0.35)]'

/** Elegir UNA opción de una lista con color (el estado, el departamento) */
export function SelectorDeOpcion({
  valor,
  opciones,
  onElegir,
  vacio = 'Vacío',
  permitirVacio = false,
  deshabilitado = false,
  etiqueta,
}: {
  valor: string | null
  opciones: ReadonlyArray<{ nombre: string; color: string }>
  onElegir: (nombre: string | null) => void
  vacio?: string
  permitirVacio?: boolean
  deshabilitado?: boolean
  etiqueta: string
}) {
  const [abierto, setAbierto] = useState(false)
  const actual = opciones.find((o) => o.nombre === valor)
  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <button type="button" disabled={deshabilitado} aria-label={etiqueta} className={CAMPO_DE_PROPIEDAD}>
          {valor ? <Etiqueta color={actual?.color}>{valor}</Etiqueta> : <span className="text-[var(--ls-t4)]">{vacio}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={CAJA_DE_MENU}>
        <div role="listbox" aria-label={etiqueta} className="flex max-h-[280px] flex-col gap-px overflow-auto">
          {permitirVacio && valor && (
            <button type="button" className="tc-opcion" onClick={() => { onElegir(null); setAbierto(false) }}>
              <X className="h-3 w-3 text-[var(--ls-t4)]" /> Quitar
            </button>
          )}
          {opciones.map((o) => (
            <button key={o.nombre} type="button" role="option" aria-selected={o.nombre === valor} className="tc-opcion" onClick={() => { onElegir(o.nombre); setAbierto(false) }}>
              <Etiqueta color={o.color}>{o.nombre}</Etiqueta>
              {o.nombre === valor && <Check className="ml-auto h-3.5 w-3.5 text-[var(--ls-t3)]" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Elegir VARIAS personas del equipo, con buscador */
export function SelectorDePersonas({ valor, personas, onCambio, deshabilitado = false }: { valor: readonly string[]; personas: readonly PersonaTC[]; onCambio: (ids: string[]) => void; deshabilitado?: boolean }) {
  const [busqueda, setBusqueda] = useState('')
  const lista = useMemo(() => personas.filter((p) => p.nombre.toLowerCase().includes(busqueda.trim().toLowerCase())), [personas, busqueda])
  const alternar = (id: string) => onCambio(valor.includes(id) ? valor.filter((x) => x !== id) : [...valor, id])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" disabled={deshabilitado} aria-label="Responsables" className={CAMPO_DE_PROPIEDAD}>
          {valor.length === 0 ? (
            <span className="text-[var(--ls-t4)]">Sin asignar</span>
          ) : (
            <span className="flex min-w-0 items-center gap-1.5">
              <PilaDeAvatares ids={valor} personas={personas} maximo={3} />
              <span className="truncate">{valor.length === 1 ? NombreDePersona(personas, valor[0]) : `${valor.length} personas`}</span>
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={CAJA_DE_MENU}>
        <label className="mb-1 flex items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2">
          <Search className="h-3 w-3 text-[var(--ls-t4)]" />
          <input autoFocus value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar persona…" className="h-7 w-full bg-transparent text-[12.5px] outline-none placeholder:text-[var(--ls-t4)]" />
        </label>
        <div className="flex max-h-[260px] flex-col gap-px overflow-auto">
          {lista.length === 0 && <p className="px-2 py-3 text-center text-[11.5px] text-[var(--ls-t4)]">Nadie con ese nombre</p>}
          {lista.map((p) => (
            <button key={p.id} type="button" role="checkbox" aria-checked={valor.includes(p.id)} className="tc-opcion" onClick={() => alternar(p.id)}>
              <Avatar id={p.id} nombre={p.nombre} tamano={20} />
              <span className="truncate">{p.nombre}</span>
              {valor.includes(p.id) && <Check className="ml-auto h-3.5 w-3.5 text-[var(--ls-t3)]" />}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Elegir el color de una tarjeta (o de lo que sea) de entre los diez de la paleta */
export function SelectorDeColor({ valor, onElegir, etiqueta = 'Color', permitirVacio = true, children }: { valor: string | null; onElegir: (c: ColorNotion | null) => void; etiqueta?: string; permitirVacio?: boolean; children?: ReactNode }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        {children ?? (
          <button type="button" aria-label={etiqueta} className={CAMPO_DE_PROPIEDAD}>
            {valor ? <Etiqueta color={valor}>{NOMBRE_DE_COLOR[valor as ColorNotion] ?? valor}</Etiqueta> : <span className="text-[var(--ls-t4)]">Automático</span>}
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className={CAJA_DE_MENU}>
        <p className="px-2 pb-1 pt-0.5 text-[11px] font-semibold text-[var(--ls-t4)]">{etiqueta}</p>
        <div className="grid grid-cols-5 gap-1.5 p-1">
          {COLORES_NOTION.map((c) => (
            <button key={c} type="button" title={NOMBRE_DE_COLOR[c]} aria-label={NOMBRE_DE_COLOR[c]} aria-pressed={valor === c} onClick={() => onElegir(c)} className="tc-muestra" style={estiloDeColor(c)} />
          ))}
        </div>
        {permitirVacio && (
          <button type="button" className="tc-opcion mt-1" onClick={() => onElegir(null)}>
            <X className="h-3 w-3 text-[var(--ls-t4)]" /> Automático
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

const EMOJIS = ['📌', '🚀', '✅', '🎯', '💡', '🔥', '⭐', '📈', '📦', '🛒', '🧾', '📣', '🛠️', '🧩', '📅', '📝', '🔍', '💬', '📞', '✉️', '🏷️', '💰', '🧠', '⚡', '🎨', '📊', '🌍', '🚚', '🔧', '⚠️', '🏁', '🤝', '🎁', '🧪', '📷', '🔔', '🔒', '🧹', '🌱', '🏆']

/** Elegir el emoji de una tarea o de un cliente; también se puede pegar cualquiera */
export function SelectorDeEmoji({ valor, onElegir, children }: { valor: string | null; onElegir: (e: string | null) => void; children: ReactNode }) {
  const [texto, setTexto] = useState('')
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align="start" className={`${CAJA_DE_MENU} !w-[268px]`}>
        <div className="grid grid-cols-8 gap-0.5">
          {EMOJIS.map((e) => (
            <button key={e} type="button" aria-label={e} aria-pressed={valor === e} onClick={() => onElegir(e)} className="tc-emoji">
              {e}
            </button>
          ))}
        </div>
        <div className="mt-1.5 flex items-center gap-1.5 border-t border-[var(--ls-linea)] pt-1.5">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && texto.trim()) {
                onElegir(Array.from(texto.trim())[0] ?? null)
                setTexto('')
              }
            }}
            placeholder="Pega otro emoji y Enter"
            className="h-7 min-w-0 flex-1 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12px] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
          />
          {valor && (
            <button type="button" className="tc-opcion !w-auto !px-2" onClick={() => onElegir(null)}>
              Quitar
            </button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

/** Un trocito de ayuda para el teclado: «Enter» */
export const Tecla = ({ children }: { children: ReactNode }) => <kbd className="rounded-[4px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-1 py-px text-[10.5px] text-[var(--ls-t3)]">{children}</kbd>

/** Una fecha de solo día, escrita como la lee quien trabaja aquí («5 nov») */
export function fechaCorta(iso: string | null | undefined, conHora = false): string {
  if (!iso) return ''
  const dia = iso.slice(0, 10)
  const [a, m, d] = dia.split('-').map(Number)
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const base = `${d} ${meses[m - 1]}${a !== new Date().getFullYear() ? ` ${a}` : ''}`
  if (!conHora || iso.length <= 10) return base
  return `${base}, ${new Date(iso).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}`
}

export const hoyISO = () => new Date().toISOString().slice(0, 10)
