FROM node:18

# System deps: Xvfb, x11vnc, Playwright/Chromium deps, websockify for noVNC
RUN apt-get update && apt-get install -y \
    xvfb \
    x11vnc \
    libnss3 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    libgbm1 \
    libasound2 \
    fonts-liberation \
    libu2f-udev \
    xdg-utils \
    python3 \
    python3-pip \
    && pip3 install websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
COPY client/package*.json ./client/

RUN npm install

COPY . .

RUN npm run build

RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
