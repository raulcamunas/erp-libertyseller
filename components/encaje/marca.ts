/**
 * LA MARCA DE LA PÁGINA PÚBLICA DEL ENCAJE.
 *
 * Esta página la ve el CLIENTE, fuera del ERP, y tiene que parecer de Liberty Seller y no de una
 * pantalla interna: los mismos colores de los Excel y los PDF que ya entregamos
 * (lib/fba/excel/marca.ts) —la banda oscura con la franja naranja, el crema de las tarjetas— y Sora en
 * los titulares.
 *
 * Los colores van escritos como valores sueltos y NO como variables del ERP (`--ls-*`) a propósito:
 * esas variables son del tema oscuro de la aplicación y esta página no vive dentro de ella. Y las clases
 * llevan el color entre corchetes (`text-[#141414]`) porque globals.css reasigna `text-white` y sus
 * hermanas a los tonos del ERP: un `text-white` aquí saldría del color que no es.
 */

export const M = {
  banda: '#0E0E0E',
  naranja: '#F26212',
  naranjaClaro: '#FF8A3D',
  crema: '#F7F5F2',
  aviso: '#FBEFE8',
  tinta: '#141414',
  etiqueta: '#5E5852',
  discreto: '#8C857C',
  apagado: '#B8AE9F',
  claro: '#EDE6DC',
  raya: '#E5E1DB',
  blanco: '#FFFFFF',
  verde: '#2F9657',
  verdeSuave: '#E4F3EA',
  ambar: '#9A7410',
  ambarSuave: '#FBF0D2',
  rojo: '#C23B3B',
  rojoSuave: '#FBE3E0',
} as const

/**
 * Sora en los titulares. La variable la pone app/encajar/layout.tsx. Lleva valor de reserva DENTRO del var():
 * sin él, una variable que no existe invalida la declaración entera y el texto cae en la fuente heredada
 * en vez de seguir por la lista.
 */
export const FUENTE_TITULO = "var(--font-sora, 'Sora'), 'Inter', system-ui, sans-serif"

export const cx = (...c: Array<string | false | null | undefined>): string => c.filter(Boolean).join(' ')

/** «1.234» o «1234» según el uso de es-ES: la misma regla que en el resto del ERP */
export const n0 = (x: number): string => x.toLocaleString('es-ES')

/** «12,5» */
export const n1 = (x: number): string => x.toLocaleString('es-ES', { maximumFractionDigits: 2 })

/** El valor de un campo de medida para escribirlo en la caja de texto: con coma, sin ceros de más */
export const medidaATexto = (v: number | null): string => (v === null ? '' : String(v).replace('.', ','))

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «2026-10-23» → «23 de octubre de 2026». Lo que no sea un día se deja como está */
export function fechaLarga(f: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f)
  return m ? `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} de ${m[1]}` : f
}

/** Inter para el cuerpo: la variable del layout raíz, con su reserva por la misma razón que la de Sora */
export const FUENTE_CUERPO = "var(--font-inter, 'Inter'), system-ui, sans-serif"
