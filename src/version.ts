/**
 * Names the build this code is from. The server and the browser files of one
 * build carry the same id (see `vite.config.ts`), so a tab can tell that the
 * server was deployed again since the tab was loaded.
 */
export const BUILD_ID: string = import.meta.env.VITE_BUILD_ID ?? 'dev'

/** Where the server says which build it runs. The address never changes, so a tab of any build can ask. */
export const VERSION_URL = '/api/verze'
