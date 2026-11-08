'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/rendimiento/ui'
import { ETIQUETA_DE_GRUPO, type GrupoDeCliente, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import { BASE, pedir } from './api'

/**
 * «QUIÉN VE QUÉ» (solo administradores): para cada persona con acceso a Tareas de clientes, si ve todos los clientes o solo los que se marquen. Se guarda al marcar. Los
 * administradores ven siempre todos. Quien no tiene ningún límite ve todos (así nadie pierde nada al estrenar esto).
 */

interface ClienteBreve {
  id: string
  nombre: string
  icono: string | null
  grupo: GrupoDeCliente
}

interface Borrador {
  modo: 'todos' | 'solo'
  elegidos: string[]
}

const ORDEN_DE_GRUPOS: GrupoDeCliente[] = ['agencia', 'marcas_eeuu', 'otros']

export function AccesosDeClientes({ onCerrar }: { onCerrar: () => void }) {
  const [datos, setDatos] = useState<{ personas: PersonaTC[]; clientes: ClienteBreve[]; administradores: string[] } | null>(null)
  const [borradores, setBorradores] = useState<Record<string, Borrador>>({})
  const [guardando, setGuardando] = useState<string | null>(null)

  useEffect(() => {
    void pedir<{ personas: PersonaTC[]; clientes: ClienteBreve[]; administradores: string[] }>(`${BASE}/accesos`)
      .then((d) => {
        setDatos(d)
        setBorradores(Object.fromEntries(d.personas.map((p) => [p.id, p.clientes && p.clientes.length > 0 ? { modo: 'solo' as const, elegidos: p.clientes } : { modo: 'todos' as const, elegidos: [] }])))
      })
      .catch((e: Error) => {
        toast.error(e.message)
        onCerrar()
      })
  }, [onCerrar])

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  const guardar = useCallback(async (usuarioId: string, b: Borrador) => {
    // «Solo estos» sin ninguno marcado todavía no se guarda: dejaría a la persona viéndolo todo sin que lo parezca
    if (b.modo === 'solo' && b.elegidos.length === 0) return
    setGuardando(usuarioId)
    try {
      await pedir(`${BASE}/accesos`, { metodo: 'PUT', cuerpo: { usuarioId, clientes: b.modo === 'todos' ? null : b.elegidos } })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(null)
    }
  }, [])

  const cambiar = (id: string, nuevo: Borrador) => {
    setBorradores((b) => ({ ...b, [id]: nuevo }))
    void guardar(id, nuevo)
  }

  const porGrupo = useMemo(() => ORDEN_DE_GRUPOS.map((g) => ({ g, lista: (datos?.clientes ?? []).filter((c) => c.grupo === g) })).filter((x) => x.lista.length > 0), [datos?.clientes])
  const admins = new Set(datos?.administradores ?? [])

  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal !h-auto max-h-[min(780px,100%)]" role="dialog" aria-modal="true" aria-label="Quién ve qué cliente">
        <header className="tc-modal-cabecera">
          <ShieldCheck className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Quién ve qué cliente</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <p className="mb-4 text-[12.5px] leading-[1.55] text-[var(--ls-t3)]">
            Por defecto, quien tiene acceso a Tareas de clientes ve <b className="text-[var(--ls-t2)]">todos</b> los clientes. Aquí puedes limitar a una persona a unos cuantos: solo verá sus tareas, sus comentarios y sus plantillas, y solo podrá asignársele tareas de esos clientes. Los administradores ven siempre todos. La casilla de acceso a la aplicación se da en Gestión de usuarios.
          </p>
          {!datos && <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="tc-esqueleto h-14" />)}</div>}
          <ul className="flex flex-col gap-3">
            {datos?.personas.map((p) => {
              const b = borradores[p.id] ?? { modo: 'todos' as const, elegidos: [] }
              const esAdmin = admins.has(p.id)
              return (
                <li key={p.id} className="tc-acceso-persona">
                  <div className="flex items-center gap-3">
                    <Avatar id={p.id} nombre={p.nombre} tamano={30} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-[var(--ls-t1)]">{p.nombre}</p>
                      <p className="truncate text-[11.5px] text-[var(--ls-t4)]">{esAdmin ? 'Administrador · ve todos los clientes' : p.email}</p>
                    </div>
                    {guardando === p.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ls-t4)]" aria-label="Guardando" />}
                    {!esAdmin && (
                      <div className="tc-vistas" role="tablist" aria-label={`Qué clientes ve ${p.nombre}`}>
                        <button type="button" role="tab" aria-selected={b.modo === 'todos'} onClick={() => cambiar(p.id, { modo: 'todos', elegidos: [] })} className="tc-vista-boton">Todos</button>
                        <button type="button" role="tab" aria-selected={b.modo === 'solo'} onClick={() => setBorradores((x) => ({ ...x, [p.id]: { modo: 'solo', elegidos: x[p.id]?.elegidos ?? [] } }))} className="tc-vista-boton">Solo algunos</button>
                      </div>
                    )}
                  </div>
                  {!esAdmin && b.modo === 'solo' && (
                    <div className="mt-3 border-t border-[var(--ls-linea)] pt-3">
                      {b.elegidos.length === 0 && <p className="mb-2 text-[12px] text-[var(--ls-e-ambar)]">Marca al menos un cliente: hasta entonces sigue viéndolos todos.</p>}
                      {porGrupo.map(({ g, lista }) => (
                        <div key={g} className="mb-2">
                          <p className="tc-lat-rotulo !px-0 !pb-1 !pt-1">{ETIQUETA_DE_GRUPO[g]}</p>
                          <div className="flex flex-wrap gap-1.5">
                            {lista.map((c) => {
                              const on = b.elegidos.includes(c.id)
                              return (
                                <button key={c.id} type="button" aria-pressed={on} onClick={() => cambiar(p.id, { modo: 'solo', elegidos: on ? b.elegidos.filter((x) => x !== c.id) : [...b.elegidos, c.id] })} className="tc-acceso-cliente" data-activo={on ? 'true' : undefined}>
                                  <span>{c.icono ?? '•'}</span>
                                  {c.nombre}
                                  {on && <Check className="h-3 w-3" />}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
