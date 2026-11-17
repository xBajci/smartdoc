import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { sql } from 'drizzle-orm'
import type { Embedder } from '../server/chat/embedder'
import { prepareChunks, writeChunks } from '../server/chat/index-service'
import { makeThumbnail } from '../server/thumbnail'
import type { Database } from './client'
import { ensureDefaultCategories } from './migrate'
import { documents } from './schema'

/**
 * Invented documents for development and for the test suite. The files come
 * from `public/demo` (built by `pnpm demo:files`) and each says on every page
 * that it is a demonstration.
 */
interface DemoDocument {
  id: string
  file: string
  title: string
  categoryId: string
  addedAt: string
  issuedYear: number | null
  yearSource?: 'manual'
  custom?: string
  short?: string
  /** The text processing would have read from the file, page by page; the search and the chat look into it. */
  pages?: string[]
  pageCount?: number
  hasText?: boolean
  status?: 'queued' | 'processing' | 'failed'
  errorReason?: string
}

const demoDocuments: DemoDocument[] = [
  {
    id: 'zapis-zastupitelstvo-2026-03',
    file: 'zapis-zastupitelstvo-2026-03.pdf',
    title: 'Zápis z 9. zasedání zastupitelstva',
    categoryId: 'zapisy',
    addedAt: '2026-11-04',
    issuedYear: 2026,
    pageCount: 3,
    short: 'Zasedání z 18. března 2026: zadání projektu cyklostezky k nádraží a dotace spolkům.',
    pages: [
      'Zápis z 9. zasedání zastupitelstva obce. Přítomno 13 členů. Zastupitelstvo schválilo zadání projektu cyklostezky k nádraží.',
      'Zastupitelstvo schválilo výměnu veřejného osvětlení v ulici Zahradní za úsporná svítidla. Práce provede firma Elektro Haná za 870 000 Kč do konce září 2026.',
      'Dotace spolkům pro rok 2026 činí 240 000 Kč. Zapsala Marie Vzorová.',
    ],
  },
  {
    id: 'uredni-deska-oznameni',
    file: 'uredni-deska-oznameni.png',
    title: 'Oznámení o přerušení dodávky vody',
    categoryId: 'nezarazene',
    addedAt: '2026-10-28',
    issuedYear: 2026,
    short: 'Fotografie vývěsky: 14. května 2026 nepoteče voda v ulicích Zahradní a Nádražní.',
  },
  {
    id: 'rozpocet-2026-navrh',
    file: 'rozpocet-2026-navrh.pdf',
    title: 'Návrh rozpočtu na rok 2026',
    categoryId: 'rozpocty',
    addedAt: '2026-10-21',
    issuedYear: 2026,
    pageCount: 2,
    custom:
      'Návrh k projednání, ne schválený rozpočet. Schodek 3,5 mil. Kč kryje přebytek z minulých let.',
  },
  {
    id: 'projekt-cyklostezka',
    file: 'projekt-cyklostezka.pdf',
    title: 'Cyklostezka k nádraží, studie první etapy',
    categoryId: 'plany-a-projekty',
    addedAt: '2026-10-09',
    issuedYear: 2026,
    pageCount: 2,
    short: 'Trasa 1,3 km od návsi k železniční zastávce, odhad nákladů 6,8 mil. Kč a harmonogram.',
  },
  {
    id: 'zpravodaj-2025-4',
    file: 'zpravodaj-2025-4.pdf',
    title: 'Zpravodaj 4/2025',
    categoryId: 'zpravodaje',
    addedAt: '2026-09-30',
    issuedYear: 2025,
    pageCount: 4,
    short: 'Zimní číslo: kalendář akcí, zprávy spolků, odpady v roce 2026 a ohlédnutí do historie.',
  },
  {
    id: 'smlouva-oprava-chodniku',
    file: 'smlouva-oprava-chodniku.pdf',
    title: 'Smlouva o dílo č. 14/2025, oprava chodníku',
    categoryId: 'smlouvy',
    addedAt: '2026-09-18T12:00:00Z',
    issuedYear: 2025,
    pageCount: 2,
    short:
      'Oprava 410 metrů chodníku v ulici Nádražní za 4 185 300 Kč, dokončení do 30. června 2025.',
  },
  {
    id: 'rozpocet-2025-schvaleny',
    file: 'rozpocet-2025-schvaleny.pdf',
    title: 'Schválený rozpočet na rok 2025',
    categoryId: 'rozpocty',
    addedAt: '2026-09-18',
    issuedYear: 2025,
    pageCount: 3,
    short:
      'Vyrovnaný rozpočet 38,42 mil. Kč schválený 12. prosince 2024, s rozpisem příjmů a výdajů.',
  },
  {
    id: 'smlouva-najem-salu',
    file: 'smlouva-najem-salu.pdf',
    title: 'Smlouva o nájmu společenského sálu',
    categoryId: 'smlouvy',
    addedAt: '2026-08-27',
    issuedYear: null,
    pageCount: 1,
    short: 'Vzor nájmu sálu pro 40 osob: nájemné za víkend, záloha a vratná kauce.',
  },
  {
    id: 'foto-kostel-leto',
    file: 'foto-kostel-leto.jpg',
    title: 'Kostel od polní cesty',
    categoryId: 'fotografie',
    addedAt: '2026-08-12',
    issuedYear: null,
    hasText: false,
    custom: 'Letní pohled na kostel od polní cesty za humny.',
  },
  {
    id: 'zapis-zastupitelstvo-1998-sken',
    file: 'zapis-zastupitelstvo-1998-sken.pdf',
    title: 'Zápis ze schůze zastupitelstva, září 1998',
    categoryId: 'zapisy',
    addedAt: '2026-07-30T12:00:00Z',
    issuedYear: 1998,
    pageCount: 1,
    short: 'Sken strojopisu: povodňové škody z roku 1997, nová hasičská cisterna a plynofikace.',
  },
  {
    id: 'plan-navsi-1936',
    file: 'plan-navsi-1936.png',
    title: 'Plán návsi a přilehlých pozemků',
    categoryId: 'plany-a-projekty',
    addedAt: '2026-07-30',
    issuedYear: 1936,
    short: 'Kreslený plán v měřítku 1 : 1000 s kostelem, školou, potokem a rybníkem.',
  },
  {
    id: 'foto-hody-1974',
    file: 'foto-hody-1974.jpg',
    title: 'Hodový průvod',
    categoryId: 'fotografie',
    addedAt: '2026-07-15',
    issuedYear: 1974,
    yearSource: 'manual',
    hasText: false,
    custom: 'Hodový průvod s májkou, rok 1974.',
  },
  // The three below never reach the public list. Nothing produces these states
  // yet; they are here so the administration's handling of them stays tested.
  {
    id: 'zpravodaj-2025-3',
    file: 'zpravodaj-2025-4.pdf',
    title: 'Zpravodaj 3/2025',
    categoryId: 'zpravodaje',
    addedAt: '2026-11-10T12:00:00Z',
    issuedYear: null,
    status: 'processing',
  },
  {
    id: 'smlouva-svoz-odpadu',
    file: 'smlouva-najem-salu.pdf',
    title: 'smlouva-svoz-odpadu-2024',
    categoryId: 'nezarazene',
    addedAt: '2026-11-10',
    issuedYear: null,
    status: 'queued',
  },
  {
    id: 'kronika-1952',
    file: 'zapis-zastupitelstvo-1998-sken.pdf',
    title: 'Kronika obce, rok 1952',
    categoryId: 'nezarazene',
    addedAt: '2026-11-09',
    issuedYear: null,
    status: 'failed',
    errorReason: 'Soubor se nepodařilo přečíst celý. Strany 4 až 9 jsou poškozené.',
  },
]

