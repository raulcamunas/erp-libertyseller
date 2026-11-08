'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, CheckCircle2, FileArchive, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { pedir } from '@/components/tareas-clientes/api'
import type { EstadoDeImportacion, ResumenDeImportacion } from '@/lib/chat/importar-servidor'
import { useChat } from './ChatProvider'
import { Ventana } from './Dialogos'

/**
 * Importar el historial de Slack (solo administradores): se sube el .zip de la exportación, se REVISA (qué canales y a quién se reconoce por su correo) y, si todo está bien, se importa en
 * segundo plano. Lo importado no avisa a nadie y queda como leído.
 */
export function ImportarDeSlack({ onCerrar }: { onCerrar: () => void }) {
  const { recargar } = useChat()
  const [fichero, setFichero] = useState<File | null>(null)
  const [revisando, setRevisando] = useState(false)
  const [resumen, setResumen] = useState<ResumenDeImportacion | null>(null)
  const [trabajo, setTrabajo] = useState<string | null>(null)
  const [estado, setEstado] = useState<EstadoDeImportacion | null>(null)
  const entrada = useRef<HTMLInputElement>(null)

  const enviar = async (simulacro: boolean) => {
    if (!fichero) return
    const formulario = new FormData()
    formulario.append('fichero', fichero)
    if (simulacro) formulario.append('simulacro', '1')
    try {
      if (simulacro) {
        setRevisando(true)
        setResumen((await pedir<{ resumen: ResumenDeImportacion }>('/api/chat/importar', { metodo: 'POST', formulario })).resumen)
      } else {
        const r = await pedir<{ trabajoId: string }>('/api/chat/importar', { metodo: 'POST', formulario })
        setTrabajo(r.trabajoId)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido leer el archivo')
    } finally {
      setRevisando(false)
    }
  }

  // El avance, cada segundo y medio
  useEffect(() => {
    if (!trabajo) return
    let vivo = true
    const t = setInterval(() => {
      pedir<EstadoDeImportacion>(`/api/chat/importar?trabajo=${trabajo}`)
        .then((e) => {
          if (!vivo) return
          setEstado(e)
          if (e.estado !== 'en_curso') {
            clearInterval(t)
            recargar()
          }
        })
        .catch((e: Error) => vivo && toast.error(e.message))
    }, 1500)
    return () => {
      vivo = false
      clearInterval(t)
    }
  }, [trabajo, recargar])

  const porcentaje = estado && estado.total > 0 ? Math.min(100, Math.round((estado.hechos / estado.total) * 100)) : 0
  const enCurso = trabajo !== null && estado?.estado !== 'listo' && estado?.estado !== 'error'

  return (
    <Ventana
      titulo="Importar de Slack"
      onCerrar={enCurso ? () => undefined : onCerrar}
      pie={
        estado?.estado === 'listo' || estado?.estado === 'error' ? (
          <button type="button" className="tc-boton-primario ml-auto" onClick={onCerrar}>Cerrar</button>
        ) : (
          <>
            <button type="button" className="chat-boton-secundario" disabled={enCurso} onClick={onCerrar}>Cancelar</button>
            {resumen ? (
              <button type="button" className="tc-boton-primario ml-auto disabled:opacity-50" disabled={enCurso} onClick={() => void enviar(false)}>
                {enCurso && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Importar {resumen.mensajes.toLocaleString('es-ES')} mensajes
              </button>
            ) : (
              <button type="button" className="tc-boton-primario ml-auto disabled:opacity-50" disabled={!fichero || revisando} onClick={() => void enviar(true)}>
                {revisando && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Revisar el archivo
              </button>
            )}
          </>
        )
      }
    >
      {!trabajo && (
        <>
          <p className="text-[12.5px] text-[var(--ls-t3)]">
            En Slack: <b>Administración → Importar y exportar datos → Exportar</b>. Te mandan un <b>.zip</b>: súbelo aquí. Con los planes gratuitos solo se exportan los canales abiertos.
            Reconozco a las personas por su <b>correo</b>; quien no esté en el ERP se importa con su nombre y la etiqueta «Slack». Lo importado no avisa a nadie.
          </p>
          <button type="button" className="chat-zip" onClick={() => entrada.current?.click()}>
            <FileArchive className="h-5 w-5" />
            <span>{fichero ? <><b>{fichero.name}</b><i>{(fichero.size / 1024 / 1024).toFixed(1)} MB</i></> : 'Elegir el .zip de la exportación de Slack'}</span>
          </button>
          <input ref={entrada} type="file" accept=".zip,application/zip" hidden onChange={(e) => { setFichero(e.target.files?.[0] ?? null); setResumen(null) }} />
        </>
      )}

      {resumen && !trabajo && (
        <div className="chat-importar-resumen">
          <p><b>{resumen.conversaciones.length}</b> conversaciones · <b>{resumen.mensajes.toLocaleString('es-ES')}</b> mensajes · <b>{resumen.personas.reconocidas}</b> de {resumen.personas.total} personas reconocidas</p>
          {resumen.personas.sinReconocer.length > 0 && <p className="chat-importar-aviso"><AlertTriangle className="h-3.5 w-3.5" /> Sin reconocer (se importan con su nombre de Slack): {resumen.personas.sinReconocer.slice(0, 12).join(', ')}{resumen.personas.sinReconocer.length > 12 ? '…' : ''}</p>}
          <ul>
            {resumen.conversaciones.map((c) => (
              <li key={c.nombre + c.tipo} data-omitida={c.omitida ? 'true' : undefined}>
                <b>{c.tipo === 'canal' ? '#' : c.tipo === 'privado' ? '🔒' : '💬'} {c.nombre}</b>
                <span>{c.mensajes.toLocaleString('es-ES')} mensajes · {c.miembrosReconocidos}/{c.miembros} personas</span>
                {c.omitida && <i>{c.omitida}: se salta</i>}
              </li>
            ))}
          </ul>
          {resumen.avisos.map((a) => <p key={a} className="chat-importar-aviso"><AlertTriangle className="h-3.5 w-3.5" /> {a}</p>)}
          <small>Los archivos adjuntos no se traen (Slack no los incluye). Pasarás a administrar los canales abiertos y privados importados.</small>
        </div>
      )}

      {trabajo && (
        <div className="chat-importar-avance">
          {estado?.estado === 'listo' ? (
            <p className="chat-importar-hecho"><CheckCircle2 className="h-5 w-5" /> Importación terminada: {estado.resumen?.canales ?? 0} canales nuevos y {estado.resumen?.mensajes.toLocaleString('es-ES') ?? 0} mensajes{(estado.resumen?.omitidos ?? 0) > 0 ? ` (${estado.resumen?.omitidos} omitidos)` : ''}.</p>
          ) : estado?.estado === 'error' ? (
            <p role="alert" className="chat-importar-aviso"><AlertTriangle className="h-4 w-4" /> {estado.error}</p>
          ) : (
            <>
              <p><Loader2 className="inline h-4 w-4 animate-spin" /> Importando {estado?.actual ? <b>{estado.actual}</b> : '…'} · {porcentaje}%</p>
              <div className="chat-sal-barra" role="progressbar" aria-valuenow={porcentaje} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${porcentaje}%` }} /></div>
              <small>Puede tardar unos minutos. No cierres esta ventana.</small>
            </>
          )}
        </div>
      )}
    </Ventana>
  )
}
