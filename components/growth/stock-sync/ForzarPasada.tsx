'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Check, Clock, Loader2, Play, Tag } from 'lucide-react'

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

interface Cuota {
  limite: number
  usadas: number
  quedan: number
  /** ISO. Cuándo caduca la llamada más vieja y se libera un hueco */
  seLiberaEn: string | null
}

interface Respuesta {
  cuota: Cuota | null
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

/** «13:47». La hora a la que se libera el siguiente hueco de cuota */
function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-ES', {
    timeZone: 'Europe/Madrid',
    hour: '2-digit',
    minute: '2-digit',
  })
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
  const [cuota, setCuota] = useState<Cuota | null>(null)

  /**
   * LA CUOTA DEL PROVEEDOR, ANTES DE GASTARLA.
   *
   * Entrais admite cuatro llamadas por hora a su catálogo, y el ciclo ya se
   * lleva dos. Quedan dos para las personas, y cuando se acaban la pasada no
   * falla a medias: falla entera y deja una fila roja en el historial.
   *
   * Se pregunta al abrir y después de cada pasada. No en un intervalo: el número
   * solo cambia cuando alguien llama, y eso pasa aquí.
   */
  const leerCuota = useCallback(async () => {
    try {
      const res = await fetch('/api/growth/ejecuciones/forzar')
      const p = (await res.json().catch(() => null)) as { cuota?: Cuota | null } | null
      if (res.ok) setCuota(p?.cuota ?? null)
    } catch {
      // Sin cuota que enseñar se sigue pudiendo forzar: quien manda es Entrais,
      // esto solo avisa. Un fallo aquí no puede bloquear el botón.
    }
  }, [])

  useEffect(() => {
    void leerCuota()
  }, [leerCuota])

  const sinCuota = cuota !== null && cuota.quedan === 0

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
      setCuota((payload as Respuesta).cuota ?? null)
      /**
       * AQUÍ NO SE REFRESCA NADA, Y ES A PROPÓSITO.
       *
       * `router.refresh()` rehace el árbol de servidor, este componente se monta
       * de nuevo y se lleva por delante el resultado que se acaba de pintar. Con
       * dos segundos de margen tampoco valía: es el único sitio donde se puede
       * leer POR QUÉ no se han publicado los precios, y dos segundos no dan para
       * leer una frase y menos para hacerle una captura.
       *
       * Se refresca cuando la persona lo pide, con el enlace de abajo. Una lista
       * un minuto desactualizada no le hace daño a nadie; perder el diagnóstico
       * justo cuando por fin aparece, sí.
       */
    } catch {
      setError('No hay conexión con el servidor')
    } finally {
      setTrabajando(false)
      void leerCuota()
    }
  }

  return (
    <div className="flex-shrink-0 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <button
          type="button"
          onClick={() => void forzar()}
          disabled={trabajando || sinCuota}
          className="flex h-7 items-center gap-1.5 rounded-lg border border-[#FF6600]/50 bg-[#FF6600]/10 px-2.5 text-[11px] text-white transition-colors hover:bg-[#FF6600]/20 disabled:cursor-not-allowed disabled:opacity-40"
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
          ) : sinCuota ? (
            <span className="text-amber-200/80">
              <strong className="font-medium">El proveedor no admite más llamadas esta hora.</strong>{' '}
              Son {cuota!.limite} por hora y ya van {cuota!.usadas} — el ciclo se lleva dos.
              {cuota!.seLiberaEn && (
                <> Se libera un hueco a las {hora(cuota!.seLiberaEn)}.</>
              )}
            </span>
          ) : (
            <>
              Adelanta el reloj: no espera a la cadencia y no se salta el fichero por ser el mismo.
              No enciende nada que esté apagado —perfil, simulacro o publicación de precios—, ni
              quita los frenos.
            </>
          )}
        </span>

        {cuota && !sinCuota && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-white/30">
            <Clock className="h-3 w-3" />
            {cuota.quedan} de {cuota.limite} llamadas al proveedor esta hora
          </span>
        )}
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-red-300/85">
          <AlertTriangle className="mt-px h-3 w-3 flex-shrink-0" />
          {error}
        </p>
      )}

      {salida && (
        <div className="mt-2 space-y-1.5 border-t border-white/[0.07] pt-2">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => router.refresh()}
              className="text-[10px] text-white/30 underline underline-offset-2 hover:text-white/60"
            >
              Actualizar el historial
            </button>
          </div>
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
