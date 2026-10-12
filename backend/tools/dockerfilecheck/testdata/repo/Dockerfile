ARG NODE_VERSION=22

FROM --platform=$BUILDPLATFORM node:${NODE_VERSION}-alpine AS frontend-builder

WORKDIR /src/frontend
COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
COPY frontend/index.html frontend/vite.config.ts frontend/vitest.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json ./
COPY frontend/scripts ./scripts
COPY frontend/src ./src
COPY frontend/public ./public
RUN pnpm build

FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS backend-builder

WORKDIR /src/backend
COPY backend/go.mod backend/go.sum ./
COPY backend/cmd ./cmd
COPY backend/internal ./internal
COPY backend/docs/docs.go ./docs/docs.go
RUN go build -o /out/grok2api ./cmd/app

FROM alpine:3.23

WORKDIR /app
COPY --from=backend-builder /out/grok2api /app/grok2api
COPY VERSION /app/VERSION
ENTRYPOINT ["/app/grok2api"]
