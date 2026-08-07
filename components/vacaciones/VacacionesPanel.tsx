'use client'

import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { AlarmClock, Inbox, Palmtree, UserX, X } from 'lucide-react'
import {
  formatDayLong,
  formatDays,
  vacationBalance,
  yearOf,
  type VacationEmployee,
  type VacationRequest,
} from '@/lib/types/vacations'
import { postVacations, type VacationsMutation, type VacationsView } from '@/lib/vacations/client'
import { BalanceResumen } from './BalanceResumen'
import { PeticionCard } from './PeticionCard'
import { PeticionForm } from './PeticionForm'
import { cardShell, fieldInput } from './shared'

/**
 * EL PANEL DE VACACIONES DEL ADMIN.
 *
 * Cuatro cosas y en este orden, que es el orden en el que hacen falta:
 *   1) lo que hay que resolver hoy,
 *   2) cómo va el saldo de cada persona,
 *   3) qué días tiene canjeados cada una y quién se los concedió,
 *   4) registrar una petición por alguien.
 *
 * Van en pestañas y no una debajo de otra a propósito: la cola es lo único que
 * se abre a diario, y enterrarla bajo tres tablas de saldos garantiza que se
 * mire cada dos semanas.
 *
 * POR QUÉ HAY HISTORIAL Y NO SOLO COLA
 * ------------------------------------
 * Sin él, una petición desaparecía de la pantalla en el instante en que se
 * aprobaba y no volvía a aparecer en ninguna parte. Dos consecuencias, las dos
 * malas: unas vacaciones concedidas que al final no se cogen se quedaban
 * gastadas para siempre —el botón de anular existía, pero no había ninguna
 * tarjeta desde la que llegar a él—, y las personas SIN CUENTA en el ERP no
 * podían ver sus días canjeados por ningún lado, porque ni entran ellas ni el
 * admin los tenía delante. «Que salgan como canjeados» es literalmente lo que
 * se pidió.
 *
 * POR QUÉ EL SALDO SE CALCULA AQUÍ Y NO SE RECIBE HECHO
 * ----------------------------------------------------
 * `vacationBalances()` existe en lib/employees/vacations.ts, pero ese fichero
 * importa el cliente de service_role: un componente de cliente que lo importe
 * se lleva la clave al navegador. Así que se llama directamente a
 * `vacationBalance` —que es la MISMA función que usa el servidor, pura y sin
 * dependencias—, y lo único que se rehace aquí es filtrar y ordenar. Nada del
 * cálculo se duplica.
 *
 * Y el saldo tiene que rehacerse en el navegador, no llegar congelado del
 * servidor: en cuanto se aprueba una petición, los cuatro números de esa
 * persona cambian, y una cifra que se quedara como estaba sería peor que no
 * enseñarla.
 */

type Tab = 'cola' | 'saldos' | 'historial' | 'registrar'

export interface VacacionesPanelProps {
  data: VacationsView
  onData: (data: VacationsView) => void
  onClose: () => void
  /** Abre la ficha de esa persona en Control empleados (para corregir el alta) */
  onOpenFicha?: (employeeId: string) => void
}

