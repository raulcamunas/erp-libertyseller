'use client'

import { AlertTriangle, ChevronDown, ChevronLeft, ChevronRight, Sunrise } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition, type CSSProperties } from 'react'
import { toast } from 'sonner'
import { BarraDeCarga } from '@/components/rendimiento/ui'
import { situacionDelDia } from '@/lib/briefing/dias'
import type { BriefingGuardado, DiaConBriefing, EstadoDelConector, MarcaDeResuelto } from '@/lib/briefing/tipos'
import { PanelConector } from './PanelConector'
import { SeccionComercial, SeccionCorreo, SeccionCuentas, SeccionRevisaHoy, SeccionTareas, seccionesDe } from './Secciones'
import { HaceCuanto, PANEL, ProveedorDeAhora, diaCorto } from './ui'

/**
 * LA PANTALLA DEL BRIEFING: el briefing de la mañana, vivo.
 * =========================================================
 * Lo que la rutina «Briefing diario Liberty Seller» publica en el ERP, pintado como se lee mejor: portada con el titular y la agenda, un menú que sigue el scroll,
 * «Revisa hoy» con casillas de resuelto que ven los dos, el equipo comercial con sus barras, las cuentas, las tareas de clientes y el correo.
 *
 * Todo lo que viene del briefing se pinta como TEXTO. Las marcas de «resuelto» se ven al instante y se guardan en segundo plano; si no se pueden guardar, se deshacen y se dice.
 * Mirando el último día, la pantalla se pone al día sola cada dos minutos (y al volver a la pestaña), así que lo que marca Marius lo ve Raúl sin recargar.
 */

export interface PropiedadesDelPanel {
  /** El briefing que se pinta; null = todavía no hay ninguno */
  guardado: BriefingGuardado | null
  /** Los días con briefing, del más nuevo al más viejo */
  dias: DiaConBriefing[]
  /** Las marcas de «resuelto» de ese día */
  marcas: Record<string, MarcaDeResuelto>
  /** Hoy en Madrid, AAAA-MM-DD */
  hoy: string
  /** ¿Es el último publicado? (false = se ha elegido un día pasado) */
  esElUltimo: boolean
  /** ?ejemplo=1: datos inventados y marcas que no se guardan */
  esEjemplo: boolean
  /** ¿Está lanzada la migración 254? */
  migracion: boolean
  esAdmin: boolean
  /** El nombre de quien mira, para las marcas que pone */
  yo: string | null
  /** El estado del conector; solo lo recibe un administrador */
  conector: EstadoDelConector | null
}

const DOS_MINUTOS = 120_000
const ENTRE_REFRESCOS_MIN = 20_000
const URL_BASE = '/dashboard/briefing'
/** A cuántos píxeles del borde de arriba se «lee»: la sección activa del menú es la última que ya ha pasado esta línea */
const LINEA_DE_LECTURA = 140

const BOTON_DE_DIA =
  'inline-flex h-8 w-8 items-center justify-center rounded-[7px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] text-[var(--ls-t2)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] disabled:cursor-not-allowed disabled:opacity-40'

/* ------------------------------------------------------------------ */
/* Las tres situaciones sin briefing que enseñar                       */
/* ------------------------------------------------------------------ */

function EnlaceAlEjemplo() {
  return (
    <Link href={`${URL_BASE}?ejemplo=1`} className="font-semibold underline decoration-[var(--ls-linea2)] underline-offset-2 hover:decoration-[var(--ls-acc-graf)]">
      puedes ver un ejemplo
    </Link>
  )
}

function SinMigracion({ esAdmin }: { esAdmin: boolean }) {
  return (
    <div className="flex items-start gap-3 rounded-[10px] border border-l-2 border-[var(--ls-linea)] border-l-[var(--ls-e-ambar)] bg-[var(--ls-sup)] p-4">
      <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
      <div className="text-[13px] leading-relaxed text-[var(--ls-t2)]">
        <p className="mb-1 font-semibold text-[var(--ls-t1)]">Falta un paso para estrenar el Briefing</p>
        {esAdmin ? (
          <p>
            Lanza el fichero <code className="rounded bg-[var(--ls-sup3)] px-1 py-px text-[12px]">supabase/migrations/254_briefing.sql</code> en el editor SQL de Supabase y recarga esta página. Hasta entonces no hay dónde guardar el briefing.
            Mientras tanto, <EnlaceAlEjemplo />.
          </p>
        ) : (
          <p>
            Todavía no está preparado. Avisa a un administrador. Mientras tanto, <EnlaceAlEjemplo />.
          </p>
        )}
      </div>
    </div>
  )
}

