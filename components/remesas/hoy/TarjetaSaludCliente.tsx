'use client'

import type { ReactNode } from 'react'
import { ArrowRight, PackagePlus, Truck } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { Chispa, CifraAnimada, Esqueleto, Insignia, mezcla, TACTIL } from '@/components/ui-ls'
import { SALUD } from '../comun/estilo-plan'
import { cx, Medidor } from '../comun/ui'
import { VIZ } from '../comun/graficos'
import { dias, dinero, diasEntre, entero, fechaCorta } from '../formato'
import type { ClienteDeResumen } from './useResumen'

/**
 * TARJETA DE SALUD DE UN CLIENTE EN «HOY» (spec remesas-pro §1.5, §6.2 y D42).
 *
 * Un vistazo por cliente: punto y palabra de salud (rojo · ámbar · verde · gris «sin datos») con su motivo, el stock en
 * FBA (vendible y de camino en una barra), la primera rotura, la cobertura mediana, el € en juego en SU moneda, las
 * ventas de 30 días en una chispa, el próximo envío propuesto y el «+N» de envíos nuevos en Amazon (Importar pedidos).
 *
 * No hace peticiones: lo recibe todo de VistaHoy. Las acciones son callbacks (abrir el cliente, abrir el envío propuesto,
 * importar). La tarjeta no es un botón entero (lleva botones dentro): el nombre y «Abrir» llevan al cliente.
 *
 * API
 *   <TarjetaSaludCliente cliente hoy enviosNuevos? indice? onAbrir onAbrirEnvio? onImportar? />
 *   <EsqueletoSaludCliente />
 */

export interface TarjetaSaludClienteProps {
  cliente: ClienteDeResumen
  hoy: string
  /** Envíos en Amazon que el ERP no conoce (useEnviosNuevosDeTodos) */
  enviosNuevos?: number
  /** Posición en la lista, para la entrada escalonada (se corta a 12) */
  indice?: number
  onAbrir: (clienteId: string) => void
  onAbrirEnvio?: (envioId: string) => void
  /** Sin él (sin permiso), el «+N» se enseña pero no es un botón */
  onImportar?: (clienteId: string) => void
}

function Dato({ etiqueta, children, titulo, color }: { etiqueta: string; children: ReactNode; titulo?: string; color?: string }) {
  return (
    <div className="min-w-0" title={titulo}>
      <div className="truncate text-[11px] text-[var(--ls-t4)]">{etiqueta}</div>
      <div className="truncate text-[14px] font-semibold tabular-nums tracking-[-0.01em] text-[var(--ls-t1)]" style={color ? { color } : undefined}>
        {children}
      </div>
    </div>
  )
}

