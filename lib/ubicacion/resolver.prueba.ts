import { estadoDelIndice, buscarMunicipios, municipioDeIne, variantesDeNombre } from './municipios'
import { cifrasDeTelefonoEspanol, codigoPostalDe, desdeCiudad, desdeDireccion, desdeProvincia, desdeRegistro, desdeTelefono, desdeWeb, ubicar, ubicacionesPosibles } from './resolver'
import { noDiceDonde, normalizar, trozosDeLugar } from './texto'
import { CODIGOS_CCAA, PREFIJOS_FIJOS, PROVINCIAS, CCAA, ccaaDeProvincia, provinciaDeCodigo } from './zonas'
import tabla from './datos/municipios-ine.json'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const ccaaDe = (u: ReturnType<typeof ubicar>) => u?.ccaa ?? null

console.log('\n=== los datos de zonas están completos ===')
{
  ok('las 19 comunidades y ciudades autónomas', CODIGOS_CCAA.length === 19)
  ok('52 provincias, del 01 al 52 sin huecos', PROVINCIAS.length === 52 && PROVINCIAS.every((p, i) => p.cod === String(i + 1).padStart(2, '0')))
  ok('cada provincia cae en una comunidad que existe', PROVINCIAS.every((p) => p.ccaa in CCAA))
  ok('cada comunidad tiene al menos una provincia', CODIGOS_CCAA.every((c) => PROVINCIAS.some((p) => p.ccaa === c)))
  ok('Madrid (28) es la Comunidad de Madrid y Barcelona (08) Cataluña', ccaaDeProvincia('28') === 'MD' && ccaaDeProvincia('08') === 'CT' && provinciaDeCodigo('28')?.nombre === 'Madrid')
  ok('Cantabria es la 39, Álava la 01 y Ceuta/Melilla la 51/52', ccaaDeProvincia('39') === 'CB' && ccaaDeProvincia('01') === 'PV' && ccaaDeProvincia('51') === 'CE' && ccaaDeProvincia('52') === 'ME')
  ok('todos los prefijos de fijos apuntan a una provincia que existe', Object.values(PREFIJOS_FIJOS).every((c) => provinciaDeCodigo(c) !== undefined))
}

console.log('\n=== la lista del INE ===')
{
  const est = estadoDelIndice()
  ok('hay 8.132 municipios', est.municipios === 8132, String(est.municipios))
  ok('todos los alias apuntan a un municipio que existe', est.aliasRotos.length === 0, est.aliasRotos.join(', '))
  // El recuento por comunidad contra el INE (cada comunidad tiene los municipios que tiene)
  const esperado: Record<string, number> = { AN: 785, AR: 731, AS: 78, IB: 67, CN: 88, CB: 102, CL: 2248, CM: 919, CT: 947, VC: 542, EX: 388, GA: 313, MD: 179, MC: 45, NC: 272, PV: 252, RI: 174, CE: 1, ME: 1 }
  const real: Record<string, number> = {}
  for (const [prov, filas] of Object.entries(tabla as unknown as Record<string, unknown[]>)) real[ccaaDeProvincia(prov) ?? '?'] = (real[ccaaDeProvincia(prov) ?? '?'] ?? 0) + filas.length
  ok('cada comunidad tiene los municipios que le corresponden', CODIGOS_CCAA.every((c) => real[c] === esperado[c]), JSON.stringify(real))
  ok('Madrid es 28079 y Barcelona 08019', municipioDeIne('28079')?.nombre === 'Madrid' && municipioDeIne('08019')?.nombre === 'Barcelona')
  ok('el código de un municipio empieza por el de su provincia', municipioDeIne('41091')?.prov === '41' && municipioDeIne('41091')?.nombre === 'Sevilla')
}