function SinBriefing({ esAdmin }: { esAdmin: boolean }) {
  return (
    <div className={`${PANEL} rend-aparece grid justify-items-center gap-2 px-6 py-10 text-center`}>
      <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-[var(--ls-acc-suave)] text-[var(--ls-acc)]">
        <Sunrise className="h-6 w-6" aria-hidden />
      </span>
      <p className="text-[16px] font-semibold text-[var(--ls-t1)]">Aún no hay ningún briefing</p>
      <p className="max-w-[56ch] text-[13px] leading-snug text-[var(--ls-t3)]">
        {esAdmin
          ? 'En cuanto la rutina de la mañana publique el primero, aparecerá aquí. Para que pueda hacerlo, conecta la rutina con Claude más abajo.'
          : 'En cuanto se publique el de la mañana, aparecerá aquí.'}{' '}
        Mientras tanto, <EnlaceAlEjemplo />.
      </p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Piezas de la portada                                                */
/* ------------------------------------------------------------------ */

/** El anillo de «cuántos puntos de Revisa hoy están resueltos» */
function Anillo({ hecho, total }: { hecho: number; total: number }) {
  const radio = 26
  const circunferencia = 2 * Math.PI * radio
  const completo = total > 0 && hecho === total
  const trazo = total === 0 ? 0 : (hecho / total) * circunferencia
  return (
    <div className="flex items-center gap-3 md:flex-col md:gap-1.5" role="img" aria-label={`${hecho} de ${total} puntos resueltos`}>
      <svg width="72" height="72" viewBox="0 0 72 72" className="shrink-0">
        <circle cx="36" cy="36" r={radio} fill="none" stroke="var(--ls-sup3)" strokeWidth="6" />
        <circle
          cx="36"
          cy="36"
          r={radio}
          fill="none"
          stroke={completo ? 'var(--ls-e-verde)' : 'var(--ls-acc-graf)'}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${trazo} ${circunferencia}`}
          transform="rotate(-90 36 36)"
          style={{ transition: 'stroke-dasharray 0.5s cubic-bezier(0.22, 0.8, 0.3, 1), stroke 0.3s' }}
        />
        <text x="36" y="36" textAnchor="middle" dominantBaseline="central" className="fill-[var(--ls-t1)] text-[17px] font-bold tabular-nums">
          {hecho}/{total}
        </text>
      </svg>
      <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--ls-t3)]">{completo ? 'Todo resuelto' : 'Resueltos'}</span>
    </div>
  )
}

function NavegadorDeDias({ dias, dia, hoy, alIr, ocupado }: { dias: DiaConBriefing[]; dia: string; hoy: string; alIr: (dia: string) => void; ocupado: boolean }) {
  const i = dias.findIndex((d) => d.dia === dia)
  const masNuevo = i > 0 ? dias[i - 1] : null
  const masViejo = i >= 0 && i < dias.length - 1 ? dias[i + 1] : null
  // Un día que ya no está entre los últimos (se llegó con la dirección) también se tiene que poder ver elegido
  const opciones = i >= 0 ? dias : [{ dia, titular: '', puntosARevisar: 0 }, ...dias]
  return (
    <div className="inline-flex items-center gap-1" role="group" aria-label="Cambiar de día" title="También con las flechas ← → del teclado">
      <button type="button" aria-label="Día anterior" className={BOTON_DE_DIA} disabled={!masViejo || ocupado} onClick={() => masViejo && alIr(masViejo.dia)}>
        <ChevronLeft className="h-4 w-4" aria-hidden />
      </button>
      <label className="relative">
        <span className="sr-only">Día del briefing</span>
        <select
          value={dia}
          disabled={ocupado}
          onChange={(e) => alIr(e.target.value)}
          className="h-8 cursor-pointer appearance-none rounded-[7px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] pl-2.5 pr-7 text-[12.5px] font-semibold text-[var(--ls-t1)] outline-none transition-colors hover:bg-[var(--ls-sup3)] focus-visible:border-[var(--ls-acc-graf)] disabled:cursor-wait"
        >
          {opciones.map((d) => (
            <option key={d.dia} value={d.dia} className="bg-[var(--ls-sup)] text-[var(--ls-t1)]">
              {diaCorto(d.dia)}
              {d.dia === hoy ? ' · hoy' : ''}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
      </label>
      <button type="button" aria-label="Día siguiente" className={BOTON_DE_DIA} disabled={!masNuevo || ocupado} onClick={() => masNuevo && alIr(masNuevo.dia)}>
        <ChevronRight className="h-4 w-4" aria-hidden />
      </button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El briefing                                                         */
/* ------------------------------------------------------------------ */

function Vista({ guardado, dias, marcas: marcasDelServidor, hoy, esElUltimo, esEjemplo, yo }: PropiedadesDelPanel & { guardado: BriefingGuardado }) {
  const router = useRouter()
  const [navegando, empezar] = useTransition()
  const b = guardado.briefing
  const dia = guardado.dia
  const situacion = situacionDelDia({ dia, hoy, esElUltimo })
  const secciones = seccionesDe(b)

  /* ---- Las marcas de «resuelto»: se ven al instante y se guardan detrás ---- */
  const [marcas, setMarcas] = useState(marcasDelServidor)
  const enVuelo = useRef(new Set<string>())
  const pendientes = useRef(0)
  // Cuando el servidor trae un estado nuevo (la pantalla se pone al día sola) se adopta, salvo que haya una marca guardándose: esa manda hasta que termine
  useEffect(() => {
    if (pendientes.current === 0) setMarcas(marcasDelServidor)
  }, [marcasDelServidor])

  async function marcar(clave: string, hecho: boolean) {
    if (enVuelo.current.has(clave)) return
    const antes = marcas[clave] ?? null
    const poner = (m: MarcaDeResuelto | null) =>
      setMarcas((previas) => {
        const nuevas = { ...previas }
        if (m) nuevas[clave] = m
        else delete nuevas[clave]
        return nuevas
      })
    poner(hecho ? { por: yo, cuando: new Date().toISOString() } : null)
    if (esEjemplo) return // en el ejemplo la marca solo vive en esta pantalla

    enVuelo.current.add(clave)
    pendientes.current++
    try {
      const r = await fetch('/api/briefing/marcar', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dia, clave, hecho }) })
      const j = (await r.json().catch(() => null)) as { ok?: boolean; marca?: MarcaDeResuelto | null; error?: string } | null
      if (!r.ok || !j?.ok) throw new Error(j?.error ?? 'No se ha podido guardar la marca.')
      poner(j.marca ?? null)
    } catch (e) {
      poner(antes)
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar la marca.')
    } finally {
      enVuelo.current.delete(clave)
      pendientes.current--
    }
  }

  const resueltos = b.revisar.filter((p) => marcas[p.clave]).length

  /* ---- Cambiar de día ---- */
  const posicion = dias.findIndex((d) => d.dia === dia)
  const masNuevo = posicion > 0 ? dias[posicion - 1] : null
  const masViejo = posicion >= 0 && posicion < dias.length - 1 ? dias[posicion + 1] : null

  function irAlDia(nuevo: string) {
    if (nuevo === dia) return
    // El más reciente va sin ?dia: así la pantalla sabe que es «el último» y se pone al día sola
    const url = nuevo === dias[0]?.dia ? URL_BASE : `${URL_BASE}?dia=${nuevo}`
    empezar(() => router.push(url))
  }

  // Las flechas ← → cambian de día. El oyente se pone una sola vez y lee el último estado de esta ref
  const paraLasFlechas = useRef({ viejo: null as string | null, nuevo: null as string | null, ir: irAlDia })
  useEffect(() => {
    paraLasFlechas.current = { viejo: masViejo?.dia ?? null, nuevo: masNuevo?.dia ?? null, ir: irAlDia }
  })
  useEffect(() => {
    if (esEjemplo) return
    const alPulsar = (e: KeyboardEvent) => {
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const { viejo, nuevo, ir } = paraLasFlechas.current
      if (e.key === 'ArrowLeft' && viejo) ir(viejo)
      else if (e.key === 'ArrowRight' && nuevo) ir(nuevo)
    }
    window.addEventListener('keydown', alPulsar)
    return () => window.removeEventListener('keydown', alPulsar)
  }, [esEjemplo])

  /* ---- Ponerse al día sola mirando el último ---- */
  const ultimoRefresco = useRef(0)
  useEffect(() => {
    if (esEjemplo || !esElUltimo) return
    const refrescar = () => {
      if (document.visibilityState !== 'visible') return
      const ahora = Date.now()
      if (ahora - ultimoRefresco.current < ENTRE_REFRESCOS_MIN) return
      ultimoRefresco.current = ahora
      // Sin `empezar`: ponerse al día sola no tiene que atenuar la pantalla ni encender la rayita de carga
      router.refresh()
    }
    const id = window.setInterval(refrescar, DOS_MINUTOS)
    document.addEventListener('visibilitychange', refrescar)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', refrescar)
    }
  }, [esEjemplo, esElUltimo, router])

  /* ---- El menú de secciones que sigue el scroll ---- */
  const [activa, setActiva] = useState(secciones[0]?.id ?? '')
  const idsDeSecciones = secciones.map((s) => s.id).join('|')
  useEffect(() => {
    const ids = idsDeSecciones.split('|').filter(Boolean)
    if (ids.length === 0) return
    // «Donde estoy leyendo» es una línea a 140 px del borde de arriba (por debajo del menú): la sección activa es la última cuyo título ya la ha cruzado. Una sección a la que
    // se llega con el menú se queda con su título a 64 px (112 en el móvil), así que cruza la línea y es la activa. Al llegar al final de la página, gana la última (puede ser corta)
    const calcular = () => {
      let actual = ids[0]
      for (const id of ids) {
        const el = document.getElementById(id)
        if (el && el.getBoundingClientRect().top <= LINEA_DE_LECTURA) actual = id
      }
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) actual = ids[ids.length - 1]
      setActiva(actual)
    }
    calcular()
    window.addEventListener('scroll', calcular, { passive: true })
    window.addEventListener('resize', calcular)
    return () => {
      window.removeEventListener('scroll', calcular)
      window.removeEventListener('resize', calcular)
    }
  }, [idsDeSecciones])

  function irA(id: string) {
    const el = document.getElementById(id)
    if (!el) return
    const suave = !window.matchMedia('(prefers-reduced-motion: reduce)').matches
    el.scrollIntoView({ behavior: suave ? 'smooth' : 'auto', block: 'start' })
    setActiva(id)
  }

  const claseDeSituacion =
    situacion.clase === 'aviso'
      ? 'border-[var(--ls-e-ambar)] text-[var(--ls-t1)]'
      : situacion.clase === 'historico' || situacion.clase === 'adelantado'
        ? 'border-[var(--ls-linea2)] text-[var(--ls-t2)]'
        : ''

  return (
    <div className={`space-y-4 transition-opacity duration-200 ${navegando ? 'opacity-70' : ''}`}>
      {esEjemplo ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-dashed border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] px-3 py-2 text-[12.5px] text-[var(--ls-t1)]">
          <span>
            <b className="font-semibold">Esto es un ejemplo</b> con datos inventados, para ver cómo queda. Lo que marques aquí no se guarda.
          </span>
          <Link href={URL_BASE} className="font-semibold underline decoration-[var(--ls-acc-graf)] underline-offset-2">
            Salir del ejemplo
          </Link>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="min-w-0 text-[12.5px]">
          {situacion.texto ? (
            <span className={`inline-block rounded-[7px] border bg-[var(--ls-sup)] px-2.5 py-1 ${claseDeSituacion}`}>
              {situacion.texto}
              {situacion.clase === 'historico' ? (
                <>
                  {' '}
                  <Link href={URL_BASE} className="font-semibold underline decoration-[var(--ls-linea2)] underline-offset-2 hover:decoration-[var(--ls-acc-graf)]">
                    Ir al último
                  </Link>
                </>
              ) : null}
            </span>
          ) : (
            <span className="text-[var(--ls-t4)]">
              {esEjemplo ? 'Ejemplo' : <>Publicado <HaceCuanto iso={guardado.publicadoAt} /></>}
            </span>
          )}
        </div>
        {!esEjemplo && dias.length > 1 ? <NavegadorDeDias dias={dias} dia={dia} hoy={hoy} alIr={irAlDia} ocupado={navegando} /> : null}
      </div>

      {/* La portada */}
      <header className={`${PANEL} rend-aparece relative overflow-hidden border-t-[3px] border-t-[var(--ls-acc-graf)]`}>
        <BarraDeCarga activa={navegando} />
        <div className="grid gap-4 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-semibold uppercase tracking-[0.12em]">
              <span className="text-[var(--ls-acc)]">Briefing diario</span>
              <span className="text-[var(--ls-t4)]">{b.fecha_label}</span>
            </div>
            <p className="text-[22px] font-bold leading-[1.15] tracking-[-0.02em] text-[var(--ls-t1)] [text-wrap:balance] sm:text-[26px]">{b.titular}</p>
            {b.agenda.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5" aria-label="Agenda">
                {b.agenda.map((a, i) => (
                  <li
                    key={i}
                    className="rend-entra inline-flex max-w-full flex-wrap items-baseline gap-x-1.5 rounded-[7px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 py-1 text-[12.5px]"
                    style={{ '--d': i + 2 } as CSSProperties}
                  >
                    <span className="min-w-0">
                      <b className="mr-1.5 font-bold tabular-nums text-[var(--ls-acc)]">{a.hora}</b>
                      <span className="text-[var(--ls-t1)]">{a.titulo}</span>
                    </span>
                    {/* En una pantalla estrecha la nota baja a su propia línea; en una ancha sigue en la misma */}
                    {a.nota ? (
                      <span className="w-full text-[11.5px] text-[var(--ls-t4)] sm:w-auto sm:text-[12.5px]">
                        <span className="hidden sm:inline">· </span>
                        {a.nota}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          {b.revisar.length > 0 ? <Anillo hecho={resueltos} total={b.revisar.length} /> : null}
        </div>
        {b.actualizado ? <div className="border-t border-[var(--ls-linea)] px-4 py-1.5 text-[11.5px] text-[var(--ls-t4)] sm:px-5">Actualizado {b.actualizado}</div> : null}
      </header>

      {/* El menú que sigue el scroll */}
      {secciones.length > 1 ? (
        <nav aria-label="Secciones del briefing" className="sticky top-16 z-20 lg:top-2">
          <div className="flex items-center gap-1 overflow-x-auto rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-1 shadow-[0_8px_20px_-14px_rgba(0,0,0,0.6)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {secciones.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => irA(s.id)}
                aria-current={activa === s.id ? 'true' : undefined}
                className={`inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[7px] px-2.5 text-[12.5px] font-medium transition-colors ${
                  activa === s.id ? 'bg-[var(--ls-sup3)] text-[var(--ls-t1)] shadow-[inset_0_-2px_0_var(--ls-acc-graf)]' : 'text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]'
                }`}
              >
                {s.nombre}
                {s.n !== undefined ? <span className="tabular-nums text-[var(--ls-t4)]">{s.n}</span> : null}
              </button>
            ))}
            {b.revisar.length > 0 ? (
              <span className="ml-auto shrink-0 whitespace-nowrap pl-3 pr-2 text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                <span className={resueltos === b.revisar.length ? 'text-[var(--ls-e-verde)]' : 'text-[var(--ls-t2)]'}>{resueltos}</span>/{b.revisar.length} resueltos
              </span>
            ) : null}
          </div>
        </nav>
      ) : null}

      <div className="space-y-7 pt-1">
        <SeccionRevisaHoy puntos={b.revisar} marcas={marcas} puedeMarcar alMarcar={marcar} indice={0} />
        {b.comerciales ? <SeccionComercial c={b.comerciales} indice={1} /> : null}
        {b.equipo ? <SeccionCuentas e={b.equipo} indice={2} /> : null}
        {b.tareas ? <SeccionTareas t={b.tareas} indice={3} /> : null}
        <SeccionCorreo correo={b.correo} marcas={marcas} puedeMarcar alMarcar={marcar} indice={4} />
      </div>

      {b.pie ? <p className="max-w-[90ch] border-t border-[var(--ls-linea)] pt-3 text-[11.5px] leading-snug text-[var(--ls-t4)]">{b.pie}</p> : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* El panel                                                            */
/* ------------------------------------------------------------------ */

export function PanelBriefing(p: PropiedadesDelPanel) {
  const verEjemplo = p.esEjemplo && p.guardado !== null
  return (
    <ProveedorDeAhora>
      {/* Tope de ancho: en una pantalla muy ancha, las líneas de texto y las tarjetas se estiran y se lee peor */}
      <div className="max-w-[1240px] space-y-4">
        {!p.migracion && !verEjemplo ? (
          <SinMigracion esAdmin={p.esAdmin} />
        ) : p.guardado ? (
          // La clave reinicia las marcas locales al cambiar de día
          <Vista key={`${p.guardado.dia}|${p.esEjemplo ? 'ejemplo' : 'real'}`} {...p} guardado={p.guardado} />
        ) : (
          <SinBriefing esAdmin={p.esAdmin} />
        )}
        {p.esAdmin && p.conector && p.migracion ? <PanelConector estadoInicial={p.conector} abiertoDeInicio={!p.guardado || !p.conector.ultimoUsoAt} /> : null}
      </div>
    </ProveedorDeAhora>
  )
}
