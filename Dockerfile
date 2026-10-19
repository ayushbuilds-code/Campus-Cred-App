FROM node:22-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY . .
RUN npm install --no-audit --no-fund && npm run build
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["sh", "-c", "node apps/api/src/seed.js && node apps/api/src/server.js"]
