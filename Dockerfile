FROM node:22-alpine

WORKDIR /app

RUN apk add --no-cache python3 py3-pip ca-certificates && \
    pip3 install --no-cache-dir edge-tts

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

ENV NODE_ENV=production
ENV PORT=8080

EXPOSE 8080

CMD ["npm", "start"]
