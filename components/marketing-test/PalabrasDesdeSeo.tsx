'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, SearchCheck } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import type { DesdeSeo } from '@/lib/ads/desde-seo-servidor'
import type { MotivoDesdeSeo } from '@/lib/ads/desde-seo'
import { llamar } from './llamar'

/**
 * «DESDE SEO» en la tarjeta de un producto (Marketing Test → Campañas, al abrirla): las búsquedas de Brand Analytics que PPC puede aprovechar (lib/ads/desde-seo.ts), con por qué salen y qué
 * hacer. Solo lee. Las keywords se copian para pegarlas en la campaña EXACTA DOMINIO del producto.
 */

const MOTIVO: Record<MotivoDesdeSeo, { texto: string; color: string; pista: string }> = {
  infraexpuesta: { texto: 'Infraexpuesta', color: COLOR_ESTADO.violeta, pista: 'Convierte de sobra y sale poco: darle exposición con publicidad' },
  'te-compran': { texto: 'Te compran sin EXACTA', color: COLOR_ESTADO.verde, pista: 'Ya vende ahí y no tiene keyword EXACTA' },
  empujar: { texto: 'Empujar', color: COLOR_ESTADO.azul, pista: 'Ya está en el título y sigue saliendo poco' },
  'ataque-marca': { texto: 'Ataque de marca', color: COLOR_ESTADO.magenta, pista: 'Marca de la competencia: nunca en la ficha; solo en una campaña aparte de ataque de marca' },
}

const pct = (x: number | null) => (x == null ? '—' : `${(x * 100).toLocaleString('es-ES', { maximumFractionDigits: 1 })} %`)
const ent = (x: number | null) => (x == null ? '—' : Math.round(x).toLocaleString('es-ES'))

