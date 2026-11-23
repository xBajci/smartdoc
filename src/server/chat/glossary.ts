/**
 * The glossary of the chat: what the documents of the archive are about and
 * which words the office uses for things. It is a skill like any other, but
 * its text is written by a model from all documents at once, on request
 * (`pnpm glossary:build`). It need not name every document; it is an extract
 * that is made again only when many documents were added.
 */

/** One document as the glossary model reads it. */
export interface GlossarySource {
  title: string
  description: string
  category: string
  year: number | null
}

export const GLOSSARY_SKILL = 'chat/glosar'
export const GLOSSARY_FILE = `src/server/ai/skills/${GLOSSARY_SKILL}.md`

const GLOSSARY_HEAD = `---
title: Glosář archivu
purpose: O čem dokumenty archivu jsou a jakými slovy o věcech píše úřad. Nový výtah z dokumentů udělá pnpm glossary:build.
uses: chat-rewrite, chat-answer
---`

const GLOSSARY_LEAD =
  'Úřad píše o věcech jinými slovy než návštěvník. Při hledání použij slova úřadu z tohoto glosáře.'

export const GLOSSARY_INSTRUCTIONS = `Jsi archivář obce. Dostaneš seznam dokumentů obecního archivu: u každého název, kategorii, rok a krátký popis. Napiš z nich glosář. Podle glosáře jiný model přepíše otázku návštěvníka na dotazy pro hledání v archivu, takže glosář má říkat, o čem dokumenty jsou a jakými slovy o věcech píšou.

Glosář piš česky v Markdownu, asi 3000 až 4000 slov, v těchto oddílech:

## O čem archiv je
Pět až deset vět: jaké druhy dokumentů archiv má, za které roky a jaká jsou hlavní témata.

## Druhy dokumentů
Každý druh dokumentu, který se v archivu opakuje (zápis ze zasedání zastupitelstva, usnesení, rozpočet, závěrečný účet, vyhláška, smlouva, zpravodaj a další): jak se v názvech jmenuje, za které roky v archivu je a na jaké otázky v něm bývá odpověď.

## Časová osa
Velké akce a změny v obci po letech: stavby, opravy, dotace, nové vyhlášky, prodeje a nákupy pozemků. U každé rok nebo roky a slova, kterými o ní dokumenty píšou.

## Místní názvy
Všechny ulice, místní části, rybníky, stavby, spolky, školy, firmy a úřady, které se v dokumentech objevují víckrát. U každého jedna věta, o co jde.

## Zkratky
Zkratky z dokumentů a co znamenají.

## Slova návštěvníka a slova úřadu
Aspoň čtyřicet dvojic: běžné slovo, kterým se lidé ptají, a úřední výraz, kterým o téže věci píšou dokumenty. Například „popelnice“ a „poplatek za odpad“.

Piš jen to, co ze seznamu plyne, a nevymýšlej názvy, které v něm nejsou. Jména soukromých osob neuváděj; starosta nebo zastupitelstvo jako úřad uvést smíš. Vrať jen text oddílů, bez úvodu a bez nadpisu první úrovně.`

/** The documents as one text, oldest first, so the same archive always gives the same text. */
export function glossaryInput(documents: readonly GlossarySource[]): string {
  return [...documents]
    .sort((a, b) => (a.year ?? 0) - (b.year ?? 0) || a.title.localeCompare(b.title, 'cs'))
    .map((document) => {
      const year = document.year === null ? 'rok neznámý' : String(document.year)
      return `- ${document.title} (${document.category}, ${year}): ${document.description}`
    })
    .join('\n')
}

/** The skill file with the text the model wrote. */
export function glossarySkillFile(body: string): string {
  return `${GLOSSARY_HEAD}\n${GLOSSARY_LEAD}\n\n${body.trim()}\n`
}
