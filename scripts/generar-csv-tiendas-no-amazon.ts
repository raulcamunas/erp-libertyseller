/**
 * GENERA EL CSV DE LAS TIENDAS QUE TODAVÍA NO VENDEN EN AMAZON.
 *
 *   npx tsx scripts/generar-csv-tiendas-no-amazon.ts
 *
 * Lee «Tiendas por sectores - reparto comerciales.xlsx» del Escritorio, coge
 * las hojas de José y de Daniela (1.000 cada una) y escribe
 * supabase/seed/cold_leads_no_amazon.csv, listo para subir por el Table Editor
 * de Supabase.
 *
 * ESTE SCRIPT NO ESCRIBE EN LA BASE. Deja un fichero y nada más, igual que la
 * importación anterior: no hay endpoint de import de cold leads y no se
 * inventa uno aquí (además la política de INSERT de cold_leads solo deja a
 * admin/partner, así que un endpoint tendría que ir con el cliente de
 * servicio o los 2.000 INSERT se rechazarían en silencio fila a fila).
 *
 *
 * ============ POR QUÉ ABORTA EN VEZ DE APAÑAR LO QUE NO CUADRA ============
 *
 * Todas las comprobaciones de aquí terminan en «abortar», no en «avisar y
 * seguir». Una importación a mano por el Table Editor no tiene vuelta atrás
 * cómoda: no hay UPDATE ... ON CONFLICT, y la 091 (TRUNCATE CASCADE) ya no se
 * puede usar porque se llevaría por delante los 3.978 leads de Amazon y sus
 * notas. Así que un CSV con un valor que el CHECK va a rechazar, o con una fila
 * desplazada, se descubre cuando ya hay 400 filas dentro y el lote queda a
 * medias — que es exactamente lo que pasó la primera vez con José, 334 de
 * 1.178. Más barato parar aquí.
 */

import * as XLSX from 'xlsx'
import { writeFileSync } from 'fs'
import { join } from 'path'

const EXCEL = '/Users/raulcamunas/Desktop/Tiendas por sectores - reparto comerciales.xlsx'
const SALIDA = join(process.cwd(), 'supabase', 'seed', 'cold_leads_no_amazon.csv')

/** El lote de esta importación. Es el LOTE, no el tipo de lead: el tipo va en
    `tipo_lead`, que tiene CHECK. Ver el comentario de la migración 204. */
const LISTA = 'No Amazon V1'

/**
 * Quién trabaja cada hoja.
 *
 * Los emails van tal cual porque es lo que la 088 cruza contra
 * profiles.email. OJO CON EL DOMINIO: José es @libertyseller.com (alta de la
 * 087) y Daniela @libertyseller.es (alta de la 203). No son el mismo dominio y
 * un lead con un email que no existe en profiles se queda sin dueño sin avisar:
 * la 088 hace un UPDATE que simplemente no encuentra fila.
 */
const HOJAS: Array<{ hoja: string; comercial: string }> = [
  { hoja: 'José (1.000)', comercial: 'jose@libertyseller.com' },
  { hoja: 'Daniela (1.000)', comercial: 'daniela@libertyseller.es' },
]

/** Las seis columnas que rellena el comercial. Vienen vacías y NO se importan:
    si alguna trae datos es que alguien ha trabajado el Excel a mano y hay que
    decidir qué se hace con eso, no tirarlo. */
const COLUMNAS_DE_TRABAJO = [
  '¿Vende ya en Amazon?',
  'Estado',
  'Fecha contacto',
  'Próximo intento',
  'Resultado',
  'Notas',
]

/** Cabecera del CSV: nombres de columna de public.cold_leads, exactos. El Table
    Editor casa por cabecera, así que un nombre mal escrito entra como columna
    desconocida y tira la subida entera. */
const CABECERA = [
  'store_name',
  'company',
  'phone',
  'email',
  'category',
  'tipo_lead',
  'source_list',
  'import_email',
  'decisor',
  'cargo_decisor',
  'ciudad',
  'nivel',
  'ventas_estimadas_usd',
  'n_productos',
  'anos_tienda',
  'plataforma',
  'web',
  'instagram',
  'cif',
  'tipo_empresa',
  'n_administradores',
  'telefonos_extra',
  'emails_extra',
] as const

