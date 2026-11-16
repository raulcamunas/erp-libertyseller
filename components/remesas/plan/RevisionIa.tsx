'use client'

import { useState } from 'react'
import { Check, ChevronDown, ChevronRight, Copy, Sparkles, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { Boton, Insignia } from '@/components/ui-ls'
import { haceCuanto } from '@/components/ui-ls/utilidades'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { AjusteIa, RevisionIa as TipoRevisionIa } from '@/lib/fba/plan-tipos'
import { decimal, entero } from '../comun/estilo-plan'
import { cx } from '../comun/ui'

/**
 * LA REVISIÓN DE LA IA DE UN ENVÍO PROPUESTO (spec remesas-pro §3, §1.5 punto 4 y §9).
 *
 * La IA revisa y explica; NUNCA decide cifras. Aquí se ve:
 *   · resumen, avisos (alta / media / info) y «Revisado por la IA hace 2 h · 0,2 céntimos»;
 *   · los ajustes VÁLIDOS con la cifra recalculada por la aritmética («93 → 112 ud») y «Aplicar» (el servidor vuelve
 *     a recalcular: la aritmética es la autoridad); los ya aplicados salen marcados;
 *   · los rechazados, plegados, con su motivo;
 *   · el mensaje para el cliente con «Copiar» y la nota para el equipo;
 *   · si la IA no llegó: «La revisión de la IA no ha llegado (motivo); el plan es solo aritmética».
 * «Revisar con IA» la pide otra vez (como mucho 2 a mano por cliente y día; el 429 lo explica quien llama).
 *
 * API
 *   <RevisionIa revision ajustesAplicados puedeEditar revisando? aplicando? onRevisar? onAplicar? />
 *     onAplicar(ajuste: AjusteIa) → Promise<unknown>   (se le pasa el ajuste SIN `recalculo`)
 *
 * Puro (con prueba en plan.prueba.ts):
 *   textoAjuste(ajuste) · claveAjuste(ajuste) · yaAplicado(ajuste, aplicados) · costeEnTexto(usd) · ajusteSinRecalculo(a)
 */

type AjusteValido = TipoRevisionIa['ajustesValidos'][number]

/* ------------------------------------------------------------------ */
/* Puro                                                                */
/* ------------------------------------------------------------------ */

/** «Ritmo ×1,2», «Sacarla del envío», «Que salga 3 días antes» */
export function textoAjuste(a: Pick<AjusteIa, 'tipo'> & { valor?: number | null; dias?: number }): string {
  if (a.tipo === 'factor_ritmo') return `Ritmo ×${decimal(a.valor ?? 1, 2)}`
  if (a.tipo === 'excluir') return 'Sacarla del envío'
  const d = Math.round(a.dias ?? a.valor ?? 0)
  if (d === 0) return 'Mover la salida'
  return `Que salga ${Math.abs(d)} ${Math.abs(d) === 1 ? 'día' : 'días'} ${d < 0 ? 'antes' : 'después'}`
}

/** Identifica un ajuste (un ajuste por SKU como mucho, pero por si acaso el tipo y el valor también) */
export function claveAjuste(a: AjusteIa): string {
  if (a.tipo === 'factor_ritmo') return `${a.sku}|factor|${a.valor}`
  if (a.tipo === 'mover_envio') return `${a.sku}|mover|${a.dias}`
  return `${a.sku}|excluir`
}

export function yaAplicado(a: AjusteIa, aplicados: readonly AjusteIa[] | null | undefined): boolean {
  if (!aplicados?.length) return false
  const k = claveAjuste(a)
  return aplicados.some((x) => claveAjuste(x) === k)
}

/** El ajuste tal y como lo pide el PATCH (sin la cifra recalculada, que es de la pantalla) */
export function ajusteSinRecalculo(a: AjusteValido): AjusteIa {
  if (a.tipo === 'factor_ritmo') return { tipo: 'factor_ritmo', sku: a.sku, valor: a.valor, motivo: a.motivo }
  if (a.tipo === 'mover_envio') return { tipo: 'mover_envio', sku: a.sku, dias: a.dias, motivo: a.motivo }
  return { tipo: 'excluir', sku: a.sku, motivo: a.motivo }
}

/** El coste en céntimos de dólar: «0,2 céntimos»; menos de una milésima de céntimo, «menos de 0,01 céntimos» */
export function costeEnTexto(usd: number | null | undefined): string | null {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return null
  const c = usd * 100
  if (c < 0.01) return 'menos de 0,01 céntimos'
  return `${decimal(c, c < 1 ? 2 : 1)} céntimos`
}

/* ------------------------------------------------------------------ */
/* Pantalla                                                            */
/* ------------------------------------------------------------------ */

const GRAVEDAD = {
  alta: { tono: 'rojo', texto: 'Importante' },
  media: { tono: 'ambar', texto: 'Ojo' },
  info: { tono: 'gris', texto: 'Para saber' },
} as const

async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}

