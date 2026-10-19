# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS dependencies

RUN mkdir /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --no-audit --no-fund

FROM dependencies AS source
COPY --chown=node:node . .

FROM source AS test
CMD ["sh", "-c", "npm run lint && npm run format:check && npm run build"]

FROM source AS build
RUN npm run build

FROM nginx:1.31.7-alpine@sha256:892bb2152464f0c5d8972593a5f5afaf8054552580b699d95f8ff4af08c2d33d AS runtime

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/index.html"]
# The supplied config needs no startup scripts or writable /etc/nginx.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
