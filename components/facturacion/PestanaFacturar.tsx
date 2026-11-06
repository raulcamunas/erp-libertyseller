'use client'

import { Fragment, useMemo, useState } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  FileEdit,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  type LucideIcon,
} from 'lucide-react'
import { BOTON, CAMPO, CIFRAS, COLOR_ESTADO, PANTALLA, TABLA, TEXTO, TEXTO_ESTADO, TIPO, TITULO, type TonoEstado } from '@/lib/estilo/denso'
import { AVISO_SIN_INFORME, GRUPOS_FACTURACION, agruparFilas, diasDesde, lineasDelMes, mesDelPeriodo, sumarDias, type IdGrupo } from '@/lib/facturacion/logica'
import type { FilaFacturacion, Tablero } from '@/lib/facturacion/tipos'
import { Aviso, dinero, fechaCorta, hoyISO, pedir } from './comun'

/**
 * EL MES, ORDENADO POR LO QUE TOCA HACER.
 *
 * Arriba, los cuatro pasos por los que pasa una factura, con cuántas hay en cada uno y cuánto suman; pulsar uno deja solo ese.
 * Debajo, los clientes juntos según lo que piden, cada grupo con su explicación y sus sumas. Lo que ya no pide nada empieza
 * plegado, y pulsar una fila abre la factura.
 *
 * Crear borradores se puede hacer en bloque, porque no sale nada de la agencia; enviar no: un envío es un correo a un cliente
 * real, y se manda mirándolo.
 */

const ESTILO_GRUPO: Record<IdGrupo, { icono: LucideIcon; tono: TonoEstado }> = {
  vencida: { icono: AlertCircle, tono: 'rojo' },
  por_crear: { icono: CircleDashed, tono: 'ambar' },
  borrador: { icono: FileEdit, tono: 'azul' },
  por_cobrar: { icono: Send, tono: 'cian' },
  cobrada: { icono: CheckCircle2, tono: 'verde' },
  sin_importes: { icono: Minus, tono: 'gris' },
}

/** Los pasos de arriba. «Por cobrar» reúne lo enviado en plazo y lo vencido */
const PASOS: { id: IdGrupo; nombre: string; grupos: IdGrupo[]; urgente: boolean }[] = [
  { id: 'por_crear', nombre: 'Por crear', grupos: ['por_crear'], urgente: true },
  { id: 'borrador', nombre: 'Por enviar', grupos: ['borrador'], urgente: true },
  { id: 'por_cobrar', nombre: 'Por cobrar', grupos: ['vencida', 'por_cobrar'], urgente: false },
  { id: 'cobrada', nombre: 'Cobradas', grupos: ['cobrada'], urgente: false },
]

const totalDe = (f: FilaFacturacion) => f.factura?.total ?? f.totalTesoreria
const sumar = (filas: FilaFacturacion[], valor: (f: FilaFacturacion) => number | null | undefined) => filas.reduce((s, f) => s + (valor(f) ?? 0), 0)
/** Lo que aún falta por entrar: en lo que ya salió es el saldo, no el total */
const importeDelPaso = (id: IdGrupo, f: FilaFacturacion) => (id === 'por_cobrar' ? (f.factura?.saldo ?? 0) : totalDe(f))

function saltarMes(period: string, salto: number): string {
  const [a, m] = period.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 + salto, 1)).toISOString().slice(0, 10)
}

const mesActual = () => `${hoyISO().slice(0, 7)}-01`

const COLUMNAS = 8

/** La columna de los botones no se va de la pantalla en un portátil, aunque la tabla no quepa entera */
const ACCIONES = 'sticky right-0 bg-[var(--ls-sup)]'

