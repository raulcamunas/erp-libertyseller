'use client'

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ArrowRight, Camera, Eye, ImageIcon, ListOrdered, Plus, Radar, Tag, Trash2, Type, TrendingDown, TrendingUp } from 'lucide-react'
import { Boton, Chispa, EstadoVacio, FilaDeKpis, Insignia, Kpi, LineaDeTiempo, PanelLateral, TablaAdaptable, Tarjeta, ACENTO, VIZ, mezcla, type Columna, type Hito } from '@/components/ui-ls'
import { COLOR_ESTADO, type TonoEstado } from '@/lib/estilo/denso'
import { llamar } from '@/components/marketing-test/llamar'
import { NOMBRE_CAMPO_RIVAL, type CampoRival, type RankRival } from '@/lib/seo/rivales'
import type { CambioGuardado, Rival } from '@/lib/seo/rivales-servidor'
import type { FilaCompetencia } from '@/lib/seo/datos'
import type { DatosDeHelium } from '@/lib/seo/helium-servidor'
import { trozosNuevos } from '@/lib/seo/propuesta'
import { SelectorDeProducto, useEsOrdenador } from './comun'
import type { DatosSeo } from './useCuentaSeo'
import { useDelProducto } from './useDelProducto'
import { MarcasDeLaCompetencia } from './MarcasDeLaCompetencia'

interface DatosRivales {
  rivales: Rival[]
  cambios: CambioGuardado[]
  sinMigracion?: boolean
}

const ICONO: Record<CampoRival, typeof Type> = { titulo: Type, bullets: ListOrdered, imagenes: ImageIcon, precio: Tag, bsr: TrendingUp, marca: Tag, buybox: Tag }
const TONO: Record<CampoRival, TonoEstado> = { titulo: 'azul', bullets: 'violeta', imagenes: 'cian', precio: 'ambar', bsr: 'verde', marca: 'gris', buybox: 'naranja' }
const SEMANA_MS = 7 * 86_400_000

const precio = (n: number | null | undefined, moneda?: string | null) => (n == null ? '—' : n.toLocaleString('es-ES', { style: 'currency', currency: moneda || 'EUR' }))

/**
 * LA COMPETENCIA QUE SE SIGUE CADA DÍA: el alta de ASIN rivales (a mano, desde el Top 3 de Brand Analytics o desde el Cerebro), el feed de lo que han
 * cambiado esta semana (ideas para nuestras fichas) y, por rival, su línea de tiempo con el antes y el después resaltados.
 */
