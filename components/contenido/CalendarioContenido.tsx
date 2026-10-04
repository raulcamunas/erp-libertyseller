'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileText,
  Film,
  Plus,
  SkipForward,
  Trash2,
  Undo2,
  Upload,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  aFechaISO,
  diasDeLaSemana,
  lunesDe,
  pesoLegible,
  rotuloSemana,
  ETIQUETA_TIPO,
  NOMBRE_DIA,
  NOMBRE_MES,
  type ContenidoPieza,
  type EncargoResuelto,
  type EstadoEncargo,
  type TipoPieza,
} from '@/lib/types/contenido'

type Perfil = { id: string; full_name: string | null; email: string | null; role?: string }

interface Props {
  encargos: EncargoResuelto[]
  piezas: ContenidoPieza[]
  perfiles: Perfil[]
  usuarioId: string
  puedeGestionarPiezas: boolean
}

const BUCKET = 'contenido'

/** «Raúl Camuñas» → «Raúl». En una celda de calendario no cabe el apellido. */
const nombreCorto = (p: Perfil) => (p.full_name ?? p.email ?? '—').split(' ')[0]

const urlPublica = (path: string | null) => {
  if (!path) return null
  const supabase = createClient()
  return supabase.storage.from(BUCKET).getPublicUrl(path).data.publicUrl
}

const ICONO_TIPO: Record<TipoPieza, typeof Film> = { video: Film, carrusel: FileText }

/** La primera imagen de la pieza: la lámina 1 de un carrusel, o el fotograma
 *  de portada de un vídeo. Null si todavía no se subieron (piezas de antes de
 *  la migración 218). */
const portada = (p: ContenidoPieza) => (p.vistas?.length ? urlPublica(p.vistas[0]) : null)

