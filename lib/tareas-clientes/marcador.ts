import { sinAcentos } from './busqueda'

/**
 * QUÉ TAREAS CUENTAN EN EL MARCADOR de la barra lateral (la cifra junto a cada cliente y a «Mis tareas»): solo las que están EN PROGRESO o EN REVISIÓN, que es lo que se está
 * trabajando de verdad. «Backlog» y «Recurrentes» no cuentan (son lo que queda por empezar o lo que vuelve solo), ni tampoco lo que está hecho. Se decide por el nombre de la columna
 * (sin tildes ni mayúsculas) porque cada cliente tiene las suyas.
 */
const CUENTAN = new Set(['en progreso', 'en revision'])

export const cuentaEnElMarcador = (estado: string): boolean => CUENTAN.has(sinAcentos(estado).replace(/\s+/g, ' ').trim())
