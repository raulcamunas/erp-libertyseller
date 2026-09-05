'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import {
  Building2,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Eye,
  FileText,
  Link2,
  Loader2,
  Mail,
  Receipt,
  Send,
  Wallet,
} from 'lucide-react'
import {
  ETIQUETA_ESTADO,
  nombreDelMes,
  type Emisor,
  type EstadoFacturacion,
  type FilaFacturacion,
} from '@/lib/facturacion/tipos'

/**
 * FACTURAR EL MES ENTERO SIN SALIR DE AQUÍ.
 *
 * Antes, por cliente: bajar los ficheros, subirlos a la calculadora, copiar el
 * enlace del desglose, montar la factura fuera, copiar su enlace, abrir el
 * correo, pegar la plantilla, adjuntar el PDF y marcarlo en Tesorería. Once
 * clientes, un día entero.
 *
 * Aquí cada cliente es una fila con su estado y un botón. El botón hace el
 * paso que toque, y solo ese.
 *
 *
 * ============ POR QUÉ NO HAY UN «MANDARLO TODO» ============
 *
 * Emitir en bloque sí: numerar once facturas es mecánico y se revisa después,
 * porque nada ha salido de la agencia todavía.
 *
 * Enviar en bloque no. Un envío son once correos a clientes reales, y si el
 * importe de uno está mal —o el desglose enlazado es del mes anterior— ya no
 * hay vuelta atrás. El envío se hace cliente a cliente y con la vista previa
 * delante, que es exactamente el momento en el que se pillan esos fallos.
 */

const COLOR_ESTADO: Record<EstadoFacturacion, string> = {
  sin_importes: 'text-white/35 bg-white/[0.06] border-white/10',
  por_emitir: 'text-amber-300 bg-amber-400/10 border-amber-400/25',
  emitida: 'text-sky-300 bg-sky-400/10 border-sky-400/25',
  enviada: 'text-[#FF6600] bg-[#FF6600]/10 border-[#FF6600]/30',
  cobrada: 'text-emerald-300 bg-emerald-400/10 border-emerald-400/25',
}

/** El paso del recorrido en el que está cada estado, para pintar la barra */
const PASO: Record<EstadoFacturacion, number> = {
  sin_importes: 0,
  por_emitir: 1,
  emitida: 2,
  enviada: 3,
  cobrada: 4,
}

const PASOS = ['Importes', 'Factura', 'Correo', 'Cobro'] as const

function eur(n: number): string {
  return `${n.toLocaleString('es-ES', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`
}