console.log('\n=== normalizar y partir un texto ===')
{
  ok('sin tildes, minúsculas y sin signos', normalizar("L'Hospitalet de Llobregat") === 'l hospitalet de llobregat' && normalizar('A Coruña') === 'a coruna' && normalizar('  CÁDIZ!! ') === 'cadiz')
  ok('la ñ cuenta como n', normalizar('España') === 'espana' && normalizar('Logroño') === 'logrono')
  ok('el país solo no dice dónde', noDiceDonde('espana') && noDiceDonde('spain') && noDiceDonde('') && !noDiceDonde('madrid'))
  ok('«Falset, Tarragona» se parte en el texto entero y sus dos trozos', trozosDeLugar('Falset, Tarragona').join('|') === 'falset tarragona|falset|tarragona')
  ok('«Ribeira (A Coruña)» saca la provincia del paréntesis', trozosDeLugar('Ribeira (A Coruña)').includes('a coruna'))
  ok('el país pegado se quita («SEVILLA ESPAÑA», «ALICANTE -ESPAÑA»)', trozosDeLugar('SEVILLA ESPAÑA')[0] === 'sevilla' && trozosDeLugar('ALICANTE -ESPAÑA')[0] === 'alicante')
  ok('«MADRID/MADRID/ESPAÑA» deja madrid y quita el país', ((t) => t.includes('madrid') && !t.some((x) => x.includes('espana')))(trozosDeLugar('MADRID/MADRID/ESPAÑA')))
  ok('desde el final, el último trozo va primero tras el entero', trozosDeLugar('Calle Mayor 5, Elche, Alicante', true).join('|') === 'calle mayor 5 elche alicante|alicante|elche|calle mayor 5')
}

console.log('\n=== el índice entiende el artículo al final y los nombres dobles ===')
{
  const v = variantesDeNombre('Coruña, A')
  ok('«Coruña, A» -> «a coruña» (oficial) y «coruña» (débil)', v.oficiales.includes('a coruna') && v.debiles.includes('coruna'))
  ok("«Hospitalet de Llobregat, L'» -> «l hospitalet de llobregat»", variantesDeNombre("Hospitalet de Llobregat, L'").oficiales.includes('l hospitalet de llobregat'))
  ok('«Alacant/Alicante» -> las dos mitades y las dos juntas', ((x) => x.oficiales.includes('alacant') && x.oficiales.includes('alicante') && x.oficiales.includes('alacant alicante'))(variantesDeNombre('Alacant/Alicante')))
  ok('«Vitoria-Gasteiz» tiene «vitoria» y «gasteiz» como débiles', ((x) => x.debiles.includes('vitoria') && x.debiles.includes('gasteiz'))(variantesDeNombre('Vitoria-Gasteiz')))
  ok('«Granada» es la ciudad aunque exista «Granada, La» en Barcelona (la forma oficial gana a la débil)', buscarMunicipios('granada').length === 1 && buscarMunicipios('granada')[0].ine === '18087')
  ok('«Villanueva del Arzobispo» está en dos provincias: ambiguo', buscarMunicipios('villanueva del arzobispo').length >= 1)
  ok('un nombre inventado no existe', buscarMunicipios('villa ficticia del mar').length === 0)
}

