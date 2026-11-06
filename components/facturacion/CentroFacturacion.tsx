'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDashed,
  Clock,
  FileEdit,
  Loader2,
  Minus,
  Plus,
  RefreshCw,
  Send,
  type LucideIcon,
} from 'lucide-react'
import { BOTON, CAMPO, CIFRAS, COLOR_ESTADO, ESTADO, PANTALLA, TABLA, TEXTO, TEXTO_ESTADO, TIPO, TITULO, type TonoEstado } from '@/lib/estilo/denso'
import { lineasDelMes, mesDelPeriodo, sumarDias } from '@/lib/facturacion/logica'
import { ETIQUETA_ESTADO, type EstadoFila, type FilaFacturacion, type Tablero } from '@/lib/facturacion/tipos'
import { Aviso, dinero, fechaCorta, hoyISO, pedir } from './comun'
import { PanelFactura } from './PanelFactura'
import { PestanaCobros } from './PestanaCobros'
import { PestanaPlantillas } from './PestanaPlantillas'
import { PestanaRegistro } from './PestanaRegistro'

/**
 * FACTURAR EL MES SIN ENTRAR EN ZOHO.
 *
 * Cada cliente es una fila con su estado y un botón que hace el paso que toca.
 * Crear borradores se puede hacer en bloque, porque no sale nada de la agencia;
 * enviar no: un envío es un correo a un cliente real, y se manda mirándolo.
 */

const ESTILO_ESTADO: Record<EstadoFila, { icono: LucideIcon; tono: TonoEstado }> = {
  sin_importes: { icono: Minus, tono: 'gris' },
  por_crear: { icono: CircleDashed, tono: 'ambar' },
  borrador: { icono: FileEdit, tono: 'azul' },
  enviada: { icono: Send, tono: 'cian' },
  parcial: { icono: Clock, tono: 'violeta' },
  vencida: { icono: AlertCircle, tono: 'rojo' },
  cobrada: { icono: CheckCircle2, tono: 'verde' },
}

/** Lo que espera una acción tuya, arriba; lo que no pide nada, abajo */
const ORDEN: Record<EstadoFila, number> = { por_crear: 0, borrador: 1, vencida: 2, parcial: 3, enviada: 4, cobrada: 5, sin_importes: 6 }

const PESTANAS = [
  { id: 'facturar', nombre: 'Facturar' },
  { id: 'cobros', nombre: 'Cobros y banco' },
  { id: 'plantillas', nombre: 'Plantillas' },
  { id: 'registro', nombre: 'Registro' },
] as const
type IdPestana = (typeof PESTANAS)[number]['id']

function saltarMes(period: string, salto: number): string {
  const [a, m] = period.split('-').map(Number)
  return new Date(Date.UTC(a, m - 1 + salto, 1)).toISOString().slice(0, 10)
}

const mesActual = () => `${hoyISO().slice(0, 7)}-01`

type TableroConOrg = Tablero & { zohoOrgId: string | null }

