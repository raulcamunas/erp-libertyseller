'use client'

import { Eye } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { diasDelMes, etiquetaDeDia, mesDe, rangoDelDia, rangoDelMes, sumarMeses } from '@/lib/rendimiento/dia'
import {
  actividadDeNotas,
  agruparPorDia,
  citasAgendadasEl,
  mesDeLlamadas,
  resumenDeLlamadas,
} from '@/lib/rendimiento/metricas'
import { CalendarioLlamadas } from './CalendarioLlamadas'
import { CifrasDelDia } from './CifrasDelDia'
import { ListaLlamadas, type NombreDeLead } from './ListaLlamadas'
import { ResumenDelEquipo, type FilaDelEquipo } from './ResumenDelEquipo'
import {
  CAMPOS_DEL_VINCULO,
  CAMPOS_DE_LLAMADA,
  type LlamadaGuardada,
  type Miembro,
  type NotaDelDia,
  type VinculoVisible,
} from './tipos'
import { VincularRinkel } from './VincularRinkel'

/**
 * EL PANEL DE RENDIMIENTO DE UNA PERSONA.
 *
 * Cada comercial ve el suyo; quien supervisa al equipo (admin, partner o el permiso 'equipo-comercial') puede
 * cambiar de persona con el selector, en solo lectura.
 *
 * LAS CIFRAS NO SE APUNTAN A MANO: se calculan de donde ya queda escrito todo.
 *   · llamadas        -> rinkel_llamadas (las lee el servidor de la cuenta de Rinkel de cada comercial)
 *   · WhatsApp, correos y respuestas -> las notas de Cold Calling de esa persona
 *   · citas           -> la Agenda (las que creó, sin las importadas de Google)
 *
 * Todo se lee con la sesión de quien mira, así que las políticas RLS deciden qué ve cada uno: lo suyo, o lo
 * de todo el equipo si supervisa. Se descarga el MES entero (pocas filas) y el día seleccionado se calcula en el
 * navegador, para que cambiar de día en el calendario sea instantáneo.
 */

interface DatosDelMes {
  llamadas: LlamadaGuardada[]
  notas: NotaDelDia[]
  citas: Array<{ created_at: string }>
  /** Lo que no se pudo leer, para decirlo en vez de enseñar un cero */
  avisos: string[]
}

interface Props {
  /** La persona cuyo panel se enseña */
  usuario: { id: string; nombre: string }
  /** Quien está mirando */
  yo: string
  equipo: Miembro[]
  puedeSupervisar: boolean
  /** El día de hoy en Madrid, «2026-10-22». Lo pone el servidor para que no baile entre servidor y navegador */
  hoy: string
  vinculoInicial: VinculoVisible | null
  /** Quien mira es del equipo comercial. Si no (un administrador), la invitación a vincular Rinkel no se resalta */
  esComercial?: boolean
  /**
   * Quien mira es administrador: en el panel de otra persona puede vincular, cambiar, sincronizar o desvincular
   * su clave de Rinkel. Solo decide qué se pinta; la ruta vuelve a comprobar el rol.
   */
  puedeGestionar?: boolean
}

const REFRESCO_MS = 120_000

const dosCifras = (n: number) => String(n).padStart(2, '0')

