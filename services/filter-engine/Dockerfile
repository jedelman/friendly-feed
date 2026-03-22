# Build stage
# Docker build context MUST be the repo root:
#   docker build -f services/filter-engine/Dockerfile .
# Railway sets the context to the repo root when dockerfilePath is specified.
FROM node:20-alpine AS builder

WORKDIR /repo

# Copy dependency manifests and install
COPY services/filter-engine/package.json services/filter-engine/package-lock.json* \
     ./services/filter-engine/
RUN cd services/filter-engine && npm ci --ignore-scripts

# Copy source files (esbuild bundles packages/shared inline — no runtime dep needed)
COPY services/filter-engine/src/ ./services/filter-engine/src/
COPY packages/shared/src/ ./packages/shared/src/

# Build — produces a single bundled dist/index.js
WORKDIR /repo/services/filter-engine
RUN npm run build

# Runtime stage — minimal image, no dev deps
FROM node:20-alpine

WORKDIR /app
COPY --from=builder /repo/services/filter-engine/dist/index.js ./

ENV NODE_ENV=production

CMD ["node", "index.js"]
