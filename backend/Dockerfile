FROM node:22-slim AS builder

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install

COPY *.ts ./
COPY tools/ ./tools/
COPY types/ ./types/

RUN npm run build

# Production image
FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/dist ./dist
COPY public/ ./public/

EXPOSE 3000

CMD ["node", "dist/server.js"]
