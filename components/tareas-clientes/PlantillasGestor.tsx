'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarClock, CopyPlus, Loader2, Plus, Rocket, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { bloqueNuevo, type Bloque } from '@/lib/tareas-clientes/bloques'
import { describirRecurrencia, NOMBRE_DE_DIA, recurrenciaValida, type Recurrencia } from '@/lib/tareas-clientes/recurrencia'
import { departamentosDe, estadosDe, type ClienteTC, type PersonaTC, type PlantillaTC } from '@/lib/tareas-clientes/tipos'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { BASE, pedir } from './api'
import { Editor } from './Editor'
import { SelectorDeEmoji, SelectorDeOpcion, SelectorDePersonas } from './ui'

/**
 * LAS PLANTILLAS DE UN CLIENTE: la lista, el formulario y el cuerpo (con el mismo editor que una tarea). Desde aquí se crean, se cambian, se borran, se prueban («Crear una tarea
 * ahora») y se les dice si se repiten solas. Ver lib/tareas-clientes/plantillas.ts y recurrencia.ts.
 */

interface Borrador {
  id: string | null
  nombre: string
  icono: string | null
  titulo: string
  estado: string | null
  departamento: string | null
  responsables: string[]
  dias: string
  contenido: Bloque[]
  tipo: Recurrencia['tipo']
  diaSemana: number
  diaMes: number
  general: boolean
  activa: boolean
  proxima: string | null
}

const vacio = (): Borrador => ({ id: null, nombre: '', icono: null, titulo: '', estado: null, departamento: null, responsables: [], dias: '', contenido: [bloqueNuevo('parrafo')], tipo: 'ninguna', diaSemana: 1, diaMes: 1, general: false, activa: true, proxima: null })

function desdePlantilla(p: PlantillaTC): Borrador {
  const r = recurrenciaValida(p.recurrencia)
  return {
    id: p.id,
    nombre: p.nombre,
    icono: p.icono,
    titulo: p.titulo,
    estado: p.estado,
    departamento: p.departamento,
    responsables: p.responsables,
    dias: p.dias_para_vencer === null ? '' : String(p.dias_para_vencer),
    contenido: (p.contenido as Bloque[]).length > 0 ? (p.contenido as Bloque[]) : [bloqueNuevo('parrafo')],
    tipo: r.tipo,
    diaSemana: r.tipo === 'semanal' || r.tipo === 'quincenal' ? r.diaSemana : 1,
    diaMes: r.tipo === 'mensual' ? r.diaMes : 1,
    general: p.cliente_id === null,
    activa: p.activa,
    proxima: p.proxima_en,
  }
}

function recurrenciaDe(b: Borrador): Recurrencia {
  if (b.general) return { tipo: 'ninguna' }
  if (b.tipo === 'semanal' || b.tipo === 'quincenal') return { tipo: b.tipo, diaSemana: b.diaSemana }
  if (b.tipo === 'mensual') return { tipo: 'mensual', diaMes: b.diaMes }
  return b.tipo === 'laborable' ? { tipo: 'laborable' } : { tipo: 'ninguna' }
}

