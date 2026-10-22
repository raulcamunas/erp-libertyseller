'use client'

import { ChevronDown, ChevronLeft, ChevronRight, Expand, Loader2, Shrink, X } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { indexar } from '@/lib/rendimiento/comparativa'
import { diaMadrid, horaMadrid, sumarDias } from '@/lib/rendimiento/dia'
import {
  diasDeSemana,
  etiquetaLargaDeSemana,
  horarioSemanal,
  kpisDelEquipo,
  lunesPorDefecto,
  mapaHorario,
  resultadoSemanal,
  semanaDe,
  textoDePausa,
  titulares,
  type Metrica,
  type PersonaDeInforme,
} from '@/lib/rendimiento/informe'
import { eventosDeLinea, minutoDeLaHora, type EventoDeLinea } from '@/lib/rendimiento/linea'
import { lunesDe } from '@/lib/rendimiento/periodos'
import { createClient } from '@/lib/supabase/client'
import { leerNombres, leerSemanaDelEquipo, type SemanaLeida } from '../lecturas'
import type { NombreDeLead } from '../ListaLlamadas'
import type { Miembro } from '../tipos'
import { CifrasDeLaSemana } from './CifrasDeLaSemana'
import { MapaDeFranjas } from './MapaDeFranjas'
import { MatrizDeLaSemana } from './MatrizDeLaSemana'
import { PersonaDelInforme } from './PersonaDelInforme'
import { TitularesDeLaSemana } from './TitularesDeLaSemana'

/**
 * EL INFORME SEMANAL: LA SEMANA ENTERA DEL EQUIPO EN UNA PÁGINA, PARA REVISARLA LOS LUNES.
 *
 * Ocupa toda la pantalla (se pinta encima del ERP, y se sale con la X o con Esc) y se puede poner a pantalla completa
 * para proyectarla. Abre por defecto la última semana completa; las flechas (o ← →) pasan de una semana a otra.
 *
 * De arriba abajo: lo más importante en frases, las ocho cifras del equipo con su cambio frente a la semana anterior,
 * el día a día persona a persona, cuándo se trabaja (mapa de horas y horario) y, por cada comercial, todo lo que hizo:
 * al abrirlo salen su horario, su línea de cada día, las citas que agendó y lo que contestaron los clientes, con el
 * comentario de cada uno.
 *
 * LAS CIFRAS SON LAS DEL PANEL (misma función de la base, mismas reglas), leídas con la sesión de quien mira: las
 * políticas de la base deciden qué ve cada uno. Una semana ya cerrada no cambia y se guarda; la que está en curso se
 * vuelve a leer sola cada dos minutos.
 */

const REFRESCO_MS = 120_000