function mesAnterior(period: string, salto: number): string {
  const [a, m] = period.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + salto, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

function mesActual(): string {
  const d = new Date()
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`
}

// ────────────────────────────── La barra de pasos ──────────────────────────────

function Recorrido({ estado }: { estado: EstadoFacturacion }) {
  const paso = PASO[estado]
  return (
    <div className="flex items-center gap-1">
      {PASOS.map((nombre, i) => {
        const hecho = paso > i
        const enCurso = paso === i + 1
        return (
          <div key={nombre} className="flex items-center gap-1">
            <motion.div
              initial={false}
              animate={{
                backgroundColor: hecho
                  ? 'rgba(255,102,0,0.9)'
                  : enCurso
                    ? 'rgba(255,102,0,0.35)'
                    : 'rgba(255,255,255,0.09)',
                scale: enCurso ? 1.15 : 1,
              }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
              className="h-1.5 w-1.5 rounded-full"
              title={nombre}
            />
            {i < PASOS.length - 1 && (
              <motion.div
                initial={false}
                animate={{ backgroundColor: hecho ? 'rgba(255,102,0,0.45)' : 'rgba(255,255,255,0.07)' }}
                transition={{ duration: 0.35 }}
                className="h-px w-4"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ────────────────────────────── Vista previa del correo ──────────────────────────────

function VistaPrevia({
  fila,
  onCerrar,
  onEnviado,
}: {
  fila: FilaFacturacion
  onCerrar: () => void
  onEnviado: () => void
}) {
  const [html, setHtml] = useState<string | null>(null)
  const [asunto, setAsunto] = useState('')
  const [destinatario, setDestinatario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const reportUrl = fila.factura?.reportUrl ?? fila.desglose?.url ?? ''

  useEffect(() => {
    let vivo = true
    fetch('/api/facturacion/enviar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        invoiceId: fila.factura?.id,
        reportUrl: reportUrl || null,
        soloVistaPrevia: true,
      }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return
        if (d.error) {
          toast.error(d.error)
          return
        }
        setHtml(d.html)
        setAsunto(d.asunto)
        setDestinatario(d.destinatario || fila.email || '')
      })
    return () => {
      vivo = false
    }
  }, [fila, reportUrl])

  async function enviar() {
    if (!destinatario.trim()) {
      toast.error('Falta la dirección a la que mandarlo')
      return
    }
    setEnviando(true)
    try {
      const res = await fetch('/api/facturacion/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoiceId: fila.factura?.id,
          reportUrl: reportUrl || null,
          destinatario: destinatario.trim(),
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      toast.success(`Enviada a ${d.destinatario}`)
      onEnviado()
      onCerrar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
      onClick={onCerrar}
    >
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.99 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-3xl border border-white/15 bg-[#0d0d10]"
      >
        <div className="flex-shrink-0 border-b border-white/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <Mail className="h-4 w-4 text-[#FF6600]" />
            <span className="label-uppercase text-white/45">Antes de mandarlo</span>
          </div>
          <p className="mt-1 text-[15px] font-semibold text-white">{fila.nombre}</p>
        </div>

        <div className="flex-shrink-0 space-y-2 border-b border-white/10 px-6 py-3">
          <label className="block">
            <span className="text-[10px] uppercase tracking-wider text-white/35">Para</span>
            <input
              value={destinatario}
              onChange={(e) => setDestinatario(e.target.value)}
              placeholder="cliente@ejemplo.com"
              className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white outline-none transition-colors focus:border-[#FF6600]"
            />
          </label>
          <p className="text-[11px] text-white/35">
            Asunto: <span className="text-white/60">{asunto || '—'}</span>
          </p>
          {reportUrl ? (
            <p className="flex items-center gap-1.5 text-[11px] text-white/35">
              <Link2 className="h-3 w-3 text-[#FF6600]" />
              Va con el desglose:{' '}
              <span className="truncate text-white/55">{reportUrl}</span>
            </p>
          ) : (
            <p className="text-[11px] text-amber-300/70">
              Sin desglose enlazado: el correo sale solo con la factura.
            </p>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto bg-[#f4f4f4]">
          {html ? (
            // sandbox sin allow-scripts: es HTML que se va a mandar por correo,
            // aquí solo se mira.
            <iframe
              srcDoc={html}
              sandbox=""
              title="Vista previa del correo"
              className="h-[52vh] w-full border-0"
            />
          ) : (
            <div className="flex h-[52vh] items-center justify-center text-[13px] text-black/40">
              Montando el correo…
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center justify-between gap-3 border-t border-white/10 px-6 py-4">
          <a
            href={`/api/facturacion/pdf?id=${fila.factura?.id}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-[12px] text-white/50 transition-colors hover:text-white"
          >
            <FileText className="h-3.5 w-3.5" />
            Ver el PDF que se adjunta
          </a>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onCerrar}
              className="rounded-full border border-white/10 px-4 py-2 text-[12px] text-white/60 transition-colors hover:border-white/25 hover:text-white"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={enviando || !html}
              onClick={() => void enviar()}
              className="flex items-center gap-2 rounded-full bg-[#FF6600] px-5 py-2 text-[12px] font-bold uppercase tracking-wider text-white shadow-[0_10px_20px_rgba(255,102,0,0.2)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:opacity-60"
            >
              {enviando ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Enviar ahora
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  )
}

// ────────────────────────────── Los datos del emisor ──────────────────────────────

