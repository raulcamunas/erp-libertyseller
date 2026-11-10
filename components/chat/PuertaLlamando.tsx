'use client'

import { useEffect, useRef } from 'react'
import { Check, DoorOpen, X } from 'lucide-react'
import { Avatar } from '@/components/tareas-clientes/AvatarTC'
import { nombreVisible } from '@/lib/chat/canales'
import { sonarVoz } from '@/lib/chat/sonidos-voz'
import { useChat } from './ChatProvider'
import { useJunta } from './JuntaProvider'

/** Cuánto se queda el aviso si nadie contesta (quien llamó se rinde a los 90 s; aquí, algo antes) */
const VIDA_DEL_AVISO_MS = 75_000

/**
 * «MARIO QUIERE ENTRAR»: cuando alguien llama a la puerta de la sala de voz con candado en la que estás, te sale este aviso arriba para dejarle entrar o no. Solo lo ven quienes están dentro de esa
 * sala; cuando uno contesta, desaparece para los demás (el servidor avisa). Suena un toque de campana (el sonido se elige en «Sonidos»).
 */
export function PuertaLlamando() {
  const { puertas, descartarPuerta, canales, nombreDe, persona, yo } = useChat()
  const { actual, responderPuerta } = useJunta()
  const sonadas = useRef(new Set<string>())
  const visibles = puertas.filter((p) => actual?.estado === 'conectada' && actual.canalId === p.canalId)

  useEffect(() => {
    for (const p of visibles) {
      const clave = `${p.canalId}:${p.de}:${p.en}`
      if (sonadas.current.has(clave)) continue
      sonadas.current.add(clave)
      sonarVoz('puerta')
      setTimeout(() => descartarPuerta(p.canalId, p.de), VIDA_DEL_AVISO_MS)
    }
  }, [visibles, descartarPuerta])

  if (visibles.length === 0) return null
  return (
    <div className="puerta-llamando" role="alert" aria-live="assertive">
      {visibles.map((p) => {
        const canal = canales.find((c) => c.id === p.canalId)
        const nombre = nombreDe(p.de)
        const donde = canal ? nombreVisible(canal, yo.id, persona) : 'la sala'
        const contestar = (permitir: boolean) => {
          descartarPuerta(p.canalId, p.de)
          void responderPuerta(p.canalId, p.de, permitir)
        }
        return (
          <div key={`${p.canalId}:${p.de}`} className="puerta-llamando-tarjeta">
            <span className="puerta-llamando-avatar"><Avatar id={p.de} nombre={nombre} tamano={36} /></span>
            <span className="puerta-llamando-texto">
              <b><DoorOpen className="mr-1 inline h-3.5 w-3.5" aria-hidden />{nombre} quiere entrar</b>
              <small>a la sala de voz «{donde}» (tiene candado)</small>
            </span>
            <button type="button" className="puerta-permitir" onClick={() => contestar(true)} aria-label={`Dejar entrar a ${nombre}`}>
              <Check className="h-4 w-4" /> Permitir
            </button>
            <button type="button" className="puerta-denegar" onClick={() => contestar(false)} aria-label={`No dejar entrar a ${nombre}`}>
              <X className="h-4 w-4" /> Denegar
            </button>
          </div>
        )
      })}
    </div>
  )
}
