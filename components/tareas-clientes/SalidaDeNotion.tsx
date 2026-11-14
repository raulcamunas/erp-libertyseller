'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, CheckCircle2, Loader2, LogOut, RefreshCw, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadoDeSalida } from '@/lib/tareas-clientes/salida-servidor'
import type { Comprobacion } from '@/lib/tareas-clientes/salida'
import { BASE, pedir } from './api'

const GRUPOS: Array<{ clave: Comprobacion['grupo']; titulo: string }> = [
  { clave: 'conexion', titulo: 'La conexión con Notion' },
  { clave: 'envio', titulo: 'Lo que se crea aquí llega a Notion' },
  { clave: 'equipo', titulo: 'El equipo ya trabaja aquí' },
]

const ICONO = {
  ok: <CheckCircle2 className="h-4 w-4 text-[var(--ls-e-verde)]" aria-label="Bien" />,
  aviso: <AlertTriangle className="h-4 w-4 text-[var(--ls-e-ambar)]" aria-label="Aviso" />,
  falta: <XCircle className="h-4 w-4 text-[var(--ls-e-rojo)]" aria-label="Falta" />,
} as const

/**
 * LA LISTA PARA DEJAR NOTION (solo administradores). Lo que se puede medir se mide cada vez que se abre; lo que solo puede confirmar una persona son casillas que se guardan. Cuando todo
 * está en verde, solo queda el último paso: pasar Notion a solo lectura. Ver lib/tareas-clientes/salida.ts.
 */
export function SalidaDeNotion({ onCerrar }: { onCerrar: () => void }) {
  const [estado, setEstado] = useState<EstadoDeSalida | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [midiendo, setMidiendo] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)

  const medir = useCallback(async () => {
    setMidiendo(true)
    setError(null)
    try {
      setEstado(await pedir<EstadoDeSalida>(`${BASE}/salida-notion`))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido medir')
    } finally {
      setMidiendo(false)
    }
  }, [])

  useEffect(() => {
    void medir()
  }, [medir])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const marcar = async (clave: string, hecho: boolean) => {
    setGuardando(clave)
    try {
      setEstado(await pedir<EstadoDeSalida>(`${BASE}/salida-notion`, { metodo: 'PUT', cuerpo: { clave, hecho } }))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(null)
    }
  }

  const r = estado?.resumen
  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal !h-auto max-h-[min(820px,100%)] max-w-[720px]" role="dialog" aria-modal="true" aria-label="Salir de Notion">
        <header className="tc-modal-cabecera">
          <LogOut className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Salir de Notion</span>
          {r && <span className="text-[12px] text-[var(--ls-t3)]">{r.hechas} de {r.total}</span>}
          <button type="button" onClick={() => void medir()} disabled={midiendo} aria-label="Volver a medir" className="tc-icono-boton ml-auto"><RefreshCw className={`h-4 w-4 ${midiendo ? 'animate-spin' : ''}`} /></button>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 text-[13px] text-[var(--ls-t2)]">
          {!estado && !error && <div className="tc-esqueleto h-40 w-full" role="status" aria-label="Midiendo" />}
          {error && <p role="alert" className="text-[var(--ls-e-rojo)]">{error}</p>}
          {estado && r && (
            <>
              <div className="tc-sal-barra" role="progressbar" aria-valuemin={0} aria-valuemax={r.total} aria-valuenow={r.hechas} aria-label="Progreso de la lista">
                <span style={{ width: `${Math.round((r.hechas / r.total) * 100)}%` }} />
              </div>
              <p className="text-[12.5px] text-[var(--ls-t3)]">
                {r.terminada ? 'Hecho: Notion ya es solo de consulta y el ERP es el sitio de trabajo.' : r.listo ? 'Todo está en verde. Solo queda el último paso: pasar Notion a solo lectura.' : 'Esto se mide en el momento. Un aviso en ámbar es información y no impide salir; una cruz roja, sí.'}
              </p>
              {GRUPOS.map((g) => (
                <section key={g.clave} className="flex flex-col gap-1">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">{g.titulo}</h3>
                  {estado.comprobaciones.filter((c) => c.grupo === g.clave).map((c) => (
                    <div key={c.clave} className="tc-sal-fila">
                      <span className="mt-0.5 shrink-0">{ICONO[c.estado]}</span>
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ls-t1)]">{c.titulo}</p>
                        <p className="text-[12px] text-[var(--ls-t3)]">{c.detalle}</p>
                        {c.estado === 'falta' && c.ayuda && <p className="mt-0.5 text-[12px] text-[var(--ls-t4)]">{c.ayuda}</p>}
                      </div>
                    </div>
                  ))}
                </section>
              ))}
              <section className="flex flex-col gap-1">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t4)]">Lo tiene que confirmar una persona</h3>
                {estado.manuales.map((m) => {
                  const bloqueada = m.final && !r.listo && !m.hecho
                  return (
                    <label key={m.clave} className="tc-sal-fila cursor-pointer" data-bloqueada={bloqueada ? 'true' : undefined}>
                      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-[var(--ls-acc)]" checked={m.hecho} disabled={guardando === m.clave || bloqueada} onChange={(e) => void marcar(m.clave, e.target.checked)} />
                      <div className="min-w-0">
                        <p className="font-medium text-[var(--ls-t1)]">{m.titulo}</p>
                        <p className="text-[12px] text-[var(--ls-t3)]">{bloqueada ? 'Se desbloquea cuando todo lo anterior esté hecho.' : m.descripcion}</p>
                      </div>
                      {guardando === m.clave && <Loader2 className="ml-auto h-3.5 w-3.5 shrink-0 animate-spin" />}
                    </label>
                  )
                })}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
