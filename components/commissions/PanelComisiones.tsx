'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Calculator, ChevronLeft, ChevronRight, FileUp, Loader2, Lock } from 'lucide-react'
import { MESES, mesDelInforme, mesEnLetra, type MiembroDeGrupo, type ResumenDeCliente, type ResumenDelMes, type SituacionDelCliente } from '@/lib/comisiones-puente/tipos'
import { PantallaLiquidacion, mesPorDefecto } from './PantallaLiquidacion'
import { CommissionsCalculator } from './CommissionsCalculator'

type ClienteDeCalculadora = React.ComponentProps<typeof CommissionsCalculator>['clients'][number]

const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const euros = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : EUROS.format(n))

const SITUACION: Record<SituacionDelCliente, { texto: string; punto: string; ayuda: string }> = {
  sin_regla: { texto: 'Sin regla de cálculo', punto: 'bg-sky-400', ayuda: 'Cliente de Tesorería: todavía no hay regla para calcularle la comisión aquí' },
  listo: { texto: 'Listo para calcular', punto: 'bg-emerald-400', ayuda: 'El informe del mes anterior está en Tax Reports' },
  falta_anterior: {
    texto: 'Falta el año anterior',
    punto: 'bg-yellow-400',
    ayuda: 'Compara dos años: el del año pasado se sube a mano al calcular',
  },
  sin_informe: { texto: 'Sin informe', punto: 'bg-red-400', ayuda: 'Nadie ha subido a Tax Reports el informe del mes anterior, que es el que sirve para calcular esta comisión' },
  purgado: { texto: 'Informe retirado', punto: 'bg-red-400', ayuda: 'Se retiró a los seis meses: hay que volver a subirlo' },
  sin_tax_reports: { texto: 'Sin Tax Reports', punto: 'bg-white/25', ayuda: 'Este cliente no está dado de alta en Tax Reports' },
}

/** Cómo se calcula cada cliente, en una frase corta para la cabecera del detalle */
function regla(c: ResumenDeCliente): string {
  const trozos: string[] = []
  if (c.miembros) trozos.push(`suma de ${c.miembros.map((m) => m.etiqueta).join(' + ')}`)
  if (c.tasaBase != null) trozos.push(`tasa base ${+(c.tasaBase * 100).toFixed(2)} %`)
  if (c.perfil.porMarca) trozos.push('parte por marca')
  if (c.perfil.dosFicheros) trozos.push('compara dos años')
  if (c.perfil.pideTramoBeneficio) trozos.push('15 % o 35 % del beneficio')
  if (c.perfil.admiteTasaManual) trozos.push('admite tasa manual')
  return trozos.join(' · ')
}

