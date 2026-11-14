'use client'

import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { CircleCheck, Clock, Download, Loader2, Printer, ShieldCheck, Truck } from 'lucide-react'
import type { TransporteParaElCliente } from '@/lib/fba/envio-amazon-motor'
import { FUENTE_TITULO, cx } from '@/components/encaje/marca'

/**
 * EL TRANSPORTE EN EL PORTAL DEL CLIENTE: COTIZACIÓN, «ACEPTO EL COSTE» Y ETIQUETAS.
 *
 * Solo aparece cuando la agencia hace el envío desde el ERP (modo «api») y ya hay cotización de UPS. El
 * cliente ve el coste, hasta cuándo vale y acepta con su nombre (se guardan fecha, IP y el coste que vio).
 * Aceptar NO confirma nada en Amazon: después lo confirma la agencia. Con el transporte confirmado, aquí
 * mismo descarga las etiquetas de caja (con la de UPS) para pegarlas.
 *
 * Lee una vez al abrir y al volver a la pestaña. Sin sondeos.
 */

const dinero = (n: number | null, moneda: string | null) => (n === null ? '—' : `${n.toLocaleString('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${moneda === 'EUR' || !moneda ? '€' : moneda}`)
const fechaHora = (iso: string | null) => (iso ? new Date(iso).toLocaleString('es-ES', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : '—')
const fechaDia = (dia: string | null) => (dia ? new Date(`${dia}T12:00:00Z`).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }) : '—')

