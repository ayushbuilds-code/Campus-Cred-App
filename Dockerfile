# NOTE: written but not tested in the build environment (no Docker available there).
FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm install --no-audit --no-fund && npm run build
ENV NODE_ENV=production PORT=4000
EXPOSE 4000
VOLUME /app/apps/api/data
# seeds demo data only on first start (skips when the database already has users)
CMD ["sh", "-c", "node apps/api/src/seed.js && node apps/api/src/server.js"]