type Fila = Record<(typeof CABECERA)[number], string>

function texto(v: unknown): string {
  if (v === null || v === undefined) return ''
  return String(v).replace(/\s+/g, ' ').trim()
}

function numero(v: unknown): string {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(String(v).replace(',', '.'))
  return Number.isFinite(n) ? String(n) : ''
}

/**
 * El número del nivel, sin la etiqueta.
 *
 * En la base vive un SMALLINT con CHECK BETWEEN 1 AND 3: guardar «1 - Potencial
 * alto» entero impediría ordenar, y un 4 o un texto raro reventaría el CHECK a
 * mitad de subida. El rótulo lo pinta el código (COLD_NIVEL_LABELS).
 */
function nivel(v: unknown): string {
  const t = texto(v)
  if (!t) return ''
  const m = t.match(/^([123])\b/)
  if (!m) throw new Error(`Nivel que no es 1, 2 ni 3: «${t}»`)
  return m[1]
}

/**
 * «Sociedad» / «Autónomo» → los dos valores del CHECK, en minúscula y sin
 * tilde. Vacío se queda vacío A PROPÓSITO: 752 de cada 1.000 no lo traen, y
 * «no sabemos si es autónomo» no es «es sociedad». Cualquier otra cosa aborta,
 * porque el CHECK la rechazaría con el lote ya empezado.
 */
function tipoEmpresa(v: unknown): string {
  const t = texto(v).toLowerCase()
  if (!t) return ''
  if (t === 'sociedad') return 'sociedad'
  if (t === 'autonomo' || t === 'autónomo') return 'autonomo'
  throw new Error(`Tipo de empresa desconocido: «${texto(v)}»`)
}

/**
 * TIENE QUE HACER LO MISMO QUE public.normalizar_web() DE LA 204.
 *
 * Esa función es la que sostiene el índice único de deduplicación. Si las dos
 * normalizaciones se separan, este script dice que no hay duplicados y el
 * índice los rechaza a mitad de subida, dejando el lote a medias y sin forma
 * cómoda de deshacerlo.
 */
function normalizarWeb(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/+$/, '')
}

/** Una celda de CSV: se entrecomilla siempre que pueda haber coma, comilla o
    salto, que en estos datos es a menudo (hay razones sociales con comas y
    emails separados por «; »). */
