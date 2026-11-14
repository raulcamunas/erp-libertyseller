'use client'

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { History, Loader2, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Bloque } from '@/lib/tareas-clientes/bloques'
import type { VersionResumida } from '@/lib/tareas-clientes/historial-lectura'
import { BASE, pedir } from './api'
import { Editor } from './Editor'

/**
 * LAS VERSIONES DEL CUERPO DE UNA TAREA: la lista de copias a la izquierda, la copia elegida (solo para leer) a la derecha y «Restaurar esta versión». Restaurar guarda antes una
 * copia de cómo está ahora, así que también se puede deshacer. Ver lib/tareas-clientes/historial.ts.
 */

const ORIGEN: Record<VersionResumida['origen'], string> = { erp: 'Editado en el ERP', notion: 'Cambiado desde Notion', restaurar: 'Antes de restaurar otra' }

const cuando = (iso: string): string =>
  new Intl.DateTimeFormat('es-ES', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Madrid' }).format(new Date(iso))

export function VersionesDelCuerpo({ tareaId, onCerrar, onRestaurada }: { tareaId: string; onCerrar: () => void; onRestaurada: () => void }) {
  const [lista, setLista] = useState<VersionResumida[] | null>(null)
  const [disponible, setDisponible] = useState(true)
  const [elegida, setElegida] = useState<string | null>(null)
  const [contenido, setContenido] = useState<Bloque[] | null>(null)
  const [restaurando, setRestaurando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    pedir<{ versiones: VersionResumida[]; disponible: boolean }>(`${BASE}/tareas/${tareaId}/versiones`)
      .then((r) => {
        if (!vivo) return
        setLista(r.versiones)
        setDisponible(r.disponible)
        if (r.versiones[0]) setElegida(r.versiones[0].id)
      })
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer el historial'))
    return () => {
      vivo = false
    }
  }, [tareaId])

  useEffect(() => {
    if (!elegida) return setContenido(null)
    let vivo = true
    setContenido(null)
    pedir<{ version: { contenido: Bloque[] } }>(`${BASE}/tareas/${tareaId}/versiones?v=${elegida}`)
      .then((r) => vivo && setContenido(r.version.contenido ?? []))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido abrir esa versión'))
    return () => {
      vivo = false
    }
  }, [elegida, tareaId])

  useEffect(() => {
    const alTeclear = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar()
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])

  const restaurar = useCallback(async () => {
    if (!elegida || restaurando) return
    if (!window.confirm('¿Restaurar esta versión? El cuerpo de ahora se guarda antes en el historial, así que se puede deshacer.')) return
    setRestaurando(true)
    try {
      await pedir(`${BASE}/tareas/${tareaId}/versiones`, { metodo: 'POST', cuerpo: { versionId: elegida } })
      toast.success('Versión restaurada')
      onRestaurada()
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido restaurar')
    } finally {
      setRestaurando(false)
    }
  }, [elegida, restaurando, tareaId, onRestaurada, onCerrar])

  const ventana = (
    <div className="tc-modal-fondo" onClick={(e) => e.target === e.currentTarget && onCerrar()}>
      <div className="tc-modal" role="dialog" aria-modal="true" aria-label="Versiones del cuerpo">
        <header className="tc-modal-cabecera">
          <History className="h-4 w-4 text-[var(--ls-acc)]" />
          <span className="text-[15px] font-semibold text-[var(--ls-t1)]">Versiones del cuerpo</span>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="tc-icono-boton ml-auto"><X className="h-4 w-4" /></button>
        </header>
        <div className="tc-modal-cuerpo">
          <div className="tc-modal-lista">
            {error && <p role="alert" className="mb-2 text-[12px] text-[var(--ls-e-rojo)]">{error}</p>}
            {!lista && !error && <div className="tc-esqueleto h-16 w-full" role="status" aria-label="Cargando" />}
            {lista && !disponible && <p className="text-[12px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 278 en Supabase: hasta entonces no se guardan versiones.</p>}
            {lista && disponible && lista.length === 0 && <p className="text-[12px] text-[var(--ls-t4)]">Todavía no hay versiones. Se guarda una copia cada vez que el cuerpo cambia (como mucho una cada 10 minutos).</p>}
            <ul className="flex flex-col gap-1">
              {(lista ?? []).map((v) => (
                <li key={v.id}>
                  <button type="button" onClick={() => setElegida(v.id)} aria-pressed={elegida === v.id} className="tc-opcion !h-auto w-full !flex-col !items-start !gap-0.5 !py-2" data-activo={elegida === v.id ? 'true' : undefined} style={elegida === v.id ? { background: 'var(--ls-acc-suave)' } : undefined}>
                    <span className="text-[12.5px] font-medium text-[var(--ls-t1)]">{cuando(v.creado_en)}</span>
                    <span className="text-[11px] text-[var(--ls-t4)]">{v.usuario_nombre || 'Alguien'} · {ORIGEN[v.origen]}</span>
                    <span className="text-[11px] text-[var(--ls-t4)]">{v.resumen.bloques} bloques · {v.resumen.palabras} palabras</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="tc-modal-form">
            {elegida && !contenido && !error && <div className="space-y-3" role="status" aria-label="Cargando la versión"><div className="tc-esqueleto h-5 w-2/3" /><div className="tc-esqueleto h-40 w-full" /></div>}
            {contenido && (contenido.length > 0 ? <div className="tc-modal-editor"><Editor bloques={contenido} onCambio={() => undefined} soloLectura /></div> : <p className="text-[12.5px] text-[var(--ls-t4)]">Esta versión está vacía.</p>)}
          </div>
        </div>
        <footer className="tc-modal-pie">
          <span className="text-[11.5px] text-[var(--ls-t4)]">Solo para leer. Restaurar pone esta versión como el cuerpo de la tarea.</span>
          <button type="button" disabled={!elegida || !contenido || restaurando} onClick={() => void restaurar()} className="tc-boton-primario ml-auto disabled:opacity-50">{restaurando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />} Restaurar esta versión</button>
        </footer>
      </div>
    </div>
  )
  return typeof document === 'undefined' ? null : createPortal(ventana, document.body)
}