interface Props {
  /** El equipo, con quién tiene Rinkel. Solo se enseñan los comerciales */
  equipo: Miembro[]
  /** El día de hoy en Madrid. Lo pone el servidor para que no baile entre servidor y navegador */
  hoy: string
  /** El lunes de la semana con la que se abre */
  lunesInicial: string
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

const CHIP = 'px-3 h-8 rounded-full border text-[12px] font-medium transition-colors'
const CHIP_ACTIVO = 'border-[#FF6600]/50 bg-[#FF6600]/15 text-white'
const CHIP_QUIETO = 'border-white/10 text-white/55 hover:text-white hover:border-white/25'

export function InformeSemanal({ equipo, hoy, lunesInicial }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [montado, setMontado] = useState(false)
  const [lunes, setLunes] = useState(lunesInicial)
  const [datos, setDatos] = useState<SemanaLeida | null>(null)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [metrica, setMetrica] = useState<Metrica>('llamadas')
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(new Set())
  const [diasElegidos, setDiasElegidos] = useState<Readonly<Record<string, string>>>({})
  const [nombres, setNombres] = useState<ReadonlyMap<string, NombreDeLead>>(new Map())
  const [ahoraMin, setAhoraMin] = useState<number | null>(null)
  const [pantallaCompleta, setPantallaCompleta] = useState(false)
  const [puedePantallaCompleta, setPuedePantallaCompleta] = useState(false)
  const cache = useRef(new Map<string, SemanaLeida>())
  const peticion = useRef(0)
  const nombresPedidos = useRef(new Set<string>())

  useEffect(() => {
    setMontado(true)
    setPuedePantallaCompleta(Boolean(document.fullscreenEnabled))
  }, [])

  const personas = useMemo<PersonaDeInforme[]>(() => equipo.filter((m) => m.comercial).map((m) => ({ id: m.id, nombre: m.nombre, vinculado: m.vinculado })), [equipo])

  /* ---------------------------- leer la semana ---------------------------- */

  const cargar = useCallback(
    async (lunesACargar: string, opciones: { forzar?: boolean; silencioso?: boolean } = {}) => {
      const numero = ++peticion.current
      if (!opciones.forzar) {
        const guardada = cache.current.get(lunesACargar)
        if (guardada) {
          setDatos(guardada)
          setError(null)
          setCargando(false)
          return
        }
      }
      if (!opciones.silencioso) {
        setCargando(true)
        setError(null)
      }
      try {
        const leida = await leerSemanaDelEquipo(supabase, lunesACargar)
        if (numero !== peticion.current) return
        // Una semana que ya ha acabado no cambia: solo entonces se guarda
        if (sumarDias(lunesACargar, 6) < hoy) cache.current.set(lunesACargar, leida)
        setDatos(leida)
        setError(null)
      } catch (e) {
        if (numero !== peticion.current) return
        console.error('Informe semanal: no se ha podido leer la semana', e)
        if (!opciones.silencioso) setError('No se ha podido leer la semana. Recarga la página.')
      } finally {
        if (numero === peticion.current) setCargando(false)
      }
    },
    [supabase, hoy]
  )

  useEffect(() => {
    void cargar(lunes)
  }, [lunes, cargar])

  const semana = useMemo(() => semanaDe(lunes, hoy), [lunes, hoy])
  const dias = useMemo(() => diasDeSemana(semana), [semana])
  // Lo que hay en pantalla puede ser de la semana anterior mientras llega la nueva: no se enseña como bueno
  const leida = datos && datos.clave === lunes ? datos : null

  // La semana en curso se vuelve a leer sola
  useEffect(() => {
    if (!semana.contieneHoy) return
    const volverALeer = () => {
      if (document.visibilityState === 'visible') void cargar(lunes, { forzar: true, silencioso: true })
    }
    const reloj = setInterval(volverALeer, REFRESCO_MS)
    document.addEventListener('visibilitychange', volverALeer)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', volverALeer)
    }
  }, [semana.contieneHoy, lunes, cargar])

  // La hora de ahora mismo, para la línea de hoy
  useEffect(() => {
    if (!semana.contieneHoy) return
    const medir = () => setAhoraMin(minutoDeLaHora(horaMadrid(new Date())))
    medir()
    const reloj = setInterval(medir, 60_000)
    return () => clearInterval(reloj)
  }, [semana.contieneHoy])

  /* ---------------------------- moverse ---------------------------- */

  const estaSemana = lunesDe(hoy)
  const puedeAvanzar = sumarDias(lunes, 7) <= estaSemana
  const irA = useCallback(
    (nuevo: string) => {
      if (nuevo > estaSemana || nuevo === lunes) return
      setLunes(nuevo)
      setDiasElegidos({})
    },
    [estaSemana, lunes]
  )

  // La dirección guarda la semana, para recargar o compartir en el mismo sitio. Sin pasar por el servidor
  useEffect(() => {
    window.history.replaceState(window.history.state, '', `${window.location.pathname}?semana=${lunes}`)
  }, [lunes])

  const cerrar = useCallback(() => router.push('/dashboard/rendimiento'), [router])

  useEffect(() => {
    const alPulsar = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (e.key === 'ArrowLeft') irA(sumarDias(lunes, -7))
      else if (e.key === 'ArrowRight') irA(sumarDias(lunes, 7))
      else if (e.key === 'Escape' && !document.fullscreenElement) cerrar()
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [irA, lunes, cerrar])

  useEffect(() => {
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = anterior
    }
  }, [])

  useEffect(() => {
    const alCambiar = () => setPantallaCompleta(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', alCambiar)
    return () => document.removeEventListener('fullscreenchange', alCambiar)
  }, [])

  const alternarPantallaCompleta = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch {
      // El navegador puede negarlo (una pestaña incrustada, por ejemplo): no pasa nada, el informe sigue ahí
    }
  }

  /* ---------------------------- las cifras ---------------------------- */

