/**
 * EN QUÉ FRANJA HORARIA ESTÁ UN LEAD DE MÉXICO. PURO.
 *
 * Desde octubre de 2022 México no cambia la hora (salvo la frontera con EE. UU.). Cuatro franjas:
 *   · Sureste   (UTC−5): Quintana Roo.
 *   · Centro    (UTC−6): casi todo el país, CDMX, Jalisco, Nuevo León, Yucatán, Chihuahua…
 *   · Pacífico  (UTC−7): Sonora, Sinaloa, Nayarit y Baja California Sur.
 *   · Noroeste  (UTC−8, con horario de verano como EE. UU.): Baja California.
 * Ciudad Juárez (Chihuahua) va con El Paso: UTC−7 y horario de verano.
 *
 * Se saca del ESTADO (`province`, la columna «Estado» del Excel de SmartScout). Si el estado no se entiende (a veces trae la colonia o una calle), se mira la
 * LADA del teléfono. Si tampoco, no se dice nada: no se inventa.
 */

export type ZonaMexico = 'sureste' | 'centro' | 'pacifico' | 'noroeste' | 'juarez'

export const ZONAS_MEXICO: Record<ZonaMexico, { nombre: string; iana: string }> = {
  sureste: { nombre: 'Sureste', iana: 'America/Cancun' },
  centro: { nombre: 'Centro', iana: 'America/Mexico_City' },
  pacifico: { nombre: 'Pacífico', iana: 'America/Mazatlan' },
  noroeste: { nombre: 'Noroeste', iana: 'America/Tijuana' },
  juarez: { nombre: 'Cd. Juárez', iana: 'America/Ciudad_Juarez' },
}

const normal = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim()

/** Los estados (y las erratas y alcaldías de CDMX que se han visto en los datos). El más largo primero: «baja california sur» antes que «baja california» */
const ESTADOS: Array<[string, ZonaMexico]> = (
  [
    ['baja california sur', 'pacifico'],
    ['baja california', 'noroeste'],
    ['quintana roo', 'sureste'],
    ['sonora', 'pacifico'],
    ['sinaloa', 'pacifico'],
    ['nayarit', 'pacifico'],
    ['aguascalientes', 'centro'],
    ['campeche', 'centro'],
    ['chiapas', 'centro'],
    ['chihuahua', 'centro'],
    ['chihuhaua', 'centro'],
    ['ciudad de mexico', 'centro'],
    ['ciudad de mexcio', 'centro'],
    ['cdmx', 'centro'],
    ['df', 'centro'],
    ['distrito federal', 'centro'],
    ['federaldistrict', 'centro'],
    ['mexico city', 'centro'],
    ['estado de mexico', 'centro'],
    ['edomex', 'centro'],
    ['mexico', 'centro'],
    ['coahuila', 'centro'],
    ['colima', 'centro'],
    ['durango', 'centro'],
    ['guanajuato', 'centro'],
    ['guananuato', 'centro'],
    ['guerrero', 'centro'],
    ['hidalgo', 'centro'],
    ['jalisco', 'centro'],
    ['michoacan', 'centro'],
    ['morelos', 'centro'],
    ['nuevo leon', 'centro'],
    ['oaxaca', 'centro'],
    ['puebla', 'centro'],
    ['queretaro', 'centro'],
    ['san luis potosi', 'centro'],
    ['tabasco', 'centro'],
    ['tamaulipas', 'centro'],
    ['tlaxcala', 'centro'],
    ['veracruz', 'centro'],
    ['yucatan', 'centro'],
    ['zacatecas', 'centro'],
    // Alcaldías de la CDMX que vienen en lugar del estado
    ['azcapotzalco', 'centro'],
    ['azcpotzalco', 'centro'],
    ['cuauhtemoc', 'centro'],
    ['cuahutemoc', 'centro'],
    ['gustavo a madero', 'centro'],
    ['gam', 'centro'],
    ['coyoacan', 'centro'],
    ['iztapalapa', 'centro'],
    ['tlalpan', 'centro'],
    ['benito juarez', 'centro'],
    ['miguel hidalgo', 'centro'],
    ['alvaro obregon', 'centro'],
  ] as Array<[string, ZonaMexico]>
).sort((a, b) => b[0].length - a[0].length)

