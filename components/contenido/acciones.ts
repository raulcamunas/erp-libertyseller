import { toast } from 'sonner'
import { createClient } from '@/lib/supabase/client'
import type { EstadoEncargo } from '@/lib/types/contenido'

/**
 * Lo que se hace con un encargo del calendario desde cualquier vista: marcarlo como
 * publicado o saltado, o quitarlo. Devuelven si salió bien y avisan ellas mismas.
 */

export async function cambiarEstado(id: string, estado: EstadoEncargo): Promise<boolean> {
  const { error } = await createClient()
    .from('contenido_calendario')
    .update({
      estado,
      publicado_at: estado === 'publicado' ? new Date().toISOString() : null,
    })
    .eq('id', id)
  if (error) {
    toast.error('No se pudo cambiar el estado')
    return false
  }
  toast.success(estado === 'publicado' ? 'Marcado como publicado' : 'Estado actualizado')
  return true
}

export async function quitarDelCalendario(id: string): Promise<boolean> {
  const { error } = await createClient().from('contenido_calendario').delete().eq('id', id)
  if (error) {
    toast.error('No se pudo quitar del calendario')
    return false
  }
  toast.success('Quitado del calendario')
  return true
}