export function TransporteCliente({ token }: { token: string }) {
  const [t, setT] = useState<TransporteParaElCliente | null>(null)
  const [nombre, setNombre] = useState('')
  const [aceptando, setAceptando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hoja, setHoja] = useState<'a4_2' | 'termica'>('a4_2')
  const [pidiendo, setPidiendo] = useState(false)
  const [enlaces, setEnlaces] = useState<Array<{ confirmacion: string | null; cajas: number; url: string | null; error: string | null }>>([])

  const leer = useCallback(async () => {
    try {
      const res = await fetch(`/api/publico/envio/${token}/transporte`, { cache: 'no-store' })
      if (res.ok) setT(((await res.json()) as { transporte: TransporteParaElCliente | null }).transporte)
    } catch {
      /* sin conexión: se queda lo que hay */
    }
  }, [token])

  useEffect(() => {
    void leer()
    const alVolver = () => document.visibilityState === 'visible' && void leer()
    document.addEventListener('visibilitychange', alVolver)
    return () => document.removeEventListener('visibilitychange', alVolver)
  }, [leer])

  if (!t || !t.visible) return null

  async function aceptar() {
    if (!t) return
    setAceptando(true)
    setError(null)
    try {
      const res = await fetch(`/api/publico/envio/${token}/transporte`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre, coste: t.coste }) })
      const j = (await res.json().catch(() => null)) as { transporte?: TransporteParaElCliente; error?: string } | null
      if (!res.ok) {
        setError(j?.error ?? 'No se ha podido guardar. Vuelve a probar.')
        void leer()
        return
      }
      if (j?.transporte) setT(j.transporte)
    } finally {
      setAceptando(false)
    }
  }

  async function descargar() {
    setPidiendo(true)
    setError(null)
    try {
      const res = await fetch(`/api/publico/envio/${token}/transporte/etiquetas`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ hoja }) })
      const j = (await res.json().catch(() => null)) as { enlaces?: typeof enlaces; error?: string } | null
      if (!res.ok) {
        setError(j?.error ?? 'No se han podido generar las etiquetas')
        return
      }
      setEnlaces(j?.enlaces ?? [])
      const primera = j?.enlaces?.find((x) => x.url)
      if (primera?.url) window.open(primera.url, '_blank', 'noopener')
    } finally {
      setPidiendo(false)
    }
  }

  const confirmado = !!t.confirmadoAt
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="overflow-hidden rounded-3xl border border-[#E5E1DB] bg-[#FFFFFF]">
      <div className="bg-gradient-to-br from-[#FBEFE8] to-[#FFFFFF] p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-[#2B2B2B] to-[#0E0E0E] text-[#F26212]">
            <Truck className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold uppercase tracking-[0.08em] text-[#8C857C]">Transporte con {t.transportistas.join(', ') || 'UPS'} (de Amazon)</p>
            <p className="mt-1 text-[34px] leading-none tabular-nums text-[#141414]" style={{ fontFamily: FUENTE_TITULO, fontWeight: 600 }}>
              {dinero(t.coste, t.moneda)}
            </p>
            <p className="mt-2 text-[14px] leading-relaxed text-[#5E5852]">
              Lo cobra Amazon en tu cuenta de vendedor. {t.envios.length} envío{t.envios.length === 1 ? '' : 's'} · recogida el {fechaDia(t.recogida)}.
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4 p-6 sm:p-8">
        {t.aceptacion ? (
          <p className="flex items-start gap-3 rounded-2xl bg-[#E4F3EA] px-4 py-3 text-[14px] text-[#1F5A36]">
            <CircleCheck className="mt-[1px] h-5 w-5 shrink-0" />
            <span>
              Aceptado por <b>{t.aceptacion.nombre}</b> el {fechaHora(t.aceptacion.at)} ({dinero(t.aceptacion.coste, t.moneda)}).{' '}
              {confirmado ? 'Liberty Seller ha confirmado el transporte.' : 'Liberty Seller lo confirmará con Amazon.'}
            </span>
          </p>
        ) : t.puedeAceptar ? (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-[13.5px] text-[#8A5A14]">
              <Clock className="h-4 w-4" /> Este precio vale hasta el {fechaHora(t.caduca)}.
            </p>
            <label className="block text-[13px] text-[#5E5852]">
              Tu nombre
              <input
                value={nombre}
                onChange={(v) => setNombre(v.target.value)}
                autoComplete="name"
                placeholder="Nombre y apellidos"
                className="mt-1 h-12 w-full rounded-2xl border border-[#E5E1DB] bg-[#FFFFFF] px-4 text-[15px] text-[#141414] outline-none focus:border-[#F26212]"
              />
            </label>
            <button
              type="button"
              onClick={() => void aceptar()}
              disabled={aceptando || nombre.trim().length < 2}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#F26212] px-6 text-[15px] font-semibold text-[#FFFFFF] transition hover:brightness-105 disabled:opacity-50 sm:w-auto"
            >
              {aceptando ? <Loader2 className="h-5 w-5 animate-spin" /> : <ShieldCheck className="h-5 w-5" />}
              Acepto el coste del transporte
            </button>
            <p className="text-[12px] text-[#8C857C]">Se guarda la fecha, tu nombre y desde dónde lo aceptas.</p>
          </div>
        ) : (
          <p className="rounded-2xl bg-[#F7F5F2] px-4 py-3 text-[14px] text-[#5E5852]">{t.vigente ? 'Liberty Seller está preparando el transporte.' : 'Esta cotización ha caducado. Liberty Seller pedirá una nueva y te avisará.'}</p>
        )}

        {confirmado && t.anulableHasta && Date.parse(t.anulableHasta) > Date.now() && <p className="text-[12.5px] text-[#8C857C]">Se puede anular sin coste hasta el {fechaHora(t.anulableHasta)}.</p>}

        {t.etiquetasDisponibles && (
          <div className="rounded-2xl border border-[#E5E1DB] p-4">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-[#141414]">
              <Printer className="h-5 w-5 text-[#F26212]" /> Etiquetas de las cajas
            </p>
            <p className="mt-1 text-[13.5px] text-[#5E5852]">Una por caja, con la de UPS. Pégalas en un lado de la caja, sin tapar costuras.</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="inline-flex rounded-2xl bg-[#F7F5F2] p-1" role="radiogroup" aria-label="Tipo de papel">
                {(
                  [
                    ['a4_2', 'Folio A4'],
                    ['termica', 'Impresora térmica'],
                  ] as const
                ).map(([id, texto]) => (
                  <button key={id} type="button" role="radio" aria-checked={hoja === id} onClick={() => setHoja(id)} className={cx('h-11 rounded-xl px-4 text-[13.5px]', hoja === id ? 'bg-[#FFFFFF] font-semibold text-[#141414] shadow-sm' : 'text-[#5E5852]')}>
                    {texto}
                  </button>
                ))}
              </div>
              <button type="button" onClick={() => void descargar()} disabled={pidiendo} className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[#141414] px-5 text-[14.5px] font-semibold text-[#FFFFFF] disabled:opacity-60">
                {pidiendo ? <Loader2 className="h-5 w-5 animate-spin" /> : <Download className="h-5 w-5" />}
                Descargar etiquetas
              </button>
            </div>
            {enlaces.length > 0 && (
              <ul className="mt-3 space-y-2">
                {enlaces.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-[13.5px]">
                    <span className="font-mono text-[#141414]">
                      {l.confirmacion ?? `Envío ${i + 1}`} · {l.cajas} caja{l.cajas === 1 ? '' : 's'}
                    </span>
                    {l.url ? (
                      <a href={l.url} target="_blank" rel="noopener noreferrer" className="font-semibold text-[#F26212]">
                        Abrir PDF
                      </a>
                    ) : (
                      <span className="text-[#B4442E]">{l.error}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-[13.5px] text-[#B4442E]">{error}</p>}
      </div>
    </motion.section>
  )
}