  const porPersona = useMemo(() => indexar(leida?.filas ?? []), [leida])
  const resultados = useMemo(() => personas.map((p) => resultadoSemanal(p, porPersona.get(p.id), semana)), [personas, porPersona, semana])
  const kpis = useMemo(() => kpisDelEquipo(resultados, semana), [resultados, semana])
  const frases = useMemo(() => titulares(resultados, semana), [resultados, semana])
  const contra = semana.comparacion?.texto ?? 'la semana anterior'

  /* ---------------------------- lo de cada persona, en crudo ---------------------------- */

  const crudo = useMemo(() => {
    const ids = new Set(personas.map((p) => p.id))
    return {
      llamadas: agruparPor(leida?.llamadas ?? [], (l) => (ids.has(l.user_id) ? l.user_id : null)),
      notas: agruparPor(leida?.notas ?? [], (x) => (x.author_id && ids.has(x.author_id) ? x.author_id : null)),
      citas: agruparPor(leida?.citas ?? [], (c) => (ids.has(c.comercial_id) ? c.comercial_id : null)),
    }
  }, [leida, personas])

  const todasLasLlamadas = useMemo(() => personas.flatMap((p) => crudo.llamadas.get(p.id) ?? []), [personas, crudo])
  const mapaDelEquipo = useMemo(() => mapaHorario(todasLasLlamadas, semana.dias), [todasLasLlamadas, semana.dias])

  // El horario de cada persona sin nombres de cliente: solo hacen falta las horas
  const horarios = useMemo(() => {
    const mapa = new Map<string, ReturnType<typeof horarioSemanal>>()
    for (const p of personas) {
      const delDia = {
        llamadas: agruparPor(crudo.llamadas.get(p.id) ?? [], (l) => diaMadrid(l.fecha)),
        notas: agruparPor(crudo.notas.get(p.id) ?? [], (x) => diaMadrid(x.occurred_at)),
        citas: agruparPor(crudo.citas.get(p.id) ?? [], (c) => diaMadrid(c.created_at)),
      }
      const eventos = new Map<string, EventoDeLinea[]>()
      for (const d of semana.dias) {
        eventos.set(d, eventosDeLinea({ llamadas: delDia.llamadas.get(d) ?? [], notas: delDia.notas.get(d) ?? [], citas: delDia.citas.get(d) ?? [], cliente: () => null }))
      }
      mapa.set(p.id, horarioSemanal(eventos, semana.dias))
    }
    return mapa
  }, [personas, crudo, semana.dias])

  /* ---------------------------- los nombres de los clientes ---------------------------- */

  const pedirNombres = useCallback(
    (ids: string[]) => {
      const faltan = ids.filter((id) => !nombresPedidos.current.has(id))
      if (faltan.length === 0) return
      faltan.forEach((id) => nombresPedidos.current.add(id))
      void (async () => {
        try {
          const encontrados = await leerNombres(supabase, faltan)
          for (const id of faltan) if (!encontrados.has(id)) encontrados.set(id, { nombre: '', empresa: null })
          setNombres((antes) => {
            const ahora = new Map(antes)
            encontrados.forEach((v, k) => ahora.set(k, v))
            return ahora
          })
        } catch (e) {
          console.error('Informe semanal: no se han podido leer los nombres de los clientes', e)
          faltan.forEach((id) => nombresPedidos.current.delete(id))
        }
      })()
    },
    [supabase]
  )

  const nombresUtiles = useMemo(() => {
    const m = new Map<string, NombreDeLead>()
    nombres.forEach((v, k) => {
      if (v.nombre) m.set(k, v)
    })
    return m
  }, [nombres])

  /* ---------------------------- abrir a una persona ---------------------------- */

  const alternar = (id: string) =>
    setAbiertas((antes) => {
      const ahora = new Set(antes)
      if (!ahora.delete(id)) ahora.add(id)
      return ahora
    })

