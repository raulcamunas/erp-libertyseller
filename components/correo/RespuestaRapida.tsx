'use client'

import { Maximize2, Send } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Boton } from '@/components/ui-ls'
import { nombreOCorreo } from '@/lib/correo/direcciones'
import { camposSinRellenar } from '@/lib/correo/plantillas'
import { borradorDe } from '@/lib/correo/redactar'
import { pedir } from './api'
import type { PropsDeRespuestaRapida } from './contratos'
import { Kbd } from './piezas'

/**
 * «RESPONDER RÁPIDO», FIJO AL PIE DEL HILO (solo desde md y solo si quien mira puede responder: lo decide VistaDeHilo).
 *
 * Una caja de una línea que crece hasta 8 mientras se escribe. ⌘/Ctrl + ↵ envía. Sale como «Responder» al mensaje que se le pasa (el último
 * entrante), desde el buzón del hilo y con SU firma debajo, citando el original como hace Redactar. Lo que necesita más (Cc, adjuntos,
 * plantillas, la IA) va por «Abrir completo», que pasa lo escrito a Redactar.
 *
 * Se conservan las reglas de Redactar que aplican a una respuesta: no sale vacío ni con {{campos}} sin rellenar, un solo envío a la vez y los
 * avisos de «enviado, pero…» (rechazados, sin copia en Enviados, verificación). La comprobación de direcciones es solo para correos nuevos.
 */

/** Cómo contesta POST /api/correo/enviar (lo que se usa aquí) */
interface RespuestaDeEnvio {
  ok: boolean
  hiloId: string
  copiadoAEnviados: boolean
  rechazados: string[]
  avisosDeVerificacion?: string[]
}

const LINEAS_MAXIMAS = 8

/** El texto que sale: lo escrito y, debajo, la firma del buzón (como lo deja Redactar). PURO (respuesta-rapida en hilo.prueba.ts) */
export function textoDeRespuestaRapida(escrito: string, firma: string | null | undefined): string {
  const cuerpo = escrito.replace(/\s+$/, '')
  const f = (firma ?? '').trim()
  return f ? `${cuerpo}\n\n${f}` : cuerpo
}

/** ¿Es Mac? (para enseñar ⌘ o Ctrl). Sin navegador, no */
function esMac(): boolean {
  if (typeof navigator === 'undefined') return false
  const plataforma = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
  return /mac|iphone|ipad/i.test(plataforma)
}

