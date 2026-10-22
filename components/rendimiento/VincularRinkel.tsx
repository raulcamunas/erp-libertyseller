'use client'

import { formatDistanceToNow } from 'date-fns'
import { es } from 'date-fns/locale'
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, KeyRound, Link2, Loader2, RefreshCw, Unlink } from 'lucide-react'
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
 * UN ADMINISTRADOR puede hacerlo también por otra persona: ve su panel, pega su clave y queda a nombre de ella
 * (la ruta manda `usuario`). Quien solo supervisa no: ve el estado de la cuenta y nada más. El permiso de verdad
 * lo comprueba la ruta; `puedeGestionar` solo decide si se pintan los botones.
 *
 * DOS FORMAS. La tarjeta de siempre (la que invita a vincular, enseña el avance de la importación y los errores) y,
 * con `compacta`, un chip pequeño —«Rinkel · leído hace 10 minutos»— con el botón de sincronizar al lado; al pulsarlo se
 * abre debajo la ficha de la cuenta con sus acciones (cambiar la clave, desvincular). La compacta es para cuando todo
 * va bien: ocupa lo que una palabra en la fila del título de las cifras en vez de una fila entera.
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

async function pedir(
  cuerpo: { accion: 'vincular'; clave: string } | { accion: 'sincronizar' } | { accion: 'desvincular' },
  /** El id de la otra persona, si es un administrador actuando por ella. Sin esto, la cuenta de quien pide */
  usuario?: string
): Promise<Respuesta> {
  try {
    const r = await fetch('/api/rendimiento/rinkel', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(usuario ? { ...cuerpo, usuario } : cuerpo),
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
  /** Es su propio panel */
  esPropio: boolean
  /** Quien mira es administrador: puede vincular, cambiar, sincronizar o desvincular la clave de otra persona */
  puedeGestionar?: boolean
  vinculo: VinculoVisible | null
  /** Pide al panel que vuelva a leer el vínculo y las llamadas de la base */
  onCambio: () => Promise<void>
  /**
   * La invitación a vincular sale con el acento naranja. Se apaga para quien mira el panel pero no es del
   * equipo comercial (un administrador que supervisa): no llama con Rinkel y no hay que insistirle.
   */
  destacar?: boolean
  /** Un chip pequeño en vez de la tarjeta. Solo tiene sentido con la cuenta vinculada: sin vincular siempre sale la tarjeta */
  compacta?: boolean
}

export function VincularRinkel({ persona, esPropio, puedeGestionar = false, vinculo, onCambio, destacar = true, compacta = false }: Props) {
  /** Se puede actuar sobre esta cuenta: la propia, o la de otra persona siendo administrador */
  const puedeActuar = esPropio || puedeGestionar
  /** Sobre quién se pide: nadie (la cuenta de quien pide) si es la propia; la persona del panel si no */
  const sobre = esPropio ? undefined : persona.id
  const suyas = esPropio ? 'tus' : 'sus'
  const [clave, setClave] = useState('')
  const [cambiando, setCambiando] = useState(false)
  const [trabajando, setTrabajando] = useState<null | 'comprobando' | 'importando' | 'quitando'>(null)
  const [progreso, setProgreso] = useState<{ importadas: number; total: number | null } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmaQuitar, setConfirmaQuitar] = useState(false)
  /** La ficha de la cuenta que se abre desde el chip (solo en la forma compacta) */
  const [abierto, setAbierto] = useState(false)
  const raiz = useRef<HTMLDivElement>(null)
  const vivo = useRef(true)
  const importando = useRef(false)

  useEffect(() => {
    vivo.current = true
    return () => {
      vivo.current = false
    }
  }, [])

  // La ficha se cierra al pulsar fuera de ella o con Esc
  useEffect(() => {
    if (!abierto) return
    const fuera = (e: MouseEvent) => {
      if (raiz.current && !raiz.current.contains(e.target as Node)) setAbierto(false)
    }
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAbierto(false)
    }
    document.addEventListener('mousedown', fuera)
    document.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      document.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  // Un fallo al sincronizar a mano no puede quedarse escondido detrás de un chip cerrado
  useEffect(() => {
    if (compacta && error) setAbierto(true)
  }, [compacta, error])

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
        const r = await pedir({ accion: 'sincronizar' }, sobre)
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
    const r = await pedir({ accion: 'vincular', clave: pegada }, sobre)
    if (!r.ok) {
      setTrabajando(null)
      setError(r.mensaje)
      return
    }
    setCambiando(false)
    toast.success(esPropio ? 'Rinkel vinculado. Leyendo tus llamadas…' : `Rinkel de ${persona.nombre} vinculado. Leyendo sus llamadas…`)
    await importar(r.resumen)
  }

  async function sincronizarAhora() {
    if (trabajando) return
    const resultado = await importar()
    if (resultado === 'reciente') toast.info('Ya estaba al día: se acaba de leer.')
    else if (resultado === 'ocupada') toast.info(`Ya se están leyendo ${suyas} llamadas. Se verán en un momento.`)
    else if (resultado === 'hecho') toast.success('Llamadas al día.')
  }

  async function desvincular() {
    setTrabajando('quitando')
    setError(null)
    const r = await pedir({ accion: 'desvincular' }, sobre)
    setTrabajando(null)
    setConfirmaQuitar(false)
    if (!r.ok) {
      setError(r.mensaje)
      return
    }
    toast.success(esPropio ? 'Rinkel desvinculado. Las llamadas ya leídas se quedan.' : `Rinkel de ${persona.nombre} desvinculado. Las llamadas ya leídas se quedan.`)
    await onCambio()
  }

  // Si se abre la pantalla con el histórico a medias (se cerró la pestaña, o se acaba de vincular desde otro sitio), sigue
  useEffect(() => {
    if (esPropio && vinculo && !vinculo.historico_completo) void importar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---------------------------- mirando a otra persona, sin poder tocarla ---------------------------- */

  if (!puedeActuar) {
    if (compacta && vinculo) {
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-white/45" suppressHydrationWarning>
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          {vinculo.ultimo_sync_at ? `Rinkel · leído ${hace(vinculo.ultimo_sync_at)}` : 'Rinkel · todavía sin leer'}
          {!vinculo.historico_completo && ' · importando el histórico'}
        </p>
      )
    }
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
        {esPropio ? 'Clave de la API de Rinkel' : `Clave de la API de Rinkel de ${persona.nombre}`}
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
          {trabajando === 'comprobando' ? 'Comprobando…' : vinculo ? 'Cambiar clave' : esPropio ? 'Vincular y leer mis llamadas' : 'Vincular y leer sus llamadas'}
        </button>
      </div>
      <p className="text-[11px] text-white/35 leading-relaxed">
        La clave se guarda cifrada y no se vuelve a mostrar. Solo sirve para LEER las llamadas y las grabaciones de la cuenta: el ERP no llama ni cambia nada en Rinkel.{' '}
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
            <h2 className="text-[14px] font-semibold text-white">
              {!esPropio ? `Vincula el Rinkel de ${persona.nombre}` : destacar ? 'Vincula tu Rinkel' : 'Vincula tu Rinkel (si llamas con él)'}
            </h2>
            <p className="text-[12px] text-white/55 leading-relaxed mt-0.5">
              {esPropio
                ? 'Con tu clave, el ERP lee todas tus llamadas —las de hoy y las de los días anteriores— y las enseña en el calendario, con su grabación para escucharla.'
                : `Con su clave, el ERP lee todas sus llamadas —las de hoy y las de los días anteriores— y las enseña en el calendario, con su grabación para escucharla. ${persona.nombre} la verá vinculada en su panel y podrá cambiarla o quitarla.`}
            </p>
          </div>
        </div>
        {trabajando === 'importando' ? <Progreso importadas={progreso?.importadas ?? null} total={progreso?.total ?? null} leyendo suyas={suyas} /> : formulario}
        {mensajeDeError}
      </div>
    )
  }

  /* ---------------------------- vinculado ---------------------------- */

  const total = progreso?.total ?? vinculo.rinkel_total

  // Todo lo de la cuenta vinculada: quién es, cuándo se leyó, sus acciones, el avance y los avisos.
  // Va dentro de la tarjeta, o dentro de la ficha que abre el chip en la forma compacta.
  const contenido = (
    <>
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
              ? `Leyendo ${suyas} llamadas…`
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
          Se borra la clave y dejan de leerse llamadas nuevas. Las ya leídas se quedan, pero no se podrán escuchar sus grabaciones hasta que se vuelva a vincular.
        </p>
      )}

      {(trabajando === 'importando' || !vinculo.historico_completo) && (
        <div className="mt-3">
          <Progreso importadas={progreso?.importadas ?? null} total={total} leyendo={trabajando === 'importando'} suyas={suyas} />
        </div>
      )}

      {cambiando && <div className="mt-3 pt-3 border-t border-white/[0.07]">{formulario}</div>}
      {mensajeDeError ?? (vinculo.ultimo_error && !trabajando ? (
        <p className="flex items-start gap-2 text-[12px] text-amber-300 leading-snug mt-2.5" role="alert">
          <AlertCircle className="h-4 w-4 shrink-0 mt-px" /> {vinculo.ultimo_error}
        </p>
      ) : null)}
    </>
  )

  if (compacta) {
    const trabajandoAhora = trabajando === 'importando'
    const aviso = Boolean(error)
    const textoDelChip = trabajandoAhora
      ? 'Leyendo llamadas…'
      : !vinculo.historico_completo
        ? 'Importando el histórico…'
        : vinculo.ultimo_sync_at
          ? `Rinkel · leído ${hace(vinculo.ultimo_sync_at)}`
          : 'Rinkel · todavía sin leer'
    return (
      <div ref={raiz} className="relative flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => setAbierto((v) => !v)}
          aria-expanded={abierto}
          aria-haspopup="dialog"
          title="La cuenta de Rinkel de donde se leen las llamadas"
          className={`h-7 pl-2.5 pr-2 rounded-full border bg-white/[0.02] text-[11px] flex items-center gap-1.5 whitespace-nowrap transition-colors ${
            aviso ? 'border-amber-400/40 text-amber-200' : 'border-white/10 text-white/55 hover:text-white hover:border-white/25'
          }`}
        >
          {trabajandoAhora ? (
            <Loader2 className="h-3 w-3 animate-spin text-[#FF6600]" aria-hidden />
          ) : aviso ? (
            <AlertCircle className="h-3 w-3 text-amber-300" aria-hidden />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          )}
          <span suppressHydrationWarning>{textoDelChip}</span>
          <ChevronDown className={`h-3 w-3 text-white/30 transition-transform ${abierto ? 'rotate-180' : ''}`} aria-hidden />
        </button>
        <button
          type="button"
          onClick={sincronizarAhora}
          disabled={trabajando !== null}
          title="Sincronizar ahora"
          aria-label="Sincronizar ahora"
          className="h-7 w-7 rounded-full border border-white/10 flex items-center justify-center text-white/50 hover:text-white hover:border-white/25 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${trabajandoAhora ? 'animate-spin' : ''}`} />
        </button>
        {abierto && (
          <div role="dialog" aria-label="Cuenta de Rinkel" className="absolute right-0 top-full mt-2 z-30 w-[min(92vw,420px)] rounded-2xl border border-white/10 bg-[#121212] px-4 py-3 shadow-2xl shadow-black/60">
            {contenido}
          </div>
        )}
      </div>
    )
  }

  return <div className="rounded-2xl border border-white/10 bg-white/[0.02] px-4 py-3">{contenido}</div>
}

function Progreso({ importadas, total, leyendo, suyas }: { importadas: number | null; total: number | null; leyendo: boolean; suyas: 'tus' | 'sus' }) {
  const porcentaje = importadas !== null && total && total > 0 ? Math.min(100, Math.round((importadas / total) * 100)) : null
  return (
    <div role="status" aria-live="polite">
      <div className="flex items-center justify-between text-[12px] text-white/60 mb-1.5">
        <span className="flex items-center gap-1.5">
          {leyendo && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {leyendo ? `Leyendo ${suyas} llamadas…` : `Falta terminar de leer ${suyas} llamadas antiguas`}
        </span>
        <span className="tabular-nums">{importadas !== null ? `${numero(importadas)}${total ? ` de ${numero(total)}` : ''}` : total ? `${numero(total)} en total` : ''}</span>
      </div>
      <div className="h-1.5 rounded-full bg-white/[0.07] overflow-hidden">
        <div className="h-full rounded-full bg-[#FF6600] transition-all duration-500" style={{ width: `${porcentaje ?? 8}%` }} />
      </div>
    </div>
  )
}
