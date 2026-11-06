'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowDownLeft,
  ArrowLeftRight,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileClock,
  Flame,
  Hourglass,
  Landmark,
  Loader2,
  Plus,
  Receipt,
  type LucideIcon,
} from 'lucide-react'
import { Avatar, BarraDeCarga } from '@/components/rendimiento/ui'
import { BOTON, CAMPO, COLOR_ESTADO, TABLA, TARJETA, TEXTO, TEXTO_ESTADO, TIPO, TITULO, type TonoEstado } from '@/lib/estilo/denso'
import { candidatasDeCobro, diasDesde, TRAMOS_VENCIMIENTO, tramoDeVencimiento, type IdVencimiento } from '@/lib/facturacion/logica'
import type { CuentaBancaria, DatosDeCobros, FacturaPendiente, MovimientoSinCategorizar } from '@/lib/facturacion/tipos'
import { Aviso, BarraDeReparto, CabeceraDeTarjeta, CasillaDeResumen, Cuenta, Dialogo, dinero, EsqueletoDePestana, fechaCorta, hoyISO, pedir, seguirAlRaton, tonoComoEstilo } from './comun'

/**
 * LO QUE ESTÁ POR COBRAR Y LO QUE HA PASADO EN EL BANCO.
 *
 * Todos los meses, no solo uno: una factura vencida de octubre no desaparece por
 * mirar noviembre. Cada registro va a Zoho, con su referencia y su tipo de cambio.
 *
 * Arriba, lo que falta por entrar repartido por lo que lleva vencido; pulsar un tramo deja solo esas facturas. La barra y los
 * tramos se miden en la moneda de la que más se debe: si hay otra, su total sale al lado del principal y sus facturas se
 * cuentan igual, sin sumar peras con manzanas.
 */

/** «EUR to AED» no es ni un cobro ni un gasto: es mover dinero entre dos cuentas */
const esCambioDeDivisa = (m: MovimientoSinCategorizar) => /\b[A-Z]{3} to [A-Z]{3}\b/.test(m.concepto)

const ESTILO_TRAMO: Record<IdVencimiento, { tono: TonoEstado; icono: LucideIcon }> = {
  en_plazo: { tono: 'verde', icono: Clock },
  hasta_15: { tono: 'ambar', icono: Hourglass },
  hasta_30: { tono: 'naranja', icono: AlertTriangle },
  mas_de_30: { tono: 'rojo', icono: Flame },
}

/** Lo que queda para que venza, o lo que lleva vencida */
function plazoDe(f: FacturaPendiente): string | null {
  if (f.diasVencida > 0) return `hace ${f.diasVencida} d`
  if (!f.vence) return null
  const faltan = -diasDesde(f.vence, hoyISO())
  return faltan === 0 ? 'vence hoy' : `en ${faltan} d`
}

