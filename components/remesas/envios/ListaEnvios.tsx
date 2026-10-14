'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, Link2, Package, Plus, Search } from 'lucide-react'
import { BOTON, CAMPO, COLOR_ESTADO, TIPO } from '@/lib/estilo/denso'
import { serieDeRemesa } from '@/lib/fba/analisis'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { estaEnlazada } from '@/lib/fba/vista'
import { cx, Medidor, Vacio } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import { VIZ } from '../comun/graficos'
import { fecha } from '../formato'
import { InsigniaAmazon } from './estadoAmazon'

/**
 * LA LISTA DE ENVÍOS: SOLO LOS REALES.
 *
 * Aquí no hay borradores ni nada a medias: cada tarjeta es un envío que existe
 * en Amazon. Por defecto salen los VIVOS —los que aún tienen unidades en el
 * almacén— y enlazados; los cerrados y los que no tienen número de envío están
 * detrás de su propio filtro, para que no estorben pero tampoco se pierdan.
 */

type Filtro = 'vivos' | 'cerrados' | 'todos' | 'sin_enlazar'

export function ListaEnvios({
  envios,
  seleccionada,
  onElegir,
  puedeEditar,
  onTraer,
  diasCobertura,
  hoy,
}: {
  envios: RemesaDePanel[]
  seleccionada: string | null
  onElegir: (id: string) => void
  puedeEditar: boolean
  onTraer: () => void
  /** Días de cobertura por remesa, para señalar los que se agotan pronto */
  diasCobertura: Map<string, number | null>
  hoy: string
}) {
  // Un cliente cuyos envíos NO tienen todavía número (el caso de las remesas que
  // vinieron del Excel) no puede abrir una lista vacía: se le enseñan esos, con su
  // explicación, que es lo que hay que arreglar.
  const [filtro, setFiltro] = useState<Filtro>(() => (envios.length > 0 && !envios.some(estaEnlazada) ? 'sin_enlazar' : 'vivos'))
  const [busca, setBusca] = useState('')

  const cuentas = useMemo(
    () => ({
      vivos: envios.filter((r) => estaEnlazada(r) && r.quedan > 0).length,
      cerrados: envios.filter((r) => estaEnlazada(r) && r.quedan === 0).length,
      todos: envios.filter(estaEnlazada).length,
      sin_enlazar: envios.filter((r) => !estaEnlazada(r)).length,
    }),
    [envios]
  )

  const visibles = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return envios
      .filter((r) => {
        if (filtro === 'sin_enlazar') return !estaEnlazada(r)
        if (!estaEnlazada(r)) return false
        return filtro === 'vivos' ? r.quedan > 0 : filtro === 'cerrados' ? r.quedan === 0 : true
      })
      .filter(
        (r) =>
          !q ||
          (r.nombre ?? '').toLowerCase().includes(q) ||
          (r.referenciaEnvio ?? '').toLowerCase().includes(q) ||
          r.lineas.some((l) => l.sku.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q))
      )
      .slice()
      .sort((a, b) => b.fechaEnvio.localeCompare(a.fechaEnvio))
  }, [envios, filtro, busca])

  const raiz = useRef<HTMLElement>(null)
  useTecladoDeLista(raiz, visibles.map((r) => r.id), seleccionada, onElegir)

  /** Las ventas de los últimos 14 días de cada envío: la chispa de la tarjeta */
  const chispas = useMemo(() => {
    const m = new Map<string, number[]>()
    for (const r of envios) m.set(r.id, serieDeRemesa(r, hoy).slice(-14).map((d) => Math.max(0, d.vendidas)))
    return m
  }, [envios, hoy])

  const filtros: Array<[Filtro, string, number]> = [
    ['vivos', 'Vivos', cuentas.vivos],
    ['cerrados', 'Agotados', cuentas.cerrados],
    ['todos', 'Todos', cuentas.todos],
  ]

  return (
    <aside ref={raiz} className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex shrink-0 flex-col gap-2">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[var(--ls-t4)]" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nombre, nº de envío o SKU"
            className={cx(CAMPO.input, 'h-[28px] pl-[26px]')}
          />
        </label>
        <div className="flex flex-wrap items-center gap-[6px]">
          {filtros.map(([id, texto, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setFiltro(id)}
              className={cx(BOTON.chip, filtro === id && BOTON.chipEncendido)}
            >
              {texto}
              <span className="tabular-nums text-[var(--ls-t4)]">{n}</span>
            </button>
          ))}
          {cuentas.sin_enlazar > 0 && (
            <button
              type="button"
              onClick={() => setFiltro('sin_enlazar')}
              className={cx(BOTON.chip, 'ml-auto', filtro === 'sin_enlazar' && BOTON.chipEncendido)}
              title="Envíos que se dieron por hechos sin número de envío FBA"
            >
              <Link2 className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
              Sin enlazar
              <span className="tabular-nums text-[var(--ls-t4)]">{cuentas.sin_enlazar}</span>
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 space-y-[6px] overflow-y-auto pr-[2px]">
        {filtro === 'sin_enlazar' && cuentas.sin_enlazar > 0 && (
          <p
            className="rounded-[6px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-[10px] py-[7px] text-[11.5px] leading-[1.5] text-[var(--ls-t2)]"
            style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}
          >
            Estos envíos no tienen número de envío FBA, así que no se puede seguir su estado en Amazon. Abre cada uno y enlázalo con su número.
          </p>
        )}
        {visibles.length === 0 && (
          <div className="rounded-[8px] border border-dashed border-[var(--ls-linea2)]">
            <Vacio
              icono={<Package />}
              titulo={envios.length === 0 ? 'Todavía no hay ningún envío' : 'Ninguno con este filtro'}
              accion={
                envios.length === 0 && puedeEditar ? (
                  <button type="button" onClick={onTraer} className={cx(BOTON.base, BOTON.alto, BOTON.primario)}>
                    <Plus className="h-3 w-3" />
                    Traer un envío de Amazon
                  </button>
                ) : undefined
              }
            >
              {envios.length === 0
                ? 'Aquí salen los envíos que ya existen en Amazon. Se crean desde Propuestas, o se traen por su número FBA.'
                : 'Prueba con otro filtro o quita la búsqueda.'}
            </Vacio>
          </div>
        )}
        {visibles.map((r) => (
          <TarjetaEnvio
            key={r.id}
            remesa={r}
            activa={r.id === seleccionada}
            cobertura={diasCobertura.get(r.id) ?? null}
            chispa={chispas.get(r.id) ?? []}
            onClick={() => onElegir(r.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function TarjetaEnvio({ remesa, activa, cobertura, chispa, onClick }: { remesa: RemesaDePanel; activa: boolean; cobertura: number | null; chispa: number[]; onClick: () => void }) {
  const base = Math.max(1, remesa.quedan + remesa.lineas.reduce((s, l) => s + l.consumidas, 0))
  const vendidas = remesa.lineas.reduce((s, l) => s + l.consumidas, 0)
  const agotado = remesa.quedan === 0
  const faltan = remesa.unidadesQueNoLlegaron
  const seAgota = cobertura !== null && cobertura < 7 && !agotado

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'relative block w-full rounded-[8px] border px-[11px] py-[9px] text-left transition-colors',
        activa
          ? 'border-[var(--ls-acc-graf)] bg-[var(--ls-sel)]'
          : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)]'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <InsigniaAmazon remesa={remesa} />
        <div className="flex items-baseline gap-[4px]">
          <span className={cx('text-[16px] font-semibold leading-none tracking-[-0.02em]', agotado ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]')}>
            {remesa.quedan.toLocaleString('es-ES')}
          </span>
          <span className="text-[11px] text-[var(--ls-t4)]">quedan</span>
        </div>
      </div>

      <div className="mt-[7px] flex items-center justify-between gap-3">
        <p className={cx(TIPO.l, 'min-w-0 truncate', agotado ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t1)]')}>{remesa.nombre ?? `Envío del ${fecha(remesa.fechaEnvio)}`}</p>
        <Chispa valores={chispa} />
      </div>
      <p className="mt-[1px] truncate text-[11px] text-[var(--ls-t4)]">
        <span className="font-mono">{remesa.referenciaEnvio ?? 'sin número'}</span> · {fecha(remesa.fechaEnvio)} · {remesa.lineas.length} ref ·{' '}
        {remesa.enviadas} ud
      </p>

      <div className="mt-[8px] flex items-center gap-2">
        <Medidor
          alto={6}
          total={base}
          partes={[{ valor: vendidas, color: VIZ.vendidas, titulo: 'Vendidas' }]}
          className="flex-1"
        />
        <span className="shrink-0 whitespace-nowrap text-right text-[11px] tabular-nums text-[var(--ls-t3)]">
          {Math.round((vendidas / base) * 100)} % vendido
        </span>
      </div>

      {(faltan > 0 || seAgota) && (
        <div className="mt-[7px] flex flex-wrap items-center gap-x-3 gap-y-[2px] text-[11px] text-[var(--ls-t3)]">
          {faltan > 0 && (
            <span className="inline-flex items-center gap-1" title="Unidades enviadas que Amazon no ha dado por recibidas">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} />
              {faltan} no llegaron
            </span>
          )}
          {seAgota && (
            <span className="inline-flex items-center gap-1" title="Al ritmo de la última semana">
              <AlertTriangle className="h-3 w-3" style={{ color: COLOR_ESTADO.rojo }} />
              se agota en {Math.max(0, Math.round(cobertura ?? 0))} d
            </span>
          )}
        </div>
      )}
    </button>
  )
}

/**
 * La chispa de ventas: una barrita por día, las de los últimos tres días a todo
 * color. No lleva eje ni número —está para ver de un vistazo si se mueve—, y el
 * título dice el total. Va en el azul de «vendidas», el mismo de los gráficos.
 */
function Chispa({ valores }: { valores: number[] }) {
  if (valores.length === 0) return null
  const max = Math.max(1, ...valores)
  const ancho = 3
  const hueco = 1.5
  const alto = 16
  const total = valores.reduce((s, v) => s + v, 0)
  return (
    <svg
      width={valores.length * (ancho + hueco) - hueco}
      height={alto}
      className="shrink-0"
      role="img"
      aria-label={`${total} unidades vendidas en los últimos ${valores.length} días`}
    >
      <title>{`${total} unidades vendidas en los últimos ${valores.length} días`}</title>
      {valores.map((v, i) => {
        const h = Math.max(v > 0 ? 2.5 : 1, (v / max) * alto)
        return <rect key={i} x={i * (ancho + hueco)} y={alto - h} width={ancho} height={h} rx={1} fill="var(--viz-1)" opacity={v === 0 ? 0.25 : i >= valores.length - 3 ? 1 : 0.6} />
      })}
    </svg>
  )
}