export function CalendarioContenido({
  encargos,
  piezas,
  perfiles,
  usuarioId,
  puedeGestionarPiezas,
}: Props) {
  const router = useRouter()
  const [lunes, setLunes] = useState(() => lunesDe(new Date()))
  const [diaAbierto, setDiaAbierto] = useState<string | null>(null)
  const [programando, setProgramando] = useState<string | null>(null)
  const [pestana, setPestana] = useState('semana')

  const dias = useMemo(() => diasDeLaSemana(lunes), [lunes])
  const hoyISO = aFechaISO(new Date())

  /** Los encargos agrupados por día, que es como se pintan. */
  const porDia = useMemo(() => {
    const m = new Map<string, EncargoResuelto[]>()
    for (const e of encargos) {
      const l = m.get(e.fecha) ?? []
      l.push(e)
      m.set(e.fecha, l)
    }
    return m
  }, [encargos])

  const mueveSemana = (n: number) => {
    const d = new Date(lunes)
    d.setDate(lunes.getDate() + n * 7)
    setLunes(d)
  }

  const delDia = (iso: string) => porDia.get(iso) ?? []

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <CalendarDays className="h-6 w-6 text-[#FF6600]" />
            Calendario de contenido
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Qué publica cada uno y qué día. El fichero y el texto, adjuntos.
          </p>
        </div>
      </div>

      <Tabs value={pestana} onValueChange={setPestana}>
        <TabsList>
          <TabsTrigger value="semana">Semana</TabsTrigger>
          <TabsTrigger value="piezas">Piezas ({piezas.length})</TabsTrigger>
        </TabsList>

        {/* ------------------------------------------------------ la semana */}
        <TabsContent value="semana" className="space-y-4">
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => mueveSemana(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLunes(lunesDe(new Date()))}>
              Hoy
            </Button>
            <Button variant="outline" size="sm" onClick={() => mueveSemana(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="ml-2">
              <span className="font-semibold capitalize">
                {NOMBRE_MES[lunes.getMonth()]} {lunes.getFullYear()}
              </span>
              <span className="text-muted-foreground text-sm ml-2">{rotuloSemana(lunes)}</span>
            </div>
          </div>

          {/* Siete columnas en pantalla ancha; en móvil se apilan, porque siete
              columnas de 50 px no dejan leer ni el nombre. */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3">
            {dias.map((d, i) => {
              const iso = aFechaISO(d)
              const lista = delDia(iso)
              const esHoy = iso === hoyISO
              return (
                <Card
                  key={iso}
                  className={`min-h-[170px] transition-colors ${
                    esHoy ? 'border-[#FF6600]/60 shadow-[0_0_24px_rgba(255,102,0,0.12)]' : ''
                  }`}
                >
                  <CardContent className="p-3 space-y-2">
                    <button
                      onClick={() => setDiaAbierto(iso)}
                      className="w-full text-left group"
                      title="Ver el día"
                    >
                      <div className="flex items-baseline justify-between">
                        <span className="text-xs uppercase tracking-wider text-muted-foreground">
                          {NOMBRE_DIA[i].slice(0, 3)}
                        </span>
                        <span
                          className={`text-lg font-bold ${esHoy ? 'text-[#FF6600]' : ''}`}
                        >
                          {d.getDate()}
                        </span>
                      </div>
                    </button>

                    <div className="space-y-1.5">
                      {lista.map((e) => {
                        const Icono = ICONO_TIPO[e.pieza.tipo]
                        return (
                          <button
                            key={e.id}
                            onClick={() => setDiaAbierto(iso)}
                            className={`w-full text-left rounded-md border px-2 py-1.5 text-xs
                              hover:border-[#FF6600]/50 transition-colors ${
                                e.estado === 'publicado'
                                  ? 'opacity-55 line-through decoration-1'
                                  : e.estado === 'saltado'
                                    ? 'opacity-40'
                                    : ''
                              }`}
                          >
                            <div className="flex gap-2">
                              {/* La miniatura es lo que hace que el día se lea
                                  de un vistazo: el nombre y el tipo solos son
                                  una fila de texto gris igual a las demás. */}
                              {portada(e.pieza) ? (
                                <img
                                  src={portada(e.pieza)!}
                                  alt=""
                                  className="w-10 h-[52px] object-cover rounded border border-white/10 shrink-0"
                                />
                              ) : null}
                              <div className="min-w-0">
                                <div className="flex items-center gap-1.5 font-semibold">
                                  <Icono className="h-3 w-3 shrink-0 text-[#FF6600]" />
                                  <span className="truncate">{nombreCorto(e.responsable)}</span>
                                </div>
                                <div className="text-muted-foreground truncate mt-0.5">
                                  {ETIQUETA_TIPO[e.pieza.tipo]}
                                </div>
                                <div className="text-muted-foreground truncate text-[11px] leading-tight">
                                  {e.pieza.titulo}
                                </div>
                              </div>
                            </div>
                          </button>
                        )
                      })}
                    </div>

                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full h-7 text-xs text-muted-foreground"
                      onClick={() => setProgramando(iso)}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      Programar
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <ResumenSemana dias={dias} porDia={porDia} perfiles={perfiles} />
        </TabsContent>

        {/* ------------------------------------------------------- las piezas */}
        <TabsContent value="piezas">
          <Piezas
            piezas={piezas}
            puedeGestionar={puedeGestionarPiezas}
            usuarioId={usuarioId}
            onCambio={() => router.refresh()}
          />
        </TabsContent>
      </Tabs>

      {diaAbierto && (
        <DetalleDia
          iso={diaAbierto}
          encargos={delDia(diaAbierto)}
          onCerrar={() => setDiaAbierto(null)}
          onProgramar={() => {
            setProgramando(diaAbierto)
            setDiaAbierto(null)
          }}
          onCambio={() => router.refresh()}
        />
      )}

      {programando && (
        <Programar
          iso={programando}
          piezas={piezas}
          perfiles={perfiles}
          usuarioId={usuarioId}
          onCerrar={() => setProgramando(null)}
          onHecho={() => {
            setProgramando(null)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

/* ------------------------------------------------------------- el resumen */

/**
 * El plan son tres vídeos y seis carruseles por semana. Esto dice si se cumple,
 * que es la única cifra que hay que mirar de un vistazo.
 */
function ResumenSemana({
  dias,
  porDia,
  perfiles,
}: {
  dias: Date[]
  porDia: Map<string, EncargoResuelto[]>
  perfiles: Perfil[]
}) {
  const todos = dias.flatMap((d) => porDia.get(aFechaISO(d)) ?? [])
  const videos = todos.filter((e) => e.pieza.tipo === 'video').length
  const carruseles = todos.filter((e) => e.pieza.tipo === 'carrusel').length
  const publicados = todos.filter((e) => e.estado === 'publicado').length

  const porPersona = perfiles
    .map((p) => ({ p, n: todos.filter((e) => e.responsable_id === p.id).length }))
    .filter((x) => x.n > 0)
    .sort((a, b) => b.n - a.n)

  const Cifra = ({ n, de, que }: { n: number; de: number; que: string }) => (
    <div className="flex items-baseline gap-1.5">
      <span className={`text-xl font-bold ${n >= de ? 'text-[#FF6600]' : ''}`}>{n}</span>
      <span className="text-muted-foreground text-sm">
        / {de} {que}
      </span>
    </div>
  )

  return (
    <Card>
      <CardContent className="p-4 flex flex-wrap items-center gap-x-8 gap-y-3">
        <Cifra n={videos} de={3} que="vídeos" />
        <Cifra n={carruseles} de={6} que="carruseles" />
        <div className="text-sm text-muted-foreground">
          {publicados} de {todos.length} ya publicados
        </div>
        <div className="flex flex-wrap gap-2 ml-auto">
          {porPersona.map(({ p, n }) => (
            <Badge key={p.id} variant="secondary">
              {nombreCorto(p)} · {n}
            </Badge>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

/* -------------------------------------------------------- el día, abierto */

function DetalleDia({
  iso,
  encargos,
  onCerrar,
  onProgramar,
  onCambio,
}: {
  iso: string
  encargos: EncargoResuelto[]
  onCerrar: () => void
  onProgramar: () => void
  onCambio: () => void
}) {
  const [y, m, d] = iso.split('-').map(Number)
  const fecha = new Date(y, m - 1, d)
  const [ocupado, setOcupado] = useState<string | null>(null)

  const marcar = async (e: EncargoResuelto, estado: EstadoEncargo) => {
    setOcupado(e.id)
    const supabase = createClient()
    const { error } = await supabase
      .from('contenido_calendario')
      .update({
        estado,
        publicado_at: estado === 'publicado' ? new Date().toISOString() : null,
      })
      .eq('id', e.id)
    setOcupado(null)
    if (error) {
      toast.error('No se pudo cambiar el estado')
      return
    }
    toast.success(estado === 'publicado' ? 'Marcado como publicado' : 'Estado actualizado')
    onCambio()
  }

  const quitar = async (e: EncargoResuelto) => {
    setOcupado(e.id)
    const supabase = createClient()
    const { error } = await supabase.from('contenido_calendario').delete().eq('id', e.id)
    setOcupado(null)
    if (error) {
      toast.error('No se pudo quitar del calendario')
      return
    }
    toast.success('Quitado del calendario')
    onCambio()
  }

  const copiar = async (texto: string) => {
    await navigator.clipboard.writeText(texto)
    toast.success('Texto copiado')
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="capitalize">
            {NOMBRE_DIA[(fecha.getDay() + 6) % 7]} {fecha.getDate()} de{' '}
            {NOMBRE_MES[fecha.getMonth()]}
          </DialogTitle>
          <DialogDescription>
            {encargos.length === 0
              ? 'No hay nada programado este día.'
              : `${encargos.length} ${encargos.length === 1 ? 'publicación' : 'publicaciones'}.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {encargos.map((e) => {
            const url = urlPublica(e.pieza.fichero_path)
            const Icono = ICONO_TIPO[e.pieza.tipo]
            return (
              <Card key={e.id}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="default">{nombreCorto(e.responsable)}</Badge>
                        <Badge variant="outline">
                          <Icono className="h-3 w-3 mr-1" />
                          {ETIQUETA_TIPO[e.pieza.tipo]}
                        </Badge>
                        {e.estado === 'publicado' && <Badge variant="secondary">Publicado</Badge>}
                        {e.estado === 'saltado' && <Badge variant="destructive">Saltado</Badge>}
                      </div>
                      <div className="font-semibold mt-2">{e.pieza.titulo}</div>
                      {e.pieza.angulo && (
                        <div className="text-sm text-muted-foreground mt-0.5">{e.pieza.angulo}</div>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ocupado === e.id}
                      onClick={() => quitar(e)}
                      title="Quitar del calendario"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {/* LO QUE HAY QUE SUBIR, a la vista.
                      Un vídeo se reproduce aquí mismo; un carrusel enseña sus
                      láminas en una tira. El botón de descarga va DEBAJO, que
                      es el orden en que se usa: primero miras qué es, luego te
                      lo llevas. */}
                  {e.pieza.tipo === 'video' && url ? (
                    <video
                      src={url}
                      controls
                      playsInline
                      poster={portada(e.pieza) ?? undefined}
                      className="w-full rounded-lg border border-white/10 max-h-[420px] bg-black"
                    />
                  ) : null}

                  {e.pieza.tipo === 'carrusel' && e.pieza.vistas?.length ? (
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        {e.pieza.vistas.length} láminas
                      </Label>
                      <div className="flex gap-2 overflow-x-auto pb-2">
                        {e.pieza.vistas.map((v, n) => (
                          <a
                            key={v}
                            href={urlPublica(v) ?? undefined}
                            target="_blank"
                            rel="noreferrer"
                            className="shrink-0"
                            title={`Lámina ${n + 1}`}
                          >
                            <img
                              src={urlPublica(v)!}
                              alt={`Lámina ${n + 1}`}
                              className="h-44 rounded border border-white/10 hover:border-[#FF6600]/60 transition-colors"
                            />
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {url && (
                    <a href={url} download={e.pieza.fichero_nombre ?? undefined}>
                      <Button variant="outline" size="sm" className="w-full">
                        <Download className="h-4 w-4 mr-2" />
                        {e.pieza.fichero_nombre ?? 'Descargar'}
                        {e.pieza.fichero_bytes ? (
                          <span className="ml-2 text-muted-foreground">
                            {pesoLegible(e.pieza.fichero_bytes)}
                          </span>
                        ) : null}
                      </Button>
                    </a>
                  )}

                  {e.pieza.texto_post && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs text-muted-foreground">Texto del post</Label>
                        <Button variant="ghost" size="sm" onClick={() => copiar(e.pieza.texto_post)}>
                          <Copy className="h-3 w-3 mr-1" />
                          Copiar
                        </Button>
                      </div>
                      <Textarea
                        readOnly
                        value={e.pieza.texto_post}
                        className="min-h-[150px] text-sm font-normal"
                      />
                    </div>
                  )}

                  <div className="flex gap-2">
                    {e.estado !== 'publicado' ? (
                      <Button
                        size="sm"
                        disabled={ocupado === e.id}
                        onClick={() => marcar(e, 'publicado')}
                      >
                        <Check className="h-4 w-4 mr-1" />
                        Publicado
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={ocupado === e.id}
                        onClick={() => marcar(e, 'programado')}
                      >
                        <Undo2 className="h-4 w-4 mr-1" />
                        Deshacer
                      </Button>
                    )}
                    {e.estado !== 'saltado' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={ocupado === e.id}
                        onClick={() => marcar(e, 'saltado')}
                      >
                        <SkipForward className="h-4 w-4 mr-1" />
                        Saltar
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}

          <Button variant="outline" className="w-full" onClick={onProgramar}>
            <Plus className="h-4 w-4 mr-2" />
            Programar algo este día
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* --------------------------------------------------------- programar algo */

function Programar({
  iso,
  piezas,
  perfiles,
  usuarioId,
  onCerrar,
  onHecho,
}: {
  iso: string
  piezas: ContenidoPieza[]
  perfiles: Perfil[]
  usuarioId: string
  onCerrar: () => void
  onHecho: () => void
}) {
  const [piezaId, setPiezaId] = useState('')
  const [responsableId, setResponsableId] = useState('')
  const [guardando, setGuardando] = useState(false)

  const guardar = async () => {
    if (!piezaId || !responsableId) return
    setGuardando(true)
    const supabase = createClient()
    const { error } = await supabase.from('contenido_calendario').insert({
      fecha: iso,
      pieza_id: piezaId,
      responsable_id: responsableId,
      creado_por: usuarioId,
    })
    setGuardando(false)
    if (error) {
      // 23505 es la UNIQUE de (fecha, pieza, responsable). Decirlo con palabras:
      // el mensaje de Postgres habla de un índice que nadie conoce.
      toast.error(
        error.code === '23505'
          ? 'Esa pieza ya está programada para esa persona ese día'
          : 'No se pudo programar',
      )
      return
    }
    toast.success('Programado')
    onHecho()
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Programar</DialogTitle>
          <DialogDescription>{iso}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Pieza</Label>
            <Select value={piezaId} onValueChange={setPiezaId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige una pieza" />
              </SelectTrigger>
              <SelectContent>
                {piezas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {ETIQUETA_TIPO[p.tipo]} · {p.titulo}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Quién lo publica</Label>
            <Select value={responsableId} onValueChange={setResponsableId}>
              <SelectTrigger>
                <SelectValue placeholder="Elige a alguien" />
              </SelectTrigger>
              <SelectContent>
                {perfiles.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.full_name ?? p.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            className="w-full"
            disabled={!piezaId || !responsableId || guardando}
            onClick={guardar}
          >
            {guardando ? 'Guardando…' : 'Programar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------------------------------------------------- las piezas */

function Piezas({
  piezas,
  puedeGestionar,
  usuarioId,
  onCambio,
}: {
  piezas: ContenidoPieza[]
  puedeGestionar: boolean
  usuarioId: string
  onCambio: () => void
}) {
  const [abierto, setAbierto] = useState(false)

  return (
    <div className="space-y-4">
      {puedeGestionar && (
        <Button onClick={() => setAbierto(true)}>
          <Upload className="h-4 w-4 mr-2" />
          Subir una pieza
        </Button>
      )}

      {piezas.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            Todavía no hay piezas. Súbelas aquí o déjalas desde el repo de vídeos.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {piezas.map((p) => {
            const url = urlPublica(p.fichero_path)
            const Icono = ICONO_TIPO[p.tipo]
            return (
              <Card key={p.id}>
                <CardContent className="p-4 space-y-2">
                  <div className="flex gap-3">
                    {portada(p) ? (
                      <img
                        src={portada(p)!}
                        alt=""
                        className="w-20 rounded border border-white/10 object-cover shrink-0"
                      />
                    ) : null}
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline">
                          <Icono className="h-3 w-3 mr-1" />
                          {ETIQUETA_TIPO[p.tipo]}
                        </Badge>
                        {p.vistas?.length > 1 && (
                          <Badge variant="secondary">{p.vistas.length} láminas</Badge>
                        )}
                        <span className="text-xs text-muted-foreground">{p.slug}</span>
                      </div>
                      <div className="font-semibold">{p.titulo}</div>
                      {p.angulo && <div className="text-sm text-muted-foreground">{p.angulo}</div>}
                    </div>
                  </div>
                  {url && (
                    <a href={url} download={p.fichero_nombre ?? undefined}>
                      <Button variant="outline" size="sm" className="w-full">
                        <Download className="h-4 w-4 mr-2" />
                        {p.fichero_nombre} · {pesoLegible(p.fichero_bytes)}
                      </Button>
                    </a>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {abierto && (
        <SubirPieza
          usuarioId={usuarioId}
          onCerrar={() => setAbierto(false)}
          onHecho={() => {
            setAbierto(false)
            onCambio()
          }}
        />
      )}
    </div>
  )
}

function SubirPieza({
  usuarioId,
  onCerrar,
  onHecho,
}: {
  usuarioId: string
  onCerrar: () => void
  onHecho: () => void
}) {
  const [tipo, setTipo] = useState<TipoPieza>('carrusel')
  const [titulo, setTitulo] = useState('')
  const [angulo, setAngulo] = useState('')
  const [texto, setTexto] = useState('')
  const [fichero, setFichero] = useState<File | null>(null)
  const [subiendo, setSubiendo] = useState(false)

  /** Del título sale el slug, que es la clave con la que se actualiza una pieza. */
  const slug = titulo
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

  const guardar = async () => {
    if (!titulo || !fichero) return
    setSubiendo(true)
    const supabase = createClient()
    try {
      const path = `${slug}/${Date.now()}-${fichero.name}`
      const { error: errSubida } = await supabase.storage.from(BUCKET).upload(path, fichero)
      if (errSubida) throw errSubida

      const { error } = await supabase.from('contenido_piezas').upsert(
        {
          tipo,
          titulo,
          slug,
          angulo: angulo || null,
          texto_post: texto,
          fichero_path: path,
          fichero_nombre: fichero.name,
          fichero_bytes: fichero.size,
          fichero_mime: fichero.type || null,
          creado_por: usuarioId,
        },
        { onConflict: 'slug' },
      )
      if (error) throw error
      toast.success('Pieza subida')
      onHecho()
    } catch (e) {
      console.error(e)
      toast.error('No se pudo subir la pieza')
    } finally {
      setSubiendo(false)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Subir una pieza</DialogTitle>
          <DialogDescription>El fichero y el texto que hay que publicar con él.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Tipo</Label>
            <Select value={tipo} onValueChange={(v) => setTipo(v as TipoPieza)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="video">Vídeo</SelectItem>
                <SelectItem value="carrusel">Carrusel</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Título</Label>
            <Input value={titulo} onChange={(e) => setTitulo(e.target.value)} />
            {slug && <p className="text-xs text-muted-foreground">slug: {slug}</p>}
          </div>
          <div className="space-y-1.5">
            <Label>Ángulo</Label>
            <Input
              value={angulo}
              onChange={(e) => setAngulo(e.target.value)}
              placeholder="La tesis en una línea, para distinguirla de su gemela"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Texto del post</Label>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="min-h-[160px]"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fichero</Label>
            <Input
              type="file"
              accept="video/mp4,application/pdf,image/png,image/jpeg"
              onChange={(e) => setFichero(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button className="w-full" disabled={!titulo || !fichero || subiendo} onClick={guardar}>
            {subiendo ? 'Subiendo…' : 'Guardar'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
