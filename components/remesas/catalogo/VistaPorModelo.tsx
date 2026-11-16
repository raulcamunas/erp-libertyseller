'use client'

import { useMemo } from 'react'
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts'
import { Insignia } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Modelo } from '@/lib/fba/catalogo/indice'
import { CONFIANZA } from '../comun/estilo-plan'
import { DURACION_ANIMACION, EJE, Grafico, VIZ, tooltipDe, useAnimarGraficos } from '../comun/graficos'
import { Clave, cx, Medidor } from '../comun/ui'
import { entero, fechaCorta, porcentaje, ritmo as fRitmo } from '../formato'
import { curvaDeModelo, textoPlan, type PuntoCurva } from './plan-por-talla'
import type { PlanDeLaBase } from './useCatalogo'

/**
 * UN MODELO CON SU CURVA DE TALLAS (spec remesas-pro D43.4 y D5).
 *
 * Responde a «¿mando las tallas en la proporción en que se venden?». Por cada talla, tres barras: lo vendido en
 * 90 días (azul, `--viz-1`), lo que hay en FBA (naranja, `--viz-2`) y lo que propone el plan (`--viz-3`). Debajo,
 * el ritmo del modelo y cómo se reparte entre sus tallas: la talla suelta casi nunca tiene ventas para un ritmo
 * propio, así que el plan usa el del modelo repartido por lo que vende cada una (y lo dice con «del modelo»).
 *
 * Es de SOLO LECTURA: en el escritorio va encima de la tabla de tallas; en el móvil se abre en un PanelLateral
 * (no hay `Combo` ni `Dialogo` dentro, así que la hoja modal no estorba; D38).
 *
 * Las cifras son las de la última pasada del plan (`usePlanDeLaBase`). El cliente externo ve el stock y el ritmo,
 * no lo vendido ni lo propuesto.
 */
