'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Copy, ExternalLink, Eye, Loader2, RefreshCw, Share2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { EstadoDelEnlace } from '@/lib/tareas-clientes/portal-servidor'
import { BASE, pedir } from './api'

/**
 * COMPARTIR EL PANEL CON EL CLIENTE (solo administradores): activa un enlace secreto a una página con las tareas marcadas «Ve el cliente» de este cliente. Se puede copiar,
 * apagar o cambiar por otro (el anterior deja de valer). Ver lib/tareas-clientes/portal.ts para lo que el cliente ve y lo que no.
 */
export function CompartirConElCliente({ clienteId, clienteNombre, onCerrar }: { clienteId: string; clienteNombre: string; onCerrar: () => void }) {
  const [estado, setEstado] = useState<EstadoDelEnlace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [copiado, setCopiado] = useState(false)

  useEffect(() => {
    let vivo = true
    pedir<EstadoDelEnlace>(`${BASE}/clientes/${clienteId}/portal`)
      .then((r) => vivo && setEstado(r))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer el enlace'))
    return () => {
      vivo = false
    }
  }, [clienteId])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const cambiar = useCallback(
    async (cuerpo: { activo?: boolean; regenerar?: boolean }) => {
      setOcupado(true)
      setError(null)
      try {
        setEstado(await pedir<EstadoDelEnlace>(`${BASE}/clientes/${clienteId}/portal`, { metodo: 'PUT', cuerpo }))
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se ha podido guardar')
      } finally {
        setOcupado(false)
      }
    },
    [clienteId]
  )

  const enlace = estado?.token && typeof window !== 'undefined' ? `${window.location.origin}/tareas-cliente/${estado.token}` : null

  const copiar = async () => {
    if (!enlace) return
    try {
      await navigator.clipboard.writeText(enlace)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 1800)
    } catch {
      toast.error('No se ha podido copiar. Selecciona el enlace y cópialo a mano.')
    }
  }

  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal !h-auto max-w-[560px]" role="dialog" aria-modal="true" aria-label="Compartir con el cliente">
        <header className="tc-modal-cabecera">
          <Share2 className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Panel de {clienteNombre} para el cliente</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="flex flex-col gap-4 p-5 text-[13px] text-[var(--ls-t2)]">
          {!estado && !error && <div className="tc-esqueleto h-24 w-full" role="status" aria-label="Cargando" />}
          {error && <p role="alert" className="text-[var(--ls-e-rojo)]">{error}</p>}
          {estado && !estado.disponible && <p className="text-[var(--ls-e-ambar)]">Falta lanzar la migración 278 en Supabase para compartir el panel con el cliente.</p>}
          {estado?.disponible && (
            <>
              <p className="leading-relaxed">
                El cliente abre un enlace —sin entrar al ERP— y ve <strong className="text-[var(--ls-t1)]">solo las tareas que marques con «Ve el cliente»</strong> en su panel: el título, en qué fase están, las fechas y el avance. Nunca el
                cuerpo, los comentarios ni quién las lleva.
              </p>
              <div className="flex items-center gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2">
                <Eye className="h-4 w-4 text-[var(--ls-t3)]" />
                <span><strong className="text-[var(--ls-t1)]">{estado.visibles}</strong> {estado.visibles === 1 ? 'tarea visible' : 'tareas visibles'} ahora mismo{estado.aperturas > 0 ? ` · abierto ${estado.aperturas} ${estado.aperturas === 1 ? 'vez' : 'veces'}` : ''}</span>
              </div>
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" className="tc-casilla" checked={estado.activo} disabled={ocupado} onChange={(e) => void cambiar({ activo: e.target.checked })} />
                <span className="text-[var(--ls-t1)]">{estado.activo ? 'El panel está activo' : 'El panel está apagado'}</span>
                {ocupado && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              </label>
              {estado.activo && enlace && (
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    <input readOnly value={enlace} onFocus={(e) => e.currentTarget.select()} aria-label="Enlace del panel" className="h-9 min-w-0 flex-1 rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 text-[12px] text-[var(--ls-t1)] outline-none" />
                    <button type="button" onClick={() => void copiar()} className="tc-boton-primario !h-9">{copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copiado ? 'Copiado' : 'Copiar'}</button>
                  </div>
                  <div className="flex items-center gap-3 text-[12px]">
                    <a href={enlace} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[var(--ls-acc)] hover:underline"><ExternalLink className="h-3 w-3" /> Ver como lo ve el cliente</a>
                    <button type="button" disabled={ocupado} onClick={() => { if (window.confirm('¿Cambiar el enlace? El que tiene ahora el cliente dejará de funcionar.')) void cambiar({ regenerar: true }) }} className="inline-flex items-center gap-1 text-[var(--ls-t3)] hover:text-[var(--ls-e-rojo)]"><RefreshCw className="h-3 w-3" /> Cambiar el enlace</button>
                  </div>
                </div>
              )}
              <p className="text-[12px] text-[var(--ls-t4)]">Quien tenga el enlace puede verlo: compártelo solo con la persona de ese cliente.</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
