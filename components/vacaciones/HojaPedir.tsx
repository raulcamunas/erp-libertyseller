'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, CalendarPlus, Info, Palmtree, TriangleAlert, Users } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, CifraAnimada, Insignia, PanelLateral, mezcla } from '@/components/ui-ls'
import {
  checkVacationRequest,
  formatDayRange,
  formatDays,
  isDayKey,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'
import { choquesDeEmpresa, festivosDelLugar, textoDeChoque, type AusenciaDeEquipo } from '@/lib/vacations/calendario'
import type { Lugar } from '@/lib/festivos/tipos'
import { postVacations } from '@/lib/vacations/client'
import { cn } from '@/lib/utils'
import { numeroDeDias, type Seleccion } from './modelo'

/**
 * PEDIR DÍAS. Panel a la derecha en el PC y hoja inferior en el móvil (PanelLateral del kit).
 *
 * Todo lo que se enseña aquí sale de las MISMAS funciones que usa el servidor al guardar (checkVacationRequest y
 * choquesDeEmpresa, con los festivos del lugar de esa persona), así que lo que dice la hoja es lo que pasará:
 *   · los días laborables que cuesta y cómo queda el saldo, año a año;
 *   · si choca con algún compañero (regla de toda la empresa): AVISO, se puede pedir igual y decide dirección;
 *   · los avisos de siempre (fuera de plazo, se pasa del saldo, arrastre que caduca).
 */
export function HojaPedir({
  abierto,
  onCambio,
  seleccion,
  onSeleccion,
  persona,
  personasElegibles,
  onPersona,
  propio,
  peticiones,
  hoy,
  lugar,
  ausencias,
  maxALaVez,
  onHecho,
}: {
  abierto: boolean
  onCambio: (abierto: boolean) => void
  seleccion: Seleccion | null
  onSeleccion: (s: Seleccion | null) => void
  persona: VacationEmployee | null
  /** Solo admin: a quién se le pueden registrar días */
  personasElegibles: VacationEmployee[]
  onPersona: (id: string) => void
  propio: boolean
  /** Las peticiones de esa persona */
  peticiones: VacationRequest[]
  hoy: string
  lugar: Lugar | null
  ausencias: readonly AusenciaDeEquipo[]
  maxALaVez: number
  onHecho: () => void
}) {
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const festivos = useMemo(() => festivosDelLugar(lugar), [lugar])

  const check = useMemo(() => {
    if (!persona || !seleccion) return null
    return checkVacationRequest({ employee: persona, startDate: seleccion.start, endDate: seleccion.end, requests: peticiones, today: hoy, holidays: festivos, propio })
  }, [persona, seleccion, peticiones, hoy, festivos, propio])

  const choque = useMemo(() => {
    if (!persona || !seleccion) return null
    return choquesDeEmpresa({ employeeId: persona.id, startDate: seleccion.start, endDate: seleccion.end, ausencias, maxALaVez, festivos })
  }, [persona, seleccion, ausencias, maxALaVez, festivos])

  async function pedir() {
    if (!persona || !seleccion || !check?.ok) return
    setEnviando(true)
    const r = await postVacations('/api/vacations', {
      employee_id: propio ? undefined : persona.id,
      start_date: seleccion.start,
      end_date: seleccion.end,
      reason: motivo.trim() || undefined,
    })
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.error)
      return
    }
    toast.success(propio ? 'Días pedidos. Te avisamos en la campana cuando se resuelvan.' : `Días registrados para ${persona.name}`, {
      description: r.data.warnings?.length ? r.data.warnings.join(' · ') : undefined,
    })
    setMotivo('')
    onSeleccion(null)
    onCambio(false)
    onHecho()
  }

  const fijarFecha = (campo: 'start' | 'end', valor: string) => {
    if (!isDayKey(valor)) return
    const otra = seleccion ? seleccion[campo === 'start' ? 'end' : 'start'] : valor
    const a = campo === 'start' ? valor : otra
    const b = campo === 'start' ? otra : valor
    onSeleccion(a <= b ? { start: a, end: b } : { start: b, end: a })
  }

  const textoChoque = choque ? textoDeChoque(choque) : null

  return (
    <PanelLateral
      abierto={abierto}
      onCambio={onCambio}
      titulo={propio ? 'Pedir vacaciones' : 'Registrar vacaciones'}
      descripcion={seleccion ? formatDayRange(seleccion.start, seleccion.end) : 'Elige las fechas en el calendario o aquí abajo'}
      icono={Palmtree}
      acento="personas"
      pie={
        <>
          <Boton variante="secundario" onClick={() => onCambio(false)}>Cancelar</Boton>
          <Boton variante="primario" icono={CalendarPlus} cargando={enviando} disabled={!check?.ok || enviando} onClick={pedir}>
            {check?.ok ? `Pedir ${formatDays(check.workingDays)}` : 'Pedir'}
          </Boton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!propio && (
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-[var(--ls-t3)]">Para quién</span>
            <select
              value={persona?.id ?? ''}
              onChange={(e) => onPersona(e.target.value)}
              className="h-10 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
            >
              <option value="" disabled>Elige una persona</option>
              {personasElegibles.map((p) => (
                <option key={p.id} value={p.id}>{p.name}{p.user_id ? '' : ' (sin cuenta en el ERP)'}</option>
              ))}
            </select>
          </label>
        )}

        <div className="grid grid-cols-2 gap-2">
          {(['start', 'end'] as const).map((campo) => (
            <label key={campo} className="flex min-w-0 flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[var(--ls-t3)]">{campo === 'start' ? 'Primer día' : 'Último día'}</span>
              <input
                type="date"
                value={seleccion?.[campo] ?? ''}
                onChange={(e) => fijarFecha(campo, e.target.value)}
                className="h-10 min-w-0 rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-2.5 text-[14px] text-[var(--ls-t1)] outline-none [color-scheme:dark] focus:border-[var(--ls-acc-graf)] [html.light_&]:[color-scheme:light]"
              />
            </label>
          ))}
        </div>

        {check && persona && (
          <>
            {/* Lo que cuesta */}
            <div className="relative overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-4">
              <div aria-hidden className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full blur-2xl" style={{ background: mezcla('var(--ls-mod-personas)', 28) }} />
              <p className="text-[12px] font-medium text-[var(--ls-t3)]">Días de vacaciones que gastas</p>
              <p className="mt-1 text-[34px] font-semibold leading-none tracking-[-0.03em] text-[var(--ls-t1)] tabular-nums">
                <CifraAnimada valor={check.workingDays} formato={numeroDeDias} duracion={0.5} />
                <span className="ml-1.5 text-[14px] font-medium text-[var(--ls-t3)]">{check.workingDays === 1 ? 'día' : 'días'}</span>
              </p>
              <p className="mt-1 text-[12px] text-[var(--ls-t4)]">De lunes a viernes{festivos.length ? ', sin tus festivos' : ''}. Los fines de semana no cuentan.</p>

              {check.byYear.length > 0 && persona.vacation_days_per_month != null && (
                <div className="mt-3 flex flex-col gap-2 border-t border-[var(--ls-linea)] pt-3">
                  {check.byYear.map((y) => (
                    <div key={y.year} className="flex items-center justify-between gap-2 text-[13px]">
                      <span className="text-[var(--ls-t3)]">Saldo {y.year}</span>
                      <span className="flex items-center gap-2 tabular-nums">
                        <span className="text-[var(--ls-t2)]">{numeroDeDias(y.availableBefore)}</span>
                        <ArrowRight className="h-3.5 w-3.5 text-[var(--ls-t4)]" aria-hidden />
                        <span className={cn('font-semibold', y.availableAfter < 0 ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]')}>{numeroDeDias(y.availableAfter)}</span>
                      </span>
                    </div>
                  ))}
                  <p className="text-[11.5px] text-[var(--ls-t4)]">Medido el día en que los disfrutas: el devengo de los meses que faltan ya cuenta.</p>
                </div>
              )}
            </div>

            {/* Compañeros */}
            {choque && choque.coinciden.length > 0 ? (
              <div
                className="rounded-[14px] border p-3.5"
                style={{
                  borderColor: mezcla(choque.hay ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)', 40),
                  background: mezcla(choque.hay ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)', 8),
                }}
              >
                <p className="flex items-center gap-2 text-[13px] font-semibold" style={{ color: choque.hay ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)' }}>
                  <Users className="h-4 w-4" aria-hidden />
                  {choque.hay ? 'Coincide con un compañero' : 'Coincide, pero cabe'}
                </p>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {choque.coinciden.map((c) => (
                    <li key={`${c.employee_id}-${c.start_date}`} className="flex items-center gap-2 text-[12.5px] text-[var(--ls-t2)]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={c.status === 'aprobada' ? { background: c.color } : { boxShadow: `inset 0 0 0 1.5px ${c.color}` }} />
                      <span className="min-w-0 flex-1 truncate"><strong className="font-semibold text-[var(--ls-t1)]">{c.nombre}</strong> · {formatDayRange(c.start_date, c.end_date)}</span>
                      <Insignia tamano="sm" tono={c.status === 'aprobada' ? 'verde' : 'ambar'}>{c.status === 'aprobada' ? 'Aprobadas' : 'Pendientes'}</Insignia>
                    </li>
                  ))}
                </ul>
                {choque.hay && (
                  <p className="mt-2 text-[12px] leading-relaxed text-[var(--ls-t3)]">
                    {textoChoque} Puedes pedirlo igual: dirección lo verá y decidirá si lo autoriza como excepción.
                  </p>
                )}
              </div>
            ) : (
              <p className="flex items-center gap-2 rounded-[12px] border border-[var(--ls-linea)] px-3 py-2.5 text-[12.5px] text-[var(--ls-t3)]">
                <Users className="h-4 w-4 text-[var(--ls-e-verde)]" aria-hidden />
                Nadie más de la empresa está fuera esos días.
              </p>
            )}

            {check.errors.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {check.errors.map((e) => (
                  <li key={e} className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px]" style={{ background: mezcla('var(--ls-e-rojo)', 10), color: 'var(--ls-e-rojo)' }}>
                    <TriangleAlert className="mt-px h-4 w-4 shrink-0" aria-hidden />
                    {e}
                  </li>
                ))}
              </ul>
            )}
            {check.warnings.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {check.warnings.map((w) => (
                  <li key={w} className="flex items-start gap-2 rounded-[10px] px-3 py-2 text-[12.5px] leading-relaxed" style={{ background: mezcla('var(--ls-e-ambar)', 9), color: 'var(--ls-t2)' }}>
                    <Info className="mt-px h-4 w-4 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
                    {w}
                  </li>
                ))}
              </ul>
            )}

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium text-[var(--ls-t3)]">Motivo (opcional)</span>
              <textarea
                value={motivo}
                onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
                rows={2}
                placeholder="Viaje, boda, asuntos propios…"
                className="resize-none rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[14px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]"
              />
              <span className="text-[11.5px] text-[var(--ls-t4)]">Solo lo ve dirección. Tus compañeros ven que estás fuera, nunca por qué.</span>
            </label>
          </>
        )}

        {!persona && !propio && <p className="text-[13px] text-[var(--ls-t3)]">Elige primero para quién son los días.</p>}
      </div>
    </PanelLateral>
  )
}
