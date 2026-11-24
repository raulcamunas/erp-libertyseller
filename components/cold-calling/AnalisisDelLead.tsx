'use client'

import { useEffect, useState } from 'react'
import { Copy, Eye, FileBarChart, ExternalLink, Loader2, Mail, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { EnviarAnalisisPorCorreo } from './EnviarAnalisisPorCorreo'

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
  /** Solo en el de una tienda sin Amazon: si se puede mandar tal cual y qué mirar antes */
  calidad?: { nivel: 'bueno' | 'revisar' | 'flojo'; motivos: string[] } | null
  aperturas: number
  abiertoPrimera: string | null
  abiertoUltima: string | null
  correoEnviadoAt?: string | null
  baja?: boolean
}

/** Un «Generar informe» pedido: en cola (puesto y minutos estimados) o que no se pudo (motivo) */
type Pedido =
  | { estado: 'pendiente'; puesto: number; minutos: { min: number; max: number } | null; pedidoAt: string }
  | { estado: 'saltado'; motivo: string; resueltoAt: string | null }
  | null

const hhmm = (d: Date) => d.toLocaleTimeString('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit' })

/** «hacia las 12:48 (unos 9 min)» o «entre las 12:46 y las 13:05» */
function cuandoEstara(m: { min: number; max: number }): string {
  const ahora = Date.now()
  const a = new Date(ahora + m.min * 60_000)
  const b = new Date(ahora + m.max * 60_000)
  return m.max - m.min <= 2 ? `hacia las ${hhmm(b)} (unos ${m.max} min)` : `entre las ${hhmm(a)} y las ${hhmm(b)} (${m.min}-${m.max} min)`
}

const cuando = (iso: string) =>
  new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function AnalisisDelLead({ leadId }: { leadId: string }) {
  const [a, setA] = useState<Analisis | null | undefined>(undefined)
  const [pedido, setPedido] = useState<Pedido>(null)
  const [pidiendo, setPidiendo] = useState(false)
  const [correo, setCorreo] = useState(false)
  const [vuelta, setVuelta] = useState(0)

  useEffect(() => {
    let vivo = true
    if (vuelta === 0) setA(undefined)
    fetch(`/api/cold-calling/analisis?lead=${leadId}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { analisis: null }))
      .then((d: { analisis: Analisis | null; pedido?: Pedido }) => {
        if (!vivo) return
        setA(d.analisis)
        setPedido(d.pedido ?? null)
      })
      .catch(() => vivo && setA(null))
    return () => {
      vivo = false
    }
  }, [leadId, vuelta])

  // Mientras está en cola, se vuelve a mirar cada minuto: cuando sale, la ficha pasa sola a enseñar el informe
  const enCola = !a && pedido?.estado === 'pendiente'
  useEffect(() => {
    if (!enCola) return
    const t = setInterval(() => setVuelta((v) => v + 1), 60_000)
    return () => clearInterval(t)
  }, [enCola])

  const generar = async () => {
    setPidiendo(true)
    try {
      const r = await fetch(`/api/cold-calling/analisis?lead=${leadId}`, { method: 'POST' })
      const d = (await r.json().catch(() => ({}))) as { pedido?: Pedido; error?: string }
      if (!r.ok) {
        toast.error(d.error ?? 'No se ha podido pedir el informe')
        if (r.status === 409) setVuelta((v) => v + 1)
        return
      }
      setPedido(d.pedido ?? null)
      const p = d.pedido
      toast.success(p?.estado === 'pendiente' && p.minutos ? `Informe en cola: estará ${cuandoEstara(p.minutos)}` : 'Informe en cola: te avisamos en la campana cuando esté')
    } finally {
      setPidiendo(false)
    }
  }

  if (a === undefined) return null
  if (!a) {
    return (
      <section className="rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
        <h3 className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ls-t3)]">
          <FileBarChart className="h-3.5 w-3.5 text-[#FF6600]" aria-hidden />
          Análisis de Amazon
        </h3>
        {pedido?.estado === 'pendiente' ? (
          <div className="mt-2 rounded-[6px] border border-[#FF6600]/30 bg-[#FF6600]/10 px-2.5 py-2 text-[12px] leading-snug text-[var(--ls-t2)]">
            <b className="flex items-center gap-1.5 text-[11.5px] text-[#FF6600]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
              Generándose · {pedido.puesto === 1 ? 'el primero de la cola' : `puesto ${pedido.puesto} de la cola urgente`}
            </b>
            <span className="mt-1 block">
              {pedido.minutos ? `Estará ${cuandoEstara(pedido.minutos)}.` : 'Estará en unos minutos.'} Te avisamos en la campana y aparece aquí solo.
            </span>
          </div>
        ) : (
          <>
            <p className="mt-1.5 text-[11.5px] leading-snug text-[var(--ls-t4)]">
              {pedido?.estado === 'saltado'
                ? `La última vez no se pudo sacar: ${pedido.motivo}.`
                : 'Este lead todavía no tiene informe. Si lo necesitas ya, pídelo: pasa el primero de la cola.'}
            </p>
            <button
              type="button"
              onClick={() => void generar()}
              disabled={pidiendo}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-[#FF6600] px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-60"
            >
              {pidiendo ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Zap className="h-3.5 w-3.5" aria-hidden />}
              {pedido?.estado === 'saltado' ? 'Volver a intentarlo' : 'Generar informe'}
            </button>
          </>
        )}
      </section>
    )
  }
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

      {a.calidad && a.calidad.nivel !== 'bueno' && (
        <div
          className={`mt-2 rounded-[6px] border px-2.5 py-2 text-[11.5px] leading-snug ${
            a.calidad.nivel === 'flojo' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300'
          }`}
        >
          <b className="block text-[11px] uppercase tracking-wide">{a.calidad.nivel === 'flojo' ? 'Informe flojo: no se manda' : 'Míralo antes de mandarlo'}</b>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {a.calidad.motivos.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

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

      {a.baja ? (
        <p className="mt-2 text-[11px] text-[var(--ls-t4)]">Pidió no recibir más correos: no se le puede mandar.</p>
      ) : a.calidad?.nivel === 'flojo' ? null : (
        <button
          type="button"
          onClick={() => setCorreo(true)}
          className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-[6px] border border-[#FF6600]/40 px-2.5 py-1.5 text-[12px] font-semibold text-[#FF6600] hover:bg-[#FF6600]/10"
        >
          <Mail className="h-3.5 w-3.5" aria-hidden /> {a.correoEnviadoAt ? `Enviado el ${cuando(a.correoEnviadoAt)} · reenviar` : 'Enviar por correo'}
        </button>
      )}
      {correo && <EnviarAnalisisPorCorreo leadId={leadId} alCerrar={() => setCorreo(false)} alEnviar={() => setVuelta((v) => v + 1)} />}

      <p className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
        <Eye className="h-3 w-3" aria-hidden />
        {a.aperturas > 0 && a.abiertoUltima
          ? `Lo ha abierto ${a.aperturas === 1 ? 'una vez' : `${a.aperturas} veces`} · última: ${cuando(a.abiertoUltima)}`
          : 'Todavía no lo ha abierto'}
      </p>
    </section>
  )
}
