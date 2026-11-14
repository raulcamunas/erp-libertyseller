'use client'

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, Check, ChevronDown, Loader2, Plus, Sparkles, Trash2, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import type { ReunionConPropuestas } from '@/lib/tareas-clientes/reuniones-servidor'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { departamentosDe, estadosDe, type ClienteTC, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'
import { fechaCorta, SelectorDePersonas } from './ui'

/**
 * LAS TAREAS QUE PROPONE LA IA TRAS UNA REUNIÓN, en una ventana sobre la página del cliente. Cada propuesta se marca (buena) o se deja sin marcar (mala), y se puede cambiar su
 * título, su columna, su departamento, quién la lleva, su fecha y sus pasos antes de crearla; arriba hay un «Asignar a las marcadas» para ponerle responsable a todas de golpe.
 * «Crear» hace las dos cosas a la vez: crea las marcadas (con lo que se haya cambiado) y descarta las demás. Hasta entonces no se crea nada. Ver lib/tareas-clientes/reuniones.ts.
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

const tono = (color: string | undefined) => ({ '--tono': `var(--tc-${color || 'default'})` }) as CSSProperties

export function PropuestasDeReunion({ cliente, personas, onCerrar, onCreadas, onCambioDePendientes }: { cliente: ClienteTC; personas: readonly PersonaTC[]; onCerrar: () => void; onCreadas: (t: TareaLigera[]) => void; onCambioDePendientes: (n: number) => void }) {
  const [reuniones, setReuniones] = useState<ReunionConPropuestas[] | null>(null)
  const [disponible, setDisponible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [enviando, setEnviando] = useState(false)
  const [buscando, setBuscando] = useState(false)

  const columnas = useMemo(() => estadosDe(cliente), [cliente])
  const abiertas = useMemo(() => columnas.filter((c) => c.grupo !== 'hecho'), [columnas])
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
  // Lo que se elige arriba se aplica a TODAS las marcadas
  const asignarALasMarcadas = (ids: string[]) => setBorradores((b) => Object.fromEntries(Object.entries(b).map(([k, x]) => [k, x.marcada ? { ...x, responsables: ids } : x])))
  const responsablesComunes = marcadas.length > 0 && marcadas.every((m) => JSON.stringify(m.responsables) === JSON.stringify(marcadas[0].responsables)) ? marcadas[0].responsables : []
  const porColumna = useMemo(() => {
    const m = new Map<string, number>()
    for (const b of marcadas) m.set(b.columna, (m.get(b.columna) ?? 0) + 1)
    return [...m.entries()]
  }, [marcadas])

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
      <div className="tc-modal tc-pr-modal" role="dialog" aria-modal="true" aria-label="Tareas propuestas de la reunión">
        <header className="tc-pr-cabecera">
          <span className="tc-pr-icono"><Sparkles className="h-4 w-4" /></span>
          <div className="min-w-0 flex-1">
            <h2>Tareas que salen de la reunión</h2>
            <p>{cliente.icono ? `${cliente.icono} ` : ''}{cliente.nombre}{lista.length > 0 ? ` · ${lista.length} ${lista.length === 1 ? 'propuesta' : 'propuestas'} por decidir` : ''}</p>
          </div>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton"><X className="h-4 w-4" /></button>
        </header>

        {lista.length > 0 && (
          <div className="tc-pr-barra">
            <span className="tc-pr-contador"><b>{marcadas.length}</b> de {lista.length} marcadas</span>
            <button type="button" onClick={() => marcarTodas(marcadas.length < lista.length)} className="tc-boton-suave tc-discreto">{marcadas.length < lista.length ? 'Marcar todas' : 'Desmarcar todas'}</button>
            <span className="ml-auto flex items-center gap-1.5 text-[12px] text-[var(--ls-t3)]"><Users className="h-3.5 w-3.5" /> Asignar a las marcadas
              <SelectorDePersonas valor={responsablesComunes} personas={gente} onCambio={asignarALasMarcadas} deshabilitado={marcadas.length === 0} />
            </span>
          </div>
        )}

        <div className="tc-pr-cuerpo">
          {error && <p role="alert" className="text-[13px] text-[var(--ls-e-rojo)]">{error}</p>}
          {!reuniones && !error && <div className="space-y-2" role="status" aria-label="Cargando"><div className="tc-esqueleto h-[110px] w-full" /><div className="tc-esqueleto h-[110px] w-full" /></div>}
          {reuniones && !disponible && <p className="text-[13px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 279 en Supabase.</p>}
          {reuniones && disponible && reuniones.length === 0 && (
            <div className="tc-pr-vacio">
              <span><Sparkles className="h-6 w-6" /></span>
              <p>No hay tareas esperando</p>
              <small>Cuando acabe una reunión de seguimiento con este cliente y Gemini suba las notas, las tareas aparecerán aquí para que elijas las buenas.</small>
              <button type="button" onClick={() => void buscar()} disabled={buscando} className="tc-boton-suave">{buscando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />} Buscar reuniones nuevas ahora</button>
            </div>
          )}

          {(reuniones ?? []).map((re) => (
            <section key={re.id} className="tc-pr-reunion">
              <div className="tc-pr-reunion-cabecera">
                <h3>{re.titulo}</h3>
                {re.fecha_reunion && <span className="tc-pr-fecha"><CalendarDays className="h-3 w-3" />{fechaCorta(re.fecha_reunion)}</span>}
                <button type="button" onClick={() => void decidir([], re.propuestas.map((p) => p.id))} disabled={enviando} className="tc-boton-suave tc-discreto ml-auto"><Trash2 className="h-3 w-3" /> Descartar toda la reunión</button>
              </div>
              <ul className="flex flex-col gap-2.5">
                {re.propuestas.map((p, i) => {
                  const b = borradores[p.id]
                  if (!b) return null
                  const col = columnas.find((c) => c.nombre === b.columna)
                  const dep = departamentos.find((d) => d.nombre === b.departamento)
                  return (
                    <li key={p.id} className="tc-pr" data-marcada={b.marcada ? 'true' : undefined} style={{ ...tono(col?.color), '--i': Math.min(i, 10) } as CSSProperties}>
                      <div className="flex items-start gap-3">
                        <button type="button" role="checkbox" aria-checked={b.marcada} aria-label={b.marcada ? 'Quitar de las que se crean' : 'Incluir entre las que se crean'} onClick={() => cambiar(p.id, { marcada: !b.marcada })} className="tc-pr-marca" data-on={b.marcada ? 'true' : undefined}><Check className="h-3.5 w-3.5" strokeWidth={3} /></button>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start gap-2">
                            <input value={b.titulo} onChange={(e) => cambiar(p.id, { titulo: e.target.value })} maxLength={200} aria-label="Título de la tarea" className="tc-pr-titulo" />
                            <label className="tc-pr-pastilla tc-pr-columna" title="Columna donde se crea">
                              <span className="tc-pr-punto" />
                              <select aria-label="Columna" value={b.columna} onChange={(e) => cambiar(p.id, { columna: e.target.value })}>
                                {abiertas.map((c) => <option key={c.nombre} value={c.nombre}>{c.nombre}</option>)}
                                {!abiertas.some((c) => c.nombre === b.columna) && <option value={b.columna}>{b.columna}</option>}
                              </select>
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </label>
                          </div>

                          <div className="mt-2 flex flex-wrap items-center gap-1.5">
                            <label className="tc-pr-pastilla" style={tono(dep?.color)} data-vacia={b.departamento ? undefined : 'true'}>
                              <select aria-label="Departamento" value={b.departamento ?? ''} onChange={(e) => cambiar(p.id, { departamento: e.target.value || null })}>
                                <option value="">Sin departamento</option>
                                {departamentos.map((d) => <option key={d.nombre} value={d.nombre}>{d.nombre}</option>)}
                              </select>
                              <ChevronDown className="h-3 w-3 opacity-60" />
                            </label>
                            <label className="tc-pr-pastilla tc-pr-fecha-campo" data-vacia={b.fecha_inicio ? undefined : 'true'}>
                              <CalendarDays className="h-3 w-3" />
                              <span>{b.fecha_inicio ? fechaCorta(b.fecha_inicio) : 'Fecha'}</span>
                              <input type="date" aria-label="Fecha" value={b.fecha_inicio} onClick={(e) => (e.currentTarget as HTMLInputElement & { showPicker?: () => void }).showPicker?.()} onChange={(e) => cambiar(p.id, { fecha_inicio: e.target.value })} />
                            </label>
                            <SelectorDePersonas valor={b.responsables} personas={gente} onCambio={(ids) => cambiar(p.id, { responsables: ids })} />
                            <button type="button" onClick={() => cambiar(p.id, { abierta: !b.abierta })} className="tc-pr-detalle" aria-expanded={b.abierta}>
                              {b.subtareas.length > 0 ? `${b.subtareas.length} subtareas` : 'Detalle'}<ChevronDown className={`h-3 w-3 transition-transform ${b.abierta ? 'rotate-180' : ''}`} />
                            </button>
                          </div>

                          {b.contexto && !b.abierta && <p className="tc-pr-contexto">{b.contexto}</p>}
                          {b.abierta && (
                            <div className="tc-pr-ampliado">
                              <label>Contexto
                                <textarea value={b.contexto} onChange={(e) => cambiar(p.id, { contexto: e.target.value })} rows={3} />
                              </label>
                              {b.columna !== 'Backlog' && (
                                <div>
                                  <p className="tc-pr-rotulo">Subtareas</p>
                                  <ul className="flex flex-col gap-1">
                                    {b.subtareas.map((s, j) => (
                                      <li key={j} className="tc-pr-subtarea">
                                        <span>{j + 1}</span>
                                        <input value={s} onChange={(e) => cambiar(p.id, { subtareas: b.subtareas.map((x, k) => (k === j ? e.target.value : x)) })} aria-label={`Subtarea ${j + 1}`} />
                                        <button type="button" onClick={() => cambiar(p.id, { subtareas: b.subtareas.filter((_, k) => k !== j) })} aria-label="Quitar la subtarea" className="tc-icono-boton !h-6 !w-6"><Trash2 className="h-3 w-3" /></button>
                                      </li>
                                    ))}
                                  </ul>
                                  <button type="button" onClick={() => cambiar(p.id, { subtareas: [...b.subtareas, ''] })} className="tc-boton-suave tc-discreto mt-1.5"><Plus className="h-3 w-3" /> Añadir subtarea</button>
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
          <footer className="tc-pr-pie">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {porColumna.map(([nombre, n]) => (
                <span key={nombre} className="tc-pr-resumen" style={tono(columnas.find((c) => c.nombre === nombre)?.color)}><span className="tc-pr-punto" />{n} {nombre}</span>
              ))}
              {marcadas.length === 0 && <span className="text-[12px] text-[var(--ls-t4)]">Ninguna marcada: se descartarán todas</span>}
            </div>
            <button type="button" onClick={onCerrar} className="tc-boton-suave ml-auto">Decidir luego</button>
            <button type="button" disabled={enviando || lista.length === 0} onClick={() => void decidir(marcadas, lista.filter((b) => !b.marcada).map((b) => b.id))} className="tc-boton-primario tc-pr-crear disabled:opacity-50">
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
