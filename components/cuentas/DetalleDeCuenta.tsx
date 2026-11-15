'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowRight, ArrowUpRight, BriefcaseBusiness, CalendarRange, Check, FileText, LayoutDashboard, ListChecks, NotebookPen, PartyPopper, RefreshCw, UserRound } from 'lucide-react'
import type { TipoDeInforme } from '@/lib/cuentas/informe'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { inicioParaHoy, NOMBRE_SEMANA, VENTANA_DIAS, type PasoDelCiclo } from '@/lib/cuentas/ciclo'
import { NOMBRE_AREA, queHacerHoy, semaforos, tonoGeneral, type AreaDeSalud } from '@/lib/cuentas/salud'
import type { Persona } from '@/lib/cuentas/datos'
import {
  Boton,
  CabeceraDeModulo,
  EsqueletoTarjeta,
  EsqueletoTexto,
  EstadoVacio,
  Insignia,
  PanelDePestana,
  Pestanas,
  Tarjeta,
  mezcla,
  colorDeAcento,
  TACTIL,
} from '@/components/ui-ls'
import { cn } from '@/lib/utils'
import { enlaceDe, entradaDeSalud, sumaPpc, type CuentaEnLista, type RespuestaCuentas } from './tipos'
import { Nota } from './piezas'
import { AREA_UI, SemaforosGrandes } from './salud-ui'
import { PestanaCumplimiento, PestanaMarketing, PestanaRemesas, PestanaSeo } from './PestanasDeArea'

export type PestanaDeCuenta = 'resumen' | 'marketing' | 'seo' | 'cumplimiento' | 'remesas'
const PESTANAS: readonly PestanaDeCuenta[] = ['resumen', 'marketing', 'seo', 'cumplimiento', 'remesas']

const AREA_DEL_PASO: Record<PasoDelCiclo['area'], { texto: string; tono: 'rojo' | 'naranja' | 'azul' | 'violeta' | 'gris' }> = {
  cumplimiento: { texto: 'Cumplimiento', tono: 'rojo' },
  ppc: { texto: 'PPC', tono: 'naranja' },
  seo: { texto: 'SEO', tono: 'azul' },
  informe: { texto: 'Cliente', tono: 'violeta' },
  cuenta: { texto: 'Cuenta', tono: 'gris' },
}

/** De un área de la salud a su pestaña (el ciclo vive en el Resumen) */
const PESTANA_DE_AREA: Record<AreaDeSalud, PestanaDeCuenta> = { ciclo: 'resumen', marketing: 'marketing', seo: 'seo', cumplimiento: 'cumplimiento', remesas: 'remesas' }

/**
 * EL PANEL DE UNA CUENTA: el sitio desde el que se controla todo de un cliente, en pestañas.
 *   · Resumen       la salud en una mirada (semáforos por área), lo que hay que hacer hoy, quién la lleva, la semana del ciclo S1–S4 con sus pasos,
 *                   los informes al cliente y las notas.
 *   · Marketing     publicidad de 7 días contra los 7 anteriores, por país, el motor y sus propuestas.
 *   · SEO           tareas de «Qué hacer hoy», vigía de títulos y propuestas de ficha.
 *   · Cumplimiento  cifras y tareas de la pestaña «Hoy».
 *   · Remesas       envíos FBA abiertos por fase, alertas y stock (con el permiso de Remesas).
 * Las pestañas de área son de SOLO LECTURA y cada una lleva a su app completa con el cliente ya elegido.
 */
