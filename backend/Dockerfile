FROM node:22-slim

WORKDIR /app

COPY package.json tsconfig.json ./
RUN npm install --omit=dev

COPY *.ts ./
COPY tools/ ./tools/
COPY types/ ./types/
COPY public/ ./public/

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
