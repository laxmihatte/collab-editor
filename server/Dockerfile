# Express + Socket.io API image.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# --omit=dev leaves out nodemon and the test client; neither belongs in a
# production image.
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -g 1001 -S nodejs && adduser -S api -u 1001

COPY --from=deps /app/node_modules ./node_modules
COPY --chown=api:nodejs package.json ./
COPY --chown=api:nodejs src ./src
COPY --chown=api:nodejs scripts ./scripts

USER api
EXPOSE 3001

# The container is considered unhealthy if the API stops answering, which is
# what tells Docker to restart it rather than leaving a dead process running.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
