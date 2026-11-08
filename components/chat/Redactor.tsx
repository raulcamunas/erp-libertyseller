'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react'
import { BarChart3, CalendarClock, Check, CornerUpLeft, FileText, Loader2, Mic, Paperclip, SendHorizonal, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { pedir } from '@/components/tareas-clientes/api'
import { esImagen, formatoDeTamano, MAX_ARCHIVOS_POR_MENSAJE } from '@/lib/chat/archivos'
import { leerComando, sugerenciasDeComandos, type Comando } from '@/lib/chat/comandos'
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
  /** Mientras se graba una nota de voz, cada pocos segundos (para avisar al resto) */
  alGrabar?: () => void
  /** Al terminar o descartar la grabación */
  alPararDeGrabar?: () => void
  /** Envía el texto con las menciones ya como identificadores. Si falla, lanza el error y el texto se queda */
  alEnviar: (cuerpo: string, adjuntos: AdjuntoChat[]) => Promise<void>
  /** Si se da, sale el reloj para dejar el mensaje programado a una hora */
  alProgramar?: (cuerpo: string, adjuntos: AdjuntoChat[], enviarEn: string) => Promise<void>
  autoEnfocar?: boolean
  compacto?: boolean
  /** El mensaje al que se está respondiendo (se envía citado) */
  cita?: { autor: string; texto: string } | null
  alQuitarCita?: () => void
  /** Soy administrador (para ofrecer «/erp») */
  esAdmin?: boolean
  /** Hace lo que pide un comando con «/». Si lanza un error, el texto se queda */
  alComando?: (c: Comando) => Promise<void> | void
  /** Se puede escribir @todos (un canal con más gente) */
  permitirTodos?: boolean
  /** Si se da, sale el botón de la encuesta */
  alEncuesta?: () => void
  /** Archivos que se han soltado encima de la zona del chat: cada vez que cambia `n`, se suben */
  ficherosSoltados?: { n: number; ficheros: File[] } | null
}

