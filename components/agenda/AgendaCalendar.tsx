'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as EventoDePuntero } from 'react'
import dynamic from 'next/dynamic'
import { toast } from 'sonner'
import { addDays, addWeeks, format, getISOWeek, isSameDay } from 'date-fns'
import { es } from 'date-fns/locale'
import { toMadrid, fromMadrid, madridWallClockString } from '@/lib/timezone'
import { DURACION_CITA_MS } from '@/lib/agenda/duracion'
import { agruparPorDia, colocarCitas, huecoDeLaRejilla, REJILLA } from '@/lib/agenda/colocar'
import { claveDeSemana, lunesDeLaClave, lunesDeLaSemana, semanasAlrededor } from '@/lib/agenda/semanas'
import { colorForAgent, type AppointmentWithPeople, type CalendarPerson } from '@/lib/types/appointments'
import type { AvailabilityWindow } from '@/lib/types/availability'
import type { UserProfile } from '@/lib/supabase/get-user-profile'
import { BarraDeAgenda, type PersonaDeLaLeyenda } from './BarraDeAgenda'
import { RejillaSemanal, type CapaDelDia, type DestinoDeArrastre } from './RejillaSemanal'
import { useCitas } from './useCitas'
import { usePresencia, type FichaAbierta } from './usePresencia'
import { useEstable } from './useEstable'

/**
 * El código de las fichas se baja aparte: no hace falta para PINTAR la agenda, solo al pulsar una cita, y pesa lo suyo (editor de la ficha, grabadora de audio,
 * transcripción, comentarios). Se descarga ya, con el navegador parado, para que el primer clic no espere; los datos de cada cita se piden al abrirla, como siempre.
 */
const cargarFicha = () => import('./AppointmentSheet').then((m) => m.AppointmentSheet)
const AppointmentSheet = dynamic(cargarFicha, { ssr: false })
const AppointmentConfirmation = dynamic(() => import('./AppointmentConfirmation').then((m) => m.AppointmentConfirmation), { ssr: false })
const AvailabilitySettings = dynamic(() => import('./AvailabilitySettings').then((m) => m.AvailabilitySettings), { ssr: false })

interface AgendaCalendarProps {
  initialAppointments: AppointmentWithPeople[]
  /** Los lunes («2026-10-19») de las semanas que `initialAppointments` ya trae completas */
  semanasIniciales: string[]
  /** El lunes («2026-10-26») de la semana con la que se abre */
  semanaInicial: string
  team: CalendarPerson[]
  currentUser: UserProfile
  initialAvailabilityWindows?: AvailabilityWindow[]
}

type Cita = AppointmentWithPeople

type Hoja = { mode: 'create'; prefill: { start: Date; end: Date } } | { mode: 'edit'; appointment: Cita }

const GOOGLE = 'google'

/**
 * CUÁNTO DURA UNA CITA RECIÉN CREADA.
 *
 * Una hora. Eran 30 minutos y no daba: la sesión que agenda un comercial es una consultoría, no una llamada de encaje, y acababa pisando la siguiente del calendario o
 * corrigiéndose a mano una por una. Para un comercial es además LA DURACIÓN FIJA (lib/agenda/duracion.ts): la hora de fin ya no se puede cambiar en la ficha, ni al
 * arrastrar la cita a otra hora, y la ruta del servidor impone la hora aunque el navegador mande otra. Los administradores y los socios sí pueden dejarla en media hora.
 *
 * La rejilla sigue en tramos de 30 minutos a propósito: eso es dónde EMPIEZA una cita, y poder empezar a y media no tiene nada que ver con cuánto dura.
 */
const DURACION_NUEVA_CITA_MS = DURACION_CITA_MS