export function DetalleDeCuenta({ slug, volver, personas: personasIniciales, pestanaInicial }: { slug: string; volver: () => void; personas: Persona[]; pestanaInicial?: PestanaDeCuenta | null }) {
  const [datos, setDatos] = useState<RespuestaCuentas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [informes, setInformes] = useState<InformeEnLista[]>([])
  const [pestana, setPestana] = useState<PestanaDeCuenta>(pestanaInicial && PESTANAS.includes(pestanaInicial) ? pestanaInicial : 'resumen')

  const cargar = useCallback(async () => {
    setCargando(true)
    setError(null)
    try {
      const r = await fetch(`/api/cuentas?cliente=${encodeURIComponent(slug)}`, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error ?? 'No se ha podido leer la cuenta.')
      setDatos(j)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido leer la cuenta.')
    } finally {
      setCargando(false)
    }
  }, [slug])

  useEffect(() => {
    cargar()
  }, [cargar])

  const cargarInformes = useCallback(async () => {
    const r = await fetch(`/api/cuentas/informe?cliente=${encodeURIComponent(slug)}`, { cache: 'no-store' }).catch(() => null)
    if (r?.ok) setInformes(((await r.json()) as { informes: InformeEnLista[] }).informes ?? [])
  }, [slug])

  useEffect(() => {
    cargarInformes()
  }, [cargarInformes])

  // La pestaña va en la dirección (?t=), para poder mandar el enlace directo a «Remesas de este cliente»
  useEffect(() => {
    const url = new URL(window.location.href)
    if (pestana === 'resumen') url.searchParams.delete('t')
    else url.searchParams.set('t', pestana)
    window.history.replaceState(null, '', url.toString())
  }, [pestana])

  // Al cambiar de pestaña desde abajo (la flecha de una tarea del Resumen, una loseta) la pestaña nueva se abría con el scroll de la anterior: en el móvil se
  // caía en mitad de Remesas sin ver su principio. Si el principio del panel ha quedado por encima de la pantalla, se sube a las pestañas.
  const primeraPestana = useRef(true)
  useLayoutEffect(() => {
    if (primeraPestana.current) {
      primeraPestana.current = false
      return
    }
    const panel = document.getElementById('panel-cuenta')
    if (panel && panel.getBoundingClientRect().top < 0) window.scrollTo(0, 0)
  }, [pestana])

  const prepararInforme = async (tipo?: TipoDeInforme) => {
    setGuardando('informe')
    setError(null)
    try {
      const r = await fetch('/api/cuentas/informe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: slug, accion: 'crear', tipo }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'No se ha podido preparar el informe.')
      window.location.href = `/dashboard/cuentas/informe/${j.id}`
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido preparar el informe.')
      setGuardando(null)
    }
  }

  const guardar = async (cuerpo: Record<string, unknown>, clave: string) => {
    setGuardando(clave)
    try {
      const r = await fetch('/api/cuentas', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cliente: slug, ...cuerpo }) })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(j.error ?? 'No se ha podido guardar.')
      await cargar()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setGuardando(null)
    }
  }

  const c: CuentaEnLista | undefined = datos?.clientes[0]
  const personas = datos?.personas ?? personasIniciales
  const salud = useMemo(() => (c && datos ? semaforos(entradaDeSalud(c, datos.hoy)) : []), [c, datos])
  const general = tonoGeneral(salud)

  // Las cifras de cada pestaña, para el número de la pestaña
  const cuentas = useMemo(() => {
    if (!c) return null
    const tareasSeo = c.seo?.cuentas.flatMap((x) => x.tareas) ?? []
    return {
      marketing: sumaPpc(c.ppc.cuentas).pendientes,
      seo: tareasSeo.filter((t) => t.gravedad !== 'info').length + (c.seo?.cuentas.reduce((a, x) => a + (x.titulosCambiados?.length ?? 0), 0) ?? 0),
      cumplimiento: c.tareasCumplimiento?.tareas.length ?? 0,
      remesas: c.remesas.acceso ? c.remesas.alertas.critica + c.remesas.alertas.alta : 0,
    }
  }, [c])

  return (
    // Sin margen lateral propio por debajo de lg: la ruta ya pone p-6 (ver CuentasApp)
    <div className="mx-auto w-full max-w-[1280px] min-w-0 pb-12 lg:px-1">
      <CabeceraDeModulo
        icono={BriefcaseBusiness}
        acento="cuentas"
        titulo={c?.nombre ?? 'Cuenta'}
        junto={
          c ? (
            <Insignia tono={general} tamano="sm" vivo={general === 'rojo'}>
              {general === 'rojo' ? 'Hay urgencias' : general === 'ambar' ? 'Algo que mirar' : general === 'verde' ? 'Sana' : 'Sin datos'}
            </Insignia>
          ) : undefined
        }
        subtitulo={
          c ? (
            <>
              {c.responsable ? `La lleva ${c.responsable.nombre}` : 'Sin responsable'}
              {c.semana ? ` · ${NOMBRE_SEMANA[c.semana.semana]} · ciclo ${c.semana.ciclo}` : ' · sin ciclo'}
            </>
          ) : (
            'Leyendo la cuenta…'
          )
        }
        acciones={
          <>
            <Boton variante="fantasma" icono={ArrowLeft} onClick={volver}>
              Todas las cuentas
            </Boton>
            <Boton variante="secundario" icono={RefreshCw} onClick={() => (cargar(), cargarInformes())} cargando={cargando} disabled={cargando}>
              Actualizar
            </Boton>
          </>
        }
        debajo={
          <Pestanas<PestanaDeCuenta>
            etiqueta="Secciones de la cuenta"
            acento="cuentas"
            idPanel="panel-cuenta"
            valor={pestana}
            onCambio={setPestana}
            opciones={[
              { id: 'resumen', texto: 'Resumen', icono: LayoutDashboard },
              { id: 'marketing', texto: 'Marketing', icono: AREA_UI.marketing.icono, cuenta: cuentas?.marketing || undefined },
              { id: 'seo', texto: 'SEO', icono: AREA_UI.seo.icono, cuenta: cuentas?.seo || undefined },
              { id: 'cumplimiento', texto: 'Cumplimiento', icono: AREA_UI.cumplimiento.icono, cuenta: cuentas?.cumplimiento || undefined },
              { id: 'remesas', texto: 'Remesas', icono: AREA_UI.remesas.icono, cuenta: cuentas?.remesas || undefined },
            ]}
          />
        }
      />

      <div className="flex flex-col gap-4">
        {datos?.aviso307 && <Nota tono="ambar">{datos.aviso307}</Nota>}
        {error && <Nota tono="rojo">{error}</Nota>}
      </div>

      {!c && !error && <CargandoDetalle />}
      {!c && error && !cargando && (
        <Tarjeta className="mt-4">
          <EstadoVacio icono={BriefcaseBusiness} acento="cuentas" titulo="No se ha podido abrir la cuenta" descripcion="Vuelve a intentarlo; si sigue fallando, avisa." accion={{ texto: 'Reintentar', onClick: cargar }} accionSecundaria={{ texto: 'Todas las cuentas', onClick: volver }} />
        </Tarjeta>
      )}

      {c && datos && (
        <PanelDePestana id="panel-cuenta" key={pestana} className="mt-4">
          {pestana === 'resumen' && (
            <Resumen
              c={c}
              datos={datos}
              personas={personas}
              salud={salud}
              irA={(a) => setPestana(PESTANA_DE_AREA[a])}
              guardar={guardar}
              guardando={guardando}
              informes={informes}
              prepararInforme={prepararInforme}
            />
          )}
          {pestana === 'marketing' && <PestanaMarketing c={c} />}
          {pestana === 'seo' && <PestanaSeo c={c} />}
          {pestana === 'cumplimiento' && <PestanaCumplimiento c={c} />}
          {pestana === 'remesas' && <PestanaRemesas c={c} />}
        </PanelDePestana>
      )}
    </div>
  )
}

