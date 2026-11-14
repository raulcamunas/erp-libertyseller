'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CircleAlert, FileUp, Sparkles } from 'lucide-react'
import { AVISO, BOTON, COLOR_ESTADO, TEXTO, TIPO, TITULO } from '@/lib/estilo/denso'
import { leerCerebro, leerGrabber, type FilaCerebro, type FilaGrabber } from '@/lib/ads/helium10'
import { NOMBRE_DESTINO, type DestinoDeSemilla, type Semilla } from '@/lib/ads/semillas'
import type { ResultadoDeAplicar } from '@/lib/ads/semillas-servidor'
import { CAJA as TARJETA } from './piezas'
import { fmt, llamar } from './llamar'

const ORDEN: DestinoDeSemilla[] = ['exacta', 'frase', 'asin', 'negativa', 'negativa-asin']
const FUENTE: Record<Semilla['fuente'], string> = { terminos: 'Tus términos', busquedas: 'Brand Analytics', competencia: 'Competencia', cerebro: 'Cerebro', grabber: 'ASIN Grabber' }

/**
 * CON QUÉ ARRANCAN LAS CAMPAÑAS DE UN PRODUCTO: palabras de frase y exactas, productos a atacar y negativas (lib/ads/semillas.ts). Lo propone el ERP con los
 * datos de la cuenta y, si se suben, con los CSV de Helium 10 (Cerebro lo clasifica la IA leyendo la ficha). Se revisa, se desmarca lo que no convenza y se aplica
 * en las 4 campañas de la estructura del producto. Va antes de activar las campañas: las negativas, sobre todo.
 */
