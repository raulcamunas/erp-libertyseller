/**
 * LOS TEXTOS DE LA DEMOSTRACIÓN DE SECUENCIAS — GENERADOS CON LA IA DE VERDAD, UNA VEZ.
 * =====================================================================================
 * Para cada persona de demo-personas.ts: el primer correo que le escribiría su comercial con «Redactar con IA», los dos BORRADORES de seguimiento que escribe la IA al programar la
 * secuencia y lo que la IA escribe «a medida» justo antes de enviar cada uno (o la decisión de pausar), todo con los mismos prompts y el mismo código que usa el ERP
 * (lib/correo/ia-laboratorio-casos.ts y lib/correo/secuencias/ia.ts), con lo que constaba en su ficha en cada momento. Generados el 26 de octubre de 2026; no se piden de nuevo en cada
 * demostración (cuesta dinero y tardaría), así que son un ejemplo fijo y bien revisado. Solo se tocó una palabra: la IA coló una en hebreo en uno de los textos.
 *
 * `medida[n]` existe solo para los seguimientos que llegan a escribirse en la historia de demo.ts.
 */

export interface TextosDeUnaPersona {
  primero: { asunto: string; texto: string }
  /** Los dos seguimientos como los dejó escritos la IA al programar la secuencia */
  borradores: [string, string]
  /** Lo que la IA decidió y escribió justo antes de enviar el seguimiento n (1 o 2) */
  medida: Partial<Record<'1' | '2', { decision: 'escribir' | 'pausar'; motivo: string; texto: string }>>
}

