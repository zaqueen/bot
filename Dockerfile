FROM node:18-bullseye

# Install Chromium dan dependencies penting
RUN apt-get update && \
    apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-tlwg \
    fonts-khmeros \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Set environment variables untuk Puppeteer
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

CMD ["node", "index.js"]
