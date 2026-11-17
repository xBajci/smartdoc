// oxlint-disable-next-line import/default -- Vite's `?url` suffix supplies the default export.
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

type PdfJs = typeof import('pdfjs-dist')

let loading: Promise<PdfJs> | undefined

/** pdf.js is large and browser-only, so it loads on first use and only once. */
export function loadPdfJs(): Promise<PdfJs> {
  loading ??= import('pdfjs-dist').then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl
    return pdfjs
  })
  return loading
}

/** Last page a visitor read in each document during this visit. */
const lastPages = new Map<string, number>()

export function rememberPage(documentId: string, page: number) {
  lastPages.set(documentId, page)
}

export function rememberedPage(documentId: string): number | undefined {
  return lastPages.get(documentId)
}
