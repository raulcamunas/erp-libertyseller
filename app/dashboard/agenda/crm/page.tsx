import { redirect } from 'next/navigation'

/**
 * El CRM de clientes ya no cuelga de la Agenda: es una entrada del menú lateral y vive en /dashboard/crm. Esta dirección sigue existiendo y redirige, que hay gente con ella
 * guardada en marcadores y en el historial.
 */
export default function CrmDeClientesAntiguo() {
  redirect('/dashboard/crm')
}
