'use client'

import { useId, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { AlertTriangle, Copy, Pencil, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  INFO_RED,
  caracteres,
  componer,
  contarHashtags,
  estadoDeRed,
  nivelLongitud,
  normalizarHashtags,
  redesEsperadas,
  type EstadoRed,
  type NivelLongitud,
  type Red,
} from '@/lib/contenido/redes'
import type { ContenidoPieza, TextoRed } from '@/lib/types/contenido'

/**
 * EL TEXTO DE UNA PIEZA EN CADA RED, CON SU CONTADOR.
 *
 * Arriba, una pestaña por red con los caracteres que lleva (y un hueco punteado si
 * falta el texto): con un vistazo se ve qué está listo y qué no. Debajo, el texto de la
 * red elegida tal como se va a pegar —con los hashtags debajo—, cuánto ocupa de lo que
 * admite la red, y los botones de copiar.
 *
 * Quien es admin o partner puede escribir o corregir cualquier texto desde aquí. El de
 * LinkedIn se guarda donde siempre (contenido_piezas.texto_post); los demás, en
 * contenido_textos (migración 229).
 */

const n = (v: number) => v.toLocaleString('es-ES')

const COLOR_NIVEL: Record<NivelLongitud, { texto: string; barra: string }> = {
  ok: { texto: 'text-emerald-300', barra: 'bg-emerald-400' },
  cerca: { texto: 'text-amber-300', barra: 'bg-amber-400' },
  pasa: { texto: 'text-red-300', barra: 'bg-red-400' },
}

interface DatosRed {
  texto: string
  hashtags: string[]
  comentario: string | null
}

export function TextosPorRed({
  pieza,
  textos,
  puedeEditar,
  sinTabla,
  usuarioId,
  onCambio,
  inicial,
}: {
  pieza: ContenidoPieza
  /** Solo los de ESTA pieza */
  textos: TextoRed[]
  puedeEditar: boolean
  /** La migración 229 no está lanzada: no hay dónde guardar los textos de las otras redes */
  sinTabla: boolean
  usuarioId: string
  onCambio: () => void
  inicial?: Red
}) {
  const porRed = useMemo(() => new Map(textos.map((t) => [t.red, t])), [textos])

  /** Las que corresponden al tipo de pieza, más cualquier otra que ya tenga texto */
  const redes = useMemo(() => {
    const base: Red[] = [...redesEsperadas(pieza.tipo)]
    for (const t of textos) if (!base.includes(t.red)) base.push(t.red)
    return base
  }, [pieza.tipo, textos])

  const [activa, setActiva] = useState<Red>(inicial && redes.includes(inicial) ? inicial : redes[0])
  const [editando, setEditando] = useState(false)

  const datosDe = (red: Red): DatosRed | null => {
    if (red === 'linkedin') {
      return pieza.texto_post.trim() ? { texto: pieza.texto_post, hashtags: [], comentario: null } : null
    }
    const t = porRed.get(red)
    return t ? { texto: t.texto, hashtags: t.hashtags, comentario: t.comentario_fijado } : null
  }

  const estados = new Map<Red, EstadoRed>(redes.map((r) => [r, estadoDeRed(r, datosDe(r))]))
  const datos = datosDe(activa)
  const est = estados.get(activa)!
  const info = INFO_RED[activa]

  const copiar = async (texto: string, que: string) => {
    try {
      await navigator.clipboard.writeText(texto)
      toast.success(`${que} copiado`)
    } catch {
      toast.error('No se ha podido copiar. Selecciónalo y copia a mano.')
    }
  }

  return (
    <div className="space-y-3">
      {/* ------------------------------------------------ una pestaña por red */}
      <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Redes">
        {redes.map((r) => {
          const e = estados.get(r)!
          const sel = r === activa
          const rotulo = e.tiene
            ? `${INFO_RED[r].nombre}: ${n(e.caracteres)} de ${n(e.limite)} caracteres`
            : `${INFO_RED[r].nombre}: falta el texto`
          return (
            <button
              key={r}
              type="button"
              role="tab"
              aria-selected={sel}
              aria-label={rotulo}
              onClick={() => {
                setActiva(r)
                setEditando(false)
              }}
              className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors ${
                sel
                  ? 'border-[#FF6600]/70 bg-[#FF6600]/10 text-foreground'
                  : e.tiene
                    ? 'border-white/10 bg-white/[0.03] text-foreground/80 hover:border-white/25'
                    : 'border-dashed border-white/20 text-muted-foreground hover:border-white/40'
              }`}
              title={rotulo}
            >
              {INFO_RED[r].nombre}
              {e.tiene ? (
                <span className={`tabular-nums ${COLOR_NIVEL[e.nivel].texto}`}>{n(e.caracteres)}</span>
              ) : (
                <span className="text-amber-300/80">falta</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ------------------------------------------------ la red elegida */}
      <div role="tabpanel" aria-label={info.nombre} className="space-y-3">
        {editando ? (
          <Editor
            key={activa}
            pieza={pieza}
            red={activa}
            datos={datos}
            usuarioId={usuarioId}
            sinTabla={sinTabla}
            onCancelar={() => setEditando(false)}
            onGuardado={() => {
              setEditando(false)
              onCambio()
            }}
          />
        ) : datos === null ? (
          <div className="rounded-xl border border-dashed border-white/15 p-4 text-sm text-muted-foreground flex flex-wrap items-center gap-3">
            <span>Todavía no hay texto para {info.nombre}.</span>
            {puedeEditar && !(sinTabla && activa !== 'linkedin') && (
              <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                <Plus className="h-3.5 w-3.5 mr-1" />
                Escribirlo
              </Button>
            )}
            {sinTabla && activa !== 'linkedin' && (
              <span className="text-xs text-amber-300">
                Falta lanzar la migración 229_contenido_textos_redes.sql para poder guardar textos de {info.nombre}.
              </span>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            <Medidor est={est} />

            {est.demasiadosHashtags && (
              <div className="flex items-center gap-1.5 text-xs text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {est.hashtags} hashtags: {info.nombre} {info.hashtagsDuros ? 'admite' : 'recomienda'} {info.maxHashtags} como
                mucho.
              </div>
            )}

            <div className="rounded-xl border border-white/10 bg-background p-3.5">
              <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words">{datos.texto}</div>
              {datos.hashtags.length > 0 && (
                <div className="mt-3 text-[13px] text-[#FF8A3D] break-words">{datos.hashtags.join(' ')}</div>
              )}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copiar(componer(datos.texto, datos.hashtags), `Texto de ${info.nombre}`)}>
                <Copy className="h-3.5 w-3.5 mr-1.5" />
                Copiar texto
              </Button>
              {puedeEditar && !(sinTabla && activa !== 'linkedin') && (
                <Button size="sm" variant="outline" onClick={() => setEditando(true)}>
                  <Pencil className="h-3.5 w-3.5 mr-1.5" />
                  Editar
                </Button>
              )}
            </div>

            {datos.comentario && (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Comentario fijado · {n(caracteres(datos.comentario))} caracteres
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    onClick={() => copiar(datos.comentario ?? '', 'Comentario')}
                  >
                    <Copy className="h-3 w-3 mr-1" />
                    Copiar
                  </Button>
                </div>
                <div className="text-[13px] leading-relaxed whitespace-pre-wrap break-words text-foreground/90">
                  {datos.comentario}
                </div>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground">{info.ayuda}</p>
          </div>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------ el medidor */

function Medidor({ est }: { est: EstadoRed }) {
  const color = COLOR_NIVEL[est.nivel]
  const pct = Math.min(100, (est.caracteres / est.limite) * 100)
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className={`font-semibold tabular-nums ${color.texto}`}>
          {n(est.caracteres)} <span className="font-normal text-muted-foreground">de {n(est.limite)} caracteres</span>
        </span>
        <span className="text-muted-foreground tabular-nums">
          {est.hashtags > 0 ? `${est.hashtags} ${est.hashtags === 1 ? 'hashtag' : 'hashtags'}` : 'sin hashtags'}
        </span>
      </div>
      <div className="mt-1.5 h-1 rounded-full bg-white/10 overflow-hidden">
        <div className={`h-full rounded-full ${color.barra}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/* ----------------------------------------------------------- el editor */

function Editor({
  pieza,
  red,
  datos,
  usuarioId,
  sinTabla,
  onCancelar,
  onGuardado,
}: {
  pieza: ContenidoPieza
  red: Red
  datos: DatosRed | null
  usuarioId: string
  sinTabla: boolean
  onCancelar: () => void
  onGuardado: () => void
}) {
  const info = INFO_RED[red]
  const esLinkedin = red === 'linkedin'
  const [texto, setTexto] = useState(datos?.texto ?? '')
  const [hashtags, setHashtags] = useState((datos?.hashtags ?? []).join(' '))
  const [comentario, setComentario] = useState(datos?.comentario ?? '')
  const [guardando, setGuardando] = useState(false)
  const idTexto = useId()
  const idHashtags = useId()
  const idComentario = useId()

  const lista = normalizarHashtags(hashtags)
  // Los de la lista y los que el texto lleve escritos dentro: todos se publican
  const nHashtags = contarHashtags(texto, lista)
  // Lo que se va a pegar de verdad: el texto con los hashtags debajo
  const total = caracteres(componer(texto, lista))
  const nivel = nivelLongitud(total, info.limite)
  const demasiados = info.maxHashtags !== null && nHashtags > info.maxHashtags

  const guardar = async () => {
    if (texto.trim() === '') {
      toast.error('El texto no puede estar vacío')
      return
    }
    setGuardando(true)
    const supabase = createClient()
    const { error } = esLinkedin
      ? await supabase.from('contenido_piezas').update({ texto_post: texto }).eq('id', pieza.id)
      : await supabase.from('contenido_textos').upsert(
          {
            pieza_id: pieza.id,
            red,
            texto,
            hashtags: lista,
            comentario_fijado: comentario.trim() === '' ? null : comentario,
            actualizado_at: new Date().toISOString(),
            actualizado_por: usuarioId,
          },
          { onConflict: 'pieza_id,red' }
        )
    setGuardando(false)
    if (error) {
      console.error(error)
      toast.error(
        error.code === '42501'
          ? 'No tienes permiso para editar textos'
          : error.code === '42P01' || error.code === 'PGRST205'
            ? 'Falta lanzar la migración 229 en Supabase'
            : 'No se ha podido guardar'
      )
      return
    }
    toast.success(`Texto de ${info.nombre} guardado`)
    onGuardado()
  }

  return (
    <div className="space-y-3 rounded-xl border border-[#FF6600]/40 bg-[#FF6600]/[0.04] p-3.5">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between text-xs">
          <label htmlFor={idTexto} className="font-medium">
            Texto para {info.nombre}
          </label>
          <span className={`tabular-nums ${COLOR_NIVEL[nivel].texto}`}>
            {n(total)} / {n(info.limite)}
          </span>
        </div>
        <Textarea
          id={idTexto}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          className="min-h-[220px] text-[13px] leading-relaxed"
          placeholder={info.ayuda}
        />
      </div>

      {!esLinkedin && (
        <>
          <div className="space-y-1.5">
            <label htmlFor={idHashtags} className="text-xs font-medium">
              Hashtags
            </label>
            <Input
              id={idHashtags}
              aria-describedby={`${idHashtags}-cuenta`}
              value={hashtags}
              onChange={(e) => setHashtags(e.target.value)}
              placeholder="#amazonfba #ecommerce"
            />
            <p
              id={`${idHashtags}-cuenta`}
              className={`text-[11px] ${demasiados ? 'text-amber-300' : 'text-muted-foreground'}`}
            >
              {nHashtags} {nHashtags === 1 ? 'hashtag' : 'hashtags'}
              {nHashtags > lista.length && ' (contando los que van dentro del texto)'}
              {info.maxHashtags !== null && ` · ${info.hashtagsDuros ? 'máximo' : 'recomendado'} ${info.maxHashtags}`}
            </p>
          </div>

          <div className="space-y-1.5">
            <label htmlFor={idComentario} className="text-xs font-medium">
              Comentario fijado <span className="text-muted-foreground font-normal">(opcional)</span>
            </label>
            <Textarea
              id={idComentario}
              value={comentario}
              onChange={(e) => setComentario(e.target.value)}
              className="min-h-[110px] text-[13px]"
              placeholder={
                red === 'tiktok'
                  ? 'En TikTok un comentario admite solo 150 caracteres'
                  : 'La cuenta paso a paso, la regla… lo que quieras dejar como primer comentario'
              }
            />
          </div>
        </>
      )}

      {sinTabla && !esLinkedin && (
        <p className="text-xs text-amber-300">
          Falta lanzar la migración 229_contenido_textos_redes.sql: sin ella no se puede guardar.
        </p>
      )}

      <div className="flex gap-2">
        <Button size="sm" onClick={guardar} disabled={guardando || (sinTabla && !esLinkedin)}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancelar} disabled={guardando}>
          Cancelar
        </Button>
      </div>
    </div>
  )
}
