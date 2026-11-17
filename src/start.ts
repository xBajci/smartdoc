import { createCsrfMiddleware, createStart } from '@tanstack/react-start'

const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

/**
 * The export must be named `startInstance`. Declaring a start instance
 * REPLACES the framework's default request middleware, so `csrfMiddleware`
 * is listed explicitly and must stay once server functions arrive.
 */
export const startInstance = createStart(() => ({
  // The archive lives in browser memory for now, so screens render in the browser.
  defaultSsr: false,
  requestMiddleware: [csrfMiddleware],
}))
