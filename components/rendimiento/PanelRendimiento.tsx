'use client'

import { Eye } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchAll } from '@/lib/supabase/paginacion'
import { indexar, resultadoDePersona, tramosDeComparacion, ventanaDeDatos, type FilaDiaria } from '@/lib/rendimiento/comparativa'
import { mesDe, rangoDelMes, sumarMeses } from '@/lib/rendimiento/dia'
import { agruparPorDia, mesDeLlamadas, resumenDeLlamadas } from '@/lib/rendimiento/metricas'
import { contieneHoy, diasDelRango, etiquetaDeRango, rangoDe, recortarA, type Periodo } from '@/lib/rendimiento/periodos'
import { BarraDePeriodo } from './BarraDePeriodo'
import { CalendarioLlamadas } from './CalendarioLlamadas'
import { CifrasDelPeriodo } from './CifrasDelPeriodo'
import { ComparativaDelEquipo, type FilaDeComparativa } from './ComparativaDelEquipo'
import { ListaLlamadas, type NombreDeLead } from './ListaLlamadas'
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
 * Lo único que sigue bajando «en crudo» son las llamadas del mes de la persona elegida, para el calendario y para
 * escuchar las de un día.
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

type Opciones = { forzar?: boolean; silencioso?: boolean }

export function PanelRendimiento({ yo, equipo, puedeSupervisar, puedeGestionar, esComercial, hoy, vinculosIniciales, personaInicial, periodoInicial }: Props) {
  const supabase = useMemo(() => createClient(), [])

  /* ---------------------------- quién y cuándo ---------------------------- */

  const [personaId, setPersonaId] = useState<string | null>(puedeSupervisar ? personaInicial : yo.id)
  const [periodo, setPeriodo] = useState<Periodo>(periodoInicial)
  /** El día que se ha pulsado en el calendario mientras se mira una semana o un mes (en un día, el día es el periodo) */
  const [focoManual, setFocoManual] = useState<string | null>(null)
  const [mesVisible, setMesVisible] = useState(() => mesDe(recortarA(rangoDe(periodoInicial), hoy)?.hasta ?? hoy))
  const [vinculos, setVinculos] = useState<ReadonlyMap<string, VinculoVisible>>(() => new Map(vinculosIniciales.map((v) => [v.user_id, v])))
  const [nombres, setNombres] = useState<ReadonlyMap<string, NombreDeLead>>(new Map())

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

  /* ---------------------------- las llamadas en crudo de la persona: calendario y lista ---------------------------- */

  const claveDelMes = persona ? `${persona.id}|${mesVisible.anio}-${mesVisible.mes}` : null
  const [llamadasMes, setLlamadasMes] = useState<{ clave: string; llamadas: LlamadaGuardada[] } | null>(null)
  const [cargandoMes, setCargandoMes] = useState(false)
  const cacheMes = useRef(new Map<string, LlamadaGuardada[]>())
  const peticionMes = useRef(0)

  const cargarLlamadasMes = useCallback(
    async (id: string, anio: number, mes: number, opciones: Opciones = {}) => {
      const clave = `${id}|${anio}-${mes}`
      const numero = ++peticionMes.current
      if (!opciones.forzar) {
        const guardado = cacheMes.current.get(clave)
        if (guardado) {
          setLlamadasMes({ clave, llamadas: guardado })
          setCargandoMes(false)
          return
        }
      }
      if (!opciones.silencioso) setCargandoMes(true)
      try {
        const { desde, hasta } = rangoDelMes(anio, mes)
        const llamadas = await fetchAll<LlamadaGuardada>((de, a) =>
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
        if (numero !== peticionMes.current) return
        cacheMes.current.set(clave, llamadas)
        setLlamadasMes({ clave, llamadas })
      } catch (error) {
        if (numero !== peticionMes.current) return
        console.error('Rendimiento: no se han podido leer las llamadas del mes', error)
        setLlamadasMes({ clave, llamadas: [] })
      } finally {
        if (numero === peticionMes.current) setCargandoMes(false)
      }
    },
    [supabase]
  )

  useEffect(() => {
    if (persona) void cargarLlamadasMes(persona.id, mesVisible.anio, mesVisible.mes)
  }, [persona, mesVisible.anio, mesVisible.mes, cargarLlamadasMes])

  const llamadas = useMemo(() => (llamadasMes && llamadasMes.clave === claveDelMes ? llamadasMes.llamadas : []), [llamadasMes, claveDelMes])
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

  const nombresUtiles = useMemo(() => {
    const m = new Map<string, NombreDeLead>()
    nombres.forEach((v, k) => {
      if (v.nombre) m.set(k, v)
    })
    return m
  }, [nombres])

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
      cargarLlamadasMes(persona.id, mesVisible.anio, mesVisible.mes, { forzar: true, silencioso: true }),
    ])
  }, [supabase, persona, ventana, mesVisible, cargarResumen, cargarLlamadasMes])

  // Mientras la pestaña está abierta en un periodo que incluye hoy, se va refrescando sola: el proceso automático trae llamadas nuevas
  const estadoParaRefrescar = useRef({ ventana, persona, mesVisible })
  estadoParaRefrescar.current = { ventana, persona, mesVisible }
  const incluyeHoy = contieneHoy(periodo, hoy)
  useEffect(() => {
    if (!incluyeHoy) return
    const volverALeer = () => {
      if (document.visibilityState !== 'visible') return
      const { ventana: v, persona: p, mesVisible: m } = estadoParaRefrescar.current
      void cargarResumen(v, { forzar: true, silencioso: true })
      if (p) void cargarLlamadasMes(p.id, m.anio, m.mes, { forzar: true, silencioso: true })
    }
    const reloj = setInterval(volverALeer, REFRESCO_MS)
    document.addEventListener('visibilitychange', volverALeer)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', volverALeer)
    }
  }, [incluyeHoy, cargarResumen, cargarLlamadasMes])

  /* ---------------------------- lo que se pinta ---------------------------- */

  const resultadoPersona = persona ? resultadoDe(persona.id) : null
  const vinculo = persona ? (vinculos.get(persona.id) ?? null) : null
  const conRinkel = vinculo !== null || (resultadoPersona ? resultadoPersona.actual.llamadas + resultadoPersona.actual.recibidas > 0 : false)
  const numerosDistintos = periodo.tipo === 'dia' ? resumenDeLlamadas(llamadasDelDia).numerosDistintos : null

  return (
    <div className="space-y-4">
      <BarraDePeriodo
        periodo={periodo}
        hoy={hoy}
        cargando={cargandoCifras}
        onPeriodo={cambiarPeriodo}
        personas={puedeSupervisar ? equipoVivo.map((m) => ({ id: m.id, nombre: m.nombre, sinRinkel: m.comercial && !m.vinculado })) : undefined}
        personaId={personaId}
        yoId={yo.id}
        onPersona={puedeSupervisar ? cambiarDePersona : undefined}
      />

      {errorResumen && (
        <p className="text-[12px] text-amber-300" role="alert">
          {errorResumen}
        </p>
      )}

      {persona && !esPropio && (
        <div className="rounded-xl border border-[#FF6600]/25 bg-[#FF6600]/[0.06] px-3 py-2 text-[12px] text-white/70 flex items-center gap-2">
          <Eye className="h-3.5 w-3.5 text-[#FF6600] shrink-0" />
          <span>
            Estás viendo el rendimiento de <span className="font-semibold text-white">{persona.nombre}</span>.{' '}
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

      {persona ? (
        <>
          <VincularRinkel
            key={persona.id}
            persona={persona}
            esPropio={esPropio}
            puedeGestionar={puedeGestionar}
            vinculo={vinculo}
            onCambio={refrescar}
            destacar={esPropio ? esComercial : true}
          />

          <div className="space-y-2.5">
            <h2 className="text-[13px] font-semibold text-white">{esPropio ? 'Tus cifras' : `Cifras de ${persona.nombre}`}</h2>
            <CifrasDelPeriodo
              periodo={periodo}
              hoy={hoy}
              resultado={resultadoPersona}
              comparacion={comparacion}
              conRinkel={conRinkel}
              cargando={cargandoCifras}
              numerosDistintos={numerosDistintos}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] gap-4 items-start">
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
            />
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
        </>
      ) : (
        <p className="text-[12px] text-white/40 px-1">Elige a una persona en la tabla, o arriba en «Ver», para ver su calendario, sus llamadas y escuchar sus grabaciones.</p>
      )}
    </div>
  )
}
