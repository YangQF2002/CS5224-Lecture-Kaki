# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205 AS dependencies

RUN mkdir /app && chown node:node /app
WORKDIR /app
USER node
COPY --chown=node:node package.json package-lock.json ./
RUN --mount=type=cache,target=/home/node/.npm,uid=1000,gid=1000 \
    npm ci --no-audit --no-fund

FROM dependencies AS source
COPY --chown=node:node . .

FROM source AS test
CMD ["sh", "-c", "npm run lint && npm run format:check && npm test && npm run build"]

FROM source AS build
RUN npm run build

FROM nginx:1.30.6-alpine@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5 AS runtime

COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD ["wget", "-q", "-O", "/dev/null", "http://127.0.0.1:8080/index.html"]
# The supplied config needs no startup scripts or writable /etc/nginx.
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
