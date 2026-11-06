'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, ExternalLink, Loader2, Plus, X } from 'lucide-react'
import { BOTON, CAMPO, CIFRAS, TABLA, TARJETA, TEXTO, TEXTO_ESTADO, TIPO, TITULO } from '@/lib/estilo/denso'
import { candidatasDeCobro } from '@/lib/facturacion/logica'
import type { CuentaBancaria, DatosDeCobros, FacturaPendiente, MovimientoSinCategorizar } from '@/lib/facturacion/tipos'
import { Aviso, dinero, fechaCorta, hoyISO, pedir } from './comun'

/**
 * LO QUE ESTÁ POR COBRAR Y LO QUE HA PASADO EN EL BANCO.
 *
 * Todos los meses, no solo uno: una factura vencida de octubre no desaparece por
 * mirar noviembre. Cada registro va a Zoho, con su referencia y su tipo de cambio.
 */

/** «EUR to AED» no es ni un cobro ni un gasto: es mover dinero entre dos cuentas */
const esCambioDeDivisa = (m: MovimientoSinCategorizar) => /\b[A-Z]{3} to [A-Z]{3}\b/.test(m.concepto)

type Dialogo =
  | { tipo: 'cobro'; factura: FacturaPendiente | null; movimiento: MovimientoSinCategorizar | null }
  | { tipo: 'gasto'; movimiento: MovimientoSinCategorizar | null }
  | null