export function PestanaFacturar({
  tablero,
  cargando,
  error,
  period,
  onCambiarMes,
  onActualizar,
  onAbrir,
  onCobrar,
}: {
  tablero: Tablero | null
  cargando: boolean
  error: string | null
  period: string
  onCambiarMes: (period: string) => void
  onActualizar: () => Promise<void>
  onAbrir: (fila: FilaFacturacion) => void
  onCobrar: (facturaId: string) => void
}) {
  const [creando, setCreando] = useState(false)
  const [paso, setPaso] = useState<IdGrupo | null>(null)
  const [cambiados, setCambiados] = useState<Set<IdGrupo>>(new Set())

  const filas = useMemo(() => tablero?.filas ?? [], [tablero])
  const grupos = useMemo(() => agruparFilas(filas), [filas])
  const pasoElegido = PASOS.find((p) => p.id === paso)
  const visibles = pasoElegido ? grupos.filter((g) => pasoElegido.grupos.includes(g.grupo.id)) : grupos
  const totalDelMes = sumar(filas, totalDe)

  /** Los que se pueden crear de golpe: con cliente en Zoho y con conceptos */
  const enBloque = useMemo(() => filas.filter((f) => f.estado === 'por_crear' && f.contactoId), [filas])
  const sinEnlazar = filas.filter((f) => f.estado === 'por_crear' && !f.contactoId).length

  function plegar(id: IdGrupo) {
    setCambiados((actuales) => {
      const nuevos = new Set(actuales)
      if (!nuevos.delete(id)) nuevos.add(id)
      return nuevos
    })
  }

  /**
   * CREAR LOS BORRADORES QUE FALTAN, UNO DETRÁS DE OTRO.
   *
   * En serie para no disparar el límite por minuto de Zoho. Los fallos se dicen
   * uno a uno: «3 han fallado» obliga a ir a buscar cuáles.
   */
  async function crearTodos() {
    if (!window.confirm(`¿Crear ${enBloque.length} borradores en Zoho? No se envía nada a ningún cliente.`)) return
    setCreando(true)
    const hoy = hoyISO()
    let hechos = 0
    for (const f of enBloque) {
      try {
        await pedir('/api/facturacion/factura', {
          metodo: 'POST',
          cuerpo: {
            treasuryClientId: f.treasuryClientId,
            contactoId: f.contactoId,
            period,
            numero: f.numeroPropuesto,
            fecha: hoy,
            vence: sumarDias(hoy, 7),
            lineas: lineasDelMes(f.fee, f.comision, f.informes),
          },
        })
        hechos += 1
      } catch (e) {
        toast.error(`${f.nombre}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    setCreando(false)
    if (hechos > 0) toast.success(`${hechos} ${hechos === 1 ? 'borrador creado' : 'borradores creados'} en Zoho`)
    await onActualizar()
  }

  return (
    <div className={`${PANTALLA.cuerpo} w-full max-w-[1440px]`}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex h-7 items-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
          <button type="button" aria-label="Mes anterior" onClick={() => onCambiarMes(saltarMes(period, -1))} className={BOTON.icono}>
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <span className={`min-w-[120px] text-center ${TIPO.xs} ${TEXTO.t1}`}>{mesDelPeriodo(period)}</span>
          <button type="button" aria-label="Mes siguiente" onClick={() => onCambiarMes(saltarMes(period, 1))} className={BOTON.icono}>
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        {period !== mesActual() && (
          <button type="button" onClick={() => onCambiarMes(mesActual())} className={BOTON.chip}>
            Este mes
          </button>
        )}

        <div className="ml-auto flex items-center gap-2">
          {totalDelMes > 0 && (
            <span className={CIFRAS.tira}>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.rotulo}>Total del mes</span>
                <span className={CIFRAS.valor}>{dinero(totalDelMes)}</span>
              </span>
            </span>
          )}
          <button type="button" disabled={cargando} onClick={() => void onActualizar()} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.alto}`}>
            {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            Actualizar
          </button>
        </div>
      </div>

      {error && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          {error}
        </Aviso>
      )}

      {!tablero ? (
        // Sin datos no se pintan los pasos a cero: si la lectura falla, parecería que este mes no hay nada que facturar
        cargando && (
          <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo Tesorería y Zoho…
          </div>
        )
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" role="group" aria-label="Filtrar por paso">
            {PASOS.map((p, i) => {
              const dePaso = grupos.filter((g) => p.grupos.includes(g.grupo.id)).flatMap((g) => g.filas)
              const vencidas = p.id === 'por_cobrar' ? dePaso.filter((f) => f.estado === 'vencida').length : 0
              const encendido = paso === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  aria-pressed={encendido}
                  onClick={() => setPaso(encendido ? null : p.id)}
                  className={`relative flex min-w-0 flex-col gap-[3px] rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2 text-left hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup3)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ls-acc-graf)] ${encendido ? BOTON.chipEncendido : ''}`}
                >
                  <span className={`flex items-center gap-1.5 ${TIPO.xs} ${TEXTO.t3}`}>
                    <span className="tabular-nums">{i + 1}</span>
                    {p.nombre}
                    {vencidas > 0 && (
                      <span className={`ml-auto font-medium ${TEXTO_ESTADO.rojo}`}>
                        {vencidas} {vencidas === 1 ? 'vencida' : 'vencidas'}
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-2">
                    <span className={`text-[18px] font-semibold leading-none tabular-nums ${p.urgente && dePaso.length > 0 ? TEXTO.acento : TEXTO.t1}`}>{dePaso.length}</span>
                    <span className={`${TIPO.s} tabular-nums ${TEXTO.t3}`}>{dinero(sumar(dePaso, (f) => importeDelPaso(p.id, f)))}</span>
                  </span>
                </button>
              )
            })}
          </div>

          <div className={TABLA.caja}>
            <table className={TABLA.tabla}>
              <thead>
                <tr>
                  <th className={TABLA.cabecera}>Cliente</th>
                  <th className={TABLA.cabecera}>Factura</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Fee</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Comisión</th>
                  <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Total</th>
                  <th className={TABLA.cabecera}>Vence</th>
                  <th className={TABLA.cabecera}>A revisar</th>
                  <th className={`${TABLA.cabecera} right-0 z-30`}>
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              {visibles.map(({ grupo, filas: delGrupo }) => {
                const inicial = GRUPOS_FACTURACION.find((g) => g.id === grupo.id)?.plegado ?? false
                const plegado = !pasoElegido && inicial !== cambiados.has(grupo.id)
                return (
                  <Fragment key={grupo.id}>
                    <tbody>
                      <CabeceraDeGrupo
                        id={grupo.id}
                        nombre={grupo.nombre}
                        ayuda={grupo.id === 'por_crear' && sinEnlazar > 0 ? `${grupo.ayuda} ${sinEnlazar} sin enlazar con Zoho.` : grupo.ayuda}
                        filas={delGrupo}
                        plegado={plegado}
                        onPlegar={() => plegar(grupo.id)}
                        accion={
                          grupo.id === 'por_crear' && enBloque.length > 0 ? (
                            <button type="button" disabled={creando} onClick={() => void crearTodos()} className={`${BOTON.base} ${BOTON.primario}`}>
                              {creando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                              Crear {enBloque.length} {enBloque.length === 1 ? 'borrador' : 'borradores'}
                            </button>
                          ) : null
                        }
                      />
                      {!plegado &&
                        delGrupo.map((f) => (
                          <FilaCliente
                            key={f.treasuryClientId ?? f.contactoId ?? f.nombre}
                            fila={f}
                            contactos={tablero?.contactos ?? []}
                            onAbrir={() => onAbrir(f)}
                            onCobrar={onCobrar}
                            onCambio={() => void onActualizar()}
                          />
                        ))}
                    </tbody>
                  </Fragment>
                )
              })}
              {visibles.length === 0 && (
                <tbody>
                  <tr>
                    <td colSpan={COLUMNAS} className={`py-10 text-center ${TIPO.s} ${TEXTO.t3}`}>
                      {pasoElegido ? (
                        <>
                          No hay ninguna en «{pasoElegido.nombre}» este mes.{' '}
                          <button type="button" onClick={() => setPaso(null)} className={`underline ${TEXTO.t2}`}>
                            Ver todas
                          </button>
                        </>
                      ) : (
                        'Tesorería no tiene clientes para este mes.'
                      )}
                    </td>
                  </tr>
                </tbody>
              )}
            </table>
          </div>
        </>
      )}
    </div>
  )
}

function CabeceraDeGrupo({
  id,
  nombre,
  ayuda,
  filas,
  plegado,
  onPlegar,
  accion,
}: {
  id: IdGrupo
  nombre: string
  ayuda: string
  filas: FilaFacturacion[]
  plegado: boolean
  onPlegar: () => void
  accion: React.ReactNode
}) {
  const estilo = ESTILO_GRUPO[id]
  const Icono = estilo.icono
  const Flecha = plegado ? ChevronRight : ChevronDown
  const celda = `${TABLA.celda} !h-8 bg-[var(--ls-sup2)]`
  const suma = (valor: number) => (valor > 0 ? dinero(valor) : '')
  return (
    <tr>
      <td colSpan={2} className={celda}>
        <button type="button" aria-expanded={!plegado} title={ayuda} onClick={onPlegar} className="flex w-full items-center gap-[7px] text-left focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]">
          <Flecha className={`h-3.5 w-3.5 shrink-0 ${TEXTO.t4}`} />
          <Icono className="h-[13px] w-[13px] shrink-0" style={{ color: COLOR_ESTADO[estilo.tono] }} />
          <span className={TITULO.seccion}>{nombre}</span>
          <span className={`${TIPO.xs} tabular-nums ${TEXTO.t3}`}>{filas.length}</span>
          <span className={`ml-2 hidden min-[1500px]:inline ${TIPO.s} ${TEXTO.t3}`}>{ayuda}</span>
        </button>
      </td>
      <td className={`${celda} ${TABLA.numero} ${TIPO.s} ${TEXTO.t3}`}>{suma(sumar(filas, (f) => f.fee))}</td>
      <td className={`${celda} ${TABLA.numero} ${TIPO.s} ${TEXTO.t3}`}>{suma(sumar(filas, (f) => f.comision))}</td>
      <td className={`${celda} ${TABLA.numero} font-semibold ${TEXTO.t1}`}>{suma(sumar(filas, totalDe))}</td>
      <td colSpan={2} className={celda} />
      <td className={`${celda} ${TABLA.derecha} sticky right-0`}>{accion}</td>
    </tr>
  )
}

function FilaCliente({
  fila,
  contactos,
  onAbrir,
  onCobrar,
  onCambio,
}: {
  fila: FilaFacturacion
  contactos: { id: string; nombre: string }[]
  onAbrir: () => void
  onCobrar: (id: string) => void
  onCambio: () => void
}) {
  const f = fila.factura
  const moneda = f?.moneda ?? 'EUR'
  const sinCliente = !fila.contactoId && fila.estado === 'por_crear'
  const seAbre = fila.estado !== 'sin_importes' && !sinCliente
  const retraso = f?.vence && fila.estado === 'vencida' ? diasDesde(f.vence, hoyISO()) : 0
  const [borrando, setBorrando] = useState(false)
  const celda = `${TABLA.celda} !h-8`

  /** Un borrador no ha salido de la agencia: se puede tirar y volver a crear con lo que diga Tesorería */
  async function borrarBorrador() {
    if (!f || !window.confirm(`¿Borrar de Zoho el borrador «${f.numero}»? No se ha enviado a nadie y luego se puede volver a crear.`)) return
    setBorrando(true)
    try {
      await pedir(`/api/facturacion/factura?id=${encodeURIComponent(f.id)}`, { metodo: 'DELETE' })
      toast.success('Borrador borrado de Zoho')
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar')
    } finally {
      setBorrando(false)
    }
  }

  return (
    <tr onClick={seAbre ? onAbrir : undefined} className={`group/fila ${TABLA.fila} ${seAbre ? 'cursor-pointer' : ''}`}>
      <td className={`${celda} pl-[30px]`}>
        <span className={`${TABLA.corta} max-w-[220px] ${TEXTO.t1}`} title={fila.nombre}>
          {fila.nombre}
        </span>
      </td>
      <td className={`${celda} ${f ? '' : TEXTO.t4}`}>
        <span className={`${TABLA.corta} max-w-[190px]`} title={f ? f.numero : `Número que se le pondrá: ${fila.numeroPropuesto}`}>
          {f?.numero ?? (fila.estado === 'por_crear' ? fila.numeroPropuesto : '—')}
          {fila.otrasFacturas > 0 ? ` (+${fila.otrasFacturas})` : ''}
        </span>
      </td>
      <td className={`${celda} ${TABLA.numero}`}>{fila.fee ? dinero(fila.fee) : '—'}</td>
      <td className={`${celda} ${TABLA.numero}`}>{fila.comision ? dinero(fila.comision) : '—'}</td>
      <td className={`${celda} ${TABLA.numero} ${TEXTO.t1}`}>{dinero(f?.total ?? (fila.totalTesoreria || null), moneda)}</td>
      <td className={`${celda} ${retraso > 0 ? TEXTO_ESTADO.rojo : ''}`}>
        {fechaCorta(f?.vence)}
        {retraso > 0 && ` · hace ${retraso} ${retraso === 1 ? 'día' : 'días'}`}
      </td>
      <td className={celda}>
        <Revisar fila={fila} sinCliente={sinCliente} />
      </td>
      <td className={`${celda} ${TABLA.derecha} ${ACCIONES}`} onClick={(e) => e.stopPropagation()}>
        {sinCliente && fila.treasuryClientId ? (
          <Enlazar treasuryClientId={fila.treasuryClientId} nombre={fila.nombre} contactos={contactos} onCambio={onCambio} />
        ) : fila.estado === 'por_crear' ? (
          <button type="button" onClick={onAbrir} className={`${BOTON.base} ${BOTON.secundario}`}>
            Crear factura
          </button>
        ) : fila.estado === 'borrador' ? (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              disabled={borrando}
              onClick={() => void borrarBorrador()}
              aria-label={`Borrar el borrador de ${fila.nombre}`}
              title="Borrar borrador"
              className={`${BOTON.icono} focus-visible:opacity-100 group-hover/fila:opacity-100 [@media(hover:hover)]:opacity-0`}
            >
              {borrando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
            </button>
            <button type="button" onClick={onAbrir} className={`${BOTON.base} ${BOTON.secundario} ${BOTON.chipEncendido}`}>
              Revisar y enviar
            </button>
          </span>
        ) : f ? (
          <span className="inline-flex items-center gap-1.5">
            {f.saldo > 0 && (
              <button type="button" onClick={() => onCobrar(f.id)} className={`${BOTON.base} ${BOTON.secundario}`}>
                Registrar cobro
              </button>
            )}
            <button type="button" onClick={onAbrir} className={`${BOTON.base} ${BOTON.secundario}`}>
              Ver
            </button>
          </span>
        ) : null}
      </td>
    </tr>
  )
}

/** Lo que hay que mirar antes de seguir. Lo que se arregla en otra pantalla lleva a ella */
function Revisar({ fila, sinCliente }: { fila: FilaFacturacion; sinCliente: boolean }) {
  const f = fila.factura
  const notas = [...(sinCliente ? ['Sin cliente en Zoho'] : []), ...(fila.estado === 'parcial' && f ? [`Cobro parcial: quedan ${dinero(f.saldo, f.moneda)}`] : []), ...fila.avisos]
  if (notas.length === 0) return null
  return (
    <span className={`flex max-w-[210px] items-center gap-2 ${TIPO.s} ${TEXTO_ESTADO.ambar}`}>
      {notas.map((n) =>
        n.startsWith(AVISO_SIN_INFORME) ? (
          <Link
            key={n}
            href="/dashboard/commissions"
            onClick={(e) => e.stopPropagation()}
            title="Se crea en Comisiones, y hace falta para poner el enlace en el correo"
            className="inline-flex items-center gap-1 whitespace-nowrap hover:underline"
          >
            {n} <ArrowRight className="h-3 w-3" />
          </Link>
        ) : (
          <span key={n} className="overflow-hidden text-ellipsis" title={n}>
            {n}
          </span>
        )
      )}
    </span>
  )
}

/** Un cliente de Tesorería sin contacto en Zoho: se enlaza con uno que exista o se crea */
function Enlazar({
  treasuryClientId,
  nombre,
  contactos,
  onCambio,
}: {
  treasuryClientId: string
  nombre: string
  contactos: { id: string; nombre: string }[]
  onCambio: () => void
}) {
  const [guardando, setGuardando] = useState(false)

  async function guardar(cuerpo: Record<string, unknown>, aviso: string) {
    setGuardando(true)
    try {
      await pedir('/api/facturacion/emparejar', { metodo: 'POST', cuerpo: { treasuryClientId, ...cuerpo } })
      toast.success(aviso)
      onCambio()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido enlazar')
    } finally {
      setGuardando(false)
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5">
      <select
        aria-label={`Cliente de Zoho para ${nombre}`}
        disabled={guardando}
        value=""
        onChange={(e) => {
          if (e.target.value) void guardar({ contactoId: e.target.value }, 'Cliente enlazado')
        }}
        className={`${CAMPO.input} !h-6 !w-[150px] text-[11.5px]`}
      >
        <option value="">Enlazar con Zoho…</option>
        {contactos.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nombre}
          </option>
        ))}
      </select>
      <button
        type="button"
        disabled={guardando}
        onClick={() => {
          const correo = window.prompt(`Se creará «${nombre}» en Zoho, en euros. Correo del cliente (opcional):`, '')
          if (correo !== null) void guardar({ crear: { nombre, email: correo } }, 'Cliente creado en Zoho')
        }}
        className={`${BOTON.base} ${BOTON.secundario}`}
      >
        Crear
      </button>
    </span>
  )
}
