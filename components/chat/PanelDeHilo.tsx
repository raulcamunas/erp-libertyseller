'use client'

import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { useChat } from './ChatProvider'
import { MensajeVista } from './MensajeVista'
import { Redactor } from './Redactor'

/** Las respuestas de un mensaje, a la derecha: el mensaje de arriba, lo que se le ha contestado y una caja para contestar */
export function PanelDeHilo() {
  const { hilo, mensajesDelHilo, cerrarHilo, enviar, avisarQueEscribo, actual, personas, yo } = useChat()
  const fin = useRef<HTMLDivElement>(null)
  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' })
  }, [mensajesDelHilo.length])
  if (!hilo || !actual) return null
  const [padre, ...respuestas] = mensajesDelHilo
  const candidatos = actual.tipo === 'canal' ? personas.filter((p) => p.id !== yo.id) : personas.filter((p) => p.id !== yo.id && actual.miembros.includes(p.id))
  return (
    <aside className="chat-hilo" aria-label="Hilo">
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
          alEnviar={(cuerpo) => enviar(hilo.canalId, cuerpo, { hiloDe: hilo.id })}
        />
      )}
    </aside>
  )
}