/**
 * La hora de fin con la que nace una cita: una hora más tarde, SIN PASARSE DEL final del día.
 *
 * El tope importa porque la rejilla deja empezar a las 20:30 y el día acaba a las 21:00: una hora entera desde ahí terminaría a las 21:30, o sea media hora por debajo del
 * último tramo pintado. Se recorta el fin, no se mueve el inicio: quien ha pinchado en las 20:30 ha dicho a qué hora empieza, y eso no se le toca.
 *
 * Y EL TOPE NO PUEDE DEJAR EL FIN ANTES QUE EL INICIO. El botón «Nueva cita» redondea la hora de AHORA al siguiente :00 o :30 y no la obliga a caer dentro del horario: a
 * las 20:40 el inicio sale a las 21:00 y recortar al cierre devolvía fin igual que inicio, y la ficha se negaba a guardarse. El recorte solo tiene sentido si el cierre va
 * DESPUÉS del inicio; para una cita que empieza fuera del horario, la hora entera y en paz.
 */
function finPorDefecto(start: Date) {
  const fin = new Date(start.getTime() + DURACION_NUEVA_CITA_MS)
  const enMadrid = toMadrid(fin)
  const minutosDeFin = enMadrid.getHours() * 60 + enMadrid.getMinutes()
  const cierre = REJILLA.finDia * 60
  // Pasarse de día cuenta como pasarse: a las 00:30 los minutos salen 30 y parecerían dentro del horario
  const otroDia = !isSameDay(enMadrid, toMadrid(start))
  if (!otroDia && minutosDeFin <= cierre) return fin
  const alCierre = fromMadrid(madridWallClockString(toMadrid(start), REJILLA.finDia, 0))
  return alCierre.getTime() > start.getTime() ? alCierre : fin
}

const claveDeDia = (d: Date) => format(d, 'yyyy-MM-dd')