export function VistaPorModelo({ modelo, plan, conCodigos = false, className }: { modelo: Modelo; plan: PlanDeLaBase; conCodigos?: boolean; className?: string }) {
  const curva = useMemo(() => curvaDeModelo(modelo.filas, plan.datos), [modelo.filas, plan.datos])
  const p = curva.puntos

  const series = useMemo(() => {
    const s: Array<{ clave: keyof PuntoCurva; nombre: string; color: string }> = []
    if (p.some((x) => x.vendido90 !== null)) s.push({ clave: 'vendido90', nombre: 'Vendido en 90 días', color: VIZ.vendidas })
    s.push({ clave: 'enFba', nombre: 'En FBA', color: VIZ.quedan })
    if (plan.deAgencia && p.some((x) => (x.propuesto ?? 0) > 0)) s.push({ clave: 'propuesto', nombre: 'Propuesto', color: VIZ.recibidas })
    return s
  }, [p, plan.deAgencia])

  const datos = useMemo(() => p.map((x) => ({ talla: x.talla, vendido90: x.vendido90 ?? 0, enFba: x.enFba ?? 0, propuesto: x.propuesto ?? 0 })), [p])
  const animar = useAnimarGraficos(datos.length * series.length)
  const Contenido = useMemo(
    () => tooltipDe(series.map((s) => ({ key: String(s.clave), nombre: s.nombre, color: s.color, formato: (v: number) => `${entero(v)} ud` })), (l) => `Talla ${l}`),
    [series]
  )
  const vacio = curva.conDatos === 0 || datos.every((d) => d.vendido90 === 0 && d.enFba === 0 && d.propuesto === 0)

  if (!plan.hayPlan) {
    return (
      <div className={cx('rounded-[14px] border border-dashed border-[var(--ls-linea2)] px-4 py-5 text-center', className)}>
        <p className="text-[12.5px] font-medium text-[var(--ls-t2)]">{plan.cargando ? 'Leyendo el plan…' : 'Todavía no hay plan de reposición de este cliente'}</p>
        {!plan.cargando && (
          <p className="mx-auto mt-1 max-w-[420px] text-[11.5px] leading-[1.5] text-[var(--ls-t3)]">
            {plan.error ?? (plan.migracion316 === false ? 'Falta lanzar la migración 316: sin ella no se guardan las pasadas del plan.' : 'La curva de tallas sale de la última pasada del planificador: cuando se calcule, aquí verás lo vendido, lo que hay en FBA y lo que se propone por talla.')}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className={cx('min-w-0 space-y-3', className)}>
      {/* ---------- Las cifras del modelo ---------- */}
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Cifra rotulo="Ritmo del modelo" valor={fRitmo(curva.ritmoModelo)} pista="Suma del ritmo de sus tallas (media de los días con stock)" />
        {curva.vendido90 !== null && <Cifra rotulo="Vendido en 90 días" valor={`${entero(curva.vendido90)} ud`} />}
        <Cifra rotulo="En FBA" valor={`${entero(curva.enFba)} ud`} />
        {plan.deAgencia && curva.propuesto !== null && <Cifra rotulo="Propone el plan" valor={`${entero(curva.propuesto)} ud`} destacado={curva.hayPropuesta} />}
      </dl>

      {/* ---------- La curva ---------- */}
      <div className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-3">
        <div className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <Clave key={String(s.clave)} color={s.color}>
              {s.nombre}
            </Clave>
          ))}
        </div>
        <Grafico
          etiqueta={`Curva de tallas de ${modelo.ref} ${modelo.nombre}: ${series.map((s) => s.nombre.toLowerCase()).join(', ')} por talla`}
          vacio={vacio}
          textoVacio="Sin ventas ni stock en estas tallas"
          descripcionVacio="Ninguna talla de este modelo tiene stock en FBA ni ventas en la última pasada del plan."
          alto={220}
        >
          <BarChart data={datos} margin={{ top: 8, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%" barGap={2}>
            <CartesianGrid stroke={EJE.rejilla} vertical={false} />
            <XAxis dataKey="talla" tick={EJE.tick} axisLine={{ stroke: EJE.linea }} tickLine={false} interval={0} />
            <YAxis tick={EJE.tick} axisLine={false} tickLine={false} allowDecimals={false} width={32} />
            <Tooltip content={<Contenido />} cursor={{ fill: 'var(--ls-sup3)', opacity: 0.7 }} isAnimationActive={false} />
            {series.map((s) => (
              <Bar key={String(s.clave)} dataKey={String(s.clave)} fill={s.color} radius={[3, 3, 0, 0]} maxBarSize={14} isAnimationActive={animar} animationDuration={DURACION_ANIMACION} />
            ))}
          </BarChart>
        </Grafico>
      </div>

      {/* ---------- El ritmo repartido por tallas ---------- */}
      <div className="min-w-0 rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)]">
        <div className="border-b border-[var(--ls-linea)] px-3 py-2">
          <p className="text-[12.5px] font-semibold text-[var(--ls-t1)]">Ritmo repartido por tallas</p>
          <p className="text-[11px] leading-[1.45] text-[var(--ls-t4)]">
            {curva.tallasRepartidas > 0
              ? `${curva.tallasRepartidas} de ${p.length} tallas usan el ritmo del modelo repartido por lo que vende cada una: la talla suelta no tiene ventas para un ritmo propio.`
              : 'Parte de cada talla en el ritmo del modelo (ud/día, media de los días con stock).'}
          </p>
        </div>
        <ul className="divide-y divide-[var(--ls-linea)]">
          {p.map((x) => (
            <FilaTalla key={x.talla} punto={x} plan={plan} conCodigos={conCodigos} />
          ))}
        </ul>
      </div>

      {plan.calculadoAt && <p className="text-[11px] text-[var(--ls-t4)]">De la pasada del plan del {fechaCorta(plan.calculadoAt.slice(0, 10))} a las {plan.calculadoAt.slice(11, 16)}.</p>}
    </div>
  )
}

function Cifra({ rotulo, valor, pista, destacado }: { rotulo: string; valor: string; pista?: string; destacado?: boolean }) {
  return (
    <div className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] px-3 py-2" title={pista}>
      <dt className="truncate text-[11px] text-[var(--ls-t4)]">{rotulo}</dt>
      <dd className={cx('truncate text-[15px] font-semibold tabular-nums', destacado ? 'text-[var(--ls-acc)]' : 'text-[var(--ls-t1)]')}>{valor}</dd>
    </div>
  )
}

function FilaTalla({ punto: x, plan, conCodigos }: { punto: PuntoCurva; plan: PlanDeLaBase; conCodigos: boolean }) {
  const dato = x.sku ? plan.datos.get(x.sku.replace(/\s+/g, '').toUpperCase()) ?? null : null
  const t = textoPlan(dato, plan.deAgencia)
  const conf = x.confianza ? CONFIANZA[x.confianza] : null
  return (
    <li className={cx('grid grid-cols-[44px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2', !x.continuidad && 'opacity-70')}>
      <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{x.talla}</span>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-[var(--ls-t2)]">
          <span className="tabular-nums">{fRitmo(x.ritmo)}</span>
          {x.cuota !== null && <span className="tabular-nums text-[var(--ls-t4)]">{porcentaje(x.cuota * 100, 0)} del modelo</span>}
          {x.origenRitmo === 'modelo' && (
            <Insignia tono="cian" tamano="sm" title="Ritmo del modelo repartido por lo que vende cada talla">
              del modelo
            </Insignia>
          )}
          {conf && (
            <Insignia tono={conf.tono} variante={conf.variante} tamano="sm" title={dato?.explicacion || conf.texto}>
              {conf.corto}
            </Insignia>
          )}
          {!x.continuidad && <span className="text-[11px] text-[var(--ls-t4)]">sin continuidad</span>}
        </div>
        {x.cuota !== null && <Medidor partes={[{ valor: x.cuota, color: VIZ.vendidas, titulo: 'Parte del ritmo' }]} total={1} alto={4} className="mt-[5px] max-w-[220px]" />}
        <p className="mt-[3px] truncate text-[11px] tabular-nums text-[var(--ls-t4)]">
          {x.enFba !== null ? `${entero(x.enFba)} en FBA` : 'sin datos del plan'}
          {x.deCamino ? ` · ${entero(x.deCamino)} de camino` : ''}
          {x.vendido90 !== null ? ` · ${entero(x.vendido90)} vendidas en 90 d` : ''}
          {conCodigos && x.sku ? ` · ${x.sku}` : ''}
          {conCodigos && !x.sku ? ' · sin FBASKU' : ''}
        </p>
      </div>
      {plan.deAgencia && (
        <span
          className="max-w-[140px] truncate text-right text-[12px] font-medium"
          style={{ color: t.tono === 'propone' ? 'var(--ls-acc)' : t.tono === 'fuera' ? 'var(--ls-t3)' : 'var(--ls-t4)' }}
          title={[t.texto, t.detalle].filter(Boolean).join('. ')}
        >
          {t.texto}
        </span>
      )}
      {!dato && x.sku === null && <span className="col-span-3 text-[11px]" style={{ color: COLOR_ESTADO.ambar }}>Sin FBASKU: no se puede cruzar con Amazon</span>}
    </li>
  )
}
