FROM node:22-slim

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY tsconfig.json ./
COPY src/ ./src/
COPY public/ ./public/

RUN npm run build

EXPOSE 3000

CMD ["node", "dist/server.js"]
