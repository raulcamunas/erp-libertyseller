'use client'

import { Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { indexar, resultadoDePersona, seriesDeCifras, tramosDeComparacion, ventanaDeDatos, type FilaDiaria } from '@/lib/rendimiento/comparativa'
import { agruparConversaciones, citasAgendadas, itemsDeActividad, type FiltroDeActividad } from '@/lib/rendimiento/actividad'
import { diaMadrid, etiquetaDeDia, horaMadrid, mesDe, rangoDelMes, sumarMeses } from '@/lib/rendimiento/dia'
import { eventosDeLinea, minutoDeLaHora, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { agruparPorDia, mesDeLlamadas, resumenDeLlamadas } from '@/lib/rendimiento/metricas'
import { contieneHoy, diasDelRango, etiquetaDeRango, lunesDe, rangoDe, recortarA, type Periodo } from '@/lib/rendimiento/periodos'
import { BarraDePeriodo } from './BarraDePeriodo'
import { CalendarioLlamadas } from './CalendarioLlamadas'
import { CifrasDelPeriodo, type DestinoDeTarjeta } from './CifrasDelPeriodo'
import { ComparativaDelEquipo, type FilaDeComparativa } from './ComparativaDelEquipo'
import { LineaDelDia } from './LineaDelDia'
import { LineaDelEquipo } from './LineaDelEquipo'
import { ListaDeActividad } from './ListaDeActividad'
import { Esqueleto } from './ui'
import { ListaLlamadas, type NombreDeLead } from './ListaLlamadas'
import { leerCitas, leerLlamadasDelEquipo, leerNombres, leerNotas, type CitaConComercial, type LlamadaDeEquipo, type NotaConAutor } from './lecturas'
import { CAMPOS_DEL_VINCULO, CAMPOS_DE_LLAMADA, type LlamadaGuardada, type Miembro, type VinculoVisible } from './tipos'
import { VincularRinkel } from './VincularRinkel'

/**
 * EL PANEL DE RENDIMIENTO: UN DÍA, UNA SEMANA O UN MES, COMPARADO.
 *
 * Arriba, la barra de periodo (Hoy, Ayer, Semana, Mes y las flechas) y, para quien supervisa, quién se mira: todo el
 * equipo o una persona. El periodo manda sobre toda la página. Quien supervisa aterriza en «Todo el equipo», con la
 * comparativa de cada comercial; cada comercial, en el suyo.
 *
 * LAS CIFRAS SALEN DE UNA FUNCIÓN DE LA BASE (rendimiento_resumen_diario, migración 235) que devuelve una fila por
 * persona y día: ni las llamadas ni las notas de varios meses viajan al navegador. De esas filas se suman las
 * cifras del periodo, se calcula la referencia con la que comparar y se pinta la tendencia (lib/rendimiento/comparativa.ts).
 * Lo único que baja «en crudo» es el detalle de UNA persona: sus llamadas (para el calendario, para escuchar las de un
 * día y para la línea del día), lo que apuntó en Cold Calling y las citas que agendó (para ver con qué cliente y qué
 * comentario puso en cada momento). Y, al mirar un día de todo el equipo, la actividad de ese día para dibujar la línea
 * de cada comercial.
 *
 * TODO SE LEE CON LA SESIÓN DE QUIEN MIRA, así que las políticas de la base deciden qué ve cada uno: lo suyo, o lo
 * de todo el equipo si supervisa. Cambiar de persona o de periodo no recarga la página: la dirección se actualiza
 * para poder compartirla o recargar en el mismo sitio.
 */

interface Props {
  yo: { id: string; nombre: string }
  /** El equipo comercial, con quién tiene Rinkel. Solo para quien supervisa; vacío si no */
  equipo: Miembro[]
  puedeSupervisar: boolean
  /** Es administrador: en el panel de otra persona puede vincular, cambiar o quitar su clave de Rinkel */
  puedeGestionar: boolean
  /** Tiene el permiso «Actividad del equipo» (o es administrador): se le enseña el botón que lleva a esa pantalla */
  puedeVerActividad?: boolean
  /** Para quien puede abrir «Configuración de correos»: administrador o con la casilla suelta */
  puedeConfigurarCorreos?: boolean
  /** Quien mira es del equipo comercial. Si no (un administrador), la invitación a vincular Rinkel no se resalta */
  esComercial: boolean
  /** El día de hoy en Madrid, «2026-10-22». Lo pone el servidor para que no baile entre servidor y navegador */
  hoy: string
  /** Los vínculos con Rinkel visibles para quien mira: el suyo, o los de todo el equipo si supervisa */
  vinculosIniciales: VinculoVisible[]
  /** La persona que pide la dirección. null = todo el equipo (solo quien supervisa) */
  personaInicial: string | null
  periodoInicial: Periodo
}

const REFRESCO_MS = 120_000

/** forzar: volver a leer aunque esté guardado. silencioso: sin atenuar la pantalla. todo: también lo que ya no cambia */
type Opciones = { forzar?: boolean; silencioso?: boolean; todo?: boolean }

type MesPedido = { anio: number; mes: number }
const claveDeMes = (id: string, m: MesPedido) => `${id}|${m.anio}-${m.mes}`
const claveDeMeses = (id: string, meses: readonly MesPedido[]) => `${id}|${meses.map((m) => `${m.anio}-${m.mes}`).join(',')}`

interface ActividadDePersona {
  clave: string
  notas: NotaConAutor[]
  citas: CitaConComercial[]
}

interface ActividadDelEquipo {
  clave: string
  llamadas: LlamadaDeEquipo[]
  notas: NotaConAutor[]
  citas: CitaConComercial[]
}

function agruparPor<T>(lista: readonly T[], clave: (x: T) => string | null): Map<string, T[]> {
  const grupos = new Map<string, T[]>()
  for (const x of lista) {
    const k = clave(x)
    if (k === null) continue
    const grupo = grupos.get(k)
    if (grupo) grupo.push(x)
    else grupos.set(k, [x])
  }
  return grupos
}

const primeraMayuscula = (t: string) => (t ? t[0].toUpperCase() + t.slice(1) : t)

export function PanelRendimiento({ yo, equipo, puedeSupervisar, puedeGestionar, puedeVerActividad = false, puedeConfigurarCorreos = false, esComercial, hoy, vinculosIniciales, personaInicial, periodoInicial }: Props) {
  const supabase = useMemo(() => createClient(), [])

  /* ---------------------------- quién y cuándo ---------------------------- */

  const [personaId, setPersonaId] = useState<string | null>(puedeSupervisar ? personaInicial : yo.id)
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial)
  /** El día que se ha pulsado en el calendario mientras se mira una semana o un mes (en un día, el día es el periodo) */
  const [focoManual, setFocoManual] = useState<string | null>(null)
  const [mesVisible, setMesVisible] = useState(() => mesDe(recortarA(rangoDe(periodoInicial), hoy)?.hasta ?? hoy))
  const [vinculos, setVinculos] = useState<ReadonlyMap<string, VinculoVisible>>(() => new Map(vinculosIniciales.map((v) => [v.user_id, v])))
  const [nombres, setNombres] = useState<ReadonlyMap<string, NombreDeLead>>(new Map())
  /** Qué se enseña en el detalle de la actividad: todo, solo WhatsApp, solo respuestas... */
  const [filtroActividad, setFiltroActividad] = useState<FiltroDeActividad>('todo')
  /** Los minutos desde las 00:00 de ahora mismo en Madrid. null hasta que el navegador lo mide (así no baila entre servidor y navegador) */
  const [ahoraMin, setAhoraMin] = useState<number | null>(null)

  const persona = useMemo(() => {
    if (personaId === null) return null
    if (personaId === yo.id) return { id: yo.id, nombre: yo.nombre }
    const m = equipo.find((x) => x.id === personaId)
    return m ? { id: m.id, nombre: m.nombre } : { id: yo.id, nombre: yo.nombre }
  }, [personaId, yo, equipo])
  const esPropio = persona?.id === yo.id

  // Quién tiene Rinkel, en vivo: si un administrador vincula o quita una clave aquí mismo, la tabla se entera
  const equipoVivo = useMemo(() => equipo.map((m) => ({ ...m, vinculado: vinculos.has(m.id) })), [equipo, vinculos])

  const rangoDelPeriodo = useMemo(() => rangoDe(periodo), [periodo])
  const comparacion = useMemo(() => tramosDeComparacion(periodo, hoy), [periodo, hoy])

  /* ---------------------------- las cifras: una fila por persona y día ---------------------------- */

  const ventana = useMemo(() => ventanaDeDatos(periodo), [periodo])
  const claveDeVentana = `${ventana.desde}|${ventana.hasta}`
  const [resumen, setResumen] = useState<{ clave: string; filas: FilaDiaria[] } | null>(null)
  const [cargandoResumen, setCargandoResumen] = useState(true)
  const [errorResumen, setErrorResumen] = useState<string | null>(null)
  const cacheResumen = useRef(new Map<string, FilaDiaria[]>())
  const peticionResumen = useRef(0)

  const cargarResumen = useCallback(
    async (v: { desde: string; hasta: string }, opciones: Opciones = {}) => {
      const clave = `${v.desde}|${v.hasta}`
      // Cada petición se numera ANTES de mirar la caché: una respuesta lenta de otro periodo no pisa al que se está viendo
      const numero = ++peticionResumen.current
      if (!opciones.forzar) {
        const guardado = cacheResumen.current.get(clave)
        if (guardado) {
          setResumen({ clave, filas: guardado })
          setErrorResumen(null)
          setCargandoResumen(false)
          return
        }
      }
      if (!opciones.silencioso) setCargandoResumen(true)
      try {
        // La función ordena por día y persona, así que paginar de 1.000 en 1.000 no repite ni se salta filas
        const filas = await fetchAll<FilaDiaria>((de, a) => supabase.rpc('rendimiento_resumen_diario', { p_desde: v.desde, p_hasta: v.hasta }).range(de, a))
        if (numero !== peticionResumen.current) return
        cacheResumen.current.set(clave, filas)
        setResumen({ clave, filas })
        setErrorResumen(null)
      } catch (error) {
        if (numero !== peticionResumen.current) return
        console.error('Rendimiento: no se han podido leer las cifras del periodo', error)
        setErrorResumen('No se han podido leer las cifras del periodo. Recarga la página.')
      } finally {
        if (numero === peticionResumen.current) setCargandoResumen(false)
      }
    },
    [supabase]
  )

  useEffect(() => {
    void cargarResumen(ventana)
  }, [ventana, cargarResumen])

  const porPersona = useMemo(() => indexar(resumen?.filas ?? []), [resumen])
  // Mientras llega la ventana nueva, lo que hay en pantalla es de la anterior: se atenúa en vez de enseñarlo como bueno
  const cargandoCifras = cargandoResumen || resumen?.clave !== claveDeVentana

  const resultadoDe = useCallback(
    (id: string) => resultadoDePersona(porPersona.get(id), periodo, hoy, comparacion, etiquetaDeRango),
    [porPersona, periodo, hoy, comparacion]
  )

  const filasDeComparativa = useMemo<FilaDeComparativa[]>(
    () => equipoVivo.filter((m) => m.comercial).map((m) => ({ id: m.id, nombre: m.nombre, vinculado: m.vinculado, resultado: resultadoDe(m.id) })),
    [equipoVivo, resultadoDe]
  )

  /* ---------------------------- las llamadas en crudo de la persona: calendario, lista y línea del día ---------------------------- */

  // Se leen los meses que hacen falta: el que enseña el calendario y los que toca el periodo (una semana puede cruzar de mes)
  const mesesAPedir = useMemo(() => {
    const meses = new Map<string, MesPedido>()
    const poner = (m: MesPedido) => meses.set(`${m.anio}-${m.mes}`, m)
    poner(mesVisible)
    const hastaHoy = recortarA(rangoDelPeriodo, hoy)
    if (hastaHoy) {
      poner(mesDe(hastaHoy.desde))
      poner(mesDe(hastaHoy.hasta))
    }
    return [...meses.values()]
  }, [mesVisible, rangoDelPeriodo, hoy])
  const claveDeLlamadas = persona ? claveDeMeses(persona.id, mesesAPedir) : null
  const [llamadasMes, setLlamadasMes] = useState<{ clave: string; llamadas: LlamadaGuardada[] } | null>(null)
  const [cargandoMes, setCargandoMes] = useState(false)
  const cacheMes = useRef(new Map<string, LlamadaGuardada[]>())
  const peticionMes = useRef(0)

  const cargarLlamadas = useCallback(
    async (id: string, meses: readonly MesPedido[], opciones: Opciones = {}) => {
      const clave = claveDeMeses(id, meses)
      const numero = ++peticionMes.current
      const mesDeHoy = mesDe(hoy)
      // Un mes que ya ha pasado no cambia: solo se vuelve a leer si se pide todo (por ejemplo, al vincular la clave de Rinkel)
      const hayQueLeer = (m: MesPedido) => {
        if (!cacheMes.current.has(claveDeMes(id, m))) return true
        if (!opciones.forzar) return false
        return opciones.todo === true || (m.anio === mesDeHoy.anio && m.mes === mesDeHoy.mes)
      }
      const juntar = () => meses.flatMap((m) => cacheMes.current.get(claveDeMes(id, m)) ?? [])
      const pendientes = meses.filter(hayQueLeer)
      if (pendientes.length === 0) {
        setLlamadasMes({ clave, llamadas: juntar() })
        setCargandoMes(false)
        return
      }
      if (!opciones.silencioso) setCargandoMes(true)
      try {
        const leidos = await Promise.all(
          pendientes.map(async (m) => {
            const { desde, hasta } = rangoDelMes(m.anio, m.mes)
            const delMes = await fetchAll<LlamadaGuardada>((de, a) =>
              supabase
                .from('rinkel_llamadas')
                .select(CAMPOS_DE_LLAMADA)
                .eq('user_id', id)
                .gte('fecha', desde.toISOString())
                .lt('fecha', hasta.toISOString())
                .order('fecha', { ascending: true })
                .order('id', { ascending: true })
                .range(de, a)
            )
            return { m, delMes }
          })
        )
        if (numero !== peticionMes.current) return
        for (const { m, delMes } of leidos) cacheMes.current.set(claveDeMes(id, m), delMes)
        setLlamadasMes({ clave, llamadas: juntar() })
      } catch (error) {
        if (numero !== peticionMes.current) return
        console.error('Rendimiento: no se han podido leer las llamadas', error)
        // Una lectura en segundo plano que falla no borra lo que ya se ve; la primera sí deja el hueco, y se nota
        if (!opciones.silencioso) setLlamadasMes({ clave, llamadas: [] })
      } finally {
        if (numero === peticionMes.current) setCargandoMes(false)
      }
    },
    [supabase, hoy]
  )

  useEffect(() => {
    if (persona) void cargarLlamadas(persona.id, mesesAPedir)
  }, [persona, mesesAPedir, cargarLlamadas])

  const llamadas = useMemo(() => (llamadasMes && llamadasMes.clave === claveDeLlamadas ? llamadasMes.llamadas : []), [llamadasMes, claveDeLlamadas])
  const delMes = useMemo(() => mesDeLlamadas(mesVisible.anio, mesVisible.mes, llamadas), [mesVisible, llamadas])
  const porDiaDeLlamadas = useMemo(() => agruparPorDia(llamadas), [llamadas])

  /** El día cuyas llamadas se enseñan: el del periodo si es un día; si no, el que se pulsó o el último con llamadas */
  const diaFoco = useMemo(() => {
    if (periodo.tipo === 'dia') return periodo.ancla
    if (focoManual && focoManual >= rangoDelPeriodo.desde && focoManual <= rangoDelPeriodo.hasta) return focoManual
    const dias = diasDelRango(recortarA(rangoDelPeriodo, hoy) ?? rangoDelPeriodo)
    for (let i = dias.length - 1; i >= 0; i -= 1) if ((porDiaDeLlamadas.get(dias[i])?.length ?? 0) > 0) return dias[i]
    return dias[dias.length - 1]
  }, [periodo, focoManual, rangoDelPeriodo, hoy, porDiaDeLlamadas])

  const llamadasDelDia = useMemo(() => porDiaDeLlamadas.get(diaFoco) ?? [], [porDiaDeLlamadas, diaFoco])

  /* ---------------------------- lo que apuntó la persona: conversaciones y citas del periodo ---------------------------- */

  const claveDeActividad = persona ? `${persona.id}|${rangoDelPeriodo.desde}|${rangoDelPeriodo.hasta}` : null
  const [actividad, setActividad] = useState<ActividadDePersona | null>(null)
  const [cargandoActividad, setCargandoActividad] = useState(false)
  const [errorActividad, setErrorActividad] = useState<string | null>(null)
  const cacheActividad = useRef(new Map<string, ActividadDePersona>())
  const peticionActividad = useRef(0)

  const cargarActividad = useCallback(
    async (id: string, rango: { desde: string; hasta: string }, opciones: Opciones = {}) => {
      const clave = `${id}|${rango.desde}|${rango.hasta}`
      const numero = ++peticionActividad.current
      if (!opciones.forzar) {
        const guardado = cacheActividad.current.get(clave)
        if (guardado) {
          setActividad(guardado)
          setErrorActividad(null)
          setCargandoActividad(false)
          return
        }
      }
      if (!opciones.silencioso) {
        setCargandoActividad(true)
        setErrorActividad(null)
      }
      try {
        const [notas, citas] = await Promise.all([leerNotas(supabase, rango, id), leerCitas(supabase, rango, id)])
        if (numero !== peticionActividad.current) return
        const leida = { clave, notas, citas }
        // Un periodo que ya ha acabado no cambia, y solo entonces se guarda. Si incluye hoy, se vuelve a leer siempre
        if (rango.hasta < hoy) cacheActividad.current.set(clave, leida)
        setActividad(leida)
        setErrorActividad(null)
      } catch (error) {
        if (numero !== peticionActividad.current) return
        console.error('Rendimiento: no se ha podido leer el detalle de la actividad', error)
        if (!opciones.silencioso) setErrorActividad('No se ha podido leer el detalle de la actividad. Recarga la página.')
      } finally {
        if (numero === peticionActividad.current) setCargandoActividad(false)
      }
    },
    [supabase, hoy]
  )

  useEffect(() => {
    if (persona) void cargarActividad(persona.id, rangoDelPeriodo)
  }, [persona, rangoDelPeriodo, cargarActividad])

  // Lo que hay en pantalla puede ser de la persona o del periodo anterior mientras llega lo nuevo: eso no se enseña como bueno
  const actividadActual = actividad && actividad.clave === claveDeActividad ? actividad : null
  const conversaciones = useMemo(() => agruparConversaciones(actividadActual?.notas ?? []), [actividadActual])
  const itemsDeLaLista = useMemo(() => itemsDeActividad(conversaciones, citasAgendadas(actividadActual?.citas ?? [])), [conversaciones, actividadActual])
  const leyendoActividad = persona !== null && actividadActual === null && errorActividad === null

  /* ---------------------------- el día de todo el equipo, para su línea ---------------------------- */

  const mirandoEquipoEnUnDia = puedeSupervisar && personaId === null && periodo.tipo === 'dia'
  const claveDeEquipo = mirandoEquipoEnUnDia ? periodo.ancla : null
  const [diaDeEquipo, setDiaDeEquipo] = useState<ActividadDelEquipo | null>(null)
  const [cargandoEquipo, setCargandoEquipo] = useState(false)
  const [errorEquipo, setErrorEquipo] = useState<string | null>(null)
  const cacheEquipo = useRef(new Map<string, ActividadDelEquipo>())
  const peticionEquipo = useRef(0)

  const cargarDiaDeEquipo = useCallback(
    async (dia: string, opciones: Opciones = {}) => {
      const numero = ++peticionEquipo.current
      if (!opciones.forzar) {
        const guardado = cacheEquipo.current.get(dia)
        if (guardado) {
          setDiaDeEquipo(guardado)
          setErrorEquipo(null)
          setCargandoEquipo(false)
          return
        }
      }
      if (!opciones.silencioso) {
        setCargandoEquipo(true)
        setErrorEquipo(null)
      }
      try {
        const rango = { desde: dia, hasta: dia }
        const [llamadasDelEquipo, notas, citas] = await Promise.all([leerLlamadasDelEquipo(supabase, rango), leerNotas(supabase, rango), leerCitas(supabase, rango)])
        if (numero !== peticionEquipo.current) return
        const leido = { clave: dia, llamadas: llamadasDelEquipo, notas, citas }
        if (dia < hoy) cacheEquipo.current.set(dia, leido)
        setDiaDeEquipo(leido)
        setErrorEquipo(null)
      } catch (error) {
        if (numero !== peticionEquipo.current) return
        console.error('Rendimiento: no se ha podido leer la actividad del equipo', error)
        if (!opciones.silencioso) setErrorEquipo('No se ha podido leer la actividad del equipo. Recarga la página.')
      } finally {
        if (numero === peticionEquipo.current) setCargandoEquipo(false)
      }
    },
    [supabase, hoy]
  )

  useEffect(() => {
    if (claveDeEquipo) void cargarDiaDeEquipo(claveDeEquipo)
  }, [claveDeEquipo, cargarDiaDeEquipo])

  /* ---------------------------- los nombres de los clientes ---------------------------- */

  const idsDeClientes = useMemo(() => {
    const ids = new Set<string>()
    for (const l of llamadasDelDia) if (l.lead_id) ids.add(l.lead_id)
    for (const c of conversaciones) ids.add(c.leadId)
    if (diaDeEquipo) {
      for (const l of diaDeEquipo.llamadas) if (l.lead_id) ids.add(l.lead_id)
      for (const n of diaDeEquipo.notas) ids.add(n.lead_id)
    }
    return [...ids]
  }, [llamadasDelDia, conversaciones, diaDeEquipo])

  const nombresPedidos = useRef(new Set<string>())
  useEffect(() => {
    const faltan = idsDeClientes.filter((id) => !nombresPedidos.current.has(id))
    if (faltan.length === 0) return
    faltan.forEach((id) => nombresPedidos.current.add(id))
    void (async () => {
      try {
        const encontrados = await leerNombres(supabase, faltan)
        // Un cliente que ya no existe o que no se puede ver se apunta vacío para no volver a pedirlo en bucle
        for (const id of faltan) if (!encontrados.has(id)) encontrados.set(id, { nombre: '', empresa: null })
        setNombres((antes) => {
          const ahora = new Map(antes)
          encontrados.forEach((v, k) => ahora.set(k, v))
          return ahora
        })
      } catch (error) {
        console.error('Rendimiento: no se han podido leer los nombres de los clientes', error)
        // Si ha fallado, se podrá volver a pedir la próxima vez que cambie la lista
        faltan.forEach((id) => nombresPedidos.current.delete(id))
      }
    })()
  }, [idsDeClientes, supabase])

  const nombresUtiles = useMemo(() => {
    const m = new Map<string, NombreDeLead>()
    nombres.forEach((v, k) => {
      if (v.nombre) m.set(k, v)
    })
    return m
  }, [nombres])

  /* ---------------------------- la línea del día ---------------------------- */

  const clienteDe = useCallback((id: string) => nombresUtiles.get(id)?.nombre ?? null, [nombresUtiles])

  // La hora de ahora mismo, para marcar «ahora» y lo que lleva alguien sin actividad. Solo corre si se está mirando hoy
  const miraHoy = diaFoco === hoy || claveDeEquipo === hoy
  useEffect(() => {
    if (!miraHoy) return
    const medir = () => setAhoraMin(minutoDeLaHora(horaMadrid(new Date())))
    medir()
    const reloj = setInterval(medir, 60_000)
    return () => clearInterval(reloj)
  }, [miraHoy])

  const eventosDeLaPersona = useMemo(
    () =>
      eventosDeLinea({
        llamadas: llamadasDelDia,
        notas: (actividadActual?.notas ?? []).filter((n) => diaMadrid(n.occurred_at) === diaFoco),
        citas: (actividadActual?.citas ?? []).filter((c) => diaMadrid(c.created_at) === diaFoco),
        cliente: clienteDe,
      }),
    [llamadasDelDia, actividadActual, diaFoco, clienteDe]
  )

  const personasDeLinea = useMemo(() => equipoVivo.filter((m) => m.comercial).map((m) => ({ id: m.id, nombre: m.nombre, vinculado: m.vinculado })), [equipoVivo])
  const eventosPorPersona = useMemo(() => {
    const mapa = new Map<string, EventoDeLinea[]>()
    if (!diaDeEquipo) return mapa
    const llamadasDe = agruparPor(diaDeEquipo.llamadas, (l) => l.user_id)
    const notasDe = agruparPor(diaDeEquipo.notas, (n) => n.author_id)
    const citasDe = agruparPor(diaDeEquipo.citas, (c) => c.comercial_id)
    for (const p of personasDeLinea) {
      mapa.set(p.id, eventosDeLinea({ llamadas: llamadasDe.get(p.id) ?? [], notas: notasDe.get(p.id) ?? [], citas: citasDe.get(p.id) ?? [], cliente: clienteDe }))
    }
    return mapa
  }, [diaDeEquipo, personasDeLinea, clienteDe])

  /* ---------------------------- moverse ---------------------------- */

  const cambiarPeriodo = useCallback(
    (p: Periodo) => {
      setPeriodo(p)
      setFocoManual(null)
      setMesVisible(mesDe(recortarA(rangoDe(p), hoy)?.hasta ?? p.ancla))
    },
    [hoy]
  )

  const elegirDia = (d: string) => {
    if (periodo.tipo === 'dia') cambiarPeriodo({ tipo: 'dia', ancla: d })
    else setFocoManual(d)
  }

  const cambiarDePersona = (id: string | null) => {
    setPersonaId(id)
    setFocoManual(null)
    setFiltroActividad('todo')
  }

  /** Pulsar una tarjeta de cifras lleva a la lista que hay detrás: las llamadas, o el detalle ya filtrado */
  const irA = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  const abrirTarjeta = (destino: DestinoDeTarjeta) => {
    if (destino === 'llamadas') {
      irA('llamadas-del-dia')
      return
    }
    setFiltroActividad(destino)
    irA('detalle-actividad')
  }

  // La dirección refleja quién y cuándo, para recargar o compartir en el mismo sitio. Sin pasar por el servidor
  useEffect(() => {
    const q = new URLSearchParams()
    if (puedeSupervisar && personaId) q.set('comercial', personaId)
    if (!(periodo.tipo === 'dia' && periodo.ancla === hoy)) {
      q.set('p', periodo.tipo)
      q.set('f', periodo.ancla)
    }
    const texto = q.toString()
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${texto ? `?${texto}` : ''}`)
  }, [personaId, periodo, hoy, puedeSupervisar])

  /* ---------------------------- refrescar ---------------------------- */

  /** Vuelve a leer el estado de la cuenta de Rinkel y las cifras: lo llama el cuadro de vinculación */
  const refrescar = useCallback(async () => {
    if (!persona) return
    const { data } = await supabase.from('rinkel_vinculos').select(CAMPOS_DEL_VINCULO).eq('user_id', persona.id).maybeSingle()
    setVinculos((antes) => {
      const ahora = new Map(antes)
      if (data) ahora.set(persona.id, data as VinculoVisible)
      else ahora.delete(persona.id)
      return ahora
    })
    cacheResumen.current.clear()
    cacheMes.current.clear()
    await Promise.all([
      cargarResumen(ventana, { forzar: true, silencioso: true }),
      cargarLlamadas(persona.id, mesesAPedir, { forzar: true, todo: true, silencioso: true }),
    ])
  }, [supabase, persona, ventana, mesesAPedir, cargarResumen, cargarLlamadas])

  // Mientras la pestaña está abierta en un periodo que incluye hoy, se va refrescando sola: el proceso automático trae llamadas nuevas
  const estadoParaRefrescar = useRef({ ventana, persona, meses: mesesAPedir, rango: rangoDelPeriodo, diaDeEquipo: claveDeEquipo })
  estadoParaRefrescar.current = { ventana, persona, meses: mesesAPedir, rango: rangoDelPeriodo, diaDeEquipo: claveDeEquipo }
  const incluyeHoy = contieneHoy(periodo, hoy)
  useEffect(() => {
    if (!incluyeHoy) return
    const volverALeer = () => {
      if (document.visibilityState !== 'visible') return
      const { ventana: v, persona: p, meses, rango, diaDeEquipo: dia } = estadoParaRefrescar.current
      void cargarResumen(v, { forzar: true, silencioso: true })
      if (p) {
        void cargarLlamadas(p.id, meses, { forzar: true, silencioso: true })
        void cargarActividad(p.id, rango, { forzar: true, silencioso: true })
      }
      if (dia) void cargarDiaDeEquipo(dia, { forzar: true, silencioso: true })
    }
    const reloj = setInterval(volverALeer, REFRESCO_MS)
    document.addEventListener('visibilitychange', volverALeer)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', volverALeer)
    }
  }, [incluyeHoy, cargarResumen, cargarLlamadas, cargarActividad, cargarDiaDeEquipo])

  /* ---------------------------- lo que se pinta ---------------------------- */

  const resultadoPersona = persona ? resultadoDe(persona.id) : null
  const vinculo = persona ? (vinculos.get(persona.id) ?? null) : null
  // Con la cuenta vinculada y sin avisos, Rinkel es un chip en la fila del título de las cifras; si no está vinculada o la
  // última lectura falló, sigue siendo la tarjeta de arriba, que es la que explica qué hacer
  const rinkelEnLaFilaDeCifras = vinculo !== null && !vinculo.ultimo_error
  const conRinkel = vinculo !== null || (resultadoPersona ? resultadoPersona.actual.llamadas + resultadoPersona.actual.recibidas > 0 : false)
  const numerosDistintos = periodo.tipo === 'dia' ? resumenDeLlamadas(llamadasDelDia).numerosDistintos : null
  // Los últimos siete días laborables de cada cifra de la persona, para las barritas de las tarjetas
  const series = useMemo(() => (persona ? seriesDeCifras(porPersona.get(persona.id), periodo, hoy) : null), [persona, porPersona, periodo, hoy])
  // El informe semanal abre en la semana que se está mirando; desde «Hoy» o desde un mes, en la última semana completa
  const enlaceDelInforme =
    periodo.tipo === 'mes' || (periodo.tipo === 'dia' && periodo.ancla === hoy)
      ? '/dashboard/rendimiento/informe'
      : `/dashboard/rendimiento/informe?semana=${lunesDe(periodo.ancla)}`

  return (
    <div className="space-y-3">
      <BarraDePeriodo
        periodo={periodo}
        hoy={hoy}
        cargando={cargandoCifras}
        onPeriodo={cambiarPeriodo}
        personas={puedeSupervisar ? equipoVivo.map((m) => ({ id: m.id, nombre: m.nombre, sinRinkel: m.comercial && !m.vinculado })) : undefined}
        personaId={personaId}
        yoId={yo.id}
        onPersona={puedeSupervisar ? cambiarDePersona : undefined}
        enlaceInforme={puedeSupervisar ? enlaceDelInforme : undefined}
        enlaceActividad={puedeVerActividad ? '/dashboard/actividad' : undefined}
        enlaceCorreos={puedeConfigurarCorreos ? '/dashboard/rendimiento/correos' : undefined}
      />

      {errorResumen && (
        <p className="text-[12px] text-[var(--ls-e-ambar)]" role="alert">
          {errorResumen}
        </p>
      )}
      {errorEquipo && (
        <p className="text-[12px] text-[var(--ls-e-ambar)]" role="alert">
          {errorEquipo}
        </p>
      )}

      {persona && !esPropio && (
        <div className="rend-aparece flex items-center gap-2 rounded-[8px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-acc-graf)] bg-[var(--ls-sup)] px-3 py-1.5 text-[11.5px] text-[var(--ls-t3)]">
          <Eye className="h-3.5 w-3.5 shrink-0 text-[var(--ls-acc)]" />
          <span>
            Estás viendo el rendimiento de <span className="font-semibold text-[var(--ls-t1)]">{persona.nombre}</span>.{' '}
            {puedeGestionar ? 'Como administrador puedes vincular, cambiar o quitar su clave de Rinkel.' : 'Solo de lectura.'}
          </span>
        </div>
      )}

      {puedeSupervisar && filasDeComparativa.length > 0 && (
        <ComparativaDelEquipo
          filas={filasDeComparativa}
          periodo={periodo}
          hoy={hoy}
          comparacion={comparacion}
          seleccionada={persona?.id ?? null}
          puedeGestionar={puedeGestionar}
          cargando={cargandoCifras}
          onElegir={cambiarDePersona}
        />
      )}

      {mirandoEquipoEnUnDia && personasDeLinea.length > 0 && (
        diaDeEquipo ? (
          <LineaDelEquipo
            titulo={`Línea del día · ${diaDeEquipo.clave === hoy ? 'Hoy' : primeraMayuscula(etiquetaDeDia(diaDeEquipo.clave))}`}
            personas={personasDeLinea}
            eventosPorPersona={eventosPorPersona}
            ahora={diaDeEquipo.clave === hoy ? ahoraMin : null}
            cargando={cargandoEquipo || diaDeEquipo.clave !== claveDeEquipo}
            onElegir={cambiarDePersona}
          />
        ) : (
          !errorEquipo && (
            <div className="rend-aparece space-y-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3" aria-live="polite">
              <Esqueleto className="h-4 w-48" />
              <Esqueleto className="h-24 w-full" />
            </div>
          )
        )
      )}

      {persona ? (
        // Al pasar a otra persona todo vuelve a entrar con su animación: se nota que es otro panel, no el mismo con otros números
        <div key={persona.id} className="space-y-3">
          {!rinkelEnLaFilaDeCifras && (
            <VincularRinkel
              key={persona.id}
              persona={persona}
              esPropio={esPropio}
              puedeGestionar={puedeGestionar}
              vinculo={vinculo}
              onCambio={refrescar}
              destacar={esPropio ? esComercial : true}
            />
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
              <h2 className="flex flex-wrap items-baseline gap-x-2 text-[13px] font-semibold text-[var(--ls-t1)]">
                {esPropio ? 'Tus cifras' : `Cifras de ${persona.nombre}`}
                {comparacion && <span className="text-[11.5px] font-normal text-[var(--ls-t4)]">· cambios frente a {comparacion.texto}</span>}
              </h2>
              {rinkelEnLaFilaDeCifras && (
                <VincularRinkel
                  key={`compacta-${persona.id}`}
                  compacta
                  persona={persona}
                  esPropio={esPropio}
                  puedeGestionar={puedeGestionar}
                  vinculo={vinculo}
                  onCambio={refrescar}
                  destacar={esPropio ? esComercial : true}
                />
              )}
            </div>
            <CifrasDelPeriodo
              periodo={periodo}
              hoy={hoy}
              resultado={resultadoPersona}
              comparacion={comparacion}
              conRinkel={conRinkel}
              cargando={cargandoCifras}
              numerosDistintos={numerosDistintos}
              series={series}
              onAbrir={abrirTarjeta}
            />
          </div>

          <LineaDelDia
            titulo={`Línea del día · ${diaFoco === hoy ? 'Hoy' : primeraMayuscula(etiquetaDeDia(diaFoco))}`}
            eventos={eventosDeLaPersona}
            ahora={diaFoco === hoy ? ahoraMin : null}
            cargando={cargandoMes || leyendoActividad}
          />

          {/* Las dos tarjetas miden siempre lo mismo (la altura la pone el calendario) y la lista de llamadas hace scroll por dentro: así el bloque de debajo no se mueve tenga el día las llamadas que tenga */}
          <div className="grid grid-cols-1 gap-3 lg:min-h-[540px] lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
            <CalendarioLlamadas
              anio={mesVisible.anio}
              mes={mesVisible.mes}
              datos={delMes}
              dia={diaFoco}
              resaltado={rangoDelPeriodo}
              hoy={hoy}
              cargando={cargandoMes}
              sinRinkel={!conRinkel}
              onDia={elegirDia}
              onMes={(delta) => setMesVisible((m) => sumarMeses(m.anio, m.mes, delta))}
              onHoy={() => cambiarPeriodo({ tipo: 'dia', ancla: hoy })}
              onSemana={(lunes) => cambiarPeriodo({ tipo: 'semana', ancla: lunes })}
            />
            <div className="relative min-w-0">
              <div className="lg:absolute lg:inset-0">
                <ListaLlamadas
                  key={persona.id}
                  dia={diaFoco}
                  hoy={hoy}
                  llamadas={llamadasDelDia}
                  nombres={nombresUtiles}
                  cargando={cargandoMes}
                  sinRinkel={!conRinkel}
                  esPropio={esPropio}
                  onAislarDia={periodo.tipo !== 'dia' ? () => cambiarPeriodo({ tipo: 'dia', ancla: diaFoco }) : undefined}
                />
              </div>
            </div>
          </div>

          <ListaDeActividad
            persona={persona.nombre}
            periodo={periodo}
            hoy={hoy}
            items={itemsDeLaLista}
            filtro={filtroActividad}
            onFiltro={setFiltroActividad}
            nombres={nombresUtiles}
            cargando={leyendoActividad || cargandoActividad}
            error={errorActividad}
            clave={`${persona.id}|${periodo.tipo}|${periodo.ancla}`}
          />
        </div>
      ) : (
        <p className="px-1 text-[12px] text-[var(--ls-t4)]">Elige a una persona en la tabla, o arriba en «Ver», para ver su calendario, sus llamadas y escuchar sus grabaciones.</p>
      )}
    </div>
  )
}
