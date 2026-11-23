'use client'

import { useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { toast } from 'sonner'
import { FileSpreadsheet, KeyRound, Lightbulb, Search, Trash2, Trophy, UploadCloud } from 'lucide-react'
import { Boton, EstadoVacio, FilaDeKpis, Insignia, Kpi, Segmentado, TablaAdaptable, Tarjeta, ACENTO, mezcla, formatoEntero, type Columna } from '@/components/ui-ls'
import { COLOR_ESTADO } from '@/lib/estilo/denso'
import { asinsDelCerebro, detectarTipoH10, leerCerebro, leerKeywordTracker, type TipoH10 } from '@/lib/ads/helium10'
import type { KeywordCruzada } from '@/lib/seo/helium'
import type { DatosDeHelium, FilaRecibida } from '@/lib/seo/helium-servidor'
import { llamar } from '@/components/marketing-test/llamar'
import { SelectorDeProducto } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import { useDelProducto } from './useDelProducto'

const NOMBRE_TIPO: Record<TipoH10, string> = { cerebro: 'Cerebro', magnet: 'Magnet', keyword_tracker: 'Keyword Tracker' }

interface Leido {
  fichero: string
  tipo: TipoH10
  filas: FilaRecibida[]
  rivales: string[]
}

/**
 * HELIUM 10 DE UN PRODUCTO: se arrastran los CSV de Cerebro, Magnet o Keyword Tracker, se leen en el navegador y se guardan con su fecha. Las palabras se
 * cruzan con Brand Analytics: lo que tiene volumen en Helium 10 y el producto no sale en Brand Analytics es la oportunidad, y la propuesta con IA la recibe.
 */
export function PestanaSeoHelium({ cuentaId, datos, asin, setAsin, irAProductos }: { cuentaId: string; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void }) {
  const h = useDelProducto<DatosDeHelium>(asin ? `/api/seo/helium?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const [leido, setLeido] = useState<Leido | null>(null)
  const [guardando, setGuardando] = useState(false)
  const [encima, setEncima] = useState(false)
  const [vista, setVista] = useState<'oportunidades' | 'todas' | 'ajenas'>('oportunidades')
  const [decidiendo, setDecidiendo] = useState<string | null>(null)
  const [filtro, setFiltro] = useState('')
  const input = useRef<HTMLInputElement>(null)

  const palabras = h.datos?.palabras ?? []
  const visibles = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    return palabras.filter((p) => (vista === 'todas' || (vista === 'ajenas' ? p.decision === 'ajena' : p.oportunidad > 0)) && (!q || p.keyword.includes(q)))
  }, [palabras, vista, filtro])
  const kpis = useMemo(() => {
    const op = palabras.filter((p) => p.oportunidad > 0)
    return {
      total: palabras.length,
      oportunidades: op.length,
      volumenOportunidad: op.reduce((s, p) => s + (p.volumen ?? 0), 0),
      top10: palabras.filter((p) => p.rangoOrganico != null && p.rangoOrganico <= 10).length,
      ajenas: palabras.filter((p) => p.decision === 'ajena').length,
      conRango: palabras.some((p) => p.rangoOrganico != null),
    }
  }, [palabras])

  if (datos.productos.length === 0) return <EstadoVacio icono={FileSpreadsheet} titulo="Primero hay que seguir algún producto" descripcion="Los CSV de Helium 10 se guardan por producto." accion={{ texto: 'Ir a Productos', onClick: irAProductos }} acento="seo" />

  async function leer(f: File) {
    if (!asin) return
    if (f.size > 15 * 1024 * 1024) return toast.error('El fichero pasa de 15 MB: exporta menos filas desde Helium 10.')
    const texto = await f.text()
    const tipo = detectarTipoH10(texto)
    if (tipo === 'keyword_tracker') {
      const r = leerKeywordTracker(texto, asin)
      if (!r.ok) return toast.error(r.error)
      setLeido({ fichero: f.name, tipo, filas: r.filas.map((x) => ({ keyword: x.keyword, volumen: x.volumen, rangoOrganico: x.rangoOrganico, rangoPatrocinado: x.rangoPatrocinado })), rivales: [] })
      return
    }
    const r = leerCerebro(texto, asin)
    if (!r.ok) return toast.error(r.error)
    setLeido({
      fichero: f.name,
      tipo,
      filas: r.filas.map((x) => ({ keyword: x.keyword, volumen: x.volumen, cerebroIq: x.cerebroIq ?? null, tendencia: x.tendencia ?? null, competidores: x.competidores, densidad: x.densidad, pujaSugerida: x.pujaSugerida, rangoOrganico: x.rankingOrganico, rangoPatrocinado: x.rangoPatrocinado ?? null, rangosRivales: x.rangosRivales })),
      rivales: asinsDelCerebro(texto, asin),
    })
  }

  async function guardar() {
    if (!leido || !asin) return
    setGuardando(true)
    try {
      const r = await llamar<{ filas: number }>('/api/seo/helium', { metodo: 'POST', cuerpo: { cuenta: cuentaId, asin, accion: 'importar', tipo: leido.tipo, fichero: leido.fichero, filas: leido.filas, asinsRivales: leido.rivales } })
      toast.success(`Guardadas ${r.filas.toLocaleString('es-ES')} palabras de ${NOMBRE_TIPO[leido.tipo]}.`)
      setLeido(null)
      await h.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setGuardando(false)
    }
  }

  /** «No es nuestro producto» / deshacer: la misma decisión que en Búsquedas (vale para toda la cuenta y país) */
  async function decidir(p: KeywordCruzada, decision: 'ajena' | 'nuestra' | null) {
    setDecidiendo(p.keyword)
    try {
      if (decision) await llamar('/api/seo/ajenas', { metodo: 'POST', cuerpo: { cuenta: cuentaId, consulta: p.keyword, decision, asin } })
      else await llamar('/api/seo/ajenas', { metodo: 'DELETE', cuerpo: { cuenta: cuentaId, consulta: p.keyword } })
      await h.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido guardar.')
    } finally {
      setDecidiendo(null)
    }
  }

  async function borrar(id: string) {
    try {
      await llamar('/api/seo/helium', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'borrar', id } })
      await h.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido borrar.')
    }
  }

  const columnas: Columna<KeywordCruzada>[] = [
    {
      id: 'keyword',
      cabecera: 'Palabra',
      celda: (p) => (
        <span className={`font-medium ${p.decision === 'ajena' ? 'text-[var(--ls-t4)] line-through decoration-[var(--ls-t4)]/60' : 'text-[var(--ls-t1)]'}`} title={p.decision === 'ajena' ? 'No es nuestro producto: no cuenta como oportunidad ni le llega a la IA' : undefined}>
          {p.keyword}
        </span>
      ),
      ordenar: (p) => p.keyword,
      movil: 'titulo',
    },
    { id: 'volumen', cabecera: 'Volumen', celda: (p) => formatoEntero(p.volumen ?? 0), ordenar: (p) => p.volumen ?? 0, alinear: 'derecha', movil: 'dato' },
    { id: 'iq', cabecera: 'IQ', celda: (p) => (p.cerebroIq != null ? formatoEntero(p.cerebroIq) : '—'), ordenar: (p) => p.cerebroIq ?? -1, alinear: 'derecha', movil: 'oculto' },
    { id: 'rango', cabecera: 'Rango orgánico', celda: (p) => (p.rangoOrganico != null ? <span style={{ color: p.rangoOrganico <= 10 ? COLOR_ESTADO.verde : p.rangoOrganico <= 50 ? 'var(--ls-t1)' : COLOR_ESTADO.ambar }}>#{p.rangoOrganico}</span> : '—'), ordenar: (p) => p.rangoOrganico ?? 9999, alinear: 'derecha', movil: 'dato', rotuloMovil: 'Rango' },
    { id: 'ba', cabecera: 'Brand Analytics', celda: (p) => (p.enBrandAnalytics ? <Insignia tono="verde" tamano="sm">sale</Insignia> : <Insignia tono="ambar" tamano="sm">no sale</Insignia>), ordenar: (p) => (p.enBrandAnalytics ? 1 : 0), movil: 'insignia' },
    { id: 'ficha', cabecera: 'En la ficha', celda: (p) => (p.enTitulo ? 'en el título' : p.enFicha ? 'en la ficha' : <span style={{ color: COLOR_ESTADO.ambar }}>falta {p.faltan.slice(0, 3).join(', ')}</span>), ordenar: (p) => (p.enTitulo ? 2 : p.enFicha ? 1 : 0), movil: 'subtitulo' },
    {
      id: 'oportunidad',
      cabecera: 'Oportunidad',
      celda: (p) => <BarraOportunidad valor={p.oportunidad} max={palabras[0]?.oportunidad ?? 1} titulo={p.motivo} />,
      ordenar: (p) => p.oportunidad,
      alinear: 'derecha',
      movil: 'dato',
    },
    {
      id: 'decision',
      cabecera: '',
      celda: (p) =>
        p.decision === 'ajena' ? (
          <button type="button" disabled={decidiendo === p.keyword} onClick={() => void decidir(p, null)} className="whitespace-nowrap rounded-[8px] px-2 py-1 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-50 [@media(pointer:coarse)]:min-h-[40px]">
            Deshacer
          </button>
        ) : p.enBrandAnalytics ? null : (
          <button type="button" disabled={decidiendo === p.keyword} onClick={() => void decidir(p, 'ajena')} title="La palabra es de otro producto o de otra marca: deja de ser oportunidad (también en Búsquedas y en la propuesta con IA)" className="whitespace-nowrap rounded-[8px] px-2 py-1 text-[12px] text-[var(--ls-t3)] hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-t1)] disabled:opacity-50 [@media(pointer:coarse)]:min-h-[40px]">
            No es nuestro
          </button>
        ),
      alinear: 'derecha',
      movil: 'dato',
    },
  ]

  const importaciones = h.datos?.importaciones ?? []

  return (
    <div className="flex flex-col gap-4 pb-8">
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
      </div>

      {h.datos?.sinMigracion ? (
        <EstadoVacio icono={FileSpreadsheet} titulo="Falta lanzar la migración 312" descripcion="Sin ella no hay dónde guardar los CSV de Helium 10." acento="seo" />
      ) : (
        <>
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setEncima(true)
            }}
            onDragLeave={() => setEncima(false)}
            onDrop={(e) => {
              e.preventDefault()
              setEncima(false)
              const f = e.dataTransfer.files?.[0]
              if (f) void leer(f)
            }}
            className="relative overflow-hidden rounded-[14px] border border-dashed p-5 transition-colors"
            style={{ borderColor: encima ? ACENTO.seo : 'var(--ls-linea2)', background: encima ? mezcla(ACENTO.seo, 8) : 'var(--ls-sup)' }}
          >
            <input ref={input} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void leer(f); e.target.value = '' }} />
            {!leido ? (
              <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:text-left">
                <motion.span animate={encima ? { y: -4, scale: 1.06 } : { y: 0, scale: 1 }} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px]" style={{ background: mezcla(ACENTO.seo, 14), color: ACENTO.seo }}>
                  <UploadCloud className="h-6 w-6" />
                </motion.span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold text-[var(--ls-t1)]">Arrastra aquí un CSV de Helium 10</div>
                  <div className="text-[12.5px] text-[var(--ls-t3)]">Cerebro, Magnet o Keyword Tracker de este producto. Se reconoce solo; se lee en tu navegador y se guarda con la fecha de hoy.</div>
                </div>
                <Boton variante="secundario" icono={FileSpreadsheet} onClick={() => input.current?.click()}>
                  Elegir fichero
                </Boton>
              </div>
            ) : (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2 text-[14px] font-semibold text-[var(--ls-t1)]">
                    <FileSpreadsheet className="h-4 w-4" style={{ color: ACENTO.seo }} /> {leido.fichero}
                    <Insignia tono="azul" tamano="sm">{NOMBRE_TIPO[leido.tipo]}</Insignia>
                  </div>
                  <div className="mt-1 text-[12.5px] text-[var(--ls-t3)]">
                    {leido.filas.length.toLocaleString('es-ES')} palabras{leido.rivales.length > 0 ? ` · rango de ${leido.rivales.length} ASIN rivales (se pueden seguir en «Competencia»)` : ''}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Boton variante="fantasma" onClick={() => setLeido(null)}>Cancelar</Boton>
                  <Boton variante="primario" icono={UploadCloud} cargando={guardando} onClick={guardar}>Guardar</Boton>
                </div>
              </div>
            )}
          </div>

          {palabras.length === 0 && !h.cargando ? (
            <EstadoVacio icono={KeyRound} titulo="Sin datos de Helium 10 para este producto" descripcion="Sube un Cerebro (o Magnet) para ver qué palabras con volumen no salen en Brand Analytics, y un Keyword Tracker para el rango orgánico por palabra, que Amazon no da." acento="seo" compacto />
          ) : (
            <>
              <FilaDeKpis>
                <Kpi indice={0} etiqueta="Palabras de Helium 10" valor={kpis.total} icono={KeyRound} acento="seo" cargando={h.cargando && !h.datos} />
                <Kpi indice={1} etiqueta="Oportunidades" valor={kpis.oportunidades} icono={Lightbulb} acento="seo" nota="con volumen y sin salir en Brand Analytics" />
                <Kpi indice={2} etiqueta="Búsquedas en juego" valor={kpis.volumenOportunidad} icono={Search} acento="seo" nota="volumen mensual de las oportunidades" />
                <Kpi indice={3} etiqueta="En el top 10 orgánico" valor={kpis.conRango ? kpis.top10 : null} icono={Trophy} acento="seo" nota={kpis.conRango ? 'del Keyword Tracker o el Cerebro' : 'sube un Keyword Tracker'} />
              </FilaDeKpis>
              {h.datos && h.datos.busquedasBA === 0 && <p className="text-[12.5px]" style={{ color: COLOR_ESTADO.ambar }}>Este producto aún no tiene búsquedas de Brand Analytics: hasta que lleguen, todas las palabras salen como «no sale».</p>}
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <Segmentado etiqueta="Qué palabras" opciones={[{ id: 'oportunidades', texto: 'Oportunidades', cuenta: kpis.oportunidades }, { id: 'todas', texto: 'Todas', cuenta: kpis.total }, ...(kpis.ajenas > 0 ? [{ id: 'ajenas' as const, texto: 'No son nuestras', cuenta: kpis.ajenas }] : [])]} valor={vista} onCambio={setVista} tamano="sm" />
                <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="Buscar palabra…" className="h-[34px] w-full rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)] sm:ml-auto sm:w-[260px] [@media(pointer:coarse)]:h-[44px] [@media(pointer:coarse)]:text-[16px]" />
              </div>
              <TablaAdaptable etiqueta="Palabras de Helium 10" columnas={columnas} filas={visibles} claveDe={(p) => p.keyword} ordenInicial={{ id: 'oportunidad', sentido: 'desc' }} cargando={h.cargando && !h.datos} vacio={{ icono: Search, titulo: 'Ninguna palabra con ese filtro' }} />
            </>
          )}

          {importaciones.length > 0 && (
            <Tarjeta titulo="Ficheros subidos" subtitulo="Para cruzar se usan el último Cerebro/Magnet y el último Keyword Tracker" icono={FileSpreadsheet} acento="seo">
              <ul className="flex flex-col divide-y divide-[var(--ls-linea)]">
                {importaciones.map((i) => (
                  <li key={i.id} className="flex items-center gap-3 py-2 text-[13px]">
                    <Insignia tono="azul" tamano="sm">{NOMBRE_TIPO[i.tipo]}</Insignia>
                    <span className="min-w-0 flex-1 truncate text-[var(--ls-t2)]">{i.fichero ?? 'sin nombre'}</span>
                    <span className="hidden text-[12px] text-[var(--ls-t4)] sm:inline">{i.filas.toLocaleString('es-ES')} palabras · {new Date(i.subidoAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}{i.subidoPor ? ` · ${i.subidoPor}` : ''}</span>
                    <Boton variante="fantasma" tamano="sm" soloIcono icono={Trash2} aria-label="Borrar este fichero" onClick={() => borrar(i.id)} />
                  </li>
                ))}
              </ul>
            </Tarjeta>
          )}
        </>
      )}
    </div>
  )
}

function BarraOportunidad({ valor, max, titulo }: { valor: number; max: number; titulo: string }) {
  if (valor <= 0) return <span className="text-[var(--ls-t4)]" title={titulo}>—</span>
  const pct = Math.max(4, Math.min(100, (valor / Math.max(1, max)) * 100))
  return (
    <span className="ml-auto inline-flex w-[110px] items-center gap-2" title={titulo}>
      <span className="h-[6px] flex-1 overflow-hidden rounded-full bg-[var(--ls-sup2)]">
        <span className="block h-full rounded-full" style={{ width: `${pct}%`, background: ACENTO.seo }} />
      </span>
      <span className="w-[42px] text-right tabular-nums text-[12px] text-[var(--ls-t2)]">{formatoEntero(valor)}</span>
    </span>
  )
}
