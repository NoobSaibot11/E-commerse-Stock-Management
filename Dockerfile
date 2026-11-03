# syntax=docker/dockerfile:1

# One Dockerfile for the whole monorepo. The GraphQL BFF and the frontend
# import code generated inside the gRPC service, so every image starts from
# the same "source" stage and picks its own target:
#
#   docker build --target grpc-server    -t ecommerce/grpc-server .
#   docker build --target graphql-server -t ecommerce/graphql-server .
#   docker build --target frontend       -t ecommerce/frontend .

ARG NODE_VERSION=26

# ---- Dependencies: install once, cached until a package manifest changes ----
FROM node:${NODE_VERSION}-alpine AS deps
# No startup network calls from tooling inside containers: Prisma's
# telemetry/update check can stall the CLI for minutes when outbound
# access is slow, and npm's update notifier is noise.
ENV CHECKPOINT_DISABLE=1 \
    PRISMA_HIDE_UPDATE_MESSAGE=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app
COPY package.json package-lock.json ./
COPY services/grpc-server/package.json services/grpc-server/
COPY services/graphql-server/package.json services/graphql-server/
COPY frontend/package.json frontend/
RUN npm ci

# ---- Source + generated code (protobuf messages, Prisma client) ----
FROM deps AS source
COPY buf.yaml buf.gen.yaml ./
COPY proto proto
COPY services services
COPY frontend frontend
# prisma.config.ts requires DATABASE_URL to be set, but `prisma generate`
# never connects, so a placeholder is enough at build time.
RUN DATABASE_URL="postgresql://build:build@localhost:5432/build" npm run generate

# ---- gRPC inventory service (also used to run migrations) ----
FROM source AS grpc-server
ENV NODE_ENV=production
WORKDIR /app/services/grpc-server
USER node
EXPOSE 50051
# tsx runs the TypeScript directly. Compiling to JS would give a smaller
# image, but the services share generated code across packages, which
# makes a separate build output more involved than this project needs.
CMD ["node", "--import", "tsx", "src/server.ts"]

# ---- GraphQL BFF ----
FROM source AS graphql-server
ENV NODE_ENV=production
WORKDIR /app/services/graphql-server
USER node
EXPOSE 4000
CMD ["node", "--import", "tsx", "src/server.ts"]

# ---- Frontend: build static files, then serve them with nginx ----
FROM source AS frontend-build
# Same-origin paths; nginx proxies them to the backend services.
ENV VITE_GRAPHQL_URL=/graphql \
    VITE_GRPC_URL=/grpc
RUN npm run build --workspace=frontend

FROM nginx:1.28-alpine AS frontend
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80
