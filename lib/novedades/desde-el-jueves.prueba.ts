import { GUION_DE_LA_DEMO, NOVEDADES } from '@/lib/novedades/desde-el-jueves'

let fallos = 0
let comprobaciones = 0
const ok = (n: string, bien: boolean, d = '') => {
  comprobaciones++
  if (!bien) fallos++
  console.log(`  ${bien ? 'OK   ' : 'FALLA'} ${n}${bien || !d ? '' : ` -> ${d}`}`)
}

/** Todo el texto que se ve en pantalla, con de qué novedad sale */
const textos = [
  ...NOVEDADES.flatMap((n) => [
    { de: n.id, texto: n.titulo },
    { de: n.id, texto: n.cuando },
    { de: n.id, texto: n.queEs },
    { de: n.id, texto: n.donde },
    ...n.puntos.map((p) => ({ de: n.id, texto: p })),
  ]),
  ...GUION_DE_LA_DEMO.flatMap((p) => [
    { de: `guion ${p.titulo}`, texto: p.titulo },
    { de: `guion ${p.titulo}`, texto: p.texto },
  ]),
]

function main() {
  console.log('\n=== la lista está completa y bien formada ===')
  {
    ok('hay novedades', NOVEDADES.length >= 10, String(NOVEDADES.length))
    const ids = NOVEDADES.map((n) => n.id)
    ok('los identificadores no se repiten y son claves cortas', new Set(ids).size === ids.length && ids.every((i) => /^[a-z]+(-[a-z]+)*$/.test(i)))
    const titulos = NOVEDADES.map((n) => n.titulo)
    ok('los títulos no se repiten', new Set(titulos).size === titulos.length)
    ok('la etiqueta es una de las tres', NOVEDADES.every((n) => n.etiqueta === 'Nuevo' || n.etiqueta === 'Mejora' || n.etiqueta === 'Arreglo'))
    ok('hay de las tres clases (la pantalla cuenta las nuevas)', ['Nuevo', 'Mejora', 'Arreglo'].every((e) => NOVEDADES.some((n) => n.etiqueta === e)))
    ok('todas dicen cuándo, qué es y dónde se ve', NOVEDADES.every((n) => n.cuando.trim() && n.queEs.trim() && n.donde.trim()))
    ok('todas traen al menos un punto, y ninguno vacío', NOVEDADES.every((n) => n.puntos.length >= 1 && n.puntos.every((p) => p.trim().length > 0)))
    // La pantalla usa el texto del punto como clave de React: dos iguales en la misma novedad darían un aviso y se pintarían mal
    ok('dentro de una novedad no se repite ningún punto', NOVEDADES.every((n) => new Set(n.puntos).size === n.puntos.length))
    // (El «cuándo» y el «dónde» sí pueden repetirse: dos cosas del mismo día o de la misma pantalla)
    const parrafos = [
      ...NOVEDADES.flatMap((n) => [{ de: n.id, texto: n.titulo }, { de: n.id, texto: n.queEs }, ...n.puntos.map((p) => ({ de: n.id, texto: p }))]),
      ...GUION_DE_LA_DEMO.map((p) => ({ de: `guion ${p.titulo}`, texto: p.texto })),
    ]
    const repetidos = parrafos.filter((t, i) => parrafos.findIndex((o) => o.texto === t.texto) !== i).map((t) => t.de)
    ok('ningún párrafo se repite palabra por palabra en toda la pantalla', repetidos.length === 0, repetidos.join(', '))
  }

  console.log('\n=== el guion de la demostración ===')
  {
    ok('hay cuatro pasos con título y texto', GUION_DE_LA_DEMO.length === 4 && GUION_DE_LA_DEMO.every((p) => p.titulo.trim() && p.texto.trim()))
    ok('los títulos del guion no se repiten (son la clave de React)', new Set(GUION_DE_LA_DEMO.map((p) => p.titulo)).size === GUION_DE_LA_DEMO.length)
  }

  console.log('\n=== el texto se lee bien ===')
  {
    const raros = textos.filter((t) => /[֐-׿؀-ۿ぀-ヿ一-鿿Ѐ-ӿ]/.test(t.texto)).map((t) => t.de)
    ok('ningún carácter de otro alfabeto (hebreo, árabe, cirílico, chino…)', raros.length === 0, raros.join(', '))
    const dobles = textos.filter((t) => /\s{2,}|^\s|\s$/.test(t.texto)).map((t) => t.de)
    ok('sin espacios dobles ni al principio o al final', dobles.length === 0, dobles.join(', '))
    const comillas = textos.filter((t) => (t.texto.match(/«/g) ?? []).length !== (t.texto.match(/»/g) ?? []).length).map((t) => t.de)
    ok('las comillas «» se abren y se cierran', comillas.length === 0, comillas.join(', '))
    const largos = textos.filter((t) => t.texto.length > 330).map((t) => `${t.de} (${t.texto.length})`)
    ok('ningún texto pasa de 330 caracteres (se leería mal proyectado)', largos.length === 0, largos.join(', '))
    const sinPunto = NOVEDADES.filter((n) => !/[.!?»)]$/.test(n.queEs.trim())).map((n) => n.id)
    ok('lo que «es» cada novedad acaba en punto', sinPunto.length === 0, sinPunto.join(', '))
  }

  console.log('\n=== lo que NO se cuenta en pantalla ===')
  {
    // El registro de actividad del equipo, el cierre de sesión por inactividad y el rastro de quién lee qué buzón: decisión de Raúl, sin aviso a los empleados.
    // Esta lista la puede ver cualquiera que esté delante de la pantalla durante el briefing.
    const PROHIBIDO: { que: string; patron: RegExp }[] = [
      { que: 'actividad del equipo', patron: /actividad\s+del\s+equipo/i },
      { que: 'inactividad / cierre de sesión', patron: /inactiv|cierre\s+de\s+sesi|cierra\s+(la\s+)?sesi|cerrar\s+(la\s+)?sesi/i },
      { que: 'tiempo activo / clics / pantallas visitadas', patron: /tiempo\s+activo|registr\w+\s+(los\s+)?clics|clics\s+(de|por)\s+(cada\s+)?(empleado|persona|usuario)|pantallas\s+(que\s+)?(visit|abr)/i },
      { que: 'auditoría o rastro de accesos', patron: /audit|rastro|queda\s+anotad|registro\s+de\s+accesos|su\s+due(ñ|n)o\s+lo\s+ve/i },
      { que: 'vigilancia', patron: /vigil|espiar|monitoriz/i },
    ]
    for (const p of PROHIBIDO) {
      const donde = textos.filter((t) => p.patron.test(t.texto)).map((t) => t.de)
      ok(`no aparece «${p.que}»`, donde.length === 0, donde.join(', '))
    }
    const NOMBRES = /\b(Jhanna|Daniela|Mar[ií]a\s+Fernanda|Maoli|Alejandro|Ra[uú]l|Entrais|Portico|ShoesF|Shoplamp)\b/i
    const conNombre = textos.filter((t) => NOMBRES.test(t.texto)).map((t) => t.de)
    ok('no se nombra a personas del equipo ni a clientes concretos', conNombre.length === 0, conNombre.join(', '))
    const secretos = textos.filter((t) => /sk-[A-Za-z0-9]{10,}|eyJ[A-Za-z0-9_-]{10,}|https?:\/\/|@[a-z0-9-]+\.(com|es|net)/i.test(t.texto)).map((t) => t.de)
    ok('ni claves, ni enlaces, ni direcciones de correo', secretos.length === 0, secretos.join(', '))
  }

  console.log(fallos === 0 ? `\nTODO BIEN (${comprobaciones} comprobaciones)\n` : `\n${fallos} FALLOS\n`)
  if (fallos > 0) process.exit(1)
}

main()
