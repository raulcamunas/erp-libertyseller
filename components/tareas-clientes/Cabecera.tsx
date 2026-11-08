'use client'

import { useState, type ReactNode } from 'react'
import { CalendarClock, CalendarDays, ChevronDown, Filter, GanttChartSquare, KanbanSquare, Palette, Plus, Search, Settings2, Share2, Table2, X } from 'lucide-react'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { hayFiltros } from '@/lib/tareas-clientes/filtros'
import { describirRecurrencia, recurrenciaValida } from '@/lib/tareas-clientes/recurrencia'
import { departamentosDe, FILTROS_VACIOS, type ClienteTC, type FiltrosDeTareas, type PersonaTC, type PlantillaTC, type Portada as PortadaGuardada, type TipoDeVista } from '@/lib/tareas-clientes/tipos'
import { Avatar } from '@/components/rendimiento/ui'
import { MenuDeVistas } from './MenuDeVistas'
import { SelectorDePortada } from './Portada'
import { SelectorDeEmoji } from './ui'

/**
 * LA CABECERA DE UN ESPACIO: el emoji y el nombre del cliente, una descripción, las cuatro vistas y las herramientas (buscar, filtrar, agrupar y
 * crear). El fondo de toda la pantalla se cambia con el botón «Fondo» (color, degradado, imagen o uno animado).
 */

const ICONO_DE_VISTA: Record<TipoDeVista, typeof KanbanSquare> = { tablero: KanbanSquare, tabla: Table2, cronograma: GanttChartSquare, calendario: CalendarDays }
const NOMBRE_DE_VISTA: Record<TipoDeVista, string> = { tablero: 'Tablero', tabla: 'Tabla', cronograma: 'Cronograma', calendario: 'Calendario' }

export interface PropsDeCabecera {
  titulo: string
  icono: string | null
  descripcion: string | null
  fondo: PortadaGuardada
  editable: boolean
  vistas: readonly TipoDeVista[]
  vista: TipoDeVista
  onVista: (v: TipoDeVista) => void
  filtros: FiltrosDeTareas
  onFiltros: (f: FiltrosDeTareas) => void
  /** Un administrador puede compartir una vista guardada con todo el equipo */
  esAdmin?: boolean
  /** Si se pasa, aparece «Compartir» (el panel del cliente): solo se pasa para un administrador dentro de un cliente */
  onCompartir?: () => void
  personas: readonly PersonaTC[]
  clientesParaDepartamentos: readonly ClienteTC[]
  puedeAgrupar: boolean
  onTitulo?: (t: string) => void
  onIcono?: (e: string | null) => void
  onDescripcion?: (d: string) => void
  onFondo: (p: PortadaGuardada) => void
  onNueva: () => void
  /** Las plantillas del cliente (con ellas «Nueva tarea» lleva una flecha) y qué hacer al elegir una o al querer gestionarlas; sin `onGestionarPlantillas` no hay flecha */
  plantillas?: readonly PlantillaTC[]
  onPlantilla?: (id: string) => void
  onGestionarPlantillas?: () => void
  total: number
  visibles: number
  extra?: ReactNode
}

