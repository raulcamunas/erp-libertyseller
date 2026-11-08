/**
 * ACCESO POR CLIENTE (migración 277). PURO: las cuentas; quién es quién se pregunta en acceso.ts.
 *
 * `Permitidos` son los clientes que una persona puede ver: `null` (o sin decir) = TODOS. Un administrador, y quien no tiene ninguna fila en `tc_acceso_clientes`, ven todos;
 * quien la tiene, solo esos. Se aplica en cada ruta del servidor (y la base de datos lo aplica también a lo que se lee desde el navegador).
 */

export type Permitidos = ReadonlySet<string> | null | undefined

/** ¿Puede ver ese cliente? Sin cliente (algo general) siempre */
export const puedeVer = (permitidos: Permitidos, clienteId: string | null | undefined): boolean => !permitidos || !clienteId || permitidos.has(clienteId)

/** Lo que queda de una lista tras quitar lo de clientes que no se pueden ver */
export function filtrarPorCliente<T>(lista: readonly T[], permitidos: Permitidos, clienteDe: (x: T) => string | null | undefined): T[] {
  return permitidos ? lista.filter((x) => puedeVer(permitidos, clienteDe(x))) : [...lista]
}

/** Una persona con su lista de clientes (`null` = todos): ¿ve este? */
export const personaPuedeVer = (persona: { clientes?: readonly string[] | null }, clienteId: string): boolean => !persona.clientes || persona.clientes.includes(clienteId)

/** Los clientes a los que se limita una persona, listos para guardar: sin repetidos y solo los que existen; vacío o `null` = todos (se borran sus filas) */
export function limpiarAcceso(entrada: unknown, existentes: ReadonlySet<string>): string[] | null {
  if (entrada === null || entrada === undefined) return null
  if (!Array.isArray(entrada)) return null
  const ids = [...new Set(entrada.filter((x): x is string => typeof x === 'string' && existentes.has(x)))]
  return ids.length === 0 ? null : ids
}
