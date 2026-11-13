'use client'

import { useEffect, useState } from 'react'
import { Copy, Eye, FileBarChart, ExternalLink } from 'lucide-react'
import { toast } from 'sonner'

/**
 * EL ANÁLISIS DE AMAZON EN LA FICHA DEL LEAD.
 * Lo que el comercial necesita para la llamada, en corto: qué tipo de vendedor es y las frases clave (la chuleta, que el cliente no ve),
 * el enlace a su informe para abrirlo o copiarlo, y si el lead lo ha abierto y cuándo.
 */

type Analisis = {
  token: string
  fecha: string
  tipo: string | null
  guion: { tipo: string; frases: string[] } | null
  aperturas: number
  abiertoPrimera: string | null
  abiertoUltima: string | null
}

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function AnalisisDelLead({ leadId }: { leadId: string }) {
  const [a, setA] = useState<Analisis | null | undefined>(undefined)

  useEffect(() => {
    let vivo = true
    setA(undefined)
    fetch(`/api/cold-calling/analisis?lead=${leadId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { analisis: null }))
      .then((d: { analisis: Analisis | null }) => vivo && setA(d.analisis))
      .catch(() => vivo && setA(null))
    return () => {
      vivo = false
    }
  }, [leadId])

  if (!a) return null
  const url = `${window.location.origin}/analisis/${a.token}`

  return (
    <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">
          <FileBarChart className="h-3.5 w-3.5 text-[#FF6600]" aria-hidden />
          Análisis de Amazon
        </h3>
        <span className="text-[10.5px] text-[var(--ls-t4)]">{new Date(a.fecha).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
      </div>

      {a.guion && (
        <>
          <div className="mt-2 inline-flex rounded-full bg-[#FF6600]/12 px-2 py-0.5 text-[11px] font-semibold text-[#FF6600]">{a.guion.tipo}</div>
          <ul className="mt-2 space-y-1.5">
            {a.guion.frases.map((f) => (
              <li key={f} className="flex gap-1.5 text-[12px] leading-snug text-[var(--ls-t2)]">
                <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-[#FF6600]" aria-hidden />
                {f}
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-3 flex items-center gap-1.5">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-[#FF6600] px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Abrir informe
        </a>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard.writeText(url).then(
              () => toast.success('Enlace del informe copiado'),
              () => toast.error('No se ha podido copiar el enlace'),
            )
          }}
          className="inline-flex items-center gap-1.5 rounded-[6px] border border-[var(--ls-linea)] px-2.5 py-1.5 text-[12px] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)]"
          title="Copiar el enlace para mandarlo por WhatsApp o correo"
        >
          <Copy className="h-3.5 w-3.5" aria-hidden /> Copiar
        </button>
      </div>

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
        <Eye className="h-3 w-3" aria-hidden />
        {a.aperturas > 0 && a.abiertoUltima
          ? `Lo ha abierto ${a.aperturas === 1 ? 'una vez' : `${a.aperturas} veces`} · última: ${cuando(a.abiertoUltima)}`
          : 'Todavía no lo ha abierto'}
      </p>
    </section>
  )
}
