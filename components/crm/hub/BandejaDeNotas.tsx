'use client'

import { useCallback, useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'
import { toast } from 'sonner'
import { AlertTriangle, Loader2, MailSearch, RefreshCw, UserRoundCog, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toMadrid } from '@/lib/timezone'
import { esTablaInexistente, FALTA_MIGRACION_258 } from '@/lib/crm/migracion'
import { analizarNota, asignarNota, sincronizarNotas } from './api'
import { AsignarNota } from './AsignarNota'
import { Aviso, Boton, Insignia, Seccion, Vacio } from './piezas'

interface NotaDeLaBandeja {
  id: string
  titulo: string
  fecha_reunion: string | null
  invitados: string[]
  resumen: string | null
  estado: 'sin_cita' | 'error'
  error: string | null
}

interface Resultado {
  ok: boolean
  resumen: string
  detenida: string | null
  avisos: string[]
  costeUsd: number
}

const cuando = (iso: string) => format(toMadrid(new Date(iso)), "d MMM yyyy · HH:mm", { locale: es })

/**
 * LA BANDEJA DE NOTAS DE REUNIÓN: lo que la sincronización de Gemini no pudo resolver sola, y el botón para lanzarla a mano.
 *
 * · «Sin cliente»: reuniones con un cliente cuya nota no se pudo enlazar con ninguna ficha (ni el evento del calendario, ni el correo del invitado, ni el nombre coincidían).
 *   Se asignan a mano y, si aún no tienen análisis, se analizan en el acto.
 * · «Con error»: notas cuyo análisis de la IA falló varias veces.
 * · «Sincronizar ahora»: una pasada entera (la misma que corre sola cada pocos minutos). Si falta algo en Google —los permisos de Gmail y Drive, o una API apagada— lo dice aquí con
 *   la frase de qué hay que hacer.
 *
 * Solo dirección: asignar y analizar escriben y gastan.
 */
export function BandejaDeNotas({ abierta, onCerrar, clientes, onCambio }: { abierta: boolean; onCerrar: () => void; clientes: ReadonlyArray<{ id: string; nombre: string; empresa: string | null }>; onCambio: () => void }) {
  const supabase = createClient()
  const [notas, setNotas] = useState<NotaDeLaBandeja[]>([])
  const [cargando, setCargando] = useState(false)
  const [migracionFalta, setMigracionFalta] = useState(false)
  const [sincronizando, setSincronizando] = useState(false)
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [asignando, setAsignando] = useState<string | null>(null)
  const [trabajando, setTrabajando] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setCargando(true)
    const { data, error } = await supabase
      .from('crm_notas_reunion')
      .select('id, titulo, fecha_reunion, invitados, resumen, estado, error')
      .in('estado', ['sin_cita', 'error'])
      .order('fecha_reunion', { ascending: false, nullsFirst: false })
      .limit(100)
    setCargando(false)
    if (error) {
      if (esTablaInexistente(error)) setMigracionFalta(true)
      return
    }
    setNotas((data ?? []) as unknown as NotaDeLaBandeja[])
  }, [supabase])

  useEffect(() => {
    if (abierta) void cargar()
  }, [abierta, cargar])

  async function sincronizar() {
    setSincronizando(true)
    const r = await sincronizarNotas()
    setSincronizando(false)
    const d = r.datos as Partial<Resultado> & { costeUsd?: number }
    setResultado({ ok: r.ok, resumen: typeof d.resumen === 'string' ? d.resumen : '', detenida: typeof d.detenida === 'string' ? d.detenida : r.ok ? null : r.error, avisos: Array.isArray(d.avisos) ? (d.avisos as string[]) : [], costeUsd: typeof d.costeUsd === 'number' ? d.costeUsd : 0 })
    await cargar()
    onCambio()
  }

  async function asignar(nota: NotaDeLaBandeja, clientId: string) {
    setTrabajando(nota.id)
    const r = await asignarNota(nota.id, clientId)
    if (!r.ok) {
      setTrabajando(null)
      toast.error(r.error ?? 'No se ha podido asignar la nota')
      return
    }
    setAsignando(null)
    toast.success('Nota asignada. Se está analizando…')
    // Recién asignada y sin análisis: se analiza ya, para que el cliente la tenga lista al abrir su ficha
    if (r.datos.estado === 'pendiente') {
      const a = await analizarNota(nota.id)
      if (!a.ok) toast.error(a.error ?? 'La nota se asignó, pero no se pudo analizar todavía. Se reintentará sola.')
      else toast.success('Reunión analizada')
    }
    setTrabajando(null)
    await cargar()
    onCambio()
  }

  async function reanalizar(nota: NotaDeLaBandeja) {
    setTrabajando(nota.id)
    const a = await analizarNota(nota.id)
    setTrabajando(null)
    if (!a.ok) toast.error(a.error ?? 'No se ha podido analizar la reunión')
    else toast.success('Reunión analizada')
    await cargar()
    onCambio()
  }

  const sinCliente = notas.filter((n) => n.estado === 'sin_cita')
  const conError = notas.filter((n) => n.estado === 'error')

  return (
    <AnimatePresence>
      {abierta && (
        <>
          <motion.div key="fondo" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="fixed inset-0 z-40 bg-black/50" onClick={onCerrar} />
          <motion.aside
            key="panel"
            initial={{ x: 40, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 40, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="fixed inset-y-0 right-0 z-50 flex w-[min(580px,100vw)] flex-col border-l border-[var(--ls-linea2)] bg-[var(--ls-fondo)] shadow-[-8px_0_32px_-12px_rgba(0,0,0,0.5)]"
            role="dialog"
            aria-label="Notas de reunión"
          >
            <header className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-4">
              <MailSearch className="h-4 w-4 text-[var(--ls-t4)]" />
              <h2 className="flex-1 text-[13px] font-semibold text-[var(--ls-t1)]">Notas de reunión (Gemini)</h2>
              <button type="button" onClick={onCerrar} className="inline-flex h-6 w-6 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
              <Seccion
                titulo="Sincronización con Gmail"
                icono={<RefreshCw />}
                derecha={
                  <Boton tono="primario" onClick={() => void sincronizar()} disabled={sincronizando} icono={sincronizando ? <Loader2 className="animate-spin" /> : <RefreshCw />}>
                    {sincronizando ? 'Sincronizando…' : 'Sincronizar ahora'}
                  </Boton>
                }
              >
                <p className="text-[12px] leading-[1.55] text-[var(--ls-t3)]">
                  Las notas que Gemini deja de cada reunión de Meet llegan solas a Gmail y de ahí a la ficha del cliente, cada pocos minutos. Solo se leen las reuniones con clientes; las internas del equipo se ignoran. Aquí puedes lanzar una pasada a mano.
                </p>
                {resultado && (
                  <div className="mt-2.5 space-y-2">
                    {resultado.detenida ? (
                      <Aviso tono="rojo" icono={<AlertTriangle />}>
                        <p className="font-semibold text-[var(--ls-t1)]">La sincronización se ha parado</p>
                        <p className="mt-0.5 break-words">{resultado.detenida}</p>
                      </Aviso>
                    ) : (
                      <Aviso tono="verde">
                        <p className="break-words">{resultado.resumen || 'Pasada hecha.'}</p>
                        {resultado.costeUsd > 0 && <p className="mt-0.5 text-[var(--ls-t4)]">Coste de la IA: {resultado.costeUsd.toLocaleString('es-ES', { maximumFractionDigits: 4 })} $</p>}
                      </Aviso>
                    )}
                    {resultado.avisos.map((a, i) => (
                      <Aviso key={i} tono="ambar" icono={<AlertTriangle />}>
                        <span className="break-words">{a}</span>
                      </Aviso>
                    ))}
                  </div>
                )}
              </Seccion>

              {migracionFalta && (
                <Aviso tono="ambar" icono={<AlertTriangle />}>
                  {FALTA_MIGRACION_258}
                </Aviso>
              )}

              <Seccion titulo={`Sin cliente (${sinCliente.length})`} icono={<UserRoundCog />}>
                {cargando && notas.length === 0 ? (
                  <p className="flex items-center gap-1.5 text-[11.5px] text-[var(--ls-t4)]">
                    <Loader2 className="h-3 w-3 animate-spin" /> Cargando…
                  </p>
                ) : sinCliente.length === 0 ? (
                  <Vacio>No hay ninguna nota esperando cliente. Cuando una reunión no se pueda enlazar sola con una ficha, aparecerá aquí para asignarla.</Vacio>
                ) : (
                  <ul className="-my-1 divide-y divide-[var(--ls-linea)]">
                    {sinCliente.map((n) => (
                      <li key={n.id} className="py-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{n.titulo}</p>
                            <p className="text-[11px] text-[var(--ls-t4)]">
                              {n.fecha_reunion ? cuando(n.fecha_reunion) : 'Fecha sin determinar'}
                              {n.invitados.length > 0 ? ` · ${n.invitados.join(', ')}` : ''}
                            </p>
                            {n.resumen && <p className="mt-1 line-clamp-2 text-[12px] leading-[1.5] text-[var(--ls-t3)]">{n.resumen}</p>}
                          </div>
                          <Boton onClick={() => setAsignando(asignando === n.id ? null : n.id)} disabled={trabajando === n.id} icono={trabajando === n.id ? <Loader2 className="animate-spin" /> : <UserRoundCog />}>
                            Asignar
                          </Boton>
                        </div>
                        {asignando === n.id && (
                          <div className="mt-2">
                            <AsignarNota clientes={clientes} trabajando={trabajando === n.id} onElegir={(id) => void asignar(n, id)} onCerrar={() => setAsignando(null)} />
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Seccion>

              {conError.length > 0 && (
                <Seccion titulo={`Con error (${conError.length})`} icono={<AlertTriangle />}>
                  <ul className="-my-1 divide-y divide-[var(--ls-linea)]">
                    {conError.map((n) => (
                      <li key={n.id} className="py-2.5">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{n.titulo}</p>
                            <p className="text-[11px] text-[var(--ls-t4)]">{n.fecha_reunion ? cuando(n.fecha_reunion) : 'Fecha sin determinar'}</p>
                            {n.error && (
                              <div className="mt-1">
                                <Insignia tono="rojo">{n.error}</Insignia>
                              </div>
                            )}
                          </div>
                          <Boton onClick={() => void reanalizar(n)} disabled={trabajando === n.id} icono={trabajando === n.id ? <Loader2 className="animate-spin" /> : <RefreshCw />}>
                            Reintentar
                          </Boton>
                        </div>
                      </li>
                    ))}
                  </ul>
                </Seccion>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
