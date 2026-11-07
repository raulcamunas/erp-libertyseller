'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import { CalendarDays, CheckSquare, ChevronRight, MessageSquare, Plus } from 'lucide-react'
import { agruparTareas } from '@/lib/tareas-clientes/filtros'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { departamentosDe, type FiltrosDeTareas, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import { Etiqueta, fechaCorta, hoyISO, PilaDeAvatares, SelectorDeOpcion, SelectorDePersonas } from './ui'
import { estaHechaLaTarea, estadosDeLaTarea, type MapaDeClientes } from './vistas'

/**
 * LA TABLA: una fila por tarea, agrupadas por lo que se elija (estado, departamento, responsable o cliente). El estado, el departamento y los responsables se cambian desde
 * la propia fila, sin abrir la tarea; pulsar el resto de la fila la abre. Las cabeceras de grupo se pliegan.
 */

export interface PropsDeTabla {
  tareas: readonly TareaLigera[]
  clientes: MapaDeClientes
  personas: readonly PersonaTC[]
  agruparPor: FiltrosDeTareas['agruparPor']
  mostrarCliente: boolean
  tareaAbierta: string | null
  onAbrir: (id: string) => void
  onCambiar: (id: string, cambios: Record<string, unknown>) => void
  /** Solo si la tabla es de UN cliente: se puede crear una fila dentro de cada grupo */
  onCrear?: (grupoClave: string, titulo: string) => Promise<void> | void
}

const COLUMNAS = 'minmax(260px,1.7fr) var(--tc-col-cliente, 0px) 150px 150px 170px 130px 76px 54px'

export function Tabla({ tareas, clientes, personas, agruparPor, mostrarCliente, tareaAbierta, onAbrir, onCambiar, onCrear }: PropsDeTabla) {
  const [plegados, setPlegados] = useState<Set<string>>(new Set())
  const [escribiendo, setEscribiendo] = useState<string | null>(null)
  const [titulo, setTitulo] = useState('')

  const estadosUnidos = useMemo(() => {
    const vistos = new Map<string, number>()
    for (const c of clientes.values()) (c.opciones.estados ?? []).forEach((e, i) => vistos.set(e.nombre, Math.min(vistos.get(e.nombre) ?? 99, i)))
    return [...vistos.entries()].sort((a, b) => a[1] - b[1]).map(([n]) => n)
  }, [clientes])

  const grupos = useMemo(
    () => agruparTareas(tareas, agruparPor, { estados: estadosUnidos, nombreDePersona: (id) => personas.find((p) => p.id === id)?.nombre ?? 'Alguien', nombreDeCliente: (id) => clientes.get(id)?.nombre ?? 'Cliente' }),
    [tareas, agruparPor, estadosUnidos, personas, clientes]
  )
  const hoy = hoyISO()

  const colorDelGrupo = (clave: string): string => {
    if (agruparPor === 'estado') for (const c of clientes.values()) { const e = (c.opciones.estados ?? []).find((x) => x.nombre === clave); if (e) return e.color }
    if (agruparPor === 'departamento') for (const c of clientes.values()) { const d = departamentosDe(c).find((x) => x.nombre === clave); if (d) return d.color }
    if (agruparPor === 'cliente') return clientes.get(clave)?.color ?? 'default'
    return 'gray'
  }

  async function crear(clave: string) {
    const t = titulo.trim()
    if (!t || !onCrear) return
    await onCrear(clave, t)
    setTitulo('')
    setEscribiendo(null)
  }

  return (
    <div className="tc-tabla" role="table" aria-label="Tabla de tareas" style={{ '--tc-col-cliente': mostrarCliente ? '150px' : '0px' } as CSSProperties}>
      <div className="tc-tabla-cabecera" role="row" style={{ gridTemplateColumns: COLUMNAS }}>
        <span role="columnheader">Tarea</span>
        <span role="columnheader" className={mostrarCliente ? '' : 'invisible'}>Cliente</span>
        <span role="columnheader">Estado</span>
        <span role="columnheader">Departamento</span>
        <span role="columnheader">Responsables</span>
        <span role="columnheader">Fecha</span>
        <span role="columnheader">Lista</span>
        <span role="columnheader" className="text-right"><MessageSquare className="ml-auto h-3 w-3" aria-label="Comentarios" /></span>
      </div>

      {grupos.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-[var(--ls-t4)]">No hay tareas con estos filtros.</p>}

      {grupos.map((g, gi) => {
        const cerrado = plegados.has(g.clave)
        const color = colorDelGrupo(g.clave)
        return (
          <section key={g.clave || '__vacio'} className="tc-grupo" style={{ '--tono': `var(--tc-${color})`, '--i': gi } as CSSProperties}>
            <div className="tc-grupo-cabecera">
              <button type="button" aria-expanded={!cerrado} onClick={() => setPlegados((s) => { const n = new Set(s); if (!n.delete(g.clave)) n.add(g.clave); return n })} className="flex items-center gap-1.5">
                <ChevronRight className={`h-3.5 w-3.5 text-[var(--ls-t4)] transition-transform ${cerrado ? '' : 'rotate-90'}`} />
                {agruparPor === 'responsable' && g.clave ? <PilaDeAvatares ids={[g.clave]} personas={personas} maximo={1} tamano={18} /> : null}
                <Etiqueta color={color}>{g.nombre}</Etiqueta>
                <span className="text-[12px] tabular-nums text-[var(--ls-t3)]">{g.tareas.length}</span>
              </button>
              {onCrear && !cerrado && agruparPor !== 'responsable' && (
                <button type="button" aria-label={`Añadir una tarea a ${g.nombre}`} onClick={() => { setEscribiendo(g.clave); setTitulo('') }} className="tc-icono-boton ml-auto"><Plus className="h-3.5 w-3.5" /></button>
              )}
            </div>

            {!cerrado && g.tareas.map((t, i) => {
              const estados = estadosDeLaTarea(t, clientes)
              const cliente = clientes.get(t.cliente_id)
              const hecha = estaHechaLaTarea(t, clientes)
              const dia = (t.fecha_fin ?? t.fecha_inicio)?.slice(0, 10)
              const vencida = Boolean(dia && !hecha && dia < hoy)
              return (
                <div key={`${g.clave}-${t.id}`} role="row" tabIndex={0} aria-label={`Abrir ${t.titulo || 'tarea sin título'}`} data-activa={tareaAbierta === t.id ? 'true' : undefined} onClick={() => onAbrir(t.id)} onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onAbrir(t.id) }} className="tc-fila" style={{ gridTemplateColumns: COLUMNAS, '--i': Math.min(i, 16) } as CSSProperties}>
                  <span role="cell" className="flex min-w-0 items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-[14px]">{t.icono ?? <span className="text-[var(--ls-t4)]">·</span>}</span>
                    <span className={`truncate text-[13px] text-[var(--ls-t1)] ${hecha ? 'tc-hecha' : ''}`}>{t.titulo || <span className="text-[var(--ls-t4)]">Sin título</span>}</span>
                  </span>
                  <span role="cell" aria-hidden={!mostrarCliente} className={`min-w-0 items-center gap-1 overflow-hidden text-[12px] text-[var(--ls-t3)] ${mostrarCliente ? 'flex' : 'invisible'}`}><span>{cliente?.icono ?? '•'}</span><span className="truncate">{cliente?.nombre ?? ''}</span></span>
                  <span role="cell" onClick={(e) => e.stopPropagation()}><SelectorDeOpcion etiqueta="Estado" valor={t.estado} opciones={estados} onElegir={(n) => n && n !== t.estado && onCambiar(t.id, { estado: n })} /></span>
                  <span role="cell" onClick={(e) => e.stopPropagation()}><SelectorDeOpcion etiqueta="Departamento" valor={t.departamento} opciones={cliente ? departamentosDe(cliente) : []} permitirVacio onElegir={(n) => onCambiar(t.id, { departamento: n })} vacio="—" /></span>
                  <span role="cell" onClick={(e) => e.stopPropagation()}><SelectorDePersonas valor={t.responsables} personas={personas} onCambio={(ids) => onCambiar(t.id, { responsables: ids })} /></span>
                  <span role="cell" className={`flex items-center gap-1 text-[12px] tabular-nums ${vencida ? 'font-medium text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t3)]'}`}>{t.fecha_inicio ? <><CalendarDays className="h-3 w-3" />{fechaCorta(t.fecha_inicio, t.fecha_con_hora)}</> : ''}</span>
                  <span role="cell" className="flex items-center gap-1.5 text-[11.5px] tabular-nums text-[var(--ls-t3)]">{t.checklist_total > 0 ? <><CheckSquare className="h-3 w-3" style={{ color: t.checklist_hecho === t.checklist_total ? 'var(--ls-e-verde)' : undefined }} />{t.checklist_hecho}/{t.checklist_total}</> : ''}</span>
                  <span role="cell" className="text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]">{t.comentarios > 0 ? t.comentarios : ''}</span>
                </div>
              )
            })}

            {escribiendo === g.clave && !cerrado && (
              <div className="tc-fila-nueva">
                <input autoFocus value={titulo} onChange={(e) => setTitulo(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void crear(g.clave); if (e.key === 'Escape') setEscribiendo(null) }} onBlur={() => { if (!titulo.trim()) setEscribiendo(null) }} placeholder="Título de la tarea… (Enter para crear)" aria-label="Título de la tarea nueva" className="w-full bg-transparent text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]" />
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
