import { leerEnlaceDeGoogle } from '@/lib/tareas-clientes/enlace-google'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/**
 * LOS ENLACES DE GOOGLE EN UNA TAREA. Lo que duele si falla: que un enlace de Google normal no se reconozca (y no salga el visor), o que uno que NO es de Google se meta en un iframe (un enlace a una web cualquiera
 * incrustada dentro del ERP).
 */
const ID = '1e1wzwl4QNff3PKI0ABtPvIJjQog5Q0xmkNqk4bNuXnw'
const L = leerEnlaceDeGoogle

function main() {
  console.log('\n=== documentos, hojas y presentaciones ===')
  {
    const d = L(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`)
    ok('un documento: tipo, id y visor de vista previa', d?.tipo === 'documento' && d.id === ID && d.visor === `https://docs.google.com/document/d/${ID}/preview` && d.etiqueta === 'Documento de Google')
    const h = L('https://docs.google.com/spreadsheets/d/1VqZcyTLtW7aW5ae-KjwbmyYO66ng9G04/edit?usp=sharing&ouid=116588927195603002630&rtpof=true&sd=true')
    ok('el enlace de la captura: una hoja', h?.tipo === 'hoja' && h.id === '1VqZcyTLtW7aW5ae-KjwbmyYO66ng9G04' && h.visor === 'https://docs.google.com/spreadsheets/d/1VqZcyTLtW7aW5ae-KjwbmyYO66ng9G04/preview')
    ok('una presentación', L(`https://docs.google.com/presentation/d/${ID}/edit#slide=id.p`)?.tipo === 'presentacion')
    ok('con el número de cuenta de Google (/u/0/)', L(`https://docs.google.com/document/u/0/d/${ID}/edit`)?.id === ID && L(`https://docs.google.com/u/1/document/d/${ID}/edit`)?.id === ID)
    ok('el enlace original se conserva para abrirlo en Google', L(`https://docs.google.com/document/d/${ID}/edit?usp=sharing`)?.abrir === `https://docs.google.com/document/d/${ID}/edit?usp=sharing`)
  }

  console.log('\n=== Drive: archivos y carpetas ===')
  {
    const a = L(`https://drive.google.com/file/d/${ID}/view?usp=drive_link`)
    ok('un archivo (PDF, imagen, vídeo…): visor de vista previa', a?.tipo === 'archivo' && a.visor === `https://drive.google.com/file/d/${ID}/preview`)
    ok('un archivo con /u/0/', L(`https://drive.google.com/file/u/0/d/${ID}/view`)?.id === ID)
    ok('open?id= y uc?id=', L(`https://drive.google.com/open?id=${ID}`)?.id === ID && L(`https://drive.google.com/uc?id=${ID}&export=download`)?.id === ID)
    const c = L(`https://drive.google.com/drive/folders/${ID}?usp=sharing`)
    ok('una carpeta: lista incrustada', c?.tipo === 'carpeta' && c.visor === `https://drive.google.com/embeddedfolderview?id=${ID}#list`)
    ok('una carpeta con /u/0/ y sin /drive/', L(`https://drive.google.com/drive/u/0/folders/${ID}`)?.id === ID && L(`https://drive.google.com/folders/${ID}`)?.id === ID)
    const f = L(`https://docs.google.com/forms/d/e/1FAIpQLSdXXXXXXXXXXXXXXXXXXXX/viewform`)
    ok('un formulario se reconoce pero no se incrusta (solo se abre)', f?.tipo === 'formulario' && f.visor === null)
  }

  console.log('\n=== lo que NO es de Google ===')
  {
    ok('otras webs: no', ['https://www.notion.so/pagina-123', 'https://example.com/document/d/' + ID, 'https://www.figma.com/file/abc', 'https://dropbox.com/s/abc'].every((u) => L(u) === null))
    ok('dominios que se parecen: no', ['https://docs.google.com.evil.com/document/d/' + ID, 'https://evil.com/docs.google.com/document/d/' + ID, 'https://fakedrive.google.com/file/d/' + ID, 'https://drive.google.com.evil.io/file/d/' + ID].every((u) => L(u) === null))
    ok('http (sin la s): no', L(`http://docs.google.com/document/d/${ID}/edit`) === null)
    ok('esquemas raros: no', [L('javascript:alert(1)'), L('data:text/html,<b>'), L('ftp://docs.google.com/document/d/' + ID)].every((x) => x === null))
    ok('Google pero sin identificador válido: no', [L('https://docs.google.com/document/d/corto/edit'), L('https://docs.google.com/document/'), L('https://drive.google.com/drive/my-drive'), L('https://drive.google.com/file/d/')].every((x) => x === null))
    ok('vacío, null, texto suelto, enorme: no', [L(''), L(null), L(undefined), L('hola que tal'), L('https://docs.google.com/' + 'a'.repeat(2500))].every((x) => x === null))
    ok('un id con caracteres raros no entra al visor', L('https://docs.google.com/document/d/abc"><script>alert(1)</script>/edit') === null)
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS de ${comprobaciones} comprobaciones\n`)
  if (fallos > 0) process.exit(1)
}

main()
