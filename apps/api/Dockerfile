FROM node:24-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
# Traces desligados por padrão; o compose liga com OTEL_TRACES_EXPORTER=otlp e o endereço do Jaeger.
ENV OTEL_SERVICE_NAME=api OTEL_TRACES_EXPORTER=none OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none     OTEL_NODE_ENABLED_INSTRUMENTATIONS=http,undici,pg,nestjs-core
CMD ["node", "--import", "@opentelemetry/auto-instrumentations-node/register", "dist/main.js"]