export function TarjetaSaludCliente({ cliente, hoy, enviosNuevos = 0, indice, onAbrir, onAbrirEnvio, onImportar }: TarjetaSaludClienteProps) {
  const tono = cliente.salud?.tono ?? 'gris'
  const estilo = SALUD[tono]
  const color = COLOR_ESTADO[estilo.tono]
  const r = cliente.resumen
  const gris = tono === 'gris'
  const ventas30 = cliente.chispa30.reduce((s, v) => s + (Number(v) || 0), 0)
  const hayVentas = cliente.chispa30.some((v) => v > 0)
  const rotura = r?.primeraRotura ?? null
  const enDias = rotura ? diasEntre(hoy, rotura) : null
  const colorRotura = enDias === null ? undefined : enDias <= 14 ? COLOR_ESTADO.rojo : enDias <= 30 ? COLOR_ESTADO.ambar : undefined
  const prox = cliente.proximoEnvio

  return (
    <article
      className={cx(
        'ls-elevar relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)]',
        'before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit] before:bg-[image:var(--ls-velo)]',
        'border-[var(--ls-linea)] hover:border-[var(--ls-linea2)]',
        indice != null && 'ls-aparecer',
        gris && 'opacity-[0.88]'
      )}
      style={indice != null ? { ['--ls-i' as string]: Math.min(indice, 12) } : undefined}
      aria-label={`${cliente.nombre}: ${estilo.texto}`}
    >
      {/* Filo de salud a la izquierda: el tono se lee también en la palabra de la insignia */}
      <span aria-hidden className="pointer-events-none absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: color }} />

      <header className="relative flex min-w-0 items-start gap-2 px-4 pt-[14px]">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onAbrir(cliente.clienteId)}
            className="max-w-full truncate rounded-[6px] text-left text-[14.5px] font-semibold tracking-[-0.01em] text-[var(--ls-t1)] outline-none hover:underline focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]"
          >
            {cliente.nombre}
          </button>
          {cliente.salud?.motivo && <p className="mt-[2px] line-clamp-2 text-[12px] leading-[1.45] text-[var(--ls-t3)]">{cliente.salud.motivo}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-[6px]">
          <Insignia tono={estilo.tono} variante={estilo.variante} tamano="sm" title={estilo.texto}>
            {estilo.corto}
          </Insignia>
          {enviosNuevos > 0 &&
            (onImportar ? (
              <button
                type="button"
                onClick={() => onImportar(cliente.clienteId)}
                title={`Amazon tiene ${enviosNuevos} envío${enviosNuevos === 1 ? '' : 's'} que el ERP no conoce: impórtalo${enviosNuevos === 1 ? '' : 's'}`}
                className={cx(
                  'inline-flex h-[20px] items-center gap-1 rounded-full border px-[7px] text-[11px] font-semibold tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
                  TACTIL
                )}
                style={{ color: COLOR_ESTADO.ambar, background: mezcla(COLOR_ESTADO.ambar, 12), borderColor: mezcla(COLOR_ESTADO.ambar, 30) }}
              >
                <PackagePlus className="h-3 w-3" aria-hidden />+{enviosNuevos}
              </button>
            ) : (
              <span
                className="inline-flex h-[20px] items-center gap-1 rounded-full border px-[7px] text-[11px] font-semibold tabular-nums"
                style={{ color: COLOR_ESTADO.ambar, background: mezcla(COLOR_ESTADO.ambar, 12), borderColor: mezcla(COLOR_ESTADO.ambar, 30) }}
                title={`${enviosNuevos} envío${enviosNuevos === 1 ? '' : 's'} nuevo${enviosNuevos === 1 ? '' : 's'} en Amazon`}
              >
                +{enviosNuevos}
              </span>
            ))}
        </div>
      </header>

      {r && !gris ? (
        <>
          <div className="relative mt-3 grid grid-cols-3 gap-x-3 gap-y-3 px-4">
            <Dato etiqueta="Vendible" titulo="Unidades vendibles en FBA ahora">
              <CifraAnimada valor={r.vendibles} formato={entero} />
              <span className="ml-[3px] text-[11px] font-normal text-[var(--ls-t4)]">ud</span>
            </Dato>
            <Dato etiqueta="De camino" titulo="Unidades enviadas que Amazon todavía no ha recibido">
              <CifraAnimada valor={r.deCamino} formato={entero} />
              <span className="ml-[3px] text-[11px] font-normal text-[var(--ls-t4)]">ud</span>
            </Dato>
            <Dato etiqueta="Referencias" titulo={`${r.referencias} referencias; ${r.agotadosConVentas} agotadas que se venden`}>
              {entero(r.referencias)}
              {r.agotadosConVentas > 0 && (
                <span className="ml-1 text-[11px] font-medium" style={{ color: COLOR_ESTADO.rojo }}>
                  {r.agotadosConVentas} agot.
                </span>
              )}
            </Dato>
            <Dato
              etiqueta="1.ª rotura"
              color={colorRotura}
              titulo={rotura ? `La primera referencia se queda sin stock el ${fechaCorta(rotura, hoy)}${enDias !== null ? ` (${enDias <= 0 ? 'ya' : `en ${dias(enDias)}`})` : ''}` : 'Ninguna rotura a la vista'}
            >
              {rotura ? (enDias !== null && enDias <= 0 ? 'Hoy' : fechaCorta(rotura, hoy)) : '—'}
            </Dato>
            <Dato etiqueta="Cobertura" titulo="Días que dura el stock (mediana de las referencias que venden), con lo que viene de camino">
              {r.coberturaMediana != null ? `${entero(r.coberturaMediana)} d` : '—'}
            </Dato>
            <Dato
              etiqueta="En juego"
              color={r.eurosEnRiesgo > 0 ? COLOR_ESTADO.rojo : undefined}
              titulo={`Ventas que se pierden en los próximos días si no se envía nada, a precio actual de Amazon (${r.moneda})`}
            >
              {r.eurosEnRiesgo > 0 ? <CifraAnimada valor={r.eurosEnRiesgo} formato={(n) => dinero(n, r.moneda)} /> : dinero(0, r.moneda)}
            </Dato>
          </div>

          {r.vendibles + r.deCamino > 0 && (
            <div className="relative mt-3 px-4">
              <Medidor
                alto={6}
                partes={[
                  { valor: r.vendibles, color: VIZ.quedan, titulo: 'Vendible' },
                  { valor: r.deCamino, color: VIZ.recibidas, titulo: 'De camino' },
                ]}
              />
            </div>
          )}
        </>
      ) : (
        <p className="relative mx-4 mt-3 rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-[10px] text-[12px] leading-[1.5] text-[var(--ls-t3)]">
          {gris
            ? 'Sin ventas leídas no hay ritmo ni fechas: la salud se calcula cuando se lea el libro de Amazon.'
            : 'Todavía no hay plan para este cliente.'}
        </p>
      )}

      <div className="relative mt-3 px-4">
        <div className="flex items-baseline justify-between gap-2 text-[11px] text-[var(--ls-t4)]">
          <span>Ventas 30 días</span>
          <span className="tabular-nums">{hayVentas ? `${entero(ventas30)} ud` : 'sin ventas'}</span>
        </div>
        {hayVentas ? (
          <Chispa valores={cliente.chispa30} color="var(--ls-mod-remesas)" alto={36} />
        ) : (
          <div className="mt-[6px] h-[30px] rounded-[8px] bg-[var(--ls-sup2)]" aria-hidden />
        )}
      </div>

      <footer className="relative mt-auto flex min-w-0 flex-wrap items-center justify-between gap-2 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_70%,transparent)] px-4 py-[8px]">
        {prox ? (
          <button
            type="button"
            onClick={() => onAbrirEnvio?.(prox.id)}
            disabled={!onAbrirEnvio}
            className={cx(
              'inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-[8px] text-left text-[12px] text-[var(--ls-t2)] outline-none hover:text-[var(--ls-t1)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] disabled:cursor-default',
              TACTIL
            )}
            title="Abrir el próximo envío propuesto"
          >
            <Truck className="h-[13px] w-[13px] shrink-0 text-[var(--ls-mod-remesas)]" aria-hidden />
            <span className="truncate">
              Sale antes del <strong className="font-semibold text-[var(--ls-t1)]">{fechaCorta(prox.salirAntesDe, hoy)}</strong> · {entero(prox.unidades)} ud
            </span>
          </button>
        ) : (
          <span className="truncate text-[12px] text-[var(--ls-t4)]">{gris ? 'Sin plan' : 'Ningún envío propuesto'}</span>
        )}
        <button
          type="button"
          onClick={() => onAbrir(cliente.clienteId)}
          className={cx(
            'inline-flex shrink-0 items-center gap-1 rounded-[8px] px-[6px] text-[12px] font-medium text-[var(--ls-t2)] outline-none hover:bg-[var(--ls-sup3)] hover:text-[var(--ls-t1)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)]',
            'h-7',
            TACTIL
          )}
        >
          Abrir <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </footer>
    </article>
  )
}

export function EsqueletoSaludCliente() {
  return (
    <div role="status" aria-label="Cargando" className="rounded-[14px] border border-[var(--ls-linea)] bg-[var(--ls-sup)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <Esqueleto className="h-[13px] w-2/5" />
          <Esqueleto className="mt-2 h-[9px] w-4/5" />
        </div>
        <Esqueleto className="h-[20px] w-14 rounded-full" />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i}>
            <Esqueleto className="h-[8px] w-3/5" />
            <Esqueleto className="mt-[6px] h-[13px] w-4/5" />
          </div>
        ))}
      </div>
      <Esqueleto className="mt-4 h-[30px] w-full rounded-[8px]" />
    </div>
  )
}
