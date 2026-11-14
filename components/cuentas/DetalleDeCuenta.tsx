'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, ArrowUpRight, Check, CircleAlert, FileText, Info, Megaphone, RefreshCw, SearchCheck, ShieldCheck, TriangleAlert } from 'lucide-react'
import type { TipoDeInforme } from '@/lib/cuentas/informe'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { inicioParaHoy, NOMBRE_SEMANA, VENTANA_DIAS, type PasoDelCiclo } from '@/lib/cuentas/ciclo'
import { ACCIONES } from '@/lib/cumplimiento/acciones'
import { ROTULO_NIVEL } from '@/lib/cumplimiento/tipos'
import type { Tarea as TareaSeo } from '@/lib/seo/tareas'
import type { ResumenPpc } from '@/lib/cuentas/resumen'
import type { Persona } from '@/lib/cuentas/datos'
import { CAJA, bandera } from '@/components/marketing-test/piezas'
import { dinero, entero, porcentaje } from '@/components/marketing-test/formato'
import { Cargando } from '@/components/plataforma/comun'
import { acosDe, enlaceDe, type CuentaEnLista, type RespuestaCuentas } from './tipos'
import { Chip, Nota } from './piezas'

const AREA: Record<PasoDelCiclo['area'], { texto: string; color: string }> = {
  cumplimiento: { texto: 'Cumplimiento', color: COLOR_ESTADO.rojo },
  ppc: { texto: 'PPC', color: COLOR_ESTADO.naranja },
  seo: { texto: 'SEO', color: COLOR_ESTADO.azul },
  informe: { texto: 'Cliente', color: COLOR_ESTADO.violeta },
  cuenta: { texto: 'Cuenta', color: COLOR_ESTADO.gris },
}

const PESO_SEO = { grave: 0, atencion: 1, info: 2 } as const

/**
 * EL PANEL DE UNA CUENTA: todo lo que hace falta para llevarla, en una pantalla.
 *   1. Quién la lleva y cuándo empezó su ciclo.
 *   2. Esta semana: los pasos del ciclo (S1–S4) con un botón a la herramienta donde se hace y la casilla de hecho.
 *   3. Publicidad por país (7 días contra los 7 anteriores) y lo que el motor tiene propuesto.
 *   4. Lo más importante de SEO y de cumplimiento, con el botón para ir a resolverlo.
 *   5. Las notas de la cuenta (lo que pide el cliente, acuerdos, cosas a vigilar), para que otro pueda cogerla mañana.
 */
