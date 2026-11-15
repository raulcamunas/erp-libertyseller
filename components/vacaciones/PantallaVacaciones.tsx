'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, MotionConfig } from 'framer-motion'
import {
  AlarmClock,
  CalendarDays,
  CalendarPlus,
  CalendarRange,
  Clock,
  Flag,
  Hourglass,
  Inbox,
  ListChecks,
  Palmtree,
  PlaneTakeoff,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from 'lucide-react'
import {
  Boton,
  CabeceraDeModulo,
  EstadoVacio,
  FilaDeKpis,
  Insignia,
  Kpi,
  PanelDePestana,
  Pestanas,
  Segmentado,
  Tarjeta,
  mezcla,
} from '@/components/ui-ls'
import { monthKeyOf } from '@/lib/types/employees'
import {
  addDays,
  formatDayLong,
  formatDayRange,
  formatDays,
  NOTICE_DAYS,
  vacationBalance,
  weekdayIndex,
  type VacationBalance,
  type VacationEmployee,
} from '@/lib/types/vacations'
import {
  choquesDeEmpresa,
  diasLaborables,
  festivosDelLugar,
  festivosParaPintar,
  ocupacionPorDia,
  rangoDelAnio,
  type AusenciaDeEquipo,
} from '@/lib/vacations/calendario'
import type { VacationsServerData } from '@/lib/employees/vacations'
import { cn } from '@/lib/utils'
import { AvatarDePersona } from './AvatarDePersona'
import { BandejaPendientes } from './BandejaPendientes'
import { CalendarioEmpresa } from './CalendarioEmpresa'
import { EquipoYAjustes } from './EquipoYAjustes'
import { HojaPedir } from './HojaPedir'
import { ListaSolicitudes } from './ListaSolicitudes'
import { VistaAnual } from './VistaAnual'
import { numeroDeDias, type DatosDePantalla, type EquipoDelAnio, type Seleccion } from './modelo'

type Pestana = 'calendario' | 'solicitudes' | 'pendientes' | 'equipo'

/** Cada cuánto se vuelve a leer con la pestaña a la vista. Sin tiempo real a propósito (protección de carga de la base) */
const REFRESCO_MS = 60_000

/**
 * VACACIONES — LA PANTALLA ÚNICA, para el empleado y para el admin.
 * ================================================================
 *   · Calendario del mes (o del año) con quién está fuera cada día en TODA la empresa, los festivos y, en rayado, los
 *     días con el cupo lleno. Se elige un rango arrastrando o con dos toques y se pide en una hoja (inferior en el móvil).
 *   · Mis solicitudes (o todas, si es admin) con su estado, y retirar/anular con motivo.
 *   · Admin: la bandeja «Pendientes» con Aprobar/Denegar en línea, el choque a la vista y el saldo antes/después; y
 *     «Equipo» con los saldos y los ajustes (máximo a la vez, color y festivos de cada persona).
 * Se relee al volver a la pestaña y cada minuto mientras está a la vista.
 */
export function PantallaVacaciones({ inicial }: { inicial: DatosDePantalla }) {
  const { esAdmin, userId } = inicial
  const [datos, setDatos] = useState<VacationsServerData>(inicial.datos)
  const [yo, setYo] = useState<VacationEmployee | null>(inicial.yo)
  const [saldoServidor, setSaldoServidor] = useState<VacationBalance | null>(inicial.saldo)
  const [equipos, setEquipos] = useState<Record<number, EquipoDelAnio>>({ [inicial.anio]: inicial.equipo })
  const hoy = datos.today

  const [mes, setMes] = useState(() => monthKeyOf(hoy))
  const [vista, setVista] = useState<'mes' | 'anio'>('mes')
  const anioVisto = Number(mes.slice(0, 4))

  const pendientesCount = useMemo(() => datos.requests.filter((r) => r.status === 'pendiente').length, [datos.requests])
  const [pestana, setPestana] = useState<Pestana>(esAdmin && pendientesCount > 0 ? 'pendientes' : 'calendario')

  const [seleccion, setSeleccion] = useState<Seleccion | null>(null)
  const [hoja, setHoja] = useState(false)
  const [personaId, setPersonaId] = useState<string>(inicial.yo?.id ?? '')
  const [diaEnfocado, setDiaEnfocado] = useState<string>(hoy)

  /* ---------------- datos: carga y refresco ---------------- */

  const cargandoAnios = useRef(new Set<number>())
  const cargarEquipo = useCallback(async (anio: number) => {
    if (cargandoAnios.current.has(anio)) return
    cargandoAnios.current.add(anio)
    try {
      const { desde, hasta } = rangoDelAnio(anio)
      const res = await fetch(`/api/vacations/equipo?desde=${desde}&hasta=${hasta}`, { cache: 'no-store' })
      if (res.ok) {
        const e = (await res.json()) as EquipoDelAnio
        setEquipos((prev) => ({ ...prev, [anio]: e }))
      }
    } catch {
      /* sin conexión: se queda lo que había */
    } finally {
      cargandoAnios.current.delete(anio)
    }
  }, [])

  const aniosNecesarios = useMemo(() => {
    const s = new Set<number>([anioVisto])
    if (seleccion) {
      s.add(Number(seleccion.start.slice(0, 4)))
      s.add(Number(seleccion.end.slice(0, 4)))
    }
    return [...s]
  }, [anioVisto, seleccion])

  useEffect(() => {
    for (const a of aniosNecesarios) if (!equipos[a]) void cargarEquipo(a)
  }, [aniosNecesarios, equipos, cargarEquipo])

  const refrescar = useCallback(async () => {
    try {
      const res = await fetch('/api/vacations', { cache: 'no-store' })
      if (res.ok) {
        const d = (await res.json()) as VacationsServerData & { employee?: VacationEmployee | null; balance?: VacationBalance | null }
        setDatos(d)
        if (!esAdmin) {
          setYo(d.employee ?? null)
          setSaldoServidor(d.balance ?? null)
        }
      }
    } catch {
      /* sin conexión */
    }
    await Promise.all(aniosNecesarios.map((a) => cargarEquipo(a)))
  }, [esAdmin, aniosNecesarios, cargarEquipo])

  useEffect(() => {
    const alVolver = () => {
      if (document.visibilityState === 'visible') void refrescar()
    }
    document.addEventListener('visibilitychange', alVolver)
    const t = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refrescar()
    }, REFRESCO_MS)
    return () => {
      document.removeEventListener('visibilitychange', alVolver)
      window.clearInterval(t)
    }
  }, [refrescar])

  /* ---------------- derivados ---------------- */

  // Un admin con ficha propia (raro) también se ve a sí mismo
  const miFicha = useMemo(() => yo ?? datos.employees.find((e) => e.user_id === userId) ?? null, [yo, datos.employees, userId])
  const saldo = useMemo(() => {
    if (!miFicha || miFicha.vacation_days_per_month == null) return null
    if (saldoServidor && !esAdmin) return saldoServidor
    return vacationBalance(miFicha, datos.requests, hoy, { holidays: festivosDelLugar(datos.fichas[miFicha.id]?.lugar ?? null) })
  }, [miFicha, saldoServidor, esAdmin, datos, hoy])

  const ausencias: AusenciaDeEquipo[] = useMemo(() => {
    const vistas = new Map<string, AusenciaDeEquipo>()
    for (const e of Object.values(equipos)) for (const a of e.ausencias) vistas.set(a.id, a)
    return [...vistas.values()]
  }, [equipos])
  const maxALaVez = equipos[anioVisto]?.maxALaVez ?? datos.maxALaVez

  // A quién se le piden los días: a uno mismo, o (admin) a quien elija
  const elegibles = useMemo(() => datos.employees.filter((e) => e.vacation_days_per_month != null && (e.is_active || e.id === personaId)), [datos.employees, personaId])
  const persona: VacationEmployee | null = useMemo(() => {
    if (esAdmin) return datos.employees.find((e) => e.id === personaId) ?? null
    return miFicha
  }, [esAdmin, datos.employees, personaId, miFicha])
  const propio = !!persona && persona.user_id === userId
  const puedeElegir = esAdmin ? elegibles.length > 0 : !!miFicha && miFicha.vacation_days_per_month != null

  const lugarDeQuienMira = miFicha ? datos.fichas[miFicha.id]?.lugar ?? null : null
  const lugarDePersona = persona ? datos.fichas[persona.id]?.lugar ?? null : null
  const rangoVisto = vista === 'mes' ? { desde: mes, hasta: addDays(addMonths1(mes), -1) } : rangoDelAnio(anioVisto)
  const festivosVisibles = useMemo(() => festivosParaPintar(lugarDeQuienMira, rangoVisto.desde, rangoVisto.hasta), [lugarDeQuienMira, rangoVisto.desde, rangoVisto.hasta])
  const yoParaCupo = persona?.id ?? miFicha?.id ?? null
  const ocupacion = useMemo(() => ocupacionPorDia(ausencias, rangoVisto.desde, rangoVisto.hasta, { yo: yoParaCupo, maxALaVez }), [ausencias, rangoVisto.desde, rangoVisto.hasta, yoParaCupo, maxALaVez])

  const choqueSel = useMemo(() => {
    if (!seleccion || !persona) return null
    return choquesDeEmpresa({ employeeId: persona.id, startDate: seleccion.start, endDate: seleccion.end, ausencias, maxALaVez, festivos: festivosDelLugar(lugarDePersona) })
  }, [seleccion, persona, ausencias, maxALaVez, lugarDePersona])
  const diasEnChoque = useMemo(() => new Set(choqueSel?.diasLlenos ?? []), [choqueSel])
  const diasSel = seleccion ? diasLaborables(seleccion.start, seleccion.end, lugarDePersona) : 0

  // Quién está fuera hoy / esta semana / los próximos 30 días
  const resumen = useMemo(() => {
    const lunes = addDays(hoy, -weekdayIndex(hoy))
    const viernes = addDays(lunes, 4)
    const en30 = addDays(hoy, 30)
    const vivas = ausencias.filter((a) => a.end_date >= hoy)
    const personasEn = (desde: string, hasta: string) => new Set(vivas.filter((a) => a.start_date <= hasta && a.end_date >= desde).map((a) => a.employee_id)).size
    const proximas = vivas.filter((a) => a.start_date <= en30).sort((a, b) => a.start_date.localeCompare(b.start_date)).slice(0, 6)
    return { hoy: personasEn(hoy, hoy), semana: personasEn(lunes, viernes), mes: personasEn(hoy, en30), proximas }
  }, [ausencias, hoy])

  const abrirHoja = () => {
    if (esAdmin && !persona && elegibles.length === 1) setPersonaId(elegibles[0].id)
    setHoja(true)
  }

  /* ---------------- pestañas ---------------- */

  const opciones = [
    { id: 'calendario' as const, texto: 'Calendario', icono: CalendarDays },
    { id: 'solicitudes' as const, texto: esAdmin ? 'Solicitudes' : 'Mis solicitudes', icono: ListChecks, cuenta: esAdmin ? undefined : datos.requests.filter((r) => r.status === 'pendiente').length || undefined },
    ...(esAdmin
      ? [
          { id: 'pendientes' as const, texto: 'Pendientes', icono: Inbox, cuenta: pendientesCount },
          { id: 'equipo' as const, texto: 'Equipo', icono: Users },
        ]
      : []),
  ]

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1280px] pb-24 lg:pb-6">
        <CabeceraDeModulo
          icono={Palmtree}
          acento="personas"
          titulo="Vacaciones"
          subtitulo={esAdmin ? 'Quién está fuera, qué espera respuesta y el saldo de cada uno' : 'Tus días, los de tus compañeros y lo que puedes pedir'}
          junto={maxALaVez === 1 ? <Insignia tono="violeta" tamano="sm" punto={false}>De uno en uno</Insignia> : <Insignia tono="violeta" tamano="sm" punto={false}>Máx. {maxALaVez} a la vez</Insignia>}
          acciones={puedeElegir ? <Boton variante="primario" icono={CalendarPlus} onClick={abrirHoja}>{esAdmin ? 'Registrar días' : 'Pedir días'}</Boton> : undefined}
          debajo={<Pestanas etiqueta="Secciones de vacaciones" acento="personas" opciones={opciones} valor={pestana} onCambio={setPestana} idPanel="panel-vacaciones" />}
        />

        {datos.missingTables && (
          <div className="mt-4">
            <EstadoVacio icono={AlarmClock} acento="cumplimiento" titulo="El módulo todavía no está activo" descripcion="Faltan las tablas de vacaciones en la base de datos (migración 116). Avisa a dirección." />
          </div>
        )}

        {/* Cifras */}
        <div className="mt-4">
          <FilaDeKpis>
            {saldo ? (
              [
                <Kpi key="disp" indice={0} etiqueta={`Disponibles ${saldo.year}`} valor={saldo.available} formato={numeroDeDias} acento="personas" icono={Palmtree} serie={serieDevengo(saldo)} nota={saldo.overdrawn ? 'Has pedido más de lo que tienes' : `Generas ${numeroDeDias(saldo.accrual.perMonth ?? 0)} al mes · ${numeroDeDias(saldo.yearTotal)} este año`} />,
                <Kpi key="apr" indice={1} etiqueta="Aprobados" valor={saldo.approved} formato={numeroDeDias} acento="var(--ls-e-verde)" icono={ShieldCheck} nota={`${numeroDeDias(saldo.taken)} disfrutados · ${numeroDeDias(saldo.booked)} por venir`} />,
                <Kpi key="pen" indice={2} etiqueta="Pendientes" valor={saldo.pending} formato={numeroDeDias} acento="var(--ls-e-ambar)" icono={Hourglass} nota={saldo.pendingCount ? `${saldo.pendingCount} ${saldo.pendingCount === 1 ? 'petición' : 'peticiones'} · ya restan` : 'Nada esperando'} onClick={() => setPestana('solicitudes')} />,
                saldo.carriedLeft > 0 ? (
                  <Kpi key="arr" indice={3} etiqueta={`Arrastre ${saldo.year - 1}`} valor={saldo.carriedLeft} formato={numeroDeDias} acento="var(--ls-e-ambar)" icono={AlarmClock} nota={`Caducan el ${formatDayLong(saldo.carriedExpiresOn)}`} />
                ) : (
                  <Kpi key="fuera" indice={3} etiqueta="Fuera hoy" valor={resumen.hoy} acento="var(--ls-e-cian)" icono={PlaneTakeoff} nota={`${resumen.semana} esta semana · ${resumen.mes} en 30 días`} />
                ),
              ]
            ) : (
              [
                ...(esAdmin ? [<Kpi key="pend" indice={0} etiqueta="Por resolver" valor={pendientesCount} acento="var(--ls-e-ambar)" icono={Inbox} nota={pendientesCount ? 'Ábrelas en Pendientes' : 'Todo al día'} onClick={() => setPestana('pendientes')} />] : []),
                <Kpi key="hoy" indice={1} etiqueta="Fuera hoy" valor={resumen.hoy} acento="personas" icono={PlaneTakeoff} nota={resumen.hoy === 0 ? 'Todo el equipo trabajando' : 'Mira quién en el calendario'} />,
                <Kpi key="sem" indice={2} etiqueta="Esta semana" valor={resumen.semana} acento="var(--ls-e-cian)" icono={CalendarRange} nota="personas con algún día fuera" />,
                <Kpi key="mes" indice={3} etiqueta="Próximos 30 días" valor={resumen.mes} acento="var(--ls-e-verde)" icono={CalendarDays} nota="personas con vacaciones" />,
              ]
            )}
          </FilaDeKpis>
        </div>

        <PanelDePestana id="panel-vacaciones" key={pestana} className="mt-5">
          {pestana === 'calendario' && (
            <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_330px]">
              {miFicha && miFicha.vacation_days_per_month == null && !esAdmin && (
                <div className="lg:col-span-2">
                  <EstadoVacio compacto icono={Palmtree} acento="personas" titulo="Tu ficha todavía no genera vacaciones" descripcion="Ves el calendario del equipo, pero para pedir días dirección tiene que ponerte los días por mes en tu ficha." />
                </div>
              )}
              {!miFicha && !esAdmin && (
                <div className="lg:col-span-2">
                  <EstadoVacio compacto icono={Users} acento="personas" titulo="Tu usuario no está enlazado a ninguna ficha" descripcion="Ves quién está fuera, pero para pedir tus días dirección tiene que enlazar tu cuenta a tu ficha en Control empleados." />
                </div>
              )}
              <Tarjeta
                indice={0}
                acento="personas"
                className="min-w-0"
                titulo={vista === 'mes' ? 'Quién está fuera' : 'El año de un vistazo'}
                subtitulo={
                  // En el móvil el subtítulo comparte fila con «Mes | Año» y se corta a ~28 letras: texto corto, o la
                  // instrucción se quedaba en «Toca el primer día y el último p…». En la vista del año no se eligen días.
                  vista === 'anio' ? (
                    <><span className="sm:hidden">Toca un mes para abrirlo</span><span className="hidden sm:inline">Pulsa un mes para abrirlo</span></>
                  ) : puedeElegir ? (
                    <><span className="sm:hidden">Toca el primer y el último día</span><span className="hidden sm:inline">Arrastra sobre los días (o pulsa el primero y el último) para pedirlos</span></>
                  ) : (
                    'Toca un día para ver quién está fuera'
                  )
                }
                acciones={<Segmentado etiqueta="Vista" tamano="sm" valor={vista} onCambio={setVista} opciones={[{ id: 'mes', texto: 'Mes' }, { id: 'anio', texto: 'Año' }]} />}
              >
                {vista === 'mes' ? (
                  <CalendarioEmpresa
                    mes={mes}
                    onMes={setMes}
                    hoy={hoy}
                    ocupacion={ocupacion}
                    festivos={festivosVisibles}
                    yoId={yoParaCupo}
                    seleccion={seleccion}
                    onSeleccion={setSeleccion}
                    puedeElegir={puedeElegir}
                    diasEnChoque={diasEnChoque}
                    diaEnfocado={diaEnfocado}
                    onEnfocar={setDiaEnfocado}
                  />
                ) : (
                  <VistaAnual
                    anio={anioVisto}
                    onAnio={(a) => setMes(`${a}-${mes.slice(5, 7)}-01`)}
                    hoy={hoy}
                    ocupacion={ocupacion}
                    festivos={festivosVisibles}
                    yoId={yoParaCupo}
                    onAbrirMes={(m) => { setMes(m); setVista('mes') }}
                  />
                )}
              </Tarjeta>

              <aside className="flex min-w-0 flex-col gap-4">
                <AnimatePresence mode="wait" initial={false}>
                  {seleccion ? (
                    <motion.div key="sel" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                      <Tarjeta variante="destacada" acento={diasEnChoque.size ? 'var(--ls-e-rojo)' : 'marca'} titulo="Tu selección" icono={Sparkles}
                        acciones={<Boton variante="fantasma" tamano="sm" soloIcono icono={X} aria-label="Quitar la selección" onClick={() => setSeleccion(null)} />}>
                        <p className="text-[14px] text-[var(--ls-t2)]">{formatDayRange(seleccion.start, seleccion.end)}</p>
                        <p className="mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] text-[var(--ls-t1)] tabular-nums">
                          {diasSel} <span className="text-[14px] font-medium text-[var(--ls-t3)]">{diasSel === 1 ? 'día laborable' : 'días laborables'}</span>
                        </p>
                        {choqueSel && choqueSel.coinciden.length > 0 && (
                          <p className="mt-2 text-[12.5px] leading-snug" style={{ color: choqueSel.hay ? 'var(--ls-e-rojo)' : 'var(--ls-e-ambar)' }}>
                            {choqueSel.hay ? 'Choca' : 'Coincide'} con {[...new Set(choqueSel.coinciden.map((c) => c.nombre))].join(', ')}. {choqueSel.hay ? 'Puedes pedirlo: dirección decide.' : 'Cabe.'}
                          </p>
                        )}
                        <Boton className="mt-3 w-full" variante="primario" icono={CalendarPlus} onClick={abrirHoja}>{esAdmin && !propio ? 'Registrar estos días' : 'Pedir estos días'}</Boton>
                      </Tarjeta>
                    </motion.div>
                  ) : (
                    <motion.div key="dia" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.18 }}>
                      <DetalleDelDia dia={diaEnfocado} hoy={hoy} ausencias={ausencias} festivo={festivosParaPintar(lugarDeQuienMira, diaEnfocado, diaEnfocado).get(diaEnfocado)} yoId={miFicha?.id ?? null} />
                    </motion.div>
                  )}
                </AnimatePresence>

                <Tarjeta indice={1} titulo="Próximas ausencias" icono={PlaneTakeoff} acento="personas">
                  {resumen.proximas.length === 0 ? (
                    <p className="text-[13px] text-[var(--ls-t3)]">Nadie tiene vacaciones en los próximos 30 días.</p>
                  ) : (
                    <ul className="flex flex-col gap-2.5">
                      {resumen.proximas.map((a) => (
                        <li key={a.id} className="flex items-center gap-2.5">
                          <AvatarDePersona nombre={a.nombre} color={a.color} tamano={30} pendiente={a.status === 'pendiente'} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{a.employee_id === miFicha?.id ? 'Tú' : a.nombre}</span>
                            <span className="block truncate text-[12px] text-[var(--ls-t3)]">{formatDayRange(a.start_date, a.end_date)}</span>
                          </span>
                          {a.status === 'pendiente' && <Insignia tono="ambar" tamano="sm" punto={false}>Pendiente</Insignia>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Tarjeta>

                <Reglas saldo={saldo} maxALaVez={maxALaVez} conFestivos={festivosDelLugar(lugarDeQuienMira).length > 0} />
              </aside>

            </div>
          )}

          {pestana === 'solicitudes' && <ListaSolicitudes datos={datos} esAdmin={esAdmin} userId={userId} onHecho={refrescar} onPedir={puedeElegir ? () => { setPestana('calendario') } : undefined} />}
          {pestana === 'pendientes' && esAdmin && <BandejaPendientes datos={datos} ausencias={ausencias} maxALaVez={maxALaVez} onHecho={refrescar} />}
          {pestana === 'equipo' && esAdmin && <EquipoYAjustes datos={datos} onHecho={refrescar} />}
        </PanelDePestana>
      </div>

      <BarraDeSeleccionMovil
        visible={!!seleccion && pestana === 'calendario' && !hoja}
        texto={seleccion ? `${diasSel} ${diasSel === 1 ? 'día' : 'días'} · ${formatDayRange(seleccion.start, seleccion.end)}` : ''}
        choca={diasEnChoque.size > 0}
        onPedir={abrirHoja}
        onQuitar={() => setSeleccion(null)}
      />

      <HojaPedir
        abierto={hoja}
        onCambio={setHoja}
        seleccion={seleccion}
        onSeleccion={setSeleccion}
        persona={persona}
        personasElegibles={elegibles}
        onPersona={setPersonaId}
        propio={!esAdmin || propio}
        peticiones={persona ? datos.requests.filter((r) => r.employee_id === persona.id) : []}
        hoy={hoy}
        lugar={lugarDePersona}
        ausencias={ausencias}
        maxALaVez={maxALaVez}
        onHecho={refrescar}
      />
    </MotionConfig>
  )
}

/** El primer día del mes siguiente ('yyyy-MM-01') */
function addMonths1(mes: string): string {
  const y = Number(mes.slice(0, 4))
  const m = Number(mes.slice(5, 7))
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`
}

/** El devengo acumulado mes a mes del año (para la línea pequeña del KPI) */
function serieDevengo(s: VacationBalance): number[] {
  const porMes = s.accrual.perMonth ?? 0
  const meses = s.accrual.monthsCompleted
  if (meses < 2) return []
  return Array.from({ length: meses + 1 }, (_, i) => Math.round(i * porMes * 100) / 100)
}

function DetalleDelDia({ dia, hoy, ausencias, festivo, yoId }: { dia: string; hoy: string; ausencias: readonly AusenciaDeEquipo[]; festivo?: { nombre: string; descuenta: boolean }; yoId: string | null }) {
  const fuera = ausencias.filter((a) => a.start_date <= dia && a.end_date >= dia)
  const finde = weekdayIndex(dia) >= 5
  return (
    <Tarjeta titulo={dia === hoy ? 'Hoy' : formatDayLong(dia)} subtitulo={dia === hoy ? formatDayLong(dia) : undefined} icono={CalendarDays} acento="personas">
      {festivo && (
        <p className="mb-2 flex items-center gap-2 text-[12.5px]" style={{ color: festivo.descuenta ? 'var(--ls-e-ambar)' : 'var(--ls-t3)' }}>
          <Flag className="h-3.5 w-3.5" aria-hidden />
          {festivo.nombre}{festivo.descuenta ? ' · no gasta vacaciones' : ' · festivo nacional en España'}
        </p>
      )}
      {finde ? (
        <p className="text-[13px] text-[var(--ls-t3)]">Fin de semana: no cuenta como vacaciones.</p>
      ) : fuera.length === 0 ? (
        <p className="text-[13px] text-[var(--ls-t3)]">Todo el equipo trabaja este día.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {fuera.map((a) => (
            <li key={a.id} className="flex items-center gap-2.5">
              <AvatarDePersona nombre={a.nombre} color={a.color} tamano={30} pendiente={a.status === 'pendiente'} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium text-[var(--ls-t1)]">{a.employee_id === yoId ? 'Tú' : a.nombre}</span>
                <span className="block truncate text-[12px] text-[var(--ls-t3)]">{formatDayRange(a.start_date, a.end_date)}</span>
              </span>
              <Insignia tono={a.status === 'aprobada' ? 'verde' : 'ambar'} tamano="sm" punto={false}>{a.status === 'aprobada' ? (a.solape_autorizado ? 'Excepción' : 'Aprobadas') : 'Pendientes'}</Insignia>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

/** Las reglas de siempre, contadas claras. No cambian: solo se enseñan mejor */
function Reglas({ saldo, maxALaVez, conFestivos }: { saldo: VacationBalance | null; maxALaVez: number; conFestivos: boolean }) {
  const reglas: { icono: typeof Clock; texto: string }[] = [
    {
      icono: Palmtree,
      texto: saldo
        ? `Generas ${formatDays(saldo.accrual.perMonth ?? 0)} por cada mes completo trabajado (año natural, del 1 de enero al 31 de diciembre). El mes en curso suma cuando termina.`
        : 'Cada persona genera sus días por mes completo trabajado, por año natural.',
    },
    { icono: AlarmClock, texto: 'Lo que sobra del año se arrastra al siguiente y caduca el 31 de marzo. Es lo primero que se gasta.' },
    { icono: Clock, texto: `Pide con ${NOTICE_DAYS} días de antelación. Si no, se puede pedir igual, pero sale marcado como fuera de plazo.` },
    { icono: Hourglass, texto: 'Lo pendiente ya resta del saldo, para no pedir los mismos días dos veces.' },
    { icono: CalendarDays, texto: `Solo cuentan los días de lunes a viernes${conFestivos ? ' que no son festivo donde vives' : ''}.` },
    { icono: Users, texto: maxALaVez === 1 ? 'En la empresa no pueden irse dos a la vez. Si coincides con alguien te avisamos y dirección decide.' : `En la empresa pueden estar fuera como mucho ${maxALaVez} a la vez.` },
  ]
  return (
    <Tarjeta indice={2} titulo="Cómo funcionan los días" icono={ShieldCheck} acento="personas">
      <ul className="flex flex-col gap-2.5">
        {reglas.map(({ icono: I, texto }) => (
          <li key={texto} className="flex items-start gap-2.5 text-[12.5px] leading-relaxed text-[var(--ls-t2)]">
            <span className="mt-[1px] flex h-6 w-6 shrink-0 items-center justify-center rounded-[7px]" style={{ background: mezcla('var(--ls-mod-personas)', 14), color: 'var(--ls-mod-personas)' }}>
              <I className="h-3.5 w-3.5" aria-hidden />
            </span>
            {texto}
          </li>
        ))}
      </ul>
    </Tarjeta>
  )
}

/** En el móvil, la selección se resume abajo con el botón de pedir a mano del pulgar. En portal: .pagina-de-ruta deja un transform puesto */
function BarraDeSeleccionMovil({ visible, texto, choca, onPedir, onQuitar }: { visible: boolean; texto: string; choca: boolean; onPedir: () => void; onQuitar: () => void }) {
  const [montado, setMontado] = useState(false)
  useEffect(() => setMontado(true), [])
  if (!montado) return null
  return createPortal(
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 90, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 90, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 36 }}
            className="fixed inset-x-3 bottom-[calc(12px+env(safe-area-inset-bottom))] z-40 flex items-center gap-2 rounded-[16px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-2 pl-4 shadow-[var(--ls-sombra-3)] lg:hidden"
          >
            <span className={cn('min-w-0 flex-1 truncate text-[13.5px] font-medium', choca ? 'text-[var(--ls-e-rojo)]' : 'text-[var(--ls-t1)]')}>{texto}</span>
            <Boton variante="fantasma" soloIcono icono={X} aria-label="Quitar la selección" onClick={onQuitar} />
            <Boton variante="primario" icono={CalendarPlus} onClick={onPedir}>Pedir</Boton>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>,
    document.body
  )
}
