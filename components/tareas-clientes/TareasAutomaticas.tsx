'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bot, Loader2, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import type { PanelDeAutomaticas } from '@/lib/tareas-clientes/automaticas-servidor'
import type { PersonaTC } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'

/**
 * LAS TAREAS QUE CREA EL ERP (solo administradores): enciende cada fuente, elige en qué columna caen y a quién se asignan, y enlaza los clientes que no se llaman igual en Amazon
 * y aquí. Cada fuente nace apagada. Ver lib/tareas-clientes/automaticas.ts.
 */
export function TareasAutomaticas({ personas, onCerrar }: { personas: readonly PersonaTC[]; onCerrar: () => void }) {
  const [panel, setPanel] = useState<PanelDeAutomaticas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    pedir<PanelDeAutomaticas>(`${BASE}/automaticas`)
      .then((r) => vivo && setPanel(r))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer'))
    return () => {
      vivo = false
    }
  }, [])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const enviar = useCallback(async (clave: string, cuerpo: Record<string, unknown>) => {
    setOcupado(clave)
    setError(null)
    try {
      const r = await pedir<{ panel: PanelDeAutomaticas; resumen?: { creadas: number; yaExistian: number; fuentes: string } }>(`${BASE}/automaticas`, { metodo: 'PUT', cuerpo })
      setPanel(r.panel)
      if (r.resumen) toast.success(r.resumen.creadas > 0 ? `${r.resumen.creadas} tareas nuevas creadas` : `Nada nuevo (${r.resumen.fuentes})`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setOcupado(null)
    }
  }, [])

  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal !h-auto max-h-[min(780px,100%)] max-w-[680px]" role="dialog" aria-modal="true" aria-label="Tareas automáticas">
        <header className="tc-modal-cabecera">
          <Bot className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Tareas que crea el ERP</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5 text-[13px] text-[var(--ls-t2)]">
          {!panel && !error && <div className="tc-esqueleto h-32 w-full" role="status" aria-label="Cargando" />}
          {error && <p role="alert" className="text-[var(--ls-e-rojo)]">{error}</p>}
          {panel && !panel.disponible && <p className="text-[var(--ls-e-ambar)]">Falta lanzar la migración 278 en Supabase para usar las tareas automáticas.</p>}
          {panel?.disponible && (
            <>
              <p className="leading-relaxed">Cuando algo grave pasa en la cuenta de un cliente, el ERP abre una tarea en su tablero. Nunca crea dos veces la misma, aunque la termines o la archives. Cada fuente empieza apagada.</p>
              {panel.fuentes.map((f) => {
                return (
                  <section key={f.fuente} className="tc-acceso-persona">
                    <label className="flex cursor-pointer items-start gap-2.5">
                      <input type="checkbox" className="tc-casilla mt-0.5" checked={f.activa} disabled={ocupado !== null} onChange={(e) => void enviar(f.fuente, { fuente: f.fuente, activa: e.target.checked })} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium text-[var(--ls-t1)]">{f.nombre} {ocupado === f.fuente && <Loader2 className="inline h-3 w-3 animate-spin" />}</span>
                        <span className="block text-[12px] leading-relaxed text-[var(--ls-t3)]">{f.que}</span>
                        <span className="block text-[11.5px] text-[var(--ls-t4)]">Se ve en: {f.donde}{f.ultima_pasada ? ` · última pasada ${new Date(f.ultima_pasada).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}{f.ultimo_resumen ? ` (${f.ultimo_resumen})` : ''}</span>
                      </span>
                    </label>
                    {f.activa && (
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-[var(--ls-linea)] pt-3">
                        <label className="flex items-center gap-2 text-[12px]">Columna
                          <input defaultValue={f.estado ?? ''} placeholder="la primera pendiente" aria-label="Columna donde caen" onBlur={(e) => e.target.value.trim() !== (f.estado ?? '') && void enviar(f.fuente, { fuente: f.fuente, estado: e.target.value })} className="h-7 w-44 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[12px] outline-none" />
                        </label>
                        <div className="flex flex-wrap items-center gap-1.5 text-[12px]">Asignar a
                          {personas.map((p) => {
                            const on = f.responsables.includes(p.id)
                            return <button key={p.id} type="button" aria-pressed={on} onClick={() => void enviar(f.fuente, { fuente: f.fuente, responsables: on ? f.responsables.filter((x) => x !== p.id) : [...f.responsables, p.id] })} className="tc-acceso-cliente" data-activo={on ? 'true' : undefined}>{p.nombre.split(' ')[0]}</button>
                          })}
                        </div>
                      </div>
                    )}
                  </section>
                )
              })}

              <section>
                <h3 className="tc-seccion-titulo">Clientes de Amazon sin pareja <span className="tc-contador">{panel.sinPareja.length}</span></h3>
                {panel.sinPareja.length === 0 ? (
                  <p className="text-[12px] text-[var(--ls-t4)]">Todos los clientes de Amazon tienen su cliente de tareas (se cruzan por el nombre).</p>
                ) : (
                  <ul className="flex flex-col gap-1.5">
                    {panel.sinPareja.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 text-[12.5px]">
                        <span className="min-w-0 flex-1 truncate text-[var(--ls-t1)]">{a.nombre}</span>
                        <select aria-label={`Cliente de tareas para ${a.nombre}`} defaultValue="" onChange={(e) => e.target.value && void enviar(`v-${a.id}`, { vincular: { clienteId: e.target.value, amazonClientId: a.id } })} className="h-7 max-w-[220px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-1.5 text-[12px]">
                          <option value="">Elegir cliente de tareas…</option>
                          {panel.clientes.filter((c) => !c.amazonClientId).map((c) => <option key={c.id} value={c.id}>{c.icono ? `${c.icono} ` : ''}{c.nombre}</option>)}
                        </select>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
        {panel?.disponible && (
          <footer className="tc-modal-pie">
            <span className="text-[11.5px] text-[var(--ls-t4)]">Se revisa sola cada hora. Aquí puedes lanzarla ahora.</span>
            <button type="button" disabled={ocupado !== null || !panel.fuentes.some((f) => f.activa)} onClick={() => void enviar('ejecutar', { ejecutar: true })} className="tc-boton-primario ml-auto disabled:opacity-50">{ocupado === 'ejecutar' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />} Ejecutar ahora</button>
          </footer>
        )}
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