const CAMPOS_EMISOR: { campo: keyof Emisor; etiqueta: string; marcador: string }[] = [
  { campo: 'legal_name', etiqueta: 'Razón social', marcador: 'Liberty Seller S.L.' },
  { campo: 'tax_id', etiqueta: 'NIF', marcador: 'B-12345678' },
  { campo: 'address', etiqueta: 'Domicilio fiscal', marcador: 'Calle, número, CP y ciudad' },
  { campo: 'email', etiqueta: 'Correo', marcador: 'business@libertyseller.com' },
  { campo: 'iban', etiqueta: 'IBAN', marcador: 'ES00 0000 0000 0000 0000 0000' },
  { campo: 'bank_name', etiqueta: 'Banco', marcador: 'BBVA' },
  { campo: 'bic', etiqueta: 'BIC', marcador: 'BBVAESMM' },
  { campo: 'invoice_prefix', etiqueta: 'Prefijo', marcador: 'LS' },
  { campo: 'footer_note', etiqueta: 'Pie de la factura', marcador: 'Pago a 30 días' },
]

function FichaEmisor({ emisor, onGuardado }: { emisor: Emisor; onGuardado: (e: Emisor) => void }) {
  const [abierto, setAbierto] = useState(false)
  const [borrador, setBorrador] = useState<Emisor>(emisor)
  const [guardando, setGuardando] = useState(false)

  useEffect(() => setBorrador(emisor), [emisor])

  // Sin NIF o sin IBAN la factura sale coja: se avisa desde fuera, sin tener
  // que abrir la ficha para descubrirlo.
  const incompleto = !emisor.tax_id?.trim() || !emisor.iban?.trim() || !emisor.legal_name?.trim()

  async function guardar() {
    setGuardando(true)
    try {
      const res = await fetch('/api/facturacion/emisor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(borrador),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      onGuardado(d.emisor)
      toast.success('Datos guardados')
      setAbierto(false)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2.5 text-left transition-colors hover:bg-white/[0.02]"
      >
        <Building2 className="h-3.5 w-3.5 text-[#FF6600]" />
        <span className="label-uppercase text-white/45">Tus datos de facturación</span>
        <span className="text-[11px] text-white/30">
          {incompleto
            ? 'Faltan datos: sin NIF e IBAN las facturas salen incompletas'
            : `${emisor.legal_name} · ${emisor.tax_id}`}
        </span>
        {incompleto && (
          <span className="h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-amber-400" />
        )}
        <ChevronDown
          className={`ml-auto h-4 w-4 flex-shrink-0 text-white/35 transition-transform duration-200 ${
            abierto ? 'rotate-180' : ''
          }`}
        />
      </button>

      <AnimatePresence initial={false}>
        {abierto && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="grid grid-cols-1 gap-3 px-4 pb-4 sm:grid-cols-2 lg:grid-cols-3">
              {CAMPOS_EMISOR.map(({ campo, etiqueta, marcador }) => (
                <label key={String(campo)} className="block">
                  <span className="text-[10px] uppercase tracking-wider text-white/35">
                    {etiqueta}
                  </span>
                  <input
                    value={(borrador[campo] as string) ?? ''}
                    placeholder={marcador}
                    onChange={(e) =>
                      setBorrador((b) => ({ ...b, [campo]: e.target.value }) as Emisor)
                    }
                    className="mt-1 w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-white/20 focus:border-[#FF6600]"
                  />
                </label>
              ))}
              <div className="flex items-end">
                <button
                  type="button"
                  disabled={guardando}
                  onClick={() => void guardar()}
                  className="flex h-[38px] items-center gap-2 rounded-lg bg-[#FF6600] px-4 text-[12px] font-bold uppercase tracking-wider text-white transition-all hover:brightness-110 disabled:opacity-60"
                >
                  {guardando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Guardar
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ────────────────────────────── La fila de un cliente ──────────────────────────────

function Fila({
  fila,
  period,
  onCambio,
  onVistaPrevia,
}: {
  fila: FilaFacturacion
  period: string
  onCambio: () => void
  onVistaPrevia: (f: FilaFacturacion) => void
}) {
  const [emitiendo, setEmitiendo] = useState(false)
  const total = (fila.fee ?? 0) + (fila.comision ?? 0)

  async function emitir() {
    setEmitiendo(true)
    try {
      const res = await fetch('/api/facturacion/emitir', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          treasuryClientId: fila.treasuryClientId,
          period,
          reportUrl: fila.desglose?.url ?? null,
        }),
      })
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      toast.success(
        d.yaExistia ? `Ya estaba emitida: ${d.factura.invoice_number}` : `Emitida ${d.factura.invoice_number}`
      )
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido emitir')
    } finally {
      setEmitiendo(false)
    }
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="group grid grid-cols-[1fr_auto] items-center gap-3 rounded-xl border border-white/[0.07] bg-white/[0.015] px-4 py-3 transition-all duration-300 hover:border-[#FF6600]/30 hover:bg-white/[0.035]"
    >
      {/* ---------- Quién y en qué punto ---------- */}
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-white">{fila.nombre}</span>
          <span
            className={`rounded-full border px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider ${COLOR_ESTADO[fila.estado]}`}
          >
            {ETIQUETA_ESTADO[fila.estado]}
          </span>
          <Recorrido estado={fila.estado} />
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-white/40">
          {total > 0 ? (
            <span>
              {fila.fee ? `Fee ${eur(fila.fee)}` : null}
              {fila.fee && fila.comision ? ' · ' : null}
              {fila.comision ? `Comisiones ${eur(fila.comision)}` : null}
              {' → '}
              <span className="font-semibold text-white/70">{eur(total)}</span>
              {fila.vatRate > 0 ? (
                <span className="text-white/30"> + IVA {(fila.vatRate * 100).toFixed(0)} %</span>
              ) : (
                <span className="text-white/30"> sin IVA</span>
              )}
            </span>
          ) : (
            <span className="text-white/25">Sin importes en Tesorería este mes</span>
          )}

          {fila.factura && (
            <a
              href={`/api/facturacion/pdf?id=${fila.factura.id}`}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-white/45 underline-offset-2 transition-colors hover:text-[#FF6600] hover:underline"
            >
              <Receipt className="h-3 w-3" />
              {fila.factura.numero}
            </a>
          )}

          {fila.desglose ? (
            <a
              href={fila.desglose.url}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 text-white/45 underline-offset-2 transition-colors hover:text-[#FF6600] hover:underline"
              title={`Desglose ${fila.desglose.periodo ?? fila.desglose.slug}`}
            >
              <Link2 className="h-3 w-3" />
              Desglose
            </a>
          ) : fila.comision ? (
            // Cobra comisión pero no hay desglose que enseñar. No es un error
            // —puede no estar guardado todavía— pero mandar una comisión sin el
            // detalle detrás es lo que genera el correo de «¿esto de dónde
            // sale?» tres días después.
            <span className="text-amber-300/60" title="Guarda el reporte en la calculadora de comisiones">
              Sin desglose
            </span>
          ) : null}

          {!fila.email && total > 0 && (
            <span className="text-amber-300/60" title="Ponle correo en Tesorería">
              Sin correo
            </span>
          )}

          {fila.marcadoEnviadoAMano && (
            <span
              className="text-sky-300/70"
              title="En Tesorería este mes está marcado como enviado, pero no hay ninguna factura del ERP detrás: se mandó desde fuera"
            >
              Ya mandada desde fuera
            </span>
          )}
        </div>
      </div>

      {/* ---------- Lo que toca hacer ---------- */}
      <div className="flex flex-shrink-0 items-center gap-2">
        {fila.estado === 'por_emitir' && (
          <button
            type="button"
            disabled={emitiendo}
            onClick={() => void emitir()}
            className="flex items-center gap-1.5 rounded-full border border-white/15 bg-white/[0.05] px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-white transition-all hover:-translate-y-0.5 hover:border-[#FF6600]/50 hover:bg-[#FF6600]/10 disabled:translate-y-0 disabled:opacity-60"
          >
            {emitiendo ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Receipt className="h-3 w-3" />
            )}
            Emitir
          </button>
        )}

        {fila.estado === 'emitida' && (
          <button
            type="button"
            onClick={() => onVistaPrevia(fila)}
            className="flex items-center gap-1.5 rounded-full bg-[#FF6600] px-3.5 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_8px_16px_rgba(255,102,0,0.18)] transition-all hover:-translate-y-0.5 hover:brightness-110"
          >
            <Eye className="h-3 w-3" />
            Revisar y enviar
          </button>
        )}

        {(fila.estado === 'enviada' || fila.estado === 'cobrada') && (
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-[11px] text-white/35">
              <Check className="h-3 w-3 text-emerald-400" />
              {fila.estado === 'cobrada' ? 'Cobrada' : 'Enviada'}
            </span>
            {fila.factura && (
              <button
                type="button"
                onClick={() => onVistaPrevia(fila)}
                className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:border-white/25 hover:text-white"
                title="Volver a mandarla"
              >
                Reenviar
              </button>
            )}
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ────────────────────────────── La pantalla ──────────────────────────────

export function CentroFacturacion({ periodInicial }: { periodInicial?: string }) {
  const [period, setPeriod] = useState(periodInicial ?? mesActual())
  const [filas, setFilas] = useState<FilaFacturacion[]>([])
  const [emisor, setEmisor] = useState<Emisor | null>(null)
  const [cargando, setCargando] = useState(true)
  const [faltaMigracion, setFaltaMigracion] = useState(false)
  const [previa, setPrevia] = useState<FilaFacturacion | null>(null)
  const [emitiendoTodas, setEmitiendoTodas] = useState(false)

  const traer = useCallback(async () => {
    setCargando(true)
    try {
      const res = await fetch(`/api/facturacion?period=${period}`)
      const d = await res.json()
      if (d.error) throw new Error(d.error)
      setFilas(d.filas ?? [])
      setEmisor(d.emisor ?? null)
      setFaltaMigracion(Boolean(d.faltaMigracion))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido cargar el mes')
      setFilas([])
    } finally {
      setCargando(false)
    }
  }, [period])

  useEffect(() => {
    void traer()
  }, [traer])

  const cuentas = useMemo(() => {
    const porEmitir = filas.filter((f) => f.estado === 'por_emitir')
    /**
     * DEL BOTÓN DE «EMITIR TODAS» SE QUEDAN FUERA LAS QUE YA SE MANDARON DESDE
     * FUERA DEL ERP.
     *
     * En Tesorería están marcadas como enviadas pero no tienen factura del ERP
     * detrás: son las de la mudanza. Emitirlas en bloque les daría un número de
     * factura nuevo a un servicio que ya está facturado, y un número quemado no
     * se recupera. Siguen contando como pendientes y se pueden emitir una a una
     * si de verdad hace falta.
     */
    const porEmitirEnBloque = porEmitir.filter((f) => !f.marcadoEnviadoAMano)
    const emitidas = filas.filter((f) => f.estado === 'emitida')
    const enviadas = filas.filter((f) => f.estado === 'enviada' || f.estado === 'cobrada')
    const sinMandar = [...porEmitir, ...emitidas].reduce(
      (s, f) => s + (f.fee ?? 0) + (f.comision ?? 0),
      0
    )
    return { porEmitir, porEmitirEnBloque, emitidas, enviadas, sinMandar }
  }, [filas])

  /**
   * EMITIR TODAS LAS QUE FALTAN, UNA DETRÁS DE OTRA.
   *
   * En serie y no en paralelo: el número de factura se saca leyendo el último
   * y sumando uno, así que once peticiones a la vez leerían todas el mismo
   * último número y pedirían el mismo. El índice único de la base lo pararía,
   * pero con diez errores en pantalla en vez de diez facturas.
   */
  async function emitirTodas() {
    if (cuentas.porEmitirEnBloque.length === 0) return
    setEmitiendoTodas(true)
    let hechas = 0
    const fallos: string[] = []
    for (const f of cuentas.porEmitirEnBloque) {
      try {
        const res = await fetch('/api/facturacion/emitir', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            treasuryClientId: f.treasuryClientId,
            period,
            reportUrl: f.desglose?.url ?? null,
          }),
        })
        const d = await res.json()
        if (d.error) throw new Error(d.error)
        hechas += 1
      } catch (e) {
        fallos.push(`${f.nombre}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    setEmitiendoTodas(false)
    await traer()
    if (hechas > 0) toast.success(`${hechas} factura${hechas === 1 ? '' : 's'} emitida${hechas === 1 ? '' : 's'}`)
    // Los fallos se dicen uno a uno: «3 fallaron» obliga a buscar cuáles.
    for (const f of fallos) toast.error(f)
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ---------- Mes y resumen ---------- */}
      <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setPeriod((p) => mesAnterior(p, -1))}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <AnimatePresence mode="wait">
            <motion.span
              key={period}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.18 }}
              className="min-w-[170px] text-center text-[13px] font-bold uppercase tracking-wider text-white"
            >
              {nombreDelMes(period)}
            </motion.span>
          </AnimatePresence>
          <button
            type="button"
            onClick={() => setPeriod((p) => mesAnterior(p, 1))}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[11.5px]">
          <span className="text-white/40">
            <span className="font-bold text-amber-300">{cuentas.porEmitir.length}</span> por emitir
          </span>
          <span className="text-white/40">
            <span className="font-bold text-sky-300">{cuentas.emitidas.length}</span> sin mandar
          </span>
          <span className="text-white/40">
            <span className="font-bold text-emerald-300">{cuentas.enviadas.length}</span> ya fuera
          </span>
          {cuentas.sinMandar > 0 && (
            <span className="flex items-center gap-1.5 text-white/40">
              <Wallet className="h-3 w-3 text-[#FF6600]" />
              <span className="font-semibold text-white/70">{eur(cuentas.sinMandar)}</span> sin
              facturar todavía
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={() => void traer()}
            className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] text-white/50 transition-colors hover:border-white/25 hover:text-white"
          >
            Actualizar
          </button>
          {cuentas.porEmitirEnBloque.length > 0 && (
            <button
              type="button"
              disabled={emitiendoTodas}
              onClick={() => void emitirTodas()}
              className="flex items-center gap-2 rounded-full bg-[#FF6600] px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white shadow-[0_8px_16px_rgba(255,102,0,0.18)] transition-all hover:-translate-y-0.5 hover:brightness-110 disabled:translate-y-0 disabled:opacity-60"
            >
              {emitiendoTodas ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Receipt className="h-3 w-3" />
              )}
              Emitir las {cuentas.porEmitirEnBloque.length}
            </button>
          )}
        </div>
      </div>

      {faltaMigracion && (
        <div className="rounded-xl border border-amber-400/25 bg-amber-400/[0.06] px-4 py-3 text-[12px] text-amber-200/90">
          Falta lanzar la migración <span className="font-bold">176</span>: sin ella no existen ni
          el NIF de los clientes ni el enlace entre la factura y su mes, y la pantalla va a medias.
        </div>
      )}

      {emisor && <FichaEmisor emisor={emisor} onGuardado={setEmisor} />}

      {/* ---------- Los clientes ---------- */}
      <div className="flex flex-col gap-2">
        {cargando && filas.length === 0 && (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-white/30">
            <Loader2 className="h-4 w-4 animate-spin" />
            Mirando el mes…
          </div>
        )}

        {!cargando && filas.length === 0 && (
          <div className="py-12 text-center text-[13px] text-white/30">
            No hay clientes activos en Tesorería.
          </div>
        )}

        <AnimatePresence initial={false}>
          {filas.map((f) => (
            <Fila
              key={f.treasuryClientId}
              fila={f}
              period={period}
              onCambio={() => void traer()}
              onVistaPrevia={setPrevia}
            />
          ))}
        </AnimatePresence>
      </div>

      <AnimatePresence>
        {previa && (
          <VistaPrevia
            fila={previa}
            onCerrar={() => setPrevia(null)}
            onEnviado={() => void traer()}
          />
        )}
      </AnimatePresence>
    </div>
  )
}
