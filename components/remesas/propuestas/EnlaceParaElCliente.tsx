'use client'

import { useCallback, useEffect, useState } from 'react'
import { Link2, Loader2, RefreshCw, TriangleAlert } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, TIPO } from '@/lib/estilo/denso'
import { sinRespuestaDe } from '../comun/errores'
import { cx } from '../comun/ui'

/**
 * «QUE EL CLIENTE ENCAJE SIN ENTRAR AL ERP»: COPIAR EL ENLACE Y VER QUÉ HACE CON ÉL.
 *
 * Mientras el envío está en «Encajando» el turno es del cliente, y esperar a que entre al ERP con su
 * usuario y su contraseña para repartir unas unidades en unas cajas es justo lo que lo atasca. Aquí se
 * copia un enlace a una página con la marca de Liberty Seller (app/encajar/[token]) donde lo hace sin
 * cuenta: reparte las unidades en cajas, pone medidas y pesos y pulsa «He terminado».
 *
 * El enlace es una CREDENCIAL: cualquiera que lo tenga puede cambiar las cajas de ESTE envío y darlo
 * por terminado. Por eso la tarjeta lo dice al copiarlo, enseña cuántas veces se ha abierto y cuándo
 * se tocó por última vez, y deja desactivarlo con un clic. Solo sale para quien puede editar.
 *
 * Lo que va encajando el cliente se guarda en las MISMAS cajas que este editor, pero este no lo sabe
 * hasta que se recarga: de ahí el botón «Ver lo encajado».
 */

interface Enlace {
  url: string
  creadoAt: string
  caducaAt: string
  abiertoVeces: number
  ultimoUsoAt: string | null
  ultimaEdicionAt: string | null
  terminadoAt: string | null
}

/** «ahora mismo», «hace 12 min», «hace 3 h», «hace 2 días» */
function haceUnRato(iso: string | null, ahora = Date.now()): string {
  if (!iso) return 'nunca'
  const min = Math.max(0, Math.round((ahora - Date.parse(iso)) / 60_000))
  if (min < 1) return 'ahora mismo'
  if (min < 60) return `hace ${min} min`
  if (min < 60 * 24) return `hace ${Math.round(min / 60)} h`
  const d = Math.round(min / (60 * 24))
  return `hace ${d} día${d === 1 ? '' : 's'}`
}

const fechaCorta = (iso: string) => new Date(iso).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: '2-digit' })

