'use client'

import { useEffect, useState } from 'react'
import { AlertCircle, Grid3x3, Loader2, Mic, MicOff, Phone, PhoneIncoming, PhoneOff, RefreshCw, X } from 'lucide-react'
import { colgar, contestar, llamarConZadarma, reintentarTelefono, silenciar, tecla, useTelefonoZadarma, type Llamada } from '@/lib/zadarma/cliente'

/**
 * EL TELÉFONO DE MÉXICO (Zadarma) DENTRO DEL ERP. Montado en el layout del dashboard, fuera de las apps: una llamada sigue aunque se cambie de pantalla.
 *
 *   · Encendido y sin llamada: una pastilla abajo con el número de México y «Marcar» (teclado para llamar a cualquier número).
 *   · En llamada: una barra arriba, en todas las pantallas, con el número o la tienda, el tiempo, silenciar, teclado y colgar.
 *   · Entrante: la misma barra con «Coger» y «Rechazar» (y suena).
 * Se enciende solo con una lista de México abierta en Cold Calling (lib/zadarma/cliente.ts).
 */

const reloj = (desde: number | null, ahora: number) => {
  if (!desde) return '0:00'
  const s = Math.max(0, Math.floor((ahora - desde) / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const TEXTO: Record<Llamada['estado'], string> = { marcando: 'Llamando…', entrante: 'Llamada entrante', conectando: 'Conectando…', en_curso: 'En llamada', terminada: '' }

function Teclado({ alPulsar, conLlamar, alLlamar, cerrar }: { alPulsar: (d: string) => void; conLlamar?: boolean; alLlamar?: (n: string) => void; cerrar: () => void }) {
  const [numero, setNumero] = useState('')
  const pulsar = (d: string) => {
    setNumero((n) => (n + d).slice(0, 20))
    alPulsar(d)
  }
  return (
    <div className="w-[240px] rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 shadow-[0_16px_40px_rgba(0,0,0,0.45)]">
      <div className="mb-2 flex items-center gap-2">
        <input
          autoFocus={conLlamar}
          value={numero}
          onChange={(e) => setNumero(e.target.value.replace(/[^\d+*#]/g, '').slice(0, 20))}
          onKeyDown={(e) => e.key === 'Enter' && conLlamar && alLlamar?.(numero)}
          placeholder={conLlamar ? '+52 …' : ''}
          readOnly={!conLlamar}
          aria-label="Número"
          className="h-9 min-w-0 flex-1 rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-center text-[16px] font-semibold tabular-nums text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
        />
        <button type="button" onClick={cerrar} aria-label="Cerrar el teclado" className="rounded-md p-1 text-[var(--ls-t3)] hover:text-[var(--ls-t1)]"><X className="h-4 w-4" /></button>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '0', '⌫'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => (d === '⌫' ? setNumero((n) => n.slice(0, -1)) : d === '+' ? conLlamar && setNumero((n) => (n.startsWith('+') ? n : `+${n}`)) : pulsar(d))}
            disabled={!conLlamar && (d === '+' || d === '⌫')}
            className="h-10 rounded-[10px] bg-[var(--ls-sup2)] text-[16px] font-semibold text-[var(--ls-t1)] hover:bg-[var(--ls-sup3)] disabled:opacity-30"
          >
            {d}
          </button>
        ))}
      </div>
      {conLlamar && (
        <button type="button" onClick={() => alLlamar?.(numero)} disabled={numero.replace(/\D/g, '').length < 3} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-[10px] bg-[var(--ls-e-verde)] text-[14px] font-semibold text-white disabled:opacity-40">
          <Phone className="h-4 w-4" /> Llamar
        </button>
      )}
    </div>
  )
}

export function TelefonoZadarma() {
  const t = useTelefonoZadarma()
  const [ahora, setAhora] = useState(() => Date.now())
  const [teclado, setTeclado] = useState(false)
  const [marcar, setMarcar] = useState(false)
  const [aviso, setAviso] = useState<string | null>(null)
  const ll = t.llamada

  useEffect(() => {
    if (!ll || ll.estado !== 'en_curso') return
    const i = setInterval(() => setAhora(Date.now()), 1000)
    return () => clearInterval(i)
  }, [ll])
  useEffect(() => {
    if (!ll) setTeclado(false)
  }, [ll])
  // Que no se cierre la pestaña sin querer en mitad de una llamada
  useEffect(() => {
    if (!ll || ll.estado === 'terminada') return
    const f = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', f)
    return () => window.removeEventListener('beforeunload', f)
  }, [ll])

  if (t.fase === 'apagado' && !ll) return null

  /* ---- una llamada (o la que acaba de terminar) ---- */
  if (ll) {
    const viva = ll.estado !== 'terminada'
    return (
      <div className="pointer-events-none fixed inset-x-0 top-3 z-[95] flex justify-center px-3">
        <div role="status" aria-live="polite" className={`pointer-events-auto relative flex max-w-full items-center gap-3 rounded-full border px-3 py-2 shadow-[0_16px_40px_rgba(0,0,0,0.45)] ${ll.estado === 'entrante' ? 'border-[var(--ls-e-verde)] bg-[var(--ls-sup)]' : viva ? 'border-[var(--ls-linea2)] bg-[var(--ls-sup)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup2)]'}`}>
          <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${ll.estado === 'en_curso' ? 'bg-[var(--ls-e-verde)] text-white' : ll.estado === 'entrante' ? 'animate-pulse bg-[var(--ls-e-verde)] text-white' : viva ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)]' : 'bg-[var(--ls-sup3)] text-[var(--ls-t3)]'}`}>
            {ll.estado === 'entrante' ? <PhoneIncoming className="h-4 w-4" /> : viva ? <Phone className="h-4 w-4" /> : <PhoneOff className="h-4 w-4" />}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[13px] font-semibold text-[var(--ls-t1)]">{ll.etiqueta ?? ll.numero}</span>
            <span className="block truncate text-[11.5px] text-[var(--ls-t3)]">
              {viva ? (
                <>
                  {TEXTO[ll.estado]}
                  {ll.etiqueta ? ` · ${ll.numero}` : ''}
                  {ll.estado === 'en_curso' && <b className="ml-1 tabular-nums text-[var(--ls-t1)]">{reloj(ll.inicio, ahora)}</b>}
                  {ll.silenciado && <span className="ml-1 text-[var(--ls-e-ambar)]">· silenciado</span>}
                </>
              ) : (
                ll.motivo
              )}
            </span>
          </span>
          {ll.estado === 'entrante' && (
            <>
              <button type="button" onClick={contestar} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ls-e-verde)] px-4 text-[13px] font-semibold text-white"><Phone className="h-4 w-4" /> Coger</button>
              <button type="button" onClick={colgar} className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ls-e-rojo)] px-4 text-[13px] font-semibold text-white"><PhoneOff className="h-4 w-4" /> Rechazar</button>
            </>
          )}
          {viva && ll.estado !== 'entrante' && (
            <>
              <button type="button" onClick={() => silenciar(!ll.silenciado)} disabled={ll.estado !== 'en_curso'} aria-pressed={ll.silenciado} title={ll.silenciado ? 'Activar el micrófono' : 'Silenciar'} className={`flex h-9 w-9 items-center justify-center rounded-full disabled:opacity-40 ${ll.silenciado ? 'bg-[var(--ls-e-ambar)] text-black' : 'bg-[var(--ls-sup3)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup2)]'}`}>
                {ll.silenciado ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
              </button>
              <button type="button" onClick={() => setTeclado((v) => !v)} disabled={ll.estado !== 'en_curso'} title="Teclado (para menús de voz)" aria-pressed={teclado} className="flex h-9 w-9 items-center justify-center rounded-full bg-[var(--ls-sup3)] text-[var(--ls-t1)] hover:bg-[var(--ls-sup2)] disabled:opacity-40">
                <Grid3x3 className="h-4 w-4" />
              </button>
              <button type="button" onClick={colgar} title="Colgar" className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[var(--ls-e-rojo)] px-4 text-[13px] font-semibold text-white"><PhoneOff className="h-4 w-4" /> Colgar</button>
            </>
          )}
          {teclado && viva && (
            <div className="absolute right-0 top-[calc(100%+8px)]">
              <Teclado alPulsar={(d) => tecla(Number(d))} cerrar={() => setTeclado(false)} />
            </div>
          )}
        </div>
      </div>
    )
  }

  /* ---- encendido, sin llamada ---- */
  return (
    <div className="fixed bottom-4 left-1/2 z-[85] -translate-x-1/2">
      {marcar && t.fase === 'listo' && (
        <div className="absolute bottom-[calc(100%+8px)] left-1/2 -translate-x-1/2">
          <Teclado
            conLlamar
            alPulsar={() => {}}
            cerrar={() => setMarcar(false)}
            alLlamar={(n) => {
              const r = llamarConZadarma(n.startsWith('+') || n.length <= 6 ? n : `+52${n.replace(/\D/g, '')}`)
              if (r) setAviso(r)
              else setMarcar(false)
            }}
          />
        </div>
      )}
      <div className="flex items-center gap-2 rounded-full border border-[var(--ls-linea2)] bg-[var(--ls-sup)] py-1.5 pl-3 pr-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.4)]">
        {t.fase === 'cargando' && <Loader2 className="h-4 w-4 animate-spin text-[var(--ls-t3)]" />}
        {t.fase === 'listo' && <span className="h-2 w-2 rounded-full bg-[var(--ls-e-verde)]" />}
        {t.fase === 'error' && <AlertCircle className="h-4 w-4 text-[var(--ls-e-rojo)]" />}
        <span className="text-[12.5px] text-[var(--ls-t2)]">
          {t.fase === 'cargando' ? 'Preparando el teléfono de México…' : t.fase === 'error' ? (t.mensaje ?? 'El teléfono de México no funciona') : <>Teléfono México <b className="tabular-nums text-[var(--ls-t1)]">{t.numero ?? ''}</b></>}
        </span>
        {aviso && <span className="text-[12px] text-[var(--ls-e-rojo)]">{aviso}</span>}
        {t.fase === 'listo' && (
          <button type="button" onClick={() => { setAviso(null); setMarcar((v) => !v) }} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--ls-e-verde)] px-3 text-[12.5px] font-semibold text-white">
            <Grid3x3 className="h-3.5 w-3.5" /> Marcar
          </button>
        )}
        {t.fase === 'error' && (
          <button type="button" onClick={reintentarTelefono} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--ls-sup3)] px-3 text-[12.5px] font-semibold text-[var(--ls-t1)]">
            <RefreshCw className="h-3.5 w-3.5" /> Reintentar
          </button>
        )}
      </div>
    </div>
  )
}
