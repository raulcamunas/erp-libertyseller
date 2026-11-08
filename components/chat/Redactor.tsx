'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { CalendarClock, CornerUpLeft, FileText, Loader2, Paperclip, SendHorizonal, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { pedir } from '@/components/tareas-clientes/api'
import { esImagen, formatoDeTamano, MAX_ARCHIVOS_POR_MENSAJE } from '@/lib/chat/archivos'
import { desdeTextoEditable, type Mencionado } from '@/lib/chat/mensajes'
import { describirInstante } from '@/lib/chat/tiempo'
import type { AdjuntoChat, PersonaChat } from '@/lib/chat/tipos'
import { ElegirHora } from './Paneles'

const SIN_ACENTOS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ESCRIBIENDO_CADA_MS = 2_500

/** Lo que hay entre la última «@» y el cursor, si estás escribiendo una mención */
function mencionEnCurso(texto: string, cursor: number): { desde: number; consulta: string } | null {
  const antes = texto.slice(0, cursor)
  const m = /(^|\s)@([^\s@]{0,30})$/u.exec(antes)
  return m ? { desde: antes.length - m[2].length - 1, consulta: m[2] } : null
}

interface Subido {
  id: string
  nombre: string
  tipo: string
  tamano: number
  estado: 'subiendo' | 'listo' | 'error'
  adjunto?: AdjuntoChat
  /** La miniatura de una imagen, mientras se sube */
  vista?: string
  error?: string
}

interface Props {
  /** A quién se puede mencionar aquí (en un privado, solo a quien está dentro) */
  candidatos: readonly PersonaChat[]
  placeholder: string
  borradorInicial?: string
  alCambiarBorrador?: (texto: string) => void
  alEscribir?: () => void
  /** Envía el texto con las menciones ya como identificadores. Si falla, lanza el error y el texto se queda */
  alEnviar: (cuerpo: string, adjuntos: AdjuntoChat[]) => Promise<void>
  /** Si se da, sale el reloj para dejar el mensaje programado a una hora */
  alProgramar?: (cuerpo: string, adjuntos: AdjuntoChat[], enviarEn: string) => Promise<void>
  autoEnfocar?: boolean
  compacto?: boolean
  /** El mensaje al que se está respondiendo (se envía citado) */
  cita?: { autor: string; texto: string } | null
  alQuitarCita?: () => void
  /** Archivos que se han soltado encima de la zona del chat: cada vez que cambia `n`, se suben */
  ficherosSoltados?: { n: number; ficheros: File[] } | null
}

