/** Default categories from the product brief; colours are the index-tab inks. */
export const defaultCategories = [
  {
    id: 'rozpocty',
    name: 'Rozpočty',
    color: '#2c6e8f',
    isFallback: false,
    description:
      'Rozpočet obce a jeho návrh, rozpočtová opatření, střednědobý výhled rozpočtu, závěrečný účet a zprávy o hospodaření obce. Hlavní obsah jsou příjmy, výdaje a částky v tabulkách.',
  },
  {
    id: 'smlouvy',
    name: 'Smlouvy',
    color: '#8a5a1c',
    isFallback: false,
    description:
      'Smlouvy a jejich dodatky, které obec uzavřela: o dílo, kupní, nájemní, darovací, o dotaci nebo o poskytování služeb. Dokument má smluvní strany, předmět smlouvy, cenu a podpisy.',
  },
  {
    id: 'plany-a-projekty',
    name: 'Plány a projekty',
    color: '#3c7a4c',
    isFallback: false,
    description:
      'Územní plán, studie, projektová dokumentace, výkresy, situace a technické zprávy ke stavbám a investicím obce. Patří sem i strategický plán a plán rozvoje obce.',
  },
  {
    id: 'zpravodaje',
    name: 'Zpravodaje',
    color: '#a3426b',
    isFallback: false,
    description:
      'Obecní zpravodaj: periodikum pro občany s číslem a rokem vydání. Obsahuje úvodník starosty, zprávy z obce, školy a spolků, pozvánky a fotografie.',
  },
  {
    id: 'zapisy',
    name: 'Zápisy',
    color: '#5a4fb0',
    isFallback: false,
    description:
      'Zápisy a usnesení ze zasedání zastupitelstva, rady, výborů a komisí obce. Dokument má datum jednání, seznam přítomných, program, průběh hlasování a přijatá usnesení. Patří sem i obecní kronika.',
  },
  {
    id: 'fotografie',
    name: 'Fotografie',
    color: '#b5622a',
    isFallback: false,
    description:
      'Samostatné fotografie a obrázky: snímky obce, budov, krajiny, akcí a lidí, staré pohlednice. Hlavní obsah je obraz, ne text. Naskenovaný textový dokument sem nepatří.',
  },
  {
    id: 'nezarazene',
    name: 'Nezařazené',
    color: '#74808a',
    isFallback: true,
    description:
      'Dokumenty, které nepatří do žádné jiné kategorie: například úřední dopisy, podání soudu, oznámení, pozvánky a formuláře.',
  },
] as const
