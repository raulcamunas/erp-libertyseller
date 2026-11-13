'use client'

import { Loader2, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from '@/components/correo/ui'
import type { InformeAnalisis } from '@/lib/analisis-amazon/construir'
import { correoAnalisisHtml, type DatosCorreoAnalisis } from '@/lib/analisis-amazon/correo'
import { avisarCorreoEnviadoALead } from '@/lib/correo/peticiones'

/**
 * MANDAR EL ANÁLISIS POR CORREO DESDE LA FICHA DEL LEAD.
 * La IA escribe asunto y entradilla para ESTE lead (según si es un primer contacto, si no se le ha cogido, si ya se habló o si dijo que no);
 * a la derecha se ve el correo tal cual le llegará, y cambia al retocar el texto. Sale desde el buzón de quien lo envía y queda en el historial.
 */

type Preparado = {
  para: string
  desde: string
  asunto: string
  saludo: string
  entradilla: string
  deIa: boolean
  situacion: string
  enviadoAt: string | null
  informe: InformeAnalisis
  datos: DatosCorreoAnalisis
}

const cuando = (iso: string) => new Date(iso).toLocaleString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

export function EnviarAnalisisPorCorreo({ leadId, alCerrar, alEnviar }: { leadId: string; alCerrar: () => void; alEnviar: () => void }) {
  const [p, setP] = useState<Preparado | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [para, setPara] = useState('')
  const [asunto, setAsunto] = useState('')
  const [saludo, setSaludo] = useState('')
  const [entradilla, setEntradilla] = useState('')

  async function preparar() {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/cold-calling/analisis/correo?lead=${leadId}`, { cache: 'no-store' })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'No se ha podido preparar el correo')
      setP(d)
      setPara((x) => x || d.para)
      setAsunto(d.asunto)
      setSaludo(d.saludo)
      setEntradilla(d.entradilla)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setCargando(false)
    }
  }

  useEffect(() => {
    void preparar()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && !enviando && alCerrar()
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId])

  const html = useMemo(() => (p ? correoAnalisisHtml(p.informe, { ...p.datos, saludo, entradilla }) : ''), [p, saludo, entradilla])

  async function enviar() {
    if (!p) return
    setEnviando(true)
    try {
      const r = await fetch('/api/cold-calling/analisis/correo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId, para, asunto, saludo, entradilla }),
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error ?? 'No se ha podido enviar')
      toast.success(`Análisis enviado a ${d.para}`, { description: 'Queda apuntado en el historial del lead.' })
      for (const a of (d.avisos ?? []) as string[]) toast.warning(a)
      // El tablero refresca el historial y el último contacto del lead
      avisarCorreoEnviadoALead({ leadId, asunto, cuando: new Date().toISOString() })
      alEnviar()
      alCerrar()
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setEnviando(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3 sm:p-6" onMouseDown={(e) => e.target === e.currentTarget && !enviando && alCerrar()}>
      <div className="flex h-full max-h-[900px] w-full max-w-[1100px] flex-col overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">Enviar el análisis por correo</h2>
            {p && (
              <p className="truncate text-[11.5px] text-[var(--ls-t4)]">
                Desde {p.desde} · {p.situacion}
              </p>
            )}
          </div>
          <button type="button" onClick={alCerrar} disabled={enviando} className="rounded p-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
            <X className="h-4 w-4" />
          </button>
        </div>

        {cargando && !p ? (
          <div className="flex items-center justify-center gap-2 px-4 py-20 text-[13px] text-[var(--ls-t3)]">
            <Loader2 className="h-4 w-4 animate-spin" /> La IA está escribiendo el correo para este lead…
          </div>
        ) : error && !p ? (
          <div className="px-4 py-12 text-center text-[13px] text-[var(--ls-t2)]">
            {error}
            <div className="mt-4">
              <button type="button" className={BOTON_SECUNDARIO} onClick={() => void preparar()}>
                Volver a probar
              </button>
            </div>
          </div>
        ) : p ? (
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[minmax(0,380px)_minmax(0,1fr)] md:overflow-hidden">
            <div className="flex flex-col gap-3 border-b border-[var(--ls-linea)] p-4 md:overflow-y-auto md:border-b-0 md:border-r">
              {p.enviadoAt && (
                <p className="rounded-[6px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-300">
                  Ya se le mandó el análisis el {cuando(p.enviadoAt)}. Si lo envías otra vez, le llegará de nuevo.
                </p>
              )}
              <label className="text-[11px] font-semibold text-[var(--ls-t3)]">
                Para
                <input className={`${CAMPO} mt-1`} value={para} onChange={(e) => setPara(e.target.value)} placeholder="correo@empresa.com" />
              </label>
              <label className="text-[11px] font-semibold text-[var(--ls-t3)]">
                Asunto
                <input className={`${CAMPO} mt-1`} value={asunto} onChange={(e) => setAsunto(e.target.value)} />
              </label>
              <label className="text-[11px] font-semibold text-[var(--ls-t3)]">
                Saludo
                <input className={`${CAMPO} mt-1`} value={saludo} onChange={(e) => setSaludo(e.target.value)} />
              </label>
              <label className="text-[11px] font-semibold text-[var(--ls-t3)]">
                <span className="flex items-center gap-1.5">
                  Entradilla
                  {p.deIa && (
                    <span className="inline-flex items-center gap-1 font-normal text-[#FF6600]">
                      <Sparkles className="h-3 w-3" /> escrita por la IA para este lead
                    </span>
                  )}
                </span>
                <textarea
                  className={`${CAMPO} mt-1 h-auto min-h-[150px] resize-y py-2 leading-relaxed`}
                  value={entradilla}
                  onChange={(e) => setEntradilla(e.target.value)}
                  placeholder="Vacía: va el texto de siempre"
                />
              </label>
              <p className="text-[11px] leading-snug text-[var(--ls-t4)]">
                Debajo van solas las cifras, los tres puntos que más pesan, el botón al análisis, tu WhatsApp y tu teléfono, y el enlace de baja.
              </p>
              <div className="mt-auto flex items-center gap-2 pt-1">
                <button type="button" className={BOTON_SECUNDARIO} disabled={cargando || enviando} onClick={() => void preparar()} title="Que la IA lo escriba otra vez">
                  {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />} Otra versión
                </button>
                <button type="button" className={`${BOTON_PRIMARIO} flex-1`} disabled={enviando || cargando || !para.trim() || !asunto.trim()} onClick={() => void enviar()}>
                  {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Enviar
                </button>
              </div>
            </div>
            <div className="min-h-[60vh] bg-[#EDEAE5] md:min-h-0">
              <iframe title="Vista previa del correo" srcDoc={html} sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" className="h-[70vh] w-full border-0 md:h-full" />
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}
