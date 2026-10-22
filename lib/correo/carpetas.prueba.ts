import { elegirCarpetas } from '@/lib/correo/carpetas'

let fallos = 0
const ok = (n: string, bien: boolean, d = '') => {
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}
const igual = (n: string, real: unknown, esperado: unknown) => ok(n, JSON.stringify(real) === JSON.stringify(esperado), `real ${JSON.stringify(real)}, esperado ${JSON.stringify(esperado)}`)

/** CARPETAS: cuáles de un buzón se leen. */

igual(
  'Titan: los atributos mandan',
  elegirCarpetas([{ path: 'INBOX', specialUse: '\\Inbox' }, { path: 'Drafts', specialUse: '\\Drafts' }, { path: 'Sent', specialUse: '\\Sent' }, { path: 'Trash', specialUse: '\\Trash' }]),
  { entrada: 'INBOX', enviados: 'Sent' }
)
igual(
  'Hostinger: INBOX.Sent con atributo',
  elegirCarpetas([{ path: 'INBOX' }, { path: 'INBOX.Sent', specialUse: '\\Sent' }, { path: 'INBOX.Drafts', specialUse: '\\Drafts' }]),
  { entrada: 'INBOX', enviados: 'INBOX.Sent' }
)
igual('sin atributos: por el nombre (INBOX.Sent)', elegirCarpetas([{ path: 'INBOX' }, { path: 'INBOX.Sent' }, { path: 'INBOX.Trash' }]), { entrada: 'INBOX', enviados: 'INBOX.Sent' })
igual('sin atributos: en español', elegirCarpetas([{ path: 'INBOX' }, { path: 'Enviados' }, { path: 'Papelera' }]), { entrada: 'INBOX', enviados: 'Enviados' })
igual('sin atributos: Elementos enviados', elegirCarpetas([{ path: 'INBOX' }, { path: 'Elementos enviados' }]), { entrada: 'INBOX', enviados: 'Elementos enviados' })
igual('sin atributos: Sent Items', elegirCarpetas([{ path: 'INBOX' }, { path: 'Sent Items' }]), { entrada: 'INBOX', enviados: 'Sent Items' })
igual('con barra como separador', elegirCarpetas([{ path: 'INBOX' }, { path: 'Correo/Enviados' }]), { entrada: 'INBOX', enviados: 'Correo/Enviados' })
igual('se prefiere la de fuera de INBOX cuando hay dos por nombre', elegirCarpetas([{ path: 'INBOX' }, { path: 'INBOX.Sent' }, { path: 'Sent' }]), { entrada: 'INBOX', enviados: 'Sent' })
igual('una carpeta con otro nombre que contiene la palabra no cuenta', elegirCarpetas([{ path: 'INBOX' }, { path: 'Presentaciones enviadas a clientes' }]), { entrada: 'INBOX', enviados: null })
igual('sin enviados', elegirCarpetas([{ path: 'INBOX' }, { path: 'Trash' }]), { entrada: 'INBOX', enviados: null })
igual('una carpeta sin selección no vale', elegirCarpetas([{ path: 'INBOX' }, { path: 'Sent', flags: ['\\Noselect'] }]), { entrada: 'INBOX', enviados: null })
igual('flags como Set', elegirCarpetas([{ path: 'INBOX' }, { path: 'Sent', flags: new Set(['\\HasNoChildren']) }]), { entrada: 'INBOX', enviados: 'Sent' })
igual('INBOX en minúsculas', elegirCarpetas([{ path: 'inbox' }, { path: 'Sent', specialUse: '\\Sent' }]), { entrada: 'inbox', enviados: 'Sent' })
igual('lista vacía', elegirCarpetas([]), { entrada: 'INBOX', enviados: null })

console.log(fallos === 0 ? '\nTODO BIEN' : `\n${fallos} FALLOS`)
process.exit(fallos === 0 ? 0 : 1)
