# God's Eye View — containerised dev server.
#
# ## Why the DEV server and not a static build
#
# `npm run build` produces a client only. Every live data source in this app
# reaches its provider through a Vite middleware proxy defined in
# vite.config.js — that is where API keys are held server-side, where the
# caches and budget governors live, and where CORS is solved for the sources
# that do not send permissive headers. Only some of those proxies implement
# `configurePreviewServer`, so `vite preview` yields an app whose flights,
# satellites, traffic, FIRMS, CCTV and terrain endpoints 404.
#
# Running the dev server is therefore the configuration that actually works,
# and it is what this image does.

FROM node:24-slim

# Puppeteer is a devDependency used only by the QA harnesses in scripts/. Its
# postinstall otherwise downloads a full Chromium into the image — well over
# 100 MB that nothing in the running container ever executes.
ENV PUPPETEER_SKIP_DOWNLOAD=1

WORKDIR /app

# Dependencies first, as their own layer: package.json and the lockfile change
# far less often than source, so an edit to src/ reuses the cached install.
#
# NODE_ENV is deliberately NOT set to production — the dev server IS vite, and
# vite is a devDependency. `npm ci --omit=dev` would produce an image that
# cannot start.
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The proxy disk caches (OpenSky credit ledger, TLEs, tile budgets) are written
# to ./.gev-cache at runtime. Create it owned by the unprivileged user so the
# container does not need to write as root; docker-compose mounts a named
# volume here so the caches survive a restart.
RUN mkdir -p /app/.gev-cache && chown -R node:node /app
USER node

# Bind to all interfaces INSIDE the container. This is not the LAN exposure
# SECURITY.md warns about: a container's loopback is not the host's, so
# `localhost` here would make the server unreachable through any published
# port. Exposure is controlled on the HOST side by what docker-compose
# publishes, which defaults to 127.0.0.1 only.
ENV HOST=0.0.0.0
ENV PORT=4173

EXPOSE 4173

# vite.config.js reads HOST and PORT from process.env (shell values win over
# .env), so no CLI flags are needed and a compose override of either is
# honoured.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4173)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["npm", "run", "dev"]
