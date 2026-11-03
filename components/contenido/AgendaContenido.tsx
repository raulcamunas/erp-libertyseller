'use client'

import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Plus,
  SkipForward,
  Smartphone,
  Trash2,
  Undo2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { INFO_RED, estadoDeRed, redesEsperadas, type Red } from '@/lib/contenido/redes'
import {
  ETIQUETA_TIPO,
  NOMBRE_DIA,
  NOMBRE_MES,
  aFechaISO,
  pesoLegible,
  type ContenidoPieza,
  type EncargoResuelto,
  type TextoRed,
} from '@/lib/types/contenido'
import { cambiarEstado, quitarDelCalendario, quitarHistoria } from './acciones'
import { BloqueHistoria } from './BloqueHistoria'
import { COLOR_CHIP_TIPO, ICONO_TIPO, esFicheroDeVideo, esVertical, nombreCorto, nombreDeVista, portada, urlPublica } from './comun'
import { TextosPorRed } from './TextosPorRed'

/**
 * LA AGENDA: EL CALENDARIO POR DÍAS, CON TODO A LA VISTA.
 *
 * La pestaña «Semana» enseña tarjetas pequeñas y esconde el detalle detrás de un clic
 * por día. Esta es la otra cara: cada publicación es una fila con lo que hace falta
 * para decidir sin abrir nada —quién publica, qué se sube (el vídeo o las fotos, con
 * su peso) y en qué redes, con los caracteres que lleva el texto de cada una— y, al
 * abrirla, el vídeo o las láminas y los textos tal como se van a pegar.
 *
 * Avisa de dos cosas que en la semana no se veían:
 *   · Los textos que FALTAN: un vídeo va a cuatro redes y puede tener texto en dos.
 *   · Lo que pasó de fecha y sigue «programado»: o se publicó y nadie lo marcó, o se
 *     olvidó, y hasta que alguien lo diga el resumen del plan miente.
 */

const n = (v: number) => v.toLocaleString('es-ES')

interface Props {
  dias: Date[]
  porDia: Map<string, EncargoResuelto[]>
  textosPorPieza: Map<string, TextoRed[]>
  hoyISO: string
  puedeEditar: boolean
  sinTabla: boolean
  usuarioId: string
  onProgramar: (iso: string) => void
  /** Abre el cuadro de nueva historia para ese día */
  onHistoria: (iso: string) => void
  /** Abre el cuadro para cambiar una historia que ya existe */
  onEditarHistoria: (pieza: ContenidoPieza) => void
  onCambio: () => void
}

/** Cuántos textos faltan en una publicación: las redes que le tocan y no tienen texto */
function faltan(pieza: ContenidoPieza, textos: TextoRed[]): Red[] {
  return redesEsperadas(pieza.tipo).filter((red) => {
    if (red === 'linkedin') return pieza.texto_post.trim() === ''
    return !textos.some((t) => t.red === red && t.texto.trim() !== '')
  })
}

/** Lo que se sube, en una línea: «Vídeo MP4 · 41,6 MB · Abrir-Europa-publicar.mp4» */
function queSeSube(p: ContenidoPieza): string {
  const peso = pesoLegible(p.fichero_bytes)
  if (p.tipo === 'video') {
    return ['Vídeo MP4', peso, p.fichero_nombre].filter(Boolean).join(' · ')
  }
  if (p.tipo === 'historia') {
    if (!p.fichero_path) return 'Todavía sin foto ni vídeo'
    return [esFicheroDeVideo(p) ? 'Vídeo' : 'Foto', peso, p.fichero_nombre].filter(Boolean).join(' · ')
  }
  const fotos = p.vistas?.length ?? 0
  return [`${fotos > 0 ? fotos : 'Varias'} fotos`, peso && `ZIP de ${peso}`].filter(Boolean).join(' · ')
}