function BloqueMensaje({ titulo, texto, copiable }: { titulo: string; texto: string; copiable?: boolean }) {
  const [copiado, setCopiado] = useState(false)
  if (!texto.trim()) return null
  return (
    <div className="min-w-0 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] p-3">
      <div className="mb-[6px] flex items-center justify-between gap-2">
        <p className="text-[11px] uppercase tracking-[0.06em] text-[var(--ls-t4)]">{titulo}</p>
        {copiable && (
          <Boton
            tamano="sm"
            variante="fantasma"
            icono={copiado ? Check : Copy}
            onClick={async () => {
              if (await copiar(texto)) {
                setCopiado(true)
                toast.success('Mensaje copiado')
                window.setTimeout(() => setCopiado(false), 2000)
              } else toast.error('No se ha podido copiar: selecciónalo a mano')
            }}
          >
            {copiado ? 'Copiado' : 'Copiar el mensaje'}
          </Boton>
        )}
      </div>
      <p className="whitespace-pre-wrap break-words text-[12.5px] leading-[1.55] text-[var(--ls-t2)]">{texto}</p>
    </div>
  )
}

export interface RevisionIaProps {
  revision: TipoRevisionIa | null
  ajustesAplicados: readonly AjusteIa[]
  puedeEditar: boolean
  revisando?: boolean
  /** SKU del ajuste que se está aplicando */
  aplicando?: string | null
  onRevisar?: () => void
  onAplicar?: (ajuste: AjusteIa) => Promise<unknown> | void
  moneda?: string
}

