'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { AlertCircle, Archive, CalendarDays, CheckCircle2, ChevronDown, CircleDot, CloudOff, ExternalLink, Eye, EyeOff, Gauge, History, Link2, Loader2, MessageSquare, Palette, Send, Tag, Trash2, UserCircle2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/rendimiento/ui'
import { huellaDeContenido, type Bloque } from '@/lib/tareas-clientes/bloques'
import { mencionesEnTexto } from '@/lib/tareas-clientes/avisos'
import { departamentosDe, estadosDe, type ActividadTC, type ClienteTC, type ComentarioTC, type PersonaTC } from '@/lib/tareas-clientes/tipos'
import type { TareaLigera } from '@/lib/tareas-clientes/servidor'
import { BASE, pedir, type DatosDeTarea } from './api'
import { Editor } from './Editor'
import { SelectorDePortada, estiloDePortada } from './Portada'
import { Etiqueta, fechaCorta, SelectorDeColor, SelectorDeEmoji, SelectorDeOpcion, SelectorDePersonas } from './ui'

/**
 * EL PANEL DE UNA TAREA: lo que se abre a la derecha al pulsar una tarjeta o una fila.
 *
 * Arriba, su portada, su emoji y su título; debajo, las propiedades (estado, departamento, responsables, fechas, progreso…) que se cambian con un clic y se guardan al
 * instante; luego el cuerpo (el editor de bloques, que se guarda solo mientras se escribe) y, al final, los comentarios con menciones y el historial.
 *
 * Mientras está abierto se vuelve a preguntar cada 20 segundos: si un compañero o Notion cambió algo y aquí no hay nada sin guardar, se actualiza solo.
 */

const AUTOGUARDADO_MS = 900
const RELEER_CADA_MS = 20_000

export interface PropsDelPanel {
  tareaId: string
  inicial: TareaLigera | null
  cliente: ClienteTC | null
  personas: readonly PersonaTC[]
  miId: string
  esAdmin: boolean
  onCerrar: () => void
  onCambio: (t: TareaLigera) => void
  onArchivada: (id: string) => void
}

type Guardado = 'ok' | 'guardando' | 'error'

const tiempoRelativo = (iso: string): string => {
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000)
  if (s < 45) return 'ahora'
  if (s < 3600) return `hace ${Math.round(s / 60)} min`
  if (s < 86_400) return `hace ${Math.round(s / 3600)} h`
  if (s < 7 * 86_400) return `hace ${Math.round(s / 86_400)} d`
  return fechaCorta(iso)
}