export function Cabecera(p: PropsDeCabecera) {
  const [titulo, setTitulo] = useState<string | null>(null)
  const [descripcion, setDescripcion] = useState<string | null>(null)
  const [menuDePlantillas, setMenuDePlantillas] = useState(false)
  const departamentos = [...new Map(p.clientesParaDepartamentos.flatMap((c) => departamentosDe(c)).map((d) => [d.nombre, d])).values()]
  const activos = hayFiltros(p.filtros)

  return (
    <header className="tc-cabecera">
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

        <MenuDeVistas filtros={p.filtros} vista={p.vista} esAdmin={p.esAdmin === true} onAplicar={(f, v) => { p.onFiltros(f); if (v && p.vistas.includes(v)) p.onVista(v) }} />

        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="tc-boton-herramienta" data-activo={activos ? 'true' : undefined}><Filter className="h-3.5 w-3.5" /> Filtros{activos ? ' ·' : ''}</button>
          </PopoverTrigger>
          <PopoverContent align="end" className="!w-[300px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-3 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
            <div className="flex flex-col gap-3 text-[12.5px]">
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="tc-casilla" checked={p.filtros.soloMias} onChange={(e) => p.onFiltros({ ...p.filtros, soloMias: e.target.checked })} /> Solo mis tareas</label>
              <label className="flex cursor-pointer items-center gap-2"><input type="checkbox" className="tc-casilla" checked={p.filtros.sinResponsable} onChange={(e) => p.onFiltros({ ...p.filtros, sinResponsable: e.target.checked })} /> Sin responsable</label>
              <label className="flex items-center justify-between gap-2">Fecha
                <select value={p.filtros.fecha} onChange={(e) => p.onFiltros({ ...p.filtros, fecha: e.target.value as FiltrosDeTareas['fecha'] })} className="h-7 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 text-[12px]">
                  <option value="todas">Cualquiera</option><option value="vencidas">Vencidas</option><option value="hoy">Hoy</option><option value="semana">Esta semana</option><option value="sin_fecha">Sin fecha</option>
                </select>
              </label>
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
              {activos && <button type="button" onClick={() => p.onFiltros({ ...FILTROS_VACIOS, agruparPor: p.filtros.agruparPor })} className="self-start text-[12px] text-[var(--ls-e-rojo)] hover:underline">Quitar los filtros</button>}
            </div>
          </PopoverContent>
        </Popover>

        <SelectorDePortada valor={p.fondo} titulo="Fondo del espacio" onElegir={p.onFondo} animados>
          <button type="button" className="tc-boton-herramienta"><Palette className="h-3.5 w-3.5" /> Fondo</button>
        </SelectorDePortada>

        {p.onCompartir && <button type="button" onClick={p.onCompartir} className="tc-boton-herramienta" title="Compartir el panel con el cliente"><Share2 className="h-3.5 w-3.5" /> Compartir</button>}

        {activos && <span className="text-[11.5px] tabular-nums text-[var(--ls-t3)]">{p.visibles} de {p.total}</span>}
        <div className="tc-split">
          <button type="button" onClick={p.onNueva} className="tc-boton-primario tc-split-main"><Plus className="h-3.5 w-3.5" /> Nueva tarea</button>
          {p.onGestionarPlantillas && (
            <Popover open={menuDePlantillas} onOpenChange={setMenuDePlantillas}>
              <PopoverTrigger asChild>
                <button type="button" className="tc-boton-primario tc-split-flecha" aria-label="Nueva tarea desde una plantilla"><ChevronDown className="h-3.5 w-3.5" /></button>
              </PopoverTrigger>
              <PopoverContent align="end" className="!w-[300px] !rounded-[12px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-1.5 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.4)]">
                <p className="tc-lat-rotulo !pt-2">Desde plantilla</p>
                <div className="flex max-h-[260px] flex-col gap-px overflow-auto">
                  {(p.plantillas ?? []).length === 0 && <p className="px-2 py-2 text-[12px] text-[var(--ls-t4)]">Todavía no hay plantillas de este cliente.</p>}
                  {(p.plantillas ?? []).map((pl) => {
                    const r = recurrenciaValida(pl.recurrencia)
                    return (
                      <button key={pl.id} type="button" className="tc-opcion" onClick={() => { setMenuDePlantillas(false); p.onPlantilla?.(pl.id) }}>
                        <span className="text-[15px] leading-none">{pl.icono ?? '📋'}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate">{pl.nombre}</span>
                          {r.tipo !== 'ninguna' && <span className="flex items-center gap-1 text-[11px] text-[var(--ls-t4)]"><CalendarClock className="h-3 w-3" />{describirRecurrencia(r)}</span>}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <div className="mt-1 border-t border-[var(--ls-linea)] pt-1">
                  <button type="button" className="tc-opcion" onClick={() => { setMenuDePlantillas(false); p.onGestionarPlantillas?.() }}><Settings2 className="h-3.5 w-3.5" /> Gestionar plantillas y repeticiones…</button>
                </div>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </header>
  )
}
