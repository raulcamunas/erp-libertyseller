/**
 * LAS ZONAS DE ESPAÑA: COMUNIDADES AUTÓNOMAS, PROVINCIAS Y LOS PREFIJOS DE LOS TELÉFONOS FIJOS — SOLO DATOS.
 * ===========================================================================================================
 * Lo usa el localizador de leads (lib/ubicacion/resolver.ts) para saber en qué comunidad autónoma está cada uno, que es lo que decide si hoy es festivo para él
 * (lib/festivos/). Los códigos de comunidad son los de ISO 3166-2:ES (los mismos que usa el resto del mundo) y los de provincia, los del INE (los dos primeros
 * dígitos de un código postal español): así un código postal es, sin más, una provincia.
 *
 * Ceuta y Melilla no son comunidades autónomas sino ciudades autónomas, pero tienen su propio calendario de fiestas en el BOE y se tratan igual.
 *
 * Los nombres de cada comunidad y provincia que pueden aparecer escritos en un lead (en castellano, en su lengua o en inglés) están en `alias`: se comparan ya
 * sin tildes, en minúsculas y sin signos (lib/ubicacion/texto.ts).
 */

export type CodigoCcaa = 'AN' | 'AR' | 'AS' | 'CB' | 'CE' | 'CL' | 'CM' | 'CN' | 'CT' | 'EX' | 'GA' | 'IB' | 'MC' | 'MD' | 'ME' | 'NC' | 'PV' | 'RI' | 'VC'

export interface Ccaa {
  /** El nombre completo */
  nombre: string
  /** El nombre corto, para decir «es festivo en …» */
  corto: string
  /** Otras formas de escribirla */
  alias: readonly string[]
}

export const CCAA: Readonly<Record<CodigoCcaa, Ccaa>> = {
  AN: { nombre: 'Andalucía', corto: 'Andalucía', alias: ['andalucia', 'andalusia', 'junta de andalucia'] },
  AR: { nombre: 'Aragón', corto: 'Aragón', alias: ['aragon'] },
  AS: { nombre: 'Principado de Asturias', corto: 'Asturias', alias: ['asturias', 'principado de asturias', 'asturies'] },
  CB: { nombre: 'Cantabria', corto: 'Cantabria', alias: ['cantabria'] },
  CE: { nombre: 'Ceuta', corto: 'Ceuta', alias: ['ceuta', 'ciudad de ceuta', 'ciudad autonoma de ceuta'] },
  CL: { nombre: 'Castilla y León', corto: 'Castilla y León', alias: ['castilla y leon', 'castilla leon', 'castilla-leon', 'castilla and leon'] },
  CM: { nombre: 'Castilla-La Mancha', corto: 'Castilla-La Mancha', alias: ['castilla la mancha', 'castilla-la mancha', 'castilla lamancha', 'clm'] },
  CN: { nombre: 'Canarias', corto: 'Canarias', alias: ['canarias', 'islas canarias', 'canary islands', 'illes canaries'] },
  CT: { nombre: 'Cataluña', corto: 'Cataluña', alias: ['cataluna', 'catalunya', 'catalonia', 'cataluña', 'catalunia'] },
  EX: { nombre: 'Extremadura', corto: 'Extremadura', alias: ['extremadura'] },
  GA: { nombre: 'Galicia', corto: 'Galicia', alias: ['galicia', 'galiza'] },
  IB: { nombre: 'Illes Balears', corto: 'Baleares', alias: ['baleares', 'islas baleares', 'illes balears', 'balearic islands', 'baleares islas', 'peninsula y baleares'] },
  MC: { nombre: 'Región de Murcia', corto: 'Murcia', alias: ['region de murcia', 'comunidad autonoma de murcia', 'murcia region'] },
  MD: { nombre: 'Comunidad de Madrid', corto: 'Madrid', alias: ['comunidad de madrid', 'madrid province', 'provincia de madrid', 'community of madrid'] },
  ME: { nombre: 'Melilla', corto: 'Melilla', alias: ['melilla', 'ciudad de melilla', 'ciudad autonoma de melilla'] },
  NC: { nombre: 'Comunidad Foral de Navarra', corto: 'Navarra', alias: ['navarra', 'comunidad foral de navarra', 'nafarroa', 'navarre'] },
  PV: { nombre: 'País Vasco', corto: 'País Vasco', alias: ['pais vasco', 'euskadi', 'basque country', 'euskal herria', 'comunidad autonoma vasca'] },
  RI: { nombre: 'La Rioja', corto: 'La Rioja', alias: ['la rioja', 'rioja'] },
  VC: { nombre: 'Comunitat Valenciana', corto: 'Comunitat Valenciana', alias: ['comunidad valenciana', 'comunitat valenciana', 'valencian community', 'pais valenciano', 'valencia region'] },
}