export function PlantillasGestor({ cliente, personas, onCerrar, onCambio, onCreada }: { cliente: ClienteTC; personas: readonly PersonaTC[]; onCerrar: () => void; onCambio: (p: PlantillaTC[]) => void; onCreada: (t: TareaLigera) => void }) {
  const [lista, setLista] = useState<PlantillaTC[] | null>(null)
  const [b, setB] = useState<Borrador>(vacio)
  const [guardando, setGuardando] = useState(false)
  const estados = estadosDe(cliente)
  const departamentos = departamentosDe(cliente)

  const cargar = useCallback(async () => {
    try {
      const { plantillas } = await pedir<{ plantillas: PlantillaTC[] }>(`${BASE}/plantillas?clienteId=${cliente.id}`)
      setLista(plantillas)
      onCambio(plantillas)
      return plantillas
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se han podido leer las plantillas')
      setLista([])
      return []
    }
  }, [cliente.id, onCambio])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => e.key === 'Escape' && !(e.target as HTMLElement | null)?.closest?.('[data-radix-popper-content-wrapper], .tc-editable') && onCerrar()
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  const cuerpo = useMemo(() => {
    const dias = b.dias.trim() === '' ? null : Number(b.dias)
    return {
      nombre: b.nombre,
      icono: b.icono,
      titulo: b.titulo,
      estado: b.estado,
      departamento: b.departamento,
      responsables: b.responsables,
      dias_para_vencer: dias,
      contenido: b.contenido,
      recurrencia: recurrenciaDe(b),
      cliente_id: b.general ? null : cliente.id,
      activa: b.activa,
    }
  }, [b, cliente.id])

  async function guardar(): Promise<PlantillaTC | null> {
    if (!b.nombre.trim()) {
      toast.error('Ponle un nombre a la plantilla')
      return null
    }
    setGuardando(true)
    try {
      const { plantilla } = await pedir<{ plantilla: PlantillaTC }>(b.id ? `${BASE}/plantillas/${b.id}` : `${BASE}/plantillas`, { metodo: b.id ? 'PATCH' : 'POST', cuerpo })
      setB(desdePlantilla(plantilla))
      await cargar()
      toast.success('Plantilla guardada')
      return plantilla
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar la plantilla')
      return null
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    if (!b.id || !window.confirm('¿Borrar esta plantilla? Las tareas que ya salieron de ella se quedan.')) return
    try {
      await pedir(`${BASE}/plantillas/${b.id}`, { metodo: 'DELETE' })
      setB(vacio())
      await cargar()
      toast.success('Plantilla borrada')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
    }
  }

  async function crearAhora() {
    const p = b.id ? { id: b.id } : await guardar()
    if (!p) return
    try {
      const { tarea } = await pedir<{ tarea: TareaLigera }>(`${BASE}/plantillas/${p.id}/usar`, { metodo: 'POST', cuerpo: { clienteId: cliente.id } })
      onCreada(tarea)
      toast.success('Tarea creada desde la plantilla')
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear la tarea')
    }
  }

  const set = <K extends keyof Borrador>(k: K, v: Borrador[K]) => setB((x) => ({ ...x, [k]: v }))

  const modal = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal" role="dialog" aria-modal="true" aria-label={`Plantillas de ${cliente.nombre}`}>
        <header className="tc-modal-cabecera">
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Plantillas · {cliente.nombre}</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="tc-modal-cuerpo">
          <aside className="tc-modal-lista" aria-label="Plantillas">
            <button type="button" onClick={() => setB(vacio())} className="tc-boton-herramienta w-full justify-center"><Plus className="h-3.5 w-3.5" /> Nueva plantilla</button>
            {lista === null && <div className="tc-esqueleto mt-2 h-9" />}
            {lista?.length === 0 && <p className="mt-3 text-[12px] text-[var(--ls-t4)]">Todavía no hay ninguna. Crea la primera: una tarea tipo (con su lista de pasos) que luego se usa con un clic o se repite sola.</p>}
            <ul className="mt-2 flex flex-col gap-1">
              {(lista ?? []).map((p) => {
                const r = recurrenciaValida(p.recurrencia)
                return (
                  <li key={p.id}>
                    <button type="button" onClick={() => setB(desdePlantilla(p))} className="tc-plantilla-item" data-activa={b.id === p.id ? 'true' : undefined}>
                      <span className="text-[16px] leading-none">{p.icono ?? '📋'}</span>
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-[12.5px] font-medium text-[var(--ls-t1)]">{p.nombre}</span>
                        <span className="flex items-center gap-1 truncate text-[11px] text-[var(--ls-t4)]">
                          {r.tipo !== 'ninguna' && <CalendarClock className="h-3 w-3 shrink-0" />}
                          {p.cliente_id === null ? 'General' : describirRecurrencia(r)}
                          {r.tipo !== 'ninguna' && !p.activa ? ' · en pausa' : ''}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          <section className="tc-modal-form" aria-label="Plantilla">
            <div className="flex items-center gap-2">
              <SelectorDeEmoji valor={b.icono} onElegir={(e) => set('icono', e)}>
                <button type="button" aria-label="Cambiar el emoji" className="tc-emoji-grande">{b.icono ?? '📋'}</button>
              </SelectorDeEmoji>
              <input value={b.nombre} onChange={(e) => set('nombre', e.target.value)} placeholder="Nombre de la plantilla (p. ej. Informe semanal)" aria-label="Nombre de la plantilla" className="tc-titulo !text-[20px]" />
            </div>

            <div className="tc-props mt-3">
              <div className="tc-prop">
                <span className="tc-prop-nombre">Título</span>
                <div className="min-w-0 flex-1">
                  <input value={b.titulo} onChange={(e) => set('titulo', e.target.value)} placeholder="Informe semanal {semana}" aria-label="Título de las tareas" className="tc-entrada" />
                  <p className="px-2 pb-1 text-[11px] text-[var(--ls-t4)]">Puedes usar <code>{'{fecha}'}</code> (9 nov), <code>{'{mes}'}</code> (noviembre), <code>{'{año}'}</code> y <code>{'{semana}'}</code>. Si lo dejas vacío, el nombre.</p>
                </div>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre">Columna</span>
                <div className="min-w-0 flex-1"><SelectorDeOpcion etiqueta="Columna" valor={b.estado} opciones={estados} permitirVacio vacio="La primera" onElegir={(n) => set('estado', n)} /></div>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre">Departamento</span>
                <div className="min-w-0 flex-1"><SelectorDeOpcion etiqueta="Departamento" valor={b.departamento} opciones={departamentos} permitirVacio onElegir={(n) => set('departamento', n)} /></div>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre">Responsables</span>
                <div className="min-w-0 flex-1"><SelectorDePersonas valor={b.responsables} personas={personas} onCambio={(ids) => set('responsables', ids)} /></div>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre">Vence a los</span>
                <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
                  <input type="number" min={0} max={365} value={b.dias} onChange={(e) => set('dias', e.target.value)} placeholder="—" aria-label="Días hasta el vencimiento" className="tc-entrada !w-16 text-center" />
                  <span className="text-[12px] text-[var(--ls-t3)]">días (vacío = sin fecha de fin)</span>
                </div>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre">Alcance</span>
                <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px] text-[var(--ls-t2)]">
                  <input type="checkbox" className="tc-casilla" checked={b.general} onChange={(e) => set('general', e.target.checked)} />
                  General: se puede usar en cualquier cliente (no se repite sola)
                </label>
              </div>
              <div className="tc-prop">
                <span className="tc-prop-nombre"><CalendarClock className="h-3.5 w-3.5" /> Repetir</span>
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 px-2">
                  <select value={b.general ? 'ninguna' : b.tipo} disabled={b.general} onChange={(e) => set('tipo', e.target.value as Recurrencia['tipo'])} aria-label="Repetir" className="tc-selector">
                    <option value="ninguna">No se repite</option>
                    <option value="laborable">Cada día laborable</option>
                    <option value="semanal">Cada semana</option>
                    <option value="quincenal">Cada dos semanas</option>
                    <option value="mensual">Cada mes</option>
                  </select>
                  {(b.tipo === 'semanal' || b.tipo === 'quincenal') && !b.general && (
                    <select value={b.diaSemana} onChange={(e) => set('diaSemana', Number(e.target.value))} aria-label="Día de la semana" className="tc-selector">
                      {NOMBRE_DE_DIA.slice(1).map((n, i) => <option key={n} value={i + 1}>el {n}</option>)}
                    </select>
                  )}
                  {b.tipo === 'mensual' && !b.general && (
                    <label className="flex items-center gap-1.5 text-[12.5px] text-[var(--ls-t2)]">el día <input type="number" min={1} max={31} value={b.diaMes} onChange={(e) => set('diaMes', Math.max(1, Math.min(31, Number(e.target.value) || 1)))} aria-label="Día del mes" className="tc-entrada !w-14 text-center" /></label>
                  )}
                  {b.tipo !== 'ninguna' && !b.general && (
                    <label className="flex cursor-pointer items-center gap-1.5 text-[12.5px] text-[var(--ls-t2)]"><input type="checkbox" className="tc-casilla" checked={b.activa} onChange={(e) => set('activa', e.target.checked)} /> Activa</label>
                  )}
                  {b.proxima && b.tipo !== 'ninguna' && b.activa && <span className="text-[11.5px] text-[var(--ls-t4)]">Próxima: {new Date(`${b.proxima}T12:00:00`).toLocaleDateString('es-ES', { weekday: 'short', day: 'numeric', month: 'short' })}</span>}
                </div>
              </div>
            </div>

            <h3 className="tc-seccion-titulo mt-4">Cuerpo de la tarea</h3>
            <div className="tc-modal-editor"><Editor bloques={b.contenido} onCambio={(c) => set('contenido', c)} /></div>
            <p className="mt-1 text-[11px] text-[var(--ls-t4)]">Las casillas salen sin marcar en cada tarea nueva. Las tablas de Notion no se copian.</p>
          </section>
        </div>
        <footer className="tc-modal-pie">
          {b.id && <button type="button" onClick={() => void borrar()} className="tc-boton-suave !text-[var(--ls-e-rojo)]"><Trash2 className="h-3 w-3" /> Borrar</button>}
          <span className="flex-1" />
          <button type="button" onClick={() => void crearAhora()} className="tc-boton-herramienta"><Rocket className="h-3.5 w-3.5" /> Crear una tarea ahora</button>
          <button type="button" onClick={() => void guardar()} disabled={guardando} className="tc-boton-primario">{guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CopyPlus className="h-3.5 w-3.5" />} Guardar</button>
        </footer>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(modal, document.body)
}
