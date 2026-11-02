FROM node:22-slim

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY . .

ENV NODE_ENV=production
# Render inyecta PORT; el servidor ya la lee
EXPOSE 10000
CMD ["npm", "start"]
