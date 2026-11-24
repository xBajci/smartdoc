import { createFileRoute } from '@tanstack/react-router'
import { useLayoutEffect, useRef, useState } from 'react'
import { normalizeLibrarySearch } from '~/archive/query'
import { archive, loadArchive, useArchive } from '~/archive/store'
import { isPublished, type LibrarySearch } from '~/archive/types'
import { ChatPanel, type ChosenDocument } from '~/chat/ChatPanel'
import { MAX_CHAT_DOCUMENTS } from '~/chat/types'
import { AppHeader } from '~/components/AppHeader'
import { Icon } from '~/components/Icon'
import { useSidePanel } from '~/components/useSidePanel'
import { cs } from '~/copy/cs'
import { Library } from '~/library/Library'
import { searchLibraryFn } from '~/server/archive-functions'
import { DocumentOverlay } from '~/viewer/DocumentOverlay'
import { Viewer } from '~/viewer/Viewer'

export const Route = createFileRoute('/')({
  validateSearch: normalizeLibrarySearch,
  // The list is searched on the server, so it is read again whenever the
  // search, a filter, the order or the number of documents asked for changes.
  loaderDeps: ({ search: { q, kategorie, rok, typ, razeni, pocet, doc } }) => ({
    query: { q, kategorie, rok, typ, razeni, pocet },
    doc,
  }),
  loader: async ({ deps }) => {
    const [result, opened] = await Promise.all([
      searchLibraryFn({ data: deps.query }),
      deps.doc === undefined ? [] : archive.documentsById([deps.doc]),
      loadArchive(),
    ])
    return { result, opened: opened[0] }
  },
  component: LibraryPage,
})

/** Width of the chat panel in pixels; the divider moves it between the two limits. */
const CHAT_WIDTH = { min: 320, max: 640 }

function LibraryPage() {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const { result, opened } = Route.useLoaderData()
  const { categories } = useArchive()
  const libraryPanel = useRef<HTMLElement>(null)
  const listScroll = useRef(0)
  const { workspace, style, divider } = useSidePanel({
    ...CHAT_WIDTH,
    panel: '.chat',
    label: cs.chat.resize,
  })
  /** On a narrow screen the chat covers the page and is opened on request. */
  const [chatOpen, setChatOpen] = useState(false)
  /** The documents the visitor wants to ask the chat about. */
  const [chosen, setChosen] = useState<readonly ChosenDocument[]>([])

  const openDocument =
    opened !== undefined && opened.id === search.doc && isPublished(opened) ? opened : undefined
  // An image opens over the page; a PDF, or a document that is not there, takes the list's place.
  const openImage = openDocument?.format === 'image' ? openDocument : undefined
  const viewerOpen = search.doc !== undefined && openImage === undefined

  function askAbout(document: ChosenDocument) {
    // A second click on a chosen document takes it out again.
    setChosen((current) =>
      current.some((item) => item.id === document.id)
        ? current.filter((item) => item.id !== document.id)
        : [...current, { id: document.id, title: document.title }].slice(-MAX_CHAT_DOCUMENTS),
    )
    setChatOpen(true)
  }

  function closeDocument() {
    void navigate({
      search: (previous) => ({ ...previous, doc: undefined, strana: undefined }),
    })
  }

  // The list stays mounted under the viewer; a hidden panel loses its scroll
  // position, so it is put back when the visitor returns.
  useLayoutEffect(() => {
    if (!viewerOpen && libraryPanel.current !== null) {
      libraryPanel.current.scrollTop = listScroll.current
    }
  }, [viewerOpen])

  function changeSearch(patch: Partial<LibrarySearch>) {
    void navigate({ search: (previous) => ({ ...previous, ...patch }), replace: true })
  }

  return (
    <div className="app">
      <AppHeader />
      <main
        ref={workspace}
        className={chatOpen ? 'workspace workspace--chat-open' : 'workspace'}
        style={style}
      >
        <section
          ref={libraryPanel}
          className="panel library"
          hidden={viewerOpen}
          onScroll={(event) => {
            if (!viewerOpen) listScroll.current = event.currentTarget.scrollTop
          }}
        >
          <Library
            result={result}
            categories={categories}
            search={search}
            onSearchChange={changeSearch}
            chosenIds={chosen.map((document) => document.id)}
            onAskAbout={askAbout}
          />
        </section>
        {viewerOpen ? (
          <Viewer
            document={openDocument}
            requestedPage={search.strana}
            chosen={chosen.some((item) => item.id === search.doc)}
            onAskAbout={askAbout}
            onBack={closeDocument}
          />
        ) : null}
        {openImage === undefined ? null : (
          <DocumentOverlay key={openImage.id} document={openImage} onClose={closeDocument} />
        )}

        <div {...divider} />
        <ChatPanel
          chosen={chosen}
          onUnchoose={(id) => setChosen((current) => current.filter((item) => item.id !== id))}
          onUnchooseAll={() => setChosen([])}
          onClose={() => setChatOpen(false)}
          onOpenSource={(source) => {
            setChatOpen(false)
            void navigate({
              search: (previous) => ({ ...previous, doc: source.documentId, strana: source.page }),
            })
          }}
        />
        <button
          type="button"
          className="button button--primary chat-opener"
          onClick={() => setChatOpen(true)}
        >
          <Icon name="chat" />
          {cs.chat.openChat}
        </button>
      </main>
    </div>
  )
}
