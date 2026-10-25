'use client'

import { Loader2, Plus, Trash2, Users, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast } from 'sonner'
import { BOTON } from '@/lib/estilo/denso'
import { borrarMensaje, guardarMensaje } from '@/lib/whatsapp/cliente'
import {
  AYUDA_DE_SITUACION,
  CAMPOS_DE_WHATSAPP,
  ETIQUETA_DE_SITUACION,
  MAX_DE_MENSAJE,
  MENSAJE_DE_SERIE,
  SITUACIONES_DE_WHATSAPP,
  rellenarMensaje,
  type MensajeDeWhatsapp,
  type SituacionDeWhatsapp,
} from '@/lib/whatsapp/mensajes'

/**
 * LA VENTANA DONDE SE CAMBIAN LOS MENSAJES DE WHATSAPP.
 * =====================================================
 * Tres pestañas, una por situación (primer contacto · te he llamado y no contesta · después de hablar), y en cada una los mensajes que hay:
 * los míos (los toco yo) y los del equipo (solo los toca un administrador). Se pueden tener VARIOS por situación: el botón de la ficha reparte
 * los leads entre ellos para no mandar siempre el mismo texto palabra por palabra.
 *
 * Mientras nadie ha guardado ninguno, se ve el mensaje de serie ya escrito: se retoca y se guarda, y ese pasa a ser el propio (o el del equipo,
 * si lo guarda un administrador marcando la casilla). Debajo de cada mensaje se ve cómo quedará de verdad, con una tienda y un nombre de ejemplo.
 * Un mensaje con un campo que no se sabe rellenar ({{nombre}}…) no se deja guardar: el botón no lo abriría.
 */

interface Props {
  yoId: string
  esAdmin: boolean
  /** El nombre de pila de quien escribe y una tienda de verdad (la del lead abierto), para el ejemplo de cada mensaje */
  miNombre: string
  empresaDeEjemplo: string
  situacionInicial: SituacionDeWhatsapp
  guardados: readonly MensajeDeWhatsapp[]
  onCerrar: () => void
  /** Algo ha cambiado en la base: que el botón de la ficha vuelva a leer los mensajes */
  onCambio: () => Promise<void> | void
}

/** Una fila de la lista: un mensaje guardado, el de serie todavía sin guardar, o uno nuevo que se está escribiendo */
interface Fila {
  clave: string
  /** null = todavía no existe en la base */
  id: string | null
  user_id: string | null
  situacion: SituacionDeWhatsapp
  original: string
  tipo: 'guardado' | 'serie' | 'nuevo'
}

