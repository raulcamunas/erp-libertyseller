'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Check, FileText, Plus, Trash2 } from 'lucide-react'
import { eurosPrecise, type TreasuryExtra } from '@/lib/types/treasury'

/**
 * LOS SUBENCARGOS DE UN CLIENTE EN UN MES, DESPLEGADOS DEBAJO DE SU FILA EN TESORERÍA.
 *
 * Creatividades, packaging, un estudio… Cada uno con su concepto y lo que nos paga el cliente por él. Suma en el total del
 * cliente y en los ingresos del mes, y se factura aparte desde Facturación (una factura por subencargo). Enviado y cobrado
 * los pone Facturación al enviar y cobrar en Zoho; aquí se pueden marcar a mano, como las del mes.
 */

const celda = 'px-1 py-1'
const campo =
  'w-full bg-transparent hover:bg-white/[0.05] focus:bg-white/[0.08] border border-transparent focus:border-[#FF6600] rounded px-1.5 py-1 text-[11.5px] text-white/85 outline-none transition-colors placeholder:text-white/25'

export function FilasDeSubencargos({
  subencargos,
  onGuardar,
  onAnadir,
  onBorrar,
}: {
  subencargos: TreasuryExtra[]
  onGuardar: (id: string, cambio: Partial<TreasuryExtra>) => void
  onAnadir: (concepto: string, importe: number) => Promise<boolean>
  onBorrar: (x: TreasuryExtra) => void
}) {
  const [concepto, setConcepto] = useState('')
  const [importe, setImporte] = useState('')
  const [guardando, setGuardando] = useState(false)

  async function anadir() {
    const n = Number(importe.replace(',', '.'))
    if (!concepto.trim() || !(n > 0)) return
    setGuardando(true)
    const ok = await onAnadir(concepto.trim(), Math.round(n * 100) / 100)
    setGuardando(false)
    if (ok) {
      setConcepto('')
      setImporte('')
    }
  }

  const casilla = (activa: boolean, color: 'amarillo' | 'verde') =>
    `h-5 w-5 rounded border flex items-center justify-center transition-colors mx-auto ${
      activa
        ? color === 'amarillo'
          ? 'bg-yellow-400/25 border-yellow-400/60 text-yellow-300'
          : 'bg-green-500/25 border-green-500/50 text-green-300'
        : 'border-white/15 text-transparent hover:border-white/35'
    }`

  return (
    <>
      {subencargos.map((x) => (
        <tr key={x.id} className="bg-white/[0.015] border-b border-white/[0.03]">
          <td className={`${celda} pl-6`} colSpan={3}>
            <span className="flex items-center gap-1.5">
              <span className="h-3 w-3 shrink-0 border-l border-b border-white/20 rounded-bl -mt-2" aria-hidden />
              <input
                defaultValue={x.concept}
                key={`c-${x.id}`}
                onBlur={(e) => {
                  const v = e.target.value.trim()
                  if (v && v !== x.concept) onGuardar(x.id, { concept: v })
                  else e.target.value = x.concept
                }}
                className={campo}
                title="Concepto: es lo que sale en la factura"
              />
              {x.zoho_invoice_id ? (
                <span className="shrink-0 inline-flex items-center gap-1 text-[10px] text-white/45" title="Ya tiene su factura en Zoho">
                  <FileText className="h-3 w-3" /> Facturado
                </span>
              ) : (
                <Link href="/dashboard/facturacion" className="shrink-0 text-[10px] text-[#FF8A3D] hover:underline" title="Se factura aparte: en Facturación sale como una fila propia">
                  Facturar →
                </Link>
              )}
            </span>
          </td>
          <td className={celda}>
            <input
              defaultValue={String(x.amount)}
              key={`a-${x.id}`}
              inputMode="decimal"
              onBlur={(e) => {
                const n = Number(e.target.value.trim().replace(',', '.'))
                if (!(n >= 0) || Number.isNaN(n)) {
                  e.target.value = String(x.amount)
                  return
                }
                if (n !== Number(x.amount)) onGuardar(x.id, { amount: Math.round(n * 100) / 100 })
              }}
              className={`${campo} text-right tabular-nums`}
              title="Lo que nos paga el cliente por él, sin IVA"
            />
          </td>
          <td className="px-2 py-1 text-right text-white/80 tabular-nums">
            <span className="inline-flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onBorrar(x)}
                className="text-white/20 hover:text-red-400 transition-colors"
                title={x.zoho_invoice_id ? 'Quitar de Tesorería (la factura de Zoho se queda)' : 'Quitar este subencargo'}
              >
                <Trash2 className="h-3 w-3" />
              </button>
              {eurosPrecise(Number(x.amount))}
            </span>
          </td>
          <td className="px-1 py-1 text-center">
            <button type="button" onClick={() => onGuardar(x.id, { invoice_sent: !x.invoice_sent })} className={casilla(x.invoice_sent, 'amarillo')} title={x.invoice_sent ? 'Factura enviada' : 'Marcar como enviada'}>
              <Check className="h-3 w-3" />
            </button>
          </td>
          <td className="px-1 py-1 text-center">
            <button type="button" onClick={() => onGuardar(x.id, { paid: !x.paid })} className={casilla(x.paid, 'verde')} title={x.paid ? 'Cobrado' : 'Marcar como cobrado'}>
              <Check className="h-3 w-3" />
            </button>
          </td>
        </tr>
      ))}
      <tr className="bg-white/[0.015] border-b border-white/[0.06]">
        <td className={`${celda} pl-6`} colSpan={3}>
          <span className="flex items-center gap-1.5">
            <Plus className="h-3 w-3 shrink-0 text-white/30" />
            <input
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void anadir()}
              placeholder="Nuevo subencargo: creatividades, packaging, estudio…"
              className={campo}
            />
          </span>
        </td>
        <td className={celda}>
          <input
            value={importe}
            onChange={(e) => setImporte(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void anadir()}
            inputMode="decimal"
            placeholder="€"
            className={`${campo} text-right tabular-nums`}
          />
        </td>
        <td className="px-2 py-1 text-right" colSpan={3}>
          <button
            type="button"
            disabled={guardando || !concepto.trim() || !(Number(importe.replace(',', '.')) > 0)}
            onClick={() => void anadir()}
            className="rounded px-2 py-0.5 text-[11px] font-medium text-[#FF8A3D] hover:bg-[#FF6600]/10 disabled:opacity-35 disabled:hover:bg-transparent transition-colors"
          >
            Añadir
          </button>
        </td>
      </tr>
    </>
  )
}
