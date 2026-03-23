FROM node:25-alpine
WORKDIR /app

COPY package.json .
RUN npm install --omit=dev

COPY static static
COPY views views
COPY server.js .

EXPOSE 3000
CMD ["node", "server.js"]