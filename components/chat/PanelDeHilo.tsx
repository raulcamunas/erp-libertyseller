'use client'

import { useEffect, useRef, useState } from 'react'
import type { CanalChat, MensajeChat } from '@/lib/chat/tipos'
import { X } from 'lucide-react'
import { useChat } from './ChatProvider'
import { MensajeVista } from './MensajeVista'
import { Redactor } from './Redactor'
import { AvisoDeSoltar, useZonaDeSoltar } from './ZonaDeSoltar'

/** Las respuestas de un mensaje, a la derecha: el mensaje de arriba, lo que se le ha contestado y una caja para contestar */
const SALIDA_MS = 260

export function PanelDeHilo() {
  const chat = useChat()
  const { cerrarHilo, enviar, avisarQueEscribo, personas, yo } = chat
  // Al cerrar, el panel se queda un momento con lo último que enseñaba para poder salir con animación
  const ultimo = useRef<{ hilo: NonNullable<typeof chat.hilo>; mensajes: MensajeChat[]; actual: CanalChat } | null>(null)
  if (chat.hilo && chat.actual) ultimo.current = { hilo: chat.hilo, mensajes: chat.mensajesDelHilo, actual: chat.actual }
  const [montado, setMontado] = useState(Boolean(chat.hilo))
  const saliendo = !chat.hilo
  useEffect(() => {
    if (chat.hilo) {
      setMontado(true)
      return
    }
    const t = setTimeout(() => setMontado(false), SALIDA_MS)
    return () => clearTimeout(t)
  }, [chat.hilo])
  const hilo = chat.hilo ?? ultimo.current?.hilo ?? null
  const actual = chat.actual ?? ultimo.current?.actual ?? null
  const mensajesDelHilo = chat.hilo ? chat.mensajesDelHilo : ultimo.current?.mensajes ?? []
  const panel = useRef<HTMLElement>(null)
  // Al salir no recibe foco ni clics (React 18 no pinta `inert` por prop)
  useEffect(() => {
    panel.current?.toggleAttribute('inert', saliendo)
  })
  // Un clic fuera del hilo lo cierra (salvo sobre botones, enlaces, campos, menús y ventanas: ahí se hace lo suyo)
  useEffect(() => {
    if (!chat.hilo) return
    const fuera = (ev: PointerEvent) => {
      const t = ev.target
      if (!(t instanceof Element) || !panel.current || panel.current.contains(t) || !t.isConnected) return
      if (t.closest('button, a, input, textarea, select, summary, [role="button"], [role="menu"], [role="dialog"], [role="listbox"], .tc-modal-fondo, .chat-emojis-menu, .chat-apariencia, .chat-junta, .chat-barra')) return
      cerrarHilo()
    }
    document.addEventListener('pointerdown', fuera)
    return () => document.removeEventListener('pointerdown', fuera)
  }, [chat.hilo, cerrarHilo])
  const fin = useRef<HTMLDivElement>(null)
  const [soltados, setSoltados] = useState<{ n: number; ficheros: File[] } | null>(null)
  const zona = useZonaDeSoltar({ alSoltar: (ficheros) => setSoltados({ n: Date.now(), ficheros }) })
  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
  }, [mensajesDelHilo.length])
  if (!montado && !chat.hilo) return null
  if (!hilo || !actual) return null
  const [padre, ...respuestas] = mensajesDelHilo
  const candidatos = actual.tipo === 'canal' ? personas.filter((p) => p.id !== yo.id) : personas.filter((p) => p.id !== yo.id && actual.miembros.includes(p.id))
  return (
    <aside ref={panel} className="chat-hilo" data-saliendo={saliendo ? 'true' : undefined} aria-label="Hilo" {...zona.props}>
      <div className="chat-hilo-interior">
      {zona.encima && <AvisoDeSoltar donde="este hilo" permitido={actual.soy_miembro} />}
      <header className="chat-hilo-cabecera">
        <b>Hilo</b>
        <button type="button" onClick={cerrarHilo} aria-label="Cerrar el hilo" className="chat-icono"><X className="h-4 w-4" /></button>
      </header>
      <div className="chat-hilo-lista">
        {!padre && <div className="tc-esqueleto h-16 w-full" role="status" aria-label="Cargando" />}
        {padre && <MensajeVista m={padre} continuacion={false} enHilo puedeBorrarAjeno={yo.esAdmin && actual.tipo === 'canal'} />}
        {padre && <p className="chat-hilo-separador">{respuestas.length === 0 ? 'Aún sin respuestas' : `${respuestas.length} ${respuestas.length === 1 ? 'respuesta' : 'respuestas'}`}</p>}
        {respuestas.map((m, i) => (
          <MensajeVista key={m.id} m={m} enHilo continuacion={i > 0 && respuestas[i - 1].autor_id === m.autor_id && Date.parse(m.creado_en) - Date.parse(respuestas[i - 1].creado_en) < 300_000} puedeBorrarAjeno={yo.esAdmin && actual.tipo === 'canal'} />
        ))}
        <div ref={fin} />
      </div>
      {actual.soy_miembro && (
        <Redactor
          key={`${hilo.id}`}
          compacto
          autoEnfocar
          candidatos={candidatos}
          placeholder="Responder en el hilo…"
          alEscribir={() => avisarQueEscribo(hilo.canalId)}
          ficherosSoltados={soltados}
          alEnviar={(cuerpo, adjuntos) => enviar(hilo.canalId, cuerpo, { hiloDe: hilo.id, adjuntos })}
        />
      )}
      </div>
    </aside>
  )
}
