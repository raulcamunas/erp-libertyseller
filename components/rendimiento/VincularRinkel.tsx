'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, ExternalLink, KeyRound, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { VinculoVisible } from './tipos'

/**
 * VINCULAR LA CUENTA DE RINKEL.
 *
 * Cada comercial pega SU clave de la API y el ERP lee desde ese momento todas sus llamadas. La clave sale del
 * navegador una sola vez, hacia nuestra ruta, que la comprueba contra Rinkel y la guarda cifrada; no se vuelve a
 * mostrar ni se puede leer desde aquí (ni por el propio dueño ni por quien supervisa).
 *
 * LA IMPORTACIÓN SE HACE POR TRAMOS. Una cuenta con meses de uso tiene miles de llamadas y no caben en una sola
 * petición, así que la ruta lee unos 40 segundos y dice cuánto queda; esta pantalla insiste mientras quede algo
 * y enseña el avance. Si se cierra la pestaña a medias no se pierde nada: lo leído está guardado y lo sigue el
 * proceso automático, o esta pantalla al abrirla otra vez.
 */

interface Resumen {
  ok: boolean
  pendiente: boolean
  importadas: number
  totalEnRinkel: number | null
  mensaje: string | null
}

type Respuesta =
  | { ok: true; resumen?: Resumen; ocupada?: boolean; sinVinculo?: boolean; recienLeido?: boolean }
  | { ok: false; mensaje: string }

async function pedir(cuerpo: { accion: 'vincular'; clave: string } | { accion: 'sincronizar' } | { accion: 'desvincular' }): Promise<Respuesta> {
  try {
    const r = await fetch('/api/rendimiento/rinkel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
      cache: 'no-store',
    })
    const json = (await r.json().catch(() => null)) as Record<string, unknown> | null
    if (!r.ok) return { ok: false, mensaje: typeof json?.error === 'string' ? json.error : 'No se ha podido completar la operación. Vuelve a probar.' }
    return { ok: true, resumen: json?.resumen as Resumen | undefined, ocupada: json?.ocupada === true, sinVinculo: json?.sinVinculo === true, recienLeido: json?.recienLeido === true }
  } catch {
    return { ok: false, mensaje: 'No se ha podido conectar con el ERP. Comprueba tu conexión y vuelve a probar.' }
  }
}

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const numero = (n: number) => n.toLocaleString('es-ES')
// Una hora «del futuro» (el reloj de este ordenador va por detrás del del servidor) se lee como «ahora», no como «dentro de 4 horas»
const hace = (iso: string) => formatDistanceToNow(new Date(Math.min(Date.parse(iso), Date.now())), { locale: es, addSuffix: true })

interface Props {
  persona: { id: string; nombre: string }
  /** Es su propio panel: solo así se puede vincular, sincronizar o desvincular */
  esPropio: boolean
  vinculo: VinculoVisible | null
  /** Pide al panel que vuelva a leer el vínculo y las llamadas de la base */
  onCambio: () => Promise<void>
  /**
   * La invitación a vincular sale con el acento naranja. Se apaga para quien mira el panel pero no es del
   * equipo comercial (un administrador que supervisa): no llama con Rinkel y no hay que insistirle.
   */
  destacar?: boolean
}

