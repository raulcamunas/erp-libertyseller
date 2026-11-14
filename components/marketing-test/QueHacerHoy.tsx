'use client'

import { ArrowRight, CheckCircle2, CircleAlert, Info, ListTodo } from 'lucide-react'
import { COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import type { ResumenDeHoy, TareaDeHoy } from '@/lib/ads/hoy'
import { CAJA } from './piezas'
import { dinero } from './formato'

const TONO: Record<TareaDeHoy['prioridad'], string> = { alta: COLOR_ESTADO.rojo, media: COLOR_ESTADO.ambar, info: COLOR_ESTADO.azul }

/**
 * «QUÉ HACER HOY»: la primera tarjeta de Propuestas. Una lista corta, ordenada por lo que más bloquea o más dinero mueve, y cada tarea con su botón (filtra la lista, lleva a otra pestaña o pide los
 * términos). El administrativo empieza por arriba y no tiene que leer todas las propuestas para saber qué toca. La lógica está en lib/ads/hoy.ts (con pruebas).
 */
export function QueHacerHoy({ hoy, moneda, aplicadasHoy, topeManual, ir }: { hoy: ResumenDeHoy; moneda: string | null; aplicadasHoy: number; topeManual: number; ir: (t: TareaDeHoy) => void }) {
  const todoBien = hoy.tareas.length === 1 && hoy.tareas[0].id === 'al-dia'
  return (
    <section className={CAJA.base} aria-labelledby="que-hacer-hoy">
      <header className={`${CAJA.cabecera} flex-wrap justify-between`}>
        <h2 id="que-hacer-hoy" className={`${TITULO.seccion} flex items-center gap-2`}>
          <ListTodo className="h-4 w-4 text-[var(--ls-acc)]" /> Qué hacer hoy en esta cuenta
        </h2>
        <div className={`flex flex-wrap items-center gap-3 ${TIPO.s} ${TEXTO.t3}`}>
          {hoy.gastoSinVentaRecuperable > 0 && (
            <span title="Lo gastado sin un solo pedido por los términos y segmentaciones que se propone excluir o pausar, en su ventana de lectura">
              Gasto sin pedidos en juego: <strong className="tabular-nums" style={{ color: COLOR_ESTADO.rojo }}>{dinero(hoy.gastoSinVentaRecuperable, moneda)}</strong>
            </span>
          )}
          <span title="Freno contra un clic descontrolado: cambios que una persona puede aplicar al día en esta cuenta">
            Aplicados hoy: <strong className="tabular-nums text-[var(--ls-t1)]">{aplicadasHoy}</strong> de {topeManual}
          </span>
        </div>
      </header>
      {todoBien ? (
        <div className={`${CAJA.cuerpo} flex items-start gap-2`}>
          <CheckCircle2 className="mt-[1px] h-4 w-4 shrink-0" style={{ color: COLOR_ESTADO.verde }} />
          <div>
            <div className="text-[13px] font-semibold text-[var(--ls-t1)]">{hoy.tareas[0].titulo}</div>
            <p className={`${TIPO.s} ${TEXTO.t3}`}>{hoy.tareas[0].detalle}</p>
          </div>
        </div>
      ) : (
        <ol className="divide-y divide-[var(--ls-linea)]">
          {hoy.tareas.map((t, i) => (
            <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-[10px] sm:flex-nowrap">
              <span className="inline-flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums" style={{ background: `color-mix(in srgb, ${TONO[t.prioridad]} 16%, transparent)`, color: TONO[t.prioridad] }} aria-hidden>
                {t.prioridad === 'info' ? <Info className="h-3 w-3" /> : t.prioridad === 'alta' && t.id.startsWith('sin-') ? <CircleAlert className="h-3 w-3" /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold text-[var(--ls-t1)]">{t.titulo}</div>
                <p className={`${TIPO.s} ${TEXTO.t3}`}>{t.detalle}</p>
              </div>
              {t.ir && t.textoBoton && (
                <button type="button" onClick={() => ir(t)} className="inline-flex h-7 shrink-0 items-center gap-1 rounded-[8px] border border-[var(--ls-linea2)] px-[10px] text-[12px] font-medium text-[var(--ls-t1)] transition-colors hover:bg-[var(--ls-sup2)] focus-visible:outline-2 focus-visible:outline-[var(--ls-acc-graf)]">
                  {t.textoBoton} <ArrowRight className="h-3 w-3" />
                </button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
