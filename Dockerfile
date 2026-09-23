FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node --from=build /app/dist ./dist
COPY --chown=node:node --from=build /app/server/schema.sql ./dist/server/schema.sql
COPY --chown=node:node --from=build /app/data ./data
USER node
EXPOSE 3001
CMD ["node", "dist/server/index.js"]
