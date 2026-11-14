'use client'

import { memo } from 'react'
import { ArrowRight, Ban, Check, FlaskConical, TriangleAlert, Undo2 } from 'lucide-react'
import { Boton, Insignia, mezcla, TACTIL_CUADRADO } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { Propuesta } from '@/lib/ads/motor'
import { decimal, dinero, entero } from '../formato'
import { ESTADO_DE_PROPUESTA, impactoDe, nombreDePropuesta, reservaColgada, tonoDePropuesta } from './textos'

export interface TarjetaDePropuestaProps {
  p: Propuesta
  moneda: string | null
  /** Por qué no se puede aplicar ahora (null = se puede) */
  bloqueo: string | null
  /** Esta tarjeta está trabajando (aplicando, ensayando…) */
  ocupado: string | null
  algoOcupado: boolean
  historial?: boolean
  marcada?: boolean
  minutosReservaColgada: number
  indice?: number
  onMarcar?: (id: string) => void
  onAplicar?: (p: Propuesta) => void
  onEnsayar?: (p: Propuesta) => void
  onDescartar?: (p: Propuesta) => void
  onDeshacer?: (p: Propuesta) => void
}

/**
 * UNA PROPUESTA DEL MOTOR, en tarjeta: QUÉ hace (la etiqueta y el término), POR QUÉ (el motivo y las cifras con las que se decidió), el IMPACTO (lo que ahorra o pone
 * en juego) y qué se puede hacer (aplicar, ensayar sin escribir, descartar; en el historial, deshacer). Memo: la lista puede tener cientos y marcar una no repinta las demás.
 */
