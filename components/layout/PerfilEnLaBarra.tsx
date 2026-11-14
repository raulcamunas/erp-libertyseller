'use client'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useApariencia } from '@/components/tareas-clientes/AparienciaProvider'
import { AvatarDePersona } from '@/components/tareas-clientes/AvatarTC'
import { EditorDePerfil } from '@/components/tareas-clientes/PerfilDeAvatar'

/**
 * TU CÍRCULO DE LA BARRA, convertido en botón: al pulsarlo se abre tu perfil (color, icono y personajes), a su derecha. Sin nada elegido enseña tus iniciales como siempre; con algo elegido,
 * tu icono o personaje con tu color (el mismo con el que sales en las tareas y el chat).
 */
export function PerfilEnLaBarra({ id, nombre, iniciales }: { id: string | null; nombre: string; iniciales: string }) {
  const { mapa } = useApariencia()
  const yo = id ? mapa[id] : undefined
  const elegido = Boolean(yo?.color || yo?.icono)
  const circulo = (
    <span className="lat-avatar" data-elegido={elegido ? 'true' : undefined}>
      {elegido && id ? <AvatarDePersona color={yo?.color} icono={yo?.icono} id={id} nombre={nombre} tamano={30} /> : <span>{iniciales}</span>}
    </span>
  )
  // Sin saber quién eres (aún no ha llegado el perfil) no hay nada que elegir: se queda como un círculo
  if (!id) return circulo
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" className="lat-avatar-boton" title="Tu perfil: elige tu color, tu icono o un personaje" aria-label="Tu perfil: elige tu color, tu icono o un personaje">
          {circulo}
        </button>
      </PopoverTrigger>
      <PopoverContent side="right" align="end" sideOffset={16} collisionPadding={12} className="z-[120] !w-[348px] !rounded-[14px] !border-[var(--ls-linea2)] !bg-[var(--ls-sup)] !p-3.5 !text-[var(--ls-t1)] shadow-[0_18px_50px_rgba(0,0,0,0.45)]">
        <EditorDePerfil miId={id} nombre={nombre} />
      </PopoverContent>
    </Popover>
  )
}
