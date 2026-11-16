'use client'

import { useMemo, useRef, useState } from 'react'
import { AlertTriangle, CircleHelp, Link2, Package, PackageX, Plus, Search, Sparkles } from 'lucide-react'
import { EstadoVacio, Insignia, Segmentado, TACTIL } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { serieDeRemesa } from '@/lib/fba/analisis'
import type { RemesaDePanel } from '@/lib/fba/datos'
import { estaEnlazada } from '@/lib/fba/vista'
import { cx, Medidor } from '../comun/ui'
import { useTecladoDeLista } from '../comun/useTeclado'
import { VIZ } from '../comun/graficos'
import { fecha } from '../formato'
import { InsigniaAmazon } from './estadoAmazon'
import { cuentasDeEnvio, esDelPlan, esDudoso, faltantesAlCerrar } from './reglas'

/**
 * LA LISTA DE ENVÍOS: SOLO LOS REALES.
 *
 * Aquí no hay borradores ni nada a medias: cada tarjeta es un envío que existe en Amazon. Por defecto salen los VIVOS
 * —los que aún tienen unidades en el almacén— y enlazados; los agotados y los que no tienen número de envío están
 * detrás de su propio filtro, para que no estorben pero tampoco se pierdan.
 *
 * Se conserva todo lo de antes (buscador por nombre, nº FBA o SKU; filtros con su cuenta; «Sin enlazar»; la chispa de
 * 14 días; ↑↓ con el teclado) con el kit. Novedades (remesas-pro): «vendido» es solo VENTAS (sin retiradas ni mermas),
 * y las insignias «Del plan», «Envío dudoso» y «Cerrado con faltantes».
 *
 * En el móvil la lista crece con la página (sin scroll propio); desde lg tiene su propio scroll dentro de la columna
 * pegajosa que pone quien la monta (SeccionEnvios).
 *
 * API (la de siempre, más opcionales)
 *   <ListaEnvios envios seleccionada onElegir puedeEditar onTraer diasCobertura hoy transporteMediano? className? />
 *   <TarjetaEnvioVista datos activa? cobertura chispa onClick />   (la usa también el tablero de todos los clientes)
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
  transporteMediano = null,
  className,
}: {
  envios: RemesaDePanel[]
  seleccionada: string | null
  onElegir: (id: string) => void
  puedeEditar: boolean
  onTraer: () => void
  /** Días de cobertura por remesa, para señalar los que se agotan pronto */
  diasCobertura: Map<string, number | null>
  hoy: string
  /** Transporte mediano del cliente (plan), para el «Envío dudoso»; sin él el umbral es de 30 días */
  transporteMediano?: number | null
  className?: string
}) {
  // Un cliente cuyos envíos NO tienen todavía número (las remesas que vinieron del Excel) no puede abrir una lista
  // vacía: se le enseñan esos, con su explicación, que es lo que hay que arreglar.
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

  return (
    <aside ref={raiz} aria-label="Envíos" className={cx('flex min-w-0 flex-col gap-3', className)}>
      <div className="flex shrink-0 flex-col gap-2">
        <label className="relative block">
          <span className="sr-only">Buscar envíos</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-[var(--ls-t4)]" aria-hidden />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Nombre, nº de envío o SKU"
            className={cx(
              'h-9 w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-9 pr-3 text-[13px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)]',
              'hover:border-[var(--ls-linea2)] focus:border-[var(--ls-acc-graf)] focus:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)]',
              TACTIL
            )}
          />
        </label>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Con «Sin enlazar» elegido no se marca ninguna de las tres: es un filtro aparte */}
          <Segmentado<Filtro>
            etiqueta="Qué envíos"
            tamano="sm"
            valor={filtro}
            onCambio={setFiltro}
            opciones={[
              { id: 'vivos', texto: 'Vivos', cuenta: cuentas.vivos },
              { id: 'cerrados', texto: 'Agotados', cuenta: cuentas.cerrados },
              { id: 'todos', texto: 'Todos', cuenta: cuentas.todos },
            ]}
          />
          {cuentas.sin_enlazar > 0 && (
            <button
              type="button"
              onClick={() => setFiltro('sin_enlazar')}
              aria-pressed={filtro === 'sin_enlazar'}
              title="Envíos que se dieron por hechos sin número de envío FBA"
              className={cx(
                'inline-flex h-8 items-center gap-[6px] rounded-full border px-3 text-[12px] font-medium transition-colors',
                TACTIL,
                filtro === 'sin_enlazar'
                  ? 'border-[color-mix(in_srgb,var(--ls-e-ambar)_45%,var(--ls-linea))] bg-[color-mix(in_srgb,var(--ls-e-ambar)_12%,transparent)] text-[var(--ls-t1)]'
                  : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] text-[var(--ls-t2)] hover:border-[var(--ls-linea2)]'
              )}
            >
              <Link2 className="h-3 w-3" style={{ color: COLOR_ESTADO.ambar }} aria-hidden />
              Sin enlazar
              <span className="tabular-nums text-[var(--ls-t4)]">{cuentas.sin_enlazar}</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 lg:overflow-y-auto lg:pr-[2px]">
        {filtro === 'sin_enlazar' && cuentas.sin_enlazar > 0 && (
          <p
            className="rounded-[10px] border border-[var(--ls-linea2)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] leading-[1.5] text-[var(--ls-t2)]"
            style={{ borderLeft: `3px solid ${COLOR_ESTADO.ambar}` }}
          >
            Estos envíos no tienen número de envío FBA, así que no se puede seguir su estado en Amazon. Abre cada uno y enlázalo con su número.
          </p>
        )}
        {visibles.length === 0 && (
          <div className="rounded-[14px] border border-dashed border-[var(--ls-linea2)] bg-[var(--ls-sup)]">
            <EstadoVacio
              compacto
              icono={Package}
              acento="remesas"
              titulo={envios.length === 0 ? 'Todavía no hay ningún envío' : 'Ninguno con este filtro'}
              descripcion={
                envios.length === 0
                  ? 'Aquí salen los envíos que ya existen en Amazon. Se crean desde Propuestas, o se traen por su número FBA.'
                  : 'Prueba con otro filtro o quita la búsqueda.'
              }
              accion={envios.length === 0 && puedeEditar ? { texto: 'Traer un envío de Amazon', onClick: onTraer, icono: Plus } : undefined}
            />
          </div>
        )}
        {visibles.map((r, i) => (
          <TarjetaEnvio
            key={r.id}
            remesa={r}
            indice={i}
            activa={r.id === seleccionada}
            cobertura={diasCobertura.get(r.id) ?? null}
            chispa={chispas.get(r.id) ?? []}
            dudoso={esDudoso(r, hoy, transporteMediano)}
            onClick={() => onElegir(r.id)}
          />
        ))}
      </div>
    </aside>
  )
}