function CargandoDetalle() {
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <EsqueletoTarjeta key={i} alto={104} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Tarjeta titulo="Qué hacer hoy">
          <EsqueletoTexto lineas={5} />
        </Tarjeta>
        <EsqueletoTarjeta alto={220} />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Resumen                                                             */
/* ------------------------------------------------------------------ */

function Resumen({
  c,
  datos,
  personas,
  salud,
  irA,
  guardar,
  guardando,
  informes,
  prepararInforme,
}: {
  c: CuentaEnLista
  datos: RespuestaCuentas
  personas: Persona[]
  salud: ReturnType<typeof semaforos>
  irA: (a: AreaDeSalud) => void
  guardar: (cuerpo: Record<string, unknown>, clave: string) => Promise<void>
  guardando: string | null
  informes: InformeEnLista[]
  prepararInforme: (t?: TipoDeInforme) => void
}) {
  const hoy = useMemo(() => queHacerHoy(entradaDeSalud(c, datos.hoy)), [c, datos.hoy])
  // Seis a la vista; el resto, al pulsar «Ver todo» (la lista no debe empujar el ciclo fuera de la pantalla)
  const [todo, setTodo] = useState(false)
  const vistos = todo ? hoy : hoy.slice(0, 6)
  const irAlCiclo = () => document.getElementById('semana-del-ciclo')?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta variante="destacada" acento="cuentas" titulo="La cuenta en una mirada" subtitulo="Pulsa un área para ver su detalle" indice={0}>
        <SemaforosGrandes semaforos={salud} alPulsar={(a) => (a === 'ciclo' ? irAlCiclo() : irA(a))} />
      </Tarjeta>

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Tarjeta titulo="Qué hacer hoy" subtitulo="Primero lo que bloquea la venta, luego el dinero que se tira" icono={ListChecks} acento="cuentas" indice={1} sinRelleno>
          {hoy.length === 0 ? (
            <EstadoVacio compacto icono={PartyPopper} acento="cuentas" titulo="Nada urgente en esta cuenta" descripcion="Todo en verde. Si no tiene ciclo todavía, ponle uno a la derecha para que cada semana sepas qué toca." />
          ) : (
            <ol className="divide-y divide-[var(--ls-linea)]">
              {vistos.map((x) => {
                const { icono: Icono, acento } = AREA_UI[x.area]
                const color = colorDeAcento(acento)
                const urgente = x.prioridad === 0
                return (
                  <li key={x.id} className="flex items-start gap-3 px-4 py-3">
                    <span className="mt-[1px] flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px]" style={{ background: mezcla(color, 15), color }}>
                      <Icono className="h-4 w-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13.5px] font-semibold text-[var(--ls-t1)]">{x.titulo}</span>
                        {urgente && (
                          <Insignia tono="rojo" tamano="sm" vivo>
                            Ya
                          </Insignia>
                        )}
                      </div>
                      <p className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{x.detalle}</p>
                    </div>
                    <Boton variante="fantasma" tamano="sm" iconoDerecha={ArrowRight} onClick={() => (x.area === 'ciclo' ? irAlCiclo() : irA(x.area))} aria-label={`Ver ${NOMBRE_AREA[x.area]}`}>
                      <span className="hidden sm:inline">{NOMBRE_AREA[x.area]}</span>
                    </Boton>
                  </li>
                )
              })}
              {hoy.length > 6 && (
                <li className="px-4 py-2">
                  <Boton variante="fantasma" tamano="sm" onClick={() => setTodo((v) => !v)}>
                    {todo ? 'Ver menos' : `Ver las ${hoy.length} cosas`}
                  </Boton>
                </li>
              )}
            </ol>
          )}
        </Tarjeta>

        <QuienYCiclo c={c} datos={datos} personas={personas} guardar={guardar} guardando={guardando} />
      </div>

      <SemanaDelCiclo c={c} datos={datos} guardar={guardar} guardando={guardando} informes={informes} prepararInforme={prepararInforme} />

      <div className="grid gap-4 lg:grid-cols-2">
        <Informes informes={informes} desactivado={datos.falta307} ocupado={guardando === 'informe'} preparar={prepararInforme} />
        <Notas c={c} desactivado={datos.falta307} guardar={(notas) => guardar({ accion: 'notas', notas }, 'notas')} />
      </div>
    </div>
  )
}