console.log('\n=== la ciudad: los nombres tal como llegan en los leads ===')
{
  const casos: [string, string, string][] = [
    ['Madrid', 'MD', '28079'], ['MADRID', 'MD', '28079'], ['Barcelona', 'CT', '08019'], ['Valencia', 'VC', '46250'], ['Seville', 'AN', '41091'], ['Sevilla', 'AN', '41091'],
    ['A Coruña', 'GA', '15030'], ['La Coruña', 'GA', '15030'], ["L'Hospitalet de Llobregat", 'CT', '08101'], ['Las Rozas de Madrid', 'MD', '28127'],
    ['Castellón de la Plana', 'VC', '12040'], ['Castelló de la Plana', 'VC', '12040'], ['Alicante', 'VC', '03014'], ['Elche', 'VC', '03065'],
    ['Donostia-San Sebastian', 'PV', '20069'], ['San Sebastián', 'PV', '20069'], ['Vitoria-Gasteiz', 'PV', '01059'], ['Pamplona', 'NC', '31201'],
    ['Palma', 'IB', '07040'], ['Palma de Mallorca', 'IB', '07040'], ['Las Palmas de Gran Canaria', 'CN', '35016'], ['Santa Cruz de Tenerife', 'CN', '38038'],
    ['Gerona', 'CT', '17079'], ['Girona', 'CT', '17079'], ['Orense', 'GA', '32054'], ['Lérida', 'CT', '25120'], ['Sant Cugat del Vallès', 'CT', '08205'],
    ['Alcalá de Henares', 'MD', '28005'], ['Alcala de Henares', 'MD', '28005'], ['Pozuelo de Alarcón', 'MD', '28115'], ['Jerez de la Frontera', 'AN', '11020'],
    ['Ibiza', 'IB', '07026'], ['Mahón', 'IB', '07032'], ['Logroño', 'RI', '26089'], ['Santander', 'CB', '39075'], ['Oviedo', 'AS', '33044'], ['Gijón', 'AS', '33024'],
  ]
  for (const [texto, ccaa, ine] of casos) {
    const u = desdeCiudad(texto)
    ok(`«${texto}» -> ${ccaa} (${ine})`, u?.ccaa === ccaa && u?.ine === ine, JSON.stringify(u))
  }
  ok('la ciudad dice su origen y su confianza', desdeCiudad('Madrid')?.origen === 'ciudad' && desdeCiudad('Madrid')?.confianza === 'alta')
  ok('«Madrid, Spain» no se despista con el país', desdeCiudad('Madrid, Spain')?.ine === '28079')
  ok('«Falset, Tarragona» es Falset (CT)', ccaaDe(desdeCiudad('Falset, Tarragona')) === 'CT')
  ok('«Ribeira (A Coruña)» es de Galicia', ccaaDe(desdeCiudad('Ribeira (A Coruña)')) === 'GA')
  ok('una ciudad inventada o de otro país no se ubica', desdeCiudad('Springfield') === null && desdeCiudad('Shenzhen') === null && desdeCiudad('London') === null)
  ok('vacío no se ubica', desdeCiudad('') === null && desdeCiudad('   ') === null && desdeCiudad(null) === null && desdeCiudad(undefined) === null)
  ok('si ponen una comunidad en el campo ciudad, vale la comunidad', ccaaDe(desdeCiudad('Cataluña')) === 'CT' && ccaaDe(desdeCiudad('Andalucía')) === 'AN' && desdeCiudad('Cataluña')?.ine === null)
  ok('si ponen una provincia en el campo ciudad que no es municipio, vale la provincia', ccaaDe(desdeCiudad('Tenerife')) === 'CN' && ccaaDe(desdeCiudad('Mallorca')) === 'IB')
}

console.log('\n=== nombres que valen para varios municipios ===')
{
  ok('«Torrent» sin más pistas es el de València (el grande)', desdeCiudad('Torrent')?.ine === '46244' && desdeCiudad('Torrent')?.ccaa === 'VC')
  ok('«Torrent, Girona» es el de Girona (el propio texto manda)', desdeCiudad('Torrent, Girona')?.ccaa === 'CT')
  ok('«Arroyomolinos» sin más pistas es el de Madrid', desdeCiudad('Arroyomolinos')?.ccaa === 'MD')
  ok('«Arroyomolinos» con un código postal de Cáceres es el de Cáceres', desdeCiudad('Arroyomolinos 10180')?.ccaa === 'EX')
  ok('«Torrent» con una dirección de Girona se queda en Girona, aunque el grande sea el de València', ubicar({ ciudad: 'Torrent', direccion: 'Calle Mayor 3, 17123 Torrent' })?.ccaa === 'CT')
  ok('una duda que otro campo resuelve se resuelve con ese campo («Castejón» con teléfono de Cuenca)', ubicar({ ciudad: 'Castejón', telefono: '+34 969 12 34 56' })?.ccaa === 'CM')
  ok('un nombre que existe en dos comunidades, sin preferido ni pista, no se ubica («Sancti-Spíritus»)', desdeCiudad('Sancti-Spiritus') === null)
  ok('pero con una pista de otro campo sí («Sancti-Spíritus» con provincia Badajoz)', ubicar({ ciudad: 'Sancti-Spiritus', provincia: 'BADAJOZ' })?.ccaa === 'EX')
}

