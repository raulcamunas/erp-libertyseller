'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, ArrowRight, Loader2, Send, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { BOTON, COLOR_ESTADO } from '@/lib/estilo/denso'
import type { CajasDeRemesa } from '@/lib/fba/cajas'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { puedeAvanzar, siguientesPasos, type Actor, type EstadoRemesa } from '@/lib/fba/flujo'
import { turnoDe } from '@/lib/fba/vista'
import { cx } from '../comun/ui'

/**
 * LA BARRA DE «¿Y AHORA QUÉ?», PEGADA ABAJO.
 *
 * Solo salen los pasos que ESTE actor puede dar desde ESTE estado, y el principal
 * dice antes de pulsarlo qué va a pasar. Si no se puede dar todavía, el botón NO
 * desaparece: sale apagado con la lista de lo que falta, entera y de una vez.
 * Esconderlo obliga a adivinar por qué no está.
 *
 * Marcar como enviada no es un clic: abre el diálogo que pide el número de envío
 * FBA y lo comprueba contra Amazon. La decisión de si se puede es SIEMPRE de
 * lib/fba/flujo.ts; la ruta la vuelve a comprobar con lo que hay en la base.
 */

const ORDEN: EstadoRemesa[] = ['borrador', 'aprobada', 'encajando', 'lista', 'enviada', 'cerrada']

export function BarraAcciones({
  remesa,
  actor,
  cajas,
  onMarcarEnviada,
}: {
  remesa: RemesaDePanel
  actor: Actor
  cajas: CajasDeRemesa | null
  onMarcarEnviada: () => void
}) {
  const router = useRouter()
  const [moviendo, setMoviendo] = useState<EstadoRemesa | null>(null)

  const pasos = siguientesPasos(remesa.estado, actor)
  const desde = ORDEN.indexOf(remesa.estado)
  const adelante = pasos.filter((p) => ORDEN.indexOf(p.hasta) > desde)
  const atras = pasos.filter((p) => ORDEN.indexOf(p.hasta) < desde)
  const principal = adelante[0] ?? null

  const permiso = principal
    ? puedeAvanzar(remesa.estado, principal.hasta, actor, {
        lineas: remesa.lineas.length,
        cuadre: cajas?.cuadre,
        cajas: cajas?.estado,
        // El número se pide en el diálogo, justo al pulsar: aquí no puede bloquear
        referencia: 'se-pide-al-pulsar',
      })
    : null

  async function mover(hasta: EstadoRemesa) {
    if (hasta === 'enviada') return onMarcarEnviada()
    setMoviendo(hasta)
    try {
      const res = await fetch(`/api/fba/remesas/${remesa.id}/estado`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hasta }),
      })
      const p = (await res.json().catch(() => null)) as { error?: string; motivos?: string[] } | null
      if (!res.ok) {
        // Se enseñan TODOS los motivos, uno por línea: arreglar de uno en uno
        // obliga a reintentar tantas veces como cosas falten.
        toast.error(p?.motivos?.join('\n') ?? p?.error ?? 'No se ha podido mover')
        return
      }
      toast.success('Hecho')
      router.refresh()
    } finally {
      setMoviendo(null)
    }
  }

  const turno = turnoDe(remesa.estado, remesa.lineas.length)
  const mensaje = actor === 'agencia' ? turno.paraAgencia : turno.paraCliente

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-3 py-[9px] shadow-[0_-6px_14px_-10px_rgba(0,0,0,0.6)]">
      <div className="min-w-[220px] flex-1">
        {permiso && !permiso.puede ? (
          <ul className="space-y-[2px]">
            {permiso.motivos.map((m) => (
              <li key={m.texto} className="flex items-start gap-[6px] text-[12px] leading-[1.45] text-[var(--ls-t2)]">
                <AlertTriangle className="mt-[2px] h-3 w-3 shrink-0" style={{ color: COLOR_ESTADO.ambar }} />
                {m.texto}
              </li>
            ))}
          </ul>
        ) : principal ? (
          <p className="text-[12px] leading-[1.45] text-[var(--ls-t3)]">
            <b className="font-semibold text-[var(--ls-t2)]">Siguiente:</b> {principal.consecuencia}
          </p>
        ) : (
          <p className="text-[12px] text-[var(--ls-t3)]">{mensaje}</p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {atras.map((p) => (
          <button
            key={p.hasta}
            type="button"
            onClick={() => void mover(p.hasta)}
            disabled={moviendo !== null}
            title={p.consecuencia}
            className={cx(BOTON.base, BOTON.alto, BOTON.secundario)}
          >
            {moviendo === p.hasta ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
            {p.boton}
          </button>
        ))}
        {principal && (
          <button
            type="button"
            onClick={() => void mover(principal.hasta)}
            disabled={!permiso?.puede || moviendo !== null}
            title={permiso?.puede ? principal.consecuencia : permiso?.motivos.map((m) => m.texto).join('. ')}
            className={cx(BOTON.base, 'h-8 px-4 text-[12.5px]', BOTON.primario)}
          >
            {moviendo === principal.hasta ? (
              <Loader2 className="h-[14px] w-[14px] animate-spin" />
            ) : principal.hasta === 'enviada' ? (
              <Send className="h-[14px] w-[14px]" />
            ) : (
              <ArrowRight className="h-[14px] w-[14px]" />
            )}
            {principal.boton}
          </button>
        )}
      </div>
    </div>
  )
}
