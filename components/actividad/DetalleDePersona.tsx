'use client'

import { Eye, EyeOff, LogIn, Monitor, MousePointerClick, X } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { Avatar, BarraDeCarga, CabeceraDePanel, ChipDeFiltro, Esqueleto, PANEL } from '@/components/rendimiento/ui'
import { describirEvento } from '@/lib/actividad/describir'
import { desfaseMs, duracion, fechaCorta, horaDeMs } from '@/lib/actividad/dia'
import { nombreDePantalla, type EventoDeActividad } from '@/lib/actividad/linea'
import type { RespuestaPersona } from '@/lib/actividad/tipos'
import { apps } from '@/lib/config/apps'
import { COLOR_ESTADO } from '@/lib/estilo/denso'

/**
 * EL DÍA DE UNA PERSONA: lo que hizo y cuándo, con hora y minuto.
 *
 *   · Las cifras de arriba (cuándo entró, la última señal, el tiempo activo).
 *   · La LÍNEA DEL DÍA: una barra con las horas, los tramos en que estuvo activa en verde y marcas donde abrió el ERP o
 *     cambió de pantalla.
 *   · Las PANTALLAS que usó, con el tiempo activo en cada una.
 *   · El REGISTRO de lo que fue haciendo (abrió esto, pulsó aquello), lo último arriba.
 */

const CONOCIDAS = apps.map((a) => ({ route: a.route, name: a.name }))
const HORA = 3_600_000

type Filtro = 'todo' | 'entradas' | 'pantallas' | 'clics'

const FILTROS: ReadonlyArray<{ id: Filtro; nombre: string; vale: (e: EventoDeActividad) => boolean }> = [
  { id: 'todo', nombre: 'Todo', vale: () => true },
  { id: 'entradas', nombre: 'Entradas', vale: (e) => e.tipo === 'sesion' || e.tipo === 'login' },
  { id: 'pantallas', nombre: 'Pantallas', vale: (e) => e.tipo === 'pagina' },
  { id: 'clics', nombre: 'Clics', vale: (e) => e.tipo === 'clic' },
]

const cabecera = 'px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]'

function Dato({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0 rounded-[6px] bg-[var(--ls-sup2)] px-3 py-2">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">{rotulo}</p>
      <p className="mt-0.5 truncate text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">{children}</p>
    </div>
  )
}

function IconoDe({ tipo }: { tipo: EventoDeActividad['tipo'] }) {
  const cls = 'mt-[1px] h-3.5 w-3.5 shrink-0'
  if (tipo === 'sesion' || tipo === 'login') return <LogIn className={cls} style={{ color: COLOR_ESTADO.naranja }} aria-hidden />
  if (tipo === 'pagina') return <Monitor className={cls} style={{ color: COLOR_ESTADO.violeta }} aria-hidden />
  if (tipo === 'clic') return <MousePointerClick className={cls} style={{ color: COLOR_ESTADO.azul }} aria-hidden />
  if (tipo === 'oculta') return <EyeOff className={`${cls} text-[var(--ls-t4)]`} aria-hidden />
  return <Eye className={`${cls} text-[var(--ls-t4)]`} aria-hidden />
}

