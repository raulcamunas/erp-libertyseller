'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Database, Loader2, SendHorizonal, Share2, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import type { TurnoDelAsistente } from '@/lib/chat/asistente-servidor'
import { useChat } from './ChatProvider'
import { TextoDeMensaje } from './TextoDeMensaje'

interface Turno extends TurnoDelAsistente {
  herramientas?: string[]
}

const IDEAS = ['¿Cuántas citas hay hoy y quién las lleva?', 'Resumen del rendimiento del equipo comercial esta semana', '¿Hay algún proceso automático parado?', '¿Qué clientes tienen incidencias de cumplimiento en sus fichas?']

const NOMBRES_DE_HERRAMIENTAS: Record<string, string> = {
  listar_clientes: 'Clientes', resumen_catalogo: 'Catálogo', buscar_listings: 'Fichas', cumplimiento_resumen: 'Cumplimiento', cumplimiento_listings: 'Cumplimiento (fichas)', historial_cambios: 'Historial', estado_procesos: 'Procesos',
  agenda_citas: 'Agenda', cold_resumen: 'Cold Calling', cold_buscar_leads: 'Leads', cold_ficha_lead: 'Ficha de lead', cold_llamadas: 'Llamadas', cold_notas: 'Notas', cold_transcripcion: 'Transcripción',
  rendimiento_equipo: 'Rendimiento del equipo', rendimiento_comercial: 'Rendimiento de una persona', correo_envios: 'Correo', correo_cola: 'Cola de correo', correo_hilo: 'Hilo de correo', correo_hilos: 'Hilos de correo', correos_enviados: 'Correos enviados',
  contenido_calendario: 'Calendario de contenido', contenido_pendientes: 'Contenido pendiente', contenido_pieza: 'Pieza de contenido', contenido_piezas: 'Piezas de contenido',
}

/** «Preguntar al ERP» (solo administradores): una conversación privada con la IA, que consulta los datos del ERP con las herramientas de solo lectura. No se guarda; se puede enviar una respuesta al canal */
export function AsistenteDelErp() {
  const { asistente, cerrarAsistente, actual, enviar, yo } = useChat()
  const [turnos, setTurnos] = useState<Turno[]>([])
  const [texto, setTexto] = useState('')
  const [pensando, setPensando] = useState(false)
  const fin = useRef<HTMLDivElement>(null)
  const turnosRef = useRef<Turno[]>([])
  turnosRef.current = turnos

  const preguntar = useCallback(async (pregunta: string) => {
    const q = pregunta.trim()
    if (!q) return
    const nuevos: Turno[] = [...turnosRef.current, { rol: 'user', texto: q }]
    setTurnos(nuevos)
    setTexto('')
    setPensando(true)
    try {
      const r = await pedir<{ respuesta: string; herramientas: string[] }>('/api/chat/erp', { metodo: 'POST', cuerpo: { mensajes: nuevos.map(({ rol, texto: t }) => ({ rol, texto: t })) } })
      setTurnos([...nuevos, { rol: 'assistant', texto: r.respuesta, herramientas: r.herramientas }])
    } catch (e) {
      setTurnos(nuevos.slice(0, -1))
      setTexto(q)
      toast.error(e instanceof Error ? e.message : 'No se ha podido consultar el ERP')
    } finally {
      setPensando(false)
    }
  }, [])

  // Con «/erp pregunta» llega ya escrita: se lanza sola
  const ultimaPregunta = useRef<string | null>(null)
  useEffect(() => {
    if (asistente.abierto && asistente.pregunta && asistente.pregunta !== ultimaPregunta.current) {
      ultimaPregunta.current = asistente.pregunta
      void preguntar(asistente.pregunta)
    }
    if (!asistente.abierto) ultimaPregunta.current = null
  }, [asistente, preguntar])

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turnos.length, pensando])

  if (!asistente.abierto || !yo.esAdmin) return null

  const alCanal = async (i: number) => {
    if (!actual?.soy_miembro) return toast.error('Abre un canal en el que estés para enviarlo.')
    const pregunta = turnos[i - 1]?.texto
    try {
      await enviar(actual.id, `**Pregunta al ERP:** ${pregunta}\n\n${turnos[i].texto}`)
      toast.success('Enviado al canal')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    }
  }

  return (
    <aside className="chat-asistente" role="dialog" aria-label="Preguntar al ERP">
      <header>
        <Database className="h-4 w-4" />
        <b>Preguntar al ERP</b>
        <span>Solo lectura · solo administradores</span>
        <button type="button" className="chat-icono ml-auto" onClick={cerrarAsistente} aria-label="Cerrar"><X className="h-4 w-4" /></button>
      </header>
      <div className="chat-asistente-lista">
        {turnos.length === 0 && (
          <div className="chat-asistente-vacio">
            <Sparkles className="h-6 w-6" />
            <p>Pregunta por los datos del ERP: clientes, citas, llamadas, rendimiento, correo, procesos… Consulto el sistema y te contesto. Esta conversación es solo tuya y no se guarda.</p>
            <ul>{IDEAS.map((i) => <li key={i}><button type="button" onClick={() => void preguntar(i)}>{i}</button></li>)}</ul>
          </div>
        )}
        {turnos.map((t, i) => (
          <div key={i} className="chat-asistente-turno" data-rol={t.rol}>
            {t.rol === 'user' ? <p>{t.texto}</p> : <TextoDeMensaje cuerpo={t.texto} />}
            {t.rol === 'assistant' && (
              <footer>
                {(t.herramientas ?? []).length > 0 && <span className="chat-asistente-fuentes">Consultado: {(t.herramientas ?? []).map((h) => NOMBRES_DE_HERRAMIENTAS[h] ?? h).join(', ')}</span>}
                <button type="button" onClick={() => void navigator.clipboard.writeText(t.texto).then(() => toast.success('Copiado'))} aria-label="Copiar la respuesta" title="Copiar"><Copy className="h-3.5 w-3.5" /></button>
                <button type="button" onClick={() => void alCanal(i)} aria-label="Enviar al canal" title="Enviar al canal que tienes abierto"><Share2 className="h-3.5 w-3.5" /> Enviar al canal</button>
              </footer>
            )}
          </div>
        ))}
        {pensando && <p className="chat-asistente-pensando"><Loader2 className="h-4 w-4 animate-spin" /> Consultando el ERP…</p>}
        <div ref={fin} />
      </div>
      <form className="chat-asistente-caja" onSubmit={(e) => { e.preventDefault(); void preguntar(texto) }}>
        <textarea
          value={texto}
          rows={1}
          maxLength={2000}
          placeholder="Pregunta algo sobre el ERP…"
          aria-label="Pregunta"
          disabled={pensando}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault()
              void preguntar(texto)
            }
          }}
        />
        <button type="submit" className="chat-enviar" disabled={pensando || !texto.trim()} aria-label="Preguntar"><SendHorizonal className="h-4 w-4" /></button>
      </form>
    </aside>
  )
}