export function AgendaCalendar({ initialAppointments, semanasIniciales, semanaInicial, team, currentUser, initialAvailabilityWindows }: AgendaCalendarProps) {
  const [weekStart, setWeekStart] = useState<Date>(() => lunesDeLaClave(semanaInicial) ?? lunesDeLaSemana(new Date()))
  const [direction, setDirection] = useState(0)
  const [sheet, setSheet] = useState<Hoja | null>(null)
  // Resumen que sale tras agendar, para capturarlo y pasarlo al grupo
  const [confirmation, setConfirmation] = useState<Cita | null>(null)
  const [resyncing, setResyncing] = useState(false)
  const [now, setNow] = useState(() => toMadrid(new Date()))
  const isAdmin = currentUser.role === 'admin' || currentUser.role === 'partner'
  const contenedorRef = useRef<HTMLDivElement>(null)
  const [availabilityWindows, setAvailabilityWindows] = useState<AvailabilityWindow[]>(initialAvailabilityWindows ?? [])
  const [showAvailabilitySettings, setShowAvailabilitySettings] = useState(false)

  const datos = useCitas(initialAppointments, semanasIniciales, (m) => toast.error(m))
  const citasRef = useRef(datos.citas)
  citasRef.current = datos.citas

  const ficha = useMemo<FichaAbierta>(() => {
    if (!sheet) return null
    return sheet.mode === 'create' ? { modo: 'create', inicio: sheet.prefill.start } : { modo: 'edit', citaId: sheet.appointment.id }
  }, [sheet])
  const presencia = usePresencia(currentUser, ficha)

  // ── A quién se ve: lo apagado se recuerda en este navegador ──
  const claveDeAlmacen = `agenda:ocultos:${currentUser.id}`
  const [ocultos, setOcultos] = useState<ReadonlySet<string>>(() => new Set())
  useEffect(() => {
    try {
      const guardado = JSON.parse(localStorage.getItem(claveDeAlmacen) ?? '[]')
      if (Array.isArray(guardado)) setOcultos(new Set(guardado.filter((x): x is string => typeof x === 'string')))
    } catch {
      // Sin almacenamiento (ventana privada, bloqueado): se ve todo, como siempre
    }
  }, [claveDeAlmacen])
  const alternar = useCallback(
    (id: string) => {
      setOcultos((prev) => {
        const sig = new Set(prev)
        if (sig.has(id)) sig.delete(id)
        else sig.add(id)
        try {
          localStorage.setItem(claveDeAlmacen, JSON.stringify([...sig]))
        } catch {
          // Se aplica igual en esta sesión aunque no se pueda recordar
        }
        return sig
      })
    },
    [claveDeAlmacen]
  )

  // Reloj para la línea de «ahora» (siempre en hora de España)
  useEffect(() => {
    const id = setInterval(() => setNow(toMadrid(new Date())), 60_000)
    return () => clearInterval(id)
  }, [])

  // Centrar el scroll cerca de la hora actual (España) al montar
  useEffect(() => {
    if (!contenedorRef.current) return
    const h = toMadrid(new Date()).getHours()
    contenedorRef.current.scrollTop = Math.max(0, (h - REJILLA.inicioDia - 1) * REJILLA.alturaHora)
  }, [])

  // El código de las fichas, ya descargado cuando el navegador está parado
  useEffect(() => {
    const precargar = () => void cargarFicha()
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(precargar, { timeout: 4000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(precargar, 2500)
    return () => window.clearTimeout(id)
  }, [])

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])

  // En móvil no caben siete columnas: se enseña un día y las flechas pasan de día en día en vez de de semana en semana
  const [isMobile, setIsMobile] = useState(false)
  const [mobileDayIndex, setMobileDayIndex] = useState(0)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1023px)')
    const apply = () => setIsMobile(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // Al entrar en móvil se abre en el día de hoy si está en la semana. Solo al ENTRAR: si dependiera también de la semana, cada cambio de semana
  // pisaría el día al que acababa de llegar quien pulsa «anterior» desde un lunes
  useEffect(() => {
    if (!isMobile) return
    const idx = days.findIndex((d) => isSameDay(d, toMadrid(new Date())))
    setMobileDayIndex(idx >= 0 ? idx : 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMobile])

  const visibleDays = useMemo(() => (isMobile ? [days[Math.min(mobileDayIndex, 6)]] : days), [isMobile, days, mobileDayIndex])

  function goToWeek(newStart: Date, dir: number) {
    setDirection(dir)
    setWeekStart(newStart)
  }

  /** Un día atrás/adelante en móvil, una semana en escritorio */
  function step(dir: 1 | -1) {
    if (!isMobile) {
      goToWeek(addWeeks(weekStart, dir), dir)
      return
    }
    const next = mobileDayIndex + dir
    if (next < 0) {
      goToWeek(addWeeks(weekStart, -1), -1)
      setMobileDayIndex(6)
    } else if (next > 6) {
      goToWeek(addWeeks(weekStart, 1), 1)
      setMobileDayIndex(0)
    } else {
      setDirection(dir)
      setMobileDayIndex(next)
    }
  }

  function irAHoy() {
    goToWeek(lunesDeLaSemana(new Date()), 0)
    if (isMobile) setMobileDayIndex((toMadrid(new Date()).getDay() + 6) % 7)
  }

  function irAFecha(valor: string) {
    const lunes = lunesDeLaClave(valor)
    if (!lunes) return
    goToWeek(lunes, lunes.getTime() >= weekStart.getTime() ? 1 : -1)
    if (isMobile) {
      const [y, m, d] = valor.split('-').map(Number)
      setMobileDayIndex((new Date(y, m - 1, d).getDay() + 6) % 7)
    }
  }

  // La semana que se mira y las dos de al lado, siempre en memoria: la de después se pide antes de que se llegue a ella
  const { asegurar } = datos
  useEffect(() => {
    asegurar(semanasAlrededor(weekStart, 1, 1))
  }, [weekStart, asegurar])

  // ── Qué se pinta ──
  const visibles = useMemo(
    () =>
      datos.citas.filter((a) => {
        if (a.is_external) return !ocultos.has(GOOGLE)
        return !(a.comercial_id && ocultos.has(a.comercial_id))
      }),
    [datos.citas, ocultos]
  )

  /** Las citas de cada día visible ya colocadas: los huecos de Google en una capa y las del ERP en otra */
  const capas = useMemo(() => {
    const porDia = agruparPorDia(visibles)
    const mapa = new Map<string, CapaDelDia>()
    for (const d of visibleDays) {
      const clave = claveDeDia(d)
      const delDia = porDia.get(clave) ?? []
      mapa.set(clave, {
        externas: colocarCitas(delDia.filter((a) => a.is_external)),
        propias: colocarCitas(delDia.filter((a) => !a.is_external)),
      })
    }
    return mapa
  }, [visibles, visibleDays])

  const conteo = useMemo(() => {
    const m = new Map<string, number>()
    capas.forEach((capa, clave) => m.set(clave, capa.propias.length))
    return m
  }, [capas])
  const totalVisible = useMemo(() => [...conteo.values()].reduce((a, b) => a + b, 0), [conteo])

  // Citas del ERP por comercial en lo que se ve, aunque su persona esté apagada (es lo que dice la cifra de su pastilla)
  const gente = useMemo<PersonaDeLaLeyenda[]>(() => {
    const dias = new Set(visibleDays.map(claveDeDia))
    const cuenta = new Map<string, number>()
    for (const a of datos.citas) {
      if (a.is_external || !a.comercial_id) continue
      if (!dias.has(claveDeDia(toMadrid(a.start_time)))) continue
      cuenta.set(a.comercial_id, (cuenta.get(a.comercial_id) ?? 0) + 1)
    }
    // Solo los comerciales (filtrados en el servidor), no cualquiera que haya agendado una cita (p. ej. un admin haciendo una prueba)
    return team.map((p) => ({
      id: p.id,
      nombre: p.full_name || p.email || 'Sin nombre',
      color: colorForAgent(p.id, p.calendar_color),
      cuenta: cuenta.get(p.id) ?? 0,
      visible: !ocultos.has(p.id),
    }))
  }, [team, datos.citas, visibleDays, ocultos])

  // En móvil el título es el día que se está viendo, no el rango de la semana: es la única referencia que tiene el usuario de dónde está
  const etiqueta = useMemo(() => {
    if (isMobile) return format(visibleDays[0] ?? weekStart, "EEEE d 'de' MMM", { locale: es })
    const fin = addDays(weekStart, 6)
    return weekStart.getFullYear() === fin.getFullYear()
      ? `${format(weekStart, 'd MMM', { locale: es })} – ${format(fin, 'd MMM yyyy', { locale: es })}`
      : `${format(weekStart, 'd MMM yyyy', { locale: es })} – ${format(fin, 'd MMM yyyy', { locale: es })}`
  }, [isMobile, visibleDays, weekStart])

  // ── Agendar ──
  function nuevaCita() {
    const start = new Date()
    const roundedMinutes = start.getMinutes() < 30 ? 30 : 0
    start.setMinutes(roundedMinutes, 0, 0)
    if (roundedMinutes === 0) start.setHours(start.getHours() + 1)
    setSheet({ mode: 'create', prefill: { start, end: finPorDefecto(start) } })
  }

  // ── Arrastrar una cita a otra hora ──
  const [arrastrando, setArrastrando] = useState<{ cita: Cita; destino: DestinoDeArrastre | null } | null>(null)
  const destinoRef = useRef<DestinoDeArrastre | null>(null)
  const justDraggedRef = useRef(false)

  /** Soltar un arrastre también dispara un clic: este lo gasta (una vez) para que no abra ni agende nada */
  const consumirArrastre = useEstable(() => {
    if (!justDraggedRef.current) return false
    justDraggedRef.current = false
    return true
  })

  /** El hueco de la rejilla que hay bajo el puntero: la columna de día más cercana en horizontal y el tramo de media hora en vertical */
  function huecoBajoElPuntero(x: number, y: number): DestinoDeArrastre | null {
    const columnas = Array.from(contenedorRef.current?.querySelectorAll<HTMLElement>('[data-dia]') ?? [])
    if (columnas.length === 0) return null
    let elegida = columnas[0]
    let distancia = Infinity
    for (const c of columnas) {
      const r = c.getBoundingClientRect()
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0
      if (d < distancia) {
        distancia = d
        elegida = c
      }
    }
    const { hour, minute } = huecoDeLaRejilla(y - elegida.getBoundingClientRect().top)
    return { dia: elegida.dataset.dia as string, hour, minute }
  }

  /**
   * Arranca en pointerdown pero NO activa el modo «arrastrando» hasta que el puntero se mueva más de un pequeño umbral. Así un clic normal (sin mover el ratón) nunca
   * oculta la cita ni interfiere con el clic que abre la ficha — solo un arrastre real la convierte en un drag.
   */
  const empezarArrastre = useEstable((e: EventoDePuntero, a: Cita) => {
    const puede = !a.is_external && (isAdmin || a.comercial_id === currentUser.id)
    if (!puede) return
    e.stopPropagation()

    const inicio = toMadrid(a.start_time)
    const diaOrigen = claveDeDia(inicio)
    if (!visibleDays.some((d) => claveDeDia(d) === diaOrigen)) return
    const origen: DestinoDeArrastre = { dia: diaOrigen, hour: inicio.getHours(), minute: inicio.getMinutes() }
    const x0 = e.clientX
    const y0 = e.clientY
    const UMBRAL = 6
    let arrastrandoYa = false

    function alMover(ev: PointerEvent) {
      if (!arrastrandoYa) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < UMBRAL) return
        arrastrandoYa = true
        destinoRef.current = origen
        setArrastrando({ cita: a, destino: origen })
        document.body.style.userSelect = 'none'
      }
      const hueco = huecoBajoElPuntero(ev.clientX, ev.clientY)
      if (!hueco) return
      const previo = destinoRef.current
      if (previo && previo.dia === hueco.dia && previo.hour === hueco.hour && previo.minute === hueco.minute) return
      destinoRef.current = hueco
      setArrastrando({ cita: a, destino: hueco })
    }

    function alSoltar() {
      window.removeEventListener('pointermove', alMover)
      window.removeEventListener('pointerup', alSoltar)
      document.body.style.userSelect = ''
      if (!arrastrandoYa) return // fue un clic normal, no un arrastre

      const destino = destinoRef.current
      destinoRef.current = null
      setArrastrando(null)
      // El clic que sigue a soltar se gasta; y si no llega ninguno, la marca se quita sola al acabar este turno para no tragarse el siguiente de verdad
      justDraggedRef.current = true
      setTimeout(() => {
        justDraggedRef.current = false
      }, 0)
      const movido = !!destino && (destino.dia !== origen.dia || destino.hour !== origen.hour || destino.minute !== origen.minute)
      if (movido && destino) void confirmarArrastre(a.id, destino)
    }

    window.addEventListener('pointermove', alMover)
    window.addEventListener('pointerup', alSoltar)
  })

  async function confirmarArrastre(id: string, destino: DestinoDeArrastre) {
    const original = citasRef.current.find((a) => a.id === id)
    const dia = days.find((d) => claveDeDia(d) === destino.dia)
    if (!original || !dia) return

    // Al reagendar, un comercial deja la cita en una hora (una antigua de media hora también); un administrador conserva la duración que tuviera
    const durationMs = isAdmin ? new Date(original.end_time).getTime() - new Date(original.start_time).getTime() : DURACION_CITA_MS
    const newStart = fromMadrid(madridWallClockString(dia, destino.hour, destino.minute))
    const newEnd = new Date(newStart.getTime() + durationMs)

    // Se ve ya en su sitio nuevo; si el servidor dice que no, vuelve
    datos.modificar(id, (a) => ({ ...a, start_time: newStart.toISOString(), end_time: newEnd.toISOString() }))

    try {
      const res = await fetch(`/api/appointments/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lead_name: original.lead_name,
          lead_email: original.lead_email,
          lead_phone: original.lead_phone,
          lead_company: original.lead_company,
          assigned_closer_id: original.assigned_closer_id,
          start_time: newStart.toISOString(),
          end_time: newEnd.toISOString(),
          status: original.status,
          notes: original.notes,
          revenue_amount: original.revenue_amount,
          call_date: original.call_date,
          amazon_link: original.amazon_link,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error al mover la cita')
      datos.poner(data as Cita)
      toast.success('Cita reagendada')
    } catch (err) {
      console.error('Error moving appointment:', err)
      toast.error('No se pudo mover la cita')
      datos.poner(original)
    }
  }

  const abrirHueco = useEstable((day: Date, hour: number, minute: number) => {
    const start = fromMadrid(madridWallClockString(day, hour, minute))
    setSheet({ mode: 'create', prefill: { start, end: finPorDefecto(start) } })
  })

  const abrirCita = useEstable((cita: Cita) => {
    if (consumirArrastre()) return
    setSheet({ mode: 'edit', appointment: cita })
  })

  // `created` lo manda la ficha según su modo. No se puede deducir de si la cita ya está en la lista: el tiempo real la mete antes de que termine el guardado
  function guardada(appt: Cita, created = false) {
    datos.poner(appt)
    setSheet(null)
    if (created) setConfirmation(appt)
  }

  /**
   * Fuerza la recarga completa desde Google en vez de esperar al ciclo de cada 4 horas. Al terminar se vuelve a leer lo que se está mirando, porque el resincronizado
   * puede haber borrado huecos que ya no existen; el resto de semanas se piden de nuevo cuando se navegue a ellas.
   */
  async function sincronizar() {
    setResyncing(true)
    try {
      const res = await fetch('/api/appointments/resync', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'No se pudo sincronizar')
      await datos.recargar(weekStart)

      const partes = [
        data.imported ? `${data.imported} nuevos` : null,
        data.updated ? `${data.updated} actualizados` : null,
        data.pruned ? `${data.pruned} eliminados` : null,
      ].filter(Boolean)
      toast.success(partes.length > 0 ? `Sincronizado: ${partes.join(', ')}` : 'Ya estaba todo al día')
    } catch (err) {
      console.error('Error resincronizando:', err)
      toast.error((err as Error).message)
    } finally {
      setResyncing(false)
    }
  }

  const hoy = claveDeDia(now)

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col gap-2.5">
      <BarraDeAgenda
        etiqueta={etiqueta}
        semana={isMobile ? null : getISOWeek(weekStart)}
        movil={isMobile}
        esAdmin={isAdmin}
        sincronizando={resyncing}
        cargando={datos.cargando}
        gente={gente}
        verGoogle={!ocultos.has(GOOGLE)}
        totalVisible={totalVisible}
        onAnterior={() => step(-1)}
        onSiguiente={() => step(1)}
        onHoy={irAHoy}
        onIrA={irAFecha}
        onSincronizar={sincronizar}
        onDisponibilidad={() => setShowAvailabilitySettings(true)}
        onNueva={nuevaCita}
        onAlternarPersona={alternar}
        onAlternarGoogle={() => alternar(GOOGLE)}
      />

      <RejillaSemanal
        dias={visibleDays}
        movil={isMobile}
        claveDeSemana={`${claveDeSemana(weekStart)}${isMobile ? `-${mobileDayIndex}` : ''}`}
        direccion={direction}
        capas={capas}
        conteo={conteo}
        ventanas={availabilityWindows}
        presencia={presencia}
        ahora={now}
        hoy={hoy}
        arrastrando={arrastrando}
        esAdmin={isAdmin}
        usuarioId={currentUser.id}
        contenedorRef={contenedorRef}
        onHueco={abrirHueco}
        onAbrir={abrirCita}
        onArrastrar={empezarArrastre}
        consumirArrastre={consumirArrastre}
      />

      {sheet && (
        <AppointmentSheet
          mode={sheet.mode}
          appointment={sheet.mode === 'edit' ? sheet.appointment : null}
          prefill={sheet.mode === 'create' ? sheet.prefill : null}
          team={team}
          currentUser={currentUser}
          onClose={() => setSheet(null)}
          onSaved={(appt) => guardada(appt, sheet.mode === 'create')}
          onDeleted={(id) => {
            datos.quitar(id)
            setSheet(null)
          }}
        />
      )}

      {confirmation && <AppointmentConfirmation appointment={confirmation} onClose={() => setConfirmation(null)} />}

      {showAvailabilitySettings && (
        <AvailabilitySettings
          currentUser={currentUser}
          windows={availabilityWindows}
          onClose={() => setShowAvailabilitySettings(false)}
          onChange={setAvailabilityWindows}
        />
      )}
    </div>
  )
}
