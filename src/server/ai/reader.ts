import { generateText, Output } from 'ai'
import sharp from 'sharp'
import { z } from 'zod'
import { languageModel, modelName, modelSetting, type ModelRole } from './models'
import { GUARD, instructionsFor, NO_TEXT, type LoadedSkill, type SkillUse } from './skills/types'

/** What processing learns about a document besides its text. */
export interface Summary {
  /** A name for the document taken from its content; empty when none could be made. */
  title: string
  /** One or two sentences shown to visitors. */
  shortDescription: string
  /** The year the document was issued, only when the content says so. */
  issuedYear: number | null
  /** The day the document is dated, `YYYY-MM-DD`, only when the content gives the whole date. */
  issuedOn: string | null
}

export interface ImageReading extends Summary {
  /** A short paragraph about what the image shows. */
  description: string
}

/** One call to a model: what was asked, what came back and what it used. */
export interface ModelCall {
  operation:
    | 'read-page'
    | 'read-mixed-page'
    | 'describe-image'
    | 'summarize'
    | 'categorize'
    | 'optimize'
    | 'embed'
    | 'chat'
  /** As written in `.env`: provider:model. */
  model: string
  /** The place the call was made at; `null` for a call that is told no skills. */
  skillKey: string | null
  skillVersion: number
  /** Every skill the call was told, with the version of its text. */
  skills?: { key: string; version: number }[]
  /** Page of a PDF the call read. */
  page: number | null
  /** The text sent to the model. A page or an image itself is only named. */
  input: string
  output: string
  /** Why the call failed; `null` when it went well. */
  error: string | null
  durationMs: number
  inputTokens: number
  outputTokens: number
}
export type RecordCall = (call: ModelCall) => void

/**
 * Everything processing asks of AI. The rest of the application knows this
 * interface only, never a provider or a model.
 */
export interface DocumentReader {
  /** The text of one scanned page, handed over as a one-page PDF. Empty when the page has none. */
  readPage(pagePdf: Uint8Array, pageNumber: number): Promise<string>
  /**
   * A page that has a text layer and also a table or a picture, as one text:
   * tables as Markdown tables, a description in place of each picture.
   */
  readMixedPage(pagePdf: Uint8Array, pageNumber: number, layer: string): Promise<string>
  describeImage(image: Buffer, filename: string): Promise<ImageReading>
  summarize(text: string, filename: string): Promise<Summary>
}

/** Longer side of the image sent to a model; more detail costs more and reads no better. */
const IMAGE_SIDE = 1568
/** How much text the description is written from. The start of a document says what it is. */
const SUMMARY_CHARACTERS = 24_000
/** How much of a page's text layer goes to the model with the page. */
const LAYER_CHARACTERS = 12_000
/** How much of a sent text is kept in the record of a call. */
const RECORDED_INPUT_CHARACTERS = 16_000

type CallHead = Pick<
  ModelCall,
  'operation' | 'skillKey' | 'skillVersion' | 'skills' | 'page' | 'input'
>
interface CallResult<T> {
  value: T
  output: string
  usage: { inputTokens: number | undefined; outputTokens: number | undefined }
}

/** Runs one call and records it whether it ends well or not, then passes the outcome on. */
export async function recorded<T>(
  record: RecordCall,
  role: ModelRole,
  head: CallHead,
  work: () => Promise<CallResult<T>>,
): Promise<T> {
  const started = Date.now()
  const call = {
    ...head,
    input: head.input.slice(0, RECORDED_INPUT_CHARACTERS),
    model: modelName(role),
  }
  try {
    const { value, output, usage } = await work()
    record({
      ...call,
      output,
      error: null,
      durationMs: Date.now() - started,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
    })
    return value
  } catch (error) {
    record({
      ...call,
      output: '',
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      inputTokens: 0,
      outputTokens: 0,
    })
    throw error
  }
}

