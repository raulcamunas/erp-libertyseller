'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Loader2, SendHorizonal } from 'lucide-react'
import { toast } from 'sonner'
import { desdeTextoEditable, type Mencionado } from '@/lib/chat/mensajes'
import type { PersonaChat } from '@/lib/chat/tipos'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'

const SIN_ACENTOS = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ESCRIBIENDO_CADA_MS = 2_500

/** Lo que hay entre la última «@» y el cursor, si estás escribiendo una mención */
function mencionEnCurso(texto: string, cursor: number): { desde: number; consulta: string } | null {
  const antes = texto.slice(0, cursor)
  const m = /(^|\s)@([^\s@]{0,30})$/u.exec(antes)
  return m ? { desde: antes.length - m[2].length - 1, consulta: m[2] } : null
}

interface Props {
  /** A quién se puede mencionar aquí (en un privado, solo a quien está dentro) */
  candidatos: readonly PersonaChat[]
  placeholder: string
  borradorInicial?: string
  alCambiarBorrador?: (texto: string) => void
  alEscribir?: () => void
  /** Envía el texto con las menciones ya como identificadores. Si falla, lanza el error y el texto se queda */
  alEnviar: (cuerpo: string) => Promise<void>
  autoEnfocar?: boolean
  compacto?: boolean
}

export function Redactor({ candidatos, placeholder, borradorInicial = '', alCambiarBorrador, alEscribir, alEnviar, autoEnfocar, compacto }: Props) {
  const [texto, setTexto] = useState(borradorInicial)
  const [enviando, setEnviando] = useState(false)
  const [cursor, setCursor] = useState(borradorInicial.length)
  const [elegida, setElegida] = useState(0)
  const [cerrada, setCerrada] = useState(false)
  const mencionados = useRef<Mencionado[]>([])
  const area = useRef<HTMLTextAreaElement>(null)
  const ultimoAviso = useRef(0)

  const mencion = cerrada ? null : mencionEnCurso(texto, cursor)
  const sugeridos = useMemo(() => {
    if (!mencion) return []
    const q = SIN_ACENTOS(mencion.consulta)
    return candidatos.filter((p) => SIN_ACENTOS(p.nombre).split(/\s+/).some((palabra) => palabra.startsWith(q)) || SIN_ACENTOS(p.nombre).startsWith(q)).slice(0, 6)
  }, [mencion, candidatos])

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

  const enviar = async () => {
    const cuerpo = desdeTextoEditable(texto, mencionados.current).trim()
    if (!cuerpo || enviando) return
    setEnviando(true)
    try {
      await alEnviar(cuerpo)
      setTexto('')
      setCursor(0)
      mencionados.current = []
      alCambiarBorrador?.('')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    } finally {
      setEnviando(false)
      requestAnimationFrame(() => area.current?.focus())
    }
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
      <div className="chat-redactor-caja">
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
        />
        <button type="button" className="chat-enviar" onClick={() => void enviar()} disabled={enviando || !texto.trim()} aria-label="Enviar">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <SendHorizonal className="h-4 w-4" />}
        </button>
      </div>
      {!compacto && <p className="chat-ayuda">Enter envía · Mayús+Enter, salto de línea · @ para mencionar · **negrita** · _cursiva_ · `código`</p>}
    </div>
  )
}
