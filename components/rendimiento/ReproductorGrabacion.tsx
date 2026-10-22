'use client'

import { AlertCircle, Loader2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

/**
 * EL REPRODUCTOR DE UNA GRABACIÓN.
 *
 * Pide a la ruta del ERP una dirección temporal de la grabación (la ruta usa la clave de Rinkel de su dueño,
 * que el navegador nunca ve) y la pone en un <audio> normal. Si algo falla —caducó, la clave ya no vale,
 * Rinkel está caído— se enseña el motivo, no un reproductor mudo.
 */

type Estado = { tipo: 'cargando' } | { tipo: 'listo'; url: string } | { tipo: 'error'; mensaje: string }

const VELOCIDADES = [1, 1.5, 2] as const

export function ReproductorGrabacion({ llamadaId, onCerrar }: { llamadaId: string; onCerrar: () => void }) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'cargando' })
  const [velocidad, setVelocidad] = useState<(typeof VELOCIDADES)[number]>(1)
  const audio = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    const control = new AbortController()
    setEstado({ tipo: 'cargando' })
    fetch(`/api/rendimiento/grabaciones/${llamadaId}?formato=json`, { signal: control.signal, cache: 'no-store' })
      .then(async (r) => {
        const cuerpo = (await r.json().catch(() => null)) as { url?: unknown; error?: unknown } | null
        if (r.ok && typeof cuerpo?.url === 'string') setEstado({ tipo: 'listo', url: cuerpo.url })
        else setEstado({ tipo: 'error', mensaje: typeof cuerpo?.error === 'string' ? cuerpo.error : 'No se ha podido cargar la grabación.' })
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name !== 'AbortError') {
          setEstado({ tipo: 'error', mensaje: 'No se ha podido conectar para pedir la grabación. Vuelve a probar.' })
        }
      })
    return () => control.abort()
  }, [llamadaId])

  // La velocidad se pierde al cambiar de fuente: se vuelve a poner en cuanto el audio sabe cuánto dura
  useEffect(() => {
    if (audio.current) audio.current.playbackRate = velocidad
  }, [velocidad, estado])

  return (
    <div className="mt-2 rounded-lg border border-white/10 bg-black/30 p-2.5">
      {estado.tipo === 'cargando' && (
        <p className="text-[12px] text-white/50 flex items-center gap-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Pidiendo la grabación a Rinkel…
        </p>
      )}

      {estado.tipo === 'error' && (
        <div className="flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-amber-400 shrink-0 mt-px" />
          <p className="text-[12px] text-white/70 leading-snug flex-1">{estado.mensaje}</p>
          <button type="button" onClick={onCerrar} aria-label="Cerrar" className="text-white/30 hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {estado.tipo === 'listo' && (
        <div className="space-y-2">
          <audio
            ref={audio}
            src={estado.url}
            controls
            autoPlay
            preload="auto"
            onLoadedMetadata={(e) => {
              e.currentTarget.playbackRate = velocidad
            }}
            onError={() => setEstado({ tipo: 'error', mensaje: 'El audio no se ha podido reproducir. Puede haber caducado: cierra y vuelve a abrirlo.' })}
            className="w-full h-9"
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1" role="group" aria-label="Velocidad de reproducción">
              {VELOCIDADES.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVelocidad(v)}
                  aria-pressed={velocidad === v}
                  className={`px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors ${
                    velocidad === v ? 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white' : 'border-white/10 text-white/45 hover:text-white/80'
                  }`}
                >
                  {String(v).replace('.', ',')}×
                </button>
              ))}
            </div>
            <button type="button" onClick={onCerrar} className="text-[11px] text-white/40 hover:text-white transition-colors">
              Cerrar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
