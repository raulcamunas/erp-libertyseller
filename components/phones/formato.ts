/**
 * Formato de los números del registro de Teléfonos. Puro, con pruebas en formato.prueba.ts (npx tsx components/phones/formato.prueba.ts).
 */

/** Una casilla puede llevar varios números («621099518 - 650123456», «… / …», «…, …», «… y …»): se separan para enseñarlos y copiarlos uno a uno.
 *  El guion solo separa si lleva espacios a los lados: «623-973-018» es UN número escrito con guiones. */
export function separarNumeros(valor: string): string[] {
  return valor
    .split(/\s+[-–—/]\s+|\s*[,;|]\s*|\s+y\s+/)
    .map((v) => v.trim())
    .filter(Boolean)
}

/** 623973018 → «623 973 018»; +34623973018 → «+34 623 973 018». Lo que no sea un número español de 9 cifras se deja como está (un correo, un texto). */
export function formatoTelefono(n: string): string {
  const limpio = n.replace(/[\s.()-]/g, '')
  const m = limpio.match(/^(\+34|0034)?(\d{9})$/)
  if (!m) return n
  const d = m[2]
  return `${m[1] ? '+34 ' : ''}${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`
}
