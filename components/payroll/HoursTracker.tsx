'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { toast } from 'sonner'
import { CalendarDays, ChevronLeft, ChevronRight, Clock, Eye, LayoutGrid, List, Pencil, Settings2, Users } from 'lucide-react'
import { Boton, CabeceraDeModulo, Confirmacion, PanelDePestana, PanelLateral, Pestanas, Segmentado, TACTIL_CUADRADO, Tarjeta } from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { periodLabel, type ManualAppointment, type PayrollRate, type WorkHourEntry } from '@/lib/types/payroll'
import { diaDeLaSemana, formatoHoras } from '@/lib/payroll/horas'
import type { CalendarPerson } from '@/lib/types/appointments'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { RateSettings } from './RateSettings'
import type { QualifiedAppointment } from './horas/tipos'
import { useDatosDeHoras } from './horas/useDatosDeHoras'
import { useNominaCiclo } from './horas/useNominaCiclo'
import { HeroCiclo } from './horas/HeroCiclo'
import { KpisCiclo } from './horas/KpisCiclo'
import { CalendarioCiclo } from './horas/CalendarioCiclo'
import { ListaSemana } from './horas/ListaSemana'
import { EditorDia } from './horas/EditorDia'
import { PopoverDelDia, useEsEscritorio } from './horas/PopoverDelDia'
import { ApuntarHoyPegajoso, ApuntarHoyTarjeta } from './horas/ApuntarHoy'
import { ResumenCiclo } from './horas/ResumenCiclo'
import { CitasDelCiclo } from './horas/CitasDelCiclo'
import { VistaEquipo } from './horas/VistaEquipo'
import { DIAS_LARGOS, claveDeHoy, diaYMesLargo } from './horas/fechas'

export type { QualifiedAppointment } from './horas/tipos'

interface HoursTrackerProps {
  initialHours: WorkHourEntry[]
  initialRates: PayrollRate[]
  qualifiedAppointments: QualifiedAppointment[]
  initialManual: ManualAppointment[]
  team: CalendarPerson[]
  currentUser: UserProfile
  /**
   * Admin o partner: tarifas, comisiones manuales y las citas cualificadas de
   * todo el equipo. Es DINERO, y no lo abre el permiso de supervisión.
   */
  isAdmin: boolean
  /**
   * ¿Puede mirar el calendario de horas de otra persona?
   *
   * Lo pone a true admin/partner y también el permiso suelto 'equipo-comercial'
   * —el manager de captación—, que tiene que ver lo que ficha su equipo. Está
   * separado de `isAdmin` a propósito: si fuera la misma bandera, el permiso de
   * supervisión abriría de paso las tarifas hora y las comisiones, que es
   * justamente lo que se ha decidido NO darle.
   *
   * Abre el selector de persona y la pestaña «Equipo» (solo horas). Ni edita, ni
   * enseña dinero de nadie: eso lo decide `soloMirando`, más abajo.
   */
  puedeVerHorasDelEquipo: boolean
}

type Vista = 'calendario' | 'semana'
type Seccion = 'ciclo' | 'equipo'
const CLAVE_VISTA = 'mis-horas:vista'

/**
 * MIS HORAS. Antes era un solo componente de 1.237 líneas; ahora orquesta piezas de `./horas/`:
 *
 *   useDatosDeHoras   estado, tiempo real y escrituras (guardar un día, citas manuales)
 *   useNominaCiclo    el dinero del ciclo, con los MISMOS cálculos de antes, más progreso, series y comparativa
 *   HeroCiclo · KpisCiclo · CalendarioCiclo / ListaSemana · EditorDia (popover en PC, hoja en móvil)
 *   ApuntarHoy (franja en PC, pegajoso abajo en móvil) · ResumenCiclo · CitasDelCiclo · VistaEquipo
 */
