'use client'

import { BookText, Check, Loader2, Plus, Trash2, Users } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { CAMPOS_DE_PLANTILLA, nombreNormalizado, type PlantillaDeCorreo } from '@/lib/correo/plantillas'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { Boton, FOCO, TACTIL, TACTIL_CUADRADO } from '@/components/ui-ls'
import { CAMPO } from './ui'

/**
 * LAS PLANTILLAS DENTRO DEL MENSAJE: usar una con un clic y guardar lo escrito como plantilla.
 *
 * Una plantilla es un asunto y un texto con CAMPOS entre llaves ({{empresa}}, {{mi_nombre}}…, ver lib/correo/plantillas.ts) que se rellenan
 * solos al usarla. Pueden ser PERSONALES (cada persona ve y toca las suyas) o DEL EQUIPO (las ve todo el mundo y solo un administrador las
 * crea y las toca). Se guardan en `plantillas_correo` (migración 238) y se leen y escriben directamente con la sesión de quien las usa: las
 * políticas RLS de esa tabla son las que mandan, esto solo decide qué botones se enseñan.
 *
 * Guardar con un nombre que ya existe (entre las mías, o entre las del equipo) la ACTUALIZA, no la duplica: es la forma de corregir una.
 */

interface Props {
  yoId: string
  esAdmin: boolean
  /** Lo que hay ahora en el mensaje, para guardarlo como plantilla */
  actual: { asunto: string; texto: string }
  /** La plantilla elegida: el mensaje se encarga de rellenarla e insertarla */
  onAplicar: (plantilla: PlantillaDeCorreo) => void
  /** Escribe un campo ({{empresa}}…) en el texto del mensaje, donde esté el cursor */
  onInsertarCampo: (campo: string) => void
  /** Si el mensaje es una respuesta, el asunto no se cambia: no se guarda ni se aplica */
  conAsunto: boolean
}

const FALTA_MIGRACION = 'Falta lanzar la migración 238_avisos_de_equipo_y_plantillas_de_correo.sql en el editor SQL de Supabase.'
const CODIGOS_SIN_TABLA = new Set(['42P01', 'PGRST205', 'PGRST200'])