/** Las LADAS de fuera de la franja Centro. Cualquier otra lada mexicana es Centro */
const LADAS: Record<string, ZonaMexico> = {
  // Baja California
  '664': 'noroeste', '665': 'noroeste', '686': 'noroeste', '646': 'noroeste', '616': 'noroeste', '661': 'noroeste',
  // Sonora
  '662': 'pacifico', '644': 'pacifico', '642': 'pacifico', '631': 'pacifico', '633': 'pacifico', '653': 'pacifico', '622': 'pacifico', '623': 'pacifico', '634': 'pacifico', '637': 'pacifico', '638': 'pacifico', '641': 'pacifico', '643': 'pacifico', '645': 'pacifico', '647': 'pacifico', '648': 'pacifico',
  // Sinaloa
  '667': 'pacifico', '669': 'pacifico', '668': 'pacifico', '687': 'pacifico', '672': 'pacifico', '673': 'pacifico', '694': 'pacifico', '696': 'pacifico', '697': 'pacifico', '698': 'pacifico',
  // Nayarit (menos Bahía de Banderas, 329, que va con Jalisco)
  '311': 'pacifico', '319': 'pacifico', '323': 'pacifico', '324': 'pacifico', '325': 'pacifico', '327': 'pacifico', '389': 'pacifico',
  // Baja California Sur
  '612': 'pacifico', '613': 'pacifico', '615': 'pacifico', '624': 'pacifico',
  // Quintana Roo
  '998': 'sureste', '984': 'sureste', '983': 'sureste', '987': 'sureste',
  // Ciudad Juárez
  '656': 'juarez', '657': 'juarez',
}

/** Los 10 dígitos nacionales de un teléfono mexicano (sin +52 ni el 1 antiguo de los móviles), o null */
export function digitosMexicanos(telefono: string | null | undefined): string | null {
  if (!telefono) return null
  let d = telefono.split(/[/;]|\s-\s/)[0].replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  if (d.length === 13 && d.startsWith('521')) d = d.slice(3)
  else if (d.length === 12 && d.startsWith('52')) d = d.slice(2)
  return d.length === 10 ? d : null
}

export interface FranjaDeLead {
  zona: ZonaMexico
  nombre: string
  iana: string
  /** De dónde se ha sacado: del estado o, si no se entiende, de la lada del teléfono */
  origen: 'estado' | 'telefono'
}

export function franjaDeMexico(provincia: string | null | undefined, telefono?: string | null): FranjaDeLead | null {
  const p = provincia ? normal(provincia) : ''
  let zona: ZonaMexico | null = null
  let origen: FranjaDeLead['origen'] = 'estado'
  if (p) {
    const hit = ESTADOS.find(([k]) => p === k || p.startsWith(`${k} `))
    if (hit) zona = hit[1]
  }
  const d = digitosMexicanos(telefono)
  // Chihuahua es Centro salvo Ciudad Juárez, que solo se distingue por la lada
  if (zona === 'centro' && p.startsWith('chihuahua') && d && LADAS[d.slice(0, 3)] === 'juarez') zona = 'juarez'
  if (!zona && d) {
    zona = LADAS[d.slice(0, 3)] ?? 'centro'
    origen = 'telefono'
  }
  if (!zona) return null
  return { zona, ...ZONAS_MEXICO[zona], origen }
}

/** La hora local («10:32») y si cae fuera del horario de oficina (antes de las 9 o desde las 19) en esa franja */
export function horaLocal(iana: string, ahora: Date = new Date()): { texto: string; utc: string; fueraDeHorario: boolean } {
  const partes = new Intl.DateTimeFormat('es-ES', { timeZone: iana, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'shortOffset' }).formatToParts(ahora)
  const h = partes.find((x) => x.type === 'hour')?.value ?? '00'
  const m = partes.find((x) => x.type === 'minute')?.value ?? '00'
  const utc = (partes.find((x) => x.type === 'timeZoneName')?.value ?? '').replace('GMT', 'UTC').replace('-', '−')
  const hora = Number(h)
  return { texto: `${h}:${m}`, utc, fueraDeHorario: hora < 9 || hora >= 19 }
}
