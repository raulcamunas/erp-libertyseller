'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, Search } from 'lucide-react'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { CAJA, Segmentado } from '@/components/marketing-test/piezas'
import { ROTULO_TEMA, type Gravedad } from '@/lib/cumplimiento/tipos'
import type { PanelDeCumplimiento } from '@/lib/cumplimiento/panel-calculo'
import { COLOR_GRAVEDAD, ColorDeGravedad, TEXTO_GRAVEDAD, haceTiempo } from './comun'

type PanelOk = Extract<PanelDeCumplimiento, { ok: true }>
const cifra = (v: number) => v.toLocaleString('es-ES')

/**
 * LAS INCIDENCIAS AGRUPADAS POR LO QUE DICE AMAZON: el mismo aviso en diez mil listings es una sola línea, con cuántos tiene, cuántos con stock y a cuántos está ocultando. Es por dónde se empieza a
 * arreglar: una plantilla corregida quita miles de golpe. Pulsar una abre la lista de esos listings.
 */
export function PestanaIncidencias({ panel, verCodigo }: { panel: PanelOk; verCodigo: (codigo: string) => void }) {
  const [gravedad, setGravedad] = useState<'todas' | Gravedad>('todas')
  const [q, setQ] = useState('')
  const [abierta, setAbierta] = useState<string | null>(null)
  const lista = useMemo(() => {
    const b = q.trim().toLowerCase()
    return panel.codigos.filter((k) => (gravedad === 'todas' || k.gravedad === gravedad) && (!b || k.mensaje.toLowerCase().includes(b) || k.codigo.includes(b) || ROTULO_TEMA[k.tema].corto.toLowerCase().includes(b)))
  }, [panel.codigos, gravedad, q])
  const cuenta = (g: Gravedad) => panel.codigos.filter((k) => k.gravedad === g).length

  return (
    <div className="flex max-w-[1240px] flex-col gap-3 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <Segmentado
          etiqueta="Gravedad"
          opciones={[
            { id: 'todas', texto: 'Todas', cuenta: panel.codigos.length },
            { id: 'error', texto: 'Errores', cuenta: cuenta('error') },
            { id: 'aviso', texto: 'Avisos', cuenta: cuenta('aviso') },
          ]}
          valor={gravedad}
          cambiar={(v) => setGravedad(v as 'todas' | Gravedad)}
        />
        <label className="relative ml-auto">
          <span className="sr-only">Buscar en las incidencias</span>
          <Search className="pointer-events-none absolute left-[10px] top-[9px] h-[13px] w-[13px] text-[var(--ls-t4)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar en el mensaje o el código" className="h-[30px] w-[260px] rounded-[9px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] pl-[30px] pr-2 text-[12.5px] text-[var(--ls-t1)] outline-none placeholder:text-[var(--ls-t4)] focus:border-[var(--ls-acc-graf)]" />
        </label>
      </div>

      <section className={CAJA.base}>
        {lista.length === 0 ? (
          <p className={`${CAJA.cuerpo} text-[12.5px] text-[var(--ls-t3)]`}>{panel.codigos.length === 0 ? 'Amazon no ha puesto ninguna incidencia a los listings revisados.' : 'Ninguna incidencia con ese filtro.'}</p>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--ls-linea)]">
            <div className="hidden grid-cols-[minmax(0,1fr)_96px_96px_96px_120px] gap-3 bg-[var(--ls-sup2)] px-4 py-[8px] text-[11px] font-semibold text-[var(--ls-t4)] md:grid">
              <span>Lo que dice Amazon</span>
              <span className="text-right">Listings</span>
              <span className="text-right">Con stock</span>
              <span className="text-right">Los oculta</span>
              <span />
            </div>
            {lista.map((k) => {
              const ab = abierta === k.codigo
              return (
                <div key={k.codigo} className="grid grid-cols-1 gap-x-3 gap-y-2 px-4 py-[11px] md:grid-cols-[minmax(0,1fr)_96px_96px_96px_120px] md:items-start">
                  <div className="flex min-w-0 items-start gap-3">
                    <ColorDeGravedad gravedad={k.gravedad} />
                    <div className="min-w-0">
                      <button type="button" onClick={() => setAbierta(ab ? null : k.codigo)} className={`text-left text-[12.5px] leading-[1.5] text-[var(--ls-t1)] ${ab ? '' : 'line-clamp-2'}`} title={ab ? 'Ver menos' : 'Ver el mensaje entero'}>
                        {k.mensaje || `Incidencia ${k.codigo}`}
                      </button>
                      <div className="mt-[3px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--ls-t4)]">
                        <span className="rounded-[5px] px-[6px] py-[1px] font-semibold" style={{ color: COLOR_GRAVEDAD[k.gravedad], background: `color-mix(in srgb, ${COLOR_GRAVEDAD[k.gravedad]} 12%, transparent)` }}>{TEXTO_GRAVEDAD[k.gravedad]}</span>
                        <span>{ROTULO_TEMA[k.tema].corto}</span>
                        <span>· código {k.codigo}</span>
                        {k.desde && <span>· la primera, {haceTiempo(k.desde)}</span>}
                      </div>
                    </div>
                  </div>
                  <span className="text-[13px] font-semibold tabular-nums text-[var(--ls-t1)] md:text-right"><span className="text-[11px] font-normal text-[var(--ls-t4)] md:hidden">Listings </span>{cifra(k.listings)}</span>
                  <span className="text-[12.5px] tabular-nums text-[var(--ls-t2)] md:text-right"><span className="text-[11px] text-[var(--ls-t4)] md:hidden">Con stock </span>{cifra(k.conStock)}</span>
                  <span className="text-[12.5px] tabular-nums md:text-right" style={{ color: k.ocultan > 0 ? COLOR_ESTADO.rojo : 'var(--ls-t4)' }}><span className="text-[11px] text-[var(--ls-t4)] md:hidden">Los oculta </span>{cifra(k.ocultan)}</span>
                  <button type="button" onClick={() => verCodigo(k.codigo)} className="inline-flex h-[28px] items-center justify-center gap-1 justify-self-start rounded-[8px] border border-[var(--ls-linea)] px-[10px] text-[12px] font-medium text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-linea2)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] md:justify-self-end">
                    Ver listings <ArrowRight className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        )}
      </section>
      <p className="text-[11px] text-[var(--ls-t4)]">Agrupadas por el código de Amazon (las {cifra(panel.codigos.length)} más repetidas, errores primero). El mensaje es el que más se repite con ese código; en cada listing puede nombrar un dato distinto.</p>
    </div>
  )
}
