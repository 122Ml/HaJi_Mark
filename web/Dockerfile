FROM node:22.22.0-alpine AS build
ENV NODE_OPTIONS=--max-old-space-size=512
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-fund --fetch-timeout=30000 --fetch-retries=1 --loglevel=http
COPY . .
RUN npm run build

FROM nginx:1.28.0-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/dist /usr/share/nginx/html
