FROM node:18

# System deps: Xvfb, x11vnc, websockify for VNC; Playwright installs Chromium deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    xvfb \
    x11vnc \
    websockify \
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