type VentanaDeCobros =
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
  const [ventana, setVentana] = useState<VentanaDeCobros>(null)
  const [tramo, setTramo] = useState<IdVencimiento | null>(null)
  const [cobrosNuevos, setCobrosNuevos] = useState<Set<string>>(new Set())
  const cobrosVistos = useRef<Set<string> | null>(null)

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
      if (f) setVentana({ tipo: 'cobro', factura: f, movimiento: null })
    })
  }, [traer, facturaInicial])

  // El cobro que se acaba de registrar se ilumina al aparecer en la lista
  useEffect(() => {
    if (!datos) return
    const ids = datos.cobros.map((c) => c.id)
    if (cobrosVistos.current) setCobrosNuevos(new Set(ids.filter((id) => !cobrosVistos.current?.has(id))))
    cobrosVistos.current = new Set(ids)
  }, [datos])

  const porMoneda = useMemo(() => {
    const totales = new Map<string, number>()
    for (const f of datos?.pendientes ?? []) totales.set(f.moneda, (totales.get(f.moneda) ?? 0) + f.saldo)
    return [...totales.entries()].sort((a, b) => b[1] - a[1])
  }, [datos])

  const alTerminar = () => {
    setVentana(null)
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
  if (!datos) return <EsqueletoDePestana etiqueta="Leyendo Zoho" />

  const urlBanco = zohoOrgId ? `https://books.zoho.com/app/${zohoOrgId}#/banking` : null
  const monedaPrincipal = porMoneda[0]?.[0] ?? 'EUR'
  const otrasMonedas = porMoneda.slice(1)
  const vencidas = datos.pendientes.filter((f) => f.diasVencida > 0).length
  const facturasDe = (id: IdVencimiento) => datos.pendientes.filter((f) => tramoDeVencimiento(f.diasVencida) === id)
  const importeDe = (id: IdVencimiento) => facturasDe(id).reduce((suma, f) => suma + (f.moneda === monedaPrincipal ? f.saldo : 0), 0)
  const visibles = tramo ? facturasDe(tramo) : datos.pendientes

  return (
    <div className="flex flex-col gap-2">
      <section className="fac-entra relative overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 pt-2.5">
          <span className="flex items-baseline gap-2">
            <span className={TITULO.rotulo}>Por cobrar</span>
            <span className={`text-[20px] font-semibold leading-none tracking-[-0.02em] tabular-nums ${TEXTO.t1}`}>
              <Cuenta valor={porMoneda[0]?.[1] ?? 0} formato={(n) => dinero(n, monedaPrincipal)} />
            </span>
            {otrasMonedas.map(([moneda, total]) => (
              <span key={moneda} className={`${TIPO.s} tabular-nums ${TEXTO.t3}`}>
                + {dinero(total, moneda)}
              </span>
            ))}
          </span>
          {vencidas > 0 && (
            <span className="fac-contador" style={tonoComoEstilo('rojo')}>
              {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
            </span>
          )}
          <button type="button" onClick={() => setVentana({ tipo: 'gasto', movimiento: null })} className={`${BOTON.base} ${BOTON.secundario} ml-auto`}>
            <Plus className="h-3 w-3" /> Registrar gasto
          </button>
        </div>

        <div className="px-3 pb-2.5 pt-2">
          <BarraDeReparto
            etiqueta={TRAMOS_VENCIMIENTO.map((t) => `${t.nombre}: ${dinero(importeDe(t.id), monedaPrincipal)}`).join(', ')}
            tramos={TRAMOS_VENCIMIENTO.map((t) => ({
              id: t.id,
              nombre: `${t.nombre}: ${dinero(importeDe(t.id), monedaPrincipal)}`,
              tono: ESTILO_TRAMO[t.id].tono,
              valor: importeDe(t.id),
              apagado: tramo !== null && tramo !== t.id,
            }))}
          />
        </div>

        <div className="fac-pasos grid-cols-2 lg:grid-cols-4" role="group" aria-label="Filtrar por lo que lleva vencido">
          {TRAMOS_VENCIMIENTO.map((t) => (
            <CasillaDeResumen
              key={t.id}
              tono={ESTILO_TRAMO[t.id].tono}
              icono={ESTILO_TRAMO[t.id].icono}
              nombre={t.nombre}
              cantidad={facturasDe(t.id).length}
              importe={importeDe(t.id)}
              encendida={tramo === t.id}
              onPulsar={() => setTramo(tramo === t.id ? null : t.id)}
            />
          ))}
        </div>
        <BarraDeCarga activa={cargando} />
      </section>

      <div className="grid grid-cols-1 items-start gap-2 min-[1280px]:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-2">
          <section className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': 2 } as CSSProperties}>
            <CabeceraDeTarjeta tono="cian" icono={FileClock} titulo="Facturas por cobrar" cantidad={visibles.length} />
            {visibles.length === 0 ? (
              <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>{tramo ? 'No hay ninguna en este tramo.' : 'No hay ninguna factura por cobrar.'}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLA.tabla}>
                  <thead>
                    <tr>
                      <th className={TABLA.cabecera}>Cliente</th>
                      <th className={TABLA.cabecera}>Factura</th>
                      <th className={TABLA.cabecera}>Vence</th>
                      <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Por cobrar</th>
                      <th className={TABLA.cabecera} />
                    </tr>
                  </thead>
                  <tbody>
                    {visibles.map((f, i) => {
                      const { tono } = ESTILO_TRAMO[tramoDeVencimiento(f.diasVencida)]
                      const plazo = plazoDe(f)
                      return (
                        <tr key={f.id} className={`fac-fila ${TABLA.fila}`} style={{ ...tonoComoEstilo(tono), '--i': i } as CSSProperties}>
                          <td className={TABLA.celda}>
                            <span className="flex items-center gap-2">
                              <Avatar id={f.clienteId} nombre={f.cliente} tamano={20} />
                              <span className={`fac-nombre ${TABLA.corta} max-w-[200px] ${TEXTO.t1}`} title={f.cliente}>
                                {f.cliente}
                              </span>
                            </span>
                          </td>
                          <td className={TABLA.celda}>
                            <span className={`${TABLA.corta} max-w-[200px]`} title={f.numero}>
                              {f.numero}
                            </span>
                          </td>
                          <td className={TABLA.celda}>
                            <span className="flex items-center gap-1.5">
                              {fechaCorta(f.vence)}
                              {plazo && (
                                <span className="fac-contador" style={tonoComoEstilo(f.diasVencida > 0 ? tono : 'gris')}>
                                  {plazo}
                                </span>
                              )}
                            </span>
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero} font-semibold ${TEXTO.t1}`}>
                            {f.saldo < f.total - 0.005 && (
                              <span className="fac-contador mr-1.5 font-medium" style={tonoComoEstilo('azul')} title={`Ya ha pagado ${dinero(f.total - f.saldo, f.moneda)} de ${dinero(f.total, f.moneda)}`}>
                                parcial
                              </span>
                            )}
                            {dinero(f.saldo, f.moneda)}
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                            <button type="button" onClick={() => setVentana({ tipo: 'cobro', factura: f, movimiento: null })} className={`${BOTON.base} ${BOTON.secundario}`}>
                              <Banknote className="h-3 w-3" style={{ color: COLOR_ESTADO.verde }} />
                              Registrar cobro
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': 3 } as CSSProperties}>
            <CabeceraDeTarjeta tono="ambar" icono={ArrowLeftRight} titulo="Movimientos del banco sin categorizar" cantidad={datos.movimientos.length} />
            {datos.movimientos.length === 0 ? (
              <p className={`flex items-center gap-2 ${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>
                <CheckCircle2 className="rend-pop h-3.5 w-3.5" style={{ color: COLOR_ESTADO.verde }} /> Todo categorizado.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className={TABLA.tabla}>
                  <thead>
                    <tr>
                      <th className={TABLA.cabecera}>Concepto</th>
                      <th className={TABLA.cabecera}>Fecha</th>
                      <th className={TABLA.cabecera}>Referencia</th>
                      <th className={TABLA.cabecera}>Cuenta</th>
                      <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Importe</th>
                      <th className={TABLA.cabecera} />
                    </tr>
                  </thead>
                  <tbody>
                    {datos.movimientos.map((m, i) => {
                      const cambio = esCambioDeDivisa(m)
                      const tono: TonoEstado = cambio ? 'azul' : m.entrada ? 'verde' : 'rojo'
                      const Icono = cambio ? ArrowLeftRight : m.entrada ? ArrowDownLeft : ArrowUpRight
                      return (
                        <tr key={m.id} className={`fac-fila ${TABLA.fila}`} style={{ ...tonoComoEstilo(tono), '--i': i } as CSSProperties}>
                          <td className={TABLA.celda}>
                            <span className="flex items-center gap-2">
                              <span className="fac-icono !h-5 !w-5">
                                <Icono className="h-3 w-3" />
                              </span>
                              <span className={`${TABLA.corta} max-w-[230px] ${TEXTO.t1}`} title={m.concepto}>
                                {m.concepto || '—'}
                              </span>
                            </span>
                          </td>
                          <td className={TABLA.celda}>{fechaCorta(m.fecha)}</td>
                          <td className={TABLA.celda}>
                            <span className={`${TABLA.corta} max-w-[110px]`} title={m.referencia}>
                              {m.referencia || '—'}
                            </span>
                          </td>
                          <td className={TABLA.celda}>
                            <span className={`${TABLA.corta} max-w-[150px]`} title={m.cuentaNombre}>
                              {m.cuentaNombre} · {m.moneda}
                            </span>
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.numero} font-semibold ${m.entrada ? TEXTO_ESTADO.verde : TEXTO.t1}`}>
                            {m.entrada ? '+' : '−'}
                            {dinero(m.importe, m.moneda)}
                          </td>
                          <td className={`${TABLA.celda} ${TABLA.derecha}`}>
                            {cambio ? (
                              urlBanco && (
                                <a href={urlBanco} target="_blank" rel="noreferrer" className={`${BOTON.base} ${BOTON.secundario}`} title="Mover dinero entre cuentas se categoriza en Zoho">
                                  <ExternalLink className="h-3 w-3" /> Cambio de divisa: en Zoho
                                </a>
                              )
                            ) : m.entrada ? (
                              <button type="button" onClick={() => setVentana({ tipo: 'cobro', factura: null, movimiento: m })} className={`${BOTON.base} ${BOTON.secundario}`}>
                                Es un cobro
                              </button>
                            ) : (
                              <button type="button" onClick={() => setVentana({ tipo: 'gasto', movimiento: m })} className={`${BOTON.base} ${BOTON.secundario}`}>
                                Es un gasto
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>

        <aside className="flex min-w-0 flex-col gap-2">
          <section className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': 2 } as CSSProperties}>
            <CabeceraDeTarjeta tono="azul" icono={Landmark} titulo="Cuentas" cantidad={datos.cuentas.length} />
            <div className="flex flex-col gap-1.5 p-1.5">
              {datos.cuentas.map((c, i) => (
                <TarjetaDeCuenta key={c.id} cuenta={c} indice={i} />
              ))}
            </div>
          </section>

          <section className={`${TARJETA.base} fac-entra overflow-hidden`} style={{ '--d': 3 } as CSSProperties}>
            <CabeceraDeTarjeta tono="verde" icono={Banknote} titulo="Últimos cobros en Zoho" />
            {datos.cobros.length === 0 ? (
              <p className={`${TARJETA.cuerpo} ${TIPO.s} ${TEXTO.t3}`}>Todavía no hay cobros.</p>
            ) : (
              <ul>
                {datos.cobros.map((c, i) => (
                  <li
                    key={c.id}
                    className={`fac-fila-simple flex items-center gap-2 border-b border-[var(--ls-linea)] px-2.5 py-1.5 last:border-b-0 hover:bg-[var(--ls-sup2)] ${cobrosNuevos.has(c.id) ? 'fac-recien-caja' : ''}`}
                    style={{ ...tonoComoEstilo('verde'), '--i': i } as CSSProperties}
                  >
                    <Avatar id={c.cliente} nombre={c.cliente} tamano={22} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className={`truncate ${TIPO.s} ${TEXTO.t1}`} title={c.cliente}>
                        {c.cliente}
                      </span>
                      <span className={`truncate text-[11px] ${TEXTO.t4}`} title={[c.cuenta, c.referencia].filter(Boolean).join(' · ')}>
                        {fechaCorta(c.fecha)}
                        {c.referencia ? ` · ${c.referencia}` : ''}
                      </span>
                    </span>
                    <span className={`shrink-0 text-[12px] font-semibold tabular-nums ${TEXTO_ESTADO.verde}`}>+{dinero(c.importe, c.moneda)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>

      {ventana?.tipo === 'cobro' && (
        <DialogoCobro
          inicial={ventana.factura}
          movimiento={ventana.movimiento}
          pendientes={datos.pendientes}
          cuentas={datos.cuentas}
          onCerrar={() => setVentana(null)}
          onHecho={alTerminar}
        />
      )}
      {ventana?.tipo === 'gasto' && (
        <DialogoGasto movimiento={ventana.movimiento} datos={datos} onCerrar={() => setVentana(null)} onHecho={alTerminar} />
      )}
    </div>
  )
}

/** Una cuenta del banco, con lo que hay en ella según Zoho y lo que tiene sin categorizar */
function TarjetaDeCuenta({ cuenta, indice }: { cuenta: CuentaBancaria; indice: number }) {
  const tono: TonoEstado = cuenta.esPayset ? 'violeta' : cuenta.moneda === 'EUR' ? 'azul' : 'cian'
  return (
    <div className="fac-cuenta" onMouseMove={seguirAlRaton} style={{ ...tonoComoEstilo(tono), '--d': indice } as CSSProperties}>
      <span className="fac-paso-icono !h-7 !w-7">
        <Landmark className="h-3.5 w-3.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={`truncate text-[11px] ${TEXTO.t3}`} title={cuenta.nombre}>
          {cuenta.nombre}
        </span>
        <span className={`text-[14px] font-semibold leading-none tabular-nums tracking-[-0.01em] ${cuenta.saldo < 0 ? TEXTO_ESTADO.rojo : TEXTO.t1}`}>
          <Cuenta valor={cuenta.saldo} formato={(n) => dinero(n, cuenta.moneda)} />
        </span>
      </span>
      {cuenta.sinCategorizar > 0 && (
        <span className="fac-contador shrink-0" style={tonoComoEstilo('ambar')} title={`${cuenta.sinCategorizar} movimientos sin categorizar`}>
          {cuenta.sinCategorizar}
        </span>
      )}
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
    <Dialogo titulo="Registrar cobro" tono="verde" icono={Banknote} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2.5 overflow-auto p-3">
      {movimiento && (
        <p className={`flex items-center gap-2 rounded-[6px] bg-[var(--ls-sup2)] px-2 py-1.5 ${TIPO.s} ${TEXTO.t2}`} style={tonoComoEstilo('verde')}>
          <span className="fac-icono !h-5 !w-5">
            <ArrowDownLeft className="h-3 w-3" />
          </span>
          <span className="min-w-0 truncate">
            Del banco: <span className="font-semibold">{dinero(movimiento.importe, movimiento.moneda)}</span> · {movimiento.concepto || 'sin concepto'}
          </span>
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
      {factura && cifra > 0 && !demasiado && <TrasElCobro factura={factura} cobro={cifra} />}
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
      </div>
    </Dialogo>
  )
}

/** Cómo queda la factura si se registra este cobro */
function TrasElCobro({ factura, cobro }: { factura: FacturaPendiente; cobro: number }) {
  const ya = factura.total - factura.saldo
  const queda = Math.max(0, factura.saldo - cobro)
  return (
    <div className="flex flex-col gap-1.5 rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-2">
      <span className={`flex items-center justify-between gap-2 ${TIPO.s} ${TEXTO.t3}`}>
        <span className="truncate">{factura.numero}</span>
        {queda < 0.005 ? (
          <span className={`inline-flex shrink-0 items-center gap-1 font-medium ${TEXTO_ESTADO.verde}`}>
            <CheckCircle2 className="rend-pop h-3 w-3" /> Queda cobrada
          </span>
        ) : (
          <span className="shrink-0 tabular-nums">Quedarán {dinero(queda, factura.moneda)}</span>
        )}
      </span>
      <BarraDeReparto
        etiqueta={`Ya cobrado ${dinero(ya, factura.moneda)}, este cobro ${dinero(cobro, factura.moneda)}, quedarán ${dinero(queda, factura.moneda)}`}
        tramos={[
          { id: 'ya', nombre: `Ya cobrado: ${dinero(ya, factura.moneda)}`, tono: 'verde', valor: ya },
          { id: 'este', nombre: `Este cobro: ${dinero(cobro, factura.moneda)}`, tono: 'cian', valor: cobro },
          { id: 'queda', nombre: `Quedarán: ${dinero(queda, factura.moneda)}`, tono: 'gris', valor: queda },
        ]}
      />
    </div>
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
    <Dialogo titulo="Registrar gasto" tono="magenta" icono={Receipt} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2.5 overflow-auto p-3">
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
      </div>
    </Dialogo>
  )
}