function Propiedad({ icono, nombre, children }: { icono: ReactNode; nombre: string; children: ReactNode }) {
  return (
    <div className="tc-prop">
      <span className="tc-prop-nombre">{icono}{nombre}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

export function PanelDeTarea({ tareaId, inicial, cliente, personas, miId, esAdmin, onCerrar, onCambio, onArchivada }: PropsDelPanel) {
  const [datos, setDatos] = useState<DatosDeTarea | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [contenido, setContenido] = useState<Bloque[]>([])
  const [guardado, setGuardado] = useState<Guardado>('ok')
  const [titulo, setTitulo] = useState(inicial?.titulo ?? '')
  const [verActividad, setVerActividad] = useState(false)
  const sinGuardar = useRef(false)
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idActual = useRef(tareaId)
  const contenidoRef = useRef<Bloque[]>([])
  const tituloEditado = useRef(false)

  const estados = estadosDe(cliente)
  const departamentos = departamentosDe(cliente)
  const tarea = datos?.tarea ?? null

  /* ---- Cargar y mantener al día ---- */
  const cargar = useCallback(
    async (silencioso: boolean) => {
      try {
        const d = await pedir<DatosDeTarea>(`${BASE}/tareas/${tareaId}`)
        if (idActual.current !== tareaId) return
        setError(null)
        setDatos((previo) => {
          // Un compañero o Notion cambió el cuerpo y aquí no hay nada sin guardar: se actualiza; si no, gana lo que se está escribiendo
          if (!sinGuardar.current && (!previo || huellaDeContenido((d.tarea.contenido ?? []) as Bloque[]) !== huellaDeContenido(contenidoRef.current))) {
            const c = (d.tarea.contenido ?? []) as Bloque[]
            contenidoRef.current = c
            setContenido(c)
          }
          if (!tituloEditado.current) setTitulo(d.tarea.titulo)
          return { ...d, tarea: sinGuardar.current && previo ? { ...d.tarea, contenido: previo.tarea.contenido } : d.tarea }
        })
      } catch (e) {
        if (!silencioso) setError(e instanceof Error ? e.message : 'No se ha podido abrir la tarea')
      }
    },
    [tareaId]
  )

  useEffect(() => {
    idActual.current = tareaId
    setDatos(null)
    setContenido([])
    contenidoRef.current = []
    setTitulo(inicial?.titulo ?? '')
    sinGuardar.current = false
    tituloEditado.current = false
    setGuardado('ok')
    void cargar(false)
    const t = setInterval(() => void cargar(true), RELEER_CADA_MS)
    return () => clearInterval(t)
    // `inicial` solo sirve para pintar el título mientras llega lo demás
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tareaId, cargar])

  /* ---- Guardar ---- */
  const guardar = useCallback(
    async (cambios: Record<string, unknown>): Promise<TareaLigera | null> => {
      setGuardado('guardando')
      try {
        const { tarea: nueva } = await pedir<{ tarea: TareaLigera }>(`${BASE}/tareas/${tareaId}`, { metodo: 'PATCH', cuerpo: cambios })
        setDatos((d) => (d && d.tarea.id === nueva.id ? { ...d, tarea: { ...d.tarea, ...nueva, contenido: 'contenido' in cambios ? (cambios.contenido as Bloque[]) : d.tarea.contenido } } : d))
        onCambio(nueva)
        setGuardado('ok')
        return nueva
      } catch (e) {
        setGuardado('error')
        toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
        return null
      }
    },
    [tareaId, onCambio]
  )

  const guardarCuerpo = useCallback(async () => {
    if (temporizador.current) clearTimeout(temporizador.current)
    temporizador.current = null
    if (!sinGuardar.current) return
    const enviado = contenidoRef.current
    const nueva = await guardar({ contenido: enviado })
    // Si mientras tanto se siguió escribiendo, queda pendiente otra vez
    if (nueva && contenidoRef.current === enviado) sinGuardar.current = false
  }, [guardar])

  const alEscribir = useCallback(
    (nuevo: Bloque[]) => {
      contenidoRef.current = nuevo
      setContenido(nuevo)
      sinGuardar.current = true
      setGuardado('guardando')
      if (temporizador.current) clearTimeout(temporizador.current)
      temporizador.current = setTimeout(() => void guardarCuerpo(), AUTOGUARDADO_MS)
    },
    [guardarCuerpo]
  )

  // Al cerrar o cambiar de tarea no se pierde lo último que se escribió
  useEffect(
    () => () => {
      if (temporizador.current && sinGuardar.current) {
        clearTimeout(temporizador.current)
        void fetch(`${BASE}/tareas/${idActual.current}`, { method: 'PATCH', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contenido: contenidoRef.current }) })
      }
    },
    [tareaId]
  )

  const cambiarTitulo = async () => {
    tituloEditado.current = false
    const limpio = titulo.trim()
    if (tarea && limpio !== tarea.titulo) await guardar({ titulo: limpio })
  }

  /* ---- Comentarios ---- */
  const [escrito, setEscrito] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [sugerir, setSugerir] = useState<string | null>(null)
  const caja = useRef<HTMLTextAreaElement>(null)

  const enviar = async () => {
    const cuerpo = escrito.trim()
    if (!cuerpo || enviando) return
    setEnviando(true)
    try {
      const { comentario } = await pedir<{ comentario: ComentarioTC }>(`${BASE}/tareas/${tareaId}/comentarios`, { metodo: 'POST', cuerpo: { cuerpo } })
      setDatos((d) => (d ? { ...d, comentarios: [...d.comentarios, comentario], tarea: { ...d.tarea, comentarios: d.tarea.comentarios + 1 } } : d))
      if (tarea) onCambio({ ...(tarea as TareaLigera), comentarios: tarea.comentarios + 1 })
      setEscrito('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar el comentario')
    } finally {
      setEnviando(false)
    }
  }

  const borrarComentario = async (id: string) => {
    try {
      await pedir(`${BASE}/comentarios/${id}`, { metodo: 'DELETE' })
      setDatos((d) => (d ? { ...d, comentarios: d.comentarios.filter((c) => c.id !== id), tarea: { ...d.tarea, comentarios: Math.max(0, d.tarea.comentarios - 1) } } : d))
      if (tarea) onCambio({ ...(tarea as TareaLigera), comentarios: Math.max(0, tarea.comentarios - 1) })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar el comentario')
    }
  }

  const alEscribirComentario = (valor: string) => {
    setEscrito(valor)
    const m = /(?:^|\s)@([\p{L}\p{N}]*)$/u.exec(valor.slice(0, caja.current?.selectionStart ?? valor.length))
    setSugerir(m ? m[1].toLowerCase() : null)
  }
  const candidatos = sugerir === null ? [] : personas.filter((p) => p.nombre.toLowerCase().startsWith(sugerir) || p.nombre.toLowerCase().split(' ').some((x) => x.startsWith(sugerir))).slice(0, 5)
  const mencionar = (p: PersonaTC) => {
    const el = caja.current
    const hasta = escrito.slice(0, el?.selectionStart ?? escrito.length)
    const nuevo = hasta.replace(/@([\p{L}\p{N}]*)$/u, `@${p.nombre} `) + escrito.slice(el?.selectionStart ?? escrito.length)
    setEscrito(nuevo)
    setSugerir(null)
    requestAnimationFrame(() => el?.focus())
  }

  const personaDe = (id: string | null) => personas.find((p) => p.id === id)
  const comentarios = datos?.comentarios ?? []
  const actividad = datos?.actividad ?? []
  const conNotion = Boolean(cliente?.notion_ds_id)

  const textoDeActividad = (a: ActividadTC): string => {
    const d = a.datos as Record<string, unknown>
    const nombres = (ids: unknown) => (Array.isArray(ids) ? ids.map((i) => personaDe(i as string)?.nombre ?? 'alguien').join(', ') : '')
    switch (a.tipo) {
      case 'creada': return 'creó la tarea'
      case 'movida': return `la movió de «${String(d.de)}» a «${String(d.a)}»`
      case 'asignada': return [nombres(d.anadidos) && `asignó a ${nombres(d.anadidos)}`, nombres(d.quitados) && `quitó a ${nombres(d.quitados)}`].filter(Boolean).join(' y ') || 'cambió los responsables'
      case 'comentario': return 'comentó'
      case 'archivada': return 'la archivó'
      case 'restaurada': return 'la recuperó'
      case 'editada': return `editó ${Array.isArray(d.campos) ? (d.campos as string[]).map((c) => ({ contenido: 'el cuerpo', titulo: 'el título', fecha_inicio: 'la fecha', fecha_fin: 'la fecha', departamento: 'el departamento', progreso: 'el progreso', url: 'el enlace', icono: 'el icono', color: 'el color', portada: 'la portada', visible_cliente: 'lo que ve el cliente', etiquetas: 'las etiquetas' })[c] ?? c).filter((x, i, l) => l.indexOf(x) === i).join(', ') : 'la tarea'}`
      default: return 'hizo un cambio'
    }
  }

  if (error && !datos) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <AlertCircle className="h-5 w-5 text-[var(--ls-e-rojo)]" />
        <p className="text-[13px] text-[var(--ls-t2)]">{error}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void cargar(false)} className="rounded-[6px] border border-[var(--ls-linea)] px-3 py-1.5 text-[12px] hover:bg-[var(--ls-sup3)]">Reintentar</button>
          <button type="button" onClick={onCerrar} className="rounded-[6px] px-3 py-1.5 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)]">Cerrar</button>
        </div>
      </div>
    )
  }

  const mostrada = tarea ?? inicial
  const cubierta = estiloDePortada(mostrada?.portada)

  return (
    <div className="tc-panel-interior" style={{ '--tono': `var(--tc-${tarea?.color ?? estados.find((e) => e.nombre === tarea?.estado)?.color ?? 'default'})` } as CSSProperties}>
      <div className="tc-panel-barra">
        <button type="button" onClick={() => { void guardarCuerpo(); onCerrar() }} aria-label="Cerrar la tarea" className="tc-icono-boton !h-7 !w-7"><X className="h-4 w-4" /></button>
        <span className="tc-chip-estado" aria-live="polite">
          {guardado === 'guardando' && <><Loader2 className="h-3 w-3 animate-spin" /> Guardando…</>}
          {guardado === 'ok' && <><CheckCircle2 className="h-3 w-3 text-[var(--ls-e-verde)]" /> Guardado</>}
          {guardado === 'error' && <><AlertCircle className="h-3 w-3 text-[var(--ls-e-rojo)]" /> Sin guardar</>}
        </span>
        {tarea && conNotion && (
          <span className="tc-chip-estado" title={tarea.sync_error ?? (tarea.sync_estado === 'ok' ? 'En Notion al día' : 'Pendiente de enviar a Notion')}>
            {tarea.sync_estado === 'error' ? <CloudOff className="h-3 w-3 text-[var(--ls-e-rojo)]" /> : tarea.sync_estado === 'pendiente' ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3 text-[var(--tc-blue)]" />}
            {tarea.sync_estado === 'ok' ? 'Notion al día' : tarea.sync_estado === 'pendiente' ? 'Enviando a Notion' : tarea.sync_estado === 'error' ? 'Error con Notion' : ''}
          </span>
        )}
        <span className="flex-1" />
        {tarea?.notion_url && (
          <a href={tarea.notion_url} target="_blank" rel="noreferrer" className="tc-boton-suave"><ExternalLink className="h-3 w-3" /> Abrir en Notion</a>
        )}
        {tarea && (
          <button type="button" onClick={async () => { if (window.confirm('¿Archivar esta tarea? No se borra: se puede recuperar.')) { await guardarCuerpo(); const r = await guardar({ archivada: true }); if (r) onArchivada(tareaId) } }} aria-label="Archivar la tarea" title="Archivar" className="tc-icono-boton !h-7 !w-7"><Archive className="h-3.5 w-3.5" /></button>
        )}
      </div>

      <div className="tc-panel-cuerpo">
        {cubierta && <div className="tc-panel-portada" style={cubierta} />}
        <div className="px-7 pb-10 pt-5">
          {tarea && (
            <div className="tc-migas">
              {cliente && <span className="tc-miga"><span className="text-[13px] leading-none">{cliente.icono ?? '•'}</span>{cliente.nombre}</span>}
              <Etiqueta color={estados.find((e) => e.nombre === tarea.estado)?.color ?? 'default'}>{tarea.estado}</Etiqueta>
            </div>
          )}
          <div className="-ml-1 flex items-start gap-1.5">
            {tarea && (
              <SelectorDeEmoji valor={tarea.icono} onElegir={(e) => void guardar({ icono: e })}>
                <button type="button" aria-label="Cambiar el emoji" className="tc-emoji-grande">{tarea.icono ?? <span className="text-[13px] text-[var(--ls-t4)]">😀</span>}</button>
              </SelectorDeEmoji>
            )}
            <textarea
              value={titulo}
              rows={1}
              onChange={(e) => { tituloEditado.current = true; setTitulo(e.target.value) }}
              onBlur={() => void cambiarTitulo()}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLTextAreaElement).blur() } }}
              placeholder="Sin título"
              aria-label="Título de la tarea"
              className="tc-titulo"
              style={{ height: 'auto' }}
              ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px` } }}
            />
          </div>
          {tarea && (
            <div className="mt-1 flex flex-wrap gap-1 text-[11.5px]">
              <SelectorDePortada valor={tarea.portada} titulo="Portada de la tarea" onElegir={(p) => void guardar({ portada: p })}>
                <button type="button" className="tc-boton-suave tc-discreto"><Palette className="h-3 w-3" /> {cubierta ? 'Cambiar portada' : 'Añadir portada'}</button>
              </SelectorDePortada>
            </div>
          )}

          {!tarea ? (
            <div className="mt-6 space-y-3" role="status" aria-label="Cargando la tarea"><div className="tc-esqueleto h-5 w-2/3" /><div className="tc-esqueleto h-5 w-1/2" /><div className="tc-esqueleto h-40 w-full" /></div>
          ) : (
            <>
              <div className="tc-props">
                <Propiedad icono={<CircleDot className="h-3.5 w-3.5" />} nombre="Estado"><SelectorDeOpcion etiqueta="Estado" valor={tarea.estado} opciones={estados} onElegir={(n) => n && void guardar({ estado: n })} /></Propiedad>
                <Propiedad icono={<Tag className="h-3.5 w-3.5" />} nombre="Departamento"><SelectorDeOpcion etiqueta="Departamento" valor={tarea.departamento} opciones={departamentos} permitirVacio onElegir={(n) => void guardar({ departamento: n })} /></Propiedad>
                <Propiedad icono={<UserCircle2 className="h-3.5 w-3.5" />} nombre="Responsables">
                  <SelectorDePersonas valor={tarea.responsables} personas={personas} onCambio={(ids) => void guardar({ responsables: ids })} />
                  {tarea.responsables_notion.length > 0 && <p className="px-2 text-[11px] text-[var(--ls-t4)]" title="Personas de Notion que todavía no están enlazadas con el equipo del ERP">En Notion también: {tarea.responsables_notion.map((r) => r.nombre || 'alguien').join(', ')}</p>}
                </Propiedad>
                <Propiedad icono={<CalendarDays className="h-3.5 w-3.5" />} nombre="Fecha">
                  <div className="flex flex-wrap items-center gap-1 px-1">
                    <input type="date" aria-label="Fecha de inicio" value={tarea.fecha_inicio?.slice(0, 10) ?? ''} onChange={(e) => void guardar({ fecha_inicio: e.target.value || null, ...(e.target.value ? {} : { fecha_fin: null }) })} className="tc-fecha" />
                    <span className="text-[11px] text-[var(--ls-t4)]">→</span>
                    <input type="date" aria-label="Fecha de fin" value={tarea.fecha_fin?.slice(0, 10) ?? ''} min={tarea.fecha_inicio?.slice(0, 10)} disabled={!tarea.fecha_inicio} onChange={(e) => void guardar({ fecha_fin: e.target.value || null })} className="tc-fecha" />
                  </div>
                </Propiedad>
                <Propiedad icono={<Gauge className="h-3.5 w-3.5" />} nombre="Progreso">
                  <div className="flex items-center gap-3 px-2">
                    <input type="range" min={0} max={100} step={5} aria-label="Progreso" defaultValue={tarea.progreso} key={`${tarea.id}-${tarea.progreso}`} style={{ '--p': `${tarea.progreso}%` } as CSSProperties} onInput={(e) => (e.target as HTMLInputElement).style.setProperty('--p', `${(e.target as HTMLInputElement).value}%`)} onMouseUp={(e) => void guardar({ progreso: Number((e.target as HTMLInputElement).value) })} onKeyUp={(e) => void guardar({ progreso: Number((e.target as HTMLInputElement).value) })} onTouchEnd={(e) => void guardar({ progreso: Number((e.target as HTMLInputElement).value) })} className="tc-rango" />
                    <span className="w-9 text-[12px] font-medium tabular-nums text-[var(--ls-t2)]">{tarea.progreso}%</span>
                  </div>
                </Propiedad>
                <Propiedad icono={<Link2 className="h-3.5 w-3.5" />} nombre="Enlace">
                  <input type="url" defaultValue={tarea.url ?? ''} key={`${tarea.id}-${tarea.url}`} placeholder="https://…" aria-label="Enlace" onBlur={(e) => { const v = e.target.value.trim(); if (v !== (tarea.url ?? '')) void guardar({ url: v || null }) }} className="tc-entrada" />
                </Propiedad>
                <Propiedad icono={<Palette className="h-3.5 w-3.5" />} nombre="Color"><SelectorDeColor valor={tarea.color} onElegir={(c) => void guardar({ color: c })} etiqueta="Color de la tarjeta" /></Propiedad>
                {esAdmin && (
                  <Propiedad icono={tarea.visible_cliente ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />} nombre="Ve el cliente">
                    <label className="flex cursor-pointer items-center gap-2 px-2 py-1 text-[12.5px] text-[var(--ls-t2)]">
                      <input type="checkbox" checked={tarea.visible_cliente} onChange={(e) => void guardar({ visible_cliente: e.target.checked })} className="tc-casilla" />
                      {tarea.visible_cliente ? 'Visible en su panel' : 'Solo interna'}
                    </label>
                  </Propiedad>
                )}
              </div>

              <div className="tc-separador" />
              <Editor bloques={contenido} onCambio={alEscribir} />

              <div className="tc-separador" />
              <section aria-label="Comentarios">
                <h3 className="tc-seccion-titulo"><MessageSquare className="h-3.5 w-3.5" /> Comentarios <span className="tc-contador">{comentarios.length}</span></h3>
                <ul className="flex flex-col gap-3.5">
                  {comentarios.map((c) => {
                    const menciones = c.menciones ?? []
                    const nombres = menciones.map((id) => personaDe(id)?.nombre).filter((n): n is string => Boolean(n))
                    const partes = nombres.length ? c.cuerpo.split(new RegExp(`(${nombres.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`, 'g')) : [c.cuerpo]
                    return (
                      <li key={c.id} className="tc-comentario group/c">
                        <Avatar id={c.autor_id ?? c.autor_nombre} nombre={c.autor_nombre || personaDe(c.autor_id)?.nombre || '?'} tamano={26} />
                        <div className="min-w-0 flex-1">
                          <p className="flex items-baseline gap-2 text-[12.5px]"><span className="font-medium text-[var(--ls-t1)]">{personaDe(c.autor_id)?.nombre ?? c.autor_nombre ?? 'Alguien'}</span><span className="text-[11px] text-[var(--ls-t4)]">{tiempoRelativo(c.creado_en)}{c.editado_en ? ' · editado' : ''}{c.origen === 'notion' ? ' · de Notion' : ''}</span></p>
                          <p className="tc-burbuja">{partes.map((p, i) => (p.startsWith('@') && nombres.includes(p.slice(1)) ? <span key={i} className="tc-mencion">{p}</span> : <span key={i}>{p}</span>))}</p>
                        </div>
                        {(c.autor_id === miId || esAdmin) && <button type="button" onClick={() => void borrarComentario(c.id)} aria-label="Borrar el comentario" className="tc-icono-boton opacity-0 group-hover/c:opacity-100 focus-visible:opacity-100"><Trash2 className="h-3 w-3" /></button>}
                      </li>
                    )
                  })}
                  {comentarios.length === 0 && <li className="tc-sin-comentarios">Todavía no hay comentarios. Usa «@» para avisar a alguien.</li>}
                </ul>

                <div className="relative mt-3 flex items-start gap-2">
                  <Avatar id={miId} nombre={personaDe(miId)?.nombre ?? 'Yo'} tamano={26} />
                  <div className="tc-compositor min-w-0 flex-1">
                    <textarea
                      ref={caja}
                      value={escrito}
                      rows={2}
                      onChange={(e) => alEscribirComentario(e.target.value)}
                      onKeyDown={(e) => {
                        if (sugerir !== null && candidatos.length > 0 && (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey))) { e.preventDefault(); mencionar(candidatos[0]); return }
                        if (e.key === 'Escape') setSugerir(null)
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void enviar() }
                      }}
                      placeholder="Escribe un comentario… (@ para mencionar, Enter para enviar)"
                      aria-label="Escribir un comentario"
                      className="tc-comentar"
                    />
                    {candidatos.length > 0 && (
                      <ul role="listbox" aria-label="Personas" className="tc-menciones">
                        {candidatos.map((p) => <li key={p.id}><button type="button" role="option" aria-selected="false" onMouseDown={(e) => { e.preventDefault(); mencionar(p) }} className="tc-opcion"><Avatar id={p.id} nombre={p.nombre} tamano={18} />{p.nombre}</button></li>)}
                      </ul>
                    )}
                    <div className="flex items-center justify-between px-2.5 pb-2">
                      <span className="text-[11px] text-[var(--ls-t4)]">{conNotion ? 'También se verá en Notion' : ''}{mencionesEnTexto(escrito, personas).length > 0 ? ` · Avisarás a ${mencionesEnTexto(escrito, personas).length}` : ''}</span>
                      <button type="button" disabled={!escrito.trim() || enviando} onClick={() => void enviar()} className="tc-enviar">{enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />} Comentar</button>
                    </div>
                  </div>
                </div>
              </section>

              <section className="mt-6" aria-label="Historial">
                <button type="button" onClick={() => setVerActividad((v) => !v)} aria-expanded={verActividad} className="tc-seccion-titulo !mb-0 cursor-pointer hover:text-[var(--ls-t1)]"><History className="h-3.5 w-3.5" /> Historial <span className="tc-contador">{actividad.length}</span><ChevronDown className={`h-3.5 w-3.5 transition-transform ${verActividad ? 'rotate-180' : ''}`} /></button>
                {verActividad && (
                  <ul className="mt-2 flex flex-col gap-1.5 border-l border-[var(--ls-linea)] pl-3">
                    {actividad.length === 0 && <li className="text-[12px] text-[var(--ls-t4)]">Sin movimientos todavía.</li>}
                    {actividad.map((a) => (
                      <li key={a.id} className="text-[12px] leading-[1.5] text-[var(--ls-t3)]"><span className="font-medium text-[var(--ls-t2)]">{a.actor_nombre || 'Alguien'}</span> {textoDeActividad(a)} <span className="text-[var(--ls-t4)]">· {tiempoRelativo(a.creado_en)}</span></li>
                    ))}
                  </ul>
                )}
              </section>
              <p className="mt-6 text-[11px] text-[var(--ls-t4)]">Creada {fechaCorta(tarea.creado_en)} · {tarea.origen === 'notion' ? 'viene de Notion' : 'creada en el ERP'}</p>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