export function Redactor({ candidatos, placeholder, borradorInicial = '', alCambiarBorrador, alEscribir, alEnviar, alProgramar, autoEnfocar, compacto, cita, alQuitarCita, ficherosSoltados }: Props) {
  const [texto, setTexto] = useState(borradorInicial)
  const [enviando, setEnviando] = useState(false)
  const [cursor, setCursor] = useState(borradorInicial.length)
  const [elegida, setElegida] = useState(0)
  const [cerrada, setCerrada] = useState(false)
  const [archivos, setArchivos] = useState<Subido[]>([])
  const [programando, setProgramando] = useState(false)
  const mencionados = useRef<Mencionado[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const selectorDeArchivos = useRef<HTMLInputElement>(null)
  const ultimoAviso = useRef(0)
  const vistasCreadas = useRef<string[]>([])

  const mencion = cerrada ? null : mencionEnCurso(texto, cursor)
  const sugeridos = useMemo(() => {
    if (!mencion) return []
    const q = SIN_ACENTOS(mencion.consulta)
    return candidatos.filter((p) => SIN_ACENTOS(p.nombre).split(/\s+/).some((palabra) => palabra.startsWith(q)) || SIN_ACENTOS(p.nombre).startsWith(q)).slice(0, 6)
  }, [mencion, candidatos])

  const subiendo = archivos.some((a) => a.estado === 'subiendo')
  const listos = archivos.filter((a) => a.estado === 'listo' && a.adjunto).map((a) => a.adjunto as AdjuntoChat)
  const hayAlgo = texto.trim().length > 0 || listos.length > 0

  // La caja crece con el texto, hasta un tope
  useEffect(() => {
    const a = area.current
    if (!a) return
    a.style.height = 'auto'
    a.style.height = `${Math.min(a.scrollHeight, 180)}px`
  }, [texto])

  useEffect(() => {
    if (autoEnfocar) area.current?.focus()
  }, [autoEnfocar])
  // Al pulsar «responder» el cursor salta a la caja
  useEffect(() => {
    if (cita) area.current?.focus()
  }, [cita])
  // Las miniaturas son direcciones locales: se sueltan al irse
  useEffect(
    () => () => {
      for (const v of vistasCreadas.current) URL.revokeObjectURL(v)
    },
    []
  )

  const cambiar = (valor: string, posicion: number) => {
    setTexto(valor)
    setCursor(posicion)
    setElegida(0)
    setCerrada(false)
    alCambiarBorrador?.(valor)
    const ahora = Date.now()
    if (valor.trim() && alEscribir && ahora - ultimoAviso.current > ESCRIBIENDO_CADA_MS) {
      ultimoAviso.current = ahora
      alEscribir()
    }
  }

  const elegirMencion = useCallback(
    (p: PersonaChat) => {
      if (!mencion) return
      const antes = texto.slice(0, mencion.desde)
      const despues = texto.slice(cursor)
      const nuevo = `${antes}@${p.nombre} ${despues}`
      if (!mencionados.current.some((m) => m.id === p.id)) mencionados.current.push({ id: p.id, nombre: p.nombre })
      const pos = antes.length + p.nombre.length + 2
      setTexto(nuevo)
      setCursor(pos)
      alCambiarBorrador?.(nuevo)
      requestAnimationFrame(() => {
        area.current?.focus()
        area.current?.setSelectionRange(pos, pos)
      })
    },
    [mencion, texto, cursor, alCambiarBorrador]
  )

  /* ---------------- Archivos ---------------- */

  const subir = useCallback(
    async (ficheros: File[]) => {
      const sitio = MAX_ARCHIVOS_POR_MENSAJE - archivos.length
      if (ficheros.length > sitio) toast.error(`Un mensaje admite hasta ${MAX_ARCHIVOS_POR_MENSAJE} archivos.`)
      for (const f of ficheros.slice(0, Math.max(0, sitio))) {
        const id = crypto.randomUUID()
        const vista = esImagen(f.type, f.name) ? URL.createObjectURL(f) : undefined
        if (vista) vistasCreadas.current.push(vista)
        setArchivos((l) => [...l, { id, nombre: f.name, tipo: f.type, tamano: f.size, estado: 'subiendo', vista }])
        try {
          const formulario = new FormData()
          formulario.append('fichero', f)
          const a = await pedir<AdjuntoChat>('/api/chat/subir', { metodo: 'POST', formulario })
          setArchivos((l) => l.map((x) => (x.id === id ? { ...x, estado: 'listo', adjunto: { nombre: a.nombre, ruta: a.ruta, url: '', tipo: a.tipo, tamano: a.tamano } } : x)))
        } catch (e) {
          setArchivos((l) => l.map((x) => (x.id === id ? { ...x, estado: 'error', error: e instanceof Error ? e.message : 'No se ha podido subir' } : x)))
        }
      }
    },
    [archivos.length]
  )

  const alPegar = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const ficheros = [...(e.clipboardData?.files ?? [])]
    if (ficheros.length === 0) return
    e.preventDefault()
    // Una captura pegada se llama «image.png»: se le pone nombre con la hora
    const con = ficheros.map((f, i) => (/^image\.(png|jpe?g|gif|webp)$/i.test(f.name) ? new File([f], `captura-${new Date().toISOString().slice(11, 19).replace(/:/g, '')}${ficheros.length > 1 ? `-${i + 1}` : ''}.${f.name.split('.').pop()}`, { type: f.type }) : f))
    void subir(con)
  }
  // Lo que se suelta encima del canal (o del hilo) llega por aquí
  const ultimoSoltado = useRef(0)
  useEffect(() => {
    if (!ficherosSoltados || ficherosSoltados.n === ultimoSoltado.current) return
    ultimoSoltado.current = ficherosSoltados.n
    void subir(ficherosSoltados.ficheros)
  }, [ficherosSoltados, subir])

  /* ---------------- Enviar y programar ---------------- */

  const limpiar = () => {
    setTexto('')
    setCursor(0)
    setArchivos([])
    mencionados.current = []
    alCambiarBorrador?.('')
  }

  const enviar = async () => {
    const cuerpo = desdeTextoEditable(texto, mencionados.current).trim()
    if ((!cuerpo && listos.length === 0) || enviando || subiendo) return
    setEnviando(true)
    try {
      await alEnviar(cuerpo, listos)
      limpiar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    } finally {
      setEnviando(false)
      requestAnimationFrame(() => area.current?.focus())
    }
  }

  const programar = async (enviarEn: string) => {
    const cuerpo = desdeTextoEditable(texto, mencionados.current).trim()
    if (!alProgramar || (!cuerpo && listos.length === 0)) return
    await alProgramar(cuerpo, listos, enviarEn)
    limpiar()
    toast.success(`Programado para ${describirInstante(Date.parse(enviarEn))}`)
  }

  const alTeclear = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (sugeridos.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setElegida((i) => (i + 1) % sugeridos.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setElegida((i) => (i - 1 + sugeridos.length) % sugeridos.length)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        elegirMencion(sugeridos[elegida])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setCerrada(true)
        return
      }
    }
    if (e.key === 'Escape' && cita) {
      e.preventDefault()
      alQuitarCita?.()
      return
    }
    // Enter envía; Mayús+Enter es un salto de línea. Mientras se compone un acento (IME) no se envía
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      void enviar()
    }
  }

  return (
    <div className="chat-redactor" data-compacto={compacto ? 'true' : undefined}>
      {sugeridos.length > 0 && (
        <ul className="chat-sugeridos" role="listbox" aria-label="Mencionar a">
          {sugeridos.map((p, i) => (
            <li key={p.id} role="option" aria-selected={i === elegida}>
              <button type="button" data-activa={i === elegida ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => elegirMencion(p)}>
                <Avatar id={p.id} nombre={p.nombre} tamano={22} />
                <span>{p.nombre}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {cita && (
        <div className="chat-cita-barra" role="status">
          <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
          <span className="chat-cita-barra-texto">Respondiendo a <b>{cita.autor}</b><em>{cita.texto}</em></span>
          <button type="button" className="chat-icono" onClick={alQuitarCita} aria-label="Quitar la cita"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {archivos.length > 0 && (
        <ul className="chat-subidas" aria-label="Archivos por enviar">
          {archivos.map((a) => (
            <li key={a.id} data-estado={a.estado} title={a.error}>
              {a.vista ? <img src={a.vista} alt="" /> : <span className="chat-subida-icono"><FileText className="h-4 w-4" /></span>}
              <span className="chat-subida-texto"><b>{a.nombre}</b><i>{a.estado === 'error' ? a.error : a.estado === 'subiendo' ? 'Subiendo…' : formatoDeTamano(a.tamano)}</i></span>
              {a.estado === 'subiendo' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              <button type="button" className="chat-icono" onClick={() => setArchivos((l) => l.filter((x) => x.id !== a.id))} aria-label={`Quitar ${a.nombre}`}><X className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-redactor-caja">
        <button type="button" className="chat-icono chat-clip" onClick={() => selectorDeArchivos.current?.click()} aria-label="Adjuntar un archivo" title="Adjuntar archivos (o pega una captura / arrástralos aquí)"><Paperclip className="h-4 w-4" /></button>
        <input ref={selectorDeArchivos} type="file" multiple hidden onChange={(e) => { void subir([...(e.target.files ?? [])]); e.target.value = '' }} />
        <textarea
          ref={area}
          value={texto}
          rows={1}
          maxLength={8000}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(e) => cambiar(e.target.value, e.target.selectionStart)}
          onSelect={(e) => setCursor((e.target as HTMLTextAreaElement).selectionStart)}
          onKeyDown={alTeclear}
          onPaste={alPegar}
        />
        {alProgramar && (
          <button type="button" className="chat-icono chat-reloj" onClick={() => setProgramando(true)} disabled={!hayAlgo || subiendo} aria-label="Programar el envío" title="Programar el envío a una hora"><CalendarClock className="h-4 w-4" /></button>
        )}
        <button type="button" className="chat-enviar" onClick={() => void enviar()} disabled={enviando || subiendo || !hayAlgo} aria-label="Enviar">
          {enviando || subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
      {!compacto && <p className="chat-ayuda">Enter envía · Mayús+Enter, salto de línea · @ para mencionar · pega capturas o arrastra archivos · **negrita** · _cursiva_ · `código`</p>}
      {programando && <ElegirHora titulo="Programar el envío" ayuda="El mensaje saldrá solo a esa hora, como si lo escribieras entonces." onElegir={programar} onCerrar={() => setProgramando(false)} />}
    </div>
  )
}
