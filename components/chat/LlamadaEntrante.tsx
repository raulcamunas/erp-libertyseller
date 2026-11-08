'use client'

import { useEffect } from 'react'
import { Phone, PhoneOff } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'

const SUENA_MS = 40_000

/** El tono de llamada: dos pitidos cada dos segundos. Si el navegador no deja sonar (aún no se ha tocado nada), se queda en silencio y solo se ve el aviso */
function sonarLlamada(): () => void {
  let parar = false
  let ctx: AudioContext | null = null
  try {
    ctx = new AudioContext()
  } catch {
    return () => undefined
  }
  const pitido = (frecuencia: number, empieza: number) => {
    if (!ctx) return
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sine'
    o.frequency.value = frecuencia
    g.gain.setValueAtTime(0.0001, ctx.currentTime + empieza)
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + empieza + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + empieza + 0.32)
    o.connect(g).connect(ctx.destination)
    o.start(ctx.currentTime + empieza)
    o.stop(ctx.currentTime + empieza + 0.36)
  }
  const tanda = () => {
    if (parar || !ctx) return
    void ctx.resume().catch(() => undefined)
    pitido(740, 0)
    pitido(587, 0.4)
  }
  tanda()
  const t = setInterval(tanda, 2000)
  return () => {
    parar = true
    clearInterval(t)
    void ctx?.close().catch(() => undefined)
  }
}

/** «Daniella te llama»: solo en los directos, y solo si no estás ya en otra junta */
export function LlamadaEntrante() {
  const { llamadaEntrante, descartarLlamada, canales, nombreDe, seleccionar } = useChat()
  const { actual, entrar, disponible } = useJunta()
  const canal = llamadaEntrante ? canales.find((c) => c.id === llamadaEntrante.canalId) : null
  const visible = Boolean(llamadaEntrante && canal && canal.tipo === 'directo' && canal.soy_miembro && !canal.silenciado && !actual && disponible)

  useEffect(() => {
    if (!visible) return
    const parar = sonarLlamada()
    const apagar = setTimeout(descartarLlamada, SUENA_MS)
    return () => {
      parar()
      clearTimeout(apagar)
    }
  }, [visible, llamadaEntrante?.en, descartarLlamada])

  if (!visible || !llamadaEntrante) return null
  const nombre = nombreDe(llamadaEntrante.de)
  return (
    <div className="chat-llamada" role="alertdialog" aria-label={`${nombre} te llama`}>
      <Avatar id={llamadaEntrante.de} nombre={nombre} tamano={44} />
      <div className="min-w-0">
        <b>{nombre}</b>
        <span>te está llamando…</span>
      </div>
      <button type="button" className="chat-llamada-rechazar" onClick={descartarLlamada} aria-label="Ahora no" title="Ahora no"><PhoneOff className="h-4 w-4" /></button>
      <button
        type="button"
        className="chat-llamada-aceptar"
        onClick={() => {
          const canalId = llamadaEntrante.canalId
          descartarLlamada()
          seleccionar(canalId)
          void entrar(canalId)
        }}
        aria-label="Responder"
        title="Responder"
      >
        <Phone className="h-4 w-4" />
      </button>
    </div>
  )
}