export const CODIGOS_CCAA = Object.keys(CCAA) as CodigoCcaa[]

export const esCcaa = (v: unknown): v is CodigoCcaa => typeof v === 'string' && v in CCAA

export interface Provincia {
  /** El código del INE, de dos dígitos: «28» es Madrid. Es también el comienzo de todos sus códigos postales */
  cod: string
  nombre: string
  ccaa: CodigoCcaa
  /** Otras formas de escribirla (la lengua propia, el nombre antiguo, el inglés) */
  alias: readonly string[]
}

export const PROVINCIAS: readonly Provincia[] = [
  { cod: '01', nombre: 'Álava', ccaa: 'PV', alias: ['alava', 'araba', 'araba alava', 'alava araba'] },
  { cod: '02', nombre: 'Albacete', ccaa: 'CM', alias: ['albacete'] },
  { cod: '03', nombre: 'Alicante', ccaa: 'VC', alias: ['alicante', 'alacant', 'alicante alacant', 'alacant alicante'] },
  { cod: '04', nombre: 'Almería', ccaa: 'AN', alias: ['almeria'] },
  { cod: '05', nombre: 'Ávila', ccaa: 'CL', alias: ['avila'] },
  { cod: '06', nombre: 'Badajoz', ccaa: 'EX', alias: ['badajoz'] },
  { cod: '07', nombre: 'Illes Balears', ccaa: 'IB', alias: ['baleares', 'islas baleares', 'illes balears', 'mallorca', 'majorca', 'menorca', 'minorca', 'ibiza', 'eivissa', 'formentera'] },
  { cod: '08', nombre: 'Barcelona', ccaa: 'CT', alias: ['barcelona'] },
  { cod: '09', nombre: 'Burgos', ccaa: 'CL', alias: ['burgos'] },
  { cod: '10', nombre: 'Cáceres', ccaa: 'EX', alias: ['caceres'] },
  { cod: '11', nombre: 'Cádiz', ccaa: 'AN', alias: ['cadiz'] },
  { cod: '12', nombre: 'Castellón', ccaa: 'VC', alias: ['castellon', 'castello', 'castellon castello', 'castello castellon', 'castellon de la plana'] },
  { cod: '13', nombre: 'Ciudad Real', ccaa: 'CM', alias: ['ciudad real'] },
  { cod: '14', nombre: 'Córdoba', ccaa: 'AN', alias: ['cordoba'] },
  { cod: '15', nombre: 'A Coruña', ccaa: 'GA', alias: ['a coruna', 'la coruna', 'coruna', 'corunna', 'coruna a'] },
  { cod: '16', nombre: 'Cuenca', ccaa: 'CM', alias: ['cuenca'] },
  { cod: '17', nombre: 'Girona', ccaa: 'CT', alias: ['girona', 'gerona'] },
  { cod: '18', nombre: 'Granada', ccaa: 'AN', alias: ['granada'] },
  { cod: '19', nombre: 'Guadalajara', ccaa: 'CM', alias: ['guadalajara'] },
  { cod: '20', nombre: 'Gipuzkoa', ccaa: 'PV', alias: ['gipuzkoa', 'guipuzcoa', 'guipúzcoa'] },
  { cod: '21', nombre: 'Huelva', ccaa: 'AN', alias: ['huelva'] },
  { cod: '22', nombre: 'Huesca', ccaa: 'AR', alias: ['huesca'] },
  { cod: '23', nombre: 'Jaén', ccaa: 'AN', alias: ['jaen'] },
  { cod: '24', nombre: 'León', ccaa: 'CL', alias: ['leon'] },
  { cod: '25', nombre: 'Lleida', ccaa: 'CT', alias: ['lleida', 'lerida'] },
  { cod: '26', nombre: 'La Rioja', ccaa: 'RI', alias: ['la rioja', 'rioja'] },
  { cod: '27', nombre: 'Lugo', ccaa: 'GA', alias: ['lugo'] },
  { cod: '28', nombre: 'Madrid', ccaa: 'MD', alias: ['madrid'] },
  { cod: '29', nombre: 'Málaga', ccaa: 'AN', alias: ['malaga'] },
  { cod: '30', nombre: 'Murcia', ccaa: 'MC', alias: ['murcia'] },
  { cod: '31', nombre: 'Navarra', ccaa: 'NC', alias: ['navarra', 'nafarroa'] },
  { cod: '32', nombre: 'Ourense', ccaa: 'GA', alias: ['ourense', 'orense'] },
  { cod: '33', nombre: 'Asturias', ccaa: 'AS', alias: ['asturias'] },
  { cod: '34', nombre: 'Palencia', ccaa: 'CL', alias: ['palencia'] },
  { cod: '35', nombre: 'Las Palmas', ccaa: 'CN', alias: ['las palmas', 'palmas las', 'gran canaria', 'lanzarote', 'fuerteventura'] },
  { cod: '36', nombre: 'Pontevedra', ccaa: 'GA', alias: ['pontevedra'] },
  { cod: '37', nombre: 'Salamanca', ccaa: 'CL', alias: ['salamanca'] },
  { cod: '38', nombre: 'Santa Cruz de Tenerife', ccaa: 'CN', alias: ['santa cruz de tenerife', 'tenerife', 'la palma', 'la gomera', 'el hierro', 'sc tenerife', 's c tenerife', 'sc de tenerife', 's c de tenerife', 'santa cruz tenerife'] },
  { cod: '39', nombre: 'Cantabria', ccaa: 'CB', alias: ['cantabria'] },
  { cod: '40', nombre: 'Segovia', ccaa: 'CL', alias: ['segovia'] },
  { cod: '41', nombre: 'Sevilla', ccaa: 'AN', alias: ['sevilla', 'seville'] },
  { cod: '42', nombre: 'Soria', ccaa: 'CL', alias: ['soria'] },
  { cod: '43', nombre: 'Tarragona', ccaa: 'CT', alias: ['tarragona'] },
  { cod: '44', nombre: 'Teruel', ccaa: 'AR', alias: ['teruel'] },
  { cod: '45', nombre: 'Toledo', ccaa: 'CM', alias: ['toledo'] },
  { cod: '46', nombre: 'Valencia', ccaa: 'VC', alias: ['valencia', 'valencia valencia', 'valencia valència', 'valencia/valència'] },
  { cod: '47', nombre: 'Valladolid', ccaa: 'CL', alias: ['valladolid'] },
  { cod: '48', nombre: 'Bizkaia', ccaa: 'PV', alias: ['bizkaia', 'vizcaya', 'biscay'] },
  { cod: '49', nombre: 'Zamora', ccaa: 'CL', alias: ['zamora'] },
  { cod: '50', nombre: 'Zaragoza', ccaa: 'AR', alias: ['zaragoza', 'saragossa'] },
  { cod: '51', nombre: 'Ceuta', ccaa: 'CE', alias: ['ceuta'] },
  { cod: '52', nombre: 'Melilla', ccaa: 'ME', alias: ['melilla'] },
]

