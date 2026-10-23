'use client'

import { CalendarClock, Check, FlaskConical, Hourglass, Inbox, Pause, Send, TriangleAlert } from 'lucide-react'
import { useMemo, type CSSProperties, type ReactNode } from 'react'
import { Avatar, CabeceraDePanel, IconoEnCaja, Numero, PANEL, Revelar } from '@/components/rendimiento/ui'
import { diaCorto, partesDeMadrid } from '@/lib/correo/secuencias/fechas'
import type { CarrilDeHoy, EstadoDeSalida, PuntoDeHoy } from '@/lib/correo/secuencias/vistas'
import { cuando, cuentaAtras, type Tablero } from './datos'

/**
 * HOY: EL REPARTO DEL DÍA, UN CARRIL POR BUZÓN.
 *
 * Cada carril es el día de trabajo de un buzón, de la hora de apertura a la de cierre. Los puntos son los seguimientos automáticos: verde, los que ya han
 * salido; anillo naranja, los que van a salir (el próximo de cada buzón late); ámbar, uno aplazado por el control; gris discontinuo, uno que en ensayo se habría
 * enviado. Debajo, en gris, lo que esa persona ha mandado a mano cada hora (así se ve cómo se reparte la carga). La raya naranja es «ahora» y se mueve sola.
 */

interface Props {
  tablero: Tablero
  ahora: number
  onAbrir: (inscripcionId: string) => void
  recien: ReadonlySet<string>
}

const ESTILO_DE_PUNTO: Record<EstadoDeSalida, { color: string; relleno: boolean; discontinuo: boolean; etiqueta: string }> = {
  enviado: { color: 'var(--ls-e-verde)', relleno: true, discontinuo: false, etiqueta: 'Enviado' },
  enviando: { color: 'var(--ls-acc-graf)', relleno: true, discontinuo: false, etiqueta: 'Enviándose' },
  programado: { color: 'var(--ls-acc-graf)', relleno: false, discontinuo: false, etiqueta: 'Programado' },
  aplazado: { color: 'var(--ls-e-ambar)', relleno: false, discontinuo: false, etiqueta: 'Aplazado' },
  ensayo: { color: 'var(--ls-t4)', relleno: false, discontinuo: true, etiqueta: 'En ensayo' },
  pausado: { color: 'var(--ls-e-ambar)', relleno: false, discontinuo: false, etiqueta: 'Detenido' },
  fallido: { color: 'var(--ls-e-rojo)', relleno: false, discontinuo: false, etiqueta: 'Falló' },
}

const ICONO_DE_PUNTO: Record<EstadoDeSalida, typeof Check> = {
  enviado: Check,
  enviando: Send,
  programado: Send,
  aplazado: Hourglass,
  ensayo: FlaskConical,
  pausado: Pause,
  fallido: TriangleAlert,
}

const minutosDe = (ms: number): number => {
  const p = partesDeMadrid(ms)
  return p.minutos + p.segundo / 60
}

/** Reparte los puntos en filas para que no se tapen entre sí: cada uno va a la primera fila donde queda sitio */
function colocar(puntos: readonly PuntoDeHoy[], desde: number, hasta: number, separacion = 1.7, filas = 4): Array<PuntoDeHoy & { x: number; fila: number }> {
  const ultimo: number[] = []
  return puntos.map((p) => {
    const x = Math.min(100, Math.max(0, ((minutosDe(p.en) - desde) / (hasta - desde)) * 100))
    let fila = ultimo.findIndex((u) => x - u >= separacion)
    if (fila === -1) fila = ultimo.length < filas ? ultimo.length : 0
    ultimo[fila] = x
    return { ...p, x, fila }
  })
}

function Tarjeta({ icono, titulo, valor, nota, escalon }: { icono: ReactNode; titulo: string; valor: number; nota?: ReactNode; escalon: number }) {
  return (
    <Revelar i={escalon} className={`${PANEL} flex items-center gap-3 px-3 py-2.5`}>
      <IconoEnCaja>{icono}</IconoEnCaja>
      <div className="min-w-0">
        <p className="text-[11px] text-[var(--ls-t4)]">{titulo}</p>
        <p className="text-[20px] font-semibold leading-tight tabular-nums text-[var(--ls-t1)]">
          <Numero valor={valor} />
        </p>
        {nota && <p className="truncate text-[10.5px] text-[var(--ls-t4)]">{nota}</p>}
      </div>
    </Revelar>
  )
}