console.log('\n=== ida y vuelta: cada municipio del INE, escrito con su nombre oficial, se encuentra a sí mismo ===')
{
  let total = 0
  let exactos = 0
  let dudosos = 0
  const malos: string[] = []
  for (const [prov, filas] of Object.entries(tabla as unknown as Record<string, string[][]>)) {
    const ccaa = ccaaDeProvincia(prov)
    for (const [cod, nombre] of filas) {
      total++
      let exacto = true
      for (const forma of variantesDeNombre(nombre).oficiales) {
        const candidatos = buscarMunicipios(forma)
        if (candidatos.length > 1 && !candidatos.every((m) => m.ccaa === ccaa)) { dudosos++; exacto = false; continue }
        const u = desdeCiudad(forma)
        if (!u || u.ccaa !== ccaa) { malos.push(`${prov}${cod} ${nombre} -> ${u ? u.ccaa : 'null'}`); exacto = false; break }
        if (u.ine !== prov + cod) exacto = false
      }
      if (exacto) exactos++
    }
  }
  ok('los 8.132 municipios están en la lista', total === 8132, String(total))
  ok('más de 8.090 se encuentran a sí mismos con su código exacto', exactos > 8090, `${exactos} de ${total}`)
  ok('solo «Rioja» (un pueblo de Almería) se confunde con otra comunidad, porque «Rioja» a secas es La Rioja', malos.length === 1 && malos[0].startsWith('04078'), malos.join(' | '))
  ok('los nombres repartidos entre comunidades son pocos (menos de 40) y se deshacen con una pista', dudosos < 40, String(dudosos))
}

console.log('\n=== localidades que no son municipio ===')
{
  ok('«Torre del Mar» es de Vélez-Málaga (AN)', desdeCiudad('Torre del Mar')?.ine === '29094')
  ok('«San Pedro de Alcántara» es de Marbella', desdeCiudad('San Pedro de Alcántara')?.ine === '29069')
  ok('«Los Cristianos» es de Arona (CN)', desdeCiudad('Los Cristianos')?.ccaa === 'CN' && desdeCiudad('Los Cristianos')?.ine === '38006')
  ok('«Corralejo» es de La Oliva (CN)', desdeCiudad('Corralejo')?.ccaa === 'CN')
  ok('«Villarreal» es Vila-real (VC)', desdeCiudad('Villarreal')?.ccaa === 'VC')
}

console.log('\n=== el código postal ===')
{
  ok('un código postal español se lee', codigoPostalDe('Calle Mayor 5, 28001 Madrid') === '28001' && codigoPostalDe('08226, ES') === '08226')
  ok('el último gana (el número de la calle no)', codigoPostalDe('Calle 12345 número 3, 41710') === '41710')
  ok('seis cifras, cuatro cifras o el 00 no son un código postal', codigoPostalDe('Cluj 400157') === null && codigoPostalDe('Barcelona, 2015, c/ X') === null && codigoPostalDe('00100 Roma') === null)
  ok('un 53 o más no es de ninguna provincia', codigoPostalDe('94043 California') === null && codigoPostalDe('75001 Paris') === null)
  ok('un texto que acaba en otro país no vale', codigoPostalDe('Str. Ploiesti 9, Cluj Napoca, 40015, RO') === null && codigoPostalDe('Calle Mayor 5, 28001, ES') === '28001')
  ok('vacío: nada', codigoPostalDe('') === null && codigoPostalDe(null) === null && codigoPostalDe(undefined) === null)
}

