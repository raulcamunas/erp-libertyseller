'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Loader2, Play, Tag } from 'lucide-react'

/**
 * FORZAR LA PASADA DE ESTE CLIENTE, AHORA.
 *
 * Adelanta el reloj: hace lo mismo que el cron pero sin esperar a la cadencia y
 * sin saltarse el fichero por ser el mismo de la vez anterior.
 *
 *
 * ============ Y ENSEÑA EL PORQUÉ DE LOS PRECIOS ============
 *
 * Esta es la mitad que no se ve venir. Cuando la publicación automática de
 * precios no hace nada —está apagada, no le tocaba, no había ningún precio que
 * cambiar, el motor no tiene cuenta configurada— eso ocurría EN SILENCIO: el
 * cron lo escribía en su registro y en la pantalla no había ni rastro. La
 * primera vez que pasó, la única forma de averiguarlo fue leer el código.
 *
 * Así que el botón devuelve el motivo y se pinta aquí, literal. Un botón que
 * dice «hecho» cuando no ha hecho nada es peor que no tener botón.
 */

interface Detalle {
  perfil: string
  desenlace: string
  detalle: string | null
  cambios: number
  enviados: number
}

interface Respuesta {
  ciclo: { mirados: number; detalle: Detalle[] }
  precios: {
    hecho: boolean
    motivo: string
    calculados?: number
    candidatos?: number
    frenados?: number
    enviados?: number
    fallidos?: number
  } | null
}

export function ForzarPasada({
  clientId,
  clientName,
}: {
  clientId: string
  clientName: string
}) {
  const router = useRouter()
  const [trabajando, setTrabajando] = useState(false)
  const [salida, setSalida] = useState<Respuesta | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function forzar() {
    setTrabajando(true)
    setError(null)
    setSalida(null)
    try {
      const res = await fetch('/api/growth/ejecuciones/forzar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente: clientId }),
      })
      const payload = (await res.json().catch(() => null)) as
        | (Respuesta & { error?: string })
        | null
      if (!res.ok) {
        setError(payload?.error ?? 'No se ha podido forzar la pasada')
        return
      }
      setSalida(payload as Respuesta)
      // El historial y la línea de vida se pintan en el servidor: sin esto la
      // pasada que se acaba de lanzar no aparecería hasta recargar a mano.
      router.refresh()
    } catch {
      setError('No hay conexión con el servidor')
    } finally {
      setTrabajando(false)
    }
  }

  return (
    <div className="flex-shrink-0 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={() => void forzar()}
          disabled={trabajando}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-[#FF6600]/50 bg-[#FF6600]/10 px-2.5 text-[11px] text-white transition-colors hover:bg-[#FF6600]/20 disabled:opacity-50"
        >
          {trabajando ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Play className="h-3 w-3" />
          )}
          {trabajando ? 'Pasando…' : 'Forzar pasada ahora'}
        </button>

        <span className="text-[10.5px] leading-relaxed text-white/35">
          {trabajando ? (
            <>Leyendo el fichero de {clientName} y Amazon en directo. Puede tardar un par de minutos.</>
          ) : (
            <>
              Adelanta el reloj: no espera a la cadencia y no se salta el fichero por ser el mismo.
              No enciende nada que esté apagado —perfil, simulacro o publicación de precios—, ni
              quita los frenos.
            </>
          )}
        </span>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-red-300/85">
          <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}

      {salida && (
        <div className="mt-2 space-y-1.5 border-t border-white/[0.07] pt-2">
          {/* ---------- El stock ---------- */}
          {salida.ciclo.mirados === 0 ? (
            <p className="text-[11px] leading-relaxed text-amber-200/80">
              <strong className="font-medium">Ningún perfil que mirar.</strong> {clientName} no
              tiene ningún perfil de sincronismo activo, así que no se ha leído ningún fichero.
            </p>
          ) : (
            salida.ciclo.detalle.map((d, i) => (
              <p key={i} className="text-[11px] leading-relaxed text-white/55">
                <Check className="mr-1 inline h-3 w-3 text-emerald-300" />
                <strong className="font-medium text-white/80">{d.perfil}</strong>{' '}
                {d.enviados > 0 ? (
                  <span className="text-emerald-200/80">
                    {d.enviados.toLocaleString('es-ES')} cambios de stock enviados
                  </span>
                ) : (
                  <span className="text-white/45">sin cambios de stock</span>
                )}
                {d.detalle && <span className="text-white/35"> · {d.detalle}</span>}
              </p>
            ))
          )}

          {/* ---------- Los precios, hayan salido o no ---------- */}
          {salida.precios && (
            <p className="text-[11px] leading-relaxed text-white/55">
              <Tag className="mr-1 inline h-3 w-3 text-violet-300" />
              <strong className="font-medium text-white/80">Precios:</strong>{' '}
              {salida.precios.hecho ? (
                <>
                  <span className="text-violet-200/85">
                    {(salida.precios.enviados ?? 0).toLocaleString('es-ES')} enviados
                  </span>
                  {(salida.precios.fallidos ?? 0) > 0 && (
                    <span className="text-red-300/80">
                      , {salida.precios.fallidos!.toLocaleString('es-ES')} fallaron
                    </span>
                  )}
                  {(salida.precios.frenados ?? 0) > 0 && (
                    <span className="text-amber-200/80">
                      , {salida.precios.frenados!.toLocaleString('es-ES')} frenados por pasarse del
                      tope de salto
                    </span>
                  )}
                  {salida.precios.calculados !== undefined && (
                    <span className="text-white/35">
                      {' '}
                      · {salida.precios.calculados.toLocaleString('es-ES')} referencias recalculadas
                    </span>
                  )}
                </>
              ) : (
                <span className="text-amber-200/75">{salida.precios.motivo}</span>
              )}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