const CAMPO = cn(
  'h-9 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] disabled:opacity-50',
  TACTIL,
)

function QuienYCiclo({ c, datos, personas, guardar, guardando }: { c: CuentaEnLista; datos: RespuestaCuentas; personas: Persona[]; guardar: (cuerpo: Record<string, unknown>, clave: string) => Promise<void>; guardando: string | null }) {
  return (
    <Tarjeta titulo="Quién la lleva y su ciclo" icono={UserRound} acento="cuentas" indice={2}>
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-[6px] text-[12px] font-medium text-[var(--ls-t3)]">
          Responsable de la cuenta
          <select
            value={c.responsable?.id ?? ''}
            disabled={datos.falta307 || guardando === 'responsable'}
            onChange={(e) => guardar({ accion: 'responsable', responsableId: e.target.value || null }, 'responsable')}
            className={CAMPO}
          >
            <option value="">Sin responsable</option>
            {personas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nombre}
                {p.id === datos.yo ? ' (tú)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-[6px] text-[12px] font-medium text-[var(--ls-t3)]">
          Su ciclo empezó (lunes de la S1)
          <span className="flex flex-wrap items-center gap-2">
            <input
              type="date"
              value={c.cicloInicio ?? ''}
              disabled={datos.falta307 || guardando === 'ciclo'}
              onChange={(e) => e.target.value && guardar({ accion: 'ciclo', inicio: e.target.value }, 'ciclo')}
              className={cn(CAMPO, 'w-auto min-w-[170px] flex-1')}
            />
            {!c.cicloInicio && (
              <Boton variante="primario" disabled={datos.falta307} cargando={guardando === 'ciclo'} onClick={() => guardar({ accion: 'ciclo', inicio: inicioParaHoy(datos.hoy) }, 'ciclo')}>
                Empezar esta semana
              </Boton>
            )}
          </span>
        </label>
        {/* Las cuatro semanas del ciclo, con la de hoy encendida */}
        <div>
          <div className="mb-[6px] text-[12px] font-medium text-[var(--ls-t3)]">{c.semana ? `Ciclo ${c.semana.ciclo} · datos de los últimos ${VENTANA_DIAS[c.semana.semana]} días` : 'Las cuatro semanas del ciclo'}</div>
          <div className="grid grid-cols-4 gap-[6px]">
            {([1, 2, 3, 4] as const).map((s) => {
              const actual = c.semana?.semana === s
              const pasada = c.semana ? s < c.semana.semana : false
              return (
                <div
                  key={s}
                  className="relative overflow-hidden rounded-[10px] border px-2 py-2 text-center"
                  style={{
                    borderColor: actual ? mezcla('var(--ls-mod-cuentas)', 55) : 'var(--ls-linea)',
                    background: actual ? mezcla('var(--ls-mod-cuentas)', 14) : pasada ? 'var(--ls-sup2)' : 'transparent',
                  }}
                  aria-current={actual ? 'step' : undefined}
                >
                  <div className={cn('text-[13px] font-semibold', actual ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]')}>S{s}</div>
                  <div className="truncate text-[10.5px] text-[var(--ls-t4)]">{NOMBRE_SEMANA[s].split(' · ')[1]}</div>
                  {pasada && <Check className="absolute right-1 top-1 h-3 w-3 text-[var(--ls-t4)]" aria-hidden />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </Tarjeta>
  )
}

function SemanaDelCiclo({
  c,
  datos,
  guardar,
  guardando,
  informes,
  prepararInforme,
}: {
  c: CuentaEnLista
  datos: RespuestaCuentas
  guardar: (cuerpo: Record<string, unknown>, clave: string) => Promise<void>
  guardando: string | null
  informes: InformeEnLista[]
  prepararInforme: (t?: TipoDeInforme) => void
}) {
  const hechos = c.pasos.filter((p) => c.hechos.includes(p.id)).length
  return (
    <section id="semana-del-ciclo" className="scroll-mt-24">
      <Tarjeta
        titulo={c.semana ? `Esta semana · ${NOMBRE_SEMANA[c.semana.semana]}` : 'Esta semana'}
        subtitulo={c.semana ? `${hechos} de ${c.pasos.length} pasos hechos · en orden` : undefined}
        icono={CalendarRange}
        acento="cuentas"
        indice={3}
        sinRelleno
      >
        {!c.semana ? (
          <EstadoVacio
            compacto
            icono={CalendarRange}
            acento="cuentas"
            titulo="Esta cuenta aún no tiene ciclo"
            descripcion="Cada cliente lleva su ciclo de 4 semanas: S1 semanal, S2 quincenal con pujas y auditoría, S3 semanal con el cambio de ficha y S4 mensual. Así no caen todos los informes mensuales la misma semana."
            accion={datos.falta307 ? undefined : { texto: 'Empezar esta semana', onClick: () => guardar({ accion: 'ciclo', inicio: inicioParaHoy(datos.hoy) }, 'ciclo') }}
          />
        ) : (
          <>
            <div className="h-[3px] bg-[var(--ls-sup2)]">
              <div className="h-full rounded-r-full transition-[width] duration-700" style={{ width: `${(hechos / Math.max(1, c.pasos.length)) * 100}%`, background: hechos === c.pasos.length ? COLOR_ESTADO.verde : 'var(--ls-mod-cuentas)' }} />
            </div>
            <ol className="divide-y divide-[var(--ls-linea)]">
              {c.pasos.map((p, i) => {
                const hecho = c.hechos.includes(p.id)
                const area = AREA_DEL_PASO[p.area]
                return (
                  <li key={p.id} className="flex flex-wrap items-start gap-3 px-4 py-3 sm:flex-nowrap">
                    <button
                      type="button"
                      aria-label={hecho ? `Marcar «${p.titulo}» como pendiente` : `Marcar «${p.titulo}» como hecho`}
                      aria-pressed={hecho}
                      disabled={datos.falta307 || guardando === p.id}
                      onClick={() => guardar({ accion: 'paso', paso: p.id, hecho: !hecho }, p.id)}
                      className="group/check -m-[10px] flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] disabled:opacity-50"
                    >
                      <span
                        className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border transition-colors group-hover/check:border-[var(--ls-t3)]"
                        style={hecho ? { background: COLOR_ESTADO.verde, borderColor: COLOR_ESTADO.verde } : { borderColor: 'var(--ls-linea2)' }}
                      >
                        {hecho && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
                      </span>
                    </button>
                    <div className={cn('min-w-0 flex-1 basis-[calc(100%-60px)] sm:basis-auto', hecho && 'opacity-55')}>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{i + 1}</span>
                        <span className={cn('text-[13.5px] font-semibold text-[var(--ls-t1)]', hecho && 'line-through')}>{p.titulo}</span>
                        <Insignia tono={area.tono} tamano="sm" punto={false}>
                          {area.texto}
                        </Insignia>
                      </div>
                      <p className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{p.detalle}</p>
                    </div>
                    <div className="ml-[46px] self-center sm:ml-0">
                      {p.herramienta === 'informe' ? (
                        <BotonDeInforme paso={p.id} informes={informes} lunes={c.semana?.lunes ?? null} preparar={prepararInforme} ocupado={guardando === 'informe'} desactivado={datos.falta307} />
                      ) : (
                        <Boton asChild variante="secundario" tamano="sm" iconoDerecha={ArrowUpRight}>
                          <Link href={enlaceDe(p.herramienta, c)}>Abrir</Link>
                        </Boton>
                      )}
                    </div>
                  </li>
                )
              })}
            </ol>
          </>
        )}
      </Tarjeta>
    </section>
  )
}

function Informes({ informes, desactivado, ocupado, preparar }: { informes: InformeEnLista[]; desactivado: boolean; ocupado: boolean; preparar: (t?: TipoDeInforme) => void }) {
  const botones = (['semanal', 'quincenal', 'mensual'] as const).map((t) => (
    <Boton key={t} variante="fantasma" tamano="sm" disabled={desactivado || ocupado} onClick={() => preparar(t)} className="px-2">
      + {t}
    </Boton>
  ))
  return (
    <Tarjeta
      titulo="Informes al cliente"
      icono={FileText}
      acento="personas"
      indice={4}
      sinRelleno
      // En el móvil los tres botones en la cabecera se comían el título (0 px de ancho) y «+ mensual» se cortaba: ahí van en una fila propia debajo
      acciones={<span className="hidden gap-1 sm:flex">{botones}</span>}
    >
      <div className="flex flex-wrap gap-1 border-b border-[var(--ls-linea)] px-3 py-2 sm:hidden">{botones}</div>
      {informes.length === 0 ? (
        <EstadoVacio compacto icono={FileText} acento="personas" titulo="Todavía no hay informes" descripcion="El de esta semana se prepara desde su paso del ciclo; también puedes preparar uno suelto con los botones de arriba." />
      ) : (
        <ul className="max-h-[320px] divide-y divide-[var(--ls-linea)] overflow-y-auto">
          {informes.map((i) => (
            <li key={i.id}>
              <Link href={`/dashboard/cuentas/informe/${i.id}`} className={cn('flex items-center gap-3 px-4 py-[10px] text-[13px] transition-colors hover:bg-[var(--ls-sup2)] focus-visible:bg-[var(--ls-sup2)] focus-visible:outline-none', TACTIL)}>
                <span className="w-[78px] shrink-0 font-semibold capitalize text-[var(--ls-t1)]">{i.tipo}</span>
                <span className="min-w-0 flex-1 truncate tabular-nums text-[var(--ls-t3)]">
                  {i.desde} → {i.hasta}
                </span>
                <Insignia tono={i.estado === 'enviado' ? 'verde' : 'ambar'} tamano="sm">
                  {i.estado === 'enviado' ? 'Enviado' : 'Borrador'}
                </Insignia>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

function Notas({ c, desactivado, guardar }: { c: CuentaEnLista; desactivado: boolean; guardar: (notas: string | null) => Promise<void> }) {
  const [texto, setTexto] = useState(c.notas ?? '')
  const [guardadas, setGuardadas] = useState(true)
  useEffect(() => {
    setTexto(c.notas ?? '')
    setGuardadas(true)
  }, [c.notas])
  return (
    <Tarjeta titulo="Notas de la cuenta" subtitulo="Lo que pide el cliente, acuerdos, lo que hay que vigilar" icono={NotebookPen} acento="cuentas" indice={5}>
      <div className="flex flex-col gap-3">
        <textarea
          value={texto}
          disabled={desactivado}
          onChange={(e) => (setTexto(e.target.value), setGuardadas(false))}
          rows={5}
          aria-label="Notas de la cuenta"
          className="w-full resize-y rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] leading-[1.55] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-linea2)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
          placeholder="Ej.: quiere priorizar el lanzamiento del producto nuevo en diciembre; no bajar del 20 % de margen; el informe se lo mandamos a Ana."
        />
        <div className="flex items-center gap-3">
          <Boton variante={guardadas ? 'secundario' : 'primario'} disabled={desactivado || guardadas} onClick={() => guardar(texto.trim() || null)} icono={guardadas ? Check : undefined}>
            {guardadas ? 'Guardadas' : 'Guardar notas'}
          </Boton>
          {!guardadas && <span className="text-[12px] text-[var(--ls-t4)]">Para que cualquiera pueda coger la cuenta mañana.</span>}
        </div>
      </div>
    </Tarjeta>
  )
}

interface InformeEnLista {
  id: string
  tipo: TipoDeInforme
  desde: string
  hasta: string
  estado: 'borrador' | 'enviado'
  enviadoAt: string | null
  creadoAt: string
}

/** El botón del paso «Informe al cliente»: prepara el borrador o abre el que ya hay de esta semana */
function BotonDeInforme({ paso, informes, lunes, preparar, ocupado, desactivado }: { paso: string; informes: InformeEnLista[]; lunes: string | null; preparar: (t?: TipoDeInforme) => void; ocupado: boolean; desactivado: boolean }) {
  const tipo = paso.replace('informe-', '') as TipoDeInforme
  // El de esta semana: el último de ese tipo creado desde su lunes
  const deEstaSemana = lunes ? informes.find((i) => i.tipo === tipo && i.creadoAt.slice(0, 10) >= lunes) : undefined
  if (deEstaSemana) {
    return (
      <Boton asChild variante="secundario" tamano="sm" iconoDerecha={ArrowUpRight}>
        <Link href={`/dashboard/cuentas/informe/${deEstaSemana.id}`}>{deEstaSemana.estado === 'enviado' ? 'Ver enviado' : 'Abrir borrador'}</Link>
      </Boton>
    )
  }
  return (
    <Boton variante="primario" tamano="sm" disabled={desactivado} cargando={ocupado} onClick={() => preparar(tipo)}>
      {ocupado ? 'Preparando…' : 'Preparar borrador'}
    </Boton>
  )
}

