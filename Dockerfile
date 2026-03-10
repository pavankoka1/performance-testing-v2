FROM node:18

# VNC deps only - no pip. Playwright installs Chromium deps via --with-deps
RUN apt-get update \
    && apt-get install -y --no-install-recommends xvfb x11vnc websockify \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY . .

# Fresh install in container so native PostCSS/Tailwind bindings build for Linux
# (avoids "Cannot find native binding" when lockfile was generated on different OS)
RUN rm -rf node_modules client/node_modules && npm install

RUN npm run build

RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