export function PestanaSeoCompetencia({ cuentaId, datos, asin, setAsin, irAProductos, recargarCuenta }: { cuentaId: string; datos: DatosSeo; asin: string | null; setAsin: (a: string) => void; irAProductos: () => void; /** Para que las búsquedas se vuelvan a juzgar con la lista de marcas nueva */ recargarCuenta?: () => void }) {
  const r = useDelProducto<DatosRivales>(`/api/seo/rivales?cuenta=${encodeURIComponent(cuentaId)}`)
  const top = useDelProducto<{ filas: FilaCompetencia[]; sinMigracion?: boolean }>(asin ? `/api/seo/competencia?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const helium = useDelProducto<DatosDeHelium>(asin ? `/api/seo/helium?cuenta=${encodeURIComponent(cuentaId)}&asin=${asin}` : null)
  const [texto, setTexto] = useState('')
  const [anadiendo, setAnadiendo] = useState(false)
  const [fotografiando, setFotografiando] = useState(false)
  const [abierto, setAbierto] = useState<string | null>(null)
  const esOrdenador = useEsOrdenador()

  const rivales = r.datos?.rivales ?? []
  const cambios = r.datos?.cambios ?? []
  const propios = useMemo(() => new Set(datos.productos.map((p) => p.asin)), [datos.productos])
  const seguidos = useMemo(() => new Set(rivales.map((x) => x.asinRival)), [rivales])
  const semana = useMemo(() => cambios.filter((c) => Date.now() - Date.parse(c.detectadoAt) < SEMANA_MS), [cambios])

  const sugerenciasTop = useMemo(() => {
    const cuenta = new Map<string, { asin: string; veces: number; clics: number; ejemplo: string }>()
    for (const f of top.datos?.filas ?? []) {
      if (propios.has(f.asin) || seguidos.has(f.asin)) continue
      const x = cuenta.get(f.asin) ?? { asin: f.asin, veces: 0, clics: 0, ejemplo: f.consulta }
      x.veces++
      x.clics += f.cuotaClics ?? 0
      cuenta.set(f.asin, x)
    }
    return [...cuenta.values()].sort((a, b) => b.veces - a.veces || b.clics - a.clics).slice(0, 8)
  }, [top.datos, propios, seguidos])
  const sugerenciasCerebro = useMemo(() => [...new Set((helium.datos?.importaciones ?? []).flatMap((i) => i.asinsRivales))].filter((a) => !propios.has(a) && !seguidos.has(a)).slice(0, 10), [helium.datos, propios, seguidos])

  if (datos.productos.length === 0) return <EstadoVacio icono={Radar} titulo="Primero hay que seguir algún producto" descripcion="La competencia se sigue por producto propio." accion={{ texto: 'Ir a Productos', onClick: irAProductos }} acento="seo" />
  if (r.datos?.sinMigracion) return <EstadoVacio icono={Radar} titulo="Falta lanzar la migración 312" descripcion="Sin ella no hay dónde guardar la competencia que se sigue." acento="seo" />

  async function alta(asins: string, origen: 'manual' | 'top_terms' | 'cerebro') {
    setAnadiendo(true)
    try {
      const x = await llamar<{ nuevos: number; pedidos: number }>('/api/seo/rivales', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'alta', asins, asinPropio: asin, origen } })
      toast.success(x.nuevos > 0 ? `${x.nuevos} ${x.nuevos === 1 ? 'rival nuevo' : 'rivales nuevos'}. Su primera foto sale en la próxima pasada (cada hora) o con «Hacer la foto ahora».` : 'Ya los seguías.')
      if (origen === 'manual') setTexto('')
      await r.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido añadir.')
    } finally {
      setAnadiendo(false)
    }
  }

  async function fotografiar() {
    setFotografiando(true)
    try {
      const x = await llamar<{ fotos: number; cambios: number; errores: string[] }>('/api/seo/rivales', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'fotografiar' } })
      toast.success(x.fotos === 0 ? 'Todos tenían ya la foto de hoy.' : `${x.fotos} fotos hechas, ${x.cambios} cambios.${x.errores.length ? ` Avisos: ${x.errores[0]}` : ''}`)
      await r.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido hacer la foto.')
    } finally {
      setFotografiando(false)
    }
  }

  async function baja(id: string) {
    try {
      await llamar('/api/seo/rivales', { metodo: 'POST', cuerpo: { cuenta: cuentaId, accion: 'baja', id } })
      setAbierto(null)
      await r.recargar()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'No se ha podido quitar.')
    }
  }

  const delProducto = asin ? rivales.filter((x) => !x.asinPropio || x.asinPropio === asin) : rivales
  const elegido = rivales.find((x) => x.id === abierto) ?? null

  const columnas: Columna<Rival>[] = [
    {
      id: 'rival',
      cabecera: 'Rival',
      celda: (x) => (
        <span className="flex min-w-0 items-center gap-3">
          <Miniatura src={x.ultima?.imagenes[0]} />
          <span className="min-w-0">
            <span className="block truncate font-medium text-[var(--ls-t1)]">{x.ultima?.titulo ?? x.nombre ?? x.asinRival}</span>
            <span className="block text-[12px] text-[var(--ls-t4)]">{x.asinRival}{x.ultima?.marca ? ` · ${x.ultima.marca}` : ''}</span>
          </span>
        </span>
      ),
      ordenar: (x) => x.ultima?.titulo ?? x.asinRival,
      movil: 'titulo',
      ancho: 'minmax(260px, 2fr)',
    },
    {
      id: 'precio',
      cabecera: 'Precio',
      celda: (x) => (
        <span className="inline-flex items-center gap-2">
          <span className="w-[56px]">{x.serie.filter((s) => s.precio != null).length > 1 && <Chispa valores={x.serie.filter((s) => s.precio != null).map((s) => s.precio as number)} color={VIZ[0]} alto={22} />}</span>
          <span className="tabular-nums">{precio(x.ultima?.precio, x.ultima?.moneda)}</span>
        </span>
      ),
      ordenar: (x) => x.ultima?.precio ?? -1,
      alinear: 'derecha',
      movil: 'dato',
    },
    { id: 'bsr', cabecera: 'BSR', celda: (x) => { const b = bsrDe(x.ultima?.bsr ?? []); return b ? <span className="tabular-nums" title={b.categoria}>#{b.rank.toLocaleString('es-ES')}</span> : '—' }, ordenar: (x) => bsrDe(x.ultima?.bsr ?? [])?.rank ?? 1e9, alinear: 'derecha', movil: 'dato' },
    {
      id: 'cambios',
      cabecera: 'Cambios (7 días)',
      celda: (x) => {
        const n = semana.filter((c) => c.competidorId === x.id).length
        // El punto que late (animate-ping infinito), solo en el ordenador: uno por fila recalculaba estilos 60 veces por segundo sin tocar nada, y en el móvil son batería y tirones
        return n > 0 ? <Insignia tono="azul" tamano="sm" vivo={esOrdenador === true}>{n}</Insignia> : <span className="text-[var(--ls-t4)]">—</span>
      },
      ordenar: (x) => semana.filter((c) => c.competidorId === x.id).length,
      alinear: 'derecha',
      movil: 'insignia',
    },
    { id: 'foto', cabecera: 'Última foto', celda: (x) => (x.error ? <span style={{ color: COLOR_ESTADO.ambar }} title={x.error}>con aviso</span> : x.fotoAt ? new Date(x.fotoAt).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' }) : <span className="text-[var(--ls-t4)]">pendiente</span>), ordenar: (x) => x.fotoAt ?? '', movil: 'subtitulo' },
  ]

  return (
    <div className="flex flex-col gap-4 pb-8">
      <MarcasDeLaCompetencia cuentaId={cuentaId} alCambiar={recargarCuenta} />
      <div className="flex flex-wrap items-center gap-2">
        <SelectorDeProducto productos={datos.productos} datos={datos} asin={asin} setAsin={setAsin} />
        <Boton className="ml-auto" variante="secundario" icono={Camera} cargando={fotografiando} disabled={rivales.length === 0} onClick={fotografiar}>
          Hacer la foto ahora
        </Boton>
      </div>

      <FilaDeKpis>
        <Kpi indice={0} etiqueta="Rivales seguidos" valor={r.datos ? rivales.length : null} icono={Radar} acento="seo" cargando={r.cargando && !r.datos} nota="foto diaria de cada uno" />
        <Kpi indice={1} etiqueta="Cambios esta semana" valor={r.datos ? semana.length : null} icono={Eye} acento="seo" cargando={r.cargando && !r.datos} />
        <Kpi indice={2} etiqueta="Cambios de precio" valor={r.datos ? semana.filter((c) => c.campo === 'precio').length : null} icono={Tag} acento="seo" cargando={r.cargando && !r.datos} nota="en 7 días" />
        <Kpi indice={3} etiqueta="Fichas reescritas" valor={r.datos ? new Set(semana.filter((c) => c.campo === 'titulo' || c.campo === 'bullets').map((c) => c.competidorId)).size : null} icono={Type} acento="seo" cargando={r.cargando && !r.datos} nota="título o viñetas, en 7 días" />
      </FilaDeKpis>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <Tarjeta variante="destacada" acento="seo" icono={Eye} titulo="Cambios de la competencia esta semana" subtitulo="Lo que han tocado en sus fichas: ideas para las nuestras">
          {semana.length === 0 ? (
            <EstadoVacio compacto icono={Eye} titulo={rivales.length === 0 ? 'Aún no sigues a nadie' : 'Nada nuevo esta semana'} descripcion={rivales.length === 0 ? 'Añade ASIN rivales a la derecha: cada día se compara su ficha con la del día anterior.' : 'Las fotos de cada día se comparan con la anterior; los cambios salen aquí.'} acento="seo" />
          ) : (
            <LineaDeTiempo
              maximo={12}
              eventos={semana
                .slice()
                .sort((a, b) => b.detectadoAt.localeCompare(a.detectadoAt) || b.magnitud - a.magnitud)
                .map((c): Hito => ({
                  id: c.id,
                  cuando: c.detectadoAt,
                  tono: TONO[c.campo],
                  icono: ICONO[c.campo],
                  titulo: (
                    <button type="button" onClick={() => setAbierto(c.competidorId)} className="text-left hover:underline">
                      {NOMBRE_CAMPO_RIVAL[c.campo]} · <span className="font-normal text-[var(--ls-t3)]">{(c.nombre ?? c.asinRival).slice(0, 70)}</span>
                    </button>
                  ),
                  descripcion: c.resumen ?? undefined,
                }))}
            />
          )}
        </Tarjeta>

        <Tarjeta icono={Plus} titulo="Seguir a un rival" subtitulo={asin ? `Contra ${asin}` : 'De la cuenta'} acento="seo">
          <div className="flex flex-col gap-3">
            <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={2} placeholder="Pega ASIN o enlaces de Amazon (varios a la vez)" className="w-full resize-none rounded-[10px] border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 py-2 text-[13px] text-[var(--ls-t1)] outline-none focus:border-[var(--ls-acc-graf)] [@media(pointer:coarse)]:text-[16px]" />
            <Boton variante="primario" icono={Plus} cargando={anadiendo} disabled={!texto.trim()} onClick={() => alta(texto, 'manual')}>
              Seguir
            </Boton>
            {sugerenciasTop.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Top 3 de Brand Analytics en sus búsquedas</span>
                <div className="flex flex-wrap gap-2">
                  {sugerenciasTop.map((s) => (
                    <Sugerencia key={s.asin} asin={s.asin} detalle={`en ${s.veces} ${s.veces === 1 ? 'búsqueda' : 'búsquedas'} · «${s.ejemplo.slice(0, 28)}»`} onClick={() => alta(s.asin, 'top_terms')} />
                  ))}
                </div>
              </div>
            )}
            {sugerenciasCerebro.length > 0 && (
              <div className="flex flex-col gap-2">
                <span className="text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Del Cerebro de Helium 10</span>
                <div className="flex flex-wrap gap-2">
                  {sugerenciasCerebro.map((a) => (
                    <Sugerencia key={a} asin={a} detalle="columna del Cerebro multi-ASIN" onClick={() => alta(a, 'cerebro')} />
                  ))}
                </div>
              </div>
            )}
            <p className="text-[12px] leading-[1.45] text-[var(--ls-t4)]">Cada día: título, viñetas, imágenes y BSR (Catalog Items) y precio y Buy Box (Amazon, con cupo). No se gastan tokens de Keepa.</p>
          </div>
        </Tarjeta>
      </div>

      <TablaAdaptable
        etiqueta="Rivales seguidos"
        columnas={columnas}
        filas={delProducto}
        claveDe={(x) => x.id}
        alPulsarFila={(x) => setAbierto(x.id)}
        filaActiva={abierto}
        cargando={r.cargando && !r.datos}
        ordenInicial={{ id: 'cambios', sentido: 'desc' }}
        vacio={{ icono: Radar, titulo: 'Sin rivales para este producto', descripcion: 'Añádelos arriba: a mano, desde el Top 3 de Brand Analytics o desde el Cerebro.' }}
      />

      <PanelLateral abierto={!!elegido} onCambio={(v) => !v && setAbierto(null)} titulo={elegido?.ultima?.titulo ?? elegido?.asinRival ?? ''} descripcion={elegido ? `${elegido.asinRival}${elegido.ultima?.marca ? ` · ${elegido.ultima.marca}` : ''}` : undefined} icono={Radar} acento="seo" ancho={560} pie={elegido ? <Boton variante="peligro" icono={Trash2} onClick={() => baja(elegido.id)}>Dejar de seguir</Boton> : undefined}>
        {elegido && <DetalleRival rival={elegido} cambios={cambios.filter((c) => c.competidorId === elegido.id)} />}
      </PanelLateral>
    </div>
  )
}

const bsrDe = (b: RankRival[]) => b.find((x) => x.tipo === 'grupo') ?? b[0] ?? null

function Miniatura({ src, tamano = 40 }: { src?: string | null; tamano?: number }) {
  return (
    <span className="flex shrink-0 items-center justify-center overflow-hidden rounded-[10px] border border-[var(--ls-linea)] bg-white" style={{ width: tamano, height: tamano }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" className="h-full w-full object-contain" />
      ) : (
        <ImageIcon className="h-4 w-4 text-[var(--ls-t4)]" />
      )}
    </span>
  )
}

function Sugerencia({ asin, detalle, onClick }: { asin: string; detalle: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} title={detalle} className="ls-elevar inline-flex min-h-[32px] items-center gap-2 rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-3 text-[12.5px] text-[var(--ls-t2)] transition-colors hover:text-[var(--ls-t1)] [@media(pointer:coarse)]:min-h-[44px]">
      <Plus className="h-3 w-3" style={{ color: ACENTO.seo }} /> {asin}
    </button>
  )
}

/** Un rival: sus imágenes, su ficha de hoy, precio y BSR de 30 días y su línea de tiempo con el antes y el después */
function DetalleRival({ rival, cambios }: { rival: Rival; cambios: CambioGuardado[] }) {
  const u = rival.ultima
  const precios = rival.serie.filter((s) => s.precio != null).map((s) => s.precio as number)
  const bsrs = rival.serie.filter((s) => s.bsr != null).map((s) => s.bsr as number)
  return (
    <div className="flex flex-col gap-4">
      {!u ? (
        <EstadoVacio compacto icono={Camera} titulo="Todavía sin foto" descripcion={rival.error ?? 'Sale en la próxima pasada (cada hora) o con «Hacer la foto ahora».'} acento="seo" />
      ) : (
        <>
          {u.imagenes.length > 0 && (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {u.imagenes.slice(0, 9).map((src) => (
                <Miniatura key={src} src={src} tamano={72} />
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-[12px] border border-[var(--ls-linea)] p-3">
              <div className="text-[12px] text-[var(--ls-t4)]">Precio{u.ofertas ? ` · ${u.ofertas} ofertas` : ''}</div>
              <div className="text-[20px] font-semibold tabular-nums text-[var(--ls-t1)]">{precio(u.precio, u.moneda)}</div>
              {precios.length > 1 && <Chispa valores={precios} color={VIZ[0]} alto={32} />}
            </div>
            <div className="rounded-[12px] border border-[var(--ls-linea)] p-3">
              <div className="truncate text-[12px] text-[var(--ls-t4)]">BSR{bsrDe(u.bsr) ? ` · ${bsrDe(u.bsr)?.categoria}` : ''}</div>
              <div className="text-[20px] font-semibold tabular-nums text-[var(--ls-t1)]">{bsrDe(u.bsr) ? `#${bsrDe(u.bsr)?.rank.toLocaleString('es-ES')}` : '—'}</div>
              {bsrs.length > 1 && <Chispa valores={bsrs.map((b) => -b)} color={VIZ[2]} alto={32} />}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[12px] font-semibold uppercase tracking-[0.04em] text-[var(--ls-t4)]">Viñetas de hoy</div>
            <ul className="flex flex-col gap-1 text-[13px] leading-[1.5] text-[var(--ls-t2)]">
              {u.bullets.length ? u.bullets.map((b, i) => <li key={i}>· {b}</li>) : <li className="text-[var(--ls-t4)]">Sin viñetas en el catálogo.</li>}
            </ul>
          </div>
        </>
      )}
      <div>
        <div className="mb-2 text-[13px] font-semibold text-[var(--ls-t1)]">Línea de tiempo</div>
        {cambios.length === 0 ? (
          <p className="text-[12.5px] text-[var(--ls-t3)]">Sin cambios desde que se sigue.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {cambios.slice(0, 25).map((c) => (
              <CambioConDiferencia key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Un cambio con el antes y el después resaltados (palabras que entran en verde, las que salen tachadas) */
function CambioConDiferencia({ c }: { c: CambioGuardado }) {
  const Icono = ICONO[c.campo]
  const color = COLOR_ESTADO[TONO[c.campo]]
  const texto = (v: unknown) => (typeof v === 'string' ? v : Array.isArray(v) ? v.filter((x) => typeof x === 'string').join('\n') : '')
  let cuerpo: React.ReactNode = null
  if (c.campo === 'titulo' || c.campo === 'bullets') {
    const a = texto(c.antes)
    const d = texto(c.despues)
    cuerpo = (
      <div className="flex flex-col gap-1 text-[12.5px] leading-[1.5]">
        <p className="whitespace-pre-line text-[var(--ls-t3)]">{trozosNuevos(d, a).map((x, i) => (x.nuevo ? <del key={i} style={{ color: COLOR_ESTADO.rojo }}>{x.texto}</del> : <span key={i}>{x.texto}</span>))}</p>
        <p className="whitespace-pre-line rounded-[8px] px-2 py-1 text-[var(--ls-t1)]" style={{ background: mezcla(ACENTO.seo, 7) }}>{trozosNuevos(a, d).map((x, i) => (x.nuevo ? <mark key={i} className="rounded-[3px] px-[1px] text-[var(--ls-t1)]" style={{ background: mezcla(COLOR_ESTADO.verde, 24) }}>{x.texto}</mark> : <span key={i}>{x.texto}</span>))}</p>
      </div>
    )
  } else if (c.campo === 'imagenes') {
    const a = Array.isArray(c.antes) ? (c.antes as string[]) : []
    const d = Array.isArray(c.despues) ? (c.despues as string[]) : []
    cuerpo = (
      <div className="flex items-center gap-2">
        <Miniatura src={a[0]} tamano={56} />
        <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ls-t4)]" />
        <Miniatura src={d[0]} tamano={56} />
        <span className="text-[12px] text-[var(--ls-t4)]">{a.length} → {d.length} imágenes</span>
      </div>
    )
  } else if (c.campo === 'precio') {
    const sube = Number(c.despues) > Number(c.antes)
    cuerpo = (
      <div className="flex items-center gap-2 text-[14px] tabular-nums">
        <span className="text-[var(--ls-t3)] line-through">{precio(Number(c.antes))}</span>
        <ArrowRight className="h-4 w-4 text-[var(--ls-t4)]" />
        <span className="font-semibold" style={{ color: sube ? COLOR_ESTADO.rojo : COLOR_ESTADO.verde }}>{precio(Number(c.despues))}</span>
        {sube ? <TrendingUp className="h-4 w-4" style={{ color: COLOR_ESTADO.rojo }} /> : <TrendingDown className="h-4 w-4" style={{ color: COLOR_ESTADO.verde }} />}
      </div>
    )
  }
  return (
    <div className="rounded-[12px] border border-[var(--ls-linea)] p-3">
      <div className="mb-2 flex items-center gap-2 text-[13px]">
        <span className="flex h-6 w-6 items-center justify-center rounded-[8px]" style={{ background: mezcla(color, 14), color }}>
          <Icono className="h-[13px] w-[13px]" />
        </span>
        <span className="font-semibold text-[var(--ls-t1)]">{NOMBRE_CAMPO_RIVAL[c.campo]}</span>
        <span className="min-w-0 flex-1 truncate text-[var(--ls-t3)]">{c.resumen}</span>
        <span className="shrink-0 text-[12px] text-[var(--ls-t4)]">{new Date(`${c.fecha}T12:00:00Z`).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
      </div>
      {cuerpo}
    </div>
  )
}
