ARG NODE_IMAGE=node:22-alpine
FROM ${NODE_IMAGE} AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable

FROM base AS dependencies
WORKDIR /opt/nabareview
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
  pnpm install --frozen-lockfile

FROM base AS build
WORKDIR /opt/nabareview
COPY --from=dependencies /opt/nabareview/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM dependencies AS migrate
WORKDIR /opt/nabareview
COPY db ./db
COPY scripts/db-migrate.mjs ./scripts/db-migrate.mjs
CMD ["pnpm", "db:migrate"]

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
WORKDIR /opt/nabareview
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build --chown=nextjs:nodejs /opt/nabareview/public ./public
COPY --from=build --chown=nextjs:nodejs /opt/nabareview/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /opt/nabareview/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /opt/nabareview/scripts/scheduler.mjs ./scripts/scheduler.mjs
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
