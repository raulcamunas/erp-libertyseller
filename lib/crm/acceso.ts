/**
 * QUIÉN ENTRA AL CRM DE CLIENTES, QUÉ CLIENTES VE Y QUÉ PUEDE HACER CON ELLOS — PURO.
 * ===================================================================================
 * Antes eran dos casos: dirección (admin y socio: todo) y quien supervisa al equipo comercial (el permiso suelto `equipo-comercial`: todo en solo lectura). Ahora son cuatro, y
 * esta función es el ÚNICO sitio donde se decide cuál es cada uno; la página, el menú y la pantalla leen su resultado en vez de repetir las comparaciones:
 *
 *   · DIRECCIÓN (admin y partner)            todos los clientes; lo puede todo, incluidos los importes, el responsable, los PDFs, el resultado de la cita y el coste del equipo.
 *   · MANAGER (`equipo-comercial`)           todos los clientes; MUEVE (fase, descartar, cerrar, próxima acción, notas, guion, datos de contacto) y apunta contactos.
 *                                            NO toca importes ni responsable ni el resultado de la cita (cualificar es pagar una comisión), ni ve los PDFs ni el coste.
 *   · COMERCIAL AUTÓNOMO (`crm-propios`)     SOLO LOS SUYOS (los que lleva él: `owner_id`); los mueve y los apunta como el manager, y además da de alta los suyos. No ve ni
 *                                            toca importes (set up y mantenimiento), ni PDFs, ni el coste del equipo.
 *   · cualquier otro                         no entra.
 *
 * Quien tiene a la vez `equipo-comercial` y `crm-propios` es un manager (ve todos): ver los suyos es un caso particular de ver todos.
 *
 * ESTO NO ES EL FILTRO DE VERDAD. Es lo que decide qué se pinta y qué se pide a la base; quien manda son las políticas RLS de la migración 261 (que dicen lo mismo, y que son la
 * única barrera cuando alguien escribe a mano desde la consola del navegador). Si esta función y la RLS dejan de coincidir, el síntoma no es un error: es una pantalla vacía o un
 * «No se pudo guardar». Por eso los permisos se llaman igual aquí, en lib/config/apps.ts y en las funciones SQL, letra por letra.
 *
 * Es puro: no toca la base ni el navegador.
 */

export interface PermisosParaElCrm {
  role: string | null | undefined
  /** Tiene el permiso suelto `equipo-comercial` (supervisa al equipo comercial) */
  equipoComercial: boolean
  /** Tiene el permiso suelto `crm-propios` (comercial autónomo: solo sus clientes) */
  crmPropios: boolean
}

export type QuienEsEnElCrm = 'direccion' | 'manager' | 'autonomo' | 'nadie'

export interface AlcanceDelCrm {
  quien: QuienEsEnElCrm
  /** Puede abrir la pantalla */
  entra: boolean
  /** Ve los clientes de todo el equipo. Si no, solo los suyos (`owner_id` = él) */
  veTodos: boolean
  /** Dirección: admin o partner */
  esDireccion: boolean
  /** Mover de fase, descartar, cerrar, reabrir, próxima acción, notas internas, guion de la reunión y datos de contacto de la ficha */
  puedeMover: boolean
  /** Ve los importes de la ficha (set up y mantenimiento). El manager los ve (siempre los vio, en solo lectura); el autónomo no */
  puedeVerImportes: boolean
  /** Cambia los importes (set up y mantenimiento), el responsable y la fecha de cierre: es cerrar un presupuesto, y eso es de dirección */
  puedeImportes: boolean
  /** Cualificar, no cualificar o marcar «no asistió» una cita: genera la comisión del comercial que la agendó, y eso es de dirección */
  puedeResultadoDeCita: boolean
  /** Dar de alta un cliente a mano: dirección y el autónomo (solo para sí mismo) */
  puedeAlta: boolean
  /** Los PDFs de propuestas y contratos, la bandeja de notas de Gemini y el coste del equipo comercial: solo dirección */
  puedeVerLoDeDireccion: boolean
}

const SIN_ACCESO: AlcanceDelCrm = {
  quien: 'nadie',
  entra: false,
  veTodos: false,
  esDireccion: false,
  puedeMover: false,
  puedeVerImportes: false,
  puedeImportes: false,
  puedeResultadoDeCita: false,
  puedeAlta: false,
  puedeVerLoDeDireccion: false,
}

export function alcanceDelCrm(p: PermisosParaElCrm): AlcanceDelCrm {
  if (p.role === 'admin' || p.role === 'partner') {
    return { quien: 'direccion', entra: true, veTodos: true, esDireccion: true, puedeMover: true, puedeVerImportes: true, puedeImportes: true, puedeResultadoDeCita: true, puedeAlta: true, puedeVerLoDeDireccion: true }
  }
  // Los permisos sueltos solo cuentan en un empleado: un cliente de fuera o un rol que no existe no entra por una casilla que se le quedó marcada
  if (p.role !== 'employee') return SIN_ACCESO

  if (p.equipoComercial) {
    return { quien: 'manager', entra: true, veTodos: true, esDireccion: false, puedeMover: true, puedeVerImportes: true, puedeImportes: false, puedeResultadoDeCita: false, puedeAlta: p.crmPropios, puedeVerLoDeDireccion: false }
  }
  if (p.crmPropios) {
    return { quien: 'autonomo', entra: true, veTodos: false, esDireccion: false, puedeMover: true, puedeVerImportes: false, puedeImportes: false, puedeResultadoDeCita: false, puedeAlta: true, puedeVerLoDeDireccion: false }
  }
  return SIN_ACCESO
}

/**
 * ¿Es suyo este cliente? Para quien solo ve los suyos: el responsable de la ficha (`owner_id`) es él. Quien ve todos ve todos. Una ficha sin responsable no es de nadie.
 */
export function esClienteVisible(alcance: AlcanceDelCrm, cliente: { owner_id: string | null }, userId: string): boolean {
  if (!alcance.entra) return false
  if (alcance.veTodos) return true
  return cliente.owner_id !== null && cliente.owner_id === userId
}
