FROM --platform=linux/amd64 node:24-slim

WORKDIR /usr/src/app

RUN mkdir config

RUN echo "PORT=3000" >> config/.env
RUN echo "BROADCAST_REFRESH_UPDATE=20" >> config/.env
RUN echo "GAME_DURATION_IN_SECONDS=60" >> config/.env
RUN echo "ENABLE_COHERENCE_BACKEND=true" >> config/.env
RUN echo "REALTIME_CLUSTER_BACKEND=coherence" >> config/.env
RUN echo "COHERENCE_SOCKET_BUS_MAP=socketEvents" >> config/.env
RUN echo "COHERENCE_SOCKET_BUS_TTL_MS=60000" >> config/.env
RUN echo "COHERENCE_SOCKET_EVENT_MAX_PAYLOAD_BYTES=65536" >> config/.env
RUN echo "SCORE_SERVICE_HOST=localhost" >> config/.env
RUN echo "SCORE_SERVICE_PORT=8080" >> config/.env
RUN echo "WORLD_SIZE_Z=155" >> config/.env
RUN echo "WORLD_SIZE_X=250" >> config/.env

COPY package*.json ./

RUN npm install
# RUN npm ci --only=production

COPY . .

EXPOSE 3000

CMD [ "node", "index.js" ]
