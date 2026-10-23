'use client'

import { AlertCircle, Loader2, Paperclip, Send, Sparkles, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { tamanoLegible } from '@/lib/correo/formato'
import { SUGERENCIAS_DE_CAMBIO, cuerpoEscrito, hayCuerpoEscrito, ponerBorradorIa, sumarIndicacion, type RespuestaDeRedactar } from '@/lib/correo/ia-cliente'
import { camposSinRellenar, insertarPlantilla, rellenarPlantilla, textoSinFirma, type PlantillaDeCorreo } from '@/lib/correo/plantillas'
import type { BorradorDeCorreo } from '@/lib/correo/redactar'
import type { BuzonVisible } from '@/lib/correo/tipos'
import { enviarJson, pedir } from './api'
import { SelectorDePlantillas } from './SelectorDePlantillas'
import { BOTON_ICONO, BOTON_PRIMARIO, BOTON_SECUNDARIO, CAMPO } from './ui'

/**
 * ESCRIBIR, CONTESTAR O REENVIAR UN CORREO.
 *
 * Un cuadro encima de la pantalla, con el buzón desde el que sale a la vista (nunca se envía desde otra dirección). El
 * texto es texto plano: sale también en HTML sencillo, con los enlaces pulsables, y al contestar el servidor cita debajo
 * el mensaje original. Los adjuntos van en la misma petición (hasta 15 MB entre todos).
 *
 * Una dirección que no vale NO se descarta en silencio: la ruta devuelve cuál falla y se enseña aquí.
 */

const MAX_BYTES_ADJUNTOS = 15 * 1024 * 1024
const MAX_ADJUNTOS = 10

interface Props {
  buzon: BuzonVisible
  /** Quién escribe y si es administrador: de eso depende qué plantillas puede tocar */
  yoId: string
  esAdmin: boolean
  borrador: BorradorDeCorreo
  onCerrar: () => void
  /** Se ha enviado: el hilo en el que ha quedado y el asunto con el que salió */
  onEnviado: (hiloId: string, asunto: string) => void
}

interface RespuestaDeEnvio {
  ok: boolean
  hiloId: string
  copiadoAEnviados: boolean
  rechazados: string[]
}

const TITULO: Record<BorradorDeCorreo['modo'], string> = {
  nuevo: 'Nuevo mensaje',
  responder: 'Responder',
  'responder-todos': 'Responder a todos',
  reenviar: 'Reenviar',
}

export function Redactar({ buzon, yoId, esAdmin, borrador, onCerrar, onEnviado }: Props) {
  const [para, setPara] = useState(borrador.para)
  const [cc, setCc] = useState(borrador.cc)
  const [mostrarCc, setMostrarCc] = useState(borrador.cc !== '')
  const [asunto, setAsunto] = useState(borrador.asunto)
  const [texto, setTexto] = useState(borrador.texto)
  const [conCita, setConCita] = useState(borrador.conCita)
  const [adjuntos, setAdjuntos] = useState<File[]>([])
  const [enviando, setEnviando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmaCerrar, setConfirmaCerrar] = useState(false)
  // Redactar con IA: solo si el mensaje se abrió desde la ficha de un lead (hay a quién conocer). El borrador es una ayuda: se edita antes de enviar
  const [iaAbierta, setIaAbierta] = useState(false)
  const [iaPide, setIaPide] = useState('')
  const [iaRedactando, setIaRedactando] = useState(false)
  const [iaBorrador, setIaBorrador] = useState<{ id: string | null; ejemplos: number; aviso: string | null } | null>(null)
  const iaArrancada = useRef(false)
  const entradaPara = useRef<HTMLInputElement>(null)
  const entradaTexto = useRef<HTMLTextAreaElement>(null)
  const entradaFicheros = useRef<HTMLInputElement>(null)

  // Si ya se sabe a quién va, el cursor cae en el texto (al principio, encima de la firma); si no, en «Para».
  // SE INSISTE UNOS CUADROS: un mensaje que se abre desde otra aplicación (el chip del email de un lead, un aviso de correo nuevo) se monta
  // mientras Correo todavía está oculto —el cambio de pantalla llega un instante después— y un elemento oculto no admite el foco.
  useEffect(() => {
    const objetivo = borrador.para ? entradaTexto : entradaPara
    let intentos = 0
    let cuadro = 0
    const intentar = () => {
      const el = objetivo.current
      if (!el) return
      el.focus()
      if (borrador.para) el.setSelectionRange(0, 0)
      if (document.activeElement !== el && intentos++ < 40) cuadro = requestAnimationFrame(intentar)
    }
    intentar()
    return () => cancelAnimationFrame(cuadro)
  }, [borrador.para])

  const bytes = adjuntos.reduce((suma, f) => suma + f.size, 0)
  const tocado = texto !== borrador.texto || para !== borrador.para || cc !== borrador.cc || asunto !== borrador.asunto || adjuntos.length > 0

  function cerrar() {
    if (enviando) return
    if (tocado && !confirmaCerrar) {
      setConfirmaCerrar(true)
      return
    }
    onCerrar()
  }

  /** Lo que se sabe para rellenar los campos de una plantilla. {{nombre}} no está: lo escribe quien envía (ver lib/correo/plantillas.ts) */
  const datosDeRelleno = { empresa: borrador.lead?.empresa || borrador.lead?.nombre || null, mi_nombre: buzon.nombre || null, mi_correo: buzon.direccion }

  /**
   * Le pide a la IA el borrador de este lead y lo pone en el mensaje (asunto y cuerpo, con la firma del buzón debajo). Si ya hay un
   * borrador suyo, o algo escrito, parte de ello: «más corto» cambia lo que hay, no lo tira. Sin indicaciones sobre un borrador suyo se le pide
   * una versión distinta (si el comercial pulsa «Volver a redactar» sin más, es que esa no le valía).
   */
  async function redactarConIa(indicaciones: string) {
    if (!borrador.lead || iaRedactando || enviando) return
    setError(null)
    setIaAbierta(false)
    setIaRedactando(true)
    const hayBase = hayCuerpoEscrito(texto, buzon.firma)
    const pide = indicaciones.trim() || (iaBorrador && hayBase ? 'Escribe una versión distinta, con otro enfoque.' : '')
    const r = await enviarJson<RespuestaDeRedactar>('/api/correo/redactar-ia', 'POST', {
      leadId: borrador.lead.id,
      buzonId: buzon.id,
      indicaciones: pide || undefined,
      anterior: hayBase ? { asunto: asunto.trim() || '(sin asunto)', texto: cuerpoEscrito(texto, buzon.firma) } : undefined,
    })
    setIaRedactando(false)
    if (!r.ok) return setError(r.mensaje)
    // El asunto solo se cambia en un mensaje nuevo: al contestar se queda el «Re: …» de la conversación
    if (borrador.modo === 'nuevo') setAsunto(r.datos.asunto)
    setTexto(ponerBorradorIa(buzon.firma, r.datos.texto))
    setIaBorrador({ id: r.datos.id, ejemplos: r.datos.ejemplos, aviso: r.datos.aviso })
    setIaPide('')
    requestAnimationFrame(() => {
      const el = entradaTexto.current
      el?.focus()
      el?.setSelectionRange(0, 0)
      el?.scrollTo({ top: 0 })
    })
  }

  // Desde el chip «Correo con IA» de la ficha el mensaje se abre y el borrador ya se está pidiendo. Una sola vez aunque React monte dos veces
  useEffect(() => {
    if (!borrador.generarIa || iaArrancada.current) return
    iaArrancada.current = true
    void redactarConIa('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function aplicarPlantilla(p: PlantillaDeCorreo) {
    // El asunto solo se cambia en un mensaje nuevo: al contestar se queda el «Re: …» de la conversación
    if (borrador.modo === 'nuevo' && p.asunto.trim()) setAsunto(rellenarPlantilla(p.asunto, datosDeRelleno))
    const el = entradaTexto.current
    const r = insertarPlantilla(texto, borrador.texto, rellenarPlantilla(p.texto, datosDeRelleno), el?.selectionStart ?? texto.length)
    setTexto(r.texto)
    setError(null)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(r.cursor, r.cursor)
    })
  }

  function insertarCampo(campo: string) {
    const el = entradaTexto.current
    const inicio = el?.selectionStart ?? texto.length
    const fin = el?.selectionEnd ?? inicio
    setTexto(texto.slice(0, inicio) + campo + texto.slice(fin))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(inicio + campo.length, inicio + campo.length)
    })
  }

  function añadir(ficheros: FileList | null) {
    if (!ficheros) return
    const nuevos = [...adjuntos, ...Array.from(ficheros)]
    if (nuevos.length > MAX_ADJUNTOS) return setError(`Se pueden adjuntar como mucho ${MAX_ADJUNTOS} ficheros.`)
    if (nuevos.reduce((s, f) => s + f.size, 0) > MAX_BYTES_ADJUNTOS) return setError(`Los adjuntos no pueden pasar de ${tamanoLegible(MAX_BYTES_ADJUNTOS)} en total.`)
    setError(null)
    setAdjuntos(nuevos)
    if (entradaFicheros.current) entradaFicheros.current.value = ''
  }

  async function enviar(e?: FormEvent) {
    e?.preventDefault()
    if (enviando || iaRedactando) return
    if (!para.trim()) return setError('Falta al menos un destinatario.')
    if (!asunto.trim() && borrador.modo === 'nuevo') return setError('Escribe un asunto.')
    if (!texto.trim() && adjuntos.length === 0) return setError('El mensaje está vacío.')
    // Un campo de plantilla sin rellenar («Hola {{nombre}}») NO sale: es el error que no se puede deshacer una vez enviado
    const pendientes = camposSinRellenar(`${asunto}\n${texto}`)
    if (pendientes.length > 0) return setError(`Quedan campos sin rellenar: ${pendientes.join(', ')}. Escríbelos, o bórralos, antes de enviar.`)

    setError(null)
    setEnviando(true)
    const f = new FormData()
    f.set('buzonId', buzon.id)
    f.set('para', para)
    f.set('cc', cc)
    f.set('asunto', asunto)
    f.set('texto', texto)
    if (borrador.respondeA) {
      f.set('respondeA', borrador.respondeA)
      f.set('modo', borrador.modo === 'reenviar' ? 'reenviar' : 'responder')
      if (!conCita) f.set('sinCita', '1')
    }
    // Si el mensaje sale de un borrador de la IA se apunta lo que salió de verdad (editado), para medir si funciona
    if (iaBorrador?.id) f.set('iaId', iaBorrador.id)
    for (const a of adjuntos) f.append('adjuntos', a, a.name)

    const r = await pedir<RespuestaDeEnvio>('/api/correo/enviar', { method: 'POST', body: f })
    setEnviando(false)
    if (!r.ok) return setError(r.mensaje)

    if (r.datos.rechazados.length > 0) toast.warning(`Enviado, pero el servidor no ha entregado a: ${r.datos.rechazados.join(', ')}`)
    else if (!r.datos.copiadoAEnviados) toast.warning('Enviado. No se ha podido guardar la copia en la carpeta Enviados del webmail.')
    else toast.success('Mensaje enviado.')
    onEnviado(r.datos.hiloId, asunto.trim())
  }

  function teclas(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.stopPropagation()
      cerrar()
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void enviar()
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && cerrar()} onKeyDown={teclas}>
      <form
        onSubmit={enviar}
        role="dialog"
        aria-modal="true"
        aria-label={TITULO[borrador.modo]}
        className="flex max-h-[94dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-t-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50 sm:rounded-[12px]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-[var(--ls-linea)] px-4 py-2.5">
          <div className="min-w-0">
            <h2 className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{TITULO[borrador.modo]}</h2>
            <p className="truncate text-[11.5px] text-[var(--ls-t4)]">
              Desde {buzon.nombre ? `${buzon.nombre} · ` : ''}
              {buzon.direccion}
            </p>
          </div>
          <button type="button" onClick={cerrar} className={BOTON_ICONO} aria-label="Cerrar sin enviar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-4">
          <label className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[12px] text-[var(--ls-t3)]">Para</span>
            <input ref={entradaPara} value={para} onChange={(e) => setPara(e.target.value)} placeholder="nombre@cliente.es, otra@cliente.es" spellCheck={false} autoComplete="off" className={CAMPO} />
            {!mostrarCc && (
              <button type="button" onClick={() => setMostrarCc(true)} className="shrink-0 text-[12px] text-[var(--ls-t3)] underline underline-offset-2 hover:text-[var(--ls-t1)]">
                Cc
              </button>
            )}
          </label>
          {mostrarCc && (
            <label className="flex items-center gap-3">
              <span className="w-14 shrink-0 text-[12px] text-[var(--ls-t3)]">Cc</span>
              <input value={cc} onChange={(e) => setCc(e.target.value)} spellCheck={false} autoComplete="off" className={CAMPO} />
            </label>
          )}
          <label className="flex items-center gap-3">
            <span className="w-14 shrink-0 text-[12px] text-[var(--ls-t3)]">Asunto</span>
            <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={500} className={CAMPO} />
          </label>
          <div className="relative">
            <textarea
              ref={entradaTexto}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              readOnly={iaRedactando}
              rows={14}
              aria-label="Mensaje"
              aria-busy={iaRedactando}
              className={`w-full resize-y rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3 text-[13px] leading-relaxed text-[var(--ls-t1)] outline-none transition-[colors,opacity] focus:border-[var(--ls-acc-graf)] ${iaRedactando ? 'opacity-40' : ''}`}
            />
            {iaRedactando && (
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1.5 text-[var(--ls-t2)]" role="status">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--ls-acc)]" aria-hidden />
                <p className="text-[13px] font-medium">Redactando el correo con IA…</p>
                <p className="text-[11.5px] text-[var(--ls-t3)]">Suele tardar unos segundos. Después lo puedes editar.</p>
              </div>
            )}
          </div>
          {iaBorrador && !iaRedactando && (
            <p className="flex items-start gap-2 text-[11.5px] leading-snug text-[var(--ls-t3)]">
              <Sparkles className="mt-px h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" aria-hidden />
              <span>
                Borrador de la IA: léelo y edítalo antes de enviar.
                {iaBorrador.ejemplos > 0 ? ` Se ha basado en ${iaBorrador.ejemplos} ${iaBorrador.ejemplos === 1 ? 'correo' : 'correos'} del equipo que obtuvieron respuesta.` : ''}
                {iaBorrador.aviso ? <span className="text-[var(--ls-e-ambar)]"> {iaBorrador.aviso}</span> : null}
              </span>
            </p>
          )}

          {borrador.respondeA && (
            <label className="flex cursor-pointer select-none items-center gap-2 text-[12px] text-[var(--ls-t3)]">
              {borrador.modo === 'reenviar' ? (
                <span>El mensaje original va debajo. Los adjuntos del original no se reenvían.</span>
              ) : (
                <>
                  <input type="checkbox" checked={conCita} onChange={(e) => setConCita(e.target.checked)} className="h-3.5 w-3.5 accent-[var(--ls-acc-graf)]" />
                  Citar el mensaje original debajo
                </>
              )}
            </label>
          )}

          {adjuntos.length > 0 && (
            <ul className="flex flex-wrap gap-2" aria-label="Adjuntos">
              {adjuntos.map((a, i) => (
                <li key={`${a.name}-${i}`} className="inline-flex max-w-[260px] items-center gap-2 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] py-1 pl-2.5 pr-1 text-[12px] text-[var(--ls-t2)]">
                  <Paperclip className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />
                  <span className="min-w-0 truncate">{a.name}</span>
                  <span className="shrink-0 text-[11px] text-[var(--ls-t4)]">{tamanoLegible(a.size)}</span>
                  <button type="button" onClick={() => setAdjuntos(adjuntos.filter((_, j) => j !== i))} aria-label={`Quitar ${a.name}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p className="flex items-start gap-2 text-[12px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
              <AlertCircle className="mt-px h-4 w-4 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] px-4 py-3">
          <button type="submit" disabled={enviando || iaRedactando} className={BOTON_PRIMARIO}>
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
          <input ref={entradaFicheros} type="file" multiple onChange={(e) => añadir(e.target.files)} className="sr-only" tabIndex={-1} aria-hidden />
          {borrador.lead && (
            <Popover open={iaAbierta && !iaRedactando} onOpenChange={setIaAbierta}>
              <PopoverTrigger asChild>
                <button type="button" disabled={enviando || iaRedactando} className={BOTON_SECUNDARIO} title="La IA escribe el correo con los datos y el historial de este lead (sin facturación)">
                  {iaRedactando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Sparkles className="h-3.5 w-3.5 text-[var(--ls-acc)]" aria-hidden />}
                  {iaRedactando ? 'Redactando…' : iaBorrador ? 'Volver a redactar' : 'Redactar con IA'}
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                side="top"
                sideOffset={8}
                collisionPadding={12}
                className="z-[80] w-[min(360px,calc(100vw-1.5rem))] space-y-2.5 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-3 text-[var(--ls-t2)] shadow-2xl"
                onOpenAutoFocus={(e) => {
                  e.preventDefault()
                  document.getElementById('ia-indicaciones')?.focus()
                }}
                // Lo que se teclea aquí no es del mensaje: Ctrl+Intro redacta (no envía) y Escape cierra solo este cuadro
                onKeyDown={(e) => e.stopPropagation()}
              >
                <p className="text-[12px] leading-snug text-[var(--ls-t3)]">
                  {hayCuerpoEscrito(texto, buzon.firma) ? 'Parte de lo que hay escrito y lo sustituye por el nuevo borrador.' : 'Escribe el correo con los datos y el historial de este lead.'} No dirá nada de facturación.
                </p>
                <textarea
                  id="ia-indicaciones"
                  value={iaPide}
                  onChange={(e) => setIaPide(e.target.value.slice(0, 600))}
                  onKeyDown={(e) => {
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      void redactarConIa(iaPide)
                    }
                  }}
                  rows={3}
                  placeholder="Opcional: qué quieres que diga o cambie…"
                  aria-label="Indicaciones para la IA"
                  className="w-full resize-none rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5 text-[12.5px] leading-snug text-[var(--ls-t1)] outline-none transition-colors placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
                />
                <div className="flex flex-wrap gap-1.5">
                  {SUGERENCIAS_DE_CAMBIO.map((s) => (
                    <button key={s} type="button" onClick={() => setIaPide(sumarIndicacion(iaPide, s))} className="inline-flex h-6 items-center rounded-[6px] border border-[var(--ls-linea)] px-2 text-[11.5px] text-[var(--ls-t3)] transition-colors hover:border-[var(--ls-linea2)] hover:text-[var(--ls-t1)]">
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-[var(--ls-t4)]">Ctrl + Intro</span>
                  <button type="button" onClick={() => void redactarConIa(iaPide)} className={`${BOTON_PRIMARIO} !h-8 !px-3 !text-[12.5px]`}>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> {iaBorrador ? 'Volver a redactar' : 'Redactar'}
                  </button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          <SelectorDePlantillas yoId={yoId} esAdmin={esAdmin} actual={{ asunto, texto: textoSinFirma(texto, buzon.firma) }} onAplicar={aplicarPlantilla} onInsertarCampo={insertarCampo} conAsunto={borrador.modo === 'nuevo'} />
          <button type="button" onClick={() => entradaFicheros.current?.click()} disabled={enviando} className={BOTON_SECUNDARIO}>
            <Paperclip className="h-3.5 w-3.5" aria-hidden /> Adjuntar
          </button>
          {bytes > 0 && (
            <span className="text-[11.5px] text-[var(--ls-t4)]">
              {tamanoLegible(bytes)} de {tamanoLegible(MAX_BYTES_ADJUNTOS)}
            </span>
          )}
          <span className="hidden text-[11px] text-[var(--ls-t4)] md:inline">Ctrl + Intro para enviar</span>
          <span className="ml-auto flex items-center gap-2">
            {confirmaCerrar && <span className="text-[12px] text-[var(--ls-t3)]">¿Descartar lo escrito?</span>}
            <button type="button" onClick={confirmaCerrar ? onCerrar : cerrar} disabled={enviando} className={confirmaCerrar ? `${BOTON_SECUNDARIO} border-[var(--ls-e-rojo)] text-[var(--ls-e-rojo)]` : BOTON_SECUNDARIO}>
              {confirmaCerrar ? 'Sí, descartar' : 'Descartar'}
            </button>
            {confirmaCerrar && (
              <button type="button" onClick={() => setConfirmaCerrar(false)} className="h-8 px-2 text-[12px] text-[var(--ls-t4)] hover:text-[var(--ls-t1)]">
                Seguir escribiendo
              </button>
            )}
          </span>
        </footer>
      </form>
    </div>
  )
}