function TarjetaEnvio({
  remesa,
  activa,
  cobertura,
  chispa,
  dudoso,
  indice,
  onClick,
}: {
  remesa: RemesaDePanel
  activa: boolean
  cobertura: number | null
  chispa: number[]
  dudoso: boolean
  indice: number
  onClick: () => void
}) {
  const c = cuentasDeEnvio(remesa)
  return (
    <TarjetaEnvioVista
      datos={{
        nombre: remesa.nombre,
        fechaEnvio: remesa.fechaEnvio,
        referenciaEnvio: remesa.referenciaEnvio,
        estadoAmazon: remesa.estadoAmazon,
        seguimientoError: remesa.seguimientoError,
        quedan: remesa.quedan,
        enviadas: remesa.enviadas,
        vendidas: c.vendidas,
        retiradasYMermas: c.retiradasYMermas,
        noLlegaron: remesa.unidadesQueNoLlegaron,
        referencias: remesa.lineas.length,
        delPlan: esDelPlan(remesa),
        dudoso,
        faltanAlCerrar: faltantesAlCerrar(remesa),
      }}
      activa={activa}
      cobertura={cobertura}
      chispa={chispa}
      indice={indice}
      onClick={onClick}
    />
  )
}

/** Lo que pinta una tarjeta de envío. La usan la lista de un cliente (con una remesa entera detrás) y el tablero de todos (que solo trae esto, ya resumido) */
export interface DatosDeTarjeta {
  nombre: string | null
  fechaEnvio: string
  referenciaEnvio: string | null
  estadoAmazon: string | null
  seguimientoError: string | null
  quedan: number
  enviadas: number
  /** Solo ventas. Quien todavía no las separa (el tablero) puede pasar lo consumido */
  vendidas: number
  /** Retiradas del almacén y mermas: salen del stock pero no son ventas */
  retiradasYMermas?: number
  noLlegaron: number
  referencias: number
  /** Nació de un envío propuesto por el planificador */
  delPlan?: boolean
  /** Va de camino hace demasiado sin que Amazon haya recibido nada (D3) */
  dudoso?: boolean
  /** Amazon lo cerró con faltantes (D18): cuántas no llegaron */
  faltanAlCerrar?: number | null
}

