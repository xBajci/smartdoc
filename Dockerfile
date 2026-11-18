# Production image for the app. Openship builds it as the `app` service and
# publishes port 3000 directly, the same way as pgAdmin.

FROM node:24.21.0 AS build
WORKDIR /app
RUN npm install --global pnpm@12.6.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

# The Nitro bundle in .output carries its own node_modules; nothing else is needed at runtime.
FROM node:24.21.0-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY --from=build /app/.output ./.output
EXPOSE 3000
CMD ["node", ".output/server/index.mjs"]
