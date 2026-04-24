FROM node:20

WORKDIR /app

COPY . .

# Remove lockfiles + node_modules so npm install builds native bindings for Linux
# (Tailwind v4 / Lightning CSS native bindings fail when lockfile from macOS/Windows)
RUN rm -rf node_modules client/node_modules package-lock.json client/package-lock.json
RUN npm install

RUN npm run build

RUN npx playwright install --with-deps chromium

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