export function VacacionesPanel({ data, onData, onClose, onOpenFicha }: VacacionesPanelProps) {
  const [tab, setTab] = useState<Tab>('cola')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [personId, setPersonId] = useState<string>('')

  const byId = useMemo(() => {
    const map = new Map<string, VacationEmployee>()
    for (const e of data.employees) map.set(e.id, e)
    return map
  }, [data.employees])

  /**
   * Quien genera vacaciones. Quien tiene la tarifa a NULL se queda fuera: no es
   * que su saldo sea cero, es que no participa en el módulo, y un cero en la
   * lista se leería como «se las ha gastado todas».
   */
  const conDerecho = useMemo(
    () =>
      data.employees
        .filter((e) => e.vacation_days_per_month != null)
        .sort((a, b) => a.name.localeCompare(b.name, 'es')),
    [data.employees]
  )

  const balances = useMemo(
    () =>
      conDerecho.map((employee) => ({
        employee,
        balance: vacationBalance(employee, data.requests, data.today),
      })),
    [conDerecho, data.requests, data.today]
  )

  const balanceOf = useMemo(() => {
    const map = new Map<string, ReturnType<typeof vacationBalance>>()
    for (const b of balances) map.set(b.employee.id, b.balance)
    return map
  }, [balances])

  /**
   * EL SALDO DEL AÑO DE LAS FECHAS DE ESA PETICIÓN, que no siempre es el de hoy.
   *
   * La tarjeta escribe «Le quedarían X días» y aquí se le pasaba SIEMPRE el
   * saldo del año en curso. Con una petición del 4 de enero al 19 de febrero de
   * 2027 tecleada en diciembre de 2026, la cola de aprobación decía «Le
   * quedarían 10,98 días» cuando el saldo real de 2027 al aprobarla se queda en
   * −22,19. El formulario sí lo avisaba, pero quien aprueba no ve el
   * formulario: ve la tarjeta.
   */
  const balanceParaPeticion = useMemo(() => {
    const cache = new Map<string, ReturnType<typeof vacationBalance>>()
    return (r: VacationRequest) => {
      const employee = byId.get(r.employee_id)
      if (!employee || employee.vacation_days_per_month == null) return null
      const year = yearOf(r.start_date)
      const clave = `${r.employee_id}:${year}`
      const guardado = cache.get(clave)
      if (guardado) return guardado
      const fresco = vacationBalance(employee, data.requests, data.today, { year })
      cache.set(clave, fresco)
      return fresco
    }
  }, [byId, data.requests, data.today])

  const pendientes = useMemo(
    () =>
      data.requests
        .filter((r) => r.status === 'pendiente')
        .sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id)),
    [data.requests]
  )

  /**
   * Todo lo que ya no espera respuesta, lo último primero.
   *
   * Se pintan también las rechazadas y las retiradas: saber que unos días se
   * pidieron y se dijo que no vale tanto como saber que se concedieron, y es lo
   * único que queda escrito de esa conversación.
   */
  const historial = useMemo(
    () =>
      data.requests
        .filter((r) => r.status !== 'pendiente')
        .sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id.localeCompare(a.id)),
    [data.requests]
  )

  const sinCuenta = conDerecho.filter((e) => !e.user_id)

  /**
   * A QUIÉN LE VAN A CADUCAR DÍAS EL 31 DE MARZO.
   *
   * Va arriba del todo de «Saldos» y no escondido en la tarjeta de cada uno:
   * quien tiene que hacer algo con esto es dirección —repartir el trabajo para
   * que esos días se puedan coger—, y para eso hace falta verlo de un vistazo,
   * no persona por persona. Las que no tienen cuenta en el ERP ni siquiera
   * pueden mirarlo ellas.
   */
  const caducan = useMemo(
    () => balances.filter(({ balance }) => balance.carriedLeft > 0),
    [balances]
  )

  const persona = byId.get(personId) ?? conDerecho[0] ?? null
  const anyo = yearOf(data.today)

  async function resolve(url: string, id: string, body?: unknown) {
    setBusyId(id)
    try {
      const result = await postVacations<VacationsMutation>(url, body)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      if (result.data.message) toast.success(result.data.message)
      onData(result.data)
    } finally {
      setBusyId(null)
    }
  }

  /**
   * EL CONTADOR DE CADUCIDAD, EN LA PESTAÑA QUE NO SE ABRE.
   *
   * El panel arranca en «Por aprobar», que es la única que se mira a diario. El
   * aviso de a quién le caducan días vive en «Saldos», así que dirección podía
   * pasarse enero, febrero y marzo resolviendo peticiones sin ver ni una vez
   * que a alguien se le van 18,30 días el 31 de marzo. Con la píldora en la
   * pestaña, el aviso se ve desde la que sí se abre.
   */
  const tabs: { id: Tab; label: string; count?: number; caducan?: number }[] = [
    { id: 'cola', label: 'Por aprobar', count: pendientes.length },
    { id: 'saldos', label: 'Saldos', count: conDerecho.length, caducan: caducan.length },
    { id: 'historial', label: 'Historial', count: historial.length },
    { id: 'registrar', label: 'Registrar petición' },
  ]

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
      />
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18 }}
        className="relative w-full max-w-3xl max-h-[88vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#0d0d0d] p-4 shadow-2xl min-w-0"
      >
        {/* Cabecera */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h3 className="text-[16px] font-semibold text-white flex items-center gap-2">
              <Palmtree className="h-4 w-4 text-[#FF6600] flex-shrink-0" />
              Vacaciones del equipo · {anyo}
            </h3>
            <p className="text-[11px] text-white/40 mt-0.5">
              El período es el año natural. Solo de lunes a viernes, hay que avisar con un mes, y
              las peticiones pendientes ya descuentan del saldo. Lo que sobre de {anyo} se arrastra
              y caduca el 31 de marzo de {anyo + 1}.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="h-7 w-7 flex-shrink-0 rounded-full flex items-center justify-center text-white/40 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Pestañas */}
        <div className="flex items-center gap-1.5 mb-3 overflow-x-auto">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-colors whitespace-nowrap flex items-center gap-1.5 ${
                tab === t.id
                  ? 'border-[#FF6600]/50 bg-[#FF6600]/[0.1] text-white'
                  : 'border-white/10 bg-white/[0.02] text-white/50 hover:text-white hover:border-white/20'
              }`}
            >
              {t.label}
              {t.count != null && t.count > 0 && (
                <span
                  className={`tabular-nums rounded-full px-1.5 text-[10px] ${
                    t.id === 'cola' ? 'bg-[#FF6600] text-white' : 'bg-white/10 text-white/60'
                  }`}
                >
                  {t.count}
                </span>
              )}
              {t.caducan != null && t.caducan > 0 && (
                <span className="tabular-nums rounded-full px-1.5 text-[10px] border border-yellow-500/40 bg-yellow-400/[0.12] text-yellow-300">
                  {t.caducan} caducan
                </span>
              )}
            </button>
          ))}
        </div>

        {data.missingTables ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-[12px] text-white/75 leading-relaxed">
            Las tablas de vacaciones todavía no existen en la base de datos. Pega{' '}
            <code className="text-amber-200">supabase/migrations/116_vacations.sql</code> y luego{' '}
            <code className="text-amber-200">117_employees_betty_y_enlaces.sql</code> en el editor
            SQL de Supabase, en ese orden. El resto de Control empleados sigue funcionando
            mientras tanto.
          </div>
        ) : (
          <>
            {/* ---------- Cola ---------- */}
            {tab === 'cola' &&
              (pendientes.length === 0 ? (
                <Vacio
                  titulo="No hay nada que aprobar"
                  texto="Cuando alguien pida días, aparecerán aquí con lo que le costaría y cómo le quedaría el saldo."
                />
              ) : (
                <div className="space-y-2">
                  {pendientes.map((r) => {
                    const employee = byId.get(r.employee_id)
                    if (!employee) return null
                    return (
                      <PeticionCard
                        key={r.id}
                        request={r}
                        employee={employee}
                        people={data.people}
                        balance={balanceParaPeticion(r)}
                        today={data.today}
                        showName
                        isAdmin
                        busy={busyId === r.id}
                        onApprove={() => resolve(`/api/vacations/${r.id}/approve`, r.id)}
                        onReject={(reason) =>
                          resolve(`/api/vacations/${r.id}/reject`, r.id, { reason })
                        }
                        onCancel={() => resolve(`/api/vacations/${r.id}/cancel`, r.id)}
                      />
                    )
                  })}
                </div>
              ))}

            {/* ---------- Saldos ---------- */}
            {tab === 'saldos' && (
              <div className="space-y-3">
                {/* Amarillo y no ámbar: es el código de aviso del ERP y el único
                    que la capa `html.light` de globals.css traduce. En ámbar
                    este resumen salía a 1,20:1 sobre tema claro. */}
                {caducan.length > 0 && (
                  <div className="rounded-lg border border-yellow-500/25 bg-yellow-400/[0.06] px-2.5 py-2 text-[11px] text-yellow-300 leading-relaxed">
                    <p className="flex items-start gap-1.5">
                      <AlarmClock className="h-3.5 w-3.5 flex-shrink-0 mt-px" />
                      <span>
                        <strong className="font-semibold">
                          Caducan días el {formatDayLong(caducan[0].balance.carriedExpiresOn)}
                        </strong>
                        : lo que sobró de {anyo - 1} solo se puede coger hasta esa fecha. El 1 de
                        abril se pierde.
                      </span>
                    </p>
                    <ul className="mt-1 ml-5 space-y-0.5">
                      {caducan.map(({ employee, balance }) => (
                        <li key={employee.id} className="tabular-nums">
                          {employee.name}: {formatDays(balance.carriedLeft)}
                          {!employee.user_id && ' (sin cuenta: no puede verlo)'}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {sinCuenta.length > 0 && (
                  <p className="flex items-start gap-1.5 text-[11px] text-white/45 leading-snug">
                    <UserX className="h-3 w-3 flex-shrink-0 mt-0.5" />
                    <span>
                      {sinCuenta.map((e) => e.name).join(' y ')}{' '}
                      {sinCuenta.length === 1 ? 'no tiene cuenta' : 'no tienen cuenta'} en el ERP:{' '}
                      {sinCuenta.length === 1 ? 'no puede entrar' : 'no pueden entrar'} a pedir
                      vacaciones ni a mirar su saldo. Regístraselas desde «Registrar petición», o
                      créales usuario y enlázalo desde su ficha.
                    </span>
                  </p>
                )}

                {balances.length === 0 ? (
                  <Vacio
                    titulo="Nadie genera vacaciones todavía"
                    texto="El derecho es un campo de la ficha: abre a esa persona en Control empleados y ponle los días que genera por mes."
                  />
                ) : (
                  balances.map(({ employee, balance }) => (
                    <div key={employee.id} className="space-y-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <p className="text-[13px] font-semibold text-white truncate">
                          {employee.name}
                        </p>
                        {!employee.user_id && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-white/40 border border-white/15 rounded-full px-1.5 py-0.5 flex-shrink-0">
                            <UserX className="h-2.5 w-2.5" />
                            Sin cuenta
                          </span>
                        )}
                        {employee.ended_on && (
                          <span className="text-[10px] uppercase tracking-wider text-white/35 border border-white/15 rounded-full px-2 py-0.5 flex-shrink-0">
                            De baja
                          </span>
                        )}
                      </div>
                      {/* El resumen de caducidad de arriba ya lista a todo el
                          mundo con su cifra: repetirlo dentro de cada ficha
                          llenaba el modal de copias del mismo párrafo. */}
                      <BalanceResumen
                        employee={employee}
                        balance={balance}
                        sinAvisoCaducidad={caducan.length > 0}
                        onEditFicha={onOpenFicha ? () => onOpenFicha(employee.id) : undefined}
                      />
                    </div>
                  ))
                )}
              </div>
            )}

            {/* ---------- Historial ---------- */}
            {tab === 'historial' &&
              (historial.length === 0 ? (
                <Vacio
                  titulo="Todavía no se ha resuelto ninguna petición"
                  texto="Aquí quedan las aprobadas, las rechazadas y las retiradas, con quién las decidió. Desde una aprobada se pueden anular los días para que vuelvan al saldo."
                />
              ) : (
                <div className="space-y-2">
                  <p className="text-[11px] text-white/40 leading-snug">
                    Los días que cada persona tiene canjeados. Si unas vacaciones aprobadas al
                    final no se cogen, se anulan desde su tarjeta y los días vuelven al saldo: sin
                    eso se quedarían gastados para siempre.
                  </p>
                  {historial.map((r) => {
                    const employee = byId.get(r.employee_id)
                    if (!employee) return null
                    return (
                      <PeticionCard
                        key={r.id}
                        request={r}
                        employee={employee}
                        people={data.people}
                        balance={balanceParaPeticion(r)}
                        today={data.today}
                        showName
                        isAdmin
                        busy={busyId === r.id}
                        onCancel={() => {
                          // Anular unas vacaciones ya concedidas le devuelve los
                          // días al saldo y le cambia los planes a alguien: se
                          // pregunta antes, al revés que rechazar una que aún
                          // espera respuesta.
                          if (
                            !confirm(
                              `¿Anulas las vacaciones aprobadas de ${employee.name}? Los ${formatDays(
                                r.working_days
                              )} vuelven a su saldo y queda anotado que las has anulado tú.`
                            )
                          ) {
                            return
                          }
                          resolve(`/api/vacations/${r.id}/cancel`, r.id)
                        }}
                      />
                    )
                  })}
                </div>
              ))}

            {/* ---------- Registrar en nombre de alguien ---------- */}
            {tab === 'registrar' && (
              <div className="space-y-3">
                {conDerecho.length === 0 ? (
                  <Vacio
                    titulo="No hay a quién pedirle vacaciones"
                    texto="Ponle a alguien los días que genera por mes en su ficha de Control empleados y aparecerá aquí."
                  />
                ) : (
                  <>
                    <div>
                      <label
                        htmlFor="vac-persona"
                        className="text-[10px] uppercase tracking-wider text-white/45 block mb-1"
                      >
                        A nombre de
                      </label>
                      <select
                        id="vac-persona"
                        value={persona?.id ?? ''}
                        onChange={(e) => setPersonId(e.target.value)}
                        className={`${fieldInput} [color-scheme:dark]`}
                      >
                        {conDerecho.map((e) => (
                          <option key={e.id} value={e.id} className="bg-[#1a1a1a]">
                            {e.name}
                            {e.user_id ? '' : ' — sin cuenta en el ERP'}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-[10px] text-white/30">
                        Queda anotado que la has registrado tú, no la persona.
                      </p>
                    </div>

                    {persona && (
                      <>
                        {/* Esta cifra es la de HOY. En cuanto se eligen fechas,
                            el resumen del formulario da la del año de ESAS
                            fechas, que puede ser otro: sin la coletilla, los dos
                            números quedaban uno encima del otro y se leían como
                            una contradicción. */}
                        <div className={`${cardShell} px-2.5 py-2`}>
                          <p className="text-[10px] uppercase tracking-wider text-white/35 mb-1">
                            Saldo de {persona.name} en {anyo}
                          </p>
                          <p className="text-[12px] text-white/60 tabular-nums">
                            {formatDays(
                              balanceOf.get(persona.id)?.available ??
                                vacationBalance(persona, data.requests, data.today).available
                            )}{' '}
                            disponibles
                          </p>
                          <p className="text-[10px] text-white/30 mt-1 leading-snug">
                            Es el saldo de {anyo}. Si eliges fechas de otro año, el resumen de abajo
                            manda: cada día sale del saldo del año en que cae.
                          </p>
                        </div>

                        <PeticionForm
                          key={persona.id}
                          employee={persona}
                          requests={data.requests.filter((r) => r.employee_id === persona.id)}
                          today={data.today}
                          onBehalf
                          onDone={(fresh) => {
                            onData(fresh)
                            setTab('cola')
                          }}
                        />
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </>
        )}
      </motion.div>
    </div>
  )
}

function Vacio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="rounded-xl border border-dashed border-white/15 px-4 py-8 text-center">
      <Inbox className="h-5 w-5 text-white/20 mx-auto mb-2" />
      <p className="text-[13px] text-white/60">{titulo}</p>
      <p className="text-[11px] text-white/35 mt-1 max-w-sm mx-auto leading-relaxed">{texto}</p>
    </div>
  )
}
