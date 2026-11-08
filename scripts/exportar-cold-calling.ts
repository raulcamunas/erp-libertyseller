/**
 * EXPORTAR TODA LA BASE DE COLD CALLING A UN EXCEL  —  npx tsx scripts/exportar-cold-calling.ts [carpeta]
 *
 * SOLO LEE. Saca todos los leads de Cold Calling (con sus teléfonos) a un libro de Excel: una pestaña «Resumen» y una pestaña por cada lista, con el comercial al que está asignado cada
 * lead y su estado. Usa la clave de servicio de .env.local. El fichero se guarda en la carpeta que le digas (por defecto, Descargas) y lleva datos personales: no lo subas a ningún sitio.
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import * as XLSX from 'xlsx'

for (const l of readFileSync('.env.local', 'utf8').split('\n')) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(l)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const ESTADOS: Record<string, string> = {
  pendiente: 'Pendiente',
  no_contesta: 'No contesta',
  programado: 'Programado',
  email_enviado: 'Email enviado',
  seguimiento: 'Seguimiento',
  cita_cualificada: 'Cita cualificada',
  cita_agendada: 'Cita agendada',
  no_interesa: 'No interesa',
}

type Fila = Record<string, unknown>

const texto = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (Array.isArray(v)) return v.map(texto).filter(Boolean).join(' · ')
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v).trim()
}
const fecha = (v: unknown): string => (typeof v === 'string' && v ? v.slice(0, 10) : '')

/** El nombre de una pestaña: sin los caracteres que Excel no admite, de hasta 31 letras y sin repetirse */
function nombreDePestana(nombre: string, usados: Set<string>): string {
  const base = (nombre.replace(/[\[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sin lista').slice(0, 31)
  let n = base
  for (let i = 2; usados.has(n.toLowerCase()); i++) n = `${base.slice(0, 28)} ${i}`
  usados.add(n.toLowerCase())
  return n
}

async function main() {
  const { createClient } = await import('@supabase/supabase-js')
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: perfiles } = await s.from('profiles').select('id, full_name, email')
  const comercial = new Map(((perfiles ?? []) as Array<{ id: string; full_name: string | null; email: string | null }>).map((p) => [p.id, (p.full_name ?? '').trim() || p.email || '']))

  const leads: Fila[] = []
  for (let desde = 0; ; desde += 1000) {
    const { data, error } = await s.from('cold_leads').select('*').order('id').range(desde, desde + 999)
    if (error) throw new Error(`No se han podido leer los leads: ${error.message}`)
    leads.push(...((data ?? []) as Fila[]))
    if (!data || data.length < 1000) break
    await new Promise((r) => setTimeout(r, 120)) // sin prisa: es una lectura puntual, que no cargue la base
  }

  const porLista = new Map<string, Fila[]>()
  for (const l of leads) {
    const lista = texto(l.source_list) || 'Sin lista'
    if (!porLista.has(lista)) porLista.set(lista, [])
    porLista.get(lista)!.push(l)
  }

  const columnas: Array<[string, (l: Fila) => string | number]> = [
    ['Tienda', (l) => texto(l.store_name)],
    ['Empresa', (l) => texto(l.company)],
    ['Teléfono', (l) => texto(l.phone)],
    ['Teléfonos extra', (l) => texto(l.telefonos_extra)],
    ['Email', (l) => texto(l.email)],
    ['Emails extra', (l) => texto(l.emails_extra)],
    ['Decisor', (l) => texto(l.decisor)],
    ['Cargo', (l) => texto(l.cargo_decisor)],
    ['Directores', (l) => texto(l.directors)],
    ['Provincia', (l) => texto(l.province)],
    ['Ciudad', (l) => texto(l.ciudad)],
    ['Comunidad', (l) => texto(l.ccaa)],
    ['Categoría', (l) => texto(l.category)],
    ['Facturación mensual', (l) => (typeof l.revenue_monthly === 'number' ? l.revenue_monthly : texto(l.revenue_monthly))],
    ['Plataforma', (l) => texto(l.plataforma)],
    ['Web', (l) => texto(l.web)],
    ['Instagram', (l) => texto(l.instagram)],
    ['LinkedIn', (l) => texto(l.linkedin)],
    ['URL de Amazon', (l) => texto(l.seller_url)],
    ['CIF', (l) => texto(l.cif)],
    ['Vende en Amazon', (l) => texto(l.vende_en_amazon)],
    ['Tipo de lead', (l) => texto(l.tipo_lead)],
    ['Estado', (l) => ESTADOS[texto(l.status)] ?? texto(l.status)],
    ['Comercial', (l) => (l.assigned_to ? comercial.get(String(l.assigned_to)) ?? '' : '')],
    ['Intentos', (l) => (typeof l.call_attempts === 'number' ? l.call_attempts : 0)],
    ['Último contacto', (l) => fecha(l.last_contacted_at)],
    ['Próxima llamada', (l) => fecha(l.next_call_date)],
    ['Seguimiento', (l) => texto(l.follow_up)],
    ['Prioridad', (l) => texto(l.prioridad)],
  ]

  const libro = XLSX.utils.book_new()
  const usados = new Set<string>(['resumen'])
  const listas = [...porLista.entries()].sort(([a], [b]) => a.localeCompare(b, 'es'))

  // Resumen: una fila por lista
  const estadosPresentes = [...new Set(leads.map((l) => texto(l.status)))].sort()
  const resumen: Array<Array<string | number>> = [['Lista', 'Pestaña', 'Leads', 'Con teléfono', 'Con email', ...estadosPresentes.map((e) => ESTADOS[e] ?? e), 'Comercial(es)']]
  const pestanas = new Map<string, string>()
  for (const [lista, filas] of listas) pestanas.set(lista, nombreDePestana(lista, usados))
  for (const [lista, filas] of listas) {
    const dueños = [...new Set(filas.map((l) => (l.assigned_to ? comercial.get(String(l.assigned_to)) ?? '' : '')).filter(Boolean))].join(' · ')
    resumen.push([lista, pestanas.get(lista)!, filas.length, filas.filter((l) => texto(l.phone) || texto(l.telefonos_extra)).length, filas.filter((l) => texto(l.email)).length, ...estadosPresentes.map((e) => filas.filter((l) => texto(l.status) === e).length), dueños])
  }
  resumen.push(['TOTAL', '', leads.length, leads.filter((l) => texto(l.phone) || texto(l.telefonos_extra)).length, leads.filter((l) => texto(l.email)).length, ...estadosPresentes.map((e) => leads.filter((l) => texto(l.status) === e).length), ''])
  const hojaResumen = XLSX.utils.aoa_to_sheet(resumen)
  hojaResumen['!cols'] = [{ wch: 34 }, { wch: 32 }, { wch: 9 }, { wch: 13 }, { wch: 11 }, ...estadosPresentes.map(() => ({ wch: 14 })), { wch: 36 }]
  XLSX.utils.book_append_sheet(libro, hojaResumen, 'Resumen')

  for (const [lista, filas] of listas) {
    const datos = [columnas.map(([titulo]) => titulo), ...filas.map((l) => columnas.map(([, f]) => f(l)))]
    const hoja = XLSX.utils.aoa_to_sheet(datos)
    // Los teléfonos y los CIF como texto: que Excel no les quite ceros ni los pase a notación científica
    const colTexto = new Set([columnas.findIndex(([t]) => t === 'Teléfono'), columnas.findIndex(([t]) => t === 'Teléfonos extra'), columnas.findIndex(([t]) => t === 'CIF')])
    for (let r = 1; r < datos.length; r++) for (const c of colTexto) {
      const celda = hoja[XLSX.utils.encode_cell({ r, c })]
      if (celda) celda.t = 's'
    }
    hoja['!cols'] = columnas.map(([t]) => ({ wch: Math.min(40, Math.max(10, t.length + 2, ...(['Tienda', 'Empresa', 'Email', 'Web', 'Seguimiento', 'URL de Amazon'].includes(t) ? [28] : [])), ) }))
    hoja['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: datos.length - 1, c: columnas.length - 1 } }) }
    XLSX.utils.book_append_sheet(libro, hoja, pestanas.get(lista)!)
  }

  const carpeta = process.argv[2] ?? join(homedir(), 'Downloads')
  const dia = new Date().toISOString().slice(0, 10)
  const ruta = join(carpeta, `Base de datos Cold Calling ${dia}.xlsx`)
  XLSX.writeFile(libro, ruta)
  console.log(`Guardado: ${ruta}`)
  console.log(`${leads.length} leads en ${listas.length} listas (${leads.filter((l) => texto(l.phone) || texto(l.telefonos_extra)).length} con teléfono)`)
  for (const [lista, filas] of listas) console.log(`  ${String(filas.length).padStart(6)}  ${lista}`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
