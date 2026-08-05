FROM node:24-trixie-slim

WORKDIR /app
VOLUME /app/data
EXPOSE 3000

COPY --chown=node:node . .
RUN npm install --omit=dev

CMD [ "index.js" ]
