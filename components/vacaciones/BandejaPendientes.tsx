'use client'

import { useMemo, useState } from 'react'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import { ArrowRight, Check, Clock, ShieldAlert, Users, X } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, EstadoVacio, Insignia, haceCuanto, mezcla } from '@/components/ui-ls'
import type { VacationsServerData } from '@/lib/employees/vacations'
import { formatDayRange, formatDays, type VacationRequest } from '@/lib/types/vacations'
import {
  choquesDeEmpresa,
  colorDePersona,
  festivosDelLugar,
  saldoAntesDespues,
  type AusenciaDeEquipo,
} from '@/lib/vacations/calendario'
import { postVacations } from '@/lib/vacations/client'
import { cn } from '@/lib/utils'
import { AvatarDePersona } from './AvatarDePersona'
import { numeroDeDias } from './modelo'

/**
 * LA BANDEJA DEL ADMIN: las peticiones que esperan respuesta, con todo lo necesario para decidir sin salir de aquí.
 *   · el saldo de la persona antes y después (año a año, como lo calcula el servidor);
 *   · con quién choca (APROBADAS de otros: bloquean salvo excepción) y con quién coincide aún sin aprobar (informa);
 *   · Aprobar / Denegar en línea. Denegar pide el motivo; aprobar con choque pide el motivo de la excepción.
 */
export function BandejaPendientes({
  datos,
  ausencias,
  maxALaVez,
  onHecho,
}: {
  datos: VacationsServerData
  ausencias: readonly AusenciaDeEquipo[]
  maxALaVez: number
  onHecho: () => void
}) {
  const pendientes = useMemo(
    () => datos.requests.filter((r) => r.status === 'pendiente').sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id)),
    [datos.requests]
  )

  if (pendientes.length === 0) {
    return (
      <EstadoVacio
        icono={Check}
        acento="personas"
        titulo="No hay nada esperando"
        descripcion="Cuando alguien pida días te llegará un aviso a la campana y aparecerá aquí, con su saldo y con quién coincide."
      />
    )
  }

  return (
    <MotionConfig reducedMotion="user">
      <ul className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
          {pendientes.map((p, i) => (
            <motion.li
              key={p.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i, 10) * 0.04 } }}
              exit={{ opacity: 0, x: 40, transition: { duration: 0.2 } }}
            >
              <Peticion peticion={p} datos={datos} ausencias={ausencias} maxALaVez={maxALaVez} onHecho={onHecho} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </MotionConfig>
  )
}