export const TEXTOS_DE_DEMO: Record<string, TextosDeUnaPersona> = {
  ceramica: {
    "primero": {
      "asunto": "Cerámica Mediterránea y Amazon: una vía para vuestro catálogo",
      "texto": "Hola,\n\nCerámica Mediterránea cuenta con un catálogo amplio de cerámica artesanal y ya dispone de tienda online propia. Amazon puede ser un canal complementario para dar más visibilidad a vuestras piezas sin trasladar una carga adicional a vuestro equipo.\n\nEn una categoría con demanda y bastante competencia, una puesta en marcha bien planteada ayuda a presentar el catálogo, organizar la logística y trabajar la publicidad desde el inicio. En Liberty Seller estamos especializados en la gestión de marcas en Amazon.\n\nPodemos enseñarte en una videollamada breve cómo enfocar la entrada de vuestra marca y qué opciones tendríais para hacerlo de forma ordenada, sin compromiso. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nEn cerámica artesanal, explicar bien las diferencias entre piezas y colecciones puede ayudar a que el catálogo resulte claro en Amazon, especialmente cuando hay muchos productos. También podemos valorar cómo presentar esa variedad desde el inicio. ¿Te encajaría una videollamada de 10-15 minutos para comentarlo?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para valorar Amazon, y no pasa nada. Si te interesa retomarlo, puedes contestarme «sí»; si prefieres dejarlo para más adelante, también me vale con que me lo digas.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "El primer correo ya propuso una videollamada y habló de la puesta en marcha; este seguimiento plantea como nuevo ángulo priorizar qué parte del amplio catálogo artesanal abrir primero en Amazon.",
        "texto": "Hola,\n\nAl tener ya la tienda en Shopify y un catálogo amplio, otra cuestión práctica sería decidir qué productos de cerámica tendría más sentido presentar primero en Amazon, en lugar de abrir todo a la vez. ¿Tenéis previsto valorar este canal para vuestra marca?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "No ha respondido a los dos correos y no consta ninguna petición de pausa; cierro la secuencia con una opción sencilla y sin presión.",
        "texto": "Hola, quizá ahora no sea buen momento para plantear la entrada en Amazon. Si te apetece que lo retomemos, contéstame «sí»; si prefieres dejarlo para más adelante, dime «más adelante» y lo dejamos aquí por ahora.\n\nUn saludo,"
      }
    }
  },
  audiomax: {
    "primero": {
      "asunto": "Audiomax en Amazon: ideas para un catálogo de audio",
      "texto": "Hola,\n\nAudiomax trabaja en electrónica y audio, una categoría en Amazon donde la visibilidad de cada producto y la competencia por las búsquedas marcan mucho la diferencia. Con un catálogo amplio, suele haber margen para reforzar las fichas prioritarias y ordenar la publicidad para ganar presencia sin añadir carga a vuestro equipo.\n\nEn Liberty Seller estamos especializados en la gestión y optimización de cuentas de Amazon. Podemos enseñarte en una videollamada breve qué palancas tendrían más sentido para vuestro catálogo, desde contenido de producto hasta posicionamiento y campañas.\n\n¿Te viene mejor comentarlo esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nAdemás de las compras particulares, en audio puede tener sentido valorar Amazon Business para llegar a compradores profesionales. ¿Es un canal que os interesa explorar para Audiomax?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para hablar de Amazon. Si te interesa retomarlo, contéstame «sí» y buscamos un hueco para una videollamada breve; si lo prefieres, puedes decirme «mejor más adelante».\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "El primer correo se centró en fichas, posicionamiento y campañas; este seguimiento plantea un ángulo distinto y pertinente para su catálogo de audio: Amazon Business.",
        "texto": "Hola,\n\nPara un catálogo de audio como el vuestro, también podría tener sentido revisar si Amazon Business encaja para llegar a compradores profesionales. ¿Os interesa explorar ese canal?\n\nUn saludo,"
      }
    }
  },
  casaluz: {
    "primero": {
      "asunto": "Casa Luz Decoración y su entrada en Amazon",
      "texto": "Hola,\n\nCasa Luz Decoración cuenta con una tienda online en Shopify y un catálogo de decoración con varias decenas de referencias. Amazon puede ser un canal interesante para dar visibilidad a esos productos sin añadir carga operativa a vuestro equipo.\n\nEn categorías de hogar, una buena puesta en marcha ayuda a que el catálogo tenga una presentación coherente desde el inicio y a que las búsquedas relevantes no las ocupen solo otras marcas. Desde Liberty Seller, agencia especializada en Amazon, os ayudamos a gestionar el alta, las fichas, la logística y la publicidad.\n\nEn una videollamada breve y sin compromiso podemos enseñarte cómo plantearíamos la entrada de Casa Luz Decoración en Amazon. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nEn una primera fase, un catálogo de varias decenas de referencias permite valorar qué productos tendría sentido preparar primero para Amazon y cómo organizar su puesta en marcha desde Shopify. ¿Tenéis previsto explorar este canal para Casa Luz Decoración? Puedes responderme simplemente «sí» o «no».\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para plantear la entrada en Amazon. Si os interesa retomarlo, podemos revisar vuestro caso en una videollamada breve de 10-15 minutos; si preferís dejarlo para más adelante, basta con que me contestes «mejor más adelante».\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "La empresa aún no vende en Amazon; planteo como nuevo ángulo la organización de la logística y las devoluciones desde el inicio, y menciono con naturalidad que hoy intenté llamar.",
        "texto": "Hola,\n\nHoy he intentado llamarte, pero no he conseguido localizarte. Para una entrada en Amazon, además de preparar las fichas, conviene decidir cómo organizar la logística y las devoluciones desde el principio. ¿Te gustaría que revisáramos ese punto para Casa Luz Decoración? Puedes responderme simplemente «sí» o «no».\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "No ha respondido a los dos correos y la llamada de hace cuatro días no llegó a conversación; dejo abierta la opción de retomar la entrada de Casa Luz Decoración en Amazon sin presionar.",
        "texto": "Hola,\n\nQuizá ahora no sea el mejor momento para plantear la entrada de Casa Luz Decoración en Amazon. Si os interesa retomarlo, podemos revisar vuestro caso en una videollamada de 10-15 minutos; si preferís dejarlo para más adelante, contéstame «mejor más adelante».\n\nUn saludo,"
      }
    }
  },
  penya: {
    "primero": {
      "asunto": "Deportes Peña y la visibilidad en Amazon",
      "texto": "Hola,\n\nDeportes Peña cuenta con un catálogo amplio de productos de deporte y ciclismo desde Zaragoza, un sector en el que muchos compradores empiezan su búsqueda directamente en Amazon.\n\nHay margen para trabajar la presencia de vuestra marca y catálogo en ese canal, desde cómo se muestran los productos hasta las búsquedas por las que pueden encontraros. La competencia en ciclismo es alta y, con el tiempo, otros vendedores pueden ir ocupando esas posiciones.\n\nEn Liberty Seller somos una agencia especializada en Amazon. Me gustaría enseñarte en una videollamada breve qué opciones tendría sentido valorar para vuestro caso, sin compromiso y sin cargar de trabajo a vuestro equipo.\n\n¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nEn ciclismo, ayudar al comprador a distinguir opciones y entender sus características puede ser clave al comparar productos. Es un ángulo distinto a la visibilidad y las búsquedas que comentaba en mi correo. ¿Es la categoría de ciclismo la que más os interesa impulsar en Amazon?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento, así que lo dejamos abierto. Si te interesa valorar cómo encajaría Amazon para Deportes Peña, responde «sí» y buscamos un hueco para una videollamada breve de 10-15 minutos; si prefieres retomarlo más adelante, puedes contestar «más adelante».\n\nUn saludo,"
    ],
    "medida": {}
  },
  ortega: {
    "primero": {
      "asunto": "Dos ideas para el catálogo de Ferretería Ortega en Amazon",
      "texto": "Hola,\n\nFerretería Ortega trabaja con un catálogo amplio de bricolaje y herramientas, una categoría en la que la visibilidad de cada producto y la estructura de las variantes marcan mucho la diferencia frente a otros vendedores.\n\nEn catálogos con cientos de referencias suele haber margen para reforzar el posicionamiento en búsquedas relevantes y para ordenar fichas, contenido y publicidad sin añadir más carga al equipo. En Liberty Seller estamos especializados en la gestión y optimización de cuentas de Amazon.\n\nSi te parece, en una videollamada breve de 10-15 minutos podemos comentarte dos vías concretas para mejorar la presencia del catálogo en Amazon, sin compromiso. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días y quería añadir otro posible ángulo para una ferretería: Amazon Business puede ayudar a presentar el catálogo también a clientes profesionales. ¿Os interesa valorar esta opción? Si es así, podemos comentarla en una videollamada de 10-15 minutos.\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para hablar de Amazon Business. Si os interesa retomarlo, contéstame «sí» y buscamos un hueco para una videollamada breve; si preferís dejarlo para más adelante, puedes responder «más adelante».\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "pausar",
        "motivo": "El responsable pidió que le escribiéramos después de Reyes, así que conviene respetar el momento acordado.",
        "texto": ""
      }
    }
  },
  clip: {
    "primero": {
      "asunto": "Papelería Clip y Amazon: una vía para vuestro catálogo",
      "texto": "Hola,\n\nPapelería Clip cuenta con un catálogo amplio de productos de oficina y papelería, una variedad que puede encajar bien en Amazon sin añadir carga operativa a vuestro equipo.\n\nEn una categoría con búsquedas recurrentes y bastante competencia, una puesta en marcha bien planteada ayuda a ordenar el catálogo, crear fichas claras y gestionar la logística y la publicidad desde el inicio. En Liberty Seller estamos especializados en la gestión de marcas en Amazon.\n\nPodemos enseñarte en una videollamada breve, sin compromiso, cómo abordar la entrada de vuestro catálogo y qué prioridades tendría sentido valorar. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días sobre la posible entrada de Papelería Clip en Amazon. Con un catálogo amplio, otra opción es empezar por una selección de productos y ampliar el surtido más adelante, en lugar de publicar todo desde el principio. ¿Os interesaría valorar ese enfoque en una videollamada breve?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para plantear la entrada de Papelería Clip en Amazon, y no pasa nada. Si os interesa retomarlo, podéis contestarme «sí» y buscamos un momento para una videollamada breve; si preferís dejarlo para más adelante, también me vale.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "La conversación de ayer mostró interés medio y una preocupación concreta por la logística; retomo ese punto y el siguiente paso acordado.",
        "texto": "Hola,\n\nAyer comentamos que la logística te genera dudas al plantearte Amazon. Podemos enseñarte cómo organizaríamos la puesta en marcha y la gestión de los envíos, incluida la opción de logística FBA, para que veas qué implicaría para vuestro equipo y cómo hacerlo sencillo.\n\n¿Te encaja una videollamada de 10-15 minutos para revisar vuestro caso?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "La dueña mostró interés medio y quiere entender cómo gestionar la logística sin complicaciones; el correo anterior ya explicó la puesta en marcha y FBA.",
        "texto": "Hola,\n\nQuizá ahora no sea el mejor momento para poner en marcha Amazon, y no pasa nada. Si te interesa que revisemos cómo podría gestionarse la logística sin complicar el día a día de Papelería Clip, contéstame «sí» y buscamos un hueco breve; si prefieres retomarlo más adelante, dímelo también.\n\nUn saludo,"
      }
    }
  },
  bicisnorte: {
    "primero": {
      "asunto": "Bicis Norte y la oportunidad de Amazon",
      "texto": "Hola,\n\nBicis Norte cuenta con una tienda online propia y un catálogo amplio de bicicletas y productos deportivos. Amazon puede ser un canal complementario para dar visibilidad a parte de ese catálogo sin añadir una carga operativa innecesaria a vuestro equipo.\n\nEn una categoría con tanta demanda y competencia, una puesta en marcha bien planteada ayuda a ordenar catálogo, logística y publicidad desde el inicio. En Liberty Seller estamos especializados en la gestión de marcas en Amazon y podemos enseñarte cómo enfocar esa entrada de forma práctica.\n\n¿Te viene mejor una videollamada breve de 10-15 minutos esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días sobre la posibilidad de abrir un canal en Amazon. Con un catálogo amplio, una opción práctica puede ser empezar por una selección de productos y ampliar después según cómo encaje la operativa. ¿Os interesaría valorar ese enfoque en una videollamada de 10-15 minutos?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para plantearos la entrada en Amazon. Si os interesa retomarlo, podéis contestarme «sí» y buscamos un hueco para una videollamada breve; si preferís dejarlo para más adelante, basta con que me lo digáis.\n\nUn saludo,"
    ],
    "medida": {}
  },
  atlas: {
    "primero": {
      "asunto": "Librería Atlas y Amazon: una vía para vuestro catálogo",
      "texto": "Hola,\n\nLibrería Atlas cuenta con un catálogo de más de mil referencias y una tienda online propia, una base interesante para valorar la presencia de vuestra librería en Amazon.\n\nEn libros, muchas búsquedas empiezan directamente en el marketplace y la competencia por esas referencias ya está activa. Podemos ayudaros a poner en marcha el catálogo, la logística y la publicidad sin añadir carga de trabajo a vuestro equipo.\n\nSomos una agencia especializada en Amazon y, en una videollamada breve, podemos explicarte cómo plantear una entrada ordenada para vuestra tienda y qué aspectos conviene priorizar.\n\n¿Te viene mejor hablarlo esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días sobre la posibilidad de llevar el catálogo de Librería Atlas a Amazon. Para una librería generalista, también se puede valorar empezar por una selección concreta de títulos y ampliar el catálogo más adelante. ¿Os interesaría explorar ese enfoque en una videollamada breve?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para plantear la entrada de Librería Atlas en Amazon. Si os apetece retomarlo, basta con que me contestes «sí»; y, si preferís dejarlo para más adelante, también puedes decírmelo.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "No ha habido respuesta y, como Librería Atlas aún no vende en Amazon, planteo un ángulo nuevo sobre aprovechar la información de catálogo de su tienda WooCommerce para preparar la publicación.",
        "texto": "Hola,\n\nTe escribí hace unos días sobre la entrada de Librería Atlas en Amazon. Como ya tenéis una tienda en WooCommerce, podríamos revisar qué información de vuestro catálogo se puede aprovechar para preparar las fichas y qué habría que completar antes de publicar. ¿Te encajaría una videollamada de 10-15 minutos para verlo?\n\nUn saludo,"
      }
    }
  },
  papelpintado: {
    "primero": {
      "asunto": "Mundo del Papel Pintado y Amazon",
      "texto": "Hola,\n\nMundo del Papel Pintado cuenta con un catálogo amplio de decoración y una tienda online propia, dos bases interesantes para trabajar la presencia de la marca en Amazon.\n\nEn una categoría tan visual y competida, la forma de presentar las referencias y ordenar el catálogo puede marcar la diferencia en visibilidad y en el trabajo que requiere gestionarlo. En Liberty Seller somos una agencia especializada en Amazon y podemos enseñaros qué opciones encajarían mejor para vuestra marca, sin compromiso.\n\n¿Te viene mejor una videollamada breve de 10-15 minutos esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nEn un catálogo de decoración amplio, puede ser útil definir cómo agrupar referencias relacionadas y sus variantes en Amazon para que la gestión sea más sencilla. En Liberty Seller también podemos ayudar con esa parte, tanto al empezar como si ya tenéis presencia allí. ¿Os encajaría comentarlo en una videollamada de 10-15 minutos?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para valorar Amazon, y no pasa nada. Si os interesa comentarlo en una videollamada breve de 10-15 minutos, podéis responder «sí»; si preferís dejarlo para más adelante, con eso también me basta.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "El primer correo ya habló de presentación y organización del catálogo; este seguimiento plantea como ángulo distinto la logística y las devoluciones, sin dar por hecho que ya vendan en Amazon.",
        "texto": "Hola,\n\nCon un catálogo de cientos de referencias, también puede ser útil valorar cómo gestionar la logística y las devoluciones en Amazon sin añadir carga a vuestro equipo. Es una parte que podemos revisar tanto si estáis empezando como si ya tenéis presencia allí. ¿Te interesaría comentarlo en una videollamada breve de 10-15 minutos?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "No ha habido respuesta a los dos correos y no consta ninguna petición de pausa ni rechazo; cierro el seguimiento de forma cercana y sin presión.",
        "texto": "Hola,\n\nPuede que ahora no sea el momento de revisar Amazon para Mundo del Papel Pintado, y está bien. Dejo el tema abierto por si más adelante os encaja. Si quieres que lo retomemos, basta con responder «sí»; si preferís dejarlo para más adelante, también.\n\nUn saludo,"
      }
    }
  },
  cosmetica: {
    "primero": {
      "asunto": "Cosmética Natural y su posible entrada en Amazon",
      "texto": "Hola,\n\nCosmética Natural cuenta con una tienda online en Shopify y un catálogo amplio de productos de cosmética natural. En una categoría con tanta búsqueda y competencia, Amazon puede ser un canal interesante para dar más visibilidad a la marca sin añadir carga a vuestro equipo.\n\nDesde Liberty Seller ayudamos a marcas a poner en marcha su presencia en Amazon, desde el catálogo y las fichas hasta la logística y la publicidad. Hay algunas decisiones iniciales que conviene plantear bien para proteger la marca y facilitar el crecimiento posterior.\n\nSi te parece, en una videollamada breve de 10-15 minutos puedo explicarte cómo enfocaríamos vuestro caso, sin compromiso. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nEn cosmética natural, ordenar el catálogo por líneas y necesidades de uso puede ayudar a que la entrada en Amazon resulte clara desde el principio. ¿Tenéis ya una línea de productos que os gustaría priorizar si decidís abrir ese canal?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para plantearos Amazon. Si os interesa retomarlo, podéis contestarme «sí» y buscamos un hueco para una videollamada breve; si preferís dejarlo para más adelante, con que me lo digáis es suficiente.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "No ha respondido al primer correo y, al no constar objeciones ni una petición de pausa, planteo una pregunta sencilla sobre qué línea priorizar al preparar el catálogo para Amazon.",
        "texto": "Hola,\n\nTe escribí hace unos días sobre la posible entrada de Cosmética Natural en Amazon. Con un catálogo amplio, elegir una línea para empezar puede ayudar a enfocar la preparación de las fichas y del lanzamiento. ¿Tenéis ya alguna línea de productos que os gustaría priorizar?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "El lead aún no vende en Amazon y no ha respondido a los dos correos; cierro con una opción sencilla y sin presión.",
        "texto": "Hola,\n\nQuizá ahora no sea el momento de valorar Amazon para Cosmética Natural, y no pasa nada. Si te interesa revisar cómo poner en marcha vuestro catálogo de Shopify allí, contéstame «sí» y buscamos un hueco para una videollamada breve. Si preferís retomarlo más adelante, puedes decirme «más adelante».\n\nUn saludo,"
      }
    }
  },
  aurora: {
    "primero": {
      "asunto": "Joyería Aurora: una vía para crecer en Amazon",
      "texto": "Hola,\n\nJoyería Aurora cuenta con una tienda online en Shopify y un catálogo amplio de joyería de autor. Amazon puede ser un canal complementario para dar más visibilidad a vuestras piezas sin trasladar una carga adicional a vuestro equipo.\n\nEn una categoría con tanta competencia, una buena puesta en marcha —desde las fichas y el catálogo hasta la logística y la publicidad— ayuda a que la marca tenga una presencia coherente desde el inicio. En Liberty Seller estamos especializados en la gestión de marcas en Amazon.\n\nPodemos enseñarte en una videollamada breve cómo plantear la entrada de vuestra marca y resolver las dudas que tengáis, sin compromiso. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días sobre la posibilidad de abrir un canal en Amazon. Para una marca de joyería de autor, presentar las piezas de forma ordenada y coherente en el catálogo puede ayudar a que cada colección tenga su espacio. ¿Te encajaría una videollamada de 10-15 minutos para comentarlo?\n\nUn saludo,",
      "Hola,\n\nQuizá ahora no sea el mejor momento para valorar Amazon, y no pasa nada. Si os interesa retomarlo, podéis contestarme «sí» y buscamos un hueco para una videollamada breve; si preferís dejarlo para más adelante, también podéis decírmelo.\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "El primer correo ya trató la puesta en marcha general; este propone como nuevo ángulo valorar qué piezas de joyería de autor tendría sentido lanzar primero.",
        "texto": "Hola,\n\nTe escribí hace unos días sobre la entrada de Joyería Aurora en Amazon. Para empezar, también se puede valorar qué piezas de vuestra colección tendría más sentido incorporar primero, en lugar de plantear todo el catálogo de una vez. ¿Te encajaría una videollamada de 10-15 minutos para revisarlo?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "La tienda ha renovado las fotos de producto y está anunciando una colección de otoño; lo uso como referencia nueva y mantengo un cierre amable, sin presión.",
        "texto": "Hola,\n\nHe visto que habéis renovado las fotos de producto y anunciado una colección de otoño. Quizá ahora no sea el momento de valorar Amazon; si os apetece retomarlo, contestadme «sí» y buscamos un hueco para hablar. Si preferís dejarlo para más adelante, basta con decírmelo.\n\nUn saludo,"
      }
    }
  },
  mascotas: {
    "primero": {
      "asunto": "Dos ideas para Mascotas del Norte en Amazon",
      "texto": "Hola,\n\nMascotas del Norte trabaja un catálogo amplio de accesorios y alimentación para mascotas, una categoría en la que la visibilidad de cada referencia y la competencia por las búsquedas marcan mucha diferencia.\n\nCuando hay cientos de productos, suele haber margen para ordenar prioridades entre fichas, contenido A+ y publicidad, buscando que el catálogo gane presencia sin añadir carga innecesaria a vuestro equipo. En Liberty Seller estamos especializados en la gestión y crecimiento de marcas en Amazon.\n\nEn una videollamada breve podemos compartirte dos enfoques aplicables a un catálogo como el vuestro y valorar cuáles tendrían más sentido. ¿Te viene mejor esta semana o la próxima?\n\nUn saludo,"
    },
    "borradores": [
      "Hola,\n\nTe escribí hace unos días y quería añadir otro posible foco para Mascotas del Norte: con un catálogo amplio de accesorios y alimentación, la gestión de la logística FBA y las devoluciones puede ser otro aspecto a valorar en Amazon. ¿Te encajaría una videollamada de 10-15 minutos para comentarlo?\n\nUn saludo,",
      "Hola,\n\nEntiendo que quizá ahora no sea el mejor momento para hablar de la gestión de vuestra tienda en Amazon. Si te interesa retomarlo, puedes contestarme «sí»; y, si prefieres dejarlo para más adelante, basta con que me digas «mejor más adelante».\n\nUn saludo,"
    ],
    "medida": {
      "1": {
        "decision": "escribir",
        "motivo": "El primer correo se centró en visibilidad, fichas y publicidad; este seguimiento introduce la logística FBA y las devoluciones como otro ángulo relevante para su catálogo amplio.",
        "texto": "Hola,\n\nAdemás de la visibilidad de las fichas, en un catálogo amplio como el vuestro puede ser útil revisar cómo encajan la logística FBA y la gestión de devoluciones en Amazon. ¿Te encajaría una videollamada breve de 10-15 minutos para revisar ese punto en vuestro caso?\n\nUn saludo,"
      },
      "2": {
        "decision": "escribir",
        "motivo": "No hay respuesta ni señales de rechazo, así que dejo abierta la conversación con una opción sencilla y sin insistir en la videollamada.",
        "texto": "Hola,\n\nQuizá ahora no sea el mejor momento para revisar vuestra tienda en Amazon, y no pasa nada. Si te interesa retomarlo, contéstame «sí»; si prefieres dejarlo para más adelante, dime «mejor más adelante».\n\nUn saludo,"
      }
    }
  },
}