export function EnlaceParaElCliente({ remesaId }: { remesaId: string }) {
  const [enlace, setEnlace] = useState<Enlace | null>(null)
  const [sinMigrar, setSinMigrar] = useState(false)
  const [cargando, setCargando] = useState(true)
  const [trabajando, setTrabajando] = useState<'copiar' | 'desactivar' | null>(null)

  const cargar = useCallback(async () => {
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/enlace`, { cache: 'no-store' })
      if (!res.ok) return
      const p = (await res.json()) as { enlace: Enlace | null; sinMigrar?: boolean }
      setEnlace(p.enlace)
      setSinMigrar(!!p.sinMigrar)
    } catch {
      /* sin enlace que enseñar: la tarjeta sigue ofreciendo crearlo */
    } finally {
      setCargando(false)
    }
  }, [remesaId])

  useEffect(() => {
    void cargar()
  }, [cargar])

  async function copiar() {
    setTrabajando('copiar')
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/enlace`, { method: 'POST' })
      const p = (await res.json().catch(() => null)) as { enlace?: Enlace; error?: string } | null
      if (!res.ok || !p?.enlace) {
        toast.error(p?.error ?? sinRespuestaDe('No se ha podido crear el enlace', res.status))
        return
      }
      setEnlace(p.enlace)
      try {
        await navigator.clipboard.writeText(p.enlace.url)
        toast.success('Enlace copiado. Quien lo tenga puede encajar este envío, sin contraseña.')
      } catch {
        // Sin permiso para el portapapeles (o sin https): la dirección queda a la vista en la tarjeta para copiarla a mano
        toast.warning('No se ha podido copiar solo. La dirección está en la tarjeta: selecciónala y cópiala.')
      }
    } catch {
      toast.error('Se ha cortado la conexión con el servidor. Si la aplicación se estaba actualizando, espera un minuto; si no, revisa la conexión.')
    } finally {
      setTrabajando(null)
    }
  }

  async function desactivar() {
    setTrabajando('desactivar')
    try {
      const res = await fetch(`/api/fba/remesas/${remesaId}/enlace`, { method: 'DELETE' })
      const p = (await res.json().catch(() => null)) as { error?: string } | null
      if (!res.ok) {
        toast.error(p?.error ?? sinRespuestaDe('No se ha podido desactivar el enlace', res.status))
        return
      }
      setEnlace(null)
      toast.success('Enlace desactivado: ya no abre nada.')
    } finally {
      setTrabajando(null)
    }
  }

  return (
    <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-[260px] flex-1 items-start gap-3">
          <span className="mt-[1px] flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
            <Link2 className="h-[15px] w-[15px]" />
          </span>
          <div className="min-w-0">
            <h3 className={cx(TIPO.l, 'text-[var(--ls-t1)]')}>Que el cliente encaje sin entrar al ERP</h3>
            <p className="mt-[2px] text-[12px] leading-[1.5] text-[var(--ls-t3)]">
              Copia un enlace y mándaselo: abre una página con la marca de Liberty Seller donde reparte las unidades en cajas y pone medidas y pesos. Sin usuario ni contraseña.
            </p>
          </div>
        </div>
        <button type="button" onClick={() => void copiar()} disabled={trabajando !== null || cargando} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
          {trabajando === 'copiar' ? <Loader2 className="h-3 w-3 animate-spin" /> : <Link2 className="h-3 w-3" />}
          {enlace ? 'Copiar el enlace otra vez' : 'Copiar enlace público'}
        </button>
      </div>

      {sinMigrar && (
        <p className="flex items-start gap-2 border-t border-[var(--ls-linea)] px-4 py-2 text-[12px] leading-[1.5] text-[var(--ls-t2)]">
          <TriangleAlert className="mt-[2px] h-3 w-3 shrink-0" style={{ color: 'var(--ls-e-ambar)' }} />
          Falta lanzar la migración 232_fba_enlaces_encaje.sql en Supabase: hasta entonces el enlace no se puede crear.
        </p>
      )}

      {enlace && (
        <div className="space-y-2 border-t border-[var(--ls-linea)] px-4 py-3">
          <input
            readOnly
            value={enlace.url}
            onFocus={(e) => e.currentTarget.select()}
            aria-label="Dirección del enlace para el cliente"
            className="h-7 w-full rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 font-mono text-[11.5px] text-[var(--ls-t2)] focus:border-[var(--ls-acc-graf)] focus:outline-none"
          />
          {enlace.ultimaEdicionAt && !enlace.terminadoAt && (
            <p className="flex items-start gap-[6px] text-[11.5px] leading-[1.45] text-[var(--ls-t4)]">
              <TriangleAlert className="mt-[2px] h-3 w-3 shrink-0" style={{ color: 'var(--ls-e-ambar)' }} />
              El cliente ya ha tocado las cajas. Si las cambias aquí a la vez que él, lo último que se guarde pisa lo anterior: recarga antes con «Ver lo encajado».
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-[var(--ls-t3)]">
            <span className="inline-flex items-center gap-[6px]">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: enlace.terminadoAt ? 'var(--ls-e-verde)' : 'var(--ls-acc-graf)' }} />
              {enlace.terminadoAt ? `Terminado ${haceUnRato(enlace.terminadoAt)}` : `Activo hasta el ${fechaCorta(enlace.caducaAt)}`}
            </span>
            <span>{enlace.abiertoVeces === 0 ? 'Todavía no lo ha abierto' : `Abierto ${enlace.abiertoVeces} ${enlace.abiertoVeces === 1 ? 'vez' : 'veces'} · la última ${haceUnRato(enlace.ultimoUsoAt)}`}</span>
            {enlace.ultimaEdicionAt && <span>Tocó las cajas {haceUnRato(enlace.ultimaEdicionAt)}</span>}
            <span className="ml-auto flex items-center gap-2">
              <button type="button" onClick={() => window.location.reload()} className={cx(BOTON.base, BOTON.secundario)} title="Recargar la propuesta para ver lo que ha encajado el cliente">
                <RefreshCw className="h-3 w-3" />
                Ver lo encajado
              </button>
              <button type="button" onClick={() => void desactivar()} disabled={trabajando !== null} className={cx(BOTON.base, BOTON.secundario, 'hover:!text-[var(--ls-e-rojo)]')} title="Quien tenga el enlace dejará de poder entrar">
                {trabajando === 'desactivar' && <Loader2 className="h-3 w-3 animate-spin" />}
                Desactivar
              </button>
            </span>
          </div>
        </div>
      )}
    </section>
  )
}
