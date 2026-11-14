'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { File as IconoDeArchivo, FileArchive, FileAudio, FileImage, FileSpreadsheet, FileText, FileVideo, Loader2, Paperclip, Presentation, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { claseDeAdjunto, formatoDeTamano, motivoDeRechazo, nombreLimpio, type AdjuntoTC, type ClaseDeAdjunto } from '@/lib/tareas-clientes/adjuntos'
import { BASE, pedir } from './api'
import { fechaCorta } from './ui'

/**
 * LOS ARCHIVOS DE UNA TAREA: se sueltan encima (o se eligen con el botón), se abren en una pestaña nueva con un enlace que caduca y se borran. Hasta 25 MB cada uno.
 * No viajan a Notion.
 */

const ICONO: Record<ClaseDeAdjunto, typeof IconoDeArchivo> = { imagen: FileImage, pdf: FileText, hoja: FileSpreadsheet, documento: FileText, presentacion: Presentation, comprimido: FileArchive, texto: FileText, audio: FileAudio, video: FileVideo, otro: IconoDeArchivo }

export function Adjuntos({ tareaId, onTotal }: { tareaId: string; onTotal: (total: number) => void }) {
  const [lista, setLista] = useState<AdjuntoTC[] | null>(null)
  const [disponible, setDisponible] = useState(true)
  const [subiendo, setSubiendo] = useState<string[]>([])
  const [encima, setEncima] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const cargar = useCallback(async () => {
    try {
      const r = await pedir<{ adjuntos: AdjuntoTC[]; disponible: boolean }>(`${BASE}/tareas/${tareaId}/adjuntos`)
      setLista(r.adjuntos)
      setDisponible(r.disponible)
    } catch {
      setLista((l) => l ?? [])
    }
  }, [tareaId])

  useEffect(() => {
    setLista(null)
    void cargar()
  }, [cargar])

  const subir = useCallback(
    async (ficheros: File[]) => {
      for (const f of ficheros) {
        const motivo = motivoDeRechazo(nombreLimpio(f.name), f.size)
        if (motivo) {
          toast.error(motivo)
          continue
        }
        setSubiendo((s) => [...s, f.name])
        try {
          const formulario = new FormData()
          formulario.append('fichero', f)
          const r = await pedir<{ adjunto: AdjuntoTC; total: number }>(`${BASE}/tareas/${tareaId}/adjuntos`, { metodo: 'POST', formulario })
          onTotal(r.total)
          await cargar()
        } catch (e) {
          toast.error(e instanceof Error ? e.message : `No se ha podido subir ${f.name}`)
        } finally {
          setSubiendo((s) => s.filter((x) => x !== f.name))
        }
      }
    },
    [tareaId, onTotal, cargar]
  )

  const borrar = async (a: AdjuntoTC) => {
    if (!window.confirm(`¿Borrar «${a.nombre}»? No se puede recuperar.`)) return
    setLista((l) => (l ?? []).filter((x) => x.id !== a.id))
    try {
      const r = await pedir<{ total: number }>(`${BASE}/tareas/${tareaId}/adjuntos/${a.id}`, { metodo: 'DELETE' })
      onTotal(r.total)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
      void cargar()
    }
  }

  return (
    <section
      aria-label="Archivos"
      className="tc-adjuntos mt-5"
      data-encima={encima ? 'true' : undefined}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault()
          setEncima(true)
        }
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setEncima(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return
        e.preventDefault()
        setEncima(false)
        void subir([...e.dataTransfer.files])
      }}
    >
      <h3 className="tc-seccion-titulo"><Paperclip className="h-3.5 w-3.5" /> Archivos <span className="tc-contador">{lista?.length ?? 0}</span></h3>
      {!disponible && <p className="mb-2 text-[12px] text-[var(--ls-e-ambar)]">Falta lanzar la migración 278 en Supabase para adjuntar archivos.</p>}
      <ul className="flex flex-col gap-1">
        {(lista ?? []).map((a) => {
          const Icono = ICONO[claseDeAdjunto(a.nombre)]
          return (
            <li key={a.id} className="tc-adjunto group/a">
              <Icono className="h-4 w-4 flex-shrink-0 text-[var(--ls-t3)]" />
              {a.url ? <a href={a.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-[13px] text-[var(--ls-t1)] hover:underline">{a.nombre}</a> : <span className="min-w-0 flex-1 truncate text-[13px]">{a.nombre}</span>}
              <span className="flex-shrink-0 text-[11px] tabular-nums text-[var(--ls-t4)]">{formatoDeTamano(a.tamano)} · {a.subido_nombre.split(' ')[0] || 'Alguien'} · {fechaCorta(a.creado_en)}</span>
              <button type="button" onClick={() => void borrar(a)} aria-label={`Borrar ${a.nombre}`} className="tc-icono-boton opacity-0 group-hover/a:opacity-100 focus-visible:opacity-100"><Trash2 className="h-3 w-3" /></button>
            </li>
          )
        })}
        {subiendo.map((n) => <li key={`s-${n}`} className="tc-adjunto"><Loader2 className="h-4 w-4 animate-spin text-[var(--ls-t3)]" /><span className="min-w-0 flex-1 truncate text-[13px] text-[var(--ls-t3)]">Subiendo {n}…</span></li>)}
      </ul>
      {disponible && (
        <>
          <button type="button" onClick={() => entrada.current?.click()} className="tc-adjuntos-zona"><Upload className="h-3.5 w-3.5" /> Suelta archivos aquí o <u>elígelos</u> · hasta 25 MB</button>
          <input ref={entrada} type="file" multiple hidden onChange={(e) => { void subir([...(e.target.files ?? [])]); e.target.value = '' }} />
        </>
      )}
    </section>
  )
}