export function VincularRinkel({ persona, esPropio, vinculo, onCambio, destacar = true }: Props) {
  const [clave, setClave] = useState('')
  const [cambiando, setCambiando] = useState(false)
  const [trabajando, setTrabajando] = useState<null | 'comprobando' | 'importando' | 'quitando'>(null)
  const [progreso, setProgreso] = useState<{ importadas: number; total: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmaQuitar, setConfirmaQuitar] = useState(false)
  const vivo = useRef(true)
  const importando = useRef(false)

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  /**
   * Lee de Rinkel hasta que no quede histórico por importar.
   *   hecho    · se leyó y está todo al día
   *   reciente · se acababa de leer: no se preguntó a Rinkel
   *   ocupada  · otra pestaña, o el proceso automático, lleva rato leyendo esta misma cuenta
   *   error    · algo falló; el motivo ya está en pantalla
   */
  async function importar(primera?: Resumen): Promise<'hecho' | 'reciente' | 'ocupada' | 'error'> {
    if (importando.current) return 'ocupada'
    importando.current = true
    setTrabajando('importando')
    setError(null)
    let resumen = primera
    let ocupadas = 0
    try {
      for (let vuelta = 0; vuelta < 300 && vivo.current; vuelta += 1) {
        if (resumen) {
          setProgreso({ importadas: resumen.importadas, total: resumen.totalEnRinkel })
          if (!resumen.ok) {
            setError(resumen.mensaje ?? 'Rinkel ha dado un error.')
            return 'error'
          }
          if (!resumen.pendiente) return 'hecho'
        }
        const r = await pedir({ accion: 'sincronizar' })
        if (!r.ok) {
          setError(r.mensaje)
          return 'error'
        }
        if (r.sinVinculo) return 'error'
        if (r.recienLeido) return 'reciente'
        if (r.ocupada) {
          // Se espera a que la otra lectura avance y se vuelve a mirar
          ocupadas += 1
          if (ocupadas > 8) return 'ocupada'
          await esperar(4000)
          resumen = undefined
          continue
        }
        resumen = r.resumen
        if (!resumen) return 'error'
      }
      return 'hecho'
    } finally {
      importando.current = false
      if (vivo.current) {
        setTrabajando(null)
        setProgreso(null)
        await onCambio()
      }
    }
  }

  async function vincular(e: FormEvent) {
    e.preventDefault()
    const pegada = clave
    if (!pegada.trim() || trabajando) return
    // La clave no se queda en pantalla ni en el estado más de lo necesario: se suelta en cuanto se toma
    setClave('')
    setError(null)
    setTrabajando('comprobando')
    const r = await pedir({ accion: 'vincular', clave: pegada })
    if (!r.ok) {
      setTrabajando(null)
      setError(r.mensaje)
      return
    }
    setCambiando(false)
    toast.success('Rinkel vinculado. Leyendo tus llamadas…')
    await importar(r.resumen)
  }

  async function sincronizarAhora() {
    if (trabajando) return
    const resultado = await importar()
    if (resultado === 'reciente') toast.info('Ya estaba al día: se acaba de leer.')
    else if (resultado === 'ocupada') toast.info('Ya se están leyendo tus llamadas. Se verán en un momento.')
    else if (resultado === 'hecho') toast.success('Llamadas al día.')
  }

  async function desvincular() {
    setTrabajando('quitando')
    setError(null)
    const r = await pedir({ accion: 'desvincular' })
    setTrabajando(null)
    setConfirmaQuitar(false)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    toast.success('Rinkel desvinculado. Las llamadas ya leídas se quedan.')
    await onCambio()
  }

  // Si se abre la pantalla con el histórico a medias (se cerró la pestaña, o se acaba de vincular desde otro sitio), sigue
  useEffect(() => {
    if (esPropio && vinculo && !vinculo.historico_completo) void importar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------- mirando a otra persona ---------------------------- */

  if (!esPropio) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3.5 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        {vinculo ? (
          <>
            <span className="flex items-center gap-1.5 text-[12px] text-white/80">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> Rinkel de {persona.nombre} vinculado
            </span>
            <span className="text-[12px] text-white/40" suppressHydrationWarning>
              {vinculo.ultimo_sync_at ? `Última lectura ${hace(vinculo.ultimo_sync_at)}` : 'Todavía sin leer'}
              {!vinculo.historico_completo && ' · importando el histórico'}
            </span>
            {vinculo.ultimo_error && (
              <span className="flex items-center gap-1.5 text-[12px] text-amber-300">
                <AlertCircle className="h-3.5 w-3.5" /> {vinculo.ultimo_error}
              </span>
            )}
          </>
        ) : (
          <span className="flex items-center gap-1.5 text-[12px] text-white/50">
            <Unlink className="h-3.5 w-3.5" /> {persona.nombre} todavía no ha vinculado su Rinkel. Se vincula desde su propio panel.
          </span>
        )}
      </div>
    )
  }

  /* ---------------------------- el formulario de la clave ---------------------------- */

  const formulario = (
    <form onSubmit={vincular} className="space-y-2">
      <label htmlFor="clave-rinkel" className="block text-[11px] font-medium text-white/60">
        Clave de la API de Rinkel
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          id="clave-rinkel"
          name="clave-rinkel"
          type="password"
          value={clave}
          onChange={(e) => setClave(e.target.value)}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          data-1p-ignore
          data-lpignore="true"
          data-bwignore="true"
          placeholder="Pega aquí la clave entera"
          disabled={trabajando !== null}
          className="flex-1 min-w-0 h-10 rounded-lg bg-white/[0.04] border border-white/10 px-3 text-[13px] text-white font-mono outline-none focus:border-[#FF6600] transition-colors placeholder:text-white/25 placeholder:font-sans disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={!clave.trim() || trabajando !== null}
          className="h-10 px-4 rounded-lg bg-[#FF6600] text-[13px] font-semibold text-white disabled:opacity-40 transition-opacity flex items-center justify-center gap-2 shrink-0"
        >
          {trabajando === 'comprobando' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Link2 className="h-4 w-4" />}
          {trabajando === 'comprobando' ? 'Comprobando…' : vinculo ? 'Cambiar clave' : 'Vincular y leer mis llamadas'}
        </button>
      </div>
      <p className="text-[11px] text-white/35 leading-relaxed">
        La clave se guarda cifrada y no se vuelve a mostrar. Solo sirve para LEER tus llamadas y sus grabaciones: el ERP no llama ni cambia nada en Rinkel.{' '}
        <a
          href="https://developers.rinkel.com"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-white/55 hover:text-white underline underline-offset-2"
        >
          Cómo crear la clave en Rinkel <ExternalLink className="h-3 w-3" />
        </a>
      </p>
    </form>
  )

  const mensajeDeError = error ? (
    <p className="flex items-start gap-2 text-[12px] text-amber-300 leading-snug mt-2.5" role="alert">
      <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> {error}
    </p>
  ) : null

  /* ---------------------------- sin vincular ---------------------------- */

  if (!vinculo) {
    return (
      <div className={`rounded-2xl border p-4 ${destacar ? 'border-[#FF6600]/30 bg-[#FF6600]/[0.05]' : 'border-white/10 bg-white/[0.02]'}`}>
        <div className="flex items-start gap-3 mb-3">
          <span className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${destacar ? 'bg-[#FF6600]/15' : 'bg-white/[0.06]'}`}>
            <KeyRound className={`h-5 w-5 ${destacar ? 'text-[#FF6600]' : 'text-white/50'}`} />
          </span>
          <div>
            <h2 className="text-[14px] font-semibold text-white">{destacar ? 'Vincula tu Rinkel' : 'Vincula tu Rinkel (si llamas con él)'}</h2>
            <p className="text-[12px] text-white/55 leading-relaxed mt-0.5">
              Con tu clave, el ERP lee todas tus llamadas —las de hoy y las de los días anteriores— y las enseña en el calendario, con su grabación para escucharla.
            </p>
          </div>
        </div>
        {trabajando === 'importando' ? <Progreso importadas={progreso?.importadas ?? null} total={progreso?.total ?? null} leyendo /> : formulario}
        {mensajeDeError}
      </div>
    )
  }

  /* ---------------------------- vinculado ---------------------------- */

  const total = progreso?.total ?? vinculo.rinkel_total
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-white whitespace-nowrap">
            <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" /> Rinkel vinculado
          </p>
          {(vinculo.rinkel_usuario || vinculo.rinkel_numero) && (
            <p className="text-[12px] text-white/55 mt-0.5 truncate">{[vinculo.rinkel_usuario, vinculo.rinkel_numero].filter(Boolean).join(' · ')}</p>
          )}
          <p className="text-[11px] text-white/40 mt-0.5" suppressHydrationWarning>
            {trabajando === 'importando'
              ? 'Leyendo tus llamadas…'
              : vinculo.ultimo_sync_at
                ? `Última lectura ${hace(vinculo.ultimo_sync_at)} · se actualiza solo cada pocos minutos`
                : 'Todavía no se ha leído nada'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={sincronizarAhora}
            disabled={trabajando !== null}
            className="h-8 px-3 rounded-lg border border-white/10 text-[12px] text-white/75 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${trabajando === 'importando' ? 'animate-spin' : ''}`} /> Sincronizar ahora
          </button>
          <button
            type="button"
            onClick={() => setCambiando((v) => !v)}
            disabled={trabajando !== null}
            className="h-8 px-3 rounded-lg border border-white/10 text-[12px] text-white/55 hover:text-white hover:border-white/25 transition-colors disabled:opacity-40 whitespace-nowrap"
          >
            Cambiar clave
          </button>
          {confirmaQuitar ? (
            <span className="flex items-center gap-1.5 pl-1">
              <button
                type="button"
                onClick={desvincular}
                disabled={trabajando !== null}
                className="h-8 px-3 rounded-lg bg-red-500/80 text-[12px] font-semibold text-white disabled:opacity-40"
              >
                {trabajando === 'quitando' ? 'Quitando…' : 'Sí, desvincular'}
              </button>
              <button type="button" onClick={() => setConfirmaQuitar(false)} className="h-8 px-2 text-[12px] text-white/50 hover:text-white">
                No
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmaQuitar(true)}
              disabled={trabajando !== null}
              className="h-8 px-3 rounded-lg border border-white/10 text-[12px] text-white/40 hover:text-red-300 hover:border-red-400/40 transition-colors disabled:opacity-40 flex items-center gap-1.5 whitespace-nowrap"
            >
              <Unlink className="h-3.5 w-3.5" /> Desvincular
            </button>
          )}
        </div>
      </div>

      {confirmaQuitar && (
        <p className="text-[11px] text-white/40 mt-2">
          Se borra la clave y dejan de leerse llamadas nuevas. Las ya leídas se quedan, pero sus grabaciones no se podrán escuchar hasta que vuelvas a vincular.
        </p>
      )}

      {(trabajando === 'importando' || !vinculo.historico_completo) && (
        <div className="mt-3">
          <Progreso importadas={progreso?.importadas ?? null} total={total} leyendo={trabajando === 'importando'} />
        </div>
      )}

      {cambiando && <div className="mt-3 pt-3 border-t border-white/[0.07]">{formulario}</div>}
      {mensajeDeError ?? (vinculo.ultimo_error && !trabajando ? (
        <p className="flex items-start gap-2 text-[12px] text-amber-300 leading-snug mt-2.5" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> {vinculo.ultimo_error}
        </p>
      ) : null)}
    </div>
  )
}

function Progreso({ importadas, total, leyendo }: { importadas: number | null; total: number | null; leyendo: boolean }) {
  const porcentaje = importadas !== null && total && total > 0 ? Math.min(100, Math.round((importadas / total) * 100)) : null
  return (
    <div role="status" aria-live="polite">
      <div className="flex items-center justify-between text-[12px] text-white/60 mb-1.5">
        <span className="flex items-center gap-1.5">
          {leyendo && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {leyendo ? 'Leyendo tus llamadas…' : 'Falta terminar de leer tus llamadas antiguas'}
        </span>
        <span className="tabular-nums">{importadas !== null ? `${numero(importadas)}${total ? ` de ${numero(total)}` : ''}` : total ? `${numero(total)} en total` : ''}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
        <div className="h-full rounded-full bg-[#FF6600] transition-all duration-500" style={{ width: `${porcentaje ?? 8}%` }} />
      </div>
    </div>
  )
}