  const abrirPersona = (id: string, dia?: string) => {
    setAbiertas((antes) => new Set(antes).add(id))
    if (dia) setDiasElegidos((antes) => ({ ...antes, [id]: dia }))
    // Se espera a que se pinte lo que se acaba de abrir para ir a ello
    requestAnimationFrame(() => document.getElementById(`persona-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  const todasAbiertas = personas.length > 0 && personas.every((p) => abiertas.has(p.id))

  /* ---------------------------- lo que se pinta ---------------------------- */

  if (!montado) return null

  const tituloDeSemana = `Semana ${etiquetaLargaDeSemana(semana)}`
  const estado = semana.completa
    ? 'Semana completa'
    : semana.transcurridos === 0
      ? 'Esta semana todavía no ha empezado'
      : `Semana en curso: lleva ${semana.transcurridos} de 7 días${semana.completa ? '' : ' (hoy todavía no ha acabado)'} y se compara con los mismos días de la semana anterior`

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto bg-[#080808] text-white" role="dialog" aria-modal="true" aria-label={`Informe semanal. ${tituloDeSemana}`}>
      <header className="sm:sticky sm:top-0 z-20 border-b border-white/10 bg-[#080808]/90 backdrop-blur px-4 sm:px-6 py-3">
        <div className="max-w-[1500px] mx-auto flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-[0.18em] text-[#FF6600]">Informe semanal</p>
            <h1 className="text-[20px] sm:text-[24px] font-semibold leading-tight text-white">{tituloDeSemana}</h1>
            <p className={`text-[12px] ${semana.completa ? 'text-emerald-400/80' : 'text-amber-300/90'}`}>{estado}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {cargando && <Loader2 className="h-4 w-4 animate-spin text-white/40" aria-label="Cargando" />}
            <div className="flex items-center gap-1 rounded-full border border-white/10 bg-white/[0.03] px-1 h-8">
              <button type="button" onClick={() => irA(sumarDias(lunes, -7))} aria-label="Semana anterior" className="h-6 w-6 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => irA(sumarDias(lunes, 7))}
                disabled={!puedeAvanzar}
                aria-label="Semana siguiente"
                className="h-6 w-6 flex items-center justify-center rounded-full text-white/60 hover:text-white hover:bg-white/[0.06] transition-colors disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-white/60"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button type="button" onClick={() => irA(lunesPorDefecto(hoy))} aria-pressed={lunes === lunesPorDefecto(hoy)} className={`${CHIP} ${lunes === lunesPorDefecto(hoy) ? CHIP_ACTIVO : CHIP_QUIETO}`}>
              Semana pasada
            </button>
            <button type="button" onClick={() => irA(estaSemana)} aria-pressed={lunes === estaSemana} className={`${CHIP} ${lunes === estaSemana ? CHIP_ACTIVO : CHIP_QUIETO}`}>
              Esta semana
            </button>
            {puedePantallaCompleta && (
              <button type="button" onClick={alternarPantallaCompleta} className={`${CHIP} ${CHIP_QUIETO} flex items-center gap-1.5`}>
                {pantallaCompleta ? <Shrink className="h-3.5 w-3.5" /> : <Expand className="h-3.5 w-3.5" />}
                {pantallaCompleta ? 'Salir de pantalla completa' : 'Pantalla completa'}
              </button>
            )}
            <button type="button" onClick={cerrar} aria-label="Cerrar el informe" title="Cerrar (Esc)" className="h-8 w-8 flex items-center justify-center rounded-full border border-white/10 text-white/60 hover:text-white hover:border-white/25 transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1500px] mx-auto px-4 sm:px-6 py-5 space-y-5 pb-20">
        {error ? (
          <p className="text-[13px] text-amber-300 py-10 text-center" role="alert">
            {error}
          </p>
        ) : !leida ? (
          <p className="text-[13px] text-white/40 py-20 text-center">Leyendo la semana…</p>
        ) : personas.length === 0 ? (
          <p className="text-[13px] text-white/40 py-20 text-center">No hay ningún comercial marcado en el equipo, así que no hay nada que enseñar.</p>
        ) : (
          <>
            <TitularesDeLaSemana titulares={frases} encabezadoParaCopiar={tituloDeSemana} />
            <CifrasDeLaSemana kpis={kpis} dias={dias} contra={contra} metrica={metrica} onElegir={setMetrica} />
            <MatrizDeLaSemana semana={semana} dias={dias} resultados={resultados} metrica={metrica} onMetrica={setMetrica} contra={contra} onAbrirPersona={abrirPersona} />

            <section className="rounded-2xl border border-white/10 bg-white/[0.02] p-4 sm:p-5 space-y-4" aria-label="Cuándo se trabaja">
              <div>
                <h2 className="text-[13px] font-semibold text-white">Cuándo se trabaja</h2>
                <p className="text-[12px] text-white/40 mt-0.5">En qué horas se llama y a qué hora suele empezar y acabar cada persona.</p>
              </div>
              <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
                <MapaDeFranjas mapa={mapaDelEquipo} dias={dias} />
                <div className="overflow-x-auto">
                  <table className="w-full text-[12px] min-w-[340px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.1em] text-white/35">
                        <th className="text-left font-medium pb-1.5">Persona</th>
                        <th className="text-right font-medium pb-1.5">Empieza</th>
                        <th className="text-right font-medium pb-1.5">Acaba</th>
                        <th className="text-right font-medium pb-1.5">Jornadas</th>
                        <th className="text-right font-medium pb-1.5">Hueco más largo</th>
                      </tr>
                    </thead>
                    <tbody className="tabular-nums">
                      {personas.map((p) => {
                        const h = horarios.get(p.id)
                        const hueco = h ? Math.max(0, ...h.dias.map((d) => d.pausaMasLarga)) : 0
                        return (
                          <tr key={p.id} className="border-t border-white/[0.05]">
                            <td className="py-1.5 text-white/80">
                              <button type="button" onClick={() => abrirPersona(p.id)} className="hover:text-white hover:underline underline-offset-2 text-left">
                                {p.nombre}
                              </button>
                            </td>
                            <td className="py-1.5 text-right text-white/80">{h?.inicioMedio ?? '—'}</td>
                            <td className="py-1.5 text-right text-white/80">{h?.finMedio ?? '—'}</td>
                            <td className="py-1.5 text-right text-white/50">{h?.diasConActividad ?? 0}</td>
                            <td className={`py-1.5 text-right ${hueco >= 90 ? 'text-amber-300' : 'text-white/60'}`}>{textoDePausa(hueco)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  <p className="text-[10px] text-white/30 mt-2">Cuentan llamadas, WhatsApp, correos, respuestas y citas. Una jornada es un día con 5 apuntes o más.</p>
                </div>
              </div>
            </section>

            <section className="space-y-2.5" aria-label="Cada persona">
              <div className="flex items-center justify-between gap-3 px-1">
                <h2 className="text-[13px] font-semibold text-white">Cada persona</h2>
                <button
                  type="button"
                  onClick={() => setAbiertas(todasAbiertas ? new Set() : new Set(personas.map((p) => p.id)))}
                  className="flex items-center gap-1.5 text-[12px] text-white/50 hover:text-white transition-colors"
                >
                  <ChevronDown className={`h-3.5 w-3.5 transition-transform ${todasAbiertas ? 'rotate-180' : ''}`} aria-hidden />
                  {todasAbiertas ? 'Cerrar todas' : 'Abrir todas'}
                </button>
              </div>
              {resultados.map((r) => (
                <PersonaDelInforme
                  key={r.persona.id}
                  resultado={r}
                  semana={semana}
                  dias={dias}
                  contra={contra}
                  metrica={metrica}
                  abierta={abiertas.has(r.persona.id)}
                  onAlternar={() => alternar(r.persona.id)}
                  dia={diasElegidos[r.persona.id]}
                  onDia={(d) => setDiasElegidos((antes) => ({ ...antes, [r.persona.id]: d }))}
                  llamadas={crudo.llamadas.get(r.persona.id) ?? []}
                  notas={crudo.notas.get(r.persona.id) ?? []}
                  citas={crudo.citas.get(r.persona.id) ?? []}
                  nombres={nombresUtiles}
                  onPedirNombres={pedirNombres}
                  ahora={semana.contieneHoy ? ahoraMin : null}
                />
              ))}
            </section>

            <footer className="text-[11px] text-white/30 leading-relaxed space-y-1 px-1 pt-2">
              <p>
                Cómo se cuenta: una llamada es <span className="text-white/45">contestada</span> si dura 10 segundos o más (por debajo es un contestador automático) y una{' '}
                <span className="text-white/45">conversación</span> si pasa de 1 minuto. WhatsApp y correos cuentan clientes distintos por día, por muchos apuntes que haya. Las citas son las que se agendaron esos días.
                Los días son de lunes a domingo, en hora de Madrid. {semana.completa ? 'Se compara con la semana anterior entera.' : 'Se compara con los mismos días de la semana anterior.'}
              </p>
            </footer>
          </>
        )}
      </main>
    </div>,
    document.body
  )
}