function Punto({ p, siguiente, destello, onAbrir }: { p: PuntoDeHoy & { x: number; fila: number }; siguiente: boolean; destello: boolean; onAbrir: () => void }) {
  const e = ESTILO_DE_PUNTO[p.estado]
  const Icono = ICONO_DE_PUNTO[p.estado]
  return (
    <button
      type="button"
      onClick={onAbrir}
      aria-label={`${e.etiqueta}: seguimiento ${p.orden} de ${p.de} a ${p.lead}`}
      className="group absolute z-10 -translate-x-1/2 outline-none"
      style={{ left: `${p.x}%`, top: 22 + p.fila * 17 }}
    >
      <span className="sec-nodo inline-flex" style={{ '--d': 0 } as CSSProperties}>
        <span
          className={`flex h-[14px] w-[14px] items-center justify-center rounded-full border-2 transition-transform group-hover:scale-125 group-focus-visible:scale-125 ${siguiente ? 'sec-pulso' : ''} ${destello ? 'sec-destello' : ''}`}
          style={{ borderColor: e.color, borderStyle: e.discontinuo ? 'dashed' : 'solid', background: e.relleno ? e.color : 'var(--ls-sup)', color: e.relleno ? 'var(--ls-sup)' : e.color }}
        >
          <Icono className="h-[8px] w-[8px]" strokeWidth={3} aria-hidden />
        </span>
      </span>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-30 mb-1.5 hidden w-max max-w-[220px] -translate-x-1/2 rounded-[8px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] px-2.5 py-1.5 text-left shadow-xl shadow-black/40 group-hover:block group-focus-visible:block"
      >
        <span className="block truncate text-[12px] font-semibold text-[var(--ls-t1)]">{p.lead}</span>
        <span className="block text-[11px] text-[var(--ls-t3)]">
          Seguimiento {p.orden} de {p.de} · {e.etiqueta.toLowerCase()}
        </span>
        <span className="block text-[11px] tabular-nums text-[var(--ls-t4)]">{p.destinatario}</span>
      </span>
    </button>
  )
}