export function EditorDeMensajesDeWhatsapp({ yoId, esAdmin, miNombre, empresaDeEjemplo, situacionInicial, guardados, onCerrar, onCambio }: Props) {
  const [situacion, setSituacion] = useState<SituacionDeWhatsapp>(situacionInicial)
  const [borradores, setBorradores] = useState<Record<string, string>>({})
  const [nuevos, setNuevos] = useState<Array<{ clave: string; situacion: SituacionDeWhatsapp }>>([])
  const [paraElEquipo, setParaElEquipo] = useState<Record<string, boolean>>({})
  const [ocupado, setOcupado] = useState<string | null>(null)
  const [confirmaBorrar, setConfirmaBorrar] = useState<string | null>(null)
  const [confirmaCierre, setConfirmaCierre] = useState(false)
  const contador = useRef(0)
  const campos = useRef<Record<string, HTMLTextAreaElement | null>>({})

  const ejemplo = { empresa: empresaDeEjemplo || 'Casa Luz', miNombre: miNombre || 'Ana' }

  // Las filas de las tres situaciones: aunque solo se vea una, los cambios sin guardar de las otras cuentan
  const filasDe = useMemo(() => {
    const porSituacion = {} as Record<SituacionDeWhatsapp, Fila[]>
    for (const s of SITUACIONES_DE_WHATSAPP) {
      const lista: Fila[] = guardados.filter((m) => m.situacion === s && m.id !== null).map((m) => ({ clave: m.id as string, id: m.id, user_id: m.user_id, situacion: s, original: m.texto, tipo: 'guardado' as const }))
      // Mientras no haya ninguno guardado, el de serie se enseña como un mensaje más, listo para retocar
      if (lista.length === 0) lista.push({ clave: `serie-${s}`, id: null, user_id: null, situacion: s, original: MENSAJE_DE_SERIE[s], tipo: 'serie' })
      for (const n of nuevos) if (n.situacion === s) lista.push({ clave: n.clave, id: null, user_id: null, situacion: s, original: '', tipo: 'nuevo' })
      porSituacion[s] = lista
    }
    return porSituacion
  }, [guardados, nuevos])
  const filas = filasDe[situacion]

  const textoDe = (f: Fila) => borradores[f.clave] ?? f.original
  const hayCambios = SITUACIONES_DE_WHATSAPP.some((s) => filasDe[s].some((f) => borradores[f.clave] !== undefined && borradores[f.clave] !== f.original))

  const cerrar = () => {
    if (hayCambios && !confirmaCierre) {
      setConfirmaCierre(true)
      return
    }
    onCerrar()
  }

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        cerrar()
      }
    }
    window.addEventListener('keydown', alPulsar, true)
    return () => window.removeEventListener('keydown', alPulsar, true)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const puedeTocar = (f: Fila) => f.tipo !== 'guardado' || (f.user_id === null ? esAdmin : f.user_id === yoId)

  const problemaDe = (texto: string): string | null => {
    const limpio = texto.trim()
    if (limpio === '') return 'Escribe el mensaje.'
    if (limpio.length > MAX_DE_MENSAJE) return `Es demasiado largo (${limpio.length} de ${MAX_DE_MENSAJE} letras).`
    const { sinRellenar } = rellenarMensaje(limpio, ejemplo)
    if (sinRellenar.length > 0) return `Lleva ${sinRellenar.join(', ')}: no se rellena solo y el botón no abriría el mensaje. Quítalo o cámbialo por {{empresa}} o {{mi_nombre}}.`
    return null
  }

  async function guardar(f: Fila) {
    const texto = textoDe(f).trim()
    const problema = problemaDe(texto)
    if (problema) return toast.error(problema)
    setOcupado(f.clave)
    const dueno = f.id ? f.user_id : paraElEquipo[f.clave] && esAdmin ? null : yoId
    const r = await guardarMensaje({ id: f.id, user_id: dueno, situacion: f.situacion, texto })
    setOcupado(null)
    if (!r.ok) return toast.error(r.mensaje)
    toast.success('Mensaje guardado.')
    setBorradores((b) => {
      const { [f.clave]: _quitado, ...resto } = b
      return resto
    })
    setNuevos((n) => n.filter((x) => x.clave !== f.clave))
    await onCambio()
  }

  async function borrar(f: Fila) {
    if (!f.id) {
      setNuevos((n) => n.filter((x) => x.clave !== f.clave))
      setBorradores((b) => {
        const { [f.clave]: _quitado, ...resto } = b
        return resto
      })
      return
    }
    setOcupado(f.clave)
    const r = await borrarMensaje(f.id)
    setOcupado(null)
    setConfirmaBorrar(null)
    if (!r.ok) return toast.error(r.mensaje)
    await onCambio()
  }

  const anadir = () => {
    contador.current += 1
    const clave = `nuevo-${contador.current}`
    setNuevos((n) => [...n, { clave, situacion }])
    setBorradores((b) => ({ ...b, [clave]: '' }))
    // El cursor va al mensaje nuevo en cuanto exista
    setTimeout(() => campos.current[clave]?.focus(), 30)
  }

  const insertarCampo = (f: Fila, campo: string) => {
    const el = campos.current[f.clave]
    const actual = textoDe(f)
    const pos = el?.selectionStart ?? actual.length
    setBorradores((b) => ({ ...b, [f.clave]: actual.slice(0, pos) + campo + actual.slice(pos) }))
    setTimeout(() => {
      el?.focus()
      el?.setSelectionRange(pos + campo.length, pos + campo.length)
    }, 0)
  }

  if (typeof document === 'undefined') return null

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-3" onMouseDown={(e) => e.target === e.currentTarget && cerrar()}>
      <div role="dialog" aria-modal="true" aria-label="Mensajes de WhatsApp" className="flex max-h-[min(720px,calc(100vh-1.5rem))] w-full max-w-[640px] flex-col overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-2xl shadow-black/50">
        <header className="flex items-start gap-3 border-b border-[var(--ls-linea)] px-4 py-3">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-[var(--ls-t1)]">Mensajes de WhatsApp</h2>
            <p className="mt-0.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">Lo que se escribe cuando pulsas el botón de WhatsApp de la ficha. Con varios mensajes por situación, el botón reparte los leads entre ellos y no se manda siempre el mismo texto.</p>
          </div>
          <button type="button" onClick={cerrar} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-[var(--ls-t4)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]" aria-label="Cerrar">
            <X className="h-4 w-4" aria-hidden />
          </button>
        </header>

        <div className="flex flex-wrap gap-1 border-b border-[var(--ls-linea)] px-4 py-2" role="tablist" aria-label="Situación">
          {SITUACIONES_DE_WHATSAPP.map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={situacion === s}
              onClick={() => setSituacion(s)}
              className={`${BOTON.chip} ${situacion === s ? BOTON.chipEncendido : ''}`}
            >
              {ETIQUETA_DE_SITUACION[s]}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <p className="text-[11.5px] text-[var(--ls-t3)]">{AYUDA_DE_SITUACION[situacion]}.</p>

          {filas.map((f) => {
            const texto = textoDe(f)
            const problema = texto.trim() === '' ? null : problemaDe(texto)
            const vista = rellenarMensaje(texto, ejemplo)
            const tocable = puedeTocar(f)
            const sinGuardar = f.tipo === 'guardado' ? borradores[f.clave] !== undefined && borradores[f.clave] !== f.original : texto.trim() !== ''
            const delEquipo = f.tipo === 'guardado' && f.user_id === null
            return (
              <article key={f.clave} className="space-y-1.5 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-2.5">
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ls-t4)]">
                  {f.tipo === 'serie' && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px font-medium text-[var(--ls-t3)]">Mensaje de serie · sin guardar</span>}
                  {f.tipo === 'nuevo' && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px font-medium text-[var(--ls-t3)]">Mensaje nuevo</span>}
                  {delEquipo && (
                    <span className="inline-flex items-center gap-1 rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px font-medium text-[var(--ls-t3)]">
                      <Users className="h-3 w-3" aria-hidden /> Del equipo{!esAdmin && ' · solo un administrador lo cambia'}
                    </span>
                  )}
                  {f.tipo === 'guardado' && !delEquipo && <span className="rounded-[4px] bg-[var(--ls-sup3)] px-1.5 py-px font-medium text-[var(--ls-t3)]">Tuyo</span>}
                  <span className="ml-auto tabular-nums">
                    {texto.trim().length} / {MAX_DE_MENSAJE}
                  </span>
                </div>

                <textarea
                  ref={(el) => {
                    campos.current[f.clave] = el
                  }}
                  value={texto}
                  onChange={(e) => setBorradores((b) => ({ ...b, [f.clave]: e.target.value }))}
                  disabled={!tocable || ocupado === f.clave}
                  rows={4}
                  maxLength={MAX_DE_MENSAJE + 200}
                  aria-label={`Texto del mensaje de «${ETIQUETA_DE_SITUACION[f.situacion]}»`}
                  placeholder="Escribe el mensaje. Los campos {{empresa}} y {{mi_nombre}} se rellenan solos."
                  className="w-full resize-y rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-2.5 py-2 text-[12.5px] leading-snug text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] disabled:opacity-70"
                />

                {tocable && (
                  <div className="flex flex-wrap items-center gap-1">
                    <span className="text-[11px] text-[var(--ls-t4)]">Campos:</span>
                    {CAMPOS_DE_WHATSAPP.map((c) => (
                      <button
                        key={c.etiqueta}
                        type="button"
                        onClick={() => insertarCampo(f, c.etiqueta)}
                        title={c.ayuda}
                        className="rounded-[5px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]"
                      >
                        {c.etiqueta}
                      </button>
                    ))}
                  </div>
                )}

                {texto.trim() !== '' && (
                  <p className="whitespace-pre-line rounded-[6px] bg-[var(--ls-sup)] px-2.5 py-1.5 text-[11.5px] leading-snug text-[var(--ls-t3)]">
                    <span className="font-semibold text-[var(--ls-t4)]">Así se verá: </span>
                    {vista.texto}
                  </p>
                )}
                {problema && (
                  <p className="text-[11.5px] leading-snug text-[var(--ls-e-ambar)]" role="alert">
                    {problema}
                  </p>
                )}

                {tocable && (
                  <div className="flex flex-wrap items-center gap-2 pt-0.5">
                    {f.id === null && esAdmin && (
                      <label className="flex cursor-pointer select-none items-center gap-1.5 text-[11.5px] text-[var(--ls-t3)]">
                        <input type="checkbox" checked={paraElEquipo[f.clave] === true} onChange={(e) => setParaElEquipo((p) => ({ ...p, [f.clave]: e.target.checked }))} className="h-3 w-3 accent-[var(--ls-acc-graf)]" />
                        Para todo el equipo
                      </label>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                      {f.tipo !== 'serie' &&
                        (confirmaBorrar === f.clave ? (
                          <button type="button" onClick={() => void borrar(f)} disabled={ocupado === f.clave} className={`${BOTON.base} ${BOTON.secundario} !text-[var(--ls-e-rojo)]`}>
                            {ocupado === f.clave ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null} ¿Borrar?
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => (f.id ? setConfirmaBorrar(f.clave) : void borrar(f))}
                            className={`${BOTON.base} ${BOTON.secundario}`}
                            aria-label="Borrar este mensaje"
                          >
                            <Trash2 className="h-3 w-3" aria-hidden /> Borrar
                          </button>
                        ))}
                      <button type="button" onClick={() => void guardar(f)} disabled={ocupado === f.clave || !sinGuardar || problema !== null} className={`${BOTON.base} ${BOTON.primario}`}>
                        {ocupado === f.clave && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />} Guardar
                      </button>
                    </div>
                  </div>
                )}
              </article>
            )
          })}

          <button type="button" onClick={anadir} className={`${BOTON.base} ${BOTON.secundario} !h-8`}>
            <Plus className="h-3.5 w-3.5" aria-hidden /> Añadir otro mensaje a «{ETIQUETA_DE_SITUACION[situacion]}»
          </button>
        </div>

        {confirmaCierre && (
          <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-e-ambar)_10%,transparent)] px-4 py-2 text-[12px] text-[var(--ls-t1)]" role="alert">
            <span className="flex-1">Hay cambios sin guardar. Si cierras, se pierden.</span>
            <button type="button" onClick={() => setConfirmaCierre(false)} className={`${BOTON.base} ${BOTON.secundario}`}>
              Seguir editando
            </button>
            <button type="button" onClick={onCerrar} className={`${BOTON.base} ${BOTON.secundario} !text-[var(--ls-e-rojo)]`}>
              Cerrar y descartar
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body
  )
}
