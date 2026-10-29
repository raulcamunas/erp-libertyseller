/**
 * LAS ZONAS CON FIESTAS PROPIAS DENTRO DE UNA COMUNIDAD — SOLO DATOS.
 * ====================================================================
 * El BOE no da las fiestas de las islas de Canarias ni la del Valle de Arán en su tabla, sino en dos notas al pie: cada isla celebra a su virgen, y en el Valle de Arán una
 * fiesta de Cataluña se cambia por la «Fiesta de Arán». Para saber si un lead cae en una de esas zonas hace falta su MUNICIPIO (el código INE de cinco dígitos); con solo la
 * comunidad (o la provincia) no se sabe de qué isla es, y en ese caso solo cuentan las fiestas de toda la comunidad.
 *
 * Las listas están escritas con el código INE y el nombre al lado. El test (festivos.prueba.ts) comprueba contra la lista oficial que cada código existe y se llama así, y
 * que cada isla tiene los municipios que tiene (Gran Canaria 21, Tenerife 31, La Palma 14, Lanzarote 7, Fuerteventura 6, La Gomera 6, El Hierro 3; el Valle de Arán 9).
 */

import type { CodigoZona } from './tipos'

/** Municipio INE -> nombre oficial, agrupados por zona */
export const MUNICIPIOS_DE_ZONA: Readonly<Record<CodigoZona, Readonly<Record<string, string>>>> = {
  'gran-canaria': {
    '35001': 'Agaete', '35002': 'Agüimes', '35005': 'Artenara', '35006': 'Arucas', '35008': 'Firgas', '35009': 'Gáldar', '35011': 'Ingenio', '35012': 'Mogán', '35013': 'Moya',
    '35016': 'Palmas de Gran Canaria, Las', '35019': 'San Bartolomé de Tirajana', '35020': 'Aldea de San Nicolás, La', '35021': 'Santa Brígida', '35022': 'Santa Lucía de Tirajana',
    '35023': 'Santa María de Guía de Gran Canaria', '35025': 'Tejeda', '35026': 'Telde', '35027': 'Teror', '35031': 'Valsequillo de Gran Canaria', '35032': 'Valleseco', '35033': 'Vega de San Mateo',
  },
  lanzarote: { '35004': 'Arrecife', '35010': 'Haría', '35018': 'San Bartolomé', '35024': 'Teguise', '35028': 'Tías', '35029': 'Tinajo', '35034': 'Yaiza' },
  fuerteventura: { '35003': 'Antigua', '35007': 'Betancuria', '35014': 'Oliva, La', '35015': 'Pájara', '35017': 'Puerto del Rosario', '35030': 'Tuineje' },
  tenerife: {
    '38001': 'Adeje', '38004': 'Arafo', '38005': 'Arico', '38006': 'Arona', '38010': 'Buenavista del Norte', '38011': 'Candelaria', '38012': 'Fasnia', '38015': 'Garachico',
    '38017': 'Granadilla de Abona', '38018': 'Guancha, La', '38019': 'Guía de Isora', '38020': 'Güímar', '38022': 'Icod de los Vinos', '38023': 'San Cristóbal de La Laguna',
    '38025': 'Matanza de Acentejo, La', '38026': 'Orotava, La', '38028': 'Puerto de la Cruz', '38031': 'Realejos, Los', '38032': 'Rosario, El', '38034': 'San Juan de la Rambla',
    '38035': 'San Miguel de Abona', '38038': 'Santa Cruz de Tenerife', '38039': 'Santa Úrsula', '38040': 'Santiago del Teide', '38041': 'Sauzal, El', '38042': 'Silos, Los',
    '38043': 'Tacoronte', '38044': 'Tanque, El', '38046': 'Tegueste', '38051': 'Victoria de Acentejo, La', '38052': 'Vilaflor de Chasna',
  },
  palma: {
    '38007': 'Barlovento', '38008': 'Breña Alta', '38009': 'Breña Baja', '38014': 'Fuencaliente de la Palma', '38016': 'Garafía', '38024': 'Llanos de Aridane, Los', '38027': 'Paso, El',
    '38029': 'Puntagorda', '38030': 'Puntallana', '38033': 'San Andrés y Sauces', '38037': 'Santa Cruz de la Palma', '38045': 'Tazacorte', '38047': 'Tijarafe', '38053': 'Villa de Mazo',
  },
  gomera: { '38002': 'Agulo', '38003': 'Alajeró', '38021': 'Hermigua', '38036': 'San Sebastián de la Gomera', '38049': 'Valle Gran Rey', '38050': 'Vallehermoso' },
  hierro: { '38013': 'Frontera', '38048': 'Valverde', '38901': 'Pinar de El Hierro, El' },
  aran: {
    '25025': 'Naut Aran', '25031': 'Arres', '25045': 'Bausen', '25057': 'Bòrdes, Es', '25059': 'Bossòst', '25063': 'Canejan', '25121': 'Les', '25243': 'Vielha e Mijaran', '25247': 'Vilamòs',
  },
}

const ZONA_POR_MUNICIPIO = new Map<string, CodigoZona>()
for (const [zona, municipios] of Object.entries(MUNICIPIOS_DE_ZONA) as [CodigoZona, Record<string, string>][]) {
  for (const ine of Object.keys(municipios)) ZONA_POR_MUNICIPIO.set(ine, zona)
}

/** La isla (o el Valle de Arán) de un municipio, o null si no está en ninguna zona con fiestas propias */
export const zonaDeMunicipio = (ine: string | null | undefined): CodigoZona | null => (ine ? ZONA_POR_MUNICIPIO.get(ine) ?? null : null)

export const NOMBRE_DE_ZONA: Readonly<Record<CodigoZona, string>> = {
  hierro: 'El Hierro', fuerteventura: 'Fuerteventura', 'gran-canaria': 'Gran Canaria', gomera: 'La Gomera', palma: 'La Palma', lanzarote: 'Lanzarote y La Graciosa', tenerife: 'Tenerife', aran: 'el Valle de Arán',
}