function celda(v: string): string {
  if (v === '') return ''
  if (/[",\n\r;]/.test(v)) return `"${v.replace(/"/g, '""')}"`
  return v
}

function main() {
  const wb = XLSX.readFile(EXCEL)

  const filas: Fila[] = []
  /** web normalizada -> de dónde salió, para señalar el duplicado con nombre */
  const vistas = new Map<string, string>()
  const duplicados: string[] = []
  let sinWeb = 0
  let autonomos = 0
  let sinDecisor = 0

  for (const { hoja, comercial } of HOJAS) {
    const sheet = wb.Sheets[hoja]
    if (!sheet) {
      throw new Error(
        `No existe la hoja «${hoja}». Hojas del fichero: ${wb.SheetNames.join(' · ')}`
      )
    }

    const registros = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
    })

    registros.forEach((r, i) => {
      // El número de fila del Excel, contando la cabecera, para que el mensaje
      // de error se pueda buscar en la hoja directamente.
      const donde = `${hoja} fila ${i + 2}`

      try {
        // Las seis de trabajo tienen que venir vacías. Si no, alguien ha
        // avanzado sobre el Excel y ese trabajo no se puede tirar en silencio.
        for (const c of COLUMNAS_DE_TRABAJO) {
          if (texto(r[c])) {
            throw new Error(
              `la columna «${c}» trae «${texto(r[c])}». Esta importación no la sube: ` +
                `decide qué se hace con lo ya trabajado antes de seguir`
            )
          }
        }

        // «Provincia» dice «Europe» en las 1.000 medidas: es el campo region de
        // Store Leads y NO se importa. Se comprueba de todas formas, porque si
        // algún día trajera provincias de verdad habría que replantear el mapeo
        // en vez de seguir tirando la columna.
        const provincia = texto(r['Provincia'])
        if (provincia && provincia !== 'Europe') {
          throw new Error(
            `«Provincia» dice «${provincia}» y no «Europe». Esa columna no se ` +
              `importa porque es la región de Store Leads; si ahora trae provincias ` +
              `de verdad, hay que revisar el mapeo`
          )
        }

        const tienda = texto(r['Tienda'])
        if (!tienda) throw new Error('sin nombre de tienda, y store_name es NOT NULL')

        const web = texto(r['Web'])
        if (web) {
          const clave = normalizarWeb(web)
          const previa = vistas.get(clave)
          if (previa) {
            // No se sube: el índice único de la 204 lo rechazaría y dejaría el
            // lote a medias. Se apunta y se sigue, para poder verlos todos de
            // una vez en vez de fila a fila.
            duplicados.push(`${clave} (${previa} / ${donde})`)
            return
          }
          vistas.set(clave, donde)
        } else {
          // Sin web no hay clave de deduplicación para esa fila. Se sube igual
          // —el índice es parcial y no le afecta—, pero conviene saber cuántas
          // son: son las que podrían duplicarse en una reimportación.
          sinWeb++
        }

        const decisor = texto(r['Decisor'])
        if (!decisor) sinDecisor++
        const tipo = tipoEmpresa(r['Tipo'])
        if (tipo === 'autonomo') autonomos++

        filas.push({
          store_name: tienda,
          company: texto(r['Razón social']),
          phone: texto(r['Teléfono']),
          email: texto(r['Email']),
          category: texto(r['Sector']),
          tipo_lead: 'tienda_online',
          source_list: LISTA,
          import_email: comercial,
          decisor,
          cargo_decisor: texto(r['Cargo']),
          ciudad: texto(r['Ciudad']),
          nivel: nivel(r['Nivel']),
          ventas_estimadas_usd: numero(r['Ventas est. $/mes']),
          n_productos: numero(r['Nº productos']),
          anos_tienda: numero(r['Años']),
          plataforma: texto(r['Plataforma']),
          web,
          instagram: texto(r['Instagram']),
          cif: texto(r['CIF']),
          tipo_empresa: tipo,
          n_administradores: numero(r['Nº admin. activos']),
          telefonos_extra: texto(r['Teléfonos extra']),
          emails_extra: texto(r['Emails extra']),
        })
      } catch (e) {
        throw new Error(`${donde}: ${(e as Error).message}`)
      }
    })
  }

  const lineas = [CABECERA.join(',')]
  for (const f of filas) lineas.push(CABECERA.map((c) => celda(f[c])).join(','))
  writeFileSync(SALIDA, lineas.join('\n') + '\n', 'utf8')

  const kb = Math.round(Buffer.byteLength(lineas.join('\n'), 'utf8') / 1024)
  console.log(`\n${SALIDA}`)
  console.log(`  ${filas.length} tiendas · ${kb} KB · lista «${LISTA}»`)
  for (const { hoja, comercial } of HOJAS) {
    console.log(
      `  ${comercial}: ${filas.filter((f) => f.import_email === comercial).length} (${hoja})`
    )
  }
  console.log(`  ${autonomos} autónomos: a esos NO se les llama en frío, van por email`)
  console.log(`  ${sinDecisor} sin decisor: la ficha dirá «pregunta por el responsable»`)
  console.log(`  ${sinWeb} sin web: son las que no tienen clave de deduplicación`)

  if (duplicados.length > 0) {
    console.log(
      `\n  ${duplicados.length} filas descartadas por web repetida (el índice único de la 204 ` +
        `las habría rechazado a mitad de subida):`
    )
    for (const d of duplicados.slice(0, 20)) console.log(`    ${d}`)
    if (duplicados.length > 20) console.log(`    ... y ${duplicados.length - 20} más`)
  }

  // El Table Editor no traga ficheros de varios MB de golpe: la importación
  // anterior hubo que trocearla en cuatro. Esto avisa si vuelve a pasar en vez
  // de dejar que la subida se caiga a medias.
  if (kb > 1024) {
    console.log(
      `\n  OJO: ${kb} KB. La vez anterior el Table Editor se atragantó con 1,8 MB y hubo ` +
        `que partir el CSV en cuatro. Pártelo antes de subirlo.`
    )
  }

  console.log(
    `\n  Siguiente paso: la 204 en el editor SQL, luego este CSV por el Table Editor, ` +
      `luego la 088. Está escrito en la cabecera de la 204.\n`
  )
}

main()
