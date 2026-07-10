# syntax=docker/dockerfile:1
# Goemon frontend — build the Vite SPA and serve it from nginx on Cloud Run.
# VITE_API_BASE is baked at build time (Vite inlines import.meta.env), so the image
# is environment-specific: pass the backend's public /api URL as a build arg.

# ---- build ----
FROM node:20-slim AS build
WORKDIR /app
ARG VITE_API_BASE
ENV VITE_API_BASE=$VITE_API_BASE
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# ---- runtime ----
FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
# Cloud Run sends traffic to $PORT (default 8080); nginx listens there.
EXPOSE 8080
CMD ["nginx", "-g", "daemon off;"]
