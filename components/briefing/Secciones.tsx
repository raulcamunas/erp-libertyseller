'use client'

import { useMemo, useState, type CSSProperties } from 'react'
import type { Briefing, CorreoPendiente, EquipoComercial, EquipoDeCuentas, MarcaDeResuelto, PuntoARevisar, TareasDeClientes } from '@/lib/briefing/tipos'
import { BotonResuelto, Cifra, EtiquetaDeArea, Enlace, PANEL, Pastilla, Seccion, TextoDeMarca } from './ui'

/**
 * LAS SECCIONES DE LA PÁGINA DEL BRIEFING, en el orden en que se leen: Revisa hoy, Equipo comercial, Equipo de cuentas, Tareas de clientes y Correo.
 * Cada una se pinta SOLO si el briefing trae algo de ella.
 */

export interface PropiedadesDeMarcas {
  marcas: Record<string, MarcaDeResuelto>
  puedeMarcar: boolean
  alMarcar: (clave: string, hecho: boolean) => void
}

const nulo = <span className="text-[var(--ls-t4)]">—</span>

/* ------------------------------------------------------------------ */
/* Revisa hoy                                                          */
/* ------------------------------------------------------------------ */

function PuntoARevisarFila({ punto, indice, marca, puedeMarcar, alMarcar }: { punto: PuntoARevisar; indice: number; marca: MarcaDeResuelto | null; puedeMarcar: boolean; alMarcar: () => void }) {
  const alta = punto.nivel === 'alta'
  const hecho = marca !== null
  return (
    <li
      className={`rend-entra grid grid-cols-[24px_minmax(0,1fr)_auto] items-start gap-2.5 rounded-[8px] border-l-[3px] px-3 py-2.5 transition-[opacity,background-color] duration-200 ${
        alta ? 'border-l-[var(--ls-acc-graf)] bg-[color-mix(in_srgb,var(--ls-acc-graf)_8%,var(--ls-sup))]' : 'border-l-[var(--ls-linea2)] bg-[var(--ls-sup2)]'
      } ${hecho ? 'opacity-50' : ''}`}
      style={{ '--d': Math.min(indice, 12) } as CSSProperties}
    >
      <span className={`pt-px text-[14px] font-bold tabular-nums ${alta ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{indice + 1}</span>
      <div className="min-w-0">
        <p className={`text-[14px] font-semibold leading-snug text-[var(--ls-t1)] ${hecho ? 'line-through decoration-[var(--ls-t4)]' : ''}`}>
          {punto.area ? <EtiquetaDeArea>{punto.area}</EtiquetaDeArea> : null}
          {punto.titulo}
        </p>
        {punto.texto ? <p className="mt-0.5 max-w-[80ch] text-[13px] leading-snug text-[var(--ls-t3)]">{punto.texto}</p> : null}
        {punto.fuente ? (
          <p className="mt-0.5 text-[11.5px] text-[var(--ls-t4)]">
            <Enlace url={punto.url}>{punto.fuente}</Enlace>
          </p>
        ) : null}
        {hecho ? (
          <p className="mt-0.5 text-[11.5px] text-[var(--ls-e-verde)]">
            <TextoDeMarca marca={marca} />
          </p>
        ) : null}
      </div>
      <BotonResuelto marca={marca} alMarcar={alMarcar} deshabilitado={!puedeMarcar} etiqueta={punto.titulo} />
    </li>
  )
}

export function SeccionRevisaHoy({ puntos, marcas, puedeMarcar, alMarcar, indice }: { puntos: PuntoARevisar[]; indice: number } & PropiedadesDeMarcas) {
  const [area, setArea] = useState<string | null>(null)
  const [soloAltas, setSoloAltas] = useState(false)
  const [ocultarResueltos, setOcultarResueltos] = useState(false)

  const areas = useMemo(() => {
    const cuenta = new Map<string, number>()
    for (const p of puntos) if (p.area) cuenta.set(p.area, (cuenta.get(p.area) ?? 0) + 1)
    return [...cuenta.entries()]
  }, [puntos])
  const resueltos = puntos.filter((p) => marcas[p.clave]).length
  const visibles = puntos.map((p, i) => ({ p, i })).filter(({ p }) => (!area || p.area === area) && (!soloAltas || p.nivel === 'alta') && (!ocultarResueltos || !marcas[p.clave]))
  const altas = puntos.filter((p) => p.nivel === 'alta').length

  const chip = (activo: boolean) =>
    `inline-flex h-6 items-center gap-1 whitespace-nowrap rounded-[6px] border px-2 text-[11.5px] transition-colors ${
      activo ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-acc-suave)] text-[var(--ls-t1)]' : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t3)] hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)]'
    }`

  return (
    <Seccion
      id="revisa-hoy"
      indice={indice}
      titulo="Revisa hoy"
      meta={
        <span className="tabular-nums">
          {puntos.length > 0 ? `${resueltos} de ${puntos.length} resueltos` : 'Lo que necesita a Raúl o a Marius'}
        </span>
      }
    >
      {puntos.length === 0 ? (
        <p className="text-[13px] text-[var(--ls-t4)]">Nada urgente esta mañana.</p>
      ) : (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-[var(--ls-sup3)]" role="progressbar" aria-valuemin={0} aria-valuemax={puntos.length} aria-valuenow={resueltos} aria-label="Puntos resueltos">
            <div className="h-full rounded-full bg-[var(--ls-e-verde)] transition-[width] duration-500" style={{ width: `${(resueltos / puntos.length) * 100}%` }} />
          </div>

          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filtrar los puntos">
            <button type="button" onClick={() => setArea(null)} aria-pressed={area === null} className={chip(area === null)}>
              Todos <span className="tabular-nums text-[var(--ls-t4)]">{puntos.length}</span>
            </button>
            {areas.map(([nombre, n]) => (
              <button key={nombre} type="button" onClick={() => setArea(area === nombre ? null : nombre)} aria-pressed={area === nombre} className={chip(area === nombre)}>
                {nombre} <span className="tabular-nums text-[var(--ls-t4)]">{n}</span>
              </button>
            ))}
            <span className="mx-1 h-4 w-px bg-[var(--ls-linea)]" aria-hidden />
            {altas > 0 && altas < puntos.length ? (
              <button type="button" onClick={() => setSoloAltas(!soloAltas)} aria-pressed={soloAltas} className={chip(soloAltas)}>
                Solo urgentes <span className="tabular-nums text-[var(--ls-t4)]">{altas}</span>
              </button>
            ) : null}
            {resueltos > 0 ? (
              <button type="button" onClick={() => setOcultarResueltos(!ocultarResueltos)} aria-pressed={ocultarResueltos} className={chip(ocultarResueltos)}>
                Ocultar resueltos
              </button>
            ) : null}
          </div>

          {visibles.length === 0 ? (
            <p className="rounded-[8px] bg-[var(--ls-sup2)] px-3 py-3 text-[13px] text-[var(--ls-t3)]">{resueltos === puntos.length ? 'Todo resuelto. Buen trabajo.' : 'Ningún punto con ese filtro.'}</p>
          ) : (
            <ol className="grid gap-1.5">
              {visibles.map(({ p, i }) => (
                <PuntoARevisarFila key={p.clave} punto={p} indice={i} marca={marcas[p.clave] ?? null} puedeMarcar={puedeMarcar} alMarcar={() => alMarcar(p.clave, !marcas[p.clave])} />
              ))}
            </ol>
          )}
        </>
      )}
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Equipo comercial                                                    */
/* ------------------------------------------------------------------ */

export function SeccionComercial({ c, indice }: { c: EquipoComercial; indice: number }) {
  const maxLlamadas = Math.max(1, ...c.personas.map((p) => p.llamadas ?? 0))
  const hayAlgo = c.personas.length > 0 || c.lectura !== '' || Object.values(c.totales).some((v) => v !== null)
  if (!hayAlgo) return null
  const celda = (v: number | null, ceroEnNaranja = false) => (v === null ? nulo : v === 0 && ceroEnNaranja ? <span className="font-semibold text-[var(--ls-acc)]">0</span> : v)
  return (
    <Seccion id="comercial" indice={indice} titulo="Equipo comercial" meta={c.periodo}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Cifra rotulo="Llamadas" n={c.totales.llamadas} nota={c.kpi_nota_llamadas} indice={0} />
        <Cifra rotulo="WhatsApp" n={c.totales.whatsapps} indice={1} />
        <Cifra rotulo="Respuestas" n={c.totales.respuestas} indice={2} />
        <Cifra rotulo="Citas" n={c.totales.citas} nota={c.kpi_nota_citas} destacada indice={3} />
      </div>

      {c.personas.length > 0 ? (
        <ul className="grid gap-1.5 sm:hidden" aria-label="Comerciales">
          {c.personas.map((p) => (
            <li key={p.nombre} className={`${PANEL} grid gap-1.5 p-2.5`}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-[13.5px] font-semibold text-[var(--ls-t1)]">
                  <Enlace url={p.url}>{p.nombre}</Enlace>
                </span>
                <span className="inline-flex shrink-0 items-center gap-2 text-[12.5px] tabular-nums text-[var(--ls-t1)]">
                  {p.llamadas === null ? (
                    nulo
                  ) : (
                    <>
                      <span className="inline-block h-1.5 rounded-[1px] bg-[var(--ls-acc-graf)]" style={{ width: `${Math.round((44 * p.llamadas) / maxLlamadas)}px` }} aria-hidden />
                      {p.llamadas} <span className="text-[11.5px] text-[var(--ls-t4)]">llamadas</span>
                    </>
                  )}
                </span>
              </div>
              <dl className="grid grid-cols-3 gap-1 text-center">
                {([['WhatsApp', p.whatsapps, false], ['Respuestas', p.respuestas, true], ['Citas', p.citas, true]] as const).map(([rotulo, valor, naranjaSiCero]) => (
                  <div key={rotulo} className="rounded-[6px] bg-[var(--ls-sup2)] px-1 py-1">
                    <dd className="text-[14px] font-semibold tabular-nums text-[var(--ls-t1)]">{celda(valor, naranjaSiCero)}</dd>
                    <dt className="text-[10px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t4)]">{rotulo}</dt>
                  </div>
                ))}
              </dl>
              {p.resumen ? <p className="text-[12.5px] leading-snug text-[var(--ls-t3)]">{p.resumen}</p> : null}
            </li>
          ))}
        </ul>
      ) : null}

      {c.personas.length > 0 ? (
        <div className={`${PANEL} hidden overflow-x-auto sm:block`}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="bg-[var(--ls-sup2)] text-left text-[10.5px] font-semibold uppercase tracking-[0.05em] text-[var(--ls-t3)]">
                <th className="px-3 py-1.5">Comercial</th>
                <th className="px-3 py-1.5 text-right">Llamadas</th>
                <th className="px-3 py-1.5 text-right">WhatsApp</th>
                <th className="px-3 py-1.5 text-right">Respuestas</th>
                <th className="px-3 py-1.5 text-right">Citas</th>
                <th className="px-3 py-1.5">Nota</th>
              </tr>
            </thead>
            <tbody>
              {c.personas.map((p) => (
                <tr key={p.nombre} className="border-t border-[var(--ls-linea)] align-top transition-colors hover:bg-[var(--ls-sup3)]">
                  <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-[var(--ls-t1)]">
                    <Enlace url={p.url}>{p.nombre}</Enlace>
                  </td>
                  <td className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-[var(--ls-t1)]">
                    {p.llamadas === null ? (
                      nulo
                    ) : (
                      <>
                        {p.llamadas}
                        <span className="ml-2 inline-block h-1.5 rounded-[1px] bg-[var(--ls-acc-graf)] align-middle transition-[width] duration-500" style={{ width: `${Math.round((44 * p.llamadas) / maxLlamadas)}px` }} aria-hidden />
                      </>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t2)]">{celda(p.whatsapps)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t2)]">{celda(p.respuestas, true)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-[var(--ls-t2)]">{celda(p.citas, true)}</td>
                  <td className="min-w-[220px] px-3 py-1.5 text-[12.5px] leading-snug text-[var(--ls-t3)]">{p.resumen}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {c.lectura ? <p className="max-w-[80ch] text-[13.5px] leading-snug text-[var(--ls-t2)]">{c.lectura}</p> : null}
      {c.alertas.length > 0 ? (
        <ul className="grid gap-1.5">
          {c.alertas.map((a, i) => (
            <li key={i} className="relative pl-4 text-[13px] leading-snug text-[var(--ls-t3)]">
              <span className="absolute left-0.5 top-[0.55em] h-[7px] w-[7px] rounded-full bg-[var(--ls-acc-graf)]" aria-hidden />
              {a.quien ? <b className="font-semibold text-[var(--ls-t1)]">{a.quien}: </b> : null}
              {a.texto}
            </li>
          ))}
        </ul>
      ) : null}
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Equipo de cuentas                                                   */
/* ------------------------------------------------------------------ */

function BloqueDePersona({ titulo, puntos, tono }: { titulo: string; puntos: string[]; tono: 'hecho' | 'curso' | 'bloqueo' }) {
  if (puntos.length === 0) return null
  return (
    <div>
      <div className={`text-[10.5px] font-semibold uppercase tracking-[0.08em] ${tono === 'bloqueo' ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t4)]'}`}>{titulo}</div>
      <ul className={`mt-0.5 grid list-disc gap-px pl-4 text-[12.5px] leading-snug marker:text-[var(--ls-t4)] ${tono === 'hecho' ? 'text-[var(--ls-t1)]' : 'text-[var(--ls-t3)]'}`}>
        {puntos.map((x, i) => (
          <li key={i}>{x}</li>
        ))}
      </ul>
    </div>
  )
}