function Peticion({
  peticion,
  datos,
  ausencias,
  maxALaVez,
  onHecho,
}: {
  peticion: VacationRequest
  datos: VacationsServerData
  ausencias: readonly AusenciaDeEquipo[]
  maxALaVez: number
  onHecho: () => void
}) {
  const [modo, setModo] = useState<null | 'denegar' | 'excepcion'>(null)
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)

  const empleado = datos.employees.find((e) => e.id === peticion.employee_id) ?? null
  const ficha = datos.fichas[peticion.employee_id]
  const color = ficha?.color ?? colorDePersona(peticion.employee_id)
  const festivos = useMemo(() => festivosDelLugar(ficha?.lugar ?? null), [ficha])

  const saldo = useMemo(
    () => (empleado ? saldoAntesDespues(empleado, datos.requests.filter((r) => r.employee_id === empleado.id), peticion, datos.today, festivos) : []),
    [empleado, datos.requests, datos.today, peticion, festivos]
  )
  // Bloquean las APROBADAS de otros; las pendientes de otros se enseñan pero no bloquean
  const bloquea = useMemo(
    () => choquesDeEmpresa({ employeeId: peticion.employee_id, startDate: peticion.start_date, endDate: peticion.end_date, ausencias, maxALaVez, excludeId: peticion.id, estados: ['aprobada'], festivos }),
    [peticion, ausencias, maxALaVez, festivos]
  )
  const todas = useMemo(
    () => choquesDeEmpresa({ employeeId: peticion.employee_id, startDate: peticion.start_date, endDate: peticion.end_date, ausencias, maxALaVez, excludeId: peticion.id, festivos }),
    [peticion, ausencias, maxALaVez, festivos]
  )

  const registradaPor = peticion.created_by && empleado?.user_id !== peticion.created_by ? datos.people[peticion.created_by] : null

  async function resolver(accion: 'aprobar' | 'denegar' | 'excepcion') {
    if ((accion === 'denegar' || accion === 'excepcion') && !motivo.trim()) {
      toast.error(accion === 'denegar' ? 'Escribe por qué se deniega: lo va a leer' : 'Escribe el motivo de la excepción')
      return
    }
    setEnviando(true)
    const r =
      accion === 'denegar'
        ? await postVacations(`/api/vacations/${peticion.id}/reject`, { reason: motivo.trim() })
        : await postVacations(`/api/vacations/${peticion.id}/approve`, accion === 'excepcion' ? { autorizarChoque: true, motivoChoque: motivo.trim() } : {})
    setEnviando(false)
    if (!r.ok) {
      toast.error(r.error)
      // El servidor ha visto un choque que la pantalla aún no tenía: se pide el motivo
      if (accion === 'aprobar' && /excepci/i.test(r.error)) setModo('excepcion')
      return
    }
    toast.success(r.data.message ?? 'Hecho')
    onHecho()
  }

  return (
    <article
      className="relative overflow-hidden rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] before:pointer-events-none before:absolute before:inset-0 before:bg-[image:var(--ls-velo)]"
      style={{ ['--color-persona' as string]: color }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: color }} />
      <div className="relative flex flex-col gap-4 p-4 pl-5 lg:flex-row lg:items-start">
        {/* Quién y cuándo */}
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <AvatarDePersona nombre={empleado?.name ?? 'Alguien'} color={color} tamano={40} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-[var(--ls-t1)]">{empleado?.name ?? 'Ficha borrada'}</h3>
              {peticion.late_notice && <Insignia tono="ambar" tamano="sm" icono={Clock}>Fuera de plazo</Insignia>}
              {bloquea.hay ? <Insignia tono="rojo" tamano="sm" icono={ShieldAlert}>Choca</Insignia> : todas.coinciden.length > 0 && <Insignia tono="ambar" tamano="sm" icono={Users}>Coincide</Insignia>}
            </div>
            <p className="mt-0.5 text-[14px] text-[var(--ls-t2)]">
              {formatDayRange(peticion.start_date, peticion.end_date)} · <strong className="font-semibold text-[var(--ls-t1)]">{formatDays(Number(peticion.working_days))}</strong>
            </p>
            <p className="mt-0.5 text-[12px] text-[var(--ls-t4)]">
              Pedida {haceCuanto(peticion.created_at)}
              {registradaPor ? ` · la registró ${registradaPor}` : ''}
            </p>
            {peticion.reason && <p className="mt-2 rounded-[10px] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] text-[var(--ls-t2)]">«{peticion.reason}»</p>}

            {todas.coinciden.length > 0 && (
              <ul className="mt-3 flex flex-col gap-1.5">
                {todas.coinciden.map((c) => {
                  const bloqueante = bloquea.coinciden.some((b) => b.employee_id === c.employee_id && b.start_date === c.start_date) && bloquea.hay
                  return (
                    <li key={`${c.employee_id}-${c.start_date}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-[var(--ls-t2)]">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={c.status === 'aprobada' ? { background: c.color } : { boxShadow: `inset 0 0 0 1.5px ${c.color}` }} />
                      <strong className="font-semibold text-[var(--ls-t1)]">{c.nombre}</strong>
                      <span>{formatDayRange(c.start_date, c.end_date)}</span>
                      <span className="text-[var(--ls-t4)]">· {c.dias.length} {c.dias.length === 1 ? 'día' : 'días'} en común</span>
                      <Insignia tamano="sm" tono={c.status === 'aprobada' ? (bloqueante ? 'rojo' : 'verde') : 'ambar'}>
                        {c.status === 'aprobada' ? (c.autorizado ? 'Aprobadas (excepción)' : 'Aprobadas') : 'Pendientes'}
                      </Insignia>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Saldo antes / después */}
        <div className="flex shrink-0 flex-col gap-1.5 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3.5 py-3 lg:w-[220px]">
          <span className="text-[11.5px] font-medium uppercase tracking-wider text-[var(--ls-t4)]">Saldo</span>
          {empleado?.vacation_days_per_month == null ? (
            <span className="text-[12.5px] text-[var(--ls-t3)]">Sin tarifa de vacaciones</span>
          ) : (
            saldo.map((s) => (
              <span key={s.anio} className="flex items-center justify-between gap-2 text-[13px] tabular-nums">
                <span className="text-[var(--ls-t3)]">{s.anio}</span>
                <span className="flex items-center gap-1.5">
                  <span className="text-[var(--ls-t2)]">{numeroDeDias(s.antes)}</span>
                  <ArrowRight className="h-3 w-3 text-[var(--ls-t4)]" aria-hidden />
                  <span className={cn('font-semibold', s.despues < 0 ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]')}>{numeroDeDias(s.despues)}</span>
                </span>
              </span>
            ))
          )}
        </div>
      </div>

      {/* Acciones */}
      <div className="relative border-t border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-4 py-3 pl-5">
        <AnimatePresence initial={false} mode="wait">
          {modo ? (
            <motion.div key="motivo" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="flex flex-col gap-2 overflow-hidden">
              <label className="text-[12.5px] font-medium text-[var(--ls-t2)]" htmlFor={`motivo-${peticion.id}`}>
                {modo === 'denegar' ? 'Por qué se deniega (lo leerá en su campana)' : `Motivo de la excepción: ${maxALaVez === 1 ? 'no pueden irse dos a la vez' : `máximo ${maxALaVez} a la vez`}`}
              </label>
              <textarea
                id={`motivo-${peticion.id}`}
                autoFocus
                rows={2}
                value={motivo}
                onChange={(e) => setMotivo(e.target.value.slice(0, 500))}
                className="resize-none rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-3 py-2 text-[14px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)]"
                placeholder={modo === 'denegar' ? 'Cierre de trimestre, ya hay otra persona fuera…' : 'Cubre la tarea X, son medios días…'}
              />
              <div className="flex flex-wrap justify-end gap-2">
                <Boton variante="fantasma" onClick={() => { setModo(null); setMotivo('') }}>Volver</Boton>
                {modo === 'denegar' ? (
                  <Boton variante="peligro" icono={X} cargando={enviando} disabled={!motivo.trim()} onClick={() => resolver('denegar')}>Denegar</Boton>
                ) : (
                  <Boton variante="primario" icono={ShieldAlert} cargando={enviando} disabled={!motivo.trim()} onClick={() => resolver('excepcion')}>Autorizar excepción</Boton>
                )}
              </div>
            </motion.div>
          ) : (
            <motion.div key="botones" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-wrap items-center justify-end gap-2">
              {bloquea.hay && (
                <p className="mr-auto text-[12px] leading-snug" style={{ color: 'var(--ls-e-rojo)' }}>
                  Choca {bloquea.diasLlenos.length} {bloquea.diasLlenos.length === 1 ? 'día' : 'días'} con vacaciones aprobadas
                </p>
              )}
              <Boton variante="secundario" icono={X} onClick={() => setModo('denegar')}>Denegar</Boton>
              {bloquea.hay ? (
                <Boton variante="primario" icono={ShieldAlert} onClick={() => setModo('excepcion')}>Aprobar como excepción</Boton>
              ) : (
                <Boton variante="primario" icono={Check} cargando={enviando} onClick={() => resolver('aprobar')}>Aprobar</Boton>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <span aria-hidden className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full blur-2xl" style={{ background: mezcla(color, 14) }} />
    </article>
  )
}
