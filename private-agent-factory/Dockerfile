FROM --platform=linux/amd64 node:20-slim

WORKDIR /usr/src/app

ENV NODE_ENV=production
ENV PORT=8080

COPY package*.json ./
RUN npm install --omit=dev

COPY index.js ./

EXPOSE 8080

CMD [ "node", "index.js" ]
