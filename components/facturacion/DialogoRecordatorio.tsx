'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, BellRing, FileText, Loader2, Plus, Send } from 'lucide-react'
import { BOTON, CAMPO, TEXTO, TIPO } from '@/lib/estilo/denso'
import { esPlantillaDeRecordatorio, PLANTILLA_RECORDATORIO, textoAntesDeVencer } from '@/lib/facturacion/logica'
import type { CorreoPreparado, FacturaPendiente } from '@/lib/facturacion/tipos'
import { Aviso, Dialogo, dinero, EditorCorreo, fechaCorta, pedir, type ManejoEditor } from './comun'

const CLASE_AREA = `${CAMPO.input} h-auto py-1`

/**
 * MANDAR UN RECORDATORIO DE PAGO DE UNA FACTURA QUE NO SE HA COBRADO.
 *
 * Como el envío de la factura: el correo tal como lo verá el cliente, se puede retocar, a quién va y con el PDF adjunto. Sale por Zoho,
 * de uno en uno y mirándolo, nunca en bloque. La plantilla vive en Zoho («Plantillas»); si aún no hay ninguna de recordatorio, se crea
 * aquí con un clic y después se retoca allí como cualquier otra.
 */
export function DialogoRecordatorio({ factura, onCerrar, onHecho }: { factura: FacturaPendiente; onCerrar: () => void; onHecho: () => void }) {
  /** Se puede recordar antes de que venza (a los 2 o 3 días de mandarla): entonces el texto no dice «venció» */
  const vencida = factura.diasVencida > 0
  const venceHoy = !vencida && factura.vence?.slice(0, 10) === new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Madrid' })
  /** Antes de vencer y con una plantilla retocada en Zoho que no se ha podido adaptar sola: hay que repasar el texto */
  const [repasarTexto, setRepasarTexto] = useState(false)
  const [correo, setCorreo] = useState<CorreoPreparado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [plantillaId, setPlantillaId] = useState<string | null>(null)
  const [asunto, setAsunto] = useState('')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [cc, setCc] = useState('')
  const [adjuntar, setAdjuntar] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [creando, setCreando] = useState(false)
  const editado = useRef(false)
  const editor = useRef<ManejoEditor>(null)

  const cargar = useCallback(
    async (plantilla: string | null) => {
      setCargando(true)
      try {
        const q = new URLSearchParams({ id: factura.id, recordatorio: '1' })
        if (plantilla) q.set('plantilla', plantilla)
        const { correo: c } = await pedir<{ correo: CorreoPreparado }>(`/api/facturacion/correo?${q}`)
        if (vencida) {
          setCorreo(c)
          setRepasarTexto(false)
        } else {
          const adaptado = textoAntesDeVencer(c.cuerpo, venceHoy)
          setCorreo({ ...c, cuerpo: adaptado.html })
          setRepasarTexto(!adaptado.cambiado && /venci[oó]|no nos consta/i.test(c.cuerpo))
        }
        setPlantillaId(c.plantillaId)
        setAsunto(c.asunto)
        setElegidos((actuales) => {
          if (actuales.length > 0) return actuales
          const marcados = c.destinatarios.filter((d) => d.marcado).map((d) => d.email)
          return marcados.length > 0 ? marcados : c.destinatarios.slice(0, 1).map((d) => d.email)
        })
        setCc((actual) => actual || c.cc.join(', '))
        editado.current = false
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'No se ha podido preparar el correo')
      } finally {
        setCargando(false)
      }
    },
    [factura.id, vencida, venceHoy]
  )

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  const para = useMemo(() => [...new Set([...elegidos, ...extra.split(/[,;\s]+/).filter(Boolean)])], [elegidos, extra])
  const recordatorios = correo?.plantillas.filter(esPlantillaDeRecordatorio) ?? []
  const falta = correo?.faltaPlantillaRecordatorio === true

  async function crearPlantilla() {
    if (!correo) return
    const base = correo.plantillas.find((p) => !esPlantillaDeRecordatorio(p))
    if (!base) return
    setCreando(true)
    try {
      await pedir('/api/facturacion/plantillas', {
        metodo: 'POST',
        cuerpo: { desdeId: base.id, nombre: PLANTILLA_RECORDATORIO.nombre, asunto: PLANTILLA_RECORDATORIO.asunto, cuerpo: PLANTILLA_RECORDATORIO.cuerpo },
      })
      toast.success('Plantilla «Recordatorio de pago» creada en Zoho. Se puede retocar en Plantillas.')
      await cargar(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido crear la plantilla')
    } finally {
      setCreando(false)
    }
  }

  function cambiarPlantilla(id: string) {
    if (editado.current && !window.confirm('Has cambiado el texto del correo y se perderá al cambiar de plantilla. ¿Seguir?')) return
    void cargar(id)
  }

  async function enviar() {
    if (!correo) return
    const reciente = factura.ultimoRecordatorio && !factura.tocaRecordar
    if (reciente && !window.confirm(`Ya se le mandó un recordatorio el ${fechaCorta(factura.ultimoRecordatorio)}. ¿Mandar otro?`)) return
    setEnviando(true)
    try {
      const r = await pedir<{ para: string[] }>('/api/facturacion/enviar', {
        metodo: 'POST',
        cuerpo: {
          id: factura.id,
          para,
          cc: cc.split(/[,;\s]+/).filter(Boolean),
          asunto,
          cuerpo: editor.current?.html() ?? correo.cuerpo,
          enlaces: {},
          adjuntarPdf: adjuntar,
          plantillaId,
          plantillaNombre: correo.plantillas.find((p) => p.id === plantillaId)?.nombre ?? null,
          recordatorio: true,
          diasLaborables: factura.diasLaborables,
        },
      })
      toast.success(`Recordatorio enviado a ${r.para.join(', ')}`)
      onHecho()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialogo titulo={`Recordatorio de pago · ${factura.cliente}`} tono="ambar" icono={BellRing} caja="h-[90vh] max-w-[1100px]" onCerrar={onCerrar}>
      {error ? (
        <div className="p-3">
          <Aviso tono="rojo" icono={AlertTriangle}>
            {error}
          </Aviso>
        </div>
      ) : !correo ? (
        <div className={`flex flex-1 items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Preparando el correo con Zoho…
        </div>
      ) : falta ? (
        <div className="flex flex-col gap-2.5 p-3">
          <Aviso tono="ambar" icono={BellRing}>
            En Zoho aún no hay ninguna plantilla de recordatorio de pago. Se crea una con el mismo diseño que las de factura: dice que la factura{' '}
            venció, cuánto queda por pagar y lleva el PDF. Después se puede retocar en <span className="font-semibold">Plantillas</span>.
          </Aviso>
          <button type="button" disabled={creando} onClick={() => void crearPlantilla()} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario} self-start`}>
            {creando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} Crear la plantilla «{PLANTILLA_RECORDATORIO.nombre}»
          </button>
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[320px_1fr]">
          <div className="flex min-w-0 flex-col gap-2.5 overflow-auto border-r border-[var(--ls-linea)] p-3">
            <div className={`rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2 ${TIPO.s} ${TEXTO.t2}`}>
              <div className={`font-semibold ${TEXTO.t1}`}>{factura.numero}</div>
              <div>
                {dinero(factura.saldo, factura.moneda)} sin pagar · {vencida ? 'venció' : venceHoy ? 'vence hoy,' : 'vence'} el {fechaCorta(factura.vence)}
              </div>
              <div>
                {vencida ? `${factura.diasLaborables} ${factura.diasLaborables === 1 ? 'día laborable' : 'días laborables'} de retraso` : 'Aún en plazo'}
                {factura.ultimoRecordatorio ? ` · último recordatorio el ${fechaCorta(factura.ultimoRecordatorio)}` : ' · ningún recordatorio todavía'}
              </div>
            </div>

            {repasarTexto && (
              <Aviso tono="ambar" icono={AlertTriangle}>
                Esta factura aún no ha vencido y el texto de la plantilla habla de un pago que no ha llegado. Repásalo a la derecha antes de mandarlo.
              </Aviso>
            )}

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Plantilla</label>
              <select value={plantillaId ?? ''} disabled={cargando} onChange={(e) => cambiarPlantilla(e.target.value)} className={CAMPO.input}>
                {(recordatorios.length > 0 ? recordatorios : correo.plantillas).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </select>
            </div>

            <div className={CAMPO.contenedor}>
              <div className={CAMPO.etiqueta}>Para</div>
              {correo.destinatarios.length === 0 && <p className={`${TIPO.s} ${TEXTO.t3}`}>Este cliente no tiene contactos con correo en Zoho.</p>}
              <div className="flex flex-col gap-1">
                {correo.destinatarios.map((d) => (
                  <label key={d.email} className={`flex items-center gap-1.5 ${TIPO.s} ${TEXTO.t2}`}>
                    <input type="checkbox" checked={elegidos.includes(d.email)} onChange={(e) => setElegidos((a) => (e.target.checked ? [...a, d.email] : a.filter((x) => x !== d.email)))} />
                    <span className="truncate" title={d.email}>
                      {d.nombre ? `${d.nombre} · ` : ''}
                      {d.email}
                    </span>
                  </label>
                ))}
              </div>
              <input value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Otra dirección" className={`${CAMPO.input} mt-1.5`} />
            </div>

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>En copia</label>
              <input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="Separadas por comas" className={CAMPO.input} />
            </div>

            <div className={CAMPO.contenedor}>
              <label className={CAMPO.etiqueta}>Asunto</label>
              <textarea value={asunto} rows={2} onChange={(e) => setAsunto(e.target.value)} className={CLASE_AREA} />
            </div>

            <div className="flex items-center justify-between gap-2">
              <label className={`flex items-center gap-1.5 ${TIPO.s} ${TEXTO.t2}`}>
                <input type="checkbox" checked={adjuntar} onChange={(e) => setAdjuntar(e.target.checked)} /> Adjuntar la factura en PDF
              </label>
              <a href={`/api/facturacion/pdf?id=${encodeURIComponent(factura.id)}`} target="_blank" rel="noreferrer" className={`${BOTON.base} ${BOTON.secundario}`}>
                <FileText className="h-3 w-3" /> Ver PDF
              </a>
            </div>

            <div className="mt-auto pt-1">
              <button
                type="button"
                disabled={enviando || cargando || para.length === 0 || !asunto.trim()}
                onClick={() => void enviar()}
                className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario} w-full justify-center`}
              >
                {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Mandar el recordatorio a {para.length} {para.length === 1 ? 'dirección' : 'direcciones'}
              </button>
              <p className={`${CAMPO.nota} text-center`}>Sale desde Zoho. La factura no cambia.</p>
            </div>
          </div>

          <div className="flex min-h-[420px] min-w-0 flex-col">
            <div className={`flex h-7 shrink-0 items-center border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 ${TIPO.s} ${TEXTO.t3}`}>
              Así lo verá el cliente. Pincha en el texto para cambiarlo: solo cambia este envío, no la plantilla.
            </div>
            <div className="min-h-0 flex-1">
              <EditorCorreo
                ref={editor}
                html={correo.cuerpo}
                onEditado={() => {
                  editado.current = true
                }}
              />
            </div>
          </div>
        </div>
      )}
    </Dialogo>
  )
}
