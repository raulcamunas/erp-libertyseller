'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, CalendarDays, Calculator, ChevronLeft, ChevronRight, FileUp, Loader2, Lock } from 'lucide-react'
import { MESES, mesEnLetra, type ResumenDeCliente, type ResumenDelMes, type SituacionDelCliente } from '@/lib/comisiones-puente/tipos'
import { PantallaLiquidacion, mesPorDefecto } from './PantallaLiquidacion'
import { CommissionsCalculator } from './CommissionsCalculator'

type ClienteDeCalculadora = React.ComponentProps<typeof CommissionsCalculator>['clients'][number]

const EUROS = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' })
const euros = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : EUROS.format(n))

const SITUACION: Record<SituacionDelCliente, { texto: string; punto: string; ayuda: string }> = {
  listo: { texto: 'Listo para calcular', punto: 'bg-emerald-400', ayuda: 'El informe del mes está en Tax Reports' },
  falta_anterior: {
    texto: 'Falta el año anterior',
    punto: 'bg-yellow-400',
    ayuda: 'Compara dos años: el del año pasado se sube a mano al calcular',
  },
  sin_informe: { texto: 'Sin informe', punto: 'bg-red-400', ayuda: 'Nadie ha subido el informe de ese mes a Tax Reports' },
  purgado: { texto: 'Informe retirado', punto: 'bg-red-400', ayuda: 'Se retiró a los seis meses: hay que volver a subirlo' },
  sin_tax_reports: { texto: 'Sin Tax Reports', punto: 'bg-white/25', ayuda: 'Este cliente no está dado de alta en Tax Reports' },
}

/** Cómo se calcula cada cliente, en una frase corta para la cabecera del detalle */
function regla(c: ResumenDeCliente): string {
  const trozos: string[] = []
  if (c.tasaBase != null) trozos.push(`tasa base ${+(c.tasaBase * 100).toFixed(2)} %`)
  if (c.perfil.porMarca) trozos.push('parte por marca')
  if (c.perfil.dosFicheros) trozos.push('compara dos años')
  if (c.perfil.pideTramoBeneficio) trozos.push('15 % o 35 % del beneficio')
  if (c.perfil.admiteTasaManual) trozos.push('admite tasa manual')
  return trozos.join(' · ')
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
              {resumen?.clientes.map((c) => {
                const sit = SITUACION[c.situacion]
                const activo = c.id === clienteId
                return (
                  <li key={c.id}>
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
                  Verás su informe de {mesEnLetra(anio, mes)} en Tax Reports, calcularás su comisión con la regla de ese cliente y, al validarla, se escribe en Tesorería.
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
                <PantallaLiquidacion clienteId={elegido.id} anio={anio} mes={mes} onCambio={() => void cargarResumen()} />
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
