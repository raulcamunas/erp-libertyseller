'use client'

import { useState, type ReactNode } from 'react'
import { CalendarDays, Filter, GanttChartSquare, KanbanSquare, Palette, Plus, Search, Table2, X, ImageIcon } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { hayFiltros } from '@/lib/tareas-clientes/filtros'
import { departamentosDe, type ClienteTC, type FiltrosDeTareas, type PersonaTC, type Portada as PortadaGuardada, type TipoDeVista } from '@/lib/tareas-clientes/tipos'
import { Avatar } from '@/components/rendimiento/ui'
import { SelectorDePortada, estiloDePortada } from './Portada'
import { SelectorDeEmoji } from './ui'

/**
 * LA CABECERA DE UN ESPACIO: la portada (que se cambia), el emoji y el nombre del cliente, una descripción, las cuatro vistas y las herramientas (buscar, filtrar, agrupar y
 * crear). En «Todas las tareas» y «Mis tareas» no hay cliente: la portada es la tuya.
 */

const ICONO_DE_VISTA: Record<TipoDeVista, typeof KanbanSquare> = { tablero: KanbanSquare, tabla: Table2, cronograma: GanttChartSquare, calendario: CalendarDays }
const NOMBRE_DE_VISTA: Record<TipoDeVista, string> = { tablero: 'Tablero', tabla: 'Tabla', cronograma: 'Cronograma', calendario: 'Calendario' }

export interface PropsDeCabecera {
  titulo: string
  icono: string | null
  descripcion: string | null
  portada: PortadaGuardada
  fondo: PortadaGuardada
  editable: boolean
  vistas: readonly TipoDeVista[]
  vista: TipoDeVista
  onVista: (v: TipoDeVista) => void
  filtros: FiltrosDeTareas
  onFiltros: (f: FiltrosDeTareas) => void
  personas: readonly PersonaTC[]
  clientesParaDepartamentos: readonly ClienteTC[]
  puedeAgrupar: boolean
  onTitulo?: (t: string) => void
  onIcono?: (e: string | null) => void
  onDescripcion?: (d: string) => void
  onPortada: (p: PortadaGuardada) => void
  onFondo: (p: PortadaGuardada) => void
  onNueva: () => void
  total: number
  visibles: number
  extra?: ReactNode
}