function Carril({ carril, tablero, ahora, onAbrir, recien, escalon }: { carril: CarrilDeHoy; tablero: Tablero; ahora: number; onAbrir: (id: string) => void; recien: ReadonlySet<string>; escalon: number }) {
  const { desdeMin, hastaMin } = tablero.hoy
  const buzon = tablero.buzones.find((b) => b.id === carril.buzonId)
  const puntos = useMemo(() => colocar(carril.puntos, desdeMin, hastaMin), [carril.puntos, desdeMin, hastaMin])
  const filas = Math.max(1, ...puntos.map((p) => p.fila + 1))
  const alto = 30 + filas * 17 + 24
  const horas: number[] = []
  for (let h = Math.ceil(desdeMin / 60); h * 60 <= hastaMin; h++) horas.push(h)
  const maxManual = Math.max(1, ...carril.manual)
  const ahoraMin = minutosDe(ahora)
  const dentro = ahoraMin >= desdeMin && ahoraMin <= hastaMin
  const pctAhora = ((ahoraMin - desdeMin) / (hastaMin - desdeMin)) * 100
  const proximo = puntos.find((p) => (p.estado === 'programado' || p.estado === 'aplazado') && p.en >= ahora)
  const ancho = (min: number) => `${((min - desdeMin) / (hastaMin - desdeMin)) * 100}%`
  const usado = carril.manualHoy + carril.enviadosHoy
  const total = Math.max(carril.topeHoy, usado + carril.programadosHoy, 1)
  const pct = (n: number) => `${Math.min(100, (n / total) * 100)}%`

  return (
    <Revelar i={escalon} className="grid gap-x-4 gap-y-1 border-b border-[var(--ls-linea)] px-3 py-2.5 last:border-b-0 md:grid-cols-[190px_minmax(0,1fr)]">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Avatar id={carril.buzonId} nombre={carril.propietario} tamano={24} />
          <div className="min-w-0">
            <p className="truncate text-[12.5px] font-medium text-[var(--ls-t1)]">
              {carril.propietario}
              {carril.esMio && <span className="ml-1 text-[11px] font-normal text-[var(--ls-t4)]">(tú)</span>}
            </p>
            <p className="truncate text-[10.5px] text-[var(--ls-t4)]">{carril.direccion}</p>
          </div>
        </div>
        <div className="mt-2" title={`Hoy: ${carril.manualHoy} a mano, ${carril.enviadosHoy} automáticos enviados y ${carril.programadosHoy} por salir. Tope del día: ${carril.topeHoy}.`}>
          <div className="flex h-[5px] overflow-hidden rounded-full bg-[var(--ls-sup3)]">
            <span className="sec-barra block h-full bg-[var(--ls-t4)]" style={{ width: pct(carril.manualHoy), '--d': escalon } as CSSProperties} />
            <span className="sec-barra block h-full bg-[var(--ls-e-verde)]" style={{ width: pct(carril.enviadosHoy), '--d': escalon + 1 } as CSSProperties} />
            <span className="sec-barra block h-full bg-[var(--ls-acc-graf)] opacity-60" style={{ width: pct(carril.programadosHoy), '--d': escalon + 2 } as CSSProperties} />
          </div>
          <p className="mt-1 flex flex-wrap items-baseline gap-x-1 text-[10.5px] tabular-nums text-[var(--ls-t4)]">
            <span className="font-semibold text-[var(--ls-t2)]">{usado}</span> de {carril.topeHoy} hoy
            {buzon && buzon.pausadoHasta && buzon.pausadoHasta > ahora && <span className="text-[var(--ls-e-ambar)]">· en pausa</span>}
            {buzon && !buzon.participa && <span className="text-[var(--ls-t4)]">· fuera del motor</span>}
          </p>
        </div>
      </div>

      <div className="relative min-w-0 overflow-x-auto overflow-y-hidden" style={{ minHeight: alto }}>
        <div className="relative min-w-[560px]" style={{ height: alto }}>
          {buzon && buzon.llamadasHastaMin > desdeMin && buzon.llamadasDesdeMin < hastaMin && (
            <div className="absolute inset-y-0 rounded-[4px] bg-[var(--ls-sup2)]" style={{ left: ancho(Math.max(desdeMin, buzon.llamadasDesdeMin)), width: `${((Math.min(hastaMin, buzon.llamadasHastaMin) - Math.max(desdeMin, buzon.llamadasDesdeMin)) / (hastaMin - desdeMin)) * 100}%` }} title="Horas en las que llama (y escribe a mano)">
              <span className="absolute right-1.5 top-[13px] text-[9.5px] text-[var(--ls-t4)]">llamando</span>
            </div>
          )}
          {horas.map((h) => (
            <span key={h} className="absolute inset-y-0 border-l border-dashed border-[var(--ls-linea)]" style={{ left: ancho(h * 60) }}>
              <span className="absolute -top-px left-1 text-[9.5px] tabular-nums text-[var(--ls-t4)]">{h}</span>
            </span>
          ))}
          {/* lo que la persona manda a mano, hora a hora */}
          {carril.manual.map((n, h) =>
            n > 0 && h * 60 >= desdeMin - 59 && h * 60 < hastaMin ? (
              <span
                key={h}
                className="sec-barra absolute bottom-0 rounded-t-[2px] bg-[var(--ls-t4)] opacity-35"
                style={{ left: ancho(Math.max(h * 60, desdeMin)), width: `calc(${(60 / (hastaMin - desdeMin)) * 100}% - 3px)`, height: Math.max(3, (n / maxManual) * 20), '--d': escalon } as CSSProperties}
                title={`${n} a mano de ${h}:00 a ${h}:59`}
              />
            ) : null
          )}
          {dentro && (
            <span className="pointer-events-none absolute inset-y-0 z-20 -translate-x-1/2 transition-[left] duration-1000 ease-linear" style={{ left: `${pctAhora}%` }}>
              <span className="sec-ahora absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 rounded-full bg-[var(--ls-acc-graf)] shadow-[0_0_8px_var(--ls-acc-graf)]" />
            </span>
          )}
          {puntos.map((p) => (
            <Punto key={p.pasoId} p={p} siguiente={proximo?.pasoId === p.pasoId} destello={recien.has(p.pasoId)} onAbrir={() => onAbrir(p.inscripcionId)} />
          ))}
        </div>
      </div>
    </Revelar>
  )
}