export function RespuestaRapida({ hilo, buzon, mensaje, onEnviado, onAbrirCompleto }: PropsDeRespuestaRapida) {
  const [texto, setTexto] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mac, setMac] = useState(false)
  const caja = useRef<HTMLTextAreaElement>(null)
  const enCurso = useRef(false)

  useEffect(() => setMac(esMac()), [])

  // Cambiar de conversación empieza en blanco
  useEffect(() => {
    setTexto('')
    setError(null)
  }, [hilo.id])

  // Crece con lo escrito, de 1 a 8 líneas (luego, su propio scroll)
  useLayoutEffect(() => {
    const t = caja.current
    if (!t) return
    t.style.height = 'auto'
    const estilo = window.getComputedStyle(t)
    const linea = parseFloat(estilo.lineHeight) || 20
    const relleno = parseFloat(estilo.paddingTop) + parseFloat(estilo.paddingBottom)
    const maximo = linea * LINEAS_MAXIMAS + relleno
    t.style.height = `${Math.min(t.scrollHeight, maximo)}px`
    t.style.overflowY = t.scrollHeight > maximo ? 'auto' : 'hidden'
  }, [texto])

  const borrador = borradorDe('responder', mensaje, { miDireccion: buzon.direccion, firma: null })
  const destino = mensaje.direccion === 'saliente' ? borrador.para : nombreOCorreo({ nombre: mensaje.deNombre, direccion: mensaje.deDireccion })

  async function enviar() {
    if (enCurso.current || enviando) return
    if (!texto.trim()) return setError('Escribe algo antes de enviar.')
    if (!borrador.para.trim()) return setError('Este mensaje no tiene a quién contestar. Ábrelo completo para elegir el destinatario.')
    const pendientes = camposSinRellenar(texto)
    if (pendientes.length > 0) return setError(`Quedan campos sin rellenar: ${pendientes.join(', ')}. Escríbelos, o bórralos, antes de enviar.`)

    enCurso.current = true
    setEnviando(true)
    setError(null)
    const salida = textoDeRespuestaRapida(texto, buzon.firma)
    const f = new FormData()
    f.set('buzonId', buzon.id)
    f.set('para', borrador.para)
    f.set('cc', borrador.cc)
    f.set('asunto', borrador.asunto)
    f.set('texto', salida)
    f.set('respondeA', mensaje.id)
    f.set('modo', 'responder')
    const r = await pedir<RespuestaDeEnvio>('/api/correo/enviar', { method: 'POST', body: f })
    enCurso.current = false
    setEnviando(false)
    if (!r.ok) return setError(r.mensaje)

    const avisos = r.datos.avisosDeVerificacion ?? []
    const conAviso = r.datos.rechazados.length > 0 || !r.datos.copiadoAEnviados || avisos.length > 0
    if (r.datos.rechazados.length > 0) toast.warning(`Enviado, pero el servidor no ha entregado a: ${r.datos.rechazados.join(', ')}`)
    else if (!r.datos.copiadoAEnviados) toast.warning('Enviado. No se ha podido guardar la copia en la carpeta Enviados del webmail.')
    else toast.success('Respuesta enviada.')
    for (const aviso of avisos) toast.warning(aviso, { duration: 12000 })
    setTexto('')
    onEnviado(r.datos.hiloId || hilo.id, borrador.asunto, { para: borrador.para, texto: salida, conAviso })
  }

  function teclas(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.altKey) {
      // Se queda aquí: los atajos de la pantalla no lo vuelven a tratar
      e.preventDefault()
      e.stopPropagation()
      void enviar()
    }
  }

  return (
    <div className="border-t border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-3 lg:px-4">
      <div
        className={`rounded-[14px] border bg-[var(--ls-sup2)] transition-[border-color,box-shadow] focus-within:border-[var(--ls-acc-graf)] focus-within:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ls-acc-graf)_18%,transparent)] ${
          error ? 'border-[var(--ls-e-rojo)]' : 'border-[var(--ls-linea)]'
        }`}
      >
        <label htmlFor={`respuesta-${hilo.id}`} className="sr-only">
          Responder a {destino}
        </label>
        <textarea
          id={`respuesta-${hilo.id}`}
          ref={caja}
          rows={1}
          value={texto}
          onChange={(e) => {
            setTexto(e.target.value)
            if (error) setError(null)
          }}
          onKeyDown={teclas}
          disabled={enviando}
          placeholder={`Responder a ${destino}…`}
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-base leading-[22px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] disabled:opacity-60 lg:text-[13.5px] lg:leading-[20px]"
        />
        <div className="flex flex-wrap items-center gap-2 px-2 pb-2 pt-1">
          <p className="min-w-0 flex-1 truncate pl-1 text-[11.5px] text-[var(--ls-t4)]" title={buzon.firma ? 'La firma del buzón va debajo de lo que escribas' : undefined}>
            {buzon.firma ? 'Con la firma del buzón · cita el original' : 'Cita el original'}
          </p>
          <Boton variante="fantasma" tamano="sm" icono={Maximize2} onClick={() => onAbrirCompleto(texto)} disabled={enviando} title="Pasar lo escrito a la ventana completa (Cc, adjuntos, plantillas, IA)">
            Abrir completo
          </Boton>
          <Boton variante="secundario" tamano="sm" icono={Send} onClick={() => void enviar()} cargando={enviando} disabled={!texto.trim()} title={`Enviar (${mac ? '⌘' : 'Ctrl'} + ↵)`}>
            {enviando ? 'Enviando…' : 'Enviar'}
            <span className="ml-0.5 hidden items-center gap-0.5 lg:inline-flex" aria-hidden>
              <Kbd>{mac ? '⌘' : 'Ctrl'}</Kbd>
              <Kbd>↵</Kbd>
            </span>
          </Boton>
        </div>
      </div>
      {error && (
        <p className="mt-1.5 px-1 text-[12px] text-[var(--ls-e-rojo)]" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