export function Cabecera(p: PropsDeCabecera) {
  const [titulo, setTitulo] = useState<string | null>(null)
  const [descripcion, setDescripcion] = useState<string | null>(null)
  const cubierta = estiloDePortada(p.portada)
  const departamentos = [...new Map(p.clientesParaDepartamentos.flatMap((c) => departamentosDe(c)).map((d) => [d.nombre, d])).values()]
  const activos = hayFiltros(p.filtros)

  return (
    <header className="tc-cabecera">
      <div className="tc-cover" style={cubierta} data-vacia={cubierta ? undefined : 'true'}>
        {!cubierta && p.icono && <span className="tc-cover-marca" aria-hidden>{p.icono}</span>}
        <div className="tc-cover-botones">
          <SelectorDePortada valor={p.portada} titulo="Portada" onElegir={p.onPortada}>
            <button type="button" className="tc-boton-cristal"><ImageIcon className="h-3 w-3" /> {cubierta ? 'Cambiar portada' : 'Añadir portada'}</button>
          </SelectorDePortada>
          <SelectorDePortada valor={p.fondo} titulo="Fondo del espacio" onElegir={p.onFondo}>
            <button type="button" className="tc-boton-cristal"><Palette className="h-3 w-3" /> Fondo</button>
          </SelectorDePortada>
        </div>
      </div>

      <div className="tc-cabecera-titulo">
        <SelectorDeEmoji valor={p.icono} onElegir={(e) => p.onIcono?.(e)}>
          <button type="button" disabled={!p.onIcono} aria-label="Cambiar el emoji" className="tc-emoji-cabecera">{p.icono ?? '📋'}</button>
        </SelectorDeEmoji>
        <div className="min-w-0 flex-1">
          {p.onTitulo ? (
            <input value={titulo ?? p.titulo} aria-label="Nombre del cliente" onChange={(e) => setTitulo(e.target.value)} onBlur={() => { if (titulo !== null && titulo.trim() && titulo.trim() !== p.titulo) p.onTitulo?.(titulo.trim()); setTitulo(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { setTitulo(null); (e.target as HTMLInputElement).blur() } }} className="tc-nombre" style={{ width: `${Math.max(8, (titulo ?? p.titulo).length + 1) * 0.6}em` }} />
          ) : (
            <h1 className="tc-nombre !cursor-default">{p.titulo}</h1>
          )}
          {p.onDescripcion ? (
            <input value={descripcion ?? p.descripcion ?? ''} placeholder="Añade una descripción…" aria-label="Descripción" onChange={(e) => setDescripcion(e.target.value)} onBlur={() => { if (descripcion !== null && descripcion.trim() !== (p.descripcion ?? '')) p.onDescripcion?.(descripcion.trim()); setDescripcion(null) }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }} className="tc-descripcion" />
          ) : null}
        </div>
      </div>

      <div className="tc-herramientas">
        <div className="tc-vistas" role="tablist" aria-label="Vistas">
          {p.vistas.map((v) => {
            const Icono = ICONO_DE_VISTA[v]
            return <button key={v} type="button" role="tab" aria-selected={p.vista === v} onClick={() => p.onVista(v)} className="tc-vista-boton"><Icono className="h-3.5 w-3.5" /> {NOMBRE_DE_VISTA[v]}</button>
          })}
        </div>
        <span className="flex-1" />
        {p.extra}
        <label className="tc-buscar">
          <Search className="h-3.5 w-3.5 text-[var(--ls-t4)]" />
          <input value={p.filtros.busqueda} onChange={(e) => p.onFiltros({ ...p.filtros, busqueda: e.target.value })} placeholder="Buscar…" aria-label="Buscar tareas" className="w-full min-w-0 bg-transparent text-[12.5px] outline-none placeholder:text-[var(--ls-t4)]" />
          {p.filtros.busqueda && <button type="button" aria-label="Borrar la búsqueda" onClick={() => p.onFiltros({ ...p.filtros, busqueda: '' })}><X className="h-3 w-3 text-[var(--ls-t4)]" /></button>}
        </label>

        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="tc-boton-herramienta" data-activo={activos ? 'true' : undefined}><Filter className="h-3.5 w-3.5" /> Filtros{activos ? ' ·' : ''}</button>
          </PopoverTrigger>
          <PopoverContent align="end" className="!w-[300px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-3 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
            <div className="flex flex-col gap-3 text-[12.5px]">
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="tc-casilla" checked={p.filtros.soloMias} onChange={(e) => p.onFiltros({ ...p.filtros, soloMias: e.target.checked })} /> Solo mis tareas</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="tc-casilla" checked={p.filtros.ocultarHechas} onChange={(e) => p.onFiltros({ ...p.filtros, ocultarHechas: e.target.checked })} /> Ocultar las hechas</label>
              <fieldset>
                <legend className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Responsable</legend>
                <div className="flex max-h-[130px] flex-col gap-0.5 overflow-auto">
                  {p.personas.map((x) => (
                    <label key={x.id} className="tc-opcion cursor-pointer"><input type="checkbox" className="tc-casilla" checked={p.filtros.responsables.includes(x.id)} onChange={(e) => p.onFiltros({ ...p.filtros, responsables: e.target.checked ? [...p.filtros.responsables, x.id] : p.filtros.responsables.filter((r) => r !== x.id) })} /><Avatar id={x.id} nombre={x.nombre} tamano={18} />{x.nombre}</label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-1 text-[11px] font-semibold text-[var(--ls-t4)]">Departamento</legend>
                <div className="flex flex-wrap gap-1">
                  {departamentos.map((d) => {
                    const on = p.filtros.departamentos.includes(d.nombre)
                    return <button key={d.nombre} type="button" aria-pressed={on} onClick={() => p.onFiltros({ ...p.filtros, departamentos: on ? p.filtros.departamentos.filter((x) => x !== d.nombre) : [...p.filtros.departamentos, d.nombre] })} className="tc-filtro-etiqueta" style={{ '--tono': `var(--tc-${d.color})` } as React.CSSProperties}>{d.nombre}</button>
                  })}
                </div>
              </fieldset>
              {p.puedeAgrupar && (
                <label className="flex items-center justify-between gap-2">Agrupar la tabla por
                  <select value={p.filtros.agruparPor} onChange={(e) => p.onFiltros({ ...p.filtros, agruparPor: e.target.value as FiltrosDeTareas['agruparPor'] })} className="h-7 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 text-[12px]">
                    <option value="estado">Estado</option><option value="departamento">Departamento</option><option value="responsable">Responsable</option><option value="cliente">Cliente</option>
                  </select>
                </label>
              )}
              {activos && <button type="button" onClick={() => p.onFiltros({ ...p.filtros, busqueda: '', responsables: [], departamentos: [], ocultarHechas: false, soloMias: false })} className="self-start text-[12px] text-[var(--ls-e-rojo)] hover:underline">Quitar los filtros</button>}
            </div>
          </PopoverContent>
        </Popover>

        {activos && <span className="text-[11.5px] tabular-nums text-[var(--ls-t3)]">{p.visibles} de {p.total}</span>}
        <button type="button" onClick={p.onNueva} className="tc-boton-primario"><Plus className="h-3.5 w-3.5" /> Nueva tarea</button>
      </div>
    </header>
  )
}
