'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, Plus, Send, Trash2, X } from 'lucide-react'
import { BOTON, CAMPO, CIFRAS, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { huecosDeEnlace, lineasDelMes, proponerEnlaces, rotuloDeHueco, sumarDias } from '@/lib/facturacion/logica'
import type { ContactoZoho, CorreoPreparado, DetalleFactura, FilaFacturacion, LineaFactura } from '@/lib/facturacion/tipos'
import { Aviso, dinero, EditorCorreo, hoyISO, pedir, SobreLaPagina, type ManejoEditor } from './comun'

/**
 * UNA FACTURA, DE PRINCIPIO A FIN: CREARLA Y ENVIARLA.
 *
 * Dos pasos porque son dos decisiones distintas: lo que dice la factura y lo que
 * se le escribe al cliente. Crear no manda nada; solo «Enviar» sale de la agencia.
 * Por eso aquí no hay envío en bloque: cada correo se manda mirándolo.
 */

const CLASE_AREA = `${CAMPO.input} h-auto py-1`

export function PanelFactura({
  fila,
  period,
  contactos,
  zohoOrgId,
  onCerrar,
  onCambio,
  onCobrar,
}: {
  fila: FilaFacturacion
  period: string
  contactos: ContactoZoho[]
  zohoOrgId: string | null
  onCerrar: () => void
  onCambio: () => void
  onCobrar: (facturaId: string) => void
}) {
  const [facturaId, setFacturaId] = useState<string | null>(fila.factura?.id ?? null)
  const [paso, setPaso] = useState<'factura' | 'correo'>(fila.factura ? 'correo' : 'factura')
  const urlZoho = facturaId && zohoOrgId ? `https://books.zoho.com/app/${zohoOrgId}#/invoices/${facturaId}` : null

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  const estaEnviada = Boolean(fila.factura && fila.factura.estadoZoho !== 'draft')
  const pestanas: { id: 'factura' | 'correo'; nombre: string; activa: boolean }[] = [
    { id: 'factura', nombre: '1. Factura', activa: true },
    { id: 'correo', nombre: '2. Correo', activa: Boolean(facturaId) },
  ]

  return (
    <SobreLaPagina>
    <div className="fixed inset-0 z-[100] flex justify-end bg-black/60" onClick={onCerrar}>
      <div
        role="dialog"
        aria-label={`Factura de ${fila.nombre}`}
        onClick={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-[1120px] flex-col border-l border-[var(--ls-linea2)] bg-[var(--ls-fondo)]"
      >
        <div className="flex h-11 shrink-0 items-center gap-3 border-b border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3">
          <span className={`${TITULO.seccion} truncate`}>{fila.nombre}</span>
          <div className="flex items-center gap-1">
            {pestanas.map((p) => (
              <button
                key={p.id}
                type="button"
                disabled={!p.activa}
                onClick={() => setPaso(p.id)}
                className={`${BOTON.chip} ${paso === p.id ? BOTON.chipEncendido : ''} disabled:opacity-45`}
              >
                {p.nombre}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            {urlZoho && (
              <a href={urlZoho} target="_blank" rel="noreferrer" className={`${BOTON.base} ${BOTON.secundario}`}>
                <ExternalLink className="h-3 w-3" /> Abrir en Zoho
              </a>
            )}
            {estaEnviada && fila.factura && fila.factura.saldo > 0 && (
              <button type="button" onClick={() => onCobrar(fila.factura!.id)} className={`${BOTON.base} ${BOTON.secundario}`}>
                Registrar cobro
              </button>
            )}
            <button type="button" onClick={onCerrar} aria-label="Cerrar" className={BOTON.icono}>
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
          {paso === 'factura' ? (
            <PasoFactura
              fila={fila}
              period={period}
              contactos={contactos}
              facturaId={facturaId}
              onCreada={(id) => {
                setFacturaId(id)
                setPaso('correo')
                onCambio()
              }}
              onBorrada={() => {
                onCambio()
                onCerrar()
              }}
              onGuardada={() => {
                setPaso('correo')
                onCambio()
              }}
            />
          ) : (
            facturaId && (
              <PasoCorreo
                fila={fila}
                period={period}
                facturaId={facturaId}
                onEnviada={() => {
                  onCambio()
                  onCerrar()
                }}
              />
            )
          )}
        </div>
      </div>
    </div>
    </SobreLaPagina>
  )
}

/* ------------------------------------------------------------------ */
/* Paso 1: lo que dice la factura                                      */
/* ------------------------------------------------------------------ */

function PasoFactura({
  fila,
  period,
  contactos,
  facturaId,
  onCreada,
  onGuardada,
  onBorrada,
}: {
  fila: FilaFacturacion
  period: string
  contactos: ContactoZoho[]
  facturaId: string | null
  onCreada: (id: string) => void
  onGuardada: () => void
  onBorrada: () => void
}) {
  const hoy = hoyISO()
  const [cargando, setCargando] = useState(Boolean(facturaId))
  const [detalle, setDetalle] = useState<DetalleFactura | null>(null)
  const [numero, setNumero] = useState(fila.numeroPropuesto)
  const [fecha, setFecha] = useState(hoy)
  const [vence, setVence] = useState(sumarDias(hoy, 7))
  const [lineas, setLineas] = useState<LineaFactura[]>(() => {
    const iniciales = lineasDelMes(fila.fee, fila.comision)
    return iniciales.length > 0 ? iniciales : [{ descripcion: 'Fee Mensual de Gestión', importe: 0 }]
  })
  const [contactoId, setContactoId] = useState(fila.contactoId ?? '')
  const [guardando, setGuardando] = useState(false)
  const [repetida, setRepetida] = useState<string | null>(null)

  useEffect(() => {
    if (!facturaId) return
    let vigente = true
    setCargando(true)
    pedir<{ factura: DetalleFactura }>(`/api/facturacion/factura?id=${encodeURIComponent(facturaId)}`)
      .then(({ factura }) => {
        if (!vigente) return
        setDetalle(factura)
        setNumero(factura.numero)
        setFecha(factura.fecha)
        setVence(factura.vence ?? factura.fecha)
        setLineas(factura.lineas)
      })
      .catch((e: Error) => toast.error(e.message))
      .finally(() => {
        if (vigente) setCargando(false)
      })
    return () => {
      vigente = false
    }
  }, [facturaId])

  const total = useMemo(() => lineas.reduce((s, l) => s + (Number(l.importe) || 0), 0), [lineas])
  const soloLectura = Boolean(detalle && detalle.estadoZoho !== 'draft')
  const difiereDeTesoreria = fila.totalTesoreria > 0 && Math.abs(total - fila.totalTesoreria) >= 0.005

  const cambiarLinea = (i: number, cambio: Partial<LineaFactura>) =>
    setLineas((actuales) => actuales.map((l, j) => (j === i ? { ...l, ...cambio } : l)))

  async function guardar(otraDelMes = false) {
    setGuardando(true)
    setRepetida(null)
    try {
      const cuerpo = { numero, fecha, vence, lineas, period, treasuryClientId: fila.treasuryClientId }
      if (facturaId) {
        await pedir('/api/facturacion/factura', { metodo: 'PUT', cuerpo: { ...cuerpo, id: facturaId } })
        toast.success('Borrador guardado en Zoho')
        onGuardada()
      } else {
        const r = await fetch('/api/facturacion/factura', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...cuerpo, contactoId, otraDelMes }),
        })
        const d = (await r.json().catch(() => null)) as { id?: string; error?: string; repetida?: boolean } | null
        if (r.status === 409 && d?.repetida) {
          setRepetida(d.error ?? 'Ese cliente ya tiene factura este mes.')
          return
        }
        if (!r.ok || !d?.id) throw new Error(d?.error ?? 'No se ha podido crear la factura')
        toast.success('Borrador creado en Zoho. Aún no se ha enviado nada.')
        onCreada(d.id)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar')
    } finally {
      setGuardando(false)
    }
  }

  async function borrar() {
    if (!facturaId || !window.confirm(`¿Borrar el borrador «${numero}» de Zoho?`)) return
    setGuardando(true)
    try {
      await pedir(`/api/facturacion/factura?id=${encodeURIComponent(facturaId)}`, { metodo: 'DELETE' })
      toast.success('Borrador borrado')
      onBorrada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
      setGuardando(false)
    }
  }

  if (cargando) {
    return (
      <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo la factura de Zoho…
      </div>
    )
  }

  return (
    <div className="mx-auto flex max-w-[720px] flex-col gap-3 p-4">
      {soloLectura && (
        <Aviso tono="azul" icono={CheckCircle2}>
          Esta factura ya se ha enviado, así que aquí solo se puede mirar. Si hay que corregirla, se hace en Zoho.
        </Aviso>
      )}

      {!facturaId && (
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Cliente en Zoho</label>
          <select value={contactoId} onChange={(e) => setContactoId(e.target.value)} className={CAMPO.input}>
            <option value="">Elige el cliente…</option>
            {contactos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Número de factura</label>
          <input value={numero} disabled={soloLectura} onChange={(e) => setNumero(e.target.value)} className={CAMPO.input} />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Fecha</label>
          <input
            type="date"
            value={fecha}
            disabled={soloLectura}
            onChange={(e) => {
              setFecha(e.target.value)
              if (e.target.value) setVence(sumarDias(e.target.value, 7))
            }}
            className={CAMPO.input}
          />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Vencimiento</label>
          <input type="date" value={vence} disabled={soloLectura} onChange={(e) => setVence(e.target.value)} className={CAMPO.input} />
        </div>
      </div>

      <div>
        <div className={`mb-1 ${TITULO.rotulo}`}>Conceptos</div>
        <div className="flex flex-col gap-1">
          {lineas.map((l, i) => (
            <div key={i} className="flex items-center gap-1">
              <input
                value={l.descripcion}
                aria-label="Concepto"
                disabled={soloLectura}
                onChange={(e) => cambiarLinea(i, { descripcion: e.target.value })}
                className={`${CAMPO.input} flex-1`}
              />
              <input
                type="number"
                step="0.01"
                min="0"
                aria-label="Importe"
                value={l.importe}
                disabled={soloLectura}
                onChange={(e) => cambiarLinea(i, { importe: Number(e.target.value) })}
                className={`${CAMPO.input} ${CAMPO.numero} !w-[110px]`}
              />
              {!soloLectura && (
                <button
                  type="button"
                  aria-label="Quitar concepto"
                  disabled={lineas.length === 1}
                  onClick={() => setLineas((a) => a.filter((_, j) => j !== i))}
                  className={`${BOTON.icono} disabled:opacity-30`}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
        </div>
        {!soloLectura && (
          <button
            type="button"
            onClick={() => setLineas((a) => [...a, { descripcion: '', importe: 0 }])}
            className={`${BOTON.base} ${BOTON.secundario} mt-1.5`}
          >
            <Plus className="h-3 w-3" /> Añadir concepto
          </button>
        )}
      </div>

      <div className={CIFRAS.tira}>
        <span className={CIFRAS.celda}>
          <span className={CIFRAS.valor}>{dinero(total, detalle?.moneda)}</span>
          <span className={CIFRAS.rotulo}>total sin impuestos</span>
        </span>
        {fila.totalTesoreria > 0 && (
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{dinero(fila.totalTesoreria)}</span>
            <span className={CIFRAS.rotulo}>en Tesorería</span>
          </span>
        )}
      </div>

      {difiereDeTesoreria && !soloLectura && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          La factura no coincide con Tesorería. Se puede guardar igual, si es lo que quieres, pero el descuadre seguirá avisando en el tablero.
        </Aviso>
      )}

      {fila.comision != null && fila.comision > 0 && fila.informes.length === 0 && !soloLectura && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Este mes lleva comisión y aún no hay informe para el cliente. Créalo en Comisiones antes de enviar, para poder poner el enlace.
        </Aviso>
      )}

      {repetida && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          <span className="font-semibold">{repetida}</span> Dos facturas del mismo mes solo tienen sentido si es un cargo aparte.
          <div className="mt-1.5">
            <button type="button" onClick={() => void guardar(true)} className={`${BOTON.base} ${BOTON.secundario}`}>
              Sí, es un cargo aparte: crear otra
            </button>
          </div>
        </Aviso>
      )}

      {!soloLectura && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={guardando || (!facturaId && !contactoId)}
            onClick={() => void guardar()}
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
          >
            {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
            {facturaId ? 'Guardar y seguir al correo' : 'Crear borrador en Zoho'}
          </button>
          <span className={`${TIPO.s} ${TEXTO.t4}`}>No se envía nada todavía.</span>
          {facturaId && (
            <button type="button" disabled={guardando} onClick={() => void borrar()} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}>
              <Trash2 className="h-3 w-3" /> Borrar borrador
            </button>
          )}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Paso 2: lo que se le escribe al cliente                             */
/* ------------------------------------------------------------------ */

function PasoCorreo({
  fila,
  period,
  facturaId,
  onEnviada,
}: {
  fila: FilaFacturacion
  period: string
  facturaId: string
  onEnviada: () => void
}) {
  const [correo, setCorreo] = useState<CorreoPreparado | null>(null)
  const [cargando, setCargando] = useState(true)
  const [plantillaId, setPlantillaId] = useState<string | null>(null)
  const [asunto, setAsunto] = useState('')
  const [elegidos, setElegidos] = useState<string[]>([])
  const [extra, setExtra] = useState('')
  const [cc, setCc] = useState('')
  const [enlaces, setEnlaces] = useState<Record<string, string>>({})
  const [adjuntar, setAdjuntar] = useState(true)
  const [plantillaPdf, setPlantillaPdf] = useState('')
  const [enviando, setEnviando] = useState(false)
  const editado = useRef(false)
  const editor = useRef<ManejoEditor>(null)

  const cargar = useCallback(
    async (plantilla: string | null) => {
      setCargando(true)
      try {
        const q = new URLSearchParams({ id: facturaId })
        if (plantilla) q.set('plantilla', plantilla)
        else {
          q.set('cliente', fila.nombre)
          q.set('comision', (fila.comision ?? 0) > 0 ? '1' : '0')
          if (fila.treasuryClientId) q.set('treasuryClientId', fila.treasuryClientId)
        }
        const { correo: c } = await pedir<{ correo: CorreoPreparado }>(`/api/facturacion/correo?${q}`)
        setCorreo(c)
        setPlantillaId(c.plantillaId)
        setAsunto(c.asunto)
        setPlantillaPdf(c.plantillaPdfId ?? '')
        setElegidos((actuales) => {
          if (actuales.length > 0) return actuales
          const marcados = c.destinatarios.filter((d) => d.marcado).map((d) => d.email)
          return marcados.length > 0 ? marcados : c.destinatarios.slice(0, 1).map((d) => d.email)
        })
        // Sin correo en Zoho se propone el de Tesorería, a la vista para que se pueda corregir
        if (c.destinatarios.length === 0) setExtra((actual) => actual || fila.correosTesoreria.join(', '))
        setCc((actual) => actual || c.cc.join(', '))
        // Lo que ya se haya escrito a mano en un hueco se conserva al cambiar de plantilla
        const huecos = huecosDeEnlace(`${c.asunto} ${c.cuerpo}`)
        const propuesta = proponerEnlaces(huecos, fila.informes)
        setEnlaces((previos) => Object.fromEntries(huecos.map((h) => [h, previos[h] || propuesta[h] || ''])))
        editado.current = false
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'No se ha podido preparar el correo')
      } finally {
        setCargando(false)
      }
    },
    [facturaId, fila.comision, fila.correosTesoreria, fila.informes, fila.nombre, fila.treasuryClientId]
  )

  useEffect(() => {
    void cargar(null)
  }, [cargar])

  function cambiarPlantilla(id: string) {
    if (editado.current && !window.confirm('Has cambiado el texto del correo y se perderá al cambiar de plantilla. ¿Seguir?')) return
    void cargar(id)
  }

  async function cambiarPdf(id: string) {
    const anterior = plantillaPdf
    setPlantillaPdf(id)
    try {
      await pedir('/api/facturacion/factura', { metodo: 'PATCH', cuerpo: { id: facturaId, plantillaPdfId: id } })
      toast.success('Plantilla del PDF cambiada')
    } catch (e) {
      setPlantillaPdf(anterior)
      toast.error(e instanceof Error ? e.message : 'No se ha podido cambiar la plantilla')
    }
  }

  const para = useMemo(() => {
    const manuales = extra.split(/[,;\s]+/).filter(Boolean)
    return [...new Set([...elegidos, ...manuales])]
  }, [elegidos, extra])

  const huecos = Object.keys(enlaces)
  const faltan = huecos.filter((h) => !enlaces[h]?.trim())
  const reenvio = correo ? correo.estadoFactura !== 'draft' : false
  const sinEnlacePeroConComision = correo && huecos.length === 0 && (fila.comision ?? 0) > 0

  async function enviar() {
    if (!correo) return
    if (reenvio && !window.confirm('Esta factura ya se envió. ¿Mandarla otra vez?')) return
    setEnviando(true)
    try {
      const r = await pedir<{ para: string[] }>('/api/facturacion/enviar', {
        metodo: 'POST',
        cuerpo: {
          id: facturaId,
          para,
          cc: cc.split(/[,;\s]+/).filter(Boolean),
          asunto,
          cuerpo: editor.current?.html() ?? correo.cuerpo,
          enlaces,
          adjuntarPdf: adjuntar,
          plantillaId,
          plantillaNombre: correo.plantillas.find((p) => p.id === plantillaId)?.nombre ?? null,
          treasuryClientId: fila.treasuryClientId,
          period,
        },
      })
      toast.success(`Factura enviada a ${r.para.join(', ')}`)
      onEnviada()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enviar')
    } finally {
      setEnviando(false)
    }
  }

  if (!correo) {
    return (
      <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
        {cargando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        {cargando ? 'Preparando el correo con Zoho…' : 'No se ha podido preparar el correo.'}
      </div>
    )
  }

  return (
    <div className="grid h-full min-h-[560px] grid-cols-1 lg:grid-cols-[320px_1fr]">
      <div className="flex min-w-0 flex-col gap-2.5 overflow-auto border-r border-[var(--ls-linea)] p-3">
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Plantilla del correo</label>
          <select value={plantillaId ?? ''} disabled={cargando} onChange={(e) => cambiarPlantilla(e.target.value)} className={CAMPO.input}>
            {correo.plantillas.map((p) => (
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
                <input
                  type="checkbox"
                  checked={elegidos.includes(d.email)}
                  onChange={(e) => setElegidos((a) => (e.target.checked ? [...a, d.email] : a.filter((x) => x !== d.email)))}
                />
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

        {huecos.map((h) => (
          <div key={h} className={CAMPO.contenedor}>
            <label className={CAMPO.etiqueta}>
              {rotuloDeHueco(h)} <span className={CAMPO.obligatorio}>*</span>
            </label>
            {fila.informes.length > 1 && (
              <select
                value={fila.informes.some((i) => i.url === enlaces[h]) ? enlaces[h] : ''}
                onChange={(e) => setEnlaces((a) => ({ ...a, [h]: e.target.value }))}
                className={`${CAMPO.input} mb-1`}
              >
                <option value="">Elige un informe…</option>
                {fila.informes.map((i) => (
                  <option key={i.url} value={i.url}>
                    {i.nombre}
                  </option>
                ))}
              </select>
            )}
            <input
              value={enlaces[h] ?? ''}
              onChange={(e) => setEnlaces((a) => ({ ...a, [h]: e.target.value }))}
              placeholder="https://…"
              className={CAMPO.input}
            />
            {enlaces[h]?.trim() ? (
              <a href={enlaces[h]} target="_blank" rel="noreferrer" className={`${CAMPO.nota} inline-flex items-center gap-1 underline`}>
                <ExternalLink className="h-3 w-3" /> Comprobar el enlace
              </a>
            ) : (
              <p className={CAMPO.nota}>Sin esto no se puede enviar. Si no lleva informe, elige la plantilla «Sin Comisiones».</p>
            )}
          </div>
        ))}

        {sinEnlacePeroConComision && (
          <Aviso tono="ambar" icono={AlertTriangle}>
            Esta factura lleva comisión y la plantilla elegida no tiene enlace al informe.
          </Aviso>
        )}

        <div className={CAMPO.contenedor}>
          <div className="flex items-center justify-between gap-2">
            <label className={`flex items-center gap-1.5 ${TIPO.s} ${TEXTO.t2}`}>
              <input type="checkbox" checked={adjuntar} onChange={(e) => setAdjuntar(e.target.checked)} /> Adjuntar PDF
            </label>
            <a href={`/api/facturacion/pdf?id=${encodeURIComponent(facturaId)}`} target="_blank" rel="noreferrer" className={`${BOTON.base} ${BOTON.secundario}`}>
              <FileText className="h-3 w-3" /> Ver PDF
            </a>
          </div>
          {/* El diseño de la factura casi nunca se toca, y a la vista se confundía con la plantilla del correo */}
          <details className="mt-1.5">
            <summary className={`cursor-pointer ${TIPO.s} ${TEXTO.t3}`}>Cambiar el diseño del PDF</summary>
            <select aria-label="Diseño del PDF" value={plantillaPdf} onChange={(e) => void cambiarPdf(e.target.value)} className={`${CAMPO.input} mt-1`}>
              {correo.plantillasPdf.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nombre}
                </option>
              ))}
            </select>
          </details>
        </div>

        <div className="mt-auto pt-1">
          <button
            type="button"
            disabled={enviando || cargando || para.length === 0 || faltan.length > 0 || !asunto.trim()}
            onClick={() => void enviar()}
            className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario} w-full justify-center`}
          >
            {enviando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
            {reenvio ? 'Volver a enviar' : 'Enviar'} a {para.length} {para.length === 1 ? 'dirección' : 'direcciones'}
          </button>
          {faltan.length > 0 && <p className={`${CAMPO.nota} text-center`}>Falta: {faltan.map(rotuloDeHueco).join(', ')}.</p>}
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
  )
}