export function SeccionCuentas({ e, indice }: { e: EquipoDeCuentas; indice: number }) {
  if (e.personas.length === 0 && e.sin_briefing.length === 0) return null
  return (
    <Seccion id="cuentas" indice={indice} titulo="Equipo de cuentas" meta={e.periodo}>
      <div className="grid gap-2 md:grid-cols-2">
        {e.personas.map((p, i) => (
          <article key={p.nombre} className={`${PANEL} rend-entra grid content-start gap-2 p-3`} style={{ '--d': Math.min(i, 8) } as CSSProperties}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-2">
              <h3 className="text-[14px] font-bold text-[var(--ls-t1)]">
                <Enlace url={p.url}>{p.nombre}</Enlace>
              </h3>
              <span className="text-[12px] text-[var(--ls-t4)]">{[p.rol, p.fecha_label].filter(Boolean).join(' · ')}</span>
            </div>
            <BloqueDePersona titulo="Hecho" puntos={p.hecho} tono="hecho" />
            <BloqueDePersona titulo="En curso" puntos={p.en_curso} tono="curso" />
            <BloqueDePersona titulo="Bloqueos" puntos={p.bloqueos} tono="bloqueo" />
            {p.hecho.length + p.en_curso.length + p.bloqueos.length === 0 ? <p className="text-[12.5px] text-[var(--ls-t4)]">Sin nada apuntado.</p> : null}
          </article>
        ))}
      </div>
      {e.sin_briefing.length > 0 ? <p className="text-[13px] text-[var(--ls-t4)]">Sin briefing reciente: {e.sin_briefing.map((s) => `${s.nombre}${s.ultimo ? ` (último ${s.ultimo})` : ''}`).join(', ')}.</p> : null}
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Tareas de clientes                                                  */
/* ------------------------------------------------------------------ */

function FilaDeTarea({ titulo, url, meta, texto, pastilla }: { titulo: string; url: string | null; meta: string; texto?: string; pastilla?: string }) {
  return (
    <li className="grid gap-px border-b border-[var(--ls-linea)] py-1.5 last:border-b-0">
      <div className="text-[13.5px] font-semibold leading-snug text-[var(--ls-t1)]">
        <Enlace url={url} className="no-underline hover:underline">
          {titulo}
        </Enlace>
        {pastilla ? <Pastilla>{pastilla}</Pastilla> : null}
      </div>
      {meta ? <div className="text-[11.5px] text-[var(--ls-t4)]">{meta}</div> : null}
      {texto ? <div className="text-[12.5px] leading-snug text-[var(--ls-t3)]">{texto}</div> : null}
    </li>
  )
}

function ListaDeTareas({ titulo, vacio, children, hay }: { titulo: string; vacio: string; hay: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-0.5 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t3)]">{titulo}</h3>
      {hay ? <ul className="border-t border-[var(--ls-linea)]">{children}</ul> : <p className="border-t border-[var(--ls-linea)] pt-1.5 text-[12.5px] text-[var(--ls-t4)]">{vacio}</p>}
    </div>
  )
}