export function CentroFacturacion() {
  const [pestana, setPestana] = useState<IdPestana>('facturar')
  const [period, setPeriod] = useState(mesActual)
  const [tablero, setTablero] = useState<TableroConOrg | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [abierta, setAbierta] = useState<FilaFacturacion | null>(null)
  const [creando, setCreando] = useState(false)
  const [facturaACobrar, setFacturaACobrar] = useState<string | null>(null)

  const traer = useCallback(async () => {
    setCargando(true)
    try {
      setTablero(await pedir<TableroConOrg>(`/api/facturacion?period=${period}`))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer el mes')
    } finally {
      setCargando(false)
    }
  }, [period])

  useEffect(() => {
    void traer()
  }, [traer])

  const filas = useMemo(
    () => [...(tablero?.filas ?? [])].sort((a, b) => ORDEN[a.estado] - ORDEN[b.estado]),
    [tablero]
  )

  const cuentas = useMemo(() => {
    const contar = (e: EstadoFila) => filas.filter((f) => f.estado === e).length
    return {
      porCrear: contar('por_crear'),
      borradores: contar('borrador'),
      fuera: contar('enviada') + contar('parcial') + contar('vencida'),
      cobradas: contar('cobrada'),
      sinFacturar: filas.filter((f) => f.estado === 'por_crear').reduce((s, f) => s + f.totalTesoreria, 0),
    }
  }, [filas])

  /** Los que se pueden crear de golpe: con cliente en Zoho y con conceptos */
  const enBloque = useMemo(() => filas.filter((f) => f.estado === 'por_crear' && f.contactoId), [filas])

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
            lineas: lineasDelMes(f.fee, f.comision),
          },
        })
        hechos += 1
      } catch (e) {
        toast.error(`${f.nombre}: ${e instanceof Error ? e.message : 'error'}`)
      }
    }
    setCreando(false)
    if (hechos > 0) toast.success(`${hechos} ${hechos === 1 ? 'borrador creado' : 'borradores creados'} en Zoho`)
    await traer()
  }

  return (
    <div className={PANTALLA.cuerpo}>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className={TITULO.pantalla}>Facturación</h1>
        <div className="flex items-center gap-1">
          {PESTANAS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPestana(p.id)}
              className={`${BOTON.chip} ${pestana === p.id ? BOTON.chipEncendido : ''}`}
            >
              {p.nombre}
            </button>
          ))}
        </div>
      </div>

      {tablero && !tablero.zohoOk && (
        <Aviso tono="rojo" icono={AlertTriangle}>
          <span className="font-semibold">No se puede leer Zoho.</span> {tablero.errorZoho}
        </Aviso>
      )}
      {tablero?.faltaMigracion && (
        <Aviso tono="ambar" icono={AlertTriangle}>
          Falta lanzar la migración <span className="font-semibold">272</span>: sin ella no se guardan las parejas de clientes ni el registro.
        </Aviso>
      )}

      {pestana === 'facturar' && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex h-7 items-center rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
              <button type="button" aria-label="Mes anterior" onClick={() => setPeriod((p) => saltarMes(p, -1))} className={BOTON.icono}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <span className={`min-w-[120px] text-center ${TIPO.xs} ${TEXTO.t1}`}>{mesDelPeriodo(period)}</span>
              <button type="button" aria-label="Mes siguiente" onClick={() => setPeriod((p) => saltarMes(p, 1))} className={BOTON.icono}>
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className={CIFRAS.tira}>
              <span className={CIFRAS.celda}>
                <span className={`${CIFRAS.valor} ${cuentas.porCrear > 0 ? CIFRAS.urgente : ''}`}>{cuentas.porCrear}</span>
                <span className={CIFRAS.rotulo}>por crear</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cuentas.borradores}</span>
                <span className={CIFRAS.rotulo}>sin enviar</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cuentas.fuera}</span>
                <span className={CIFRAS.rotulo}>enviadas sin cobrar</span>
              </span>
              <span className={CIFRAS.celda}>
                <span className={CIFRAS.valor}>{cuentas.cobradas}</span>
                <span className={CIFRAS.rotulo}>cobradas</span>
              </span>
              {cuentas.sinFacturar > 0 && (
                <span className={CIFRAS.celda}>
                  <span className={CIFRAS.valor}>{dinero(cuentas.sinFacturar)}</span>
                  <span className={CIFRAS.rotulo}>sin facturar</span>
                </span>
              )}
            </div>

            <div className="ml-auto flex items-center gap-2">
              <button type="button" disabled={cargando} onClick={() => void traer()} className={`${BOTON.base} ${BOTON.secundario}`}>
                {cargando ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Actualizar
              </button>
              {enBloque.length > 0 && (
                <button type="button" disabled={creando} onClick={() => void crearTodos()} className={`${BOTON.base} ${BOTON.primario}`}>
                  {creando ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                  Crear {enBloque.length} {enBloque.length === 1 ? 'borrador' : 'borradores'}
                </button>
              )}
            </div>
          </div>

          {error && (
            <Aviso tono="rojo" icono={AlertTriangle}>
              {error}
            </Aviso>
          )}

          {!tablero && cargando ? (
            <div className={`flex items-center justify-center gap-2 py-16 ${TIPO.s} ${TEXTO.t3}`}>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Leyendo Tesorería y Zoho…
            </div>
          ) : (
            <div className={TABLA.caja}>
              <table className={TABLA.tabla}>
                <thead>
                  <tr>
                    <th className={TABLA.cabecera}>Cliente</th>
                    <th className={TABLA.cabecera}>Estado</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Fee</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Comisión</th>
                    <th className={`${TABLA.cabecera} ${TABLA.derecha}`}>Total</th>
                    <th className={TABLA.cabecera}>Factura</th>
                    <th className={TABLA.cabecera}>Vence</th>
                    <th className={TABLA.cabecera}>Avisos</th>
                    <th className={TABLA.cabecera} />
                  </tr>
                </thead>
                <tbody>
                  {filas.map((f) => (
                    <FilaCliente
                      key={f.treasuryClientId ?? f.contactoId ?? f.nombre}
                      fila={f}
                      contactos={tablero?.contactos ?? []}
                      onAbrir={() => setAbierta(f)}
                      onCobrar={(id) => {
                        setFacturaACobrar(id)
                        setPestana('cobros')
                      }}
                      onCambio={() => void traer()}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {pestana === 'cobros' && <PestanaCobros zohoOrgId={tablero?.zohoOrgId ?? null} facturaInicial={facturaACobrar} onCambio={() => void traer()} />}
      {pestana === 'plantillas' && <PestanaPlantillas />}
      {pestana === 'registro' && <PestanaRegistro />}

      {abierta && (
        <PanelFactura
          fila={abierta}
          period={period}
          contactos={tablero?.contactos ?? []}
          zohoOrgId={tablero?.zohoOrgId ?? null}
          onCerrar={() => setAbierta(null)}
          onCambio={() => void traer()}
          onCobrar={(id) => {
            setAbierta(null)
            setFacturaACobrar(id)
            setPestana('cobros')
          }}
        />
      )}
    </div>
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
  const estilo = ESTILO_ESTADO[fila.estado]
  const Icono = estilo.icono
  const apagada = fila.estado === 'sin_importes'
  const f = fila.factura
  const moneda = f?.moneda ?? 'EUR'
  const sinCliente = !fila.contactoId && fila.estado === 'por_crear'
  const vencida = f?.vence && fila.estado === 'vencida'

  return (
    <tr className={`${TABLA.fila} ${apagada ? 'opacity-55' : ''}`}>
      <td className={TABLA.celda}>
        <span className={`${TABLA.corta} max-w-[230px] ${TEXTO.t1}`} title={fila.nombre}>
          {fila.nombre}
        </span>
      </td>
      <td className={TABLA.celda}>
        <span className={ESTADO.linea}>
          <Icono className={ESTADO.icono} style={{ color: COLOR_ESTADO[estilo.tono] }} />
          <span className={ESTADO.palabra}>{ETIQUETA_ESTADO[fila.estado]}</span>
        </span>
      </td>
      <td className={`${TABLA.celda} ${TABLA.numero}`}>{fila.fee ? dinero(fila.fee) : '—'}</td>
      <td className={`${TABLA.celda} ${TABLA.numero}`}>{fila.comision ? dinero(fila.comision) : '—'}</td>
      <td className={`${TABLA.celda} ${TABLA.numero} ${TEXTO.t1}`}>{dinero(f?.total ?? (fila.totalTesoreria || null), moneda)}</td>
      <td className={TABLA.celda}>
        <span className={`${TABLA.corta} max-w-[220px]`} title={f?.numero}>
          {f?.numero ?? '—'}
          {fila.otrasFacturas > 0 ? ` (+${fila.otrasFacturas})` : ''}
        </span>
      </td>
      <td className={`${TABLA.celda} ${vencida ? TEXTO_ESTADO.rojo : ''}`}>{fechaCorta(f?.vence)}</td>
      <td className={TABLA.celda}>
        {fila.avisos.length > 0 && (
          <span className={`${TABLA.corta} max-w-[250px] ${TEXTO_ESTADO.ambar}`} title={fila.avisos.join(' · ')}>
            {fila.avisos.join(' · ')}
          </span>
        )}
      </td>
      <td className={`${TABLA.celda} ${TABLA.derecha}`}>
        {sinCliente && fila.treasuryClientId ? (
          <Enlazar treasuryClientId={fila.treasuryClientId} nombre={fila.nombre} contactos={contactos} onCambio={onCambio} />
        ) : fila.estado === 'por_crear' ? (
          <button type="button" onClick={onAbrir} className={`${BOTON.base} ${BOTON.secundario}`}>
            Crear factura
          </button>
        ) : fila.estado === 'borrador' ? (
          <button type="button" onClick={onAbrir} className={`${BOTON.base} ${BOTON.primario}`}>
            Revisar y enviar
          </button>
        ) : f ? (
          <span className="inline-flex items-center gap-1.5">
            {f.saldo > 0 && (
              <button type="button" onClick={() => onCobrar(f.id)} className={`${BOTON.base} ${BOTON.secundario}`}>
                Cobrar
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
