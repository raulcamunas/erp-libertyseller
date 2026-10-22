/**
 * CORREO.
 *
 * ESTA PÁGINA NO PINTA NADA, A PROPÓSITO. El correo es una de las aplicaciones que se quedan abiertas al cambiar de pantalla: la monta UNA
 * vez components/layout/AppsPersistentes.tsx, en el layout, y se oculta al ir a otra (el hilo abierto, la búsqueda y el mensaje a medio
 * escribir se conservan). Esta ruta existe para que la dirección (?buzon=<id>&hilo=<id>), el menú y el botón de atrás sigan funcionando, y
 * para que el middleware siga cerrando la puerta a quien no tenga la aplicación (un partner no entra).
 *
 * La pantalla en sí es components/correo/CorreoApp.tsx, y las tablas correo_* siguen cerradas al navegador: todo pasa por /api/correo.
 */
export default function CorreoPage() {
  return null
}