export function HoursTracker({ initialHours, initialRates, qualifiedAppointments, initialManual, team, currentUser, isAdmin, puedeVerHorasDelEquipo }: HoursTrackerProps) {
  const datos = useDatosDeHoras({ initialHours, initialRates, qualifiedAppointments, initialManual, currentUserId: currentUser.id, isAdmin })
  const { hours, rates, appointments, manual, saving, saveDay } = datos

  const [offset, setOffset] = useState(0)
  const [selectedUserId, setSelectedUserId] = useState(currentUser.id)
  const [seccion, setSeccion] = useState<Seccion>('ciclo')
  const [vista, setVista] = useState<Vista>('calendario')
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)
  /** El editor en hoja también en el PC: cuando se abre desde «Otra» de «Apuntar hoy» (puede no haber casilla de hoy a la vista) */
  const [enHoja, setEnHoja] = useState(false)
  const [futuroPorConfirmar, setFuturoPorConfirmar] = useState<string | null>(null)
  const [showRates, setShowRates] = useState(false)
  const escritorio = useEsEscritorio()
  const today = claveDeHoy()

  // La vista (calendario o semana) se recuerda en este navegador. Si el almacenamiento falla, se queda la de por defecto.
  useEffect(() => {
    try {
      const v = window.localStorage.getItem(CLAVE_VISTA)
      if (v === 'calendario' || v === 'semana') setVista(v)
    } catch {
      /* sin almacenamiento: calendario */
    }
  }, [])
  const cambiarVista = (v: Vista) => {
    setVista(v)
    try {
      window.localStorage.setItem(CLAVE_VISTA, v)
    } catch {
      /* da igual */
    }
  }

  const nomina = useNominaCiclo({ hours, rates, appointments, manual, selectedUserId, offset, today })
  const { period, days, hoursByDay } = nomina

  // Los admins pueden mirar (y corregir) las horas de cualquiera; el resto solo se ve a sí mismo.
  const viewingSelf = selectedUserId === currentUser.id

  /**
   * EL SUPERVISOR MIRA, NO TOCA NI VE SUELDOS. Es true cuando alguien que NO es admin está viendo a otra persona:
   *
   *   · El dinero (hero, KPIs, comisiones, tarifa) se cambia por horas peladas. Si se dejara, el salario se recalcularía
   *     con payroll_rates —legible por todo el equipo desde la 083— y el supervisor vería lo que cobra cada comercial.
   *   · El calendario pasa a solo lectura: la RLS de la 212 le da SELECT de work_hours y NADA MÁS, así que un clic en
   *     un día ajeno acabaría en un error de guardado sin explicación.
   *   · Desaparecen las citas: las que llegan del servidor son solo las suyas (la consulta se filtra con `isAdmin`), así
   *     que ahí saldría un cero que no es cero.
   */
  const soloMirando = !viewingSelf && !isAdmin
  const viewedPerson = team.find((p) => p.id === selectedUserId) ?? ({ id: currentUser.id, full_name: currentUser.full_name, email: currentUser.email } as CalendarPerson)
  const nombreVisto = viewedPerson.full_name || viewedPerson.email || 'esta persona'

  const todayHours = Number(hoursByDay.get(today)?.hours ?? 0)
  const todayInPeriod = days.includes(today)

  /** Pulsar un día: los futuros piden confirmación (se puede, pero no por despiste). */
  function pulsarDia(key: string) {
    if (soloMirando) return
    setEnHoja(false)
    if (key > today) setFuturoPorConfirmar(key)
    else setDiaAbierto(key)
  }

  function abrirHoyEnHoja() {
    setEnHoja(true)
    setDiaAbierto(today)
  }

  async function apuntarHoy(h: number) {
    if (await saveDay(currentUser.id, today, h)) toast.success(`Apuntadas ${formatoHoras(h)} h hoy`)
  }

  function cambiarPersona(id: string) {
    setSelectedUserId(id)
    setDiaAbierto(null)
  }

  const cerrarEditor = () => setDiaAbierto(null)
  const tituloDia = (key: string) => `${DIAS_LARGOS[diaDeLaSemana(key)]} ${diaYMesLargo(key)}`
  const editor = (key: string) => {
    const fila = hoursByDay.get(key)
    return (
      <EditorDia
        key={`${selectedUserId}-${key}`}
        valorGuardado={Number(fila?.hours ?? 0)}
        notaGuardada={fila?.note ?? null}
        hayFila={Boolean(fila)}
        guardando={saving}
        onGuardar={(h, nota) => saveDay(selectedUserId, key, h, nota)}
        onCerrar={cerrarEditor}
      />
    )
  }
  const subtituloEditor = viewingSelf ? 'Tus horas de ese día' : `Horas de ${nombreVisto}`

  // En el PC el editor sale en un popover anclado a la casilla (la rejilla ya no salta); en el móvil, en una hoja inferior.
  const envolver = escritorio
    ? (key: string, el: ReactNode) => {
        const abierto = diaAbierto === key && !enHoja
        return (
          <PopoverDelDia abierto={abierto} onCerrar={cerrarEditor} titulo={tituloDia(key)} subtitulo={subtituloEditor} ancla={el}>
            {abierto && editor(key)}
          </PopoverDelDia>
        )
      }
    : undefined

  /** Para el número de la pestaña «Equipo»: quién no ha apuntado hoy (solo en un laborable del ciclo en curso). */
  const sinApuntarHoy = useMemo(() => {
    if (!puedeVerHorasDelEquipo || !todayInPeriod || diaDeLaSemana(today) >= 5) return 0
    const con = new Set(hours.filter((h) => h.work_date === today && Number(h.hours) > 0).map((h) => h.user_id))
    return team.filter((p) => !con.has(p.id)).length
  }, [puedeVerHorasDelEquipo, todayInPeriod, today, hours, team])

  const botonFlecha = cn('flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--ls-t3)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]', TACTIL_CUADRADO)
  const navegadorDeCiclo = (
    <div className="flex shrink-0 items-center gap-0.5 rounded-[11px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-[3px]">
      <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="Ciclo anterior" className={botonFlecha}>
        <ChevronLeft className="h-4 w-4" />
      </button>
      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={period.key}
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.15 }}
          className="flex items-center gap-1.5 whitespace-nowrap px-1.5 text-[13px] font-semibold text-[var(--ls-t1)]"
          aria-live="polite"
        >
          <CalendarDays className="h-3.5 w-3.5 text-[var(--ls-acc-graf)]" />
          {periodLabel(period)}
        </motion.span>
      </AnimatePresence>
      <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="Ciclo siguiente" className={botonFlecha}>
        <ChevronRight className="h-4 w-4" />
      </button>
      {offset !== 0 && (
        <button type="button" onClick={() => setOffset(0)} className="h-8 rounded-[8px] px-2 text-[12px] font-medium text-[var(--ls-acc-graf)] transition-colors hover:bg-[var(--ls-sup3)] [@media(pointer:coarse)]:min-h-[44px]">
          Hoy
        </button>
      )}
    </div>
  )

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto w-full max-w-[1280px]">
        <CabeceraDeModulo
          icono={Clock}
          acento="marca"
          titulo="Mis Horas"
          subtitulo="Apunta cada día lo que trabajas y mira en vivo lo que llevas ganado en el ciclo del 15 al 14."
          acciones={
            <>
              {navegadorDeCiclo}
              {puedeVerHorasDelEquipo && team.length > 0 && (
                <select
                  value={selectedUserId}
                  onChange={(e) => cambiarPersona(e.target.value)}
                  aria-label="Persona"
                  className="h-9 max-w-[200px] shrink-0 cursor-pointer rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none transition-colors focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
                >
                  <option value={currentUser.id}>{currentUser.full_name || 'Yo'}</option>
                  {team
                    .filter((p) => p.id !== currentUser.id)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.full_name || p.email}
                      </option>
                    ))}
                </select>
              )}
              {isAdmin && (
                <Boton icono={Settings2} onClick={() => setShowRates(true)}>
                  Tarifas
                </Boton>
              )}
            </>
          }
          debajo={
            puedeVerHorasDelEquipo ? (
              <Pestanas<Seccion>
                etiqueta="Secciones de Mis Horas"
                acento="marca"
                idPanel="mis-horas-panel"
                valor={seccion}
                onCambio={setSeccion}
                opciones={[
                  { id: 'ciclo', texto: viewingSelf ? 'Mi ciclo' : `Ciclo de ${nombreVisto.split(' ')[0]}`, icono: CalendarDays },
                  { id: 'equipo', texto: 'Equipo', icono: Users, cuenta: sinApuntarHoy || undefined },
                ]}
              />
            ) : undefined
          }
        />

        <PanelDePestana id="mis-horas-panel" key={seccion}>
          {seccion === 'equipo' && puedeVerHorasDelEquipo ? (
            <VistaEquipo
              equipo={team}
              hours={hours}
              rates={rates}
              appointments={appointments}
              manual={manual}
              claveCiclo={period.key}
              dias={days}
              hoy={today}
              esAdmin={isAdmin}
              onAbrirPersona={(id) => {
                cambiarPersona(id)
                setSeccion('ciclo')
              }}
            />
          ) : (
            <>
              {!viewingSelf && (
                <div className="mb-4 flex flex-wrap items-start gap-2.5 rounded-[12px] border border-[color-mix(in_srgb,var(--ls-acc-graf)_30%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-acc-graf)_7%,transparent)] px-3.5 py-2.5 text-[13px] text-[var(--ls-t2)]">
                  {soloMirando ? <Eye className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-acc-graf)]" /> : <Pencil className="mt-0.5 h-4 w-4 shrink-0 text-[var(--ls-acc-graf)]" />}
                  <p className="min-w-0 flex-1">
                    {soloMirando ? 'Estás viendo las horas de' : 'Estás viendo y editando las horas de'} <span className="font-semibold text-[var(--ls-t1)]">{nombreVisto}</span>.{' '}
                    {soloMirando ? 'Solo de lectura: puedes ver lo que ficha, no corregirlo ni ver lo que cobra.' : 'Cualquier cambio se le guarda a esa persona.'}
                  </p>
                  <button type="button" onClick={() => cambiarPersona(currentUser.id)} className="shrink-0 text-[12.5px] font-medium text-[var(--ls-acc-graf)] hover:underline [@media(pointer:coarse)]:min-h-[44px]">
                    Volver a lo mío
                  </button>
                </div>
              )}

              <HeroCiclo nomina={nomina} soloMirando={soloMirando} enCurso={todayInPeriod} />
              <KpisCiclo nomina={nomina} soloMirando={soloMirando} />

              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
                <Tarjeta
                  titulo="Calendario del ciclo"
                  subtitulo={soloMirando ? 'Solo de lectura' : 'Pulsa un día para apuntar o corregir'}
                  icono={CalendarDays}
                  acento="marca"
                  indice={0}
                  cuerpoClassName="p-3 sm:p-4"
                  acciones={
                    <Segmentado<Vista>
                      etiqueta="Vista"
                      tamano="sm"
                      valor={vista}
                      onCambio={cambiarVista}
                      opciones={[
                        { id: 'calendario', texto: 'Mes', icono: LayoutGrid },
                        { id: 'semana', texto: 'Semana', icono: List },
                      ]}
                    />
                  }
                >
                  {todayInPeriod && viewingSelf && <ApuntarHoyTarjeta horasHoy={todayHours} guardando={saving} onApuntar={apuntarHoy} onOtra={abrirHoyEnHoja} />}
                  {vista === 'calendario' ? (
                    <CalendarioCiclo claveCiclo={period.key} dias={days} hoy={today} horasPorDia={hoursByDay} diaAbierto={diaAbierto} soloMirando={soloMirando} onPulsarDia={pulsarDia} envolver={envolver} />
                  ) : (
                    <ListaSemana dias={days} hoy={today} horasPorDia={hoursByDay} diaAbierto={diaAbierto} soloMirando={soloMirando} onPulsarDia={pulsarDia} envolver={envolver} />
                  )}
                </Tarjeta>

                <div className="space-y-4">
                  <ResumenCiclo nomina={nomina} soloMirando={soloMirando} />
                  {/* Comisiones. Fuera cuando solo se supervisa: es dinero, y además las citas que llegan del servidor
                      son solo las propias, así que aquí saldría un cero que no es cero. */}
                  {!soloMirando && (
                    <CitasDelCiclo
                      citas={nomina.periodQualified}
                      esAdmin={isAdmin}
                      rates={rates}
                      hoy={today}
                      claveCiclo={period.key}
                      nombrePersona={nombreVisto}
                      guardando={saving}
                      onAnadir={(d) => datos.addManual({ userId: selectedUserId, nombre: d.nombre, fecha: d.fecha, importe: d.importe })}
                      onSoltarFijo={datos.soltarImporteFijo}
                      onQuitar={datos.removeManual}
                    />
                  )}
                </div>
              </div>

              {todayInPeriod && viewingSelf && <ApuntarHoyPegajoso horasHoy={todayHours} guardando={saving} onApuntar={apuntarHoy} onOtra={abrirHoyEnHoja} />}
            </>
          )}
        </PanelDePestana>

        {/* El editor del día en el MÓVIL (y en el PC cuando se abre desde «Otra»): hoja inferior con objetivos de 44 px */}
        <PanelLateral
          abierto={diaAbierto !== null && !soloMirando && (!escritorio || enHoja)}
          onCambio={(a) => !a && cerrarEditor()}
          titulo={diaAbierto ? tituloDia(diaAbierto) : ''}
          descripcion={subtituloEditor}
          icono={Clock}
          acento="marca"
          ancho={400}
        >
          {diaAbierto && (!escritorio || enHoja) && editor(diaAbierto)}
        </PanelLateral>

        <Confirmacion
          abierto={futuroPorConfirmar !== null}
          onCambio={(a) => !a && setFuturoPorConfirmar(null)}
          titulo="Ese día todavía no ha llegado"
          descripcion={futuroPorConfirmar ? `¿Seguro que quieres apuntar horas del ${tituloDia(futuroPorConfirmar).toLowerCase()}? Normalmente se apuntan el mismo día.` : undefined}
          palabra={null}
          tono="normal"
          textoConfirmar="Sí, apuntar"
          onConfirmar={() => {
            const d = futuroPorConfirmar
            // Después de que el diálogo devuelva el foco: si no, el popover recién abierto se cerraría con ese foco
            if (d) setTimeout(() => setDiaAbierto(d), 60)
          }}
        />

        <AnimatePresence>
          {showRates && <RateSettings period={period} rates={rates} onClose={() => setShowRates(false)} onSaved={datos.tarifaGuardada} onRemoved={datos.tarifaQuitada} />}
        </AnimatePresence>
      </div>
    </MotionConfig>
  )
}
