FROM node:20-alpine

ENV PORT=11111
ENV NOMETA_ROOT="/app"
ENV NOMETA_FILE="index.html"
ENV NOMETA_URL_TMPL=""

EXPOSE 11111

WORKDIR /nometa
COPY . /nometa/

RUN npm install

VOLUME "/app"

ENTRYPOINT [ "node", "src/index.js" ]