export function PalabrasDesdeSeo({ perfilId, asin }: { perfilId: string; asin: string }) {
  const [datos, setDatos] = useState<DesdeSeo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copiada, setCopiada] = useState<string | null>(null)

  useEffect(() => {
    let vivo = true
    setDatos(null)
    setError(null)
    llamar<DesdeSeo>(`/api/ads/cuenta/desde-seo?perfilId=${encodeURIComponent(perfilId)}&asin=${asin}`)
      .then((d) => vivo && setDatos(d))
      .catch((e) => vivo && setError(e instanceof Error ? e.message : 'No se ha podido leer SEO.'))
    return () => {
      vivo = false
    }
  }, [perfilId, asin])

  const copiar = (texto: string, clave: string) => {
    void navigator.clipboard?.writeText(texto).then(() => {
      setCopiada(clave)
      setTimeout(() => setCopiada((c) => (c === clave ? null : c)), 1500)
    })
  }

  const palabras = datos?.palabras ?? []
  const sinExacta = palabras.filter((p) => !p.enExacta && p.motivo !== 'ataque-marca').map((p) => p.consulta)

  return (
    <div className="border-t border-[var(--ls-linea)] px-4 py-3 md:pl-[60px]">
      <div className="flex flex-wrap items-center gap-2">
        <SearchCheck className="h-[14px] w-[14px]" style={{ color: COLOR_ESTADO.azul }} />
        <span className="text-[13px] font-semibold text-[var(--ls-t1)]">Desde SEO</span>
        <span className="text-[11.5px] text-[var(--ls-t4)]" title="En las cuentas con el agente en marcha, las que no tienen keyword EXACTA las mete él solo en la EXACTA del producto, con sus frenos de siempre">Búsquedas de Brand Analytics que la publicidad puede aprovechar (con el agente, se meten solas){datos?.periodo ? ` · ${datos.periodo === 'MONTH' ? 'último mes' : 'última semana'}` : ''}</span>
        {sinExacta.length > 1 && (
          <button type="button" onClick={() => copiar(sinExacta.join('\n'), '__todas')} className="ml-auto inline-flex items-center gap-1 rounded-[7px] border border-[var(--ls-linea)] px-2 py-[3px] text-[11.5px] font-medium text-[var(--ls-t2)] hover:text-[var(--ls-t1)]">
            {copiada === '__todas' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />} Copiar las {sinExacta.length} sin EXACTA
          </button>
        )}
      </div>
      {!datos && !error && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">Leyendo SEO…</p>}
      {error && <p className="mt-2 text-[12px]" style={{ color: COLOR_ESTADO.rojo }}>{error}</p>}
      {datos?.estado === 'sin-cuenta' && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">Este cliente no tiene la cuenta de vendedor conectada en este país: SEO no tiene datos.</p>}
      {datos?.estado === 'sin-busquedas' && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">Este producto no se sigue en SEO (o la cuenta no tiene Brand Analytics). Añádelo en SEO → Productos para tener sus búsquedas aquí.</p>}
      {datos?.estado === 'ok' && palabras.length === 0 && <p className="mt-2 text-[12px] text-[var(--ls-t4)]">SEO no ve ninguna búsqueda del producto que haya que empujar con publicidad: las que venden ya tienen su EXACTA.</p>}
      {palabras.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[640px] text-[12px]">
            <thead>
              <tr className="text-left text-[11px] text-[var(--ls-t4)]">
                <th className="py-1 pr-2 font-semibold">Búsqueda</th>
                <th className="py-1 pr-2 font-semibold">Por qué</th>
                <th className="py-1 pr-2 text-right font-semibold">Impr.</th>
                <th className="py-1 pr-2 text-right font-semibold">Compras</th>
                <th className="py-1 pr-2 text-right font-semibold">Mercado</th>
                <th className="py-1 font-semibold">Qué hacer</th>
              </tr>
            </thead>
            <tbody>
              {palabras.map((p) => {
                const m = MOTIVO[p.motivo]
                return (
                  <tr key={p.consulta} className="border-t border-[var(--ls-linea)] align-top">
                    <td className="py-[6px] pr-2">
                      <button type="button" onClick={() => copiar(p.consulta, p.consulta)} className="inline-flex items-center gap-1 text-left font-medium text-[var(--ls-t1)] hover:underline" title="Copiar">
                        {p.consulta}
                        {copiada === p.consulta ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0 opacity-40" />}
                      </button>
                      <div className="mt-[2px] flex flex-wrap gap-1 text-[10.5px] text-[var(--ls-t4)]">
                        {p.enExacta ? <span>ya en EXACTA</span> : p.enOtraConcordancia ? <span>en amplia/frase</span> : <span>sin keyword</span>}
                        {p.enTitulo && <span>· en el título</span>}
                      </div>
                    </td>
                    <td className="py-[6px] pr-2">
                      <span className="rounded-[5px] px-[6px] py-[1px] text-[11px] font-semibold" style={{ color: m.color, background: `color-mix(in srgb, ${m.color} 14%, transparent)` }} title={m.pista}>
                        {m.texto}
                      </span>
                      <div className="mt-1 max-w-[280px] text-[11.5px] leading-[1.4] text-[var(--ls-t3)]">{p.porque}</div>
                    </td>
                    <td className="py-[6px] pr-2 text-right tabular-nums text-[var(--ls-t2)]">{pct(p.cuotaImpresiones)}</td>
                    <td className="py-[6px] pr-2 text-right tabular-nums text-[var(--ls-t2)]">{pct(p.cuotaCompras)}</td>
                    <td className="py-[6px] pr-2 text-right tabular-nums text-[var(--ls-t3)]" title="Compras de todo Amazon en esa búsqueda">{ent(p.comprasMercado)}</td>
                    <td className="py-[6px] text-[11.5px] leading-[1.4] text-[var(--ls-t2)]">{p.accion}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {datos && datos.estado !== 'sin-cuenta' && datos.helium !== undefined && (
        <div className="mt-3 border-t border-[var(--ls-linea)] pt-3">
          <div className="flex flex-wrap items-center gap-2 text-[12.5px] font-semibold text-[var(--ls-t1)]">
            Helium 10
            <span className="text-[11.5px] font-normal text-[var(--ls-t4)]">
              {datos.helium
                ? `Cerebro del ${new Date(datos.helium.subidoAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' })} · ${datos.helium.palabras.toLocaleString('es-ES')} palabras · el mismo que usa SEO`
                : 'Sin Cerebro de este producto: súbelo en SEO → Helium 10 (o en Crear campañas) y sirve para los dos'}
            </span>
          </div>
          {datos.helium && datos.helium.candidatas.length > 0 && (
            <>
              <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">El agente las prueba solo en la campaña AMPLIA (en frase y con la puja de partida) porque tienen volumen, son del producto y no están en ninguna campaña. Si gastan sin vender, el motor las baja y las pausa.</p>
              <div className="mt-2 flex flex-wrap gap-[6px]">
                {datos.helium.candidatas.map((c) => (
                  <span key={c.keyword} className="inline-flex items-center gap-1 rounded-full border px-[9px] py-[2px] text-[11.5px]" style={{ borderColor: `color-mix(in srgb, ${COLOR_ESTADO.violeta} 40%, transparent)`, color: COLOR_ESTADO.violeta }} title={c.rangoOrganico ? `Posición orgánica ${c.rangoOrganico}` : 'No aparece en el orgánico'}>
                    {c.keyword} <span className="tabular-nums opacity-70">{(c.volumen ?? 0).toLocaleString('es-ES')}</span>
                  </span>
                ))}
              </div>
            </>
          )}
          {datos.helium && datos.helium.candidatas.length === 0 && <p className="mt-1 text-[11.5px] text-[var(--ls-t4)]">Las palabras con volumen del Cerebro ya están en las campañas (o son de otro producto o de una marca de la competencia).</p>}
        </div>
      )}
    </div>
  )
}
