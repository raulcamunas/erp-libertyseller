'use client'

import { useState, type ReactNode } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, CircleSlash, LineChart, PackageOpen, Truck } from 'lucide-react'
import { Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { EnvioPropuestoGuardado, LineaPlan, LlegadaPrevista, MotivoFuera, PlazoEtapas } from '@/lib/fba/plan-tipos'
import { ProyeccionStock } from '../comun/ProyeccionStock'
import {
  AVISO_LINEA, CONFIANZA, MOTIVO_FUERA, PRIORIDAD, dinero, dias, entero, fechaCorta, ritmo, sumarDias,
} from '../comun/estilo-plan'

/**
 * LAS REFERENCIAS DE UN ENVÍO PROPUESTO, PARA FIARSE DE ÉL (spec remesas-pro §1.5 punto 2, D2, D3, D4 y D43).
 *
 * Cada referencia es una tarjeta (cabe igual en el panel del ordenador y en la hoja del móvil):
 *   · stock vendible / de camino / comprometido, ritmo (ud/día y confianza), rotura, cantidad, cajas y su origen;
 *   · el porqué en una frase con cifras y sus avisos;
 *   · lo que Amazon tiene entrante sin remesa en el ERP (D2) y lo DUDOSO (D3: «si llega el envío, esto sobra»);
 *   · «Ver proyección»: `ProyeccionStock` día a día (solo se monta al abrirla).
 * Arriba, aparte, los HUECOS que ya no evita ningún envío (D4) y, si se habló con el cliente, la diferencia entre lo
 * hablado (`lineasAceptadas`) y el plan de hoy («El plan de hoy dice 430 ud, hablasteis 412»).
 *
 * API
 *   <LineasDelEnvio envio hoy plazo? />          plazo (de usePlan) solo afina las fechas de llegada de la proyección
 *   <FueraDelEnvio lineas hoy />                  las referencias que se quedan fuera, agrupadas por motivo
 *
 * Puro (con prueba en plan.prueba.ts):
 *   filasDelEnvio(envio)                  lo hablado y lo de hoy, referencia a referencia
 *   diferenciaConElPlan(envio)            null si no se ha hablado o no cambia nada
 *   huecosInevitables(lineas)             las que tienen días sin stock que ya no se evitan
 *   llegadasAproximadas(linea, hoy, plazo)   las llegadas para la proyección (la línea guardada no trae sus fechas)
 *   textoCaja(caja) · agruparFuera(lineas)
 */

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

export interface FilaEnvio {
  sku: string
  /** La línea con la que se pinta: la del plan de hoy si existe; si no, la hablada */
  linea: LineaPlan
  /** Unidades habladas con el cliente (null si no se ha hablado) */
  acordada: number | null
  /** Unidades que pide hoy el plan (0 si hoy ya no la pide) */
  hoy: number
}

const cuenta = (l: LineaPlan) => (l.cantidad > 0 && !l.fuera ? l.cantidad : 0)

/** Las referencias del envío: lo hablado (si lo hay) unido a lo que pide hoy el plan, por SKU */
export function filasDelEnvio(e: Pick<EnvioPropuestoGuardado, 'lineas' | 'lineasAceptadas'>): FilaEnvio[] {
  const deHoy = new Map(e.lineas.map((l) => [l.sku, l]))
  const filas: FilaEnvio[] = []
  const vistos = new Set<string>()
  if (e.lineasAceptadas) {
    for (const a of e.lineasAceptadas) {
      if (vistos.has(a.sku)) continue
      vistos.add(a.sku)
      const h = deHoy.get(a.sku)
      filas.push({ sku: a.sku, linea: h ?? a, acordada: cuenta(a), hoy: h ? cuenta(h) : 0 })
    }
  }
  for (const l of e.lineas) {
    if (vistos.has(l.sku)) continue
    vistos.add(l.sku)
    filas.push({ sku: l.sku, linea: l, acordada: e.lineasAceptadas ? 0 : null, hoy: cuenta(l) })
  }
  // Lo que se envía de verdad primero, por cantidad
  return filas
    .filter((f) => (f.acordada ?? 0) > 0 || f.hoy > 0)
    .sort((a, b) => (b.acordada ?? b.hoy) - (a.acordada ?? a.hoy) || a.sku.localeCompare(b.sku))
}

export interface DiferenciaConElPlan {
  acordadas: number
  hoy: number
  cambios: Array<{ sku: string; acordada: number; hoy: number }>
}

/** Si se habló con el cliente y el plan de hoy dice otra cosa: totales y referencias que cambian */
export function diferenciaConElPlan(e: Pick<EnvioPropuestoGuardado, 'lineas' | 'lineasAceptadas'>): DiferenciaConElPlan | null {
  if (!e.lineasAceptadas) return null
  const filas = filasDelEnvio(e)
  const cambios = filas.filter((f) => f.acordada !== f.hoy).map((f) => ({ sku: f.sku, acordada: f.acordada ?? 0, hoy: f.hoy }))
  if (cambios.length === 0) return null
  const acordadas = filas.reduce((s, f) => s + (f.acordada ?? 0), 0)
  const hoy = filas.reduce((s, f) => s + f.hoy, 0)
  return { acordadas, hoy, cambios: cambios.sort((a, b) => Math.abs(b.hoy - b.acordada) - Math.abs(a.hoy - a.acordada)) }
}

/** Las líneas con días sin stock que ya no evita un envío nuevo (D4), de más a menos días */
export function huecosInevitables(lineas: readonly LineaPlan[]): LineaPlan[] {
  return lineas.filter((l) => l.diasSinStockInevitables > 0).sort((a, b) => b.diasSinStockInevitables - a.diasSinStockInevitables)
}

type LlegadaParaProyeccion = Pick<LlegadaPrevista, 'fecha' | 'unidades' | 'dudoso' | 'nombre' | 'origen'>

/**
 * La línea guardada no trae sus llegadas una a una (solo cuánto hay de camino, comprometido, entrante sin remesa y
 * dudoso). Para dibujar la proyección se colocan como las coloca el plan cuando no sabe más:
 *   · de camino (lo que cuenta): tras la recepción;
 *   · entrante en Amazon sin remesa (D2): tras transporte + recepción;
 *   · comprometido: al final del plazo hasta la venta;
 *   · dudoso (D3): hueco, NO cuenta, el día de la recepción.
 * Sin plazo, 4 / 22 / 28 días (recepción y transporte de partida). Las fechas son aproximadas y la pantalla lo dice.
 */
export function llegadasAproximadas(
  l: Pick<LineaPlan, 'deCamino' | 'comprometido' | 'entranteSinRemesa' | 'dudoso'>,
  hoy: string,
  plazo: Pick<PlazoEtapas, 'transporte' | 'recepcion' | 'hastaLaVenta'> | null
): LlegadaParaProyeccion[] {
  const recepcion = plazo?.recepcion ?? 4
  const transporte = plazo?.transporte ?? 18
  const hastaLaVenta = plazo?.hastaLaVenta ?? 28
  const dudoso = Math.max(0, l.dudoso || 0)
  const sinRemesa = Math.max(0, l.entranteSinRemesa || 0)
  const caminoQueCuenta = Math.max(0, (l.deCamino || 0) - sinRemesa - dudoso)
  const salida: LlegadaParaProyeccion[] = []
  if (caminoQueCuenta > 0) salida.push({ fecha: sumarDias(hoy, recepcion), unidades: caminoQueCuenta, dudoso: false, nombre: 'de camino (fecha aproximada)', origen: 'camino' })
  if (sinRemesa > 0) salida.push({ fecha: sumarDias(hoy, transporte + recepcion), unidades: sinRemesa, dudoso: false, nombre: 'entrante en Amazon sin remesa en el ERP', origen: 'amazon_sin_remesa' })
  if (l.comprometido > 0) salida.push({ fecha: sumarDias(hoy, hastaLaVenta), unidades: l.comprometido, dudoso: false, nombre: 'en una remesa sin enviar (fecha aproximada)', origen: 'comprometido' })
  if (dudoso > 0) salida.push({ fecha: sumarDias(hoy, recepcion), unidades: dudoso, dudoso: true, nombre: 'envío dudoso', origen: 'camino' })
  return salida
}

const ORIGEN_CAJA: Record<'sku' | 'deducida' | 'cliente', string> = {
  sku: 'puesta en la referencia',
  deducida: 'deducida de los envíos',
  cliente: 'la del cliente',
}

/** «caja de 12 (deducida de los envíos)»; sin caja, «sin caja conocida» */
export function textoCaja(caja: LineaPlan['caja']): string {
  if (!caja || !(caja.unidades > 0)) return 'sin caja conocida'
  return `caja de ${entero(caja.unidades)} (${ORIGEN_CAJA[caja.origen] ?? caja.origen})`
}

/** Las referencias fuera, agrupadas por motivo, los grupos más grandes primero */
export function agruparFuera(lineas: readonly LineaPlan[]): Array<{ motivo: MotivoFuera; lineas: LineaPlan[] }> {
  const g = new Map<MotivoFuera, LineaPlan[]>()
  for (const l of lineas) {
    if (!l.fuera) continue
    const lista = g.get(l.fuera) ?? []
    lista.push(l)
    g.set(l.fuera, lista)
  }
  return [...g.entries()]
    .map(([motivo, ls]) => ({ motivo, lineas: ls.sort((a, b) => (b.ritmo?.ventas90 ?? 0) - (a.ritmo?.ventas90 ?? 0) || a.sku.localeCompare(b.sku)) }))
    .sort((a, b) => b.lineas.length - a.lineas.length || a.motivo.localeCompare(b.motivo))
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

function Cifra({ k, v, nota, tono }: { k: string; v: string; nota?: string | null; tono?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[10.5px] uppercase tracking-[0.05em] text-[var(--ls-t4)]">{k}</dt>
      <dd className="truncate text-[13px] font-medium tabular-nums text-[var(--ls-t1)]" style={tono ? { color: tono } : undefined}>
        {v}
      </dd>
      {nota && <dd className="truncate text-[11px] text-[var(--ls-t4)]">{nota}</dd>}
    </div>
  )
}

function Nota({ icono: Icono, tono, children }: { icono: typeof Truck; tono: string; children: ReactNode }) {
  return (
    <p className="flex min-w-0 items-start gap-[7px] rounded-[9px] px-[9px] py-[6px] text-[12px] leading-[1.45] text-[var(--ls-t2)]" style={{ background: `color-mix(in srgb, ${tono} 9%, transparent)` }}>
      <Icono className="mt-[2px] h-[13px] w-[13px] shrink-0" style={{ color: tono }} aria-hidden />
      <span className="min-w-0">{children}</span>
    </p>
  )
}

function TarjetaLinea({ fila, hoy, plazo, aLaVenta, moneda }: { fila: FilaEnvio; hoy: string; plazo: PlazoEtapas | null; aLaVenta: string | null; moneda: string }) {
  const [abierta, setAbierta] = useState(false)
  const l = fila.linea
  const p = PRIORIDAD[l.prioridad]
  const conf = CONFIANZA[l.ritmo?.confianza ?? 'sin_datos']
  // El mismo previsto que usa la frase del plan (si la línea es antigua, el del ritmo)
  const previstoLinea = l.ritmoPrevisto ?? l.ritmo?.previsto ?? null
  const cantidad = fila.acordada ?? fila.hoy
  const cajas = l.caja && l.caja.unidades > 0 ? Math.ceil(cantidad / l.caja.unidades) : l.cajas
  const cambia = fila.acordada !== null && fila.acordada !== fila.hoy
  const avisos = (l.avisos ?? []).filter((a) => a !== 'entrante_sin_remesa' && a !== 'envio_dudoso')
  const consumo = l.ritmo?.consumoNeto ?? l.ritmo?.previsto ?? l.ritmo?.base ?? 0
  const coberturaHoy = l.coberturaConLoQueViene ?? l.coberturaDias

  return (
    <li className="min-w-0 rounded-[12px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)]">
      <div className="flex min-w-0 flex-col gap-[9px] p-3">
        {/* Cabecera */}
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-[12.5px] font-semibold text-[var(--ls-t1)]" title={l.sku}>
              {l.sku}
            </p>
            {(l.nombre || l.talla) && (
              <p className="truncate text-[12px] text-[var(--ls-t3)]" title={l.nombre ?? undefined}>
                {l.nombre}
                {l.talla ? ` · talla ${l.talla}` : ''}
              </p>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-[15px] font-semibold tabular-nums text-[var(--ls-t1)]">{entero(cantidad)} ud</span>
            <Insignia tono={p.tono} variante={p.variante} tamano="sm">
              {p.corto}
            </Insignia>
          </div>
        </div>

        {/* Cifras */}
        <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-4">
          <Cifra k="Vendible" v={entero(l.vendibles)} nota={l.reservadas ? `${entero(l.reservadas)} reservadas` : null} />
          <Cifra k="De camino" v={entero(l.deCamino)} nota={l.comprometido > 0 ? `+${entero(l.comprometido)} comprometido` : 'nada comprometido'} />
          <Cifra
            k="Ritmo"
            v={ritmo(l.ritmo?.base ?? null)}
            nota={conf ? conf.texto : previstoLinea != null && l.ritmo?.base != null && Math.abs(previstoLinea / Math.max(l.ritmo.base, 1e-9) - 1) >= 0.05 ? `previsto ${ritmo(previstoLinea)}` : 'confianza alta'}
          />
          <Cifra
            k="Rotura"
            v={l.fechaRotura ? fechaCorta(l.fechaRotura, hoy) : 'no rompe'}
            nota={coberturaHoy != null ? `dura ${dias(coberturaHoy)}` : null}
            tono={l.prioridad === 'tarde' || l.prioridad === 'urgente' ? COLOR_ESTADO.rojo : undefined}
          />
        </dl>

        <p className="text-[11.5px] tabular-nums text-[var(--ls-t3)]">
          {cajas != null && cajas > 0 ? `${l.caja ? '' : '~'}${entero(cajas)} ${cajas === 1 ? 'caja' : 'cajas'} · ` : ''}
          {textoCaja(l.caja)}
          {l.eurosEnRiesgo != null && l.eurosEnRiesgo > 0 ? ` · ${dinero(l.eurosEnRiesgo, l.moneda ?? moneda)} en juego` : ''}
          {l.ritmo?.explicacion ? <span className="block truncate text-[var(--ls-t4)]" title={l.ritmo.explicacion}>{l.ritmo.explicacion}</span> : null}
        </p>

        {cambia && (
          <p className="text-[12px] tabular-nums" style={{ color: COLOR_ESTADO.ambar }}>
            Hablasteis {entero(fila.acordada)} ud; el plan de hoy dice {fila.hoy > 0 ? `${entero(fila.hoy)} ud` : 'que ya no hace falta'}.
          </p>
        )}

        {l.porque && <p className="border-l-2 border-[var(--ls-linea2)] pl-[9px] text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">{l.porque}</p>}

        {/* Lo que llega y no se ve en la cifra */}
        {l.entranteSinRemesa > 0 && (
          <Nota icono={Truck} tono={COLOR_ESTADO.ambar}>
            Amazon tiene <b className="tabular-nums">{entero(l.entranteSinRemesa)} ud</b> entrantes de esta referencia que no están en ninguna remesa del ERP. Ya cuentan como de camino: importa el envío para seguirlo.
          </Nota>
        )}
        {l.dudoso > 0 && (
          <Nota icono={AlertTriangle} tono={COLOR_ESTADO.rojo}>
            Hay <b className="tabular-nums">{entero(l.dudoso)} ud</b> en un envío dudoso (lleva demasiado sin recibirse) y no se cuentan. Si llega, esto sobra: confírmalo con Amazon antes de mandar más.
          </Nota>
        )}
        {l.diasSinStockInevitables > 0 && (
          <Nota icono={CircleSlash} tono={COLOR_ESTADO.magenta}>
            {dias(l.diasSinStockInevitables)} sin stock{l.fechaPrimerHueco ? ` desde el ${fechaCorta(l.fechaPrimerHueco, hoy)}` : ''} que ya no evita ningún envío
            {l.eurosSiVaTarde ? ` (${dinero(l.eurosSiVaTarde, l.moneda ?? moneda)})` : ''}.
            {l.aLaVentaUrgente ? ` En avión estaría a la venta el ${fechaCorta(l.aLaVentaUrgente, hoy)}.` : ''}
          </Nota>
        )}

        {avisos.length > 0 && (
          <div className="flex flex-wrap gap-[5px]">
            {avisos.map((a) => {
              const x = AVISO_LINEA[a]
              return x ? (
                <Insignia key={a} tono={x.tono} tamano="sm" variante="contorno">
                  {x.texto}
                </Insignia>
              ) : null
            })}
          </div>
        )}

        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          aria-expanded={abierta}
          className="flex min-h-[32px] items-center gap-[6px] self-start rounded-[8px] px-1 text-[12px] font-medium text-[var(--ls-t2)] outline-none hover:text-[var(--ls-t1)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
        >
          {abierta ? <ChevronDown className="h-[14px] w-[14px]" aria-hidden /> : <ChevronRight className="h-[14px] w-[14px]" aria-hidden />}
          <LineChart className="h-[13px] w-[13px]" aria-hidden />
          {abierta ? 'Ocultar la proyección' : 'Ver la proyección del stock'}
        </button>
        {abierta && (
          <div className="min-w-0">
            <ProyeccionStock
              hoy={hoy}
              vendibles={l.vendibles}
              consumoDia={consumo}
              llegadas={llegadasAproximadas(l, hoy, plazo)}
              fechaRotura={l.fechaRotura}
              aLaVenta={aLaVenta ?? l.aLaVentaObjetivo}
              cantidadPropuesta={cantidad}
              alto={150}
            />
            <p className="mt-1 text-[11px] text-[var(--ls-t4)]">
              Al ritmo de {ritmo(consumo)} (lo que se vende menos lo que vuelve vendible, más las mermas). Las fechas de llegada son aproximadas; la rotura es la del plan.
            </p>
          </div>
        )}
      </div>
    </li>
  )
}

export function LineasDelEnvio({ envio, hoy, plazo = null }: { envio: EnvioPropuestoGuardado; hoy: string; plazo?: PlazoEtapas | null }) {
  const filas = filasDelEnvio(envio)
  const dif = diferenciaConElPlan(envio)
  const huecos = huecosInevitables(filas.map((f) => f.linea))

  if (filas.length === 0) {
    return (
      <p className="rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-4 text-center text-[12.5px] text-[var(--ls-t3)]">
        Este envío ya no lleva ninguna referencia con unidades.
      </p>
    )
  }

  return (
    <div className="min-w-0 space-y-3">
      {dif && (
        <div className="rounded-[10px] border px-3 py-[9px] text-[12.5px]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 35%, transparent)`, background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 8%, transparent)` }}>
          <p className="font-medium text-[var(--ls-t1)]">
            El plan de hoy dice {entero(dif.hoy)} ud; hablasteis {entero(dif.acordadas)}.
          </p>
          <p className="mt-[2px] text-[var(--ls-t3)]">
            Se envía lo hablado. Cambian {dif.cambios.length} {dif.cambios.length === 1 ? 'referencia' : 'referencias'}:{' '}
            {dif.cambios
              .slice(0, 4)
              .map((c) => `${c.sku} ${entero(c.acordada)} → ${entero(c.hoy)}`)
              .join(' · ')}
            {dif.cambios.length > 4 ? ` y ${dif.cambios.length - 4} más` : ''}.
          </p>
        </div>
      )}

      {huecos.length > 0 && (
        <div className="rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-[9px]">
          <p className="flex items-center gap-[6px] text-[12.5px] font-medium text-[var(--ls-t1)]">
            <CircleSlash className="h-[13px] w-[13px]" style={{ color: COLOR_ESTADO.magenta }} aria-hidden />
            Huecos que ya no se evitan
          </p>
          <p className="mt-[2px] text-[11.5px] text-[var(--ls-t3)]">Ningún envío nuevo llega antes: se informan aparte y no deciden la prioridad salvo que sumen 3 días o más.</p>
          <ul className="mt-[6px] space-y-[3px] text-[12px] tabular-nums text-[var(--ls-t2)]">
            {huecos.slice(0, 6).map((l) => (
              <li key={l.sku} className="flex min-w-0 justify-between gap-3">
                <span className="truncate font-mono">{l.sku}</span>
                <span className="shrink-0">
                  {dias(l.diasSinStockInevitables)}
                  {l.fechaPrimerHueco ? ` desde el ${fechaCorta(l.fechaPrimerHueco, hoy)}` : ''}
                  {l.eurosSiVaTarde ? ` · ${dinero(l.eurosSiVaTarde, l.moneda ?? envio.moneda)}` : ''}
                </span>
              </li>
            ))}
            {huecos.length > 6 && <li className="text-[var(--ls-t4)]">y {huecos.length - 6} más</li>}
          </ul>
        </div>
      )}

      <ul className="min-w-0 space-y-2">
        {filas.map((f) => (
          <TarjetaLinea key={f.sku} fila={f} hoy={hoy} plazo={plazo} aLaVenta={envio.aLaVenta} moneda={envio.moneda} />
        ))}
      </ul>
    </div>
  )
}

/** Las referencias que el plan deja fuera, por motivo (desplegable por grupo) */
export function FueraDelEnvio({ lineas, hoy, maximoPorGrupo = 12 }: { lineas: readonly LineaPlan[]; hoy: string; maximoPorGrupo?: number }) {
  const grupos = agruparFuera(lineas)
  const [abierto, setAbierto] = useState<MotivoFuera | null>(null)
  if (grupos.length === 0) {
    return <p className="text-[12.5px] text-[var(--ls-t3)]">El plan no deja fuera ninguna referencia que venda.</p>
  }
  return (
    <ul className="min-w-0 divide-y divide-[var(--ls-linea)] rounded-[10px] border border-[var(--ls-linea)]">
      {grupos.map((g) => {
        const esta = abierto === g.motivo
        return (
          <li key={g.motivo} className="min-w-0">
            <button
              type="button"
              onClick={() => setAbierto(esta ? null : g.motivo)}
              aria-expanded={esta}
              className="flex min-h-[40px] w-full items-center justify-between gap-3 px-3 py-2 text-left text-[12.5px] outline-none hover:bg-[var(--ls-sup2)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
            >
              <span className="flex min-w-0 items-center gap-2 text-[var(--ls-t1)]">
                {esta ? <ChevronDown className="h-[14px] w-[14px] shrink-0" aria-hidden /> : <ChevronRight className="h-[14px] w-[14px] shrink-0" aria-hidden />}
                <span className="truncate">{MOTIVO_FUERA[g.motivo] ?? g.motivo}</span>
              </span>
              <span className="shrink-0 tabular-nums text-[var(--ls-t3)]">{g.lineas.length}</span>
            </button>
            {esta && (
              <ul className="space-y-[6px] px-3 pb-3">
                {g.lineas.slice(0, maximoPorGrupo).map((l) => (
                  <li key={l.sku} className="min-w-0 text-[12px]">
                    <p className="flex min-w-0 justify-between gap-3">
                      <span className="truncate font-mono text-[var(--ls-t1)]">{l.sku}</span>
                      <span className="shrink-0 tabular-nums text-[var(--ls-t3)]">
                        {entero(l.vendibles)} vend · {ritmo(l.ritmo?.base ?? null)}
                        {l.fechaRotura ? ` · rompe ${fechaCorta(l.fechaRotura, hoy)}` : ''}
                      </span>
                    </p>
                    {l.porque && <p className="line-clamp-2 text-[11.5px] leading-[1.45] text-[var(--ls-t3)]">{l.porque}</p>}
                  </li>
                ))}
                {g.lineas.length > maximoPorGrupo && (
                  <li className="flex items-center gap-[6px] text-[11.5px] text-[var(--ls-t4)]">
                    <PackageOpen className="h-[12px] w-[12px]" aria-hidden /> y {g.lineas.length - maximoPorGrupo} más (las ves todas en Reposición)
                  </li>
                )}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
