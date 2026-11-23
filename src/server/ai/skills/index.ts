import chatGlosar from './chat/glosar.md?raw'
import chatHledani from './chat/hledani.md?raw'
import chatHodnoceniUryvku from './chat/hodnoceni-uryvku.md?raw'
import chatOdpovedACitace from './chat/odpoved-a-citace.md?raw'
import chatPocitani from './chat/pocitani.md?raw'
import chatPreformulovani from './chat/preformulovani.md?raw'
import chatShrnuti from './chat/shrnuti.md?raw'
import chatSystem from './chat/system.md?raw'
import { parseSkillFile, type LoadedSkill, type SkillDefinition } from './types'
import zpracovaniCteniStrany from './zpracovani/cteni-strany.md?raw'
import zpracovaniDatumDokumentu from './zpracovani/datum-dokumentu.md?raw'
import zpracovaniKategorie from './zpracovani/kategorie.md?raw'
import zpracovaniNazevAPopis from './zpracovani/nazev-a-popis.md?raw'
import zpracovaniSystem from './zpracovani/system.md?raw'

/**
 * Every skill the application starts with, in the order the administrator
 * sees them. A new skill file must be added here.
 */
export const SKILLS: readonly SkillDefinition[] = [
  parseSkillFile('zpracovani/system', zpracovaniSystem),
  parseSkillFile('zpracovani/cteni-strany', zpracovaniCteniStrany),
  parseSkillFile('zpracovani/nazev-a-popis', zpracovaniNazevAPopis),
  parseSkillFile('zpracovani/datum-dokumentu', zpracovaniDatumDokumentu),
  parseSkillFile('zpracovani/kategorie', zpracovaniKategorie),
  parseSkillFile('chat/system', chatSystem),
  parseSkillFile('chat/preformulovani', chatPreformulovani),
  parseSkillFile('chat/hledani', chatHledani),
  parseSkillFile('chat/glosar', chatGlosar),
  parseSkillFile('chat/pocitani', chatPocitani),
  parseSkillFile('chat/odpoved-a-citace', chatOdpovedACitace),
  parseSkillFile('chat/hodnoceni-uryvku', chatHodnoceniUryvku),
  parseSkillFile('chat/shrnuti', chatShrnuti),
]

/** The starting skills as they are in the files, before anything from the database. */
export function defaultSkills(): LoadedSkill[] {
  return SKILLS.map((skill) => ({ ...skill, version: 0, builtIn: true }))
}

export * from './types'