export function RevisionIa({ revision: r, ajustesAplicados, puedeEditar, revisando = false, aplicando = null, onRevisar, onAplicar }: RevisionIaProps) {
  const [verRechazados, setVerRechazados] = useState(false)

  const botonRevisar =
    puedeEditar && onRevisar ? (
      <Boton tamano="sm" variante="secundario" icono={Sparkles} cargando={revisando} onClick={onRevisar}>
        {r ? 'Revisar otra vez' : 'Revisar con IA'}
      </Boton>
    ) : null

  if (!r) {
    return (
      <div className="flex min-w-0 flex-col items-start gap-2 rounded-[10px] border border-dashed border-[var(--ls-linea2)] px-3 py-3">
        <p className="text-[12.5px] leading-[1.5] text-[var(--ls-t3)]">
          La IA todavía no ha revisado este plan. Revisa incoherencias (ritmos que no cuadran, tallas sueltas, envíos pequeños con rotura cerca), sugiere ajustes acotados y redacta el mensaje para el cliente. Las cifras las sigue poniendo la aritmética.
        </p>
        {botonRevisar}
      </div>
    )
  }

  const coste = costeEnTexto(r.costeUsd)
  const pie = [`Revisado por la IA ${haceCuanto(new Date(r.creadoAt))}`, coste].filter(Boolean).join(' · ')

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <p className="text-[11.5px] text-[var(--ls-t4)]" title={r.modelo ? `Modelo: ${r.modelo}` : undefined}>
          {pie}
        </p>
        {botonRevisar}
      </div>

      {r.aviso && (
        <p className="rounded-[9px] px-3 py-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]" style={{ background: `color-mix(in srgb, ${COLOR_ESTADO.ambar} 10%, transparent)` }}>
          La revisión de la IA no ha llegado ({r.aviso.replace(/\.$/, '')}); el plan es solo aritmética.
        </p>
      )}

      {r.resumen && <p className="text-[13px] leading-[1.55] text-[var(--ls-t1)]">{r.resumen}</p>}

      {r.avisos.length > 0 && (
        <ul className="space-y-[6px]">
          {r.avisos.map((a, i) => {
            const g = GRAVEDAD[a.gravedad] ?? GRAVEDAD.info
            return (
              <li key={i} className="flex min-w-0 items-start gap-2 text-[12.5px] leading-[1.5] text-[var(--ls-t2)]">
                <Insignia tono={g.tono} tamano="sm" variante={a.gravedad === 'alta' ? 'solida' : 'suave'} className="mt-[1px] shrink-0">
                  {g.texto}
                </Insignia>
                <span className="min-w-0">
                  {a.sku && <span className="mr-1 font-mono text-[12px] text-[var(--ls-t1)]">{a.sku}</span>}
                  {a.texto}
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {r.ajustesValidos.length > 0 && (
        <div className="min-w-0">
          <p className="mb-[6px] flex items-center gap-[6px] text-[12.5px] font-medium text-[var(--ls-t1)]">
            <Wand2 className="h-[13px] w-[13px]" aria-hidden /> Ajustes que sugiere
          </p>
          <ul className="space-y-2">
            {r.ajustesValidos.map((a, i) => {
              const hecho = yaAplicado(ajusteSinRecalculo(a), ajustesAplicados)
              const cambia = a.recalculo.despues - a.recalculo.antes
              return (
                <li key={`${a.sku}-${i}`} className={cx('min-w-0 rounded-[10px] border p-3', hecho ? 'border-[var(--ls-linea)] opacity-80' : 'border-[var(--ls-linea2)] bg-[var(--ls-sup2)]')}>
                  <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[12.5px] text-[var(--ls-t1)]">
                        <span className="font-mono font-semibold">{a.sku}</span> · {textoAjuste(a)}
                      </p>
                      <p className="mt-[2px] text-[13px] tabular-nums text-[var(--ls-t2)]">
                        {entero(a.recalculo.antes)} ud → <b className="font-semibold text-[var(--ls-t1)]">{entero(a.recalculo.despues)} ud</b>
                        <span className="ml-1 text-[11.5px]" style={{ color: cambia > 0 ? COLOR_ESTADO.naranja : cambia < 0 ? COLOR_ESTADO.azul : undefined }}>
                          ({cambia > 0 ? '+' : ''}
                          {entero(cambia)})
                        </span>
                      </p>
                    </div>
                    {hecho ? (
                      <Insignia tono="verde" tamano="sm" icono={Check}>
                        Aplicado
                      </Insignia>
                    ) : puedeEditar && onAplicar ? (
                      <Boton tamano="sm" variante="secundario" cargando={aplicando === a.sku} disabled={aplicando !== null} onClick={() => void onAplicar(ajusteSinRecalculo(a))}>
                        Aplicar
                      </Boton>
                    ) : null}
                  </div>
                  {a.motivo && <p className="mt-[6px] text-[12px] leading-[1.45] text-[var(--ls-t3)]">{a.motivo}</p>}
                </li>
              )
            })}
          </ul>
          <p className="mt-[6px] text-[11px] text-[var(--ls-t4)]">Al aplicar, el servidor vuelve a calcular la cantidad con la aritmética del plan: la cifra puede variar algo.</p>
        </div>
      )}

      {r.ajustesRechazados.length > 0 && (
        <div className="min-w-0">
          <button
            type="button"
            onClick={() => setVerRechazados((v) => !v)}
            aria-expanded={verRechazados}
            className="flex min-h-[32px] items-center gap-[6px] rounded-[8px] px-1 text-[12px] text-[var(--ls-t3)] outline-none hover:text-[var(--ls-t1)] focus-visible:ring-2 focus-visible:ring-[var(--ls-acc-graf)] [@media(pointer:coarse)]:min-h-[44px]"
          >
            {verRechazados ? <ChevronDown className="h-[14px] w-[14px]" aria-hidden /> : <ChevronRight className="h-[14px] w-[14px]" aria-hidden />}
            {r.ajustesRechazados.length} {r.ajustesRechazados.length === 1 ? 'sugerencia descartada' : 'sugerencias descartadas'} por no cuadrar con el plan
          </button>
          {verRechazados && (
            <ul className="mt-1 space-y-[4px] pl-5 text-[12px] leading-[1.45] text-[var(--ls-t3)]">
              {r.ajustesRechazados.map((x, i) => (
                <li key={i}>
                  <span className="font-mono text-[var(--ls-t2)]">{x.ajuste.sku}</span> · {textoAjuste(x.ajuste)}: {x.motivo}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <BloqueMensaje titulo="Mensaje para el cliente" texto={r.mensajeCliente} copiable />
      <BloqueMensaje titulo="Nota para el equipo" texto={r.mensajeEquipo} />
    </div>
  )
}