export function SelectorDePlantillas({ yoId, esAdmin, actual, onAplicar, onInsertarCampo, conAsunto }: Props) {
  const supabase = useMemo(() => createClient(), [])
  const [abierto, setAbierto] = useState(false)
  const [plantillas, setPlantillas] = useState<PlantillaDeCorreo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [nombre, setNombre] = useState('')
  const [paraElEquipo, setParaElEquipo] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [borrando, setBorrando] = useState<string | null>(null)
  const [confirmaBorrar, setConfirmaBorrar] = useState<string | null>(null)

  const cargar = useCallback(async () => {
    setError(null)
    const { data, error: e } = await supabase.from('plantillas_correo').select('id, user_id, nombre, asunto, texto').order('nombre', { ascending: true })
    if (e) {
      setPlantillas([])
      setError(CODIGOS_SIN_TABLA.has(e.code ?? '') ? FALTA_MIGRACION : 'No se han podido leer las plantillas. Vuelve a probar en un momento.')
      return
    }
    setPlantillas((data ?? []) as PlantillaDeCorreo[])
  }, [supabase])

  // Se leen al abrir (y no al montar el mensaje): la mayoría de los mensajes no las usan
  useEffect(() => {
    if (abierto) void cargar()
    else setConfirmaBorrar(null)
  }, [abierto, cargar])

  const puedeTocar = (p: PlantillaDeCorreo) => (p.user_id === null ? esAdmin : p.user_id === yoId)
  const mias = (plantillas ?? []).filter((p) => p.user_id === yoId)
  const delEquipo = (plantillas ?? []).filter((p) => p.user_id === null)

  async function guardar() {
    const limpio = nombre.trim().replace(/\s+/g, ' ')
    if (!limpio) return
    if (!actual.texto.trim() && !actual.asunto.trim()) return toast.error('Escribe algo en el mensaje antes de guardarlo como plantilla.')
    setGuardando(true)
    const dueno = paraElEquipo && esAdmin ? null : yoId
    const existente = (plantillas ?? []).find((p) => p.user_id === dueno && nombreNormalizado(p.nombre) === nombreNormalizado(limpio))
    const cuerpo = { nombre: limpio, asunto: conAsunto ? actual.asunto.trim() : '', texto: actual.texto }
    const r = existente
      ? await supabase.from('plantillas_correo').update(cuerpo).eq('id', existente.id)
      : await supabase.from('plantillas_correo').insert({ ...cuerpo, user_id: dueno })
    setGuardando(false)
    if (r.error) {
      toast.error(CODIGOS_SIN_TABLA.has(r.error.code ?? '') ? FALTA_MIGRACION : 'No se ha podido guardar la plantilla.')
      return
    }
    toast.success(existente ? 'Plantilla actualizada.' : 'Plantilla guardada.')
    setNombre('')
    await cargar()
  }

  async function borrar(id: string) {
    setBorrando(id)
    const { error: e } = await supabase.from('plantillas_correo').delete().eq('id', id)
    setBorrando(null)
    setConfirmaBorrar(null)
    if (e) return toast.error('No se ha podido borrar la plantilla.')
    setPlantillas((previas) => (previas ?? []).filter((p) => p.id !== id))
  }

  const fila = (p: PlantillaDeCorreo) => (
    <li key={p.id} className="group flex items-center gap-1">
      <button
        type="button"
        onClick={() => {
          onAplicar(p)
          setAbierto(false)
        }}
        title={[p.asunto && `Asunto: ${p.asunto}`, p.texto.slice(0, 200)].filter(Boolean).join('\n')}
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[14px] text-[var(--ls-t1)] outline-none transition-colors hover:bg-[var(--ls-sup2)] focus-visible:shadow-[inset_0_0_0_1px_var(--ls-acc-graf)] lg:py-1.5 lg:text-[13px]',
          TACTIL,
        )}
      >
        {p.user_id === null ? <Users className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-label="Del equipo" /> : <BookText className="h-3.5 w-3.5 shrink-0 text-[var(--ls-t4)]" aria-hidden />}
        <span className="min-w-0 flex-1 truncate">{p.nombre}</span>
      </button>
      {puedeTocar(p) &&
        (confirmaBorrar === p.id ? (
          <button type="button" onClick={() => void borrar(p.id)} disabled={borrando === p.id} className={cn('h-8 shrink-0 rounded-[10px] px-2.5 text-[12.5px] font-medium text-[var(--ls-e-rojo)] hover:bg-[color-mix(in_srgb,var(--ls-e-rojo)_12%,transparent)]', TACTIL, FOCO)}>
            {borrando === p.id ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : '¿Borrar?'}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmaBorrar(p.id)}
            aria-label={`Borrar la plantilla ${p.nombre}`}
            // En una pantalla táctil no hay «pasar el ratón»: la papelera se ve siempre
            className={cn(
              'flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] text-[var(--ls-t4)] opacity-0 transition-opacity hover:bg-[var(--ls-sup2)] hover:text-[var(--ls-e-rojo)] focus-visible:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100',
              TACTIL_CUADRADO,
              FOCO,
            )}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </button>
        ))}
    </li>
  )

  return (
    <Popover open={abierto} onOpenChange={setAbierto}>
      <PopoverTrigger asChild>
        <Boton variante="fantasma" icono={BookText} aria-haspopup="dialog" aria-label="Plantillas" title="Plantillas" className="px-2.5 [@media(pointer:coarse)]:min-w-[44px]">
          <span className="hidden md:inline">Plantillas</span>
        </Boton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        collisionPadding={12}
        // Por encima del cuadro del mensaje (z-[60]). Y el teclado no sube hasta el cuadro: Esc cierra esto, no el mensaje entero
        className="z-[80] w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-[14px] border border-[var(--ls-linea2)] bg-[var(--ls-sup)] p-0 text-[var(--ls-t2)] shadow-[var(--ls-sombra-3)]"
        onKeyDown={(e) => e.stopPropagation()}
      >
        <div className="max-h-[min(300px,45dvh)] overflow-y-auto overscroll-contain p-1.5">
          {plantillas === null ? (
            <p className="flex items-center gap-2 px-2.5 py-2.5 text-[12.5px] text-[var(--ls-t4)]" role="status">
              <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden /> Cargando…
            </p>
          ) : error ? (
            <p className="px-2.5 py-2.5 text-[12.5px] leading-snug text-[var(--ls-e-ambar)]">{error}</p>
          ) : plantillas.length === 0 ? (
            <p className="px-2.5 py-2.5 text-[12.5px] leading-snug text-[var(--ls-t3)]">Todavía no hay ninguna. Escribe un mensaje y guárdalo abajo como plantilla.</p>
          ) : (
            <>
              {mias.length > 0 && (
                <>
                  <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Mis plantillas</p>
                  <ul>{mias.map(fila)}</ul>
                </>
              )}
              {delEquipo.length > 0 && (
                <>
                  <p className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Del equipo</p>
                  <ul>{delEquipo.map(fila)}</ul>
                </>
              )}
            </>
          )}
        </div>

        <div className="space-y-2.5 border-t border-[var(--ls-linea)] bg-[color-mix(in_srgb,var(--ls-sup2)_45%,transparent)] p-3">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--ls-t3)]">Guardar lo escrito como plantilla</p>
          <div className="flex gap-1.5">
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void guardar()
                }
              }}
              maxLength={80}
              placeholder="Nombre: «Apertura de canal»"
              aria-label="Nombre de la plantilla"
              className={CAMPO}
            />
            <Boton variante="secundario" icono={Plus} cargando={guardando} onClick={() => void guardar()} disabled={!nombre.trim()} className="h-11 lg:h-9">
              Guardar
            </Boton>
          </div>
          {esAdmin && (
            <label className={cn('flex w-fit cursor-pointer select-none items-center gap-2 text-[12.5px] text-[var(--ls-t2)]', TACTIL)}>
              <input type="checkbox" checked={paraElEquipo} onChange={(e) => setParaElEquipo(e.target.checked)} className="h-4 w-4 accent-[var(--ls-acc-graf)]" />
              Para todo el equipo
              {paraElEquipo && <Check className="h-3 w-3 text-[var(--ls-acc)]" aria-hidden />}
            </label>
          )}
          <div className="space-y-1">
            <p className="text-[11.5px] leading-snug text-[var(--ls-t3)]">Campos que se rellenan solos. Pulsa uno para escribirlo donde está el cursor:</p>
            <div className="flex flex-wrap gap-1.5">
              {CAMPOS_DE_PLANTILLA.map((c) => (
                <button
                  key={c.clave}
                  type="button"
                  onClick={() => onInsertarCampo(c.etiqueta)}
                  title={c.ayuda}
                  className={cn(
                    'inline-flex items-center rounded-full border border-[var(--ls-linea)] bg-[var(--ls-sup2)] px-2.5 py-1 font-mono text-[11.5px] text-[var(--ls-t2)] transition-colors hover:border-[var(--ls-acc-graf)] hover:text-[var(--ls-t1)]',
                    TACTIL,
                    FOCO,
                  )}
                >
                  {c.etiqueta}
                </button>
              ))}
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
