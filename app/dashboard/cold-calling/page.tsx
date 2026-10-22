/**
 * COLD CALLING.
 *
 * ESTA PÁGINA NO PINTA NADA, A PROPÓSITO. Cold Calling es una de las aplicaciones que se quedan abiertas al cambiar de pantalla: la monta
 * UNA vez components/layout/AppsPersistentes.tsx, en el layout, y se oculta al ir a otra (ver ese fichero para el porqué: el lead abierto, el
 * filtro y la lista se conservan y la cartera no se vuelve a pedir). Esta ruta existe para que la dirección, el menú y el botón de atrás
 * sigan funcionando, y para que el middleware siga cerrando la puerta a quien no tenga la aplicación.
 *
 * La pantalla en sí es components/cold-calling/ColdCallingApp.tsx. QUIÉN VE LA CARTERA DE TODO EL EQUIPO Y NO SOLO LA SUYA (admin, partner, o
 * el permiso suelto 'equipo-comercial') lo decide esa pantalla con lib/permisos-cliente.ts, y lo recorta de verdad la RLS de cold_leads y
 * cold_lead_notes (migración 212).
 */
export default function ColdCallingPage() {
  return null
}
