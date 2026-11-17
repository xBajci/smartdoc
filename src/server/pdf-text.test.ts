import { readFileSync } from 'node:fs'
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { readPages } from './pdf-text'

/** A one-page PDF with a line of text and whatever `draw` adds to it. */
async function page(draw: (page: PDFPage, document: PDFDocument) => Promise<void> | void) {
  const document = await PDFDocument.create()
  const font = await document.embedFont(StandardFonts.Helvetica)
  const sheet = document.addPage([595, 842])
  sheet.drawText('Rozpocet obce na rok 2026 a dalsi text strany.', {
    x: 50,
    y: 780,
    size: 12,
    font,
  })
  await draw(sheet, document)
  const [layout] = await readPages(Buffer.from(await document.save()))
  return layout
}

const photo = () => readFileSync('public/demo/foto-kostel-leto.jpg')

describe('readPages', () => {
  it('finds nothing but text on a page of plain text', async () => {
    const layout = await page(() => {})
    expect(layout?.text).toContain('Rozpocet obce')
    expect(layout).toMatchObject({ pictures: 0, hasTable: false })
  })

  it('counts a picture that takes a real part of the page', async () => {
    const layout = await page(async (sheet, document) => {
      sheet.drawImage(await document.embedJpg(photo()), { x: 50, y: 300, width: 300, height: 200 })
    })
    expect(layout).toMatchObject({ pictures: 1, hasTable: false })
  })

  it('takes a small picture for a logo', async () => {
    const layout = await page(async (sheet, document) => {
      sheet.drawImage(await document.embedJpg(photo()), { x: 50, y: 800, width: 40, height: 30 })
    })
    expect(layout?.pictures).toBe(0)
  })

  it('sees a grid of ruled lines as a table', async () => {
    const layout = await page((sheet) => {
      for (let row = 0; row <= 4; row += 1) {
        const y = 700 - row * 20
        sheet.drawLine({ start: { x: 50, y }, end: { x: 400, y }, thickness: 1 })
      }
      for (let column = 0; column <= 3; column += 1) {
        const x = 50 + column * 116
        sheet.drawLine({ start: { x, y: 700 }, end: { x, y: 620 }, thickness: 1 })
      }
    })
    expect(layout).toMatchObject({ pictures: 0, hasTable: true })
  })

  it('sees a table drawn cell by cell', async () => {
    const layout = await page((sheet) => {
      for (let row = 0; row < 3; row += 1) {
        for (let column = 0; column < 3; column += 1) {
          sheet.drawRectangle({
            x: 50 + column * 100,
            y: 700 - row * 20,
            width: 100,
            height: 20,
            borderWidth: 1,
          })
        }
      }
    })
    expect(layout?.hasTable).toBe(true)
  })

  it('does not take an underline or a frame around a text for a table', async () => {
    const layout = await page((sheet) => {
      sheet.drawLine({ start: { x: 50, y: 770 }, end: { x: 400, y: 770 }, thickness: 1 })
      sheet.drawRectangle({ x: 40, y: 500, width: 500, height: 200, borderWidth: 1 })
    })
    expect(layout?.hasTable).toBe(false)
  })
})
