'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import { Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { NOMBRE_DIA, NOMBRE_MES, pesoLegible, type ContenidoPieza } from '@/lib/types/contenido'
import { crearHistoria, editarHistoria } from './acciones'
import type { Perfil } from './comun'

/**
 * AÑADIR O CAMBIAR UNA HISTORIA.
 *
 * Una historia es la pieza más ligera del calendario: un título que dice de qué va, la idea o el texto que sale en pantalla y, si ya la hay,
 * la foto o el vídeo. No lleva texto por red ni tiene que pasar por la lista de piezas. Y no hay tope por día: al guardar, el cuadro SE QUEDA
 * ABIERTO y vacío, con la misma persona, para ir apuntando una detrás de otra.
 */

const EXTENSIONES = 'image/png,image/jpeg,image/webp,video/mp4,video/quicktime'

export function HistoriaDialog({
  iso,
  perfiles,
  usuarioId,
  editar,
  onCerrar,
  onGuardada,
}: {
  /** El día en que se programa. Al editar no se usa */
  iso: string
  perfiles: Perfil[]
  usuarioId: string
  /** Si viene, se cambia esa historia en vez de crear una nueva */
  editar?: ContenidoPieza | null
  onCerrar: () => void
  /** Se llama tras cada historia guardada. Al crear NO cierra el cuadro: quien llama solo refresca la pantalla */
  onGuardada: () => void
}) {
  const [titulo, setTitulo] = useState(editar?.titulo ?? '')
  const [texto, setTexto] = useState(editar?.texto_post ?? '')
  const [responsableId, setResponsableId] = useState(perfiles.some((p) => p.id === usuarioId) ? usuarioId : '')
  const [fichero, setFichero] = useState<File | null>(null)
  // Cambiar la clave de la entrada de fichero es la forma de vaciarla tras guardar
  const [claveFichero, setClaveFichero] = useState(0)
  const [guardando, setGuardando] = useState(false)
  const [hechas, setHechas] = useState(0)

  const [y, m, d] = iso.split('-').map(Number)
  const fecha = new Date(y, (m ?? 1) - 1, d ?? 1)
  const diaTexto = `${NOMBRE_DIA[(fecha.getDay() + 6) % 7]} ${fecha.getDate()} de ${NOMBRE_MES[fecha.getMonth()]}`

  const puedeGuardar = titulo.trim() !== '' && (editar ? true : responsableId !== '') && !guardando

  async function guardar(seguir: boolean) {
    if (!puedeGuardar) return
    setGuardando(true)
    const bien = editar
      ? await editarHistoria(editar.id, { titulo, texto, fichero, ficheroAnterior: editar.fichero_path })
      : await crearHistoria({ fecha: iso, titulo, texto, responsableId, usuarioId, fichero })
    setGuardando(false)
    if (!bien) return
    onGuardada()
    if (editar || !seguir) {
      if (!editar) toast.success('Historia programada')
      onCerrar()
      return
    }
    setHechas((n) => n + 1)
    toast.success('Historia programada. Apunta la siguiente.')
    setTitulo('')
    setTexto('')
    setFichero(null)
    setClaveFichero((k) => k + 1)
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onCerrar()}>
      <DialogContent className="max-w-lg max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Smartphone className="h-5 w-5 text-[#FF6600]" />
            {editar ? 'Cambiar la historia' : 'Nueva historia'}
          </DialogTitle>
          <DialogDescription>
            {editar ? 'El título, la idea y el fichero.' : `${diaTexto}. Puedes añadir todas las que quieras este día.`}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>De qué va</Label>
            <Input
              autoFocus
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="Ej.: Detrás de cámaras del vídeo de hoy"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !editar) {
                  e.preventDefault()
                  void guardar(true)
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Idea o texto en pantalla</Label>
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              className="min-h-[110px]"
              placeholder="Lo que se cuenta, el texto que sale, la pegatina o la encuesta que se pone… (opcional)"
            />
          </div>

          {!editar && (
            <div className="space-y-1.5">
              <Label>Quién la publica</Label>
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
          )}

          <div className="space-y-1.5">
            <Label>
              Foto o vídeo <span className="text-muted-foreground font-normal">(opcional, se puede añadir después)</span>
            </Label>
            <Input key={claveFichero} type="file" accept={EXTENSIONES} onChange={(e) => setFichero(e.target.files?.[0] ?? null)} />
            {fichero && <p className="text-xs text-muted-foreground">{fichero.name} · {pesoLegible(fichero.size)}</p>}
            {editar && !fichero && editar.fichero_nombre && (
              <p className="text-xs text-muted-foreground">Ahora tiene: {editar.fichero_nombre}. Si eliges otro, lo sustituye.</p>
            )}
          </div>

          <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
            {editar ? (
              <Button disabled={!puedeGuardar} onClick={() => guardar(false)}>
                {guardando ? 'Guardando…' : 'Guardar'}
              </Button>
            ) : (
              <>
                <Button variant="outline" disabled={!puedeGuardar} onClick={() => guardar(false)}>
                  Guardar y cerrar
                </Button>
                <Button disabled={!puedeGuardar} onClick={() => guardar(true)}>
                  {guardando ? 'Guardando…' : 'Guardar y añadir otra'}
                </Button>
              </>
            )}
          </div>
          {hechas > 0 && !editar && (
            <p className="text-xs text-muted-foreground text-right">
              {hechas === 1 ? '1 historia añadida' : `${hechas} historias añadidas`} desde que abriste este cuadro.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