const POR_CODIGO = new Map(PROVINCIAS.map((p) => [p.cod, p]))

/** La provincia de un código de dos dígitos («28»). undefined si no existe */
export const provinciaDeCodigo = (cod: string): Provincia | undefined => POR_CODIGO.get(cod)

/** La comunidad de una provincia por su código */
export const ccaaDeProvincia = (cod: string): CodigoCcaa | null => POR_CODIGO.get(cod)?.ccaa ?? null

/**
 * LOS PREFIJOS DE LOS TELÉFONOS FIJOS ESPAÑOLES (plan de numeración): el 91 es Madrid, el 93 Barcelona y el resto, tres dígitos por provincia. Un fijo dice dónde estaba
 * instalado, y un móvil (6 y 7) no dice nada. No es una garantía —hay centralitas virtuales con un número de otra ciudad—, así que solo se usa cuando no hay ninguna
 * otra pista y se anota como deducido del teléfono.
 *
 * Los prefijos de las ampliaciones recientes (81x, 82x, 85x, 86x, 88x) NO están: no se sabe con certeza a qué provincia pertenece cada uno, y un acierto dudoso
 * es peor que no decir nada. 956 y 952 sirven también a Ceuta y a Melilla; aquí cuentan como Cádiz y Málaga.
 */
export const PREFIJOS_FIJOS: Readonly<Record<string, string>> = {
  '91': '28',
  '93': '08',
  '941': '26', '942': '39', '943': '20', '944': '48', '945': '01', '946': '48', '947': '09', '948': '31', '949': '19',
  '950': '04', '951': '29', '952': '29', '953': '23', '954': '41', '955': '41', '956': '11', '957': '14', '958': '18', '959': '21',
  '960': '46', '961': '46', '962': '46', '963': '46', '964': '12', '965': '03', '966': '03', '967': '02', '968': '30', '969': '16',
  '971': '07', '972': '17', '973': '25', '974': '22', '975': '42', '976': '50', '977': '43', '978': '44', '979': '34',
  '980': '49', '981': '15', '982': '27', '983': '47', '984': '33', '985': '33', '986': '36', '987': '24', '988': '32',
  '920': '05', '921': '40', '922': '38', '923': '37', '924': '06', '925': '45', '926': '13', '927': '10', '928': '35',
}
