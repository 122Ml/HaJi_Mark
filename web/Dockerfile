FROM node:22.22.0-alpine AS build
ENV NODE_OPTIONS=--max-old-space-size=1024
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-fund --fetch-timeout=30000 --fetch-retries=1 --loglevel=http
COPY . .
RUN npm run build
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' -o -name '*.json' \) -size +1024c -exec gzip -9 -k {} +

FROM nginx:1.28.0-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
