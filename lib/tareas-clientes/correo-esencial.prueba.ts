import { asuntoLimpio, correoEsencial, nombreDelRemitente } from '@/lib/tareas-clientes/correo-esencial'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** El correo de Amazon del caso 13428935862 de Shoplamp, reenviado desde business@ (12 nov 2026), con los enlaces acortados */
const AMAZON = `---------- Forwarded message ---------
De: Asistencia al Vendedor de Amazon <merch.service05@amazon.es>
Date: mié, 4 nov 2026 a las 9:07
Subject: RE:[CASE 13428935862] Solicitud de conexión con soporte - Caso
existente 13390299342 (listing escalado a catálogo)
To: <business@ejemplo.com>



Hola, le contactamos desde el Soporte para Socios Vendedores de Amazon.

Nos ponemos en contacto con usted en relación con su seguimiento del Caso
13428935862, vinculado a la escalación de catálogo original del Caso
13390299342, relativa al contenido de la marca Solter para 18 SKUs cuyos
títulos, destacados y puntos de viñeta guardados en su cuenta no se
mostraban en las páginas de detalle públicas debido a que otros
colaboradores externos tienen prioridad en el Control de la Página de
Detalle.

Hemos confirmado que su cuenta está registrada como marca y que sus valores
de contenido enviados tienen prioridad. En base a los valores propuestos
que nos ha facilitado, hemos procedido a actualizar los títulos y los
puntos de viñeta de los siguientes ASINs: B0108EW6T0 y B00UCLRS16. Por
favor, espere hasta 48 horas para que estos cambios se reflejen en las
páginas de detalle públicas.

En cuanto a los ASINs restantes — B0D544X9DC, B00KB8XEJK, B0G6DL9HL1,
B0D6BQD35H, B09SZJ5KYP y B088JTHG99 — hemos escalado estos casos a nuestro equipo interno
para una investigación más detallada. Nos pondremos en contacto con usted
en cuanto tengamos una actualización o si necesitamos información adicional.

To help us continually improve, we ask that you take a moment to complete
our survey below to tell us about your experience with this specific
interaction.

Were you satisfied with the support provided?

Yes
<https://amazon.es/nms/redirect/aaa?nt=X>
No
<https://amazon.es/nms/redirect/bbb?nt=Y>


Atentamente,

Kaviya [C] R.
El equipo de Atención al vendedor para el Registro de marcas en Amazon


Copyright 2026 Amazon.com.mx, Inc. o sus afiliados. Todos los derechos
reservados.
Amazon EU S.à r.l.
38 avenue John F. Kennedy,
<https://www.google.com/maps/search/38+avenue>
L-1855 Luxemburgo

SPC-EUAmazon-2093471844995052`

function main() {
  console.log('\n=== el correo de Amazon reenviado ===')
  {
    const e = correoEsencial(AMAZON)
    ok('cuatro párrafos: el saludo y los tres que cuentan', e.parrafos.length === 4, JSON.stringify(e.parrafos.map((p) => p.slice(0, 40))))
    ok('empieza por el saludo de Amazon', e.parrafos[0] === 'Hola, le contactamos desde el Soporte para Socios Vendedores de Amazon.')
    ok('las líneas cortadas se unen en un párrafo', e.parrafos[1].startsWith('Nos ponemos en contacto con usted en relación con su seguimiento del Caso 13428935862, vinculado') && e.parrafos[1].endsWith('en el Control de la Página de Detalle.') && !e.parrafos[1].includes('\n'))
    ok('termina en «información adicional.»', e.parrafos[3].endsWith('si necesitamos información adicional.'))
    const todo = e.parrafos.join('\n')
    ok('sin la cabecera del reenvío', !/Forwarded|Subject:|Date:|To:/.test(todo))
    ok('sin la encuesta, la firma ni el pie', !/To help us|Were you satisfied|Yes|Atentamente|Kaviya|Copyright|Luxemburgo|SPC-/.test(todo))
    ok('sin enlaces', !/https?:/.test(todo))
    ok('quién lo mandó de verdad: Amazon, no quien lo reenvió', e.remitenteOriginal === 'Asistencia al Vendedor de Amazon <merch.service05@amazon.es>')
  }

  console.log('\n=== otros correos ===')
  {
    const directo = correoEsencial('Hello,\n\nWe have reviewed your\nappeal and reinstated the listing.\n\nBest regards,\nJohn\nAmazon')
    ok('en inglés y sin reenvío: corta en «Best regards»', directo.parrafos.join('|') === 'Hello,|We have reviewed your appeal and reinstated the listing.' && directo.remitenteOriginal === null, directo.parrafos.join('|'))
    const citado = correoEsencial('Perfecto, gracias.\n\nEl mar, 3 nov 2026 a las 10:00, Amazon <x@amazon.es> escribió:\n> Hola\n> texto viejo')
    ok('una respuesta: corta donde empieza lo citado', citado.parrafos.join('|') === 'Perfecto, gracias.', citado.parrafos.join('|'))
    const nota = correoEsencial('Mirad esto\n\n---------- Forwarded message ---------\nFrom: Amazon <a@amazon.com>\nSubject: x\n\nYour case was closed.\n\nRegards,')
    ok('lo que escribió encima quien reenvió se queda', nota.parrafos.join('|') === 'Mirad esto|Your case was closed.' && nota.remitenteOriginal === 'Amazon <a@amazon.com>', nota.parrafos.join('|'))
    const lista = correoEsencial('Falta:\n- la factura\n- la foto del\n  etiquetado\n\nGracias,')
    ok('las listas se quedan una por línea', lista.parrafos[0] === 'Falta:\n- la factura\n- la foto del etiquetado', JSON.stringify(lista.parrafos))
    const html = correoEsencial(null, '<html><head><style>p{}</style></head><body><p>Hola,</p><p>Su caso<br>sigue abierto.</p><p>Atentamente,</p><p>Amazon</p></body></html>')
    ok('sin texto, del HTML', html.parrafos.join('|') === 'Hola,|Su caso sigue abierto.', html.parrafos.join('|'))
    const solo = correoEsencial('Atentamente,\nAmazon')
    ok('si todo es despedida no se queda vacío', solo.parrafos.length > 0)
    ok('vacío es vacío', correoEsencial('', '').parrafos.length === 0)
    const outlook = correoEsencial('Recibido, lo miro.\n\nDe: Amazon <a@amazon.es>\nEnviado: lunes\nPara: nosotros\nAsunto: caso\n\nTexto viejo')
    ok('una respuesta de Outlook: corta en su cabecera', outlook.parrafos.join('|') === 'Recibido, lo miro.', outlook.parrafos.join('|'))
  }

  console.log('\n=== asunto y remitente ===')
  {
    ok('el asunto sin Fwd ni RE', asuntoLimpio('Fwd: RE:[CASE 13428935862] Solicitud') === '[CASE 13428935862] Solicitud' && asuntoLimpio('RV: Re: hola') === 'hola' && asuntoLimpio(null) === '')
    ok('el nombre del remitente', nombreDelRemitente('Asistencia al Vendedor de Amazon <merch.service05@amazon.es>') === 'Asistencia al Vendedor de Amazon' && nombreDelRemitente('<a@b.es>') === 'a@b.es' && nombreDelRemitente('a@b.es') === 'a@b.es')
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
