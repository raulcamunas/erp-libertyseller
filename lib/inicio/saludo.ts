/**
 * LAS PEQUEÑAS CUENTAS DE LA PANTALLA DE INICIO: el saludo según la hora, el nombre de pila y cómo se llama cada rol.
 * ==================================================================================================================
 * PURO. Se comprueba con saludo.prueba.ts. La hora es la del NAVEGADOR de quien mira (un comercial en Colombia y otro en España ven «Buenas tardes»
 * a su hora), por eso lo calcula el componente del navegador (components/inicio/Saludo.tsx) y no el servidor.
 */

/** «Buenos días» de 5:00 a 11:59, «Buenas tardes» de 12:00 a 19:59 y «Buenas noches» el resto (de 20:00 a 4:59) */
export function saludoDe(hora: number): string {
  if (hora >= 5 && hora < 12) return 'Buenos días'
  if (hora >= 12 && hora < 20) return 'Buenas tardes'
  return 'Buenas noches'
}

/** El nombre de pila: la primera palabra del nombre completo y, si no hay nombre, lo que va antes de la @ del email. Vacío si no hay ni una cosa ni la otra */
export function primerNombre(nombreCompleto: string | null | undefined, email: string | null | undefined): string {
  const nombre = (nombreCompleto ?? '').trim().split(/\s+/)[0]
  if (nombre) return nombre
  return (email ?? '').split('@')[0].trim()
}

const ROLES: Readonly<Record<string, string>> = {
  admin: 'Administración',
  employee: 'Equipo',
  partner: 'Partner',
  cliente: 'Cliente',
}

/** El rol como se lee en pantalla. Uno que no se conoce se enseña tal cual, para que no desaparezca */
export function etiquetaDeRol(rol: string | null | undefined): string {
  const r = (rol ?? '').trim()
  return ROLES[r] ?? r
}

/** «viernes, 23 de octubre» con la primera en mayúscula, en la hora y el calendario del navegador */
export function fechaEnPalabras(fecha: Date): string {
  const texto = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' }).format(fecha)
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

/** «1 aplicación» / «5 aplicaciones» */
export function cuantasApps(n: number): string {
  return n === 1 ? '1 aplicación' : `${n} aplicaciones`
}