/** The fields every description has. What to write into them is in the skills. */
const summaryShape = {
  title: z.string().describe('Název podle skillu o názvu. Prázdný text, když nejde určit.'),
  shortDescription: z.string().describe('Krátký popis podle skillu o krátkém popisu.'),
  issuedYear: z.number().int().nullable().describe('Rok podle skillu o datu a roku, jinak null.'),
  issuedOn: z
    .string()
    .nullable()
    .describe('Datum dokumentu ve tvaru RRRR-MM-DD podle skillu o datu a roku, jinak null.'),
}

/** The technical line that tells a model how to say a page is empty. */
const EMPTY_PAGE = `Když na straně žádný čitelný obsah není, odpověz přesně ${NO_TEXT}.`

/**
 * What one call is told and how it is recorded: the system prompt and the
 * skills of the place, the lines the code adds, and the data of this call.
 */
function prepare(
  skills: readonly LoadedSkill[],
  operation: ModelCall['operation'],
  use: SkillUse,
  request: string,
  page: number | null = null,
  fixed: readonly string[] = [],
) {
  const instructions = instructionsFor(skills, use, [...fixed, GUARD])
  const head: CallHead = {
    operation,
    skillKey: use,
    skillVersion: 0,
    skills: instructions.skills,
    page,
    // The record shows all the model read: its instructions, then the data of this call.
    input: `${instructions.text}\n\n--- Zadání ---\n${request}`,
  }
  return { instructions: instructions.text, head }
}

function aiReader(skills: readonly LoadedSkill[], record: RecordCall): DocumentReader {
  return {
    readPage(pagePdf, pageNumber) {
      const request = `Strana ${pageNumber} dokumentu je v příloze.`
      const { instructions, head } = prepare(
        skills,
        'read-page',
        'read-scanned-page',
        request,
        pageNumber,
        [EMPTY_PAGE],
      )
      return recorded(record, 'ocr', head, async () => {
        const { text, usage } = await generateText({
          model: languageModel('ocr'),
          instructions,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: pagePdf, mediaType: 'application/pdf' },
                { type: 'text', text: request },
              ],
            },
          ],
        })
        return { value: text.includes(NO_TEXT) ? '' : text.trim(), output: text, usage }
      })
    },

    readMixedPage(pagePdf, pageNumber, layer) {
      const request = `Strana ${pageNumber} dokumentu je v příloze. Její textová vrstva:\n<vrstva>\n${layer.slice(0, LAYER_CHARACTERS)}\n</vrstva>`
      const { instructions, head } = prepare(
        skills,
        'read-mixed-page',
        'read-mixed-page',
        request,
        pageNumber,
        [EMPTY_PAGE],
      )
      return recorded(record, 'ocr', head, async () => {
        const { text, usage } = await generateText({
          model: languageModel('ocr'),
          instructions,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: pagePdf, mediaType: 'application/pdf' },
                { type: 'text', text: request },
              ],
            },
          ],
        })
        return { value: text.includes(NO_TEXT) ? '' : text.trim(), output: text, usage }
      })
    },

    describeImage(image, filename) {
      const request = `Obrázek je v příloze. Původní název souboru: ${filename}`
      const { instructions, head } = prepare(skills, 'describe-image', 'describe-image', request)
      const schema = z.object({
        description: z.string().describe('Delší popis obrázku podle skillu o názvu a popisu.'),
        ...summaryShape,
      })
      return recorded(record, 'ocr', head, async () => {
        const smaller = await sharp(image)
          .rotate()
          .resize(IMAGE_SIDE, IMAGE_SIDE, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer()
        const { output, usage } = await generateText({
          model: languageModel('ocr'),
          output: Output.object({ schema }),
          instructions,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'file', data: smaller, mediaType: 'image/jpeg' },
                { type: 'text', text: request },
              ],
            },
          ],
        })
        return { value: output, output: JSON.stringify(output, null, 2), usage }
      })
    },

    summarize(text, filename) {
      // A long text is cut to its start, and the model is told so.
      const request = `Původní název souboru: ${filename}\n\nText dokumentu (dlouhý text je zkrácený, je tu jeho začátek):\n<dokument>\n${text.slice(0, SUMMARY_CHARACTERS)}\n</dokument>`
      const { instructions, head } = prepare(skills, 'summarize', 'describe-document', request)
      return recorded(record, 'description', head, async () => {
        const { output, usage } = await generateText({
          model: languageModel('description'),
          output: Output.object({ schema: z.object(summaryShape) }),
          instructions,
          prompt: request,
        })
        return { value: output, output: JSON.stringify(output, null, 2), usage }
      })
    },
  }
}

