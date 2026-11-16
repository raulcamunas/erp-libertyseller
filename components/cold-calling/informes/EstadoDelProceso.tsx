'use client'

import { Activity, AlertTriangle, Clock, Coins, Zap } from 'lucide-react'
import { Area, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { COSTE_DE_TIPO } from '@/lib/analisis-amazon/turnos'
import { BarraDeProgreso, Insignia, Tarjeta, haceCuanto } from '@/components/ui-ls'
import type { TonoEstado } from '@/lib/estilo/denso'
import { cuandoCorto, entero, soloHora, type EstadoDelProceso as Estado, type PanelDeInformes } from './tipos'

/** Cómo va el proceso que hace los informes (el cron `analisis-keepa`): si trabaja, por qué espera y el saldo de Keepa de las últimas 48 h */

const ESTADO: Record<Estado, { texto: string; tono: TonoEstado; vivo: boolean }> = {
  trabajando: { texto: 'Trabajando', tono: 'verde', vivo: true },
  esperando_saldo: { texto: 'Esperando saldo', tono: 'cian', vivo: true },
  parado: { texto: 'Parado', tono: 'rojo', vivo: false },
  falla: { texto: 'Falla', tono: 'rojo', vivo: false },
  apagado: { texto: 'Apagado desde Sistema', tono: 'gris', vivo: false },
  cola_terminada: { texto: 'Cola terminada', tono: 'violeta', vivo: false },
}

function Dato({ icono: Icono, rotulo, valor }: { icono: typeof Clock; rotulo: string; valor: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-[var(--ls-sup2)] text-[var(--ls-t3)]">
        <Icono className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="truncate text-[11px] text-[var(--ls-t4)]">{rotulo}</div>
        <div className="truncate text-[13px] font-medium text-[var(--ls-t1)] tabular-nums">{valor}</div>
      </div>
    </div>
  )
}

export function EstadoDelProceso({ proceso, saldo, ahora, indice }: { proceso: PanelDeInformes['proceso']; saldo: PanelDeInformes['saldo']; ahora: number; indice?: number }) {
  const e = ESTADO[proceso.estado]
  // Banda mínimo–máximo de cada media hora y la media encima (punto a punto, en dientes de sierra, era un código de barras)
  const datos = saldo.map((p) => ({ t: p.at, rango: [p.min, p.max] as [number, number], media: p.media, min: p.min, max: p.max, pasadas: p.pasadas }))
  const techo = Math.max(COSTE_DE_TIPO.sin + 20, ...saldo.map((p) => p.max))
  const llega = proceso.saldo != null && proceso.umbral != null ? Math.max(0, Math.min(1, proceso.saldo / proceso.umbral)) : null

  return (
    <Tarjeta
      variante="destacada"
      acento="marca"
      indice={indice}
      icono={Activity}
      titulo="El proceso que hace los informes"
      subtitulo="Pasa cada minuto y hace una tienda cuando Keepa tiene saldo para ella entera"
      acciones={
        <Insignia tono={e.tono} vivo={e.vivo}>
          {e.texto}
        </Insignia>
      }
    >
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <div className="flex min-w-0 flex-col gap-4">
          <p className="text-[13.5px] leading-snug text-[var(--ls-t2)]">{proceso.motivo}</p>

          {llega != null && (
            <BarraDeProgreso
              valor={llega}
              acento="marca"
              etiqueta="Saldo de Keepa para la siguiente tienda"
              detalle={`${entero(proceso.saldo ?? 0)} / ${entero(proceso.umbral ?? 0)} tokens`}
            />
          )}

          <div className="grid grid-cols-2 gap-3">
            <Dato icono={Clock} rotulo="Última pasada" valor={proceso.ultimaPasadaAt ? `${haceCuanto(proceso.ultimaPasadaAt, ahora)} · ${soloHora(proceso.ultimaPasadaAt)}` : '—'} />
            <Dato
              icono={Zap}
              rotulo="Siguiente tienda"
              valor={proceso.estado === 'trabajando' ? 'Ahora' : proceso.minutosParaSiguiente == null ? '—' : proceso.minutosParaSiguiente === 0 ? 'En la próxima pasada' : `En unos ${proceso.minutosParaSiguiente} min`}
            />
            <Dato icono={Coins} rotulo="Keepa recarga" valor={proceso.ritmoKeepa != null ? `${entero(proceso.ritmoKeepa)} tokens/min` : '—'} />
            <Dato icono={Activity} rotulo="Últimas 24 h" valor={`${entero(proceso.pasadas24h)} pasadas · ${entero(proceso.fallos24h)} ${proceso.fallos24h === 1 ? 'fallo' : 'fallos'}`} />
          </div>

          {proceso.ultimoError && (
            <div className="flex items-start gap-2 rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[12px] text-[var(--ls-t3)]">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--ls-e-ambar)]" aria-hidden />
              <span className="min-w-0 break-words">
                <span className="font-medium text-[var(--ls-t2)]">Último fallo, {cuandoCorto(proceso.ultimoError.at)}:</span> {proceso.ultimoError.texto}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-[12px] font-medium text-[var(--ls-t3)]">Saldo de Keepa · 48 h, por media hora</span>
            <span className="flex items-center gap-3 text-[11px] text-[var(--ls-t4)]">
              <span className="flex items-center gap-1" title="Entre el mínimo y el máximo de cada media hora">
                <span className="h-2.5 w-3 rounded-[3px]" style={{ background: 'var(--viz-1)', opacity: 0.3 }} /> mín–máx
              </span>
              <span className="flex items-center gap-1">
                <span className="h-[2px] w-3" style={{ background: 'var(--viz-1)' }} /> media
              </span>
              <span className="flex items-center gap-1" title={`Lo que hace falta para empezar una tienda: ${COSTE_DE_TIPO.amazon} (Amazon) o ${COSTE_DE_TIPO.sin} (sin Amazon)`}>
                <span className="w-3 border-t border-dashed" style={{ borderColor: 'var(--ls-t4)' }} /> hace falta
              </span>
            </span>
          </div>
          {datos.length < 2 ? (
            <p className="py-10 text-center text-[12px] text-[var(--ls-t4)]">Aún no hay pasadas con saldo en las últimas 48 horas.</p>
          ) : (
            <div className="h-[170px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={datos} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
                  <XAxis dataKey="t" tickFormatter={soloHora} tick={{ fill: 'var(--ls-t4)', fontSize: 10.5 }} tickLine={false} axisLine={false} minTickGap={40} />
                  <YAxis domain={[0, techo]} tick={{ fill: 'var(--ls-t4)', fontSize: 10.5 }} tickLine={false} axisLine={false} width={44} />
                  <Tooltip
                    contentStyle={{ background: 'var(--ls-sup2)', border: '1px solid var(--ls-linea2)', borderRadius: 10, boxShadow: 'var(--ls-sombra-2)', fontSize: 12 }}
                    labelStyle={{ color: 'var(--ls-t3)' }}
                    itemStyle={{ color: 'var(--ls-t1)' }}
                    labelFormatter={(v) => `Desde las ${soloHora(String(v))} (media hora)`}
                    formatter={(v, n, item) => {
                      const p = (item as { payload?: (typeof datos)[number] }).payload
                      if (n === 'rango' && p) return [`${entero(p.min)} – ${entero(p.max)}`, `Mín–máx (${p.pasadas} ${p.pasadas === 1 ? 'pasada' : 'pasadas'})`]
                      return [entero(Number(v)), 'Media']
                    }}
                    cursor={{ stroke: 'var(--ls-linea2)' }}
                  />
                  <ReferenceLine y={COSTE_DE_TIPO.amazon} stroke="var(--ls-t4)" strokeDasharray="4 4" strokeWidth={1} ifOverflow="extendDomain" />
                  <ReferenceLine y={COSTE_DE_TIPO.sin} stroke="var(--ls-t4)" strokeDasharray="4 4" strokeWidth={1} ifOverflow="extendDomain" />
                  <Area type="monotone" dataKey="rango" stroke="none" fill="var(--viz-1)" fillOpacity={0.22} isAnimationActive={false} />
                  <Line type="monotone" dataKey="media" stroke="var(--viz-1)" strokeWidth={1.8} dot={false} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>
    </Tarjeta>
  )
}
