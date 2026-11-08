'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Check, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ReunionConPropuestas } from '@/lib/tareas-clientes/reuniones-servidor'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { departamentosDe, estadosDe, type ClienteTC, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'
import { fechaCorta, SelectorDePersonas } from './ui'

/**
 * LAS TAREAS QUE PROPONE LA IA TRAS UNA REUNIÓN, en una ventana sobre la página del cliente. Cada propuesta se marca (buena) o se deja sin marcar (mala), y se puede cambiar su
 * título, su columna, su departamento, quién la lleva, su fecha y sus pasos antes de crearla. «Crear» hace las dos cosas a la vez: crea las marcadas (con lo que se haya
 * cambiado) y descarta las demás. Hasta entonces no se crea nada. Ver lib/tareas-clientes/reuniones.ts.
 */

interface Borrador {
  id: string
  marcada: boolean
  titulo: string
  columna: string
  departamento: string | null
  responsables: string[]
  fecha_inicio: string
  subtareas: string[]
  contexto: string
  abierta: boolean
}

export function PropuestasDeReunion({ cliente, personas, onCerrar, onCreadas, onCambioDePendientes }: { cliente: ClienteTC; personas: readonly PersonaTC[]; onCerrar: () => void; onCreadas: (t: TareaLigera[]) => void; onCambioDePendientes: (n: number) => void }) {
  const [reuniones, setReuniones] = useState<ReunionConPropuestas[] | null>(null)
  const [disponible, setDisponible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [enviando, setEnviando] = useState(false)
  const [buscando, setBuscando] = useState(false)

  const columnas = useMemo(() => estadosDe(cliente), [cliente])
  const departamentos = useMemo(() => departamentosDe(cliente), [cliente])
  const gente = useMemo(() => personas.filter((p) => !p.clientes || p.clientes.includes(cliente.id)), [personas, cliente.id])

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<{ disponible: boolean; reuniones: ReunionConPropuestas[] }>(`${BASE}/clientes/${cliente.id}/propuestas`)
      setDisponible(r.disponible)
      setReuniones(r.reuniones)
      setBorradores((previos) => {
        const nuevos: Record<string, Borrador> = {}
        for (const re of r.reuniones)
          for (const p of re.propuestas)
            nuevos[p.id] = previos[p.id] ?? { id: p.id, marcada: true, titulo: p.titulo, columna: columnas.some((c) => c.nombre === p.columna) ? p.columna : (columnas.find((c) => c.grupo === 'en_curso')?.nombre ?? columnas[0]?.nombre ?? p.columna), departamento: p.departamento, responsables: [], fecha_inicio: '', subtareas: p.subtareas, contexto: p.contexto, abierta: false }
        return nuevos
      })
      onCambioDePendientes(r.reuniones.reduce((n, re) => n + re.propuestas.length, 0))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se han podido leer las propuestas')
    }
  }, [cliente.id, columnas, onCambioDePendientes])

  useEffect(() => {
    void cargar()
  }, [cargar])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const lista = Object.values(borradores)
  const marcadas = lista.filter((b) => b.marcada)
  const cambiar = (id: string, c: Partial<Borrador>) => setBorradores((b) => ({ ...b, [id]: { ...b[id], ...c } }))
  const marcarTodas = (v: boolean) => setBorradores((b) => Object.fromEntries(Object.entries(b).map(([k, x]) => [k, { ...x, marcada: v }])))

  const decidir = async (aceptar: Borrador[], descartar: string[]) => {
    setEnviando(true)
    try {
      const r = await pedir<{ creadas: TareaLigera[]; descartadas: number; fallos: string[] }>(`${BASE}/propuestas`, {
        metodo: 'POST',
        cuerpo: {
          clienteId: cliente.id,
          aceptar: aceptar.map((b) => ({ id: b.id, titulo: b.titulo, columna: b.columna, departamento: b.departamento, responsables: b.responsables, fecha_inicio: b.fecha_inicio || undefined, subtareas: b.subtareas, contexto: b.contexto })),
          descartar,
        },
      })
      if (r.creadas.length > 0) onCreadas(r.creadas)
      if (r.fallos.length > 0) toast.error(`No se han podido crear: ${r.fallos.join(' · ')}`)
      else toast.success(`${r.creadas.length} ${r.creadas.length === 1 ? 'tarea creada' : 'tareas creadas'}${r.descartadas > 0 ? ` · ${r.descartadas} descartadas` : ''}`)
      await cargar()
      if (r.fallos.length === 0) onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar la decisión')
    } finally {
      setEnviando(false)
    }
  }

  const buscar = async () => {
    setBuscando(true)
    try {
      const r = await pedir<{ resultado: { resumen: string; propuestas: number } }>(`${BASE}/propuestas`, { metodo: 'POST', cuerpo: { buscar: true } })
      toast.message(r.resultado.propuestas > 0 ? `${r.resultado.propuestas} propuestas nuevas` : `Nada nuevo (${r.resultado.resumen})`)
      await cargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido buscar')
    } finally {
      setBuscando(false)
    }
  }

  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal" role="dialog" aria-modal="true" aria-label="Tareas propuestas de la reunión">
        <header className="tc-modal-cabecera">
          <Sparkles className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Tareas que salen de la reunión · {cliente.nombre}</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {error && <p role="alert" className="text-[13px] text-[var(--ls-e-rojo)]">{error}</p>}
          {!reuniones && !error && <div className="space-y-2" role="status" aria-label="Cargando"><div className="tc-esqueleto h-16 w-full" /><div className="tc-esqueleto h-16 w-full" /></div>}
          {reuniones && !disponible && <p className="text-[13px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 279 en Supabase.</p>}
          {reuniones && disponible && reuniones.length === 0 && (
            <div className="py-10 text-center text-[13px] text-[var(--ls-t3)]">
              <p>No hay tareas propuestas esperando.</p>
              <p className="mt-1 text-[12px] text-[var(--ls-t4)]">Cuando termine una reunión de seguimiento con este cliente y Gemini suba las notas, las tareas aparecerán aquí.</p>
              <button type="button" onClick={() => void buscar()} disabled={buscando} className="tc-boton-suave mx-auto mt-4">{buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Buscar reuniones nuevas ahora</button>
            </div>
          )}

          {(reuniones ?? []).map((re) => (
            <section key={re.id} className="mb-6">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-[13px] font-semibold text-[var(--ls-t1)]">{re.titulo}</h3>
                {re.fecha_reunion && <span className="inline-flex items-center gap-1 text-[11.5px] text-[var(--ls-t4)]"><CalendarDays className="h-3 w-3" />{fechaCorta(re.fecha_reunion)}</span>}
                <button type="button" onClick={() => void decidir([], re.propuestas.map((p) => p.id))} disabled={enviando} className="tc-boton-suave tc-discreto ml-auto"><Trash2 className="h-3 w-3" /> Descartar toda la reunión</button>
              </div>
              <ul className="flex flex-col gap-2">
                {re.propuestas.map((p) => {
                  const b = borradores[p.id]
                  if (!b) return null
                  return (
                    <li key={p.id} className="tc-propuesta" data-marcada={b.marcada ? 'true' : undefined}>
                      <div className="flex items-start gap-3">
                        <button type="button" role="checkbox" aria-checked={b.marcada} aria-label={b.marcada ? 'Quitar de las que se crean' : 'Incluir entre las que se crean'} onClick={() => cambiar(p.id, { marcada: !b.marcada })} className="tc-propuesta-marca" data-on={b.marcada ? 'true' : undefined}>{b.marcada && <Check className="h-3.5 w-3.5" />}</button>
                        <div className="min-w-0 flex-1">
                          <input value={b.titulo} onChange={(e) => cambiar(p.id, { titulo: e.target.value })} maxLength={200} aria-label="Título de la tarea" className="tc-propuesta-titulo" />
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <div className="tc-vistas" role="group" aria-label="Columna">
                              {columnas.filter((c) => c.grupo !== 'hecho' || c.nombre === b.columna).slice(0, 8).map((c) => (
                                <button key={c.nombre} type="button" aria-pressed={b.columna === c.nombre} onClick={() => cambiar(p.id, { columna: c.nombre })} className="tc-vista-boton !h-7" data-on={b.columna === c.nombre ? 'true' : undefined} style={b.columna === c.nombre ? { background: 'var(--ls-sup3)', color: 'var(--ls-t1)', boxShadow: 'inset 0 0 0 1px var(--ls-linea2)' } : undefined}>{c.nombre}</button>
                              ))}
                            </div>
                            <select aria-label="Departamento" value={b.departamento ?? ''} onChange={(e) => cambiar(p.id, { departamento: e.target.value || null })} className="h-7 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 text-[12px]">
                              <option value="">Sin departamento</option>
                              {departamentos.map((d) => <option key={d.nombre} value={d.nombre}>{d.nombre}</option>)}
                            </select>
                            <input type="date" aria-label="Fecha" value={b.fecha_inicio} onChange={(e) => cambiar(p.id, { fecha_inicio: e.target.value })} className="tc-fecha" />
                            <SelectorDePersonas valor={b.responsables} personas={gente} onCambio={(ids) => cambiar(p.id, { responsables: ids })} />
                          </div>
                          {b.contexto && !b.abierta && <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-[var(--ls-t3)]">{b.contexto}</p>}
                          <button type="button" onClick={() => cambiar(p.id, { abierta: !b.abierta })} className="mt-1 text-[11.5px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">{b.abierta ? 'Ocultar el detalle' : `Ver y editar el detalle${b.subtareas.length > 0 ? ` · ${b.subtareas.length} subtareas` : ''}`}</button>
                          {b.abierta && (
                            <div className="mt-2 flex flex-col gap-2">
                              <label className="text-[11.5px] font-semibold text-[var(--ls-t4)]">Contexto
                                <textarea value={b.contexto} onChange={(e) => cambiar(p.id, { contexto: e.target.value })} rows={3} className="tc-dia-texto mt-1 !text-[12.5px] font-normal" />
                              </label>
                              {b.columna === 'Backlog' ? null : (
                                <div>
                                  <p className="mb-1 text-[11.5px] font-semibold text-[var(--ls-t4)]">Subtareas</p>
                                  <ul className="flex flex-col gap-1">
                                    {b.subtareas.map((s, i) => (
                                      <li key={i} className="flex items-center gap-1.5">
                                        <input value={s} onChange={(e) => cambiar(p.id, { subtareas: b.subtareas.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Subtarea ${i + 1}`} className="tc-subtarea-titulo !bg-[var(--ls-sup2)]" />
                                        <button type="button" onClick={() => cambiar(p.id, { subtareas: b.subtareas.filter((_, j) => j !== i) })} aria-label="Quitar la subtarea" className="tc-icono-boton"><Trash2 className="h-3 w-3" /></button>
                                      </li>
                                    ))}
                                  </ul>
                                  <button type="button" onClick={() => cambiar(p.id, { subtareas: [...b.subtareas, ''] })} className="tc-boton-suave tc-discreto mt-1"><Plus className="h-3 w-3" /> Añadir subtarea</button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        {lista.length > 0 && (
          <footer className="tc-modal-pie">
            <button type="button" onClick={() => marcarTodas(marcadas.length < lista.length)} className="tc-boton-suave">{marcadas.length < lista.length ? 'Marcar todas' : 'Desmarcar todas'}</button>
            <span className="text-[12px] text-[var(--ls-t4)]">{marcadas.length} de {lista.length} marcadas</span>
            <button type="button" onClick={onCerrar} className="tc-boton-suave ml-auto">Decidir luego</button>
            <button type="button" disabled={enviando || lista.length === 0} onClick={() => void decidir(marcadas, lista.filter((b) => !b.marcada).map((b) => b.id))} className="tc-boton-primario disabled:opacity-50">
              {enviando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
              {marcadas.length === 0 ? `Descartar las ${lista.length}` : `Crear ${marcadas.length}${lista.length - marcadas.length > 0 ? ` y descartar ${lista.length - marcadas.length}` : ''}`}
            </button>
          </footer>
        )}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