const MIME_TYPES = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg' } as const

function sha256(value: Buffer | string) {
  return createHash('sha256').update(value).digest('hex')
}

/** Empties the archive and its local storage folder, then fills both with the demonstration. */
export async function resetWithDemo(
  database: Database,
  storageDirectory: string,
  /** Makes the vectors of the pieces the chat searches in. */
  embed: Embedder,
  demoDirectory = 'public/demo',
) {
  const root = resolve(storageDirectory)
  await rm(root, { recursive: true, force: true })
  await database.execute(
    sql`truncate table chat_traces, processing_runs, custom_skills, document_chunks, ai_usage, skill_versions, documents, categories, login_attempts restart identity cascade`,
  )
  await ensureDefaultCategories(database)

  for (const demo of demoDocuments) {
    const original = await readFile(join(demoDirectory, demo.file))
    const extension = demo.file.split('.').pop() as keyof typeof MIME_TYPES
    const isPdf = extension === 'pdf'
    const published = demo.status === undefined

    const storageKey = `documents/${demo.id}`
    await mkdir(dirname(join(root, storageKey)), { recursive: true })
    await writeFile(join(root, storageKey), original)

    let thumbnailKey: string | null = null
    const thumbnail = isPdf ? null : await makeThumbnail(original)
    if (thumbnail !== null) {
      thumbnailKey = `thumbnails/${demo.id}.webp`
      await mkdir(dirname(join(root, thumbnailKey)), { recursive: true })
      await writeFile(join(root, thumbnailKey), thumbnail)
    }

    await database.insert(documents).values({
      id: demo.id,
      originalFilename: demo.file,
      title: demo.title,
      titleSource: 'manual',
      format: isPdf ? 'pdf' : 'image',
      mimeType: MIME_TYPES[extension],
      sizeBytes: original.byteLength,
      // An unpublished stand-in shares its file with a published document, so its
      // fingerprint is made from the id to keep the column unique.
      sha256: published ? sha256(original) : sha256(demo.id),
      storageKey,
      thumbnailKey,
      categoryId: demo.categoryId,
      categorySource: 'manual',
      addedAt: new Date(demo.addedAt),
      issuedYear: demo.issuedYear,
      issuedYearSource: demo.issuedYear === null ? null : (demo.yearSource ?? 'auto'),
      customDescription: demo.custom ?? '',
      shortDescription: demo.short ?? '',
      autoDescription: (demo.pages ?? []).join('\n\n'),
      status: demo.status ?? 'ready',
      hasText: published ? (demo.hasText ?? true) : null,
      errorReason: demo.errorReason ?? null,
      pageCount: demo.pageCount ?? null,
    })

    if (!published) continue
    // A document without invented content is known to the chat by its description.
    const pages = demo.pages?.map((text, index) => ({ page: index + 1, text })) ?? [
      { page: isPdf ? 1 : null, text: demo.custom ?? demo.short ?? '' },
    ]
    const chunks = await prepareChunks({ id: demo.id, title: demo.title }, pages, embed)
    await writeChunks(database, demo.id, chunks.rows)
  }
}
