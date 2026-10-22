import { createClient } from '@/lib/supabase/client'

/**
 * APUNTAR EN EL HISTORIAL DE UN LEAD QUE SE LE HA ESCRITO UN CORREO — SOLO NAVEGADOR.
 *
 * Cuando un mensaje se abre desde la ficha de un lead de Cold Calling (el chip de su email) y se envía, el comercial no tiene que ir a
 * apuntarlo: queda en la línea de tiempo del lead como un apunte de «email» y se sella su último contacto, igual que ya pasa con las
 * llamadas de Rinkel. NO cambia el estado del lead: eso lo decide la persona (es lo único que sigue siendo manual a propósito).
 *
 * Escribe con la sesión de quien envía, así que las políticas RLS de cold_lead_notes y cold_leads (migración 212) mandan: un lead que no
 * es suyo ni supervisa no se toca. Si algo falla NO se avisa con un error: el correo ya salió, que es lo importante, y el apunte es una
 * comodidad. Devuelve si el apunte quedó hecho, para que Cold Calling sepa si refrescar el historial.
 */
export async function apuntarCorreoEnLead(datos: { leadId: string; userId: string; asunto: string; cuando: string }): Promise<boolean> {
  try {
    const supabase = createClient()
    const asunto = datos.asunto.trim() || 'sin asunto'
    const { error } = await supabase.from('cold_lead_notes').insert({ lead_id: datos.leadId, author_id: datos.userId, kind: 'email', body: `Correo enviado: «${asunto}»`.slice(0, 600) })
    if (error) {
      console.error('Correo · no se ha podido apuntar el correo en el historial del lead', { codigo: error.code ?? null })
      return false
    }
    // El último contacto es lo que ordena y colorea la lista: se sella con la hora del envío
    const { error: errorLead } = await supabase.from('cold_leads').update({ last_contacted_at: datos.cuando }).eq('id', datos.leadId)
    if (errorLead) console.error('Correo · no se ha podido sellar el último contacto del lead', { codigo: errorLead.code ?? null })
    return true
  } catch (error) {
    console.error('Correo · fallo al apuntar el correo en el lead', { mensaje: error instanceof Error ? error.message : 'desconocido' })
    return false
  }
}