export function DetalleDePersona({
  datos,
  cargando,
  zona,
  esHoy,
  hoy,
  alCerrar,
}: {
  datos: RespuestaPersona | null
  cargando: boolean
  zona: string
  esHoy: boolean
  hoy: string
  alCerrar: () => void
}) {
  const [filtro, setFiltro] = useState<Filtro>('todo')

  const cuentas = useMemo(() => {
    const registro = datos?.dia.registro ?? []
    return Object.fromEntries(FILTROS.map((f) => [f.id, registro.filter(f.vale).length])) as Record<Filtro, number>
  }, [datos])

  const visibles = useMemo(() => {
    const vale = FILTROS.find((f) => f.id === filtro)?.vale ?? (() => true)
    // Lo último, arriba
    return (datos?.dia.registro ?? []).filter(vale).slice().reverse()
  }, [datos, filtro])

  if (!datos) {
    return (
      <section className={`${PANEL} relative overflow-hidden`}>
        <CabeceraDePanel titulo="Cargando el día…" derecha={<BotonCerrar alCerrar={alCerrar} />} />
        <BarraDeCarga activa={cargando} />
        <div className="space-y-2 p-3">
          <Esqueleto className="h-14 w-full" />
          <Esqueleto className="h-16 w-full" />
          <Esqueleto className="h-40 w-full" />
        </div>
      </section>
    )
  }

  const { dia, persona } = datos

  return (
    <section className={`${PANEL} relative overflow-hidden`}>
      <CabeceraDePanel
        icono={<Avatar id={persona.id} nombre={persona.nombre} />}
        titulo={persona.nombre}
        contexto={persona.comercial ? '· Comercial' : undefined}
        derecha={<BotonCerrar alCerrar={alCerrar} />}
      />
      <BarraDeCarga activa={cargando} />

      <div className="space-y-4 p-3">
        {dia.primera === null ? (
          <p className="rounded-[6px] bg-[var(--ls-sup2)] px-3 py-3 text-[13px] text-[var(--ls-t3)]">
            {esHoy ? 'Todavía no ha hecho nada en el ERP hoy.' : 'No hizo nada en el ERP ese día.'}
            {datos.ultimoLogin ? ` Su último inicio de sesión fue ${fechaCorta(datos.ultimoLogin, zona, hoy)}.` : ''}
          </p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              <Dato rotulo="Entró">{horaDeMs(dia.primera, zona)}</Dato>
              <Dato rotulo="Última actividad">{horaDeMs(dia.ultima ?? dia.primera, zona)}</Dato>
              <Dato rotulo="Tiempo activo">{duracion(dia.minutosActivos)}</Dato>
              <Dato rotulo="Pantallas abiertas">{dia.paginas}</Dato>
              <Dato rotulo="Clics">{dia.clics}</Dato>
            </div>
            <p className="-mt-2 text-[11.5px] text-[var(--ls-t4)]">
              {datos.ultimoLogin ? `Último inicio de sesión: ${fechaCorta(datos.ultimoLogin, zona, hoy)}. ` : ''}
              {dia.sesiones > 0 ? `Abrió el ERP ${dia.sesiones === 1 ? '1 vez' : `${dia.sesiones} veces`} (una por pestaña). ` : ''}
              {dia.logins > 0 ? `Inició sesión ${dia.logins === 1 ? '1 vez' : `${dia.logins} veces`}.` : ''}
            </p>

            <LineaDeActividad datos={datos} zona={zona} esHoy={esHoy} />

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="min-w-0">
                <h3 className="mb-1.5 text-[12px] font-semibold text-[var(--ls-t1)]">Pantallas</h3>
                <div className="overflow-hidden rounded-[6px] border border-[var(--ls-linea)]">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr className="border-b border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
                        <th className={cabecera}>Pantalla</th>
                        <th className={`${cabecera} text-right`}>Activo</th>
                        <th className={`${cabecera} text-right`}>Veces</th>
                        <th className={`${cabecera} text-right`}>Clics</th>
                      </tr>
                    </thead>
                    <tbody>
                      {dia.pantallas.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-3 text-[var(--ls-t4)]">
                            Sin pantallas.
                          </td>
                        </tr>
                      ) : (
                        dia.pantallas.map((p) => (
                          <tr key={p.ruta} className="border-b border-[var(--ls-linea)] last:border-b-0">
                            <td className="px-3 py-1.5 text-[var(--ls-t1)]" title={p.ruta}>
                              {nombreDePantalla(p.ruta, CONOCIDAS)}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t2)]">{duracion(p.minutos)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t3)]">{p.visitas}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t3)]">{p.clics}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="min-w-0">
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-[12px] font-semibold text-[var(--ls-t1)]">Registro</h3>
                  <div className="flex flex-wrap gap-1">
                    {FILTROS.map((f) => (
                      <ChipDeFiltro key={f.id} activo={filtro === f.id} deshabilitado={cuentas[f.id] === 0} onClick={() => setFiltro(f.id)}>
                        {f.nombre} <span className="tabular-nums text-[var(--ls-t4)]">{cuentas[f.id]}</span>
                      </ChipDeFiltro>
                    ))}
                  </div>
                </div>
                <ul className="max-h-[420px] overflow-y-auto rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
                  {visibles.length === 0 ? (
                    <li className="px-3 py-3 text-[12.5px] text-[var(--ls-t4)]">Nada que enseñar con este filtro.</li>
                  ) : (
                    visibles.map((e) => {
                      const d = describirEvento(e, CONOCIDAS)
                      return (
                        <li key={e.id} className="flex items-start gap-2.5 border-b border-[var(--ls-linea)] px-3 py-1.5 text-[12.5px] last:border-b-0">
                          <span className="w-[38px] shrink-0 pt-px tabular-nums text-[var(--ls-t4)]">{horaDeMs(e.t, zona)}</span>
                          <IconoDe tipo={e.tipo} />
                          <span className="min-w-0 flex-1 text-[var(--ls-t1)]">
                            {d.texto}
                            {d.aparte && <span className="ml-1.5 text-[11px] text-[var(--ls-t4)]">{d.aparte}</span>}
                          </span>
                        </li>
                      )
                    })
                  )}
                </ul>
                {datos.recortado && <p className="mt-1 text-[11px] text-[var(--ls-t4)]">Hay más movimientos de los que se enseñan: aquí salen los últimos.</p>}
              </div>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

function BotonCerrar({ alCerrar }: { alCerrar: () => void }) {
  return (
    <button
      type="button"
      onClick={alCerrar}
      aria-label="Cerrar el día de esta persona"
      className="inline-flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--ls-t4)] transition-colors hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]"
    >
      <X className="h-3.5 w-3.5" aria-hidden />
    </button>
  )
}

/** La barra del día: las horas, los tramos activos en verde y las marcas de cuándo abrió el ERP o cambió de pantalla */
function LineaDeActividad({ datos, zona, esHoy }: { datos: RespuestaPersona; zona: string; esHoy: boolean }) {
  const { dia, desde, hasta, ahora } = datos
  const rango = useMemo(() => {
    if (dia.primera === null || dia.ultima === null) return null
    const desfase = desfaseMs(zona, dia.primera)
    const alHora = (ms: number) => ms - ((((ms + desfase) % HORA) + HORA) % HORA)
    const ultimoPunto = esHoy ? Math.max(dia.ultima, ahora) : dia.ultima
    const a = Math.max(desde, alHora(dia.primera - 30 * 60_000))
    let b = Math.min(hasta, alHora(ultimoPunto + 30 * 60_000) + HORA)
    if (b - a < 4 * HORA) b = Math.min(hasta, a + 4 * HORA)
    return { a, b }
  }, [dia.primera, dia.ultima, desde, hasta, ahora, esHoy, zona])

  if (!rango) return null
  const { a, b } = rango
  const total = b - a
  const izquierda = (ms: number) => `${(((ms - a) / total) * 100).toFixed(3)}%`
  const paso = total > 12 * HORA ? 2 * HORA : HORA
  const marcas: number[] = []
  for (let t = a; t <= b; t += paso) marcas.push(t)

  const hitos = dia.registro.filter((e) => e.tipo === 'sesion' || e.tipo === 'login' || e.tipo === 'pagina')

  return (
    <div>
      <h3 className="mb-1.5 text-[12px] font-semibold text-[var(--ls-t1)]">Línea del día</h3>
      <div className="relative h-[64px] select-none overflow-hidden rounded-[6px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]" role="img" aria-label="Horas en las que estuvo activa">
        {marcas.map((t) => (
          <div key={t} className="absolute inset-y-0 border-l border-[var(--ls-linea)]" style={{ left: izquierda(t) }}>
            <span className="absolute left-1 top-0.5 text-[10px] tabular-nums text-[var(--ls-t4)]">{horaDeMs(t, zona)}</span>
          </div>
        ))}
        <div className="absolute inset-x-0 top-[22px] h-[20px] bg-[var(--ls-sup2)]" />
        {dia.tramos.map((t) => (
          <div
            key={t.desde}
            className="absolute top-[22px] h-[20px] rounded-[3px]"
            style={{
              left: izquierda(Math.max(a, t.desde)),
              width: `max(3px, ${(((Math.min(b, t.hasta) - Math.max(a, t.desde)) / total) * 100).toFixed(3)}%)`,
              background: COLOR_ESTADO.verde,
              opacity: 0.85,
            }}
            title={`${horaDeMs(t.desde, zona)} – ${horaDeMs(t.hasta, zona)} · ${duracion(Math.round((t.hasta - t.desde) / 60_000))}`}
          />
        ))}
        {hitos.map((e) => (
          <div
            key={e.id}
            className="absolute top-[47px] h-2 w-2 -translate-x-1/2 rounded-full"
            style={{ left: izquierda(e.t), background: e.tipo === 'pagina' ? COLOR_ESTADO.violeta : COLOR_ESTADO.naranja }}
            title={`${horaDeMs(e.t, zona)} · ${describirEvento(e, CONOCIDAS).texto}`}
          />
        ))}
        {esHoy && ahora >= a && ahora <= b && (
          <div className="absolute inset-y-0 w-px bg-[var(--ls-acc-graf)]" style={{ left: izquierda(ahora) }} title={`Ahora · ${horaDeMs(ahora, zona)}`} />
        )}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-0.5 text-[11px] text-[var(--ls-t4)]">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-3.5 rounded-[2px]" style={{ background: COLOR_ESTADO.verde, opacity: 0.85 }} /> activo
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: COLOR_ESTADO.violeta }} /> abrió una pantalla
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: COLOR_ESTADO.naranja }} /> abrió el ERP o inició sesión
        </span>
        {esHoy && (
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-px bg-[var(--ls-acc-graf)]" /> ahora
          </span>
        )}
      </p>
    </div>
  )
}