/**
 * Fixed answers for the test suite (`AI_OCR_MODEL=fake:test`), so tests cost
 * nothing and repeat exactly. A file named "*selhani*" makes it fail on purpose.
 */
function fakeReader(skills: readonly LoadedSkill[], record: RecordCall): DocumentReader {
  const usage = { inputTokens: 1000, outputTokens: 100 }
  const answer = <T>(value: T) => {
    const output = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    return Promise.resolve({ value, output, usage })
  }
  const failOn = (filename: string) => {
    if (filename.includes('selhani')) throw new Error('The fake reader was asked to fail.')
  }
  /** A file named "*pomalu*" takes a while, so a test can see a document being read. */
  const delay = (filename: string) =>
    new Promise((resolve) => setTimeout(resolve, filename.includes('pomalu') ? 2500 : 0))

  return {
    readPage: (_pagePdf, pageNumber) =>
      recorded(
        record,
        'ocr',
        prepare(skills, 'read-page', 'read-scanned-page', `Strana ${pageNumber}.`, pageNumber, [
          EMPTY_PAGE,
        ]).head,
        () => answer('Zkušební text přečtený ze skenu.'),
      ),
    readMixedPage: (_pagePdf, pageNumber, layer) =>
      recorded(
        record,
        'ocr',
        prepare(
          skills,
          'read-mixed-page',
          'read-mixed-page',
          `Strana ${pageNumber}.\n<vrstva>\n${layer}\n</vrstva>`,
          pageNumber,
          [EMPTY_PAGE],
        ).head,
        () => answer(`${layer}\n\n[Obrázek: zkušební přepis strany ${pageNumber} modelem.]`),
      ),
    describeImage: (_image, filename) =>
      recorded(
        record,
        'ocr',
        prepare(skills, 'describe-image', 'describe-image', filename).head,
        () => {
          failOn(filename)
          return answer({
            description: `Zkušební popis obrázku ze souboru ${filename}. Popis má několik vět.`,
            shortDescription: `Zkušební krátký popis obrázku ${filename}.`,
            title: `${filename.replace(/\.[^.]+$/, '')} (název z obsahu)`,
            issuedYear: null,
            issuedOn: null,
          })
        },
      ),
    summarize: (text, filename) =>
      recorded(
        record,
        'description',
        prepare(skills, 'summarize', 'describe-document', `${filename}\n${text}`).head,
        async () => {
          failOn(filename)
          await delay(filename)
          return answer({
            shortDescription: `Zkušební krátký popis dokumentu ${filename}.`,
            title: `${filename.replace(/\.[^.]+$/, '')} (název z obsahu)`,
            issuedYear: /\b1998\b/.test(text) ? 1998 : null,
            // A file named "*datum*" is dated, so a test can see a document with a whole date.
            issuedOn: filename.includes('datum') ? '2021-05-17' : null,
          })
        },
      ),
  }
}

export function getReader(skills: readonly LoadedSkill[], record: RecordCall): DocumentReader {
  return modelSetting('ocr').provider === 'fake'
    ? fakeReader(skills, record)
    : aiReader(skills, record)
}
