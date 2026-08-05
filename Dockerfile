FROM node:24-trixie-slim

ENV APP_TIMEZONE=Europe/Vienna

WORKDIR /app
VOLUME /app/data
EXPOSE 3000

COPY --chown=node:node . .
RUN npm install --omit=dev

CMD [ "index.js" ]
