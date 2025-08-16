FROM node:20-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .

# Ensure ffmpeg exists - base image lacks ffmpeg. Install it.
RUN apt-get update && apt-get install -y ffmpeg && apt-get clean && rm -rf /var/lib/apt/lists/*

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
