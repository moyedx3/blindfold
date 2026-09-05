FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY contract/package.json contract/package.json
COPY indexer/package.json indexer/package.json
RUN npm ci --workspace contract --workspace indexer --include-workspace-root
COPY contract/build contract/build
COPY contract/scripts contract/scripts
COPY indexer indexer
RUN cd indexer && npx tsc --noEmit

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
VOLUME ["/data"]
EXPOSE 8080
CMD ["npx", "tsx", "indexer/src/main.ts"]