export function AgendaContenido({
  dias,
  porDia,
  textosPorPieza,
  hoyISO,
  puedeEditar,
  sinTabla,
  usuarioId,
  onProgramar,
  onHistoria,
  onEditarHistoria,
  onCambio,
}: Props) {
  const todos = useMemo(() => dias.flatMap((d) => porDia.get(aFechaISO(d)) ?? []), [dias, porDia])

  // Abiertas al empezar: las de hoy
  const [abiertas, setAbiertas] = useState<ReadonlySet<string>>(
    () => new Set((porDia.get(hoyISO) ?? []).map((e) => e.id))
  )
  const alternar = (id: string) =>
    setAbiertas((prev) => {
      const s = new Set(prev)
      if (s.has(id)) s.delete(id)
      else s.add(id)
      return s
    })

  const videos = todos.filter((e) => e.pieza.tipo === 'video').length
  const historias = todos.filter((e) => e.pieza.tipo === 'historia').length
  const textosQueFaltan = todos.reduce((t, e) => t + faltan(e.pieza, textosPorPieza.get(e.pieza_id) ?? []).length, 0)
  const sinMarcar = todos.filter((e) => e.estado === 'programado' && e.fecha < hoyISO).length

  return (
    <div className="space-y-5">
      {/* ------------------------------------------------ el resumen de la semana */}
      <div className="flex flex-wrap gap-2 text-sm">
        <Dato valor={n(todos.length)} que={todos.length === 1 ? 'publicación' : 'publicaciones'} />
        <Dato valor={n(videos)} que={videos === 1 ? 'vídeo' : 'vídeos'} />
        <Dato valor={n(todos.length - videos - historias)} que={todos.length - videos - historias === 1 ? 'carrusel' : 'carruseles'} />
        <Dato valor={n(historias)} que={historias === 1 ? 'historia' : 'historias'} ayuda="Las historias no tienen cupo: se pueden añadir todas las que se quiera cada día" />
        <Dato
          valor={n(textosQueFaltan)}
          que={textosQueFaltan === 1 ? 'texto por escribir' : 'textos por escribir'}
          aviso={textosQueFaltan > 0}
          ayuda="Un vídeo va a LinkedIn, Instagram, TikTok y Facebook; un carrusel, a LinkedIn. Las historias no llevan texto por red. Cuenta las redes que no tienen texto."
        />
        <Dato
          valor={n(sinMarcar)}
          que={sinMarcar === 1 ? 'pasó de fecha sin marcar' : 'pasaron de fecha sin marcar'}
          aviso={sinMarcar > 0}
          ayuda="Siguen «programado» aunque su día ya pasó: o se publicaron y nadie lo marcó, o se olvidaron."
        />
      </div>

      {sinTabla && (
        <div
          role="status"
          className="flex items-start gap-2 rounded-xl border border-amber-400/30 bg-amber-400/[0.06] px-3.5 py-2.5 text-xs text-amber-200"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Falta lanzar la migración <code className="font-mono">229_contenido_textos_redes.sql</code> en Supabase. Hasta
            entonces solo se ve y se edita el texto de LinkedIn: los de Instagram, TikTok y Facebook no tienen dónde
            guardarse.
          </span>
        </div>
      )}

      {/* ------------------------------------------------ los días */}
      <div className="space-y-5">
        {dias.map((d, i) => {
          const iso = aFechaISO(d)
          const lista = porDia.get(iso) ?? []
          const esHoy = iso === hoyISO
          return (
            <section key={iso} aria-label={`${NOMBRE_DIA[i]} ${d.getDate()}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2">
                <h3
                  className={`text-sm font-semibold ${esHoy ? 'text-[#FF6600]' : 'text-foreground'}`}
                >
                  {NOMBRE_DIA[i]} {d.getDate()} de {NOMBRE_MES[d.getMonth()]}
                </h3>
                {esHoy && (
                  <span className="rounded-full bg-[#FF6600]/15 text-[#FF8A3D] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider">
                    Hoy
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {lista.length === 0
                    ? 'Nada programado'
                    : `${lista.length} ${lista.length === 1 ? 'publicación' : 'publicaciones'}`}
                </span>
                <div className="ml-auto flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-muted-foreground"
                    onClick={() => onHistoria(iso)}
                    title="Añadir una historia este día (sin límite)"
                  >
                    <Smartphone className="h-3.5 w-3.5 mr-1" />
                    Historia
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" onClick={() => onProgramar(iso)}>
                    <Plus className="h-3.5 w-3.5 mr-1" />
                    Programar
                  </Button>
                </div>
              </div>

              {lista.length > 0 && (
                <div
                  className={`rounded-2xl border bg-card overflow-hidden divide-y divide-white/[0.07] ${
                    esHoy ? 'border-[#FF6600]/50' : 'border-white/[0.07]'
                  }`}
                >
                  {lista.map((e) => (
                    <Publicacion
                      key={e.id}
                      e={e}
                      textos={textosPorPieza.get(e.pieza_id) ?? []}
                      vencida={e.estado === 'programado' && e.fecha < hoyISO}
                      abierta={abiertas.has(e.id)}
                      onAlternar={() => alternar(e.id)}
                      puedeEditar={puedeEditar}
                      sinTabla={sinTabla}
                      usuarioId={usuarioId}
                      onEditarHistoria={onEditarHistoria}
                      onCambio={onCambio}
                    />
                  ))}
                </div>
              )}
            </section>
          )
        })}
      </div>
    </div>
  )
}

function Dato({ valor, que, aviso, ayuda }: { valor: string; que: string; aviso?: boolean; ayuda?: string }) {
  return (
    <span
      title={ayuda}
      className={`inline-flex items-baseline gap-1.5 rounded-lg border px-3 py-1.5 ${
        aviso ? 'border-amber-400/40 bg-amber-400/10 text-amber-200' : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <span className="font-bold tabular-nums">{valor}</span>
      <span className={aviso ? 'text-amber-200/80' : 'text-muted-foreground'}>{que}</span>
    </span>
  )
}

/* ------------------------------------------------------------ una publicación */

function Publicacion({
  e,
  textos,
  vencida,
  abierta,
  onAlternar,
  puedeEditar,
  sinTabla,
  usuarioId,
  onEditarHistoria,
  onCambio,
}: {
  e: EncargoResuelto
  textos: TextoRed[]
  vencida: boolean
  abierta: boolean
  onAlternar: () => void
  puedeEditar: boolean
  sinTabla: boolean
  usuarioId: string
  onEditarHistoria: (pieza: ContenidoPieza) => void
  onCambio: () => void
}) {
  const p = e.pieza
  const esVideo = esVertical(p)
  const esHistoria = p.tipo === 'historia'
  const hayVideo = esFicheroDeVideo(p)
  const Icono = ICONO_TIPO[p.tipo]
  const url = urlPublica(p.fichero_path)
  const img = portada(p)
  const [ocupado, setOcupado] = useState(false)

  const hacer = async (accion: () => Promise<boolean>) => {
    setOcupado(true)
    const bien = await accion()
    setOcupado(false)
    if (bien) onCambio()
  }

  return (
    <div className={e.estado === 'saltado' ? 'opacity-60' : ''}>
      {/* ------------------------------------------------ la fila, cerrada */}
      <div
        role="button"
        tabIndex={0}
        aria-expanded={abierta}
        onClick={onAlternar}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ' ') {
            ev.preventDefault()
            onAlternar()
          }
        }}
        className="flex gap-3.5 p-3.5 cursor-pointer hover:bg-white/[0.02] transition-colors"
      >
        {img ? (
          <img
            src={img}
            alt=""
            className={`object-cover rounded-lg border border-white/10 shrink-0 ${
              esVideo ? 'w-[52px] h-[92px]' : 'w-[72px] h-[72px]'
            }`}
          />
        ) : (
          <div
            className={`rounded-lg border border-white/10 bg-white/[0.03] shrink-0 grid place-items-center ${
              esVideo ? 'w-[52px] h-[92px]' : 'w-[72px] h-[72px]'
            }`}
          >
            <Icono className="h-5 w-5 text-[#FF6600]" />
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="h-6 w-6 rounded-full bg-[#FF6600]/15 text-[#FF6600] text-[11px] font-bold grid place-items-center shrink-0">
              {nombreCorto(e.responsable).slice(0, 1)}
            </span>
            <span className="font-semibold">Publica {nombreCorto(e.responsable)}</span>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${COLOR_CHIP_TIPO[p.tipo]}`}
            >
              <Icono className="h-3 w-3" />
              {ETIQUETA_TIPO[p.tipo]}
            </span>
            {e.estado === 'publicado' && (
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 text-emerald-300 px-2 py-0.5 text-[11px] font-medium">
                <Check className="h-3 w-3" />
                Publicado
              </span>
            )}
            {e.estado === 'saltado' && (
              <span className="rounded-full bg-white/10 text-muted-foreground px-2 py-0.5 text-[11px] font-medium">
                Saltado
              </span>
            )}
            {vencida && (
              <span
                className="inline-flex items-center gap-1 rounded-full bg-amber-400/15 text-amber-200 px-2 py-0.5 text-[11px] font-medium"
                title="Su día ya pasó y sigue programado: ¿se publicó?"
              >
                <AlertTriangle className="h-3 w-3" />
                Sin marcar
              </span>
            )}
          </div>

          <div className="mt-1.5 font-semibold leading-snug">{p.titulo}</div>
          {p.angulo && <div className="mt-0.5 text-xs text-muted-foreground line-clamp-1">{p.angulo}</div>}

          <div className="mt-2 text-xs text-muted-foreground">
            <span className="text-foreground/70">Se sube:</span> {queSeSube(p)}
          </div>

          {/* las redes, con lo que mide el texto de cada una (una historia no lleva) */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {redesEsperadas(p.tipo).map((red) => {
              const info = INFO_RED[red]
              const datos =
                red === 'linkedin'
                  ? { texto: p.texto_post, hashtags: [] as string[] }
                  : (() => {
                      const t = textos.find((x) => x.red === red)
                      return t ? { texto: t.texto, hashtags: t.hashtags } : null
                    })()
              const est = estadoDeRed(red, datos)
              return (
                <span
                  key={red}
                  title={
                    est.tiene
                      ? `${info.nombre}: ${n(est.caracteres)} de ${n(est.limite)} caracteres`
                      : `Falta el texto de ${info.nombre}`
                  }
                  className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[11px] ${
                    est.tiene ? 'border-white/10 bg-white/[0.03]' : 'border-dashed border-amber-400/40 text-amber-200/80'
                  }`}
                >
                  {info.nombre}
                  {est.tiene ? (
                    <span
                      className={`tabular-nums font-medium ${
                        est.nivel === 'pasa'
                          ? 'text-red-300'
                          : est.nivel === 'cerca'
                            ? 'text-amber-300'
                            : 'text-emerald-300'
                      }`}
                    >
                      {n(est.caracteres)}
                    </span>
                  ) : (
                    <span>falta</span>
                  )}
                </span>
              )
            })}
          </div>
        </div>

        <div className="shrink-0 self-center text-muted-foreground">
          {abierta ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </div>

      {/* ------------------------------------------------ el detalle, abierto */}
      {abierta && (
        <div className="border-t border-white/[0.07] bg-black/20 p-4 grid gap-5 lg:grid-cols-[minmax(240px,300px)_1fr]">
          <div className="space-y-3 min-w-0">
            {esHistoria && url && !hayVideo ? (
              <img src={url} alt="" className="w-full max-h-[460px] rounded-lg border border-white/10 bg-black object-contain" />
            ) : null}

            {hayVideo && url ? (
              <video
                src={url}
                controls
                playsInline
                preload="metadata"
                poster={img ?? undefined}
                className="w-full max-h-[460px] rounded-lg border border-white/10 bg-black"
              />
            ) : null}

            {p.tipo === 'carrusel' && p.vistas?.length ? (
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{p.vistas.length} fotos, en este orden</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {p.vistas.map((v, i) => (
                    <a
                      key={v}
                      href={urlPublica(v) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      title={nombreDeVista(v)}
                      className="group relative"
                    >
                      <img
                        src={urlPublica(v) ?? ''}
                        alt={`Foto ${i + 1}`}
                        className="w-full aspect-[4/5] object-cover rounded border border-white/10 group-hover:border-[#FF6600]/60 transition-colors"
                      />
                      <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] tabular-nums">
                        {i + 1}
                      </span>
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            <dl className="text-xs space-y-1 text-muted-foreground">
              <div className="flex gap-2">
                <dt className="w-14 shrink-0">Fichero</dt>
                <dd className="min-w-0 break-words text-foreground/80">{p.fichero_nombre ?? '—'}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-14 shrink-0">Peso</dt>
                <dd className="text-foreground/80">{pesoLegible(p.fichero_bytes) || '—'}</dd>
              </div>
              {p.tipo === 'carrusel' && p.vistas?.length ? (
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0">Dentro</dt>
                  <dd className="min-w-0 break-words text-foreground/80">
                    {nombreDeVista(p.vistas[0])} … {nombreDeVista(p.vistas[p.vistas.length - 1])}
                  </dd>
                </div>
              ) : null}
              {e.nota && (
                <div className="flex gap-2">
                  <dt className="w-14 shrink-0">Nota</dt>
                  <dd className="text-foreground/80">{e.nota}</dd>
                </div>
              )}
            </dl>

            {url && (
              <a href={url} download={p.fichero_nombre ?? undefined} className="block">
                <Button variant="outline" size="sm" className="w-full">
                  <Download className="h-4 w-4 mr-2" />
                  {p.tipo === 'video'
                    ? 'Descargar el vídeo'
                    : esHistoria
                      ? hayVideo
                        ? 'Descargar el vídeo de la historia'
                        : 'Descargar la foto de la historia'
                      : `Descargar las ${p.vistas?.length || ''} fotos`.replace('  ', ' ')}
                </Button>
              </a>
            )}
          </div>

          <div className="min-w-0 space-y-4">
            {esHistoria ? (
              <BloqueHistoria pieza={p} onEditar={() => onEditarHistoria(p)} />
            ) : (
              <TextosPorRed
                pieza={p}
                textos={textos}
                puedeEditar={puedeEditar}
                sinTabla={sinTabla}
                usuarioId={usuarioId}
                onCambio={onCambio}
              />
            )}

            <div className="flex flex-wrap gap-2 pt-1 border-t border-white/[0.07]">
              {e.estado !== 'publicado' ? (
                <Button size="sm" disabled={ocupado} onClick={() => hacer(() => cambiarEstado(e.id, 'publicado'))}>
                  <Check className="h-4 w-4 mr-1" />
                  Marcar publicado
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => hacer(() => cambiarEstado(e.id, 'programado'))}
                >
                  <Undo2 className="h-4 w-4 mr-1" />
                  Deshacer
                </Button>
              )}
              {e.estado !== 'saltado' && (
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => hacer(() => cambiarEstado(e.id, 'saltado'))}
                >
                  <SkipForward className="h-4 w-4 mr-1" />
                  Saltar
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-muted-foreground"
                disabled={ocupado}
                onClick={() => hacer(() => (esHistoria ? quitarHistoria(p.id, p.fichero_path) : quitarDelCalendario(e.id)))}
                title="Quitar del calendario"
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {esHistoria ? 'Quitar la historia' : 'Quitar'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
