# Builds the app and serves it with nginx. Runs on any container host; choose
# one with an EU region (see docs/DEPLOYMENT.md).
#
#   docker build -f deploy/Dockerfile -t indoor-navigation \
#     --build-arg VITE_OPERATOR_NAME="Your company S.r.l." \
#     --build-arg VITE_OPERATOR_CONTACT="privacy@example.com" .
#   docker run -p 8080:8080 indoor-navigation
FROM node:22-alpine AS build
WORKDIR /app/react-client
COPY react-client/package.json react-client/package-lock.json ./
RUN npm ci
COPY react-client/ ./
ARG PUBLIC_URL=""
ARG VITE_OPERATOR_NAME=""
ARG VITE_OPERATOR_CONTACT=""
ENV PUBLIC_URL=$PUBLIC_URL VITE_OPERATOR_NAME=$VITE_OPERATOR_NAME VITE_OPERATOR_CONTACT=$VITE_OPERATOR_CONTACT
RUN npm run build

FROM nginxinc/nginx-unprivileged:stable-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/react-client/build /usr/share/nginx/html
EXPOSE 8080