export function DetalleDeCuenta({ slug, volver, personas: personasIniciales }: { slug: string; volver: () => void; personas: Persona[] }) {
  const [datos, setDatos] = useState<RespuestaCuentas | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cargando, setCargando] = useState(false)
  const [guardando, setGuardando] = useState<string | null>(null)
  const [informes, setInformes] = useState<InformeEnLista[]>([])

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

  return (
    <div className="mx-auto flex w-full max-w-[1280px] min-w-0 flex-col gap-4 px-1 pb-10">
      <header className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={volver} className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--ls-linea)] px-3 text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]">
          <ArrowLeft className="h-3.5 w-3.5" /> Todas las cuentas
        </button>
        <h1 className="min-w-0 flex-1 truncate text-[19px] font-semibold tracking-[-0.02em] text-[var(--ls-t1)]">{c?.nombre ?? slug}</h1>
        <button type="button" onClick={cargar} disabled={cargando} className="inline-flex h-[30px] items-center gap-[6px] rounded-[8px] border border-[var(--ls-linea)] px-3 text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} /> Actualizar
        </button>
      </header>

      {datos?.aviso307 && <Nota tono="ambar">{datos.aviso307}</Nota>}
      {error && <Nota tono="rojo">{error}</Nota>}
      {!c && !error && <Cargando texto="Leyendo la cuenta…" />}

      {c && datos && (
        <>
          {/* 1 · quién y cuándo */}
          <section className={`${CAJA.base} flex flex-wrap items-end gap-x-6 gap-y-3 px-4 py-3`}>
            <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
              Responsable de la cuenta
              <select
                value={c.responsable?.id ?? ''}
                disabled={datos.falta307 || guardando === 'responsable'}
                onChange={(e) => guardar({ accion: 'responsable', responsableId: e.target.value || null }, 'responsable')}
                className="h-[32px] min-w-[220px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]"
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
            <label className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
              Su ciclo empezó (lunes de la S1)
              <span className="flex items-center gap-2">
                <input
                  type="date"
                  value={c.cicloInicio ?? ''}
                  disabled={datos.falta307 || guardando === 'ciclo'}
                  onChange={(e) => e.target.value && guardar({ accion: 'ciclo', inicio: e.target.value }, 'ciclo')}
                  className="h-[32px] rounded-[8px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2 text-[13px] text-[var(--ls-t1)]"
                />
                {!c.cicloInicio && (
                  <button type="button" disabled={datos.falta307} onClick={() => guardar({ accion: 'ciclo', inicio: inicioParaHoy(datos.hoy) }, 'ciclo')} className="h-[32px] rounded-[8px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] px-3 text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-50">
                    Empezar esta semana
                  </button>
                )}
              </span>
            </label>
            {c.semana && (
              <div className="flex flex-col gap-1 text-[11.5px] text-[var(--ls-t4)]">
                Esta semana
                <span className="text-[14px] font-semibold text-[var(--ls-t1)]">
                  {NOMBRE_SEMANA[c.semana.semana]} · ciclo {c.semana.ciclo}
                </span>
              </div>
            )}
          </section>

          {/* 2 · esta semana */}
          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <span className="text-[13.5px] font-semibold text-[var(--ls-t1)]">Esta semana</span>
              {c.semana && <span className="text-[12px] text-[var(--ls-t3)]">Datos de los últimos {VENTANA_DIAS[c.semana.semana]} días · en orden</span>}
            </div>
            {!c.semana ? (
              <p className={`${CAJA.cuerpo} text-[12.5px] text-[var(--ls-t3)]`}>
                Elige arriba el lunes en que empieza su S1 (o «Empezar esta semana»). Cada cliente lleva su ciclo de 4 semanas: S1 semanal, S2 quincenal con pujas y auditoría, S3 semanal con el cambio de ficha y S4 mensual. Así no caen todos los informes mensuales la misma semana.
              </p>
            ) : (
              <ol className="divide-y divide-[var(--ls-linea)]">
                {c.pasos.map((p, i) => {
                  const hecho = c.hechos.includes(p.id)
                  const area = AREA[p.area]
                  return (
                    <li key={p.id} className="flex items-start gap-3 px-4 py-3">
                      <button
                        type="button"
                        aria-label={hecho ? 'Marcar como pendiente' : 'Marcar como hecho'}
                        disabled={datos.falta307 || guardando === p.id}
                        onClick={() => guardar({ accion: 'paso', paso: p.id, hecho: !hecho }, p.id)}
                        className="mt-[1px] flex h-[20px] w-[20px] shrink-0 items-center justify-center rounded-[6px] border disabled:opacity-50"
                        style={hecho ? { background: COLOR_ESTADO.verde, borderColor: COLOR_ESTADO.verde } : { borderColor: 'var(--ls-linea2)' }}
                      >
                        {hecho && <Check className="h-3.5 w-3.5 text-white" />}
                      </button>
                      <div className={`min-w-0 flex-1 ${hecho ? 'opacity-55' : ''}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-[11px] tabular-nums text-[var(--ls-t4)]">{i + 1}</span>
                          <span className={`text-[13.5px] font-semibold text-[var(--ls-t1)] ${hecho ? 'line-through' : ''}`}>{p.titulo}</span>
                          <span className="rounded-full px-2 py-[1px] text-[10.5px] font-semibold" style={{ color: area.color, background: `color-mix(in srgb, ${area.color} 12%, transparent)` }}>
                            {area.texto}
                          </span>
                        </div>
                        <p className="mt-[2px] text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">{p.detalle}</p>
                      </div>
                      {p.herramienta === 'informe' ? (
                        <BotonDeInforme paso={p.id} informes={informes} lunes={c.semana?.lunes ?? null} preparar={prepararInforme} ocupado={guardando === 'informe'} desactivado={datos.falta307} />
                      ) : (
                        <Link href={enlaceDe(p.herramienta, c)} className="inline-flex h-[28px] shrink-0 items-center gap-[5px] self-center rounded-[8px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)]">
                          Abrir <ArrowUpRight className="h-3 w-3" />
                        </Link>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {/* 3 · publicidad */}
          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <Megaphone className="h-4 w-4 text-[var(--ls-t3)]" />
              <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">Publicidad · últimos 7 días</span>
              <Link href={enlaceDe('ppc-hoy', c)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-acc)]">
                Abrir PPC <ArrowUpRight className="h-3 w-3" />
              </Link>
            </div>
            <div className={`${CAJA.cuerpo} flex flex-col gap-3`}>
              {c.ppc.error && <Nota tono="rojo">{c.ppc.error}</Nota>}
              {c.ppc.cuentas.length === 0 && !c.ppc.error && <p className="text-[12.5px] text-[var(--ls-t3)]">Este cliente no tiene Amazon Ads conectado (se conecta en Amazon API · Publicidad, lo hace un administrador).</p>}
              {c.ppc.cuentas.filter(conMovimiento).map((x) => (
                <BloquePpc key={x.perfilId} x={x} />
              ))}
              {c.ppc.cuentas.some((x) => !conMovimiento(x)) && (
                <p className="text-[12px] text-[var(--ls-t4)]">
                  Sin gasto en los últimos 14 días ni nada pendiente: {c.ppc.cuentas.filter((x) => !conMovimiento(x)).map((x) => `${bandera(x.pais)} ${x.pais}`).join(' · ')}
                </p>
              )}
            </div>
          </section>

          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 460px), 1fr))' }}>
            {/* 4a · SEO */}
            <section className={CAJA.base}>
              <div className={CAJA.cabecera}>
                <SearchCheck className="h-4 w-4 text-[var(--ls-t3)]" />
                <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">SEO de fichas</span>
                <Link href={enlaceDe('seo-hoy', c)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-acc)]">
                  Abrir SEO <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
                <ListaSeo c={c} />
              </div>
            </section>

            {/* 4b · cumplimiento */}
            <section className={CAJA.base}>
              <div className={CAJA.cabecera}>
                <ShieldCheck className="h-4 w-4 text-[var(--ls-t3)]" />
                <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">Cumplimiento</span>
                <Link href={enlaceDe('cumplimiento-hoy', c)} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--ls-acc)]">
                  Abrir Cumplimiento <ArrowUpRight className="h-3 w-3" />
                </Link>
              </div>
              <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
                {c.cumplimiento && (
                  <div className="flex flex-wrap gap-[6px]">
                    <Chip tono={c.cumplimiento.atencionConStock > 0 ? 'rojo' : 'verde'}>{entero(c.cumplimiento.atencionConStock)} a revisar con stock</Chip>
                    <Chip tono="gris">{entero(c.cumplimiento.ocultos)} ocultas</Chip>
                    <Chip tono="gris">{entero(c.cumplimiento.revisados)} fichas revisadas</Chip>
                  </div>
                )}
                {c.tareasCumplimiento?.error && <Nota tono="ambar">{c.tareasCumplimiento.error}</Nota>}
                {(c.tareasCumplimiento?.tareas ?? []).slice(0, 6).map((t) => {
                  const a = ACCIONES[t.accion]
                  const color = t.nivel === 'bloquea' ? COLOR_ESTADO.rojo : t.nivel === 'normativa' ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul
                  return (
                    <div key={`${t.accion}-${t.nivel}`} className="rounded-[10px] border border-[var(--ls-linea)] px-3 py-2" style={{ borderLeft: `3px solid ${color}` }}>
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[13px] font-semibold text-[var(--ls-t1)]">{a?.titulo ?? t.accion}</span>
                        <span className="text-[11.5px] tabular-nums text-[var(--ls-t4)]">
                          {entero(t.listings)} fichas{t.conStock > 0 ? ` · ${entero(t.conStock)} con stock` : ''}
                        </span>
                      </div>
                      <div className="text-[11.5px] text-[var(--ls-t3)]">
                        {ROTULO_NIVEL[t.nivel].corto}
                        {a?.quien === 'cliente' ? ' · hace falta algo del cliente' : ''}
                        {t.plazo ? ` · plazo ${t.plazo}` : ''}
                      </div>
                    </div>
                  )
                })}
                {c.tareasCumplimiento && c.tareasCumplimiento.tareas.length === 0 && !c.tareasCumplimiento.error && <p className="text-[12.5px] text-[var(--ls-t3)]">Nada que bloquee ni normativa pendiente.</p>}
              </div>
            </section>
          </div>

          {/* 5 · informes */}
          <section className={CAJA.base}>
            <div className={CAJA.cabecera}>
              <FileText className="h-4 w-4 text-[var(--ls-t3)]" />
              <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">Informes al cliente</span>
              <span className="flex gap-1">
                {(['semanal', 'quincenal', 'mensual'] as const).map((t) => (
                  <button key={t} type="button" disabled={datos.falta307 || guardando === 'informe'} onClick={() => prepararInforme(t)} className="inline-flex h-[26px] items-center rounded-[7px] border border-[var(--ls-linea)] px-2 text-[11.5px] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)] disabled:opacity-45">
                    + {t}
                  </button>
                ))}
              </span>
            </div>
            <div className={`${CAJA.cuerpo} flex flex-col gap-1`}>
              {informes.length === 0 ? (
                <p className="text-[12.5px] text-[var(--ls-t3)]">Todavía no hay informes. El de esta semana se prepara desde su paso de arriba; también puedes preparar uno suelto con los botones.</p>
              ) : (
                informes.map((i) => (
                  <Link key={i.id} href={`/dashboard/cuentas/informe/${i.id}`} className="flex items-center gap-3 rounded-[8px] px-2 py-[6px] text-[12.5px] hover:bg-[var(--ls-sup2)]">
                    <span className="w-[80px] shrink-0 font-semibold capitalize text-[var(--ls-t1)]">{i.tipo}</span>
                    <span className="min-w-0 flex-1 truncate text-[var(--ls-t3)]">
                      {i.desde} → {i.hasta}
                    </span>
                    <Chip tono={i.estado === 'enviado' ? 'verde' : 'ambar'}>{i.estado === 'enviado' ? 'Enviado' : 'Borrador'}</Chip>
                  </Link>
                ))
              )}
            </div>
          </section>

          {/* 6 · notas */}
          <Notas c={c} desactivado={datos.falta307} guardar={(notas) => guardar({ accion: 'notas', notas }, 'notas')} />
        </>
      )}
    </div>
  )
}

/** Una cuenta de un país sin gasto en 14 días y sin propuestas no merece su bloque: se nombra en una línea */
const conMovimiento = (x: ResumenPpc) => x.ultimos.gasto > 0 || x.anteriores.gasto > 0 || x.pendientes > 0

function BloquePpc({ x }: { x: ResumenPpc }) {
  const acos = acosDe(x.ultimos)
  const acosAnt = acosDe(x.anteriores)
  const tacos = x.ventasTotales7 ? x.ultimos.gasto / x.ventasTotales7 : null
  const var_ = (a: number, b: number) => (b > 0 ? `${a >= b ? '+' : ''}${Math.round(((a - b) / b) * 100)} % vs antes` : undefined)
  const tipos: Array<[string, number | undefined]> = [
    ['negativas', x.porTipo.negativizar],
    ['a exacta', x.porTipo.promover],
    ['subir puja', x.porTipo['subir-puja']],
    ['bajar puja', x.porTipo['bajar-puja']],
    ['pausar', x.porTipo.pausar],
    ['presupuesto', x.porTipo.presupuesto],
    ['con error', x.porTipo.error],
  ]
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-[var(--ls-t2)]">
        <span>
          {bandera(x.pais)} {x.pais}
        </span>
        <span className="font-normal text-[var(--ls-t4)]">Motor: {x.modo === 'apagado' ? 'apagado' : x.modo === 'sugiere' ? 'solo sugiere' : x.modo === 'aprueba' ? 'aprueba' : 'piloto automático'}</span>
        {x.datosHasta && <span className="font-normal text-[var(--ls-t4)]">· datos hasta el {new Date(`${x.datosHasta}T00:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', timeZone: 'UTC' })}</span>}
      </div>
      <Cifras
        cifras={[
          { etiqueta: 'Gasto', valor: dinero(x.ultimos.gasto, x.moneda, 0), nota: var_(x.ultimos.gasto, x.anteriores.gasto) },
          { etiqueta: 'Ventas publicidad', valor: dinero(x.ultimos.ventas, x.moneda, 0), nota: var_(x.ultimos.ventas, x.anteriores.ventas) },
          { etiqueta: 'ACoS', valor: porcentaje(acos), nota: acosAnt != null ? `antes ${porcentaje(acosAnt)}` : undefined },
          { etiqueta: 'TACoS', valor: porcentaje(tacos), nota: tacos == null ? 'sin Seller Central' : undefined },
          { etiqueta: 'Pedidos', valor: entero(x.ultimos.pedidos) },
        ]}
      />
      {x.pendientes > 0 ? (
        <div className="flex flex-wrap items-center gap-[6px] text-[12px] text-[var(--ls-t3)]">
          <span className="font-semibold text-[var(--ls-t1)]">{entero(x.pendientes)} propuestas por revisar:</span>
          {tipos
            .filter(([, n]) => n)
            .map(([t, n]) => (
              <Chip key={t} tono={t === 'con error' ? 'rojo' : 'gris'}>
                {n} {t}
              </Chip>
            ))}
          {x.recuperable >= 1 && <span>· aprobando negativas y pausas dejas de gastar {dinero(x.recuperable, x.moneda, 0)} que no venden</span>}
        </div>
      ) : (
        <p className="text-[12px] text-[var(--ls-t3)]">{x.modo === 'apagado' ? 'El motor está apagado: no propone nada. Enciéndelo en PPC → Propuestas («Solo sugiere»).' : 'El motor no tiene nada pendiente.'}</p>
      )}
    </div>
  )
}

function ListaSeo({ c }: { c: CuentaEnLista }) {
  if (c.seo?.error) return <Nota tono="ambar">{c.seo.error}</Nota>
  const cuentas = c.seo?.cuentas ?? []
  if (cuentas.length === 0) return <p className="text-[12.5px] text-[var(--ls-t3)]">Sin cuenta de vendedor conectada: el SEO necesita Seller Central.</p>
  const sinProductos = cuentas.every((x) => x.productos === 0)
  if (sinProductos) return <p className="text-[12.5px] text-[var(--ls-t3)]">Todavía no se sigue ningún producto. Abre SEO → Productos y añade los que se trabajan (los de publicidad salen sugeridos).</p>
  const tareas: Array<TareaSeo & { pais: string }> = cuentas.flatMap((x) => x.tareas.map((t) => ({ ...t, pais: x.pais })))
  tareas.sort((a, b) => PESO_SEO[a.gravedad] - PESO_SEO[b.gravedad] || b.impacto - a.impacto)
  const graves = tareas.filter((t) => t.gravedad === 'grave').length
  return (
    <>
      <div className="flex flex-wrap gap-[6px]">
        <Chip tono={graves > 0 ? 'rojo' : 'verde'}>{graves} urgentes</Chip>
        <Chip tono="gris">{tareas.length} tareas en total</Chip>
        {cuentas.some((x) => x.acceso === 'no') && <Chip tono="ambar">Sin Brand Analytics en algún país</Chip>}
      </div>
      {tareas.slice(0, 6).map((t) => {
        const Icono = t.gravedad === 'grave' ? CircleAlert : t.gravedad === 'atencion' ? TriangleAlert : Info
        const color = t.gravedad === 'grave' ? COLOR_ESTADO.rojo : t.gravedad === 'atencion' ? COLOR_ESTADO.ambar : COLOR_ESTADO.azul
        return (
          <div key={`${t.pais}-${t.id}`} className="flex gap-2 rounded-[10px] border border-[var(--ls-linea)] px-3 py-2">
            <Icono className="mt-[2px] h-3.5 w-3.5 shrink-0" style={{ color }} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-[var(--ls-t1)]">
                {bandera(t.pais)} {t.titulo}
              </div>
              <div className="text-[12px] leading-[1.45] text-[var(--ls-t3)]">
                <span className="font-semibold text-[var(--ls-t2)]">Qué hacer: </span>
                {t.accion}
              </div>
            </div>
          </div>
        )
      })}
    </>
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
    <section className={CAJA.base}>
      <div className={CAJA.cabecera}>
        <span className="flex-1 text-[13.5px] font-semibold text-[var(--ls-t1)]">Notas de la cuenta</span>
        <span className="text-[11.5px] text-[var(--ls-t4)]">Lo que pide el cliente, acuerdos, lo que hay que vigilar. Para que cualquiera pueda coger la cuenta mañana.</span>
      </div>
      <div className={`${CAJA.cuerpo} flex flex-col gap-2`}>
        <textarea
          value={texto}
          disabled={desactivado}
          onChange={(e) => (setTexto(e.target.value), setGuardadas(false))}
          rows={4}
          className="w-full resize-y rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] leading-[1.5] text-[var(--ls-t1)]"
          placeholder="Ej.: quiere priorizar el lanzamiento del producto nuevo en diciembre; no bajar del 20 % de margen; el informe se lo mandamos a Ana."
        />
        <div>
          <button type="button" disabled={desactivado || guardadas} onClick={() => guardar(texto.trim() || null)} className="h-[30px] rounded-[8px] border border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] px-3 text-[12px] font-semibold text-[var(--ls-acc-tinta)] disabled:opacity-45">
            {guardadas ? 'Guardadas' : 'Guardar notas'}
          </button>
        </div>
      </div>
    </section>
  )
}

/** Las cifras de un país: en una fila si caben y en dos si no (la tira de Marketing Test corta los números en pantallas estrechas) */
function Cifras({ cifras }: { cifras: ReadonlyArray<{ etiqueta: string; valor: string; nota?: string }> }) {
  return (
    <div className="grid gap-px overflow-hidden rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-linea)]" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(118px, 1fr))' }}>
      {cifras.map((c) => (
        <div key={c.etiqueta} className="min-w-0 bg-[var(--ls-sup)] px-3 py-[10px]">
          <div className="truncate text-[11px] text-[var(--ls-t4)]">{c.etiqueta}</div>
          <div className="truncate text-[18px] font-semibold leading-[1.25] tracking-[-0.02em] tabular-nums text-[var(--ls-t1)]">{c.valor}</div>
          {c.nota && <div className="truncate text-[10.5px] text-[var(--ls-t4)]">{c.nota}</div>}
        </div>
      ))}
    </div>
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
  const clase = 'inline-flex h-[28px] shrink-0 items-center gap-[5px] self-center rounded-[8px] border px-[10px] text-[12px] font-medium disabled:opacity-45'
  if (deEstaSemana) {
    return (
      <Link href={`/dashboard/cuentas/informe/${deEstaSemana.id}`} className={`${clase} border-[var(--ls-linea)] text-[var(--ls-t2)] hover:bg-[var(--ls-sup2)]`}>
        {deEstaSemana.estado === 'enviado' ? 'Ver enviado' : 'Abrir borrador'} <ArrowUpRight className="h-3 w-3" />
      </Link>
    )
  }
  return (
    <button type="button" disabled={ocupado || desactivado} onClick={() => preparar(tipo)} className={`${clase} border-[var(--ls-acc-borde)] bg-[var(--ls-acc-relleno)] text-[var(--ls-acc-tinta)]`}>
      {ocupado ? 'Preparando…' : 'Preparar borrador'}
    </button>
  )
}