/** Un cliente que solo está en Tesorería: se enseña lo que tiene apuntado; todavía no hay regla para calcularle la comisión desde Tax Reports */
function DetalleSoloTesoreria({ cliente, anio, mes }: { cliente: ResumenDeCliente; anio: number; mes: number }) {
  const meses = cliente.soloTesoreria?.ultimosMeses ?? []
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.02]">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-sky-400" />
        <h3 className="text-[13px] font-semibold text-white">Sin regla de cálculo todavía</h3>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-[12.5px] text-white/60 leading-relaxed">
          {cliente.nombre} está en Tesorería pero aún no se le calcula la comisión desde aquí. Cuando se defina su regla (de qué informe sale y cómo se calcula), se configurará en este panel y se calculará con el informe de Tax Reports. Mientras tanto, el fee y la comisión se siguen apuntando a mano en Tesorería.
        </p>
        <div className="grid grid-cols-3 gap-2">
          {[
            ['Fee', cliente.fee],
            ['Comisión', cliente.comision],
          ].map(([rotulo, valor]) => (
            <div key={String(rotulo)} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
              <p className="text-[10px] uppercase tracking-wider text-white/40">{rotulo} · {mesEnLetra(anio, mes)}</p>
              <p className="text-[18px] font-bold text-white tabular-nums">{euros(valor as number | null)}</p>
            </div>
          ))}
          <div className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2">
            <p className="text-[10px] uppercase tracking-wider text-white/40">Factura</p>
            <p className="text-[14px] font-medium text-white/80 flex items-center gap-1.5 mt-1.5">
              {cliente.facturado ? <><Lock className="h-3.5 w-3.5" /> Facturada</> : 'Sin facturar'}
            </p>
          </div>
        </div>
        {meses.length > 0 && (
          <div>
            <p className="mb-1.5 text-[10px] uppercase tracking-wider text-white/40">Meses anteriores en Tesorería</p>
            <ul className="divide-y divide-white/[0.05] rounded-xl border border-white/10">
              {meses.map((m) => (
                <li key={m.period} className="flex items-center justify-between px-3 py-1.5 text-[12.5px]">
                  <span className="text-white/60 capitalize">{mesEnLetra(Number(m.period.slice(0, 4)), Number(m.period.slice(5, 7)))}</span>
                  <span className="tabular-nums text-white/80">fee {euros(m.fee)} · comisión {euros(m.commission)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * UN CLIENTE AGRUPADO (Ham Master = TapasParty + PokerShop): cada cuenta se calcula con su informe y la principal guarda en Tesorería
 * la SUMA. Las cuentas secundarias solo calculan y avisan de su importe; la principal, que es la emparejada, valida el total.
 */
function DetalleDeGrupo({ cliente, anio, mes, onCambio }: { cliente: ResumenDeCliente; anio: number; mes: number; onCambio: () => void }) {
  const miembros = cliente.miembros as MiembroDeGrupo[]
  const [principal, ...otros] = miembros
  const [importes, setImportes] = useState<Record<string, number | null>>({})
  const avisar = useCallback((id: string, importe: number | null) => {
    setImportes((prev) => (prev[id] === importe ? prev : { ...prev, [id]: importe }))
  }, [])

  return (
    <div className="flex flex-col gap-4">
      {otros.map((m) => (
        <div key={m.id}>
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">Cuenta {m.etiqueta}</h3>
          <PantallaLiquidacion
            clienteId={m.id}
            anio={anio}
            mes={mes}
            cuentaDeGrupo={{ onImporte: (importe) => avisar(m.id, importe) }}
          />
        </div>
      ))}
      <div>
        <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-white/50">
          Cuenta {principal.etiqueta} · guarda la suma en Tesorería
        </h3>
        <PantallaLiquidacion
          clienteId={principal.id}
          anio={anio}
          mes={mes}
          onCambio={onCambio}
          grupo={{ nombre: cliente.nombre, otras: otros.map((m) => ({ etiqueta: m.etiqueta, importe: importes[m.id] ?? null })) }}
        />
      </div>
    </div>
  )
}

/**
 * EL PANEL DE COMISIONES.
 * A la izquierda, los clientes con lo que llevan de comisión en el mes elegido y en qué punto está cada uno (informe subido, falta el
 * del año pasado…). A la derecha, el detalle del cliente elegido: la pantalla de Liquidación de siempre (calcular, MIRAR el número,
 * validar y escribirlo en Tesorería). El cálculo sigue siendo `/api/commissions/process`: aquí no se calcula nada.
 * Y «Subir CSV a mano» conserva la calculadora de antes para cuando el informe viene de fuera de Tax Reports.
 */
export function PanelComisiones({ clientesCalculadora }: { clientesCalculadora: ClienteDeCalculadora[] }) {
  const inicial = useMemo(mesPorDefecto, [])
  const [anio, setAnio] = useState(inicial.anio)
  const [mes, setMes] = useState(inicial.mes)
  const [vista, setVista] = useState<'liquidacion' | 'manual'>('liquidacion')
  const [clienteId, setClienteId] = useState('')
  const [resumen, setResumen] = useState<ResumenDelMes | null>(null)
  const [cargando, setCargando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viva = useRef({ anio, mes })
  viva.current = { anio, mes }

  const cargarResumen = useCallback(async () => {
    const mio = { anio, mes }
    setCargando(true)
    setError(null)
    try {
      const res = await fetch(`/api/comisiones-puente/resumen?anio=${anio}&mes=${mes}`, { cache: 'no-store' })
      const payload = (await res.json().catch(() => null)) as (ResumenDelMes & { error?: string }) | null
      // Una respuesta lenta de otro mes no se pinta encima del que hay elegido ahora
      if (viva.current.anio !== mio.anio || viva.current.mes !== mio.mes) return
      if (!res.ok || !payload) {
        setResumen(null)
        setError(payload?.error ?? 'No se ha podido leer el resumen del mes.')
        return
      }
      setResumen(payload)
    } catch {
      if (viva.current.anio === mio.anio && viva.current.mes === mio.mes) {
        setResumen(null)
        setError('No hay conexión con el servidor. Inténtalo otra vez.')
      }
    } finally {
      if (viva.current.anio === mio.anio && viva.current.mes === mio.mes) setCargando(false)
    }
  }, [anio, mes])

  useEffect(() => {
    void cargarResumen()
  }, [cargarResumen])

  function moverMes(delta: number) {
    const total = anio * 12 + (mes - 1) + delta
    setAnio(Math.floor(total / 12))
    setMes((total % 12) + 1)
  }

  const elegido = resumen?.clientes.find((c) => c.id === clienteId) ?? null
  const conComision = resumen?.clientes.filter((c) => c.comision != null).length ?? 0

  return (
    <div className="flex flex-col gap-3 min-w-0">
      {/* Cabecera: mes, total y qué vista */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-1.5 py-1">
          <button type="button" onClick={() => moverMes(-1)} className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06]">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[14px] font-semibold text-white px-2 min-w-[150px] text-center flex items-center justify-center gap-1.5">
            <CalendarDays className="h-3.5 w-3.5 text-[#FF6600]" />
            {MESES[mes - 1]} {anio}
          </span>
          <button type="button" onClick={() => moverMes(1)} className="h-7 w-7 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06]">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center rounded-full border border-white/10 bg-white/[0.03] p-0.5">
          {([
            ['liquidacion', 'Liquidación del mes', Calculator],
            ['manual', 'Subir CSV a mano', FileUp],
          ] as const).map(([id, texto, Icono]) => (
            <button
              key={id}
              type="button"
              onClick={() => setVista(id)}
              className={`h-8 px-3.5 rounded-full text-[12px] font-medium flex items-center gap-1.5 transition-colors ${
                vista === id ? 'bg-[#FF6600] text-white' : 'text-white/55 hover:text-white'
              }`}
            >
              <Icono className="h-3.5 w-3.5" />
              {texto}
            </button>
          ))}
        </div>
      </div>

      {vista === 'manual' ? (
        <CommissionsCalculator clients={clientesCalculadora} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-3 items-start">
          {/* ---------- Barra de clientes ---------- */}
          <aside className="rounded-2xl border border-white/10 bg-white/[0.02] overflow-hidden lg:sticky lg:top-2">
            <div className="px-4 py-3 border-b border-white/[0.06] bg-gradient-to-br from-[#FF6600]/[0.10] to-transparent">
              <p className="text-[10px] uppercase tracking-wider text-white/45">Comisión de {MESES[mes - 1].toLowerCase()}</p>
              <p className="text-[26px] leading-tight font-bold text-[#FF8A3D] tabular-nums">{euros(resumen?.totalComision ?? 0)}</p>
              <p className="text-[11px] text-white/40">
                {resumen ? `${conComision} de ${resumen.clientes.length} clientes con comisión apuntada` : 'Cargando…'}
              </p>
            </div>

            {error && (
              <p className="px-4 py-3 text-[12px] text-red-300 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" /> {error}
              </p>
            )}
            {resumen?.faltaMigracion && (
              <p className="px-4 py-2.5 text-[11px] text-yellow-300/90 border-b border-white/[0.06]">
                Falta lanzar <code>{resumen.faltaMigracion === '200' ? '200_tax_reports.sql' : '201_puente_comision_tesoreria.sql'}</code> en el editor SQL de Supabase: hasta entonces no hay emparejado con Tesorería.
              </p>
            )}

            <ul className="divide-y divide-white/[0.05] max-h-[calc(100vh-18rem)] overflow-y-auto">
              {cargando && !resumen && (
                <li className="px-4 py-6 flex justify-center">
                  <Loader2 className="h-4 w-4 animate-spin text-white/40" />
                </li>
              )}
              {resumen?.clientes.map((c, i) => {
                const sit = SITUACION[c.situacion]
                const primeroDeTesoreria = Boolean(c.soloTesoreria) && !resumen.clientes[i - 1]?.soloTesoreria
                const activo = c.id === clienteId
                return (
                  <Fragment key={c.id}>
                  {primeroDeTesoreria && (
                    <li className="px-4 py-2 bg-white/[0.03] text-[10px] uppercase tracking-wider text-white/40">
                      Otros clientes de Tesorería · sin regla de cálculo todavía
                    </li>
                  )}
                  <li>
                    <button
                      type="button"
                      onClick={() => setClienteId(c.id)}
                      className={`w-full text-left px-4 py-2.5 flex items-center gap-3 transition-colors ${
                        activo ? 'bg-[#FF6600]/[0.12] shadow-[inset_3px_0_0_#FF6600]' : 'hover:bg-white/[0.035]'
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5 text-[13px] font-medium text-white truncate">
                          {c.nombre}
                          {c.facturado && <Lock className="h-3 w-3 text-white/35 flex-shrink-0" aria-label="Ya facturada" />}
                        </span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-white/40" title={sit.ayuda}>
                          <span className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${sit.punto}`} />
                          <span className="truncate">{sit.texto}</span>
                        </span>
                      </span>
                      <span className="text-right flex-shrink-0">
                        <span className={`block text-[13px] tabular-nums font-semibold ${c.comision != null ? 'text-white' : 'text-white/20'}`}>
                          {c.comision != null ? euros(c.comision) : '—'}
                        </span>
                        {c.comision != null && c.origenComision === 'informe_guardado' && (
                          <span className="block text-[9.5px] text-white/35" title="Sale del último informe guardado en la calculadora, aún no está en Tesorería">
                            sin pasar a Tesorería
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                  </Fragment>
                )
              })}
            </ul>
          </aside>

          {/* ---------- Detalle ---------- */}
          <section className="min-w-0">
            {!elegido ? (
              <div className="rounded-2xl border border-dashed border-white/10 px-6 py-14 text-center">
                <p className="text-[15px] font-medium text-white/80">Elige un cliente de la izquierda</p>
                <p className="mt-1 text-[12px] text-white/40 max-w-md mx-auto">
                  Verás su informe de {mesEnLetra(mesDelInforme(anio, mes).anio, mesDelInforme(anio, mes).mes)} en Tax Reports (el que sirve para la comisión de {mesEnLetra(anio, mes)}), la calcularás con la regla de ese cliente y, al validarla, se escribe en Tesorería en {MESES[mes - 1].toLowerCase()}.
                </p>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl border border-white/10 bg-white/[0.025] px-5 py-4 flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-[20px] font-bold text-white truncate">{elegido.nombre}</h2>
                    <p className="text-[12px] text-white/45">{regla(elegido) || 'Cálculo estándar'}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase tracking-wider text-white/40">Comisión de {MESES[mes - 1].toLowerCase()}</p>
                    <p className="text-[24px] leading-tight font-bold text-white tabular-nums">{euros(elegido.comision)}</p>
                    {elegido.fee != null && <p className="text-[11px] text-white/40">Fee {euros(elegido.fee)}</p>}
                  </div>
                </div>
                {elegido.soloTesoreria ? (
                  <DetalleSoloTesoreria cliente={elegido} anio={anio} mes={mes} />
                ) : elegido.miembros ? (
                  <DetalleDeGrupo key={`${elegido.id}-${anio}-${mes}`} cliente={elegido} anio={anio} mes={mes} onCambio={() => void cargarResumen()} />
                ) : (
                  <PantallaLiquidacion clienteId={elegido.id} anio={anio} mes={mes} onCambio={() => void cargarResumen()} />
                )}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