export function VistaDeHoy({ tablero, ahora, onAbrir, recien }: Props) {
  const { hoy } = tablero
  const enviados = hoy.carriles.reduce((s, c) => s + c.enviadosHoy, 0)
  const porSalir = hoy.carriles.reduce((s, c) => s + c.programadosHoy, 0)
  const vivas = tablero.conteos.activa + tablero.conteos.pausada
  const proximos = hoy.carriles
    .flatMap((c) => c.puntos.map((p) => ({ ...p, propietario: c.propietario })))
    .filter((p) => (p.estado === 'programado' || p.estado === 'aplazado' || p.estado === 'enviando') && p.en >= ahora - 60_000)
    .sort((a, b) => a.en - b.en)
    .slice(0, 6)
  const dentro = partesDeMadrid(ahora).minutos >= hoy.desdeMin && partesDeMadrid(ahora).minutos <= hoy.hastaMin

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <Tarjeta escalon={0} icono={<Send className="h-3.5 w-3.5" aria-hidden />} titulo="Enviados hoy" valor={enviados} nota="seguimientos automáticos" />
        <Tarjeta escalon={1} icono={<CalendarClock className="h-3.5 w-3.5" aria-hidden />} titulo="Por salir hoy" valor={porSalir} nota={proximos[0] ? `el próximo, ${cuentaAtras(proximos[0].en, ahora)}` : 'nada más hoy'} />
        <Tarjeta escalon={2} icono={<Inbox className="h-3.5 w-3.5" aria-hidden />} titulo="Leads en marcha" valor={vivas} nota={`${tablero.conteos.pausada} en pausa`} />
        <Tarjeta escalon={3} icono={<Check className="h-3.5 w-3.5" aria-hidden />} titulo="Han contestado" valor={tablero.flujo.respondidas} nota={tablero.flujo.tasaDeRespuesta !== null ? `${Math.round(tablero.flujo.tasaDeRespuesta * 100)} % de las terminadas · 30 días` : 'últimos 30 días'} />
      </div>

      <section className={PANEL} aria-label="Reparto del día">
        <CabeceraDePanel
          icono={<CalendarClock className="h-3.5 w-3.5" aria-hidden />}
          titulo="El día de hoy"
          contexto={`· ${diaCorto(hoy.dia)}`}
          derecha={
            <ul className="hidden items-center gap-3 text-[10.5px] text-[var(--ls-t4)] sm:flex" aria-label="Leyenda">
              {(['enviado', 'programado', 'aplazado', 'ensayo'] as const).map((k) => (
                <li key={k} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border-2" style={{ borderColor: ESTILO_DE_PUNTO[k].color, background: ESTILO_DE_PUNTO[k].relleno ? ESTILO_DE_PUNTO[k].color : 'transparent', borderStyle: ESTILO_DE_PUNTO[k].discontinuo ? 'dashed' : 'solid' }} />
                  {ESTILO_DE_PUNTO[k].etiqueta}
                </li>
              ))}
              <li className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-1.5 rounded-t-[2px] bg-[var(--ls-t4)] opacity-40" /> A mano
              </li>
            </ul>
          }
        />
        {hoy.carriles.length === 0 ? (
          <p className="px-4 py-10 text-center text-[12.5px] text-[var(--ls-t3)]">No hay ningún buzón que mostrar.</p>
        ) : (
          <>
            {!dentro && <p className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-1.5 text-[11.5px] text-[var(--ls-t3)]">Ahora mismo es fuera del horario de envío: el motor no manda nada hasta que abra la ventana.</p>}
            {hoy.carriles.map((c, i) => (
              <Carril key={c.buzonId} carril={c} tablero={tablero} ahora={ahora} onAbrir={onAbrir} recien={recien} escalon={i} />
            ))}
          </>
        )}
      </section>

      {proximos.length > 0 && (
        <section className={PANEL} aria-label="Lo próximo en salir">
          <CabeceraDePanel icono={<Send className="h-3.5 w-3.5" aria-hidden />} titulo="Lo próximo en salir" />
          <ul>
            {proximos.map((p, i) => (
              <li key={p.pasoId}>
                <Revelar i={i}>
                  <button type="button" onClick={() => onAbrir(p.inscripcionId)} className="flex w-full items-center gap-3 border-b border-[var(--ls-linea)] px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--ls-sup2)]">
                    <span className="w-16 shrink-0 text-[12px] font-semibold tabular-nums text-[var(--ls-acc)]">{cuando(p.en, ahora).replace(/^hoy /, '')}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-[var(--ls-t1)]">{p.lead}</span>
                      <span className="block truncate text-[11px] text-[var(--ls-t4)]">
                        Seguimiento {p.orden} de {p.de} · {p.propietario}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] text-[var(--ls-t3)]">{cuentaAtras(p.en, ahora)}</span>
                  </button>
                </Revelar>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