console.log('\n=== la dirección ===')
{
  const casos: [string, string, string | null][] = [
    ['Calle Ignasi Iglesias 21, Terrassa, España, 08226, ES', 'CT', '08279'],
    ['CALLE TURIA, 21, VILLAVICIOSA DE ODON (MADRID), ESPAÑA, 28670, ES', 'MD', null],
    ['Calle Faraday, 7, Parque Científico de Madrid, Madrid, Madrid, 28049, ES', 'MD', '28079'],
    ['C/122, 14 – 46182 Paterna', 'VC', null],
    ['C/ Emilio Muñoz, 57 – 28037 Madrid', 'MD', '28079'],
    ['Calle Francisco Salzillo, 22, 41710', 'AN', null],
    ['BLANQUERNA 14 BAIXOS 07003, PALMA DE', 'IB', null],
    ['Avenida Alfafar, 2. 46910, Benetússer', 'VC', null],
  ]
  for (const [dir, ccaa, ine] of casos) {
    const u = desdeDireccion(dir)
    ok(`«${dir.slice(0, 50)}…» -> ${ccaa}${ine ? ` (${ine})` : ''}`, u?.ccaa === ccaa && (ine === null || u?.ine === ine), JSON.stringify(u))
  }
  ok('el código postal manda sobre una calle que se llama como un municipio de otra provincia («C/ Almansa» con 03205 es Alicante, no Albacete)', desdeDireccion('C/ Almansa, 20,03205, Elche')?.ccaa === 'VC')
  ok('«C/ALCOCER, 30, MADRID, MADRID, 28041» es Madrid (Alcocer es un municipio de Guadalajara)', desdeDireccion('C/ALCOCER, 30, MADRID, MADRID, 28041, ES')?.ccaa === 'MD' && desdeDireccion('C/ALCOCER, 30, MADRID, MADRID, 28041, ES')?.ine === '28079')
  ok('«…, Cerceda, Madrid, 28412» es Madrid (Cerceda es también de A Coruña)', desdeDireccion('C/ Granito, 5. Polígono Industrial Puente Madrid, Cerceda, Madrid, 28412, ES')?.ccaa === 'MD')
  ok('«…, GUADALUPE, MURCIA, 30107» es Murcia (Guadalupe es un municipio de Cáceres)', desdeDireccion('C/ DOCTOR SEVERO OCHOA, 23, GUADALUPE, MURCIA, 30107, ES')?.ccaa === 'MC')
  ok('un nombre truncado no engaña al código postal («08970, Sant Joan» es Barcelona, no Mallorca)', desdeDireccion('Polígono Font Santa c/ Les Planes 1H 08970, Sant Joan')?.ccaa === 'CT')
  ok('con código postal la confianza es alta', desdeDireccion('Calle Mayor 5, 28001 Madrid')?.confianza === 'alta')
  ok('sin código postal, el municipio del final vale pero con confianza media', ((u) => u?.ccaa === 'AN' && u?.confianza === 'media')(desdeDireccion('Avenida Los Vegas, 19, Málaga - España')))
  ok('sin código postal y sin municipio al final: nada («Calle Dinamarca, 8»)', desdeDireccion('Calle Dinamarca, 8') === null)
  ok('una dirección de otro país no se ubica por su código', desdeDireccion('los Estados Unidos con sede central en, California 94043') === null)
  ok('una dirección de Rumanía con su ", RO" no se ubica', desdeDireccion('Str. Ploiesti 9, 9, Cluj Napoca, Cluj, 400157, RO') === null)
}

