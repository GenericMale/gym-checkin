FROM cgr.dev/chainguard/node:latest

WORKDIR /app
VOLUME /app/data
EXPOSE 3000

COPY --chown=node:node . .
RUN npm install --omit=dev

CMD [ "index.js" ]