export function TarjetaEnvioVista({
  datos,
  activa = false,
  cobertura,
  chispa,
  onClick,
  indice,
}: {
  datos: DatosDeTarjeta
  activa?: boolean
  cobertura: number | null
  chispa: number[]
  onClick: () => void
  /** Posición en la lista, para la entrada escalonada (se corta a 12 pasos) */
  indice?: number
}) {
  const retiradas = Math.max(0, datos.retiradasYMermas ?? 0)
  const base = Math.max(1, datos.quedan + datos.vendidas + retiradas)
  const agotado = datos.quedan === 0
  const faltan = datos.noLlegaron
  const seAgota = cobertura !== null && cobertura < 7 && !agotado
  const pctVendido = Math.round((datos.vendidas / base) * 100)

  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={activa}
      className={cx(
        'group relative block w-full rounded-[14px] border px-[14px] py-3 text-left shadow-[var(--ls-sombra-1)] outline-none transition-[background-color,border-color] duration-150',
        'focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--ls-fondo)]',
        indice != null && 'ls-aparecer',
        activa
          ? 'border-[color-mix(in_srgb,var(--ls-mod-remesas)_55%,var(--ls-linea))] bg-[var(--ls-sel)]'
          : 'border-[var(--ls-linea)] bg-[var(--ls-sup)] hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)] active:bg-[var(--ls-sup2)]'
      )}
      style={indice != null ? ({ ['--ls-i' as string]: Math.min(indice, 12) } as React.CSSProperties) : undefined}
    >
      {activa && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: 'var(--ls-mod-remesas)' }} />}
      <div className="flex items-center justify-between gap-2">
        <InsigniaAmazon remesa={datos} />
        <div className="flex items-baseline gap-[4px]">
          <span className={cx('text-[18px] font-semibold leading-none tracking-[-0.02em] tabular-nums', agotado ? 'text-[var(--ls-t4)]' : 'text-[var(--ls-t1)]')}>
            {datos.quedan.toLocaleString('es-ES')}
          </span>
          <span className="text-[11.5px] text-[var(--ls-t4)]">quedan</span>
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3">
        <p className={cx('min-w-0 truncate text-[13.5px] font-semibold tracking-[-0.01em]', agotado ? 'text-[var(--ls-t3)]' : 'text-[var(--ls-t1)]')}>
          {datos.nombre ?? `Envío del ${fecha(datos.fechaEnvio)}`}
        </p>
        <Chispa valores={chispa} />
      </div>
      <p className="mt-[2px] truncate text-[11.5px] text-[var(--ls-t4)]">
        <span className="font-mono">{datos.referenciaEnvio ?? 'sin número'}</span> · {fecha(datos.fechaEnvio)} · {datos.referencias} ref · {datos.enviadas.toLocaleString('es-ES')} ud
      </p>

      <div className="mt-[10px] flex items-center gap-2">
        <Medidor
          alto={6}
          total={base}
          partes={[
            { valor: datos.vendidas, color: VIZ.vendidas, titulo: 'Vendidas' },
            { valor: retiradas, color: 'var(--ls-e-magenta)', titulo: 'Retiradas y mermas' },
          ]}
          className="flex-1"
        />
        <span className="shrink-0 whitespace-nowrap text-right text-[11.5px] tabular-nums text-[var(--ls-t3)]" title="Solo ventas: las retiradas y las mermas no cuentan">
          {pctVendido} % vendido
        </span>
      </div>

      {(datos.delPlan || datos.dudoso || (datos.faltanAlCerrar ?? 0) > 0 || (faltan > 0 && !datos.faltanAlCerrar) || seAgota) && (
        <div className="mt-[10px] flex flex-wrap items-center gap-[6px]">
          {datos.delPlan && (
            <Insignia tono="azul" icono={Sparkles} tamano="sm" title="Nació de un envío propuesto por el planificador">
              Del plan
            </Insignia>
          )}
          {datos.dudoso && (
            <Insignia tono="ambar" icono={CircleHelp} tamano="sm" variante="solida" title="Lleva demasiado de camino sin que Amazon haya recibido nada: no cuenta para la cobertura. Pregunta a Amazon">
              Envío dudoso
            </Insignia>
          )}
          {(datos.faltanAlCerrar ?? 0) > 0 ? (
            <Insignia tono="rojo" icono={PackageX} tamano="sm" title="Amazon lo cerró con menos de lo que se mandó: se puede reclamar">
              Cerrado con faltantes: {datos.faltanAlCerrar} no llegaron
            </Insignia>
          ) : (
            faltan > 0 && (
              <Insignia tono="ambar" icono={AlertTriangle} tamano="sm" title="Unidades enviadas que Amazon no ha dado por recibidas">
                {faltan} no llegaron
              </Insignia>
            )
          )}
          {seAgota && (
            <Insignia tono="rojo" icono={AlertTriangle} tamano="sm" title="Al ritmo de la última semana de este envío">
              se agota en {Math.max(0, Math.round(cobertura ?? 0))} d
            </Insignia>
          )}
        </div>
      )}
    </button>
  )
}

/**
 * La chispa de ventas: una barrita por día, las de los últimos tres días a todo color. No lleva eje ni número —está para
 * ver de un vistazo si se mueve—, y el título dice el total. Va en el azul de «vendidas», el mismo de los gráficos.
 */
function Chispa({ valores }: { valores: number[] }) {
  if (valores.length === 0) return null
  const max = Math.max(1, ...valores)
  const ancho = 3
  const hueco = 1.5
  const alto = 16
  const total = valores.reduce((s, v) => s + v, 0)
  return (
    <svg width={valores.length * (ancho + hueco) - hueco} height={alto} className="shrink-0" role="img" aria-label={`${total} unidades salieron en los últimos ${valores.length} días`}>
      <title>{`${total} unidades salieron en los últimos ${valores.length} días`}</title>
      {valores.map((v, i) => {
        const h = Math.max(v > 0 ? 2.5 : 1, (v / max) * alto)
        return <rect key={i} x={i * (ancho + hueco)} y={alto - h} width={ancho} height={h} rx={1} fill="var(--viz-1)" opacity={v === 0 ? 0.25 : i >= valores.length - 3 ? 1 : 0.6} />
      })}
    </svg>
  )
}