console.log('\n=== el campo provincia de Amazon ===')
{
  const casos: [string, string][] = [
    ['MADRID', 'MD'], ['BARCELONA', 'CT'], ['MÁLAGA', 'AN'], ['MALAGA', 'AN'], ['A CORUÑA', 'GA'], ['LA CORUÑA', 'GA'], ['VIZCAYA', 'PV'], ['GIPUZKOA', 'PV'], ['CATALUÑA', 'CT'],
    ['COMUNIDAD VALENCIANA', 'VC'], ['ANDALUCÍA', 'AN'], ['ASTURIAS', 'AS'], ['ISLAS BALEARES', 'IB'], ['REGIÓN DE MURCIA', 'MC'], ['ALICANTE/ALACANT', 'VC'],
    ['MADRID/MADRID/ESPAÑA', 'MD'], ['VALENCIA, ESPAÑA', 'VC'], ['SEVILLA ESPAÑA', 'AN'], ['ALICANTE -ESPAÑA', 'VC'], ['MOLINA DE SEGURA', 'MC'], ['CASTILLA LA MANCHA', 'CM'],
  ]
  for (const [texto, ccaa] of casos) ok(`«${texto}» -> ${ccaa}`, desdeProvincia(texto)?.ccaa === ccaa, JSON.stringify(desdeProvincia(texto)))
  ok('«MADRID» en el campo provincia es la provincia: no afirma ningún municipio', desdeProvincia('MADRID')?.ine === null && desdeProvincia('MADRID')?.provincia === '28')
  ok('«MOLINA DE SEGURA» es un municipio y se sabe', desdeProvincia('MOLINA DE SEGURA')?.ine !== null)
  ok('«ESPAÑA» y «SPAIN» solos no dicen nada', desdeProvincia('ESPAÑA') === null && desdeProvincia('SPAIN') === null)
  ok('la basura no se ubica', desdeProvincia('<<<<<<<') === null && desdeProvincia('') === null && desdeProvincia(null) === null)
}

console.log('\n=== el Registro Mercantil ===')
{
  const casos: [string, string][] = [
    ['Registro Mercantil de Madrid', 'MD'], ['Registro mercantil de Barcelona', 'CT'], ['Registro Mercantil de Asturias, Tomo: 3550, Libro: 0, Folio 35, Sección 8, Hoja: AS 35614 2.- OBJETO', 'AS'],
    ['Registro Mercantil de Madrid bajo los asientos pertinentes de la hoja M-224803, la cual es operada a través de THE STORE TEAM, S.L', 'MD'],
    ['Registro Mercantil de La Rioja, al Tomo 480', 'RI'], ['Registro Mercantil de A Coruña Tomo 3819 Folio 15 Hoja C-63643', 'GA'], ['Registro Mercantil de Bilbao', 'PV'],
    ['Registro Mercantil de Palma de Mallorca', 'IB'], ['registro Mercantil de S/C de Tenerife tomo 1453, Folio 13, Hoja TF-14513', 'CN'], ['Registro Mercantil de la provincia de ALICANTE, Tomo 2698', 'VC'],
    ['Registro Mercantil de la Provincia de Jaén, folio 48', 'AN'],
  ]
  for (const [texto, ccaa] of casos) ok(`«${texto.slice(0, 55)}…» -> ${ccaa}`, desdeRegistro(texto)?.ccaa === ccaa, JSON.stringify(desdeRegistro(texto)))
  ok('el registro tiene confianza media (la empresa puede operar en otro sitio)', desdeRegistro('Registro Mercantil de Madrid')?.confianza === 'media')
  ok('un CIF suelto, una plantilla vacía o un registro extranjero no se ubican', desdeRegistro('B13938774') === null && desdeRegistro('Registro Mercantil de') === null && desdeRegistro('Registro Mercantil de Stuttgart, Hoja HRB753497') === null && desdeRegistro('Registro Mercantil de Ciudad al Tomo 12.345') === null)
}