export function PestanaCobros({
  zohoOrgId,
  facturaInicial,
  onCambio,
}: {
  zohoOrgId: string | null
  facturaInicial: string | null
  onCambio: () => void
}) {
  const [datos, setDatos] = useState<DatosDeCobros | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dialogo, setDialogo] = useState<Dialogo>(null)

  const traer = useCallback(async () => {
    setCargando(true)
    try {
      const d = await pedir<DatosDeCobros>('/api/facturacion/cobros')
      setDatos(d)
      setError(null)
      return d
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer Zoho')
      return null
    } finally {
      setCargando(false)
    }
  }, [])

  useEffect(() => {
    void traer().then((d) => {
      const f = d?.pendientes.find((p) => p.id === facturaInicial)
      if (f) setDialogo({ tipo: 'cobro', factura: f, movimiento: null })
    })
  }, [traer, facturaInicial])

  const porMoneda = useMemo(() => {
    const totales = new Map<string, number>()
    for (const f of datos?.pendientes ?? []) totales.set(f.moneda, (totales.get(f.moneda) ?? 0) + f.saldo)
    return [...totales.entries()]
  }, [datos])

  const vencidas = (datos?.pendientes ?? []).filter((f) => f.diasVencida > 0).length

  const alTerminar = () => {
    setDialogo(null)
    void traer()
    onCambio()
  }

  if (error) {
    return (
      <Aviso tono="rojo" icono={AlertTriangle}>
        {error}
      </Aviso>
    )
  }
  if (!datos) {
    return (
      <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo Zoho…
      </div>
    )
  }

  const urlBanco = zohoOrgId ? `https://books.zoho.com/app/${zohoOrgId}#/banking` : null

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className={CIFRAS.tira}>
          {porMoneda.map(([moneda, total]) => (
            <span key={moneda} className={CIFRAS.celda}>
              <span className={CIFRAS.valor}>{dinero(total, moneda)}</span>
              <span className={CIFRAS.rotulo}>por cobrar</span>
            </span>
          ))}
          <span className={CIFRAS.celda}>
            <span className={`${CIFRAS.valor} ${vencidas > 0 ? CIFRAS.urgente : ''}`}>{vencidas}</span>
            <span className={CIFRAS.rotulo}>vencidas</span>
          </span>
          <span className={CIFRAS.celda}>
            <span className={CIFRAS.valor}>{datos.movimientos.length}</span>
            <span className={CIFRAS.rotulo}>movimientos sin categorizar</span>
          </span>
        </div>
        {cargando && <Loader2 className={`h-3 w-3 animate-spin ${TEXTO.t4}`} />}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setDialogo({ tipo: 'gasto', movimiento: null })} className={`${BOTON.base} ${BOTON.secundario}`}>
            <Plus className="h-3 w-3" /> Registrar gasto
          </button>
        </div>
      </div>

      <section className={TARJETA.base}>
        <div className={TARJETA.cabecera}>
          <span className={TITULO.seccion}>Facturas por cobrar</span>
        </div>
        {datos.pendientes.length === 0 ? (
          <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>No hay ninguna factura por cobrar.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>Factura</th>
                  <th className={TABLA.cabecera}>Cliente</th>
                  <th className={TABLA.cabecera}>Venció</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Por cobrar</th>
                  <th className={TABLA.cabecera} />
                </tr>
              </thead>
              <tbody>
                {datos.pendientes.map((f) => (
                  <tr key={f.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>{f.numero}</td>
                    <td className={TABLA.celda}>{f.cliente}</td>
                    <td className={TABLA.celda}>
                      {fechaCorta(f.vence)}
                      {f.diasVencida > 0 && <span className={`ml-1.5 ${TEXTO_ESTADO.rojo}`}>hace {f.diasVencida} d</span>}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(f.saldo, f.moneda)}</td>
                    <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                      <button type="button" onClick={() => setDialogo({ tipo: 'cobro', factura: f, movimiento: null })} className={`${BOTON.base} ${BOTON.secundario}`}>
                        Registrar cobro
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={TARJETA.base}>
        <div className={TARJETA.cabecera}>
          <span className={TITULO.seccion}>Movimientos del banco sin categorizar</span>
        </div>
        {datos.movimientos.length === 0 ? (
          <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>Todo categorizado.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>Fecha</th>
                  <th className={TABLA.cabecera}>Concepto</th>
                  <th className={TABLA.cabecera}>Referencia</th>
                  <th className={TABLA.cabecera}>Cuenta</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Importe</th>
                  <th className={TABLA.cabecera} />
                </tr>
              </thead>
              <tbody>
                {datos.movimientos.map((m) => (
                  <tr key={m.id} className={TABLA.fila}>
                    <td className={TABLA.celda}>{fechaCorta(m.fecha)}</td>
                    <td className={TABLA.celda}>{m.concepto || '—'}</td>
                    <td className={TABLA.celda}>{m.referencia || '—'}</td>
                    <td className={TABLA.celda}>
                      <span className={`${TABLA.corta} max-w-[190px]`} title={m.cuentaNombre}>
                        {m.cuentaNombre} · {m.moneda}
                      </span>
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.numero} ${m.entrada ? TEXTO_ESTADO.verde : ''}`}>
                      {m.entrada ? '+' : '−'}
                      {dinero(m.importe, m.moneda)}
                    </td>
                    <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                      {esCambioDeDivisa(m) ? (
                        urlBanco && (
                          <a href={urlBanco} target="_blank" rel="noreferrer" className={`${BOTON.base} ${BOTON.secundario}`} title="Mover dinero entre cuentas se categoriza en Zoho">
                            <ExternalLink className="h-3 w-3" /> Cambio de divisa: en Zoho
                          </a>
                        )
                      ) : m.entrada ? (
                        <button type="button" onClick={() => setDialogo({ tipo: 'cobro', factura: null, movimiento: m })} className={`${BOTON.base} ${BOTON.secundario}`}>
                          Es un cobro
                        </button>
                      ) : (
                        <button type="button" onClick={() => setDialogo({ tipo: 'gasto', movimiento: m })} className={`${BOTON.base} ${BOTON.secundario}`}>
                          Es un gasto
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className={TARJETA.base}>
        <div className={TARJETA.cabecera}>
          <span className={TITULO.seccion}>Últimos cobros en Zoho</span>
        </div>
        <div className="overflow-x-auto">
          <table className={TABLA.tabla}>
            <tbody>
              {datos.cobros.map((c) => (
                <tr key={c.id} className={TABLA.fila}>
                  <td className={TABLA.celda}>{fechaCorta(c.fecha)}</td>
                  <td className={TABLA.celda}>{c.cliente}</td>
                  <td className={TABLA.celda}>{c.referencia || '—'}</td>
                  <td className={`${TABLA.celda} ${TABLA.numero}`}>{dinero(c.importe, c.moneda)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dialogo?.tipo === 'cobro' && (
        <DialogoCobro
          inicial={dialogo.factura}
          movimiento={dialogo.movimiento}
          pendientes={datos.pendientes}
          cuentas={datos.cuentas}
          onCerrar={() => setDialogo(null)}
          onHecho={alTerminar}
        />
      )}
      {dialogo?.tipo === 'gasto' && (
        <DialogoGasto movimiento={dialogo.movimiento} datos={datos} onCerrar={() => setDialogo(null)} onHecho={alTerminar} />
      )}
    </div>
  )
}

function Marco({ titulo, onCerrar, children }: { titulo: string; onCerrar: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [onCerrar])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onCerrar}>
      <div
        role="dialog"
        aria-label={titulo}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[520px] flex-col rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)]"
      >
        <div className={`${TARJETA.cabecera} justify-between`}>
          <span className={TITULO.seccion}>{titulo}</span>
          <button type="button" aria-label="Cerrar" onClick={onCerrar} className={BOTON.icono}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="flex flex-col gap-2.5 overflow-auto p-3">{children}</div>
      </div>
    </div>
  )
}

function DialogoCobro({
  inicial,
  movimiento,
  pendientes,
  cuentas,
  onCerrar,
  onHecho,
}: {
  inicial: FacturaPendiente | null
  movimiento: MovimientoSinCategorizar | null
  pendientes: FacturaPendiente[]
  cuentas: CuentaBancaria[]
  onCerrar: () => void
  onHecho: () => void
}) {
  const opciones = useMemo(() => (movimiento ? candidatasDeCobro(movimiento, pendientes) : pendientes), [movimiento, pendientes])
  const [facturaId, setFacturaId] = useState(inicial?.id ?? (movimiento ? (opciones[0]?.id ?? '') : ''))
  const factura = opciones.find((f) => f.id === facturaId) ?? null
  const [importe, setImporte] = useState(String(movimiento?.importe ?? inicial?.saldo ?? ''))
  const [fecha, setFecha] = useState(movimiento?.fecha ?? hoyISO())
  const [referencia, setReferencia] = useState(movimiento?.referencia ?? '')
  const [concepto, setConcepto] = useState(movimiento?.concepto ?? '')
  const [comision, setComision] = useState('')
  const [guardando, setGuardando] = useState(false)

  const moneda = factura?.moneda ?? movimiento?.moneda ?? 'EUR'
  const validas = cuentas.filter((c) => c.moneda === moneda)
  const [cuentaId, setCuentaId] = useState(movimiento?.cuentaId ?? (validas.find((c) => c.esPayset) ?? validas[0])?.id ?? '')

  useEffect(() => {
    if (movimiento) return
    if (!validas.some((c) => c.id === cuentaId)) setCuentaId((validas.find((c) => c.esPayset) ?? validas[0])?.id ?? '')
  }, [validas, cuentaId, movimiento])

  const elegirFactura = (id: string) => {
    setFacturaId(id)
    const f = opciones.find((o) => o.id === id)
    if (f && !movimiento) setImporte(String(f.saldo))
  }

  const cifra = Number(importe)
  const parcial = factura && cifra > 0 && cifra < factura.saldo - 0.005
  const demasiado = factura && cifra > factura.saldo + 0.005

  async function guardar() {
    setGuardando(true)
    try {
      const r = await pedir<{ cobradaEntera: boolean }>('/api/facturacion/cobros', {
        metodo: 'POST',
        cuerpo: { facturaId, importe: cifra, fecha, cuentaId, referencia, concepto, comisionBanco: Number(comision) || 0, movimientoId: movimiento?.id ?? null },
      })
      toast.success(r.cobradaEntera ? 'Cobro registrado en Zoho: factura cobrada' : 'Cobro registrado en Zoho')
      onHecho()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido registrar el cobro')
      setGuardando(false)
    }
  }

  return (
    <Marco titulo="Registrar cobro" onCerrar={onCerrar}>
      {movimiento && (
        <p className={`${TIPO.s} ${TEXTO.t3}`}>
          Del banco: {dinero(movimiento.importe, movimiento.moneda)} · {movimiento.concepto || 'sin concepto'}
        </p>
      )}
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Factura</label>
        <select value={facturaId} onChange={(e) => elegirFactura(e.target.value)} className={CAMPO.input}>
          <option value="">Elige la factura…</option>
          {opciones.map((f) => (
            <option key={f.id} value={f.id}>
              {f.cliente} · {f.numero} · {dinero(f.saldo, f.moneda)}
            </option>
          ))}
        </select>
      </div>
      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Importe</label>
          <input type="number" step="0.01" min="0" value={importe} onChange={(e) => setImporte(e.target.value)} className={`${CAMPO.input} ${CAMPO.numero}`} />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Fecha del cobro</label>
          <input type="date" value={fecha} max={hoyISO()} onChange={(e) => setFecha(e.target.value)} className={CAMPO.input} />
        </div>
      </div>
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Cuenta donde ha entrado</label>
        <select value={cuentaId} disabled={Boolean(movimiento)} onChange={(e) => setCuentaId(e.target.value)} className={CAMPO.input}>
          {validas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {c.moneda}
            </option>
          ))}
        </select>
      </div>
      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Referencia del banco</label>
          <input value={referencia} onChange={(e) => setReferencia(e.target.value)} className={CAMPO.input} />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Comisión del banco</label>
          <input type="number" step="0.01" min="0" value={comision} onChange={(e) => setComision(e.target.value)} placeholder="0,00" className={`${CAMPO.input} ${CAMPO.numero}`} />
        </div>
      </div>
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Concepto</label>
        <input value={concepto} onChange={(e) => setConcepto(e.target.value)} placeholder="From …" className={CAMPO.input} />
      </div>
      {parcial && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Es menos de lo que falta ({dinero(factura.saldo, factura.moneda)}): la factura quedará con cobro parcial.
        </Aviso>
      )}
      {demasiado && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          Es más de lo que falta por pagar ({dinero(factura.saldo, factura.moneda)}).
        </Aviso>
      )}
      <div>
        <button
          type="button"
          disabled={guardando || !facturaId || !cuentaId || !(cifra > 0) || Boolean(demasiado)}
          onClick={() => void guardar()}
          className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
        >
          {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
          Registrar en Zoho
        </button>
      </div>
    </Marco>
  )
}

function DialogoGasto({
  movimiento,
  datos,
  onCerrar,
  onHecho,
}: {
  movimiento: MovimientoSinCategorizar | null
  datos: DatosDeCobros
  onCerrar: () => void
  onHecho: () => void
}) {
  const [cuentaGastoId, setCuentaGastoId] = useState('')
  const [cuentaPagoId, setCuentaPagoId] = useState(movimiento?.cuentaId ?? (datos.cuentas.find((c) => c.esPayset) ?? datos.cuentas[0])?.id ?? '')
  const [importe, setImporte] = useState(String(movimiento?.importe ?? ''))
  const [fecha, setFecha] = useState(movimiento?.fecha ?? hoyISO())
  const [referencia, setReferencia] = useState(movimiento?.referencia ?? '')
  const [concepto, setConcepto] = useState(movimiento?.concepto ?? '')
  const [guardando, setGuardando] = useState(false)
  const moneda = datos.cuentas.find((c) => c.id === cuentaPagoId)?.moneda

  async function guardar() {
    setGuardando(true)
    try {
      await pedir('/api/facturacion/movimientos', {
        metodo: 'POST',
        cuerpo: {
          cuentaGastoId,
          cuentaGastoNombre: datos.cuentasDeGasto.find((c) => c.id === cuentaGastoId)?.nombre ?? null,
          cuentaPagoId,
          importe: Number(importe),
          fecha,
          referencia,
          concepto,
          movimientoId: movimiento?.id ?? null,
        },
      })
      toast.success('Gasto registrado en Zoho')
      onHecho()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido registrar el gasto')
      setGuardando(false)
    }
  }

  return (
    <Marco titulo="Registrar gasto" onCerrar={onCerrar}>
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>¿De qué es?</label>
        <select value={cuentaGastoId} onChange={(e) => setCuentaGastoId(e.target.value)} className={CAMPO.input}>
          <option value="">Elige el tipo de gasto…</option>
          {datos.cuentasDeGasto.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </select>
      </div>
      <div className={CAMPO.contenedor}>
        <label className={CAMPO.etiqueta}>Cuenta desde la que se ha pagado</label>
        <select value={cuentaPagoId} disabled={Boolean(movimiento)} onChange={(e) => setCuentaPagoId(e.target.value)} className={CAMPO.input}>
          {datos.cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre} · {c.moneda}
            </option>
          ))}
        </select>
      </div>
      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Importe{moneda ? ` (${moneda})` : ''}</label>
          <input type="number" step="0.01" min="0" value={importe} disabled={Boolean(movimiento)} onChange={(e) => setImporte(e.target.value)} className={`${CAMPO.input} ${CAMPO.numero}`} />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Fecha</label>
          <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className={CAMPO.input} />
        </div>
      </div>
      <div className={CAMPO.rejilla}>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Concepto</label>
          <input value={concepto} maxLength={100} onChange={(e) => setConcepto(e.target.value)} className={CAMPO.input} />
        </div>
        <div className={CAMPO.contenedor}>
          <label className={CAMPO.etiqueta}>Referencia</label>
          <input value={referencia} maxLength={100} onChange={(e) => setReferencia(e.target.value)} className={CAMPO.input} />
        </div>
      </div>
      <div>
        <button
          type="button"
          disabled={guardando || !cuentaGastoId || !cuentaPagoId || !(Number(importe) > 0) || !fecha}
          onClick={() => void guardar()}
          className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}
        >
          {guardando && <Loader2 className="h-3 w-3 animate-spin" />}
          Registrar en Zoho
        </button>
      </div>
    </Marco>
  )
}
