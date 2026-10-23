'use client'

import { ChevronDown, Copy, Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { enviarJson, pedir } from '@/components/correo/api'
import { Esqueleto, PANEL } from '@/components/rendimiento/ui'
import type { CorreoQueFunciona } from '@/lib/correo/ia-laboratorio-tipos'
import { AYUDA, BOTON_SECUNDARIO, fechaCorta } from './ui'

/**
 * LO QUE YA FUNCIONA: los correos fríos del equipo a los que un cliente de fuera contestó algo que no era un «no».
 *
 * Es lo que la IA aprende cuando una versión tiene activado «aprender de los correos del equipo»: se recalcula cada 10 minutos y, cuantos más
 * correos reciban respuesta, mejores son. Se enseñan tal como los ve la IA (sin correos, teléfonos, nombres del equipo ni frases de dinero).
 * Desde aquí se puede copiar uno a «Mis ejemplos» para editarlo y probarlo como versión.
 */

export function TabFunciona({ onCopiado }: { onCopiado: () => Promise<void> }) {
  const [ejemplos, setEjemplos] = useState<CorreoQueFunciona[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [abierto, setAbierto] = useState<string | null>(null)
  const [copiando, setCopiando] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    void (async () => {
      const r = await pedir<{ ejemplos: CorreoQueFunciona[] }>('/api/correo/laboratorio/funciona')
      if (!vivo) return
      if (!r.ok) return setError(r.mensaje)
      setEjemplos(r.datos.ejemplos)
    })()
    return () => {
      vivo = false
    }
  }, [])

  async function copiar(e: CorreoQueFunciona) {
    setCopiando(e.id)
    const r = await enviarJson('/api/correo/laboratorio/ejemplos', 'POST', { titulo: e.asunto.slice(0, 80), asunto: e.asunto, texto: e.texto, tipo: e.tipo, nota: 'Copiado de «Lo que ya funciona»' })
    setCopiando(null)
    if (!r.ok) return toast.error(r.mensaje)
    toast.success('Copiado a «Mis ejemplos». Ahí lo puedes editar y elegirlo en una versión.')
    await onCopiado()
  }

  return (
    <div className="space-y-3">
      <div className={`${PANEL} p-3`}>
        <p className="text-[12.5px] leading-relaxed text-[var(--ls-t2)]">
          Estos son los correos fríos del equipo a los que <strong className="text-[var(--ls-t1)]">un cliente de fuera contestó algo que no era un «no»</strong>. La IA los ve como ejemplo cuando una versión tiene activado
          «aprender de los correos del equipo». Cuantos más correos reciban respuesta, mejores serán.
        </p>
        <p className={AYUDA}>Se enseñan limpios: sin correos ni teléfonos, sin los nombres del equipo y sin las frases que hablaban de dinero. Se recalculan cada 10 minutos.</p>
      </div>

      {error ? (
        <p className="text-[12.5px] text-[var(--ls-e-ambar)]" role="alert">
          {error}
        </p>
      ) : !ejemplos ? (
        <div className="space-y-2" aria-busy="true">
          <Esqueleto className="h-14" />
          <Esqueleto className="h-14" />
        </div>
      ) : ejemplos.length === 0 ? (
        <p className="text-[12.5px] text-[var(--ls-t4)]">Todavía no hay ningún correo frío con una respuesta que no sea un «no». Cuando lo haya, aparecerá aquí.</p>
      ) : (
        <ul className={`${PANEL} divide-y divide-[var(--ls-linea)] overflow-hidden`}>
          {ejemplos.map((e) => {
            const abierta = abierto === e.id
            return (
              <li key={e.id}>
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <button type="button" onClick={() => setAbierto(abierta ? null : e.id)} aria-expanded={abierta} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)] transition-transform ${abierta ? '' : '-rotate-90'}`} aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[12.5px] font-semibold text-[var(--ls-t1)]">{e.asunto}</span>
                      <span className="block text-[11.5px] text-[var(--ls-t4)]">
                        {e.tipo === 'entrar' ? 'Para quien aún no vende en Amazon' : 'Para quien ya vende'} · contestaron el {fechaCorta(e.respondioEn)}
                      </span>
                    </span>
                  </button>
                  <button type="button" onClick={() => void copiar(e)} disabled={copiando === e.id} className={BOTON_SECUNDARIO} title="Lo copia a «Mis ejemplos» para editarlo">
                    {copiando === e.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />} Copiar a mis ejemplos
                  </button>
                </div>
                {abierta && <p className="whitespace-pre-wrap border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3 text-[12.5px] leading-relaxed text-[var(--ls-t2)]">{e.texto}</p>}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