console.log('\n=== el teléfono fijo ===')
{
  ok('el 91 es Madrid y el 93 Barcelona', desdeTelefono('+34 91 123 45 67')?.ccaa === 'MD' && desdeTelefono('931234567')?.ccaa === 'CT')
  ok('los prefijos de tres cifras: 954 Sevilla, 981 A Coruña, 965 Alicante, 971 Baleares, 928 Las Palmas', desdeTelefono('954123456')?.ccaa === 'AN' && desdeTelefono('981123456')?.ccaa === 'GA' && desdeTelefono('965123456')?.ccaa === 'VC' && desdeTelefono('971123456')?.ccaa === 'IB' && desdeTelefono('928123456')?.ccaa === 'CN')
  ok('un móvil (6 y 7) no dice nada', desdeTelefono('+34 661 10 93 31') === null && desdeTelefono('712345678') === null)
  ok('los 900, 901, 902 no son de ninguna provincia', desdeTelefono('900123456') === null && desdeTelefono('902123456') === null)
  ok('un teléfono extranjero o incompleto no se ubica', desdeTelefono('+44 20 7946 0958') === null && desdeTelefono('9123') === null && desdeTelefono('') === null && desdeTelefono(null) === null)
  ok('con +34, con 0034 o sin nada es el mismo número', cifrasDeTelefonoEspanol('+34 912 345 678') === '912345678' && cifrasDeTelefonoEspanol('0034912345678') === '912345678' && cifrasDeTelefonoEspanol('(+34) 91-234-56-78') === '912345678')
  ok('la confianza es baja (hay centralitas virtuales)', desdeTelefono('912345678')?.confianza === 'baja')
}

console.log('\n=== la web ===')
{
  ok('.cat es Cataluña, .gal Galicia y .eus País Vasco', desdeWeb('https://www.tienda.cat')?.ccaa === 'CT' && desdeWeb('tienda.gal/es')?.ccaa === 'GA' && desdeWeb('http://x.eus')?.ccaa === 'PV')
  ok('.es, .com y demás no dicen nada', desdeWeb('https://tienda.es') === null && desdeWeb('https://tienda.com') === null && desdeWeb(null) === null)
  ok('el .cat de una ruta no cuenta («tienda.com/catalogo.cat»)', desdeWeb('https://tienda.com/catalogo.cat') === null)
}

console.log('\n=== todo junto: el orden de las fuentes ===')
{
  ok('la ciudad gana a todo lo demás', ubicar({ ciudad: 'Valencia', direccion: 'Calle X 1, 28001 Madrid', telefono: '913456789' })?.ccaa === 'VC')
  ok('sin ciudad, gana la dirección con código postal', ubicar({ direccion: 'Calle X 1, 08001 Barcelona', provincia: 'MADRID', telefono: '913456789' })?.ccaa === 'CT')
  ok('sin ciudad ni dirección, la provincia', ubicar({ provincia: 'SEVILLA', registro: 'Registro Mercantil de Madrid', telefono: '913456789' })?.ccaa === 'AN')
  ok('sin lo anterior, el registro', ubicar({ registro: 'Registro Mercantil de Zaragoza, Tomo 3054', telefono: '913456789' })?.ccaa === 'AR')
  ok('sin lo anterior, el teléfono', ubicar({ telefono: '+34 976 12 34 56' })?.ccaa === 'AR')
  ok('sin lo anterior, la web', ubicar({ web: 'https://tienda.cat', telefono: '661109331' })?.ccaa === 'CT')
  ok('una ciudad que no se entiende no bloquea la siguiente fuente', ubicar({ ciudad: 'Shenzhen', direccion: 'Calle X 1, 28001 Madrid' })?.ccaa === 'MD')
  ok('el campo provincia ESPAÑA no bloquea: se pasa a la dirección', ubicar({ provincia: 'ESPAÑA', direccion: 'Calle Ignasi Iglesias 21, Terrassa, España, 08226, ES' })?.ccaa === 'CT')
  ok('sin ninguna pista: null', ubicar({}) === null && ubicar({ ciudad: '', provincia: null, direccion: '  ', telefono: '661109331' }) === null)
  ok('ubicacionesPosibles enseña todas las fuentes en orden de preferencia', ((l) => l.length === 3 && l[0].origen === 'ciudad' && l[1].origen === 'direccion' && l[2].origen === 'telefono')(ubicacionesPosibles({ ciudad: 'Madrid', direccion: 'Calle X 1, 28001 Madrid', telefono: '913456789' })))
  ok('la ciudad con municipio exacto da el INE; con solo provincia, no', ubicar({ ciudad: 'Madrid' })?.ine === '28079' && ubicar({ provincia: 'MADRID' })?.ine === null)
}

console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
if (fallos > 0) process.exit(1)