async function leer<T>(
  que: string,
  avisos: string[],
  consulta: (desde: number, hasta: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  try {
    return await fetchAll<T>(consulta)
  } catch (error) {
    console.error(`Rendimiento: no se ha podido leer ${que}`, error)
    avisos.push(que)
    return []
  }
}

export function PanelRendimiento({ usuario, yo, equipo, puedeSupervisar, hoy, vinculoInicial, esComercial = true, puedeGestionar = false }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [cambiandoDePersona, empezarCambio] = useTransition()

  const esPropio = usuario.id === yo
  const mesDeHoy = mesDe(hoy)
  const [{ anio, mes }, setMesVisible] = useState(mesDeHoy)
  const [dia, setDia] = useState(hoy)
  const [datos, setDatos] = useState<DatosDelMes | null>(null)
  const [cargando, setCargando] = useState(true)
  const [vinculo, setVinculo] = useState<VinculoVisible | null>(vinculoInicial)
  const [nombres, setNombres] = useState<ReadonlyMap<string, NombreDeLead>>(new Map())

  const cache = useRef(new Map<string, DatosDelMes>())
  const peticion = useRef(0)
  // El resumen del equipo, por día
  const [filasEquipo, setFilasEquipo] = useState<FilaDelEquipo[] | null>(null)
  const [cargandoEquipo, setCargandoEquipo] = useState(false)
  const cacheEquipo = useRef(new Map<string, FilaDelEquipo[]>())
  const peticionEquipo = useRef(0)
  // Quién tiene Rinkel vinculado. Lo que trae el servidor es la foto de cuando se abrió la página: si un
  // administrador vincula o quita una clave aquí mismo, la tabla del equipo y el selector tienen que enterarse
  const [conRinkel, setConRinkel] = useState<ReadonlySet<string>>(() => new Set(equipo.filter((m) => m.vinculado).map((m) => m.id)))
  const equipoVivo = useMemo(() => equipo.map((m) => ({ ...m, vinculado: conRinkel.has(m.id) })), [equipo, conRinkel])
  const verEquipo = puedeSupervisar && equipo.filter((m) => m.comercial).length > 0
  const mesActual = useRef({ anio, mes })
  mesActual.current = { anio, mes }

  /* ---------------------------- leer el mes ---------------------------- */

  const cargar = useCallback(
    async (a: number, m: number, opciones: { forzar?: boolean; silencioso?: boolean } = {}) => {
      const clave = `${a}-${m}`
      // Cada petición se numera ANTES de mirar la caché: si se pide un mes que ya está guardado mientras otro
      // viaja todavía, la respuesta lenta tiene que quedar descartada y no pisar al mes que sí se está viendo
      const numeroDePeticion = ++peticion.current
      if (!opciones.forzar) {
        const guardado = cache.current.get(clave)
        if (guardado) {
          setDatos(guardado)
          setCargando(false)
          return
        }
      }
      if (!opciones.silencioso) setCargando(true)

      const { desde, hasta } = rangoDelMes(a, m)
      const d = desde.toISOString()
      const h = hasta.toISOString()
      const avisos: string[] = []

      const [llamadas, notas, citas] = await Promise.all([
        leer<LlamadaGuardada>('las llamadas', avisos, (de, a2) =>
          supabase
            .from('rinkel_llamadas')
            .select(CAMPOS_DE_LLAMADA)
            .eq('user_id', usuario.id)
            .gte('fecha', d)
            .lt('fecha', h)
            .order('fecha', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
        leer<NotaDelDia>('las notas de Cold Calling', avisos, (de, a2) =>
          supabase
            .from('cold_lead_notes')
            .select('kind, es_respuesta, occurred_at, lead_id')
            .eq('author_id', usuario.id)
            .gte('occurred_at', d)
            .lt('occurred_at', h)
            .order('occurred_at', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
        leer<{ created_at: string }>('las citas', avisos, (de, a2) =>
          supabase
            .from('appointments')
            .select('id, created_at')
            .eq('comercial_id', usuario.id)
            .eq('is_external', false)
            .gte('created_at', d)
            .lt('created_at', h)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
      ])

      // Si mientras tanto se pidió otro mes, esta respuesta ya no interesa
      if (numeroDePeticion !== peticion.current) return
      const resultado: DatosDelMes = { llamadas, notas, citas, avisos }
      // Un mes con avisos no se guarda: la próxima vez se vuelve a intentar leer
      if (avisos.length === 0) cache.current.set(clave, resultado)
      setDatos(resultado)
      setCargando(false)
    },
    [supabase, usuario.id]
  )

  useEffect(() => {
    void cargar(anio, mes)
  }, [anio, mes, cargar])

  /**
   * Las cifras de TODO el equipo en un día, para quien supervisa. Se lee el día entero de todos de una vez
   * (la política de la base deja ver todo a quien supervisa) y se reparte por persona aquí.
   */
  const cargarEquipo = useCallback(
    async (d: string, opciones: { forzar?: boolean; silencioso?: boolean } = {}) => {
      if (!verEquipo) return
      const numeroDePeticion = ++peticionEquipo.current
      if (!opciones.forzar) {
        const guardado = cacheEquipo.current.get(d)
        if (guardado) {
          setFilasEquipo(guardado)
          setCargandoEquipo(false)
          return
        }
      }
      if (!opciones.silencioso) setCargandoEquipo(true)

      const { desde, hasta } = rangoDelDia(d)
      const ini = desde.toISOString()
      const fin = hasta.toISOString()
      const avisos: string[] = []
      type LlamadaDeEquipo = LlamadaGuardada & { user_id: string }
      const [ll, no, ci] = await Promise.all([
        leer<LlamadaDeEquipo>('las llamadas del equipo', avisos, (de, a2) =>
          supabase
            .from('rinkel_llamadas')
            .select('id, user_id, fecha, direccion, estado, duracion_s, numero, grabacion_id')
            .gte('fecha', ini)
            .lt('fecha', fin)
            .order('fecha', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
        leer<NotaDelDia & { author_id: string }>('las notas del equipo', avisos, (de, a2) =>
          supabase
            .from('cold_lead_notes')
            .select('id, author_id, kind, es_respuesta, occurred_at, lead_id')
            .gte('occurred_at', ini)
            .lt('occurred_at', fin)
            .order('occurred_at', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
        leer<{ comercial_id: string; created_at: string }>('las citas del equipo', avisos, (de, a2) =>
          supabase
            .from('appointments')
            .select('id, comercial_id, created_at')
            .eq('is_external', false)
            .gte('created_at', ini)
            .lt('created_at', fin)
            .order('created_at', { ascending: true })
            .order('id', { ascending: true })
            .range(de, a2)
        ),
      ])
      if (numeroDePeticion !== peticionEquipo.current) return

      const filas: FilaDelEquipo[] = equipoVivo
        .filter((m) => m.comercial)
        .map((m) => ({
          id: m.id,
          nombre: m.nombre,
          vinculado: m.vinculado,
          llamadas: resumenDeLlamadas(ll.filter((l) => l.user_id === m.id)),
          actividad: actividadDeNotas(no.filter((n) => n.author_id === m.id), d),
          citas: citasAgendadasEl(ci.filter((c) => c.comercial_id === m.id), d),
        }))
      if (avisos.length === 0) cacheEquipo.current.set(d, filas)
      setFilasEquipo(filas)
      setCargandoEquipo(false)
    },
    [supabase, equipoVivo, verEquipo]
  )

  /** Vuelve a leer el estado de la cuenta de Rinkel y las llamadas del mes: lo llama el cuadro de vinculación */
  const refrescar = useCallback(async () => {
    const { data } = await supabase.from('rinkel_vinculos').select(CAMPOS_DEL_VINCULO).eq('user_id', usuario.id).maybeSingle()
    setVinculo((data as VinculoVisible | null) ?? null)
    setConRinkel((antes) => {
      const ahora = new Set(antes)
      if (data) ahora.add(usuario.id)
      else ahora.delete(usuario.id)
      return ahora
    })
    cache.current.clear()
    cacheEquipo.current.clear()
    await Promise.all([
      cargar(mesActual.current.anio, mesActual.current.mes, { forzar: true, silencioso: true }),
      cargarEquipo(diaVisibleRef.current, { forzar: true, silencioso: true }),
    ])
  }, [supabase, usuario.id, cargar, cargarEquipo])

  // Mientras la pestaña está abierta en el mes de hoy, se va refrescando sola: el proceso automático trae llamadas nuevas
  useEffect(() => {
    const enElMesDeHoy = anio === mesDeHoy.anio && mes === mesDeHoy.mes
    if (!enElMesDeHoy) return
    const volverALeer = () => {
      if (document.visibilityState !== 'visible') return
      void cargar(anio, mes, { forzar: true, silencioso: true })
      if (diaVisibleRef.current === hoy) void cargarEquipo(hoy, { forzar: true, silencioso: true })
    }
    const reloj = setInterval(volverALeer, REFRESCO_MS)
    document.addEventListener('visibilitychange', volverALeer)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', volverALeer)
    }
  }, [anio, mes, mesDeHoy.anio, mesDeHoy.mes, cargar, cargarEquipo, hoy])

  /* ---------------------------- lo calculado ---------------------------- */

  const llamadas = datos?.llamadas
  const dias = useMemo(() => diasDelMes(anio, mes), [anio, mes])
  const prefijo = `${anio}-${dosCifras(mes)}`

  const delMes = useMemo(() => mesDeLlamadas(anio, mes, llamadas ?? []), [anio, mes, llamadas])
  const porDia = useMemo(() => agruparPorDia(llamadas ?? []), [llamadas])

  // El día seleccionado tiene que ser del mes que se ve; si no (al cambiar de mes), el de hoy, o el último con llamadas
  const diaVisible = useMemo(() => {
    if (dia.startsWith(prefijo)) return dia
    if (dias.includes(hoy)) return hoy
    const ultimoConLlamadas = [...dias].reverse().find((d) => (porDia.get(d)?.length ?? 0) > 0)
    return ultimoConLlamadas ?? dias[0]
  }, [dia, prefijo, dias, hoy, porDia])

  const diaVisibleRef = useRef(diaVisible)
  diaVisibleRef.current = diaVisible

  const llamadasDelDia = useMemo(() => porDia.get(diaVisible) ?? [], [porDia, diaVisible])
  const resumen = useMemo(() => resumenDeLlamadas(llamadasDelDia), [llamadasDelDia])
  const actividad = useMemo(() => actividadDeNotas(datos?.notas ?? [], diaVisible), [datos?.notas, diaVisible])
  const citas = useMemo(() => citasAgendadasEl(datos?.citas ?? [], diaVisible), [datos?.citas, diaVisible])

  const hayLlamadas = vinculo !== null || (llamadas?.length ?? 0) > 0

  useEffect(() => {
    void cargarEquipo(diaVisible)
  }, [diaVisible, cargarEquipo])

  /* ---------------------------- los nombres de los leads del día ---------------------------- */

  useEffect(() => {
    const faltan = [...new Set(llamadasDelDia.map((l) => l.lead_id).filter((id): id is string => id !== null))].filter((id) => !nombres.has(id))
    if (faltan.length === 0) return
    let vivo = true
    void (async () => {
      const encontrados = new Map(nombres)
      for (let i = 0; i < faltan.length; i += 100) {
        const trozo = faltan.slice(i, i + 100)
        const { data } = await supabase.from('cold_leads').select('id, store_name, company').in('id', trozo)
        for (const fila of (data ?? []) as Array<{ id: string; store_name: string; company: string | null }>) {
          encontrados.set(fila.id, { nombre: fila.store_name, empresa: fila.company })
        }
        // Un lead que ya no existe o que no se puede ver se apunta vacío para no volver a pedirlo en bucle
        for (const id of trozo) if (!encontrados.has(id)) encontrados.set(id, { nombre: '', empresa: null })
      }
      if (vivo) setNombres(encontrados)
    })()
    return () => {
      vivo = false
    }
  }, [llamadasDelDia, nombres, supabase])

  // Los vacíos (leads que no se ven) no se usan como nombre: la lista enseña el teléfono
  const nombresUtiles = useMemo(() => {
    const m = new Map<string, NombreDeLead>()
    nombres.forEach((v, k) => {
      if (v.nombre) m.set(k, v)
    })
    return m
  }, [nombres])

  /* ---------------------------- moverse ---------------------------- */

  const irAMes = (delta: number) => {
    const destino = sumarMeses(anio, mes, delta)
    setMesVisible(destino)
  }
  const irAHoy = () => {
    setMesVisible(mesDeHoy)
    setDia(hoy)
  }
  const cambiarDePersona = (id: string) => {
    empezarCambio(() => router.push(id === yo ? '/dashboard/rendimiento' : `/dashboard/rendimiento?comercial=${id}`))
  }

  const quien = diaVisible === hoy ? 'hoy' : etiquetaDeDia(diaVisible)

  return (
    <div className="space-y-4">
      {puedeSupervisar && equipo.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="persona-rendimiento" className="text-[12px] text-white/45">
            Ver el panel de
          </label>
          <select
            id="persona-rendimiento"
            value={usuario.id}
            onChange={(e) => cambiarDePersona(e.target.value)}
            disabled={cambiandoDePersona}
            className="h-9 rounded-full border border-white/10 bg-white/[0.03] px-3 text-[13px] text-white/80 outline-none focus:border-[#FF6600] transition-colors cursor-pointer disabled:opacity-50"
          >
            {equipoVivo.map((m) => (
              <option key={m.id} value={m.id} className="bg-[#1a1a1a]">
                {m.id === yo ? `${m.nombre} (yo)` : m.nombre}
                {m.vinculado ? '' : ' · sin Rinkel'}
              </option>
            ))}
          </select>
        </div>
      )}

      {!esPropio && (
        <div className="rounded-xl border border-[#FF6600]/25 bg-[#FF6600]/[0.06] px-3 py-2 text-[12px] text-white/70 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-[#FF6600] shrink-0" />
          <span>
            Estás viendo el rendimiento de <span className="font-semibold text-white">{usuario.nombre}</span>.{' '}
            {puedeGestionar ? 'Como administrador puedes vincular, cambiar o quitar su clave de Rinkel.' : 'Solo de lectura.'}
          </span>
        </div>
      )}

      {verEquipo && filasEquipo && (
        <ResumenDelEquipo
          filas={filasEquipo}
          dia={diaVisible}
          hoy={hoy}
          cargando={cargandoEquipo}
          seleccionada={usuario.id}
          puedeGestionar={puedeGestionar}
          onElegir={cambiarDePersona}
        />
      )}

      <VincularRinkel
        persona={usuario}
        esPropio={esPropio}
        puedeGestionar={puedeGestionar}
        vinculo={vinculo}
        onCambio={refrescar}
        destacar={esPropio ? esComercial : true}
      />

      <div className="space-y-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-[13px] font-semibold text-white">
            {diaVisible === hoy ? 'Hoy' : 'Día elegido'}
            <span className="font-normal text-white/45"> · {etiquetaDeDia(diaVisible)}</span>
          </h2>
          {diaVisible !== hoy && (
            <button type="button" onClick={irAHoy} className="text-[12px] text-white/45 hover:text-white transition-colors">
              Volver a hoy
            </button>
          )}
        </div>
        <CifrasDelDia quien={quien} llamadas={resumen} actividad={actividad} citas={citas} conRinkel={hayLlamadas} cargando={cargando} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 items-start">
        <CalendarioLlamadas
          anio={anio}
          mes={mes}
          datos={delMes}
          dia={diaVisible}
          hoy={hoy}
          cargando={cargando}
          sinRinkel={!hayLlamadas}
          onDia={setDia}
          onMes={irAMes}
          onHoy={irAHoy}
        />
        <ListaLlamadas
          dia={diaVisible}
          hoy={hoy}
          llamadas={llamadasDelDia}
          nombres={nombresUtiles}
          cargando={cargando}
          sinRinkel={!hayLlamadas}
          esPropio={esPropio}
        />
      </div>

      {datos && datos.avisos.length > 0 && (
        <p className="text-[12px] text-amber-300" role="status">
          No se han podido leer {datos.avisos.join(' ni ')}. Las cifras que dependen de eso pueden estar incompletas: recarga la página.
        </p>
      )}
    </div>
  )
}
