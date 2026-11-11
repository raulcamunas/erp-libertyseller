'use client'

import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { X } from 'lucide-react'
import { inicialDe, leerVistasPrevias, quitarVistaPrevia, suscribirVistasPrevias, type VistaPrevia } from '@/lib/chat/vista-previa'

/** Cuánto se queda una tarjeta si nadie la toca */
const DURACION_MS = 9_000

function Tarjeta({ v, alAbrir }: { v: VistaPrevia; alAbrir: (v: VistaPrevia) => void }) {
  const [encima, setEncima] = useState(false)

  // Se retira sola, salvo mientras se tiene el ratón encima (para poder leerla con calma)
  useEffect(() => {
    if (encima) return
    const t = setTimeout(() => quitarVistaPrevia(v.clave), DURACION_MS)
    return () => clearTimeout(t)
  }, [encima, v.clave])

  return (
    <div className="chat-vista" role="status" onMouseEnter={() => setEncima(true)} onMouseLeave={() => setEncima(false)}>
      <button type="button" className="chat-vista-cuerpo" onClick={() => alAbrir(v)} aria-label={`Abrir el mensaje de ${v.titulo}`}>
        <span className="chat-vista-inicial" aria-hidden>
          {inicialDe(v.titulo)}
        </span>
        <span className="chat-vista-texto">
          <b>{v.titulo}</b>
          <span>{v.texto}</span>
        </span>
      </button>
      <button type="button" className="chat-vista-cerrar" onClick={() => quitarVistaPrevia(v.clave)} aria-label="Cerrar este aviso" title="Cerrar">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

/**
 * LAS TARJETAS QUE ASOMAN ENCIMA DE LA PASTILLA «CHAT»: quién te ha hablado y el principio de lo que dice (lib/chat/vista-previa.ts). Pulsar una abre el chat en ese canal.
 */
export function VistasPreviasDelChat({ alAbrir }: { alAbrir: (v: VistaPrevia) => void }) {
  const vistas = useSyncExternalStore(suscribirVistasPrevias, leerVistasPrevias, leerVistasPrevias)
  const caja = useRef<HTMLDivElement>(null)
  // Lo que ocupan, para que los avisos de la pila (components/avisos/PilaDeAvisos.tsx) se pongan encima y no detrás
  const hay = vistas.length > 0
  useEffect(() => {
    const raiz = document.documentElement
    const el = caja.current
    if (!hay || !el) {
      raiz.style.removeProperty('--vistas-alto')
      return
    }
    const poner = () => raiz.style.setProperty('--vistas-alto', `${el.offsetHeight + 10}px`)
    poner()
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(poner) : null
    ro?.observe(el)
    return () => {
      ro?.disconnect()
      raiz.style.removeProperty('--vistas-alto')
    }
  }, [hay])
  if (!hay) return null
  return (
    <div ref={caja} className="chat-vistas" aria-live="polite">
      {vistas.map((v) => (
        <Tarjeta key={v.clave} v={v} alAbrir={alAbrir} />
      ))}
    </div>
  )
}