export const TarjetaDePropuesta = memo(function TarjetaDePropuesta({ p, moneda, bloqueo, ocupado, algoOcupado, historial, marcada, minutosReservaColgada, indice, onMarcar, onAplicar, onEnsayar, onDescartar, onDeshacer }: TarjetaDePropuestaProps) {
  const m = p.metricas
  const tono = tonoDePropuesta(p)
  const color = COLOR_ESTADO[tono]
  const estado = ESTADO_DE_PROPUESTA[p.estado]
  const impacto = impactoDe(p)
  const colgada = reservaColgada(p, minutosReservaColgada)
  const titulo = p.tipo === 'presupuesto' ? 'Presupuesto diario' : p.esAsin ? p.termino.toUpperCase() : p.termino

  return (
    <article
      className={`ls-elevar relative flex min-w-0 flex-col overflow-hidden rounded-[14px] border bg-[var(--ls-sup)] shadow-[var(--ls-sombra-1)] before:pointer-events-none before:absolute before:inset-0 before:bg-[image:var(--ls-velo)] ${indice != null ? 'ls-aparecer' : ''} ${marcada ? 'border-[var(--ls-acc-borde)]' : 'border-[var(--ls-linea)]'}`}
      style={{ ...(indice != null ? { ['--ls-i' as string]: Math.min(indice, 12) } : null), ...(marcada ? { background: `linear-gradient(180deg, ${mezcla('var(--ls-acc)', 7)}, var(--ls-sup) 60%)` } : null) }}
      aria-label={`${nombreDePropuesta(p)}: ${titulo}`}
    >
      {/* Filo del color del tipo: de un vistazo, qué recorta y qué amplía */}
      <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full" style={{ background: color }} />

      <div className="relative flex items-start gap-3 px-4 pb-3 pt-[14px]">
        {!historial && (
          <label className={`-ml-1 -mt-[3px] flex shrink-0 cursor-pointer items-center justify-center rounded-[8px] p-1 ${TACTIL_CUADRADO} ${bloqueo || algoOcupado ? 'cursor-not-allowed opacity-40' : 'hover:bg-[var(--ls-sup2)]'}`} title={bloqueo ?? 'Marcar para aplicar o descartar en bloque'}>
            <input type="checkbox" checked={Boolean(marcada)} disabled={bloqueo !== null || algoOcupado} onChange={() => onMarcar?.(p.id)} aria-label={`Marcar «${p.termino}»`} className="h-4 w-4 accent-[var(--ls-acc)]" />
          </label>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-[6px]">
            <Insignia tono={tono} tamano="sm">{nombreDePropuesta(p)}</Insignia>
            {m.revisar && (
              <Insignia tono="ambar" tamano="sm" variante="contorno" title="No comparte ninguna palabra con el producto: decide tú si es otra cosa (otro formato, otra categoría, una marca ajena) o una búsqueda buena">
                Revisar
              </Insignia>
            )}
            {m.precioEstimado != null && (
              <Insignia tono="gris" tamano="sm" variante="contorno" title={`El producto no tiene precio en su ficha: se usa el ticket medio de Ads (${decimal(m.precioEstimado)}). Ponle el precio en Productos para afinar.`}>
                Precio estimado
              </Insignia>
            )}
            {historial && estado && (
              <Insignia tono={estado.tono} tamano="sm" variante="suave" vivo={p.estado === 'aplicando' || p.estado === 'aprobada'}>
                {estado.texto}
                {p.automatica ? ' · autopiloto' : ''}
              </Insignia>
            )}
          </div>
          <h4 className="mt-[7px] truncate text-[15px] font-semibold leading-[1.25] tracking-[-0.01em] text-[var(--ls-t1)]" title={p.termino}>
            {titulo}
          </h4>
          {(p.tipo === 'puja' || p.tipo === 'presupuesto') && p.valorActual != null && p.valorNuevo != null && (
            <div className="mt-[3px] inline-flex items-center gap-[6px] text-[13.5px] tabular-nums text-[var(--ls-t2)]">
              {dinero(p.valorActual, moneda)} <ArrowRight className="h-[13px] w-[13px] text-[var(--ls-t4)]" aria-hidden /> <strong style={{ color }}>{dinero(p.valorNuevo, moneda)}</strong>
            </div>
          )}
          <div className="mt-[3px] flex min-w-0 flex-wrap items-center gap-[5px] text-[12px] text-[var(--ls-t4)]">
            <span className="max-w-full truncate" title={p.campaignNombre}>
              {p.desdeRol ?? p.campaignNombre}
            </span>
            {p.tipo === 'promover' && (
              <>
                <ArrowRight className="h-3 w-3 shrink-0" aria-hidden />
                <span style={p.haciaCampaignId ? undefined : { color: COLOR_ESTADO.ambar }}>
                  {p.haciaRol ?? '—'}
                  {p.haciaCampaignId ? '' : ' (no existe: créala en «Crear campañas»)'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* POR QUÉ: el motivo y las cifras */}
      <div className="relative px-4">
        <p className="text-[13px] leading-[1.5] text-[var(--ls-t2)]">{p.motivo}</p>
        <dl className="mt-3 grid grid-cols-2 gap-2 min-[420px]:grid-cols-4">
          {p.tipo === 'presupuesto' ? <Cifra etiqueta="Uso" valor={m.usoPct == null ? '—' : `${m.usoPct} %`} /> : <Cifra etiqueta="Clics" valor={entero(m.clics)} />}
          <Cifra etiqueta={p.tipo === 'presupuesto' ? 'Gasto 7 d' : 'Gasto'} valor={dinero(m.gasto, moneda)} />
          {p.tipo === 'presupuesto' ? <Cifra etiqueta="Ventas 7 d" valor={dinero(m.ventas, moneda)} /> : <Cifra etiqueta="Pedidos" valor={entero(m.pedidos)} />}
          <Cifra etiqueta={m.cvrPct != null && p.tipo !== 'presupuesto' ? `ACoS · CVR ${decimal(m.cvrPct, 1)} %` : 'ACoS'} valor={m.acosPct == null ? '—' : `${decimal(m.acosPct, 1)} %`} />
        </dl>
        {impacto && (
          <p className="mt-3 rounded-[10px] px-3 py-2 text-[12.5px] font-medium" style={{ background: mezcla(COLOR_ESTADO[impacto.tono], 10), color: COLOR_ESTADO[impacto.tono] }}>
            {impacto.texto}
          </p>
        )}
        {p.error && <p className="mt-2 text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.rojo }}>{p.error}</p>}
        {colgada && (
          <p className="mt-2 flex items-start gap-[6px] text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar }}>
            <TriangleAlert className="mt-[2px] h-3 w-3 shrink-0" aria-hidden />
            Se quedó a medias hace más de {minutosReservaColgada} minutos: puede que esté hecha en Amazon. Compruébalo allí antes de repetirla (el log tiene lo que se llegó a mandar).
          </p>
        )}
        {bloqueo && !historial && <p className="mt-2 text-[12px] leading-[1.45]" style={{ color: COLOR_ESTADO.ambar }}>{bloqueo}</p>}
      </div>

      {/* QUÉ HACER */}
      <div className="relative mt-auto flex flex-wrap items-center gap-2 px-4 pb-4 pt-3">
        {!historial && (
          <>
            <Boton variante="primario" tamano="sm" icono={Check} disabled={algoOcupado || bloqueo !== null} cargando={ocupado === 'aplicar'} onClick={() => onAplicar?.(p)} title={bloqueo ?? 'Escribe en la cuenta de Amazon Ads del cliente; se puede deshacer'}>
              Aplicar
            </Boton>
            <Boton variante="secundario" tamano="sm" icono={FlaskConical} disabled={algoOcupado} cargando={ocupado === 'ensayar'} onClick={() => onEnsayar?.(p)} title="Recorre el camino de aplicar sin escribir nada en Amazon y lo deja en el log como ensayo">
              Ensayo
            </Boton>
            <Boton variante="fantasma" tamano="sm" icono={Ban} disabled={algoOcupado} cargando={ocupado === 'descartar'} onClick={() => onDescartar?.(p)} title="No se vuelve a proponer en 14 días" className="ml-auto">
              Descartar
            </Boton>
          </>
        )}
        {historial && p.estado === 'aplicada' && (
          <Boton variante="secundario" tamano="sm" icono={Undo2} disabled={algoOcupado} cargando={ocupado === 'deshacer'} onClick={() => onDeshacer?.(p)}>
            Deshacer en Amazon
          </Boton>
        )}
        {historial && p.resueltaAt && <span className="ml-auto text-[11.5px] text-[var(--ls-t4)]">{new Date(p.resueltaAt).toLocaleString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
      </div>
    </article>
  )
})

function Cifra({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0 rounded-[10px] bg-[var(--ls-sup2)] px-2 py-[6px]">
      <dt className="truncate text-[10.5px] font-medium uppercase tracking-[0.04em] text-[var(--ls-t4)]" title={etiqueta}>
        {etiqueta}
      </dt>
      <dd className="truncate text-[13px] font-semibold tabular-nums text-[var(--ls-t1)]">{valor}</dd>
    </div>
  )
}