export function PanelDeSemillas({ perfilId, productoId, pujaBase, moneda }: { perfilId: string; productoId: string; pujaBase: number; moneda: string | null }) {
  const [cerebro, setCerebro] = useState<{ nombre: string; filas: FilaCerebro[] } | null>(null)
  const [grabber, setGrabber] = useState<{ nombre: string; filas: FilaGrabber[] } | null>(null)
  const [propuesta, setPropuesta] = useState<{ semillas: Semilla[]; fuentes: Array<{ fuente: string; estado: string; detalle: string }> } | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [ocupado, setOcupado] = useState<'proponer' | 'aplicar' | null>(null)
  const [resultado, setResultado] = useState<ResultadoDeAplicar | null>(null)

  async function subir(f: File | undefined, cual: 'cerebro' | 'grabber') {
    if (!f) return
    const texto = await f.text()
    const r = cual === 'cerebro' ? leerCerebro(texto) : leerGrabber(texto)
    if (!r.ok) return toast.error(r.error)
    if (cual === 'cerebro') setCerebro({ nombre: f.name, filas: r.filas as FilaCerebro[] })
    else setGrabber({ nombre: f.name, filas: r.filas as FilaGrabber[] })
    setPropuesta(null)
    toast.success(`${f.name}: ${r.filas.length} ${cual === 'cerebro' ? 'keywords' : 'productos'} leídos.`)
  }

  async function proponer() {
    setOcupado('proponer')
    setResultado(null)
    try {
      const r = await llamar<{ semillas: Semilla[]; fuentes: Array<{ fuente: string; estado: string; detalle: string }> }>('/api/ads/cuenta/semillas', {
        metodo: 'POST',
        cuerpo: { perfilId, productoId, accion: 'proponer', pujaBase, cerebro: cerebro?.filas, grabber: grabber?.filas },
      })
      setPropuesta(r)
      setMarcadas(new Set(r.semillas.map((s) => s.id)))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido preparar la propuesta.')
    } finally {
      setOcupado(null)
    }
  }

  const elegidas = useMemo(() => (propuesta?.semillas ?? []).filter((s) => marcadas.has(s.id)), [propuesta, marcadas])

  async function aplicar() {
    if (elegidas.length === 0) return
    const n = (d: DestinoDeSemilla) => elegidas.filter((s) => s.destino === d).length
    const ok = window.confirm(
      `Se van a crear en la cuenta de Amazon Ads del cliente: ${n('exacta')} exactas, ${n('frase')} de frase, ${n('asin')} productos a atacar, ${n('negativa')} negativas y ${n('negativa-asin')} productos excluidos, en las campañas de este producto.\n\nSi las campañas están pausadas, no gastan hasta que las actives. ¿Seguimos?`
    )
    if (!ok) return
    setOcupado('aplicar')
    try {
      const r = await llamar<ResultadoDeAplicar>('/api/ads/cuenta/semillas', { metodo: 'POST', cuerpo: { perfilId, productoId, accion: 'aplicar', semillas: elegidas } })
      setResultado(r)
      if (r.fallos.length === 0) toast.success(`${r.hechas} cambios hechos en Amazon.`)
      else toast.error(`${r.hechas} hechos y ${r.fallos.length} con error: mira el detalle.`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido aplicar.')
    } finally {
      setOcupado(null)
    }
  }

  const alternar = (id: string) => setMarcadas((m) => {
    const n = new Set(m)
    if (n.has(id)) n.delete(id)
    else n.add(id)
    return n
  })
  const alternarGrupo = (d: DestinoDeSemilla, si: boolean) => setMarcadas((m) => {
    const n = new Set(m)
    for (const s of propuesta?.semillas ?? []) if (s.destino === d) (si ? n.add(s.id) : n.delete(s.id))
    return n
  })

  return (
    <section className={TARJETA.base}>
      <header className={TARJETA.cabecera}>
        <h2 className={TITULO.seccion}>3 · Palabras, productos a atacar y negativas</h2>
      </header>
      <div className={`${TARJETA.cuerpo} flex flex-col gap-3`}>
        <p className={`${TIPO.s} ${TEXTO.t2}`}>
          Con qué arrancan las campañas del producto. El ERP lo propone con tus términos de búsqueda y con Brand Analytics; si subes los CSV de Helium 10, la IA clasifica las keywords de Cerebro leyendo la ficha y el ASIN Grabber dice a qué competencia atacar. Revisa la lista, desmarca lo que no sea del producto y aplícalo <strong>antes de activar</strong> las campañas.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className={`${BOTON.base} ${BOTON.secundario} cursor-pointer`}>
            <FileUp className="h-3 w-3" /> {cerebro ? `Cerebro: ${cerebro.filas.length}` : 'Subir Cerebro (CSV)'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void subir(e.target.files?.[0], 'cerebro')} />
          </label>
          <label className={`${BOTON.base} ${BOTON.secundario} cursor-pointer`}>
            <FileUp className="h-3 w-3" /> {grabber ? `ASIN Grabber: ${grabber.filas.length}` : 'Subir ASIN Grabber (CSV)'}
            <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void subir(e.target.files?.[0], 'grabber')} />
          </label>
          <button type="button" disabled={ocupado !== null} onClick={proponer} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>
            <Sparkles className="h-3 w-3" /> {ocupado === 'proponer' ? (cerebro ? 'Leyendo y clasificando (hasta un minuto)…' : 'Leyendo la cuenta…') : propuesta ? 'Volver a proponer' : 'Proponer'}
          </button>
          <span className={`${TIPO.xs} ${TEXTO.t4}`}>Puja de partida: {fmt(pujaBase)} {moneda ?? ''} (la de Cerebro, si la trae)</span>
        </div>

        {propuesta && (
          <>
            <ul className="flex flex-col gap-[3px]">
              {propuesta.fuentes.map((f) => (
                <li key={f.fuente} className={`${TIPO.xs} ${TEXTO.t3}`}>
                  <span style={{ color: f.estado === 'ok' ? COLOR_ESTADO.verde : f.estado === 'error' ? COLOR_ESTADO.rojo : COLOR_ESTADO.ambar }}>●</span> <strong className={TEXTO.t2}>{f.fuente}</strong>: {f.detalle}
                </li>
              ))}
            </ul>
            {propuesta.semillas.length === 0 ? (
              <p className={`${TIPO.s} ${TEXTO.t3}`}>No sale nada con los datos que hay. Para un producto nuevo, sube el Cerebro y el ASIN Grabber de Helium 10.</p>
            ) : (
              ORDEN.map((d) => {
                const xs = propuesta.semillas.filter((s) => s.destino === d)
                if (xs.length === 0) return null
                const todas = xs.every((s) => marcadas.has(s.id))
                return (
                  <div key={d} className="rounded-[10px] border border-[var(--ls-linea)]">
                    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ls-linea)] px-3 py-2">
                      <input type="checkbox" checked={todas} onChange={(e) => alternarGrupo(d, e.target.checked)} aria-label={`Marcar todas: ${NOMBRE_DESTINO[d].titulo}`} />
                      <span className={`${TIPO.s} font-semibold ${TEXTO.t1}`}>{NOMBRE_DESTINO[d].titulo}</span>
                      <span className={`${TIPO.xs} ${TEXTO.t4}`}>
                        {xs.filter((s) => marcadas.has(s.id)).length} de {xs.length} · van a {NOMBRE_DESTINO[d].donde}
                      </span>
                    </div>
                    <ul className="max-h-[320px] overflow-y-auto">
                      {xs.map((s) => (
                        <li key={s.id} className="flex items-start gap-2 px-3 py-[5px] hover:bg-[var(--ls-sup2)]">
                          <input type="checkbox" className="mt-[3px]" checked={marcadas.has(s.id)} onChange={() => alternar(s.id)} aria-label={s.texto} />
                          <div className="min-w-0 flex-1">
                            <span className={`${TIPO.s} font-medium ${TEXTO.t1}`}>{d === 'asin' || d === 'negativa-asin' ? s.texto.toUpperCase() : s.texto}</span>
                            <span className={`${TIPO.xs} ${TEXTO.t4}`}> · {FUENTE[s.fuente]} · {s.motivo}</span>
                          </div>
                          {s.puja != null && <span className={`${TIPO.xs} tabular-nums ${TEXTO.t3}`}>{fmt(s.puja)}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })
            )}
            {propuesta.semillas.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={ocupado !== null || elegidas.length === 0} onClick={aplicar} className={`${BOTON.base} ${BOTON.alto} ${BOTON.primario}`}>
                  {ocupado === 'aplicar' ? 'Aplicando en Amazon…' : `Aplicar ${elegidas.length} en las campañas del producto`}
                </button>
                <span className={`${TIPO.xs} ${TEXTO.t4}`}>Cada exacta se excluye también en AUTO y AMPLIA para que no compitan. Todo queda en el log.</span>
              </div>
            )}
          </>
        )}

        {resultado && (
          <div className={`${AVISO.base} ${AVISO.conTono}`} style={{ borderLeftColor: resultado.fallos.length || resultado.faltan.length ? COLOR_ESTADO.ambar : COLOR_ESTADO.verde }}>
            <CircleAlert className={AVISO.icono} />
            <div>
              <div>
                <span className={AVISO.fuerte}>{resultado.hechas} cambios hechos.</span>
                {resultado.faltan.length > 0 && ` Faltan campañas de la estructura (${resultado.faltan.join(', ')}): lo que iba ahí no se ha aplicado. Créalas arriba y vuelve a aplicar.`}
              </div>
              {resultado.fallos.slice(0, 8).map((f, i) => (
                <div key={i} className={TIPO.xs}>
                  {f.texto} ({f.destino}): {f.error}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