export function Redactor({ candidatos, placeholder, borradorInicial = '', alCambiarBorrador, alEscribir, alGrabar, alPararDeGrabar, alEnviar, alProgramar, autoEnfocar, compacto, cita, alQuitarCita, ficherosSoltados, esAdmin = false, alComando, permitirTodos = false, alEncuesta }: Props) {
  const [texto, setTexto] = useState(borradorInicial)
  const [enviando, setEnviando] = useState(false)
  const [cursor, setCursor] = useState(borradorInicial.length)
  const [elegida, setElegida] = useState(0)
  const [cerrada, setCerrada] = useState(false)
  const [archivos, setArchivos] = useState<Subido[]>([])
  const [programando, setProgramando] = useState(false)
  const [indiceDeComando, setIndiceDeComando] = useState(0)
  const [grabando, setGrabando] = useState<{ segundos: number } | null>(null)
  const [enviandoVoz, setEnviandoVoz] = useState(false)
  const grabadora = useRef<{ mr: MediaRecorder; trozos: Blob[]; inicio: number; flujo: MediaStream; mime: string; ext: string; descartar: boolean } | null>(null)
  const puedeGrabar = typeof window !== 'undefined' && typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia)
  const mencionados = useRef<Mencionado[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const selectorDeArchivos = useRef<HTMLInputElement>(null)
  const ultimoAviso = useRef(0)
  const vistasCreadas = useRef<string[]>([])

  const mencion = cerrada ? null : mencionEnCurso(texto, cursor)
  const sugeridos = useMemo(() => {
    if (!mencion) return []
    const q = SIN_ACENTOS(mencion.consulta)
    const gente = candidatos.filter((p) => SIN_ACENTOS(p.nombre).split(/\s+/).some((palabra) => palabra.startsWith(q)) || SIN_ACENTOS(p.nombre).startsWith(q)).slice(0, 6)
    // «@todos» avisa a todo el canal
    return permitirTodos && 'todos'.startsWith(q) ? [{ id: 'todos', nombre: 'todos', email: null }, ...gente].slice(0, 7) : gente
  }, [mencion, candidatos, permitirTodos])
  const comandos = useMemo(() => sugerenciasDeComandos(texto, esAdmin), [texto, esAdmin])

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

  /* ---------------- Notas de voz ---------------- */

  const empezarAGrabar = async () => {
    try {
      const flujo = await navigator.mediaDevices.getUserMedia({ audio: true })
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm' : MediaRecorder.isTypeSupported('audio/mp4') ? 'audio/mp4' : ''
      const mr = new MediaRecorder(flujo, mime ? { mimeType: mime === 'audio/webm' ? 'audio/webm;codecs=opus' : mime } : undefined)
      const g = { mr, trozos: [] as Blob[], inicio: Date.now(), flujo, mime: mime || 'audio/webm', ext: mime === 'audio/mp4' ? 'm4a' : 'webm', descartar: false }
      mr.ondataavailable = (e) => e.data.size > 0 && g.trozos.push(e.data)
      mr.onstop = () => {
        for (const pista of flujo.getTracks()) pista.stop()
        const segundos = (Date.now() - g.inicio) / 1000
        grabadora.current = null
        setGrabando(null)
        if (g.descartar || segundos < 0.8) return
        void enviarVoz(new Blob(g.trozos, { type: g.mime }), segundos, g.ext, g.mime)
      }
      mr.start(250)
      grabadora.current = g
      setGrabando({ segundos: 0 })
    } catch {
      toast.error('No se ha podido usar el micrófono: mira el permiso del navegador.')
    }
  }
  const pararDeGrabar = (descartar: boolean) => {
    const g = grabadora.current
    if (!g) return
    g.descartar = descartar
    if (g.mr.state !== 'inactive') g.mr.stop()
  }
  // El contador, y el corte a los 5 minutos
  useEffect(() => {
    if (!grabando) return
    alGrabar?.()
    const aviso = alGrabar ? setInterval(alGrabar, 2_500) : null
    const t = setInterval(() => {
      const g = grabadora.current
      if (!g) return
      const s = Math.floor((Date.now() - g.inicio) / 1000)
      setGrabando({ segundos: s })
      if (s >= 300) pararDeGrabar(false)
    }, 500)
    return () => {
      clearInterval(t)
      if (aviso) clearInterval(aviso)
      alPararDeGrabar?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grabando !== null])
  useEffect(() => () => pararDeGrabar(true), [])  // eslint-disable-line react-hooks/exhaustive-deps

  const enviarVoz = async (blob: Blob, segundos: number, ext: string, tipo: string) => {
    setEnviandoVoz(true)
    try {
      const formulario = new FormData()
      formulario.append('fichero', new File([blob], `nota-de-voz.${ext}`, { type: tipo }))
      const a = await pedir<AdjuntoChat>('/api/chat/subir', { metodo: 'POST', formulario })
      await alEnviar('', [{ nombre: a.nombre, ruta: a.ruta, url: '', tipo, tamano: a.tamano, voz: true, duracion: Math.round(segundos) }])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar la nota de voz')
    } finally {
      setEnviandoVoz(false)
    }
  }

  /* ---------------- Enviar y programar ---------------- */

  const limpiar = () => {
    setTexto('')
    setCursor(0)
    setArchivos([])
    mencionados.current = []
    alCambiarBorrador?.('')
  }

  const enviar = async () => {
    // Un comando con «/» hace lo suyo en vez de enviarse
    const comando = alComando ? leerComando(texto, esAdmin) : null
    if (comando && alComando) {
      setEnviando(true)
      try {
        await alComando(comando)
        limpiar()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido hacer')
      } finally {
        setEnviando(false)
        requestAnimationFrame(() => area.current?.focus())
      }
      return
    }
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
    if (comandos.length > 0) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        setIndiceDeComando((i) => (i + (e.key === 'ArrowDown' ? 1 : comandos.length - 1)) % comandos.length)
        return
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey && texto.trim() !== `/${comandos[Math.min(indiceDeComando, comandos.length - 1)].nombre}`)) {
        e.preventDefault()
        const c = comandos[Math.min(indiceDeComando, comandos.length - 1)]
        cambiar(`/${c.nombre} `, c.nombre.length + 2)
        return
      }
    }
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
      {comandos.length > 0 && (
        <ul className="chat-sugeridos chat-comandos" role="listbox" aria-label="Comandos">
          {comandos.map((c, i) => (
            <li key={c.nombre} role="option" aria-selected={i === indiceDeComando}>
              <button type="button" data-activa={i === indiceDeComando ? 'true' : undefined} onMouseDown={(e) => e.preventDefault()} onClick={() => cambiar(`/${c.nombre} `, c.nombre.length + 2)}>
                <b>/{c.nombre}</b>
                <span>{c.descripcion}</span>
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
      {grabando || enviandoVoz ? (
        <div className="chat-redactor-caja chat-grabando" role="status">
          <span className="chat-grabando-punto" />
          <b>{enviandoVoz ? 'Enviando…' : `${Math.floor(grabando!.segundos / 60)}:${String(grabando!.segundos % 60).padStart(2, '0')}`}</b>
          <span className="chat-grabando-texto">{enviandoVoz ? '' : 'Grabando nota de voz…'}</span>
          {!enviandoVoz && <button type="button" className="chat-icono" onClick={() => pararDeGrabar(true)} aria-label="Descartar la grabación" title="Descartar"><Trash2 className="h-4 w-4" /></button>}
          {!enviandoVoz && <button type="button" className="chat-enviar" onClick={() => pararDeGrabar(false)} aria-label="Enviar la nota de voz"><Check className="h-4 w-4" /></button>}
          {enviandoVoz && <Loader2 className="h-4 w-4 animate-spin" />}
        </div>
      ) : (
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
        {alEncuesta && (
          <button type="button" className="chat-icono chat-reloj" onClick={alEncuesta} aria-label="Crear una encuesta" title="Crear una encuesta"><BarChart3 className="h-4 w-4" /></button>
        )}
        {puedeGrabar && !hayAlgo && (
          <button type="button" className="chat-icono chat-reloj" onClick={() => void empezarAGrabar()} aria-label="Grabar una nota de voz" title="Grabar una nota de voz"><Mic className="h-4 w-4" /></button>
        )}
        {alProgramar && (
          <button type="button" className="chat-icono chat-reloj" onClick={() => setProgramando(true)} disabled={!hayAlgo || subiendo} aria-label="Programar el envío" title="Programar el envío a una hora"><CalendarClock className="h-4 w-4" /></button>
        )}
        <button type="button" className="chat-enviar" onClick={() => void enviar()} disabled={enviando || subiendo || !hayAlgo} aria-label="Enviar">
          {enviando || subiendo ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
      )}
      {!compacto && <p className="chat-ayuda">Enter envía · Mayús+Enter, salto de línea · @ para mencionar · / para comandos · pega capturas o arrastra archivos · **negrita** · _cursiva_ · `código`</p>}
      {programando && <ElegirHora titulo="Programar el envío" ayuda="El mensaje saldrá solo a esa hora, como si lo escribieras entonces." onElegir={programar} onCerrar={() => setProgramando(false)} />}
    </div>
  )
}
