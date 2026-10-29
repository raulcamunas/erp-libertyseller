/**
 * NOMBRES DE MUNICIPIOS QUE NO ESTÁN ASÍ EN EL INE — SOLO DATOS.
 * ==============================================================
 * El INE escribe cada municipio con su nombre oficial («Donostia/San Sebastián», «Hospitalet de Llobregat, L'»), y las reglas del índice (lib/ubicacion/municipios.ts)
 * ya entienden el artículo al final y los nombres dobles con barra. Lo que no se resuelve solo es lo que escribe la gente: el nombre en inglés («Seville»), el antiguo
 * («Gerona», «La Coruña»), el recortado («Hospitalet», «Palma») o el de una localidad que pertenece a otro municipio («Torre del Mar» es de Vélez-Málaga, «Los
 * Cristianos» es de Arona).
 *
 * Cada entrada es «texto tal como aparece» -> «provincia INE:nombre oficial del INE», y se escribe con el NOMBRE, nunca con el código del municipio: el código lo
 * pone el índice al cargarlo, así que un código mal copiado no puede colarse. El test (resolver.prueba.ts) comprueba que cada destino existe.
 *
 * Solo entra lo que ocurre de verdad en los leads y es inequívoco: nada de «Alcalá», «Jerez» ni «Pozuelo» a secas, que valen para municipios de comunidades
 * distintas. Se revisa con `scripts/ubicacion-auditar.ts`, que enseña los valores más repetidos que siguen sin resolverse.
 */

export const ALIAS_DE_MUNICIPIOS: Readonly<Record<string, string>> = {
  // Ciudades grandes escritas en inglés, con su nombre antiguo o recortadas
  seville: '41:Sevilla',
  saragossa: '50:Zaragoza',
  gerona: '17:Girona',
  lerida: '25:Lleida',
  orense: '32:Ourense',
  'la coruna': '15:Coruña, A',
  corunna: '15:Coruña, A',
  'palma de mallorca': '07:Palma',
  'las palmas': '35:Palmas de Gran Canaria, Las',
  hospitalet: '08:Hospitalet de Llobregat, L\'',
  'castellon de la plana': '12:Castelló de la Plana/Castellón de la Plana',
  'castello de la plana': '12:Castelló de la Plana/Castellón de la Plana',
  castellon: '12:Castelló de la Plana/Castellón de la Plana',
  castello: '12:Castelló de la Plana/Castellón de la Plana',
  ibiza: '07:Eivissa',
  mahon: '07:Maó',
  mao: '07:Maó',
  vitoria: '01:Vitoria-Gasteiz',
  gasteiz: '01:Vitoria-Gasteiz',
  calpe: '03:Calp',
  villarreal: '12:Vila-real',
  maspalomas: '35:San Bartolomé de Tirajana',
  'sant cugat': '08:Sant Cugat del Vallès',
  'sant boi': '08:Sant Boi de Llobregat',
  cornella: '08:Cornellà de Llobregat',
  calonge: '17:Calonge i Sant Antoni',
  montferrer: '25:Montferrer i Castellbò',
  sopelana: '48:Sopela',
  // Localidades que no son municipio: se cuentan en el de al que pertenecen
  'torre del mar': '29:Vélez-Málaga',
  'san pedro de alcantara': '29:Marbella',
  'las lagunas': '29:Mijas',
  'sitio de calahonda': '29:Mijas',
  'la cala del moral': '29:Rincón de la Victoria',
  'torre de benagalbon': '29:Rincón de la Victoria',
  'estacion de cartama': '29:Cártama',
  'los cristianos': '38:Arona',
  'las galletas': '38:Arona',
  'costa adeje': '38:Adeje',
  fanabe: '38:Adeje',
  'el medano': '38:Granadilla de Abona',
  moraira: '03:Teulada',
  'dehesa de campoamor': '03:Orihuela',
  'foia d elx': '03:Elx/Elche',
  'port de sagunt': '46:Sagunt/Sagunto',
  'la herradura': '18:Almuñécar',
  vecindario: '35:Santa Lucía de Tirajana',
  'cruce de arinaga': '35:Agüimes',
  'costa teguise': '35:Teguise',
  corralejo: '35:Oliva, La',
  'santa gertrudis de fruitera': '07:Santa Eulària des Riu',
  'sant carles de peralta': '07:Santa Eulària des Riu',
  'sant vicent de sa cala': '07:Sant Joan de Labritja',
  'sant miquel de balansat': '07:Sant Joan de Labritja',
  'port d andratx': '07:Andratx',
  'can picafort': '07:Santa Margalida',
  'santa ponsa': '07:Calvià',
  'puerto de mazarron': '30:Mazarrón',
  'cabezo de torres': '30:Murcia',
  churra: '30:Murcia',
  'san jose de la rinconada': '41:Rinconada, La',
  montequinto: '41:Dos Hermanas',
  'zahara de los atunes': '11:Barbate',
  'mutilva baja': '31:Aranguren',
  gorraiz: '31:Valle de Egüés/Eguesibar',
  bellaterra: '08:Cerdanyola del Vallès',
  alcossebre: '12:Alcalà de Xivert',
  'l hospitalet de l infant': '43:Vandellòs i l\'Hospitalet de l\'Infant',
  'o milladoiro': '15:Ames',
  sigueiro: '15:Oroso',
  portonovo: '36:Sanxenxo',
  luarca: '33:Valdés',
  maliano: '39:Camargo',
  'parque coimbra': '28:Móstoles',
  'la berzosa': '28:Hoyo de Manzanares',
  'fuente del fresno': '28:San Sebastián de los Reyes',
}

/**
 * Los nombres que valen para varios municipios de comunidades distintas, y cuál es el que se quiere decir casi siempre (el que tiene muchísima más gente). Solo se usa
 * cuando el lead no trae ninguna otra pista (código postal, provincia, comunidad) que deshaga la duda. Clave: nombre normalizado; valor: provincia INE.
 */
export const PREFERIDOS_SI_HAY_DUDA: Readonly<Record<string, string>> = {
  torrent: '46', // Torrent (València, ~82.000) y no Torrent (Girona)
  arroyomolinos: '28', // Arroyomolinos (Madrid, ~30.000) y no el de Cáceres
  castejon: '31', // Castejón (Navarra) y no el de Cuenca
  cieza: '30', // Cieza (Murcia) y no Cieza (Cantabria)
  moya: '35', // Moya (Las Palmas) y no Moya (Cuenca)
}