export function SeccionTareas({ t, indice }: { t: TareasDeClientes; indice: number }) {
  const hayAlgo = t.por_cliente.length + t.comentarios.length + t.en_revision.length + t.destacadas.length > 0 || Object.values(t.totales).some((v) => v !== null)
  if (!hayAlgo) return null
  const maxPendientes = Math.max(1, ...t.por_cliente.map((c) => c.pendientes))
  return (
    <Seccion id="tareas" indice={indice} titulo="Tareas de clientes" meta={t.nota}>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        <Cifra rotulo="En progreso" n={t.totales.en_progreso} indice={0} />
        <Cifra rotulo="En revisión" n={t.totales.en_revision} nota="Para validar" destacada indice={1} />
        <Cifra rotulo="Sin responsable" n={t.totales.sin_responsable} nota="Entre las pendientes" indice={2} />
        <Cifra rotulo="Clientes" n={t.totales.clientes} nota="Con tareas abiertas" indice={3} />
      </div>

      <div className="grid gap-x-5 gap-y-3 md:grid-cols-2">
        <ListaDeTareas titulo="Comentarios nuevos" vacio="Sin comentarios nuevos desde ayer." hay={t.comentarios.length > 0}>
          {t.comentarios.map((c, i) => (
            <FilaDeTarea key={i} titulo={c.tarea} url={c.url} meta={[c.cliente, c.autor, c.fecha].filter(Boolean).join(' · ')} texto={c.texto} pastilla={c.pide ? 'Te pide algo' : undefined} />
          ))}
        </ListaDeTareas>
        <ListaDeTareas titulo="En revisión" vacio="Nada en revisión." hay={t.en_revision.length > 0}>
          {t.en_revision.map((r, i) => (
            <FilaDeTarea key={i} titulo={r.tarea} url={r.url} meta={[r.cliente, r.responsable, r.checklist].filter(Boolean).join(' · ')} />
          ))}
        </ListaDeTareas>
      </div>

      <ListaDeTareas titulo="En progreso que conviene mirar" vacio="Nada que destacar." hay={t.destacadas.length > 0}>
        {t.destacadas.map((d, i) => (
          <FilaDeTarea key={i} titulo={d.tarea} url={d.url} meta={[d.cliente, d.responsable, d.checklist].filter(Boolean).join(' · ')} texto={d.texto} />
        ))}
      </ListaDeTareas>

      {t.por_cliente.length > 0 ? (
        <div>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t3)]">Pendientes por cliente</h3>
          <ul className="grid gap-1">
            {t.por_cliente.map((c, i) => (
              <li key={c.cliente} className="grid grid-cols-[minmax(90px,150px)_minmax(0,1fr)_auto] items-center gap-2 text-[12.5px]">
                <span className="truncate text-[var(--ls-t2)]" title={c.cliente}>
                  {c.cliente}
                </span>
                <span className="h-2 overflow-hidden rounded-full bg-[var(--ls-sup3)]">
                  <span className="rend-entra block h-full rounded-full bg-[var(--ls-acc-graf)]" style={{ width: `${(c.pendientes / maxPendientes) * 100}%`, '--d': Math.min(i, 14) } as CSSProperties} />
                </span>
                <span className="tabular-nums text-[var(--ls-t1)]">
                  {c.pendientes}
                  {c.en_revision > 0 ? <span className="ml-1 text-[var(--ls-t4)]">· {c.en_revision} en revisión</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Seccion>
  )
}

/* ------------------------------------------------------------------ */
/* Correo                                                              */
/* ------------------------------------------------------------------ */

export function SeccionCorreo({ correo, marcas, puedeMarcar, alMarcar, indice }: { correo: CorreoPendiente[]; indice: number } & PropiedadesDeMarcas) {
  if (correo.length === 0) return null
  const resueltos = correo.filter((c) => marcas[c.clave]).length
  return (
    <Seccion id="correo" indice={indice} titulo="Correo" meta={resueltos > 0 ? `${resueltos} de ${correo.length} resueltos` : 'Lo que sigue pendiente en la bandeja'}>
      <ul className="border-t border-[var(--ls-linea)]">
        {correo.map((c) => {
          const marca = marcas[c.clave] ?? null
          return (
            <li key={c.clave} className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2.5 border-b border-[var(--ls-linea)] py-2 transition-opacity duration-200 ${marca ? 'opacity-50' : ''}`}>
              <div className="min-w-0">
                <div className={`text-[13.5px] font-semibold leading-snug text-[var(--ls-t1)] ${marca ? 'line-through decoration-[var(--ls-t4)]' : ''}`}>
                  <Enlace url={c.url} className="no-underline hover:underline">
                    {c.titulo}
                  </Enlace>
                  {c.nivel === 'alta' ? <Pastilla>Importante</Pastilla> : null}
                </div>
                <div className="text-[11.5px] text-[var(--ls-t4)]">{[c.de, c.fecha].filter(Boolean).join(' · ')}</div>
                {c.texto ? <div className="text-[12.5px] leading-snug text-[var(--ls-t3)]">{c.texto}</div> : null}
              </div>
              <BotonResuelto marca={marca} alMarcar={() => alMarcar(c.clave, !marca)} deshabilitado={!puedeMarcar} etiqueta={c.titulo} />
            </li>
          )
        })}
      </ul>
    </Seccion>
  )
}

/** Las secciones que trae un briefing, en su orden, para el menú de saltos y para saber qué pintar */
export function seccionesDe(b: Briefing): Array<{ id: string; nombre: string; n?: number }> {
  const lista: Array<{ id: string; nombre: string; n?: number }> = [{ id: 'revisa-hoy', nombre: 'Revisa hoy', n: b.revisar.length }]
  if (b.comerciales && (b.comerciales.personas.length > 0 || b.comerciales.lectura || Object.values(b.comerciales.totales).some((v) => v !== null))) lista.push({ id: 'comercial', nombre: 'Comercial' })
  if (b.equipo && (b.equipo.personas.length > 0 || b.equipo.sin_briefing.length > 0)) lista.push({ id: 'cuentas', nombre: 'Cuentas' })
  if (b.tareas && (b.tareas.por_cliente.length + b.tareas.comentarios.length + b.tareas.en_revision.length + b.tareas.destacadas.length > 0 || Object.values(b.tareas.totales).some((v) => v !== null))) lista.push({ id: 'tareas', nombre: 'Tareas' })
  if (b.correo.length > 0) lista.push({ id: 'correo', nombre: 'Correo', n: b.correo.length })
  return lista
}
