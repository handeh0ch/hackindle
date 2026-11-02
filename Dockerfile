FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.js ./
COPY contracts ./contracts
COPY server ./server
COPY db ./db
COPY scripts/migrate.js scripts/setup-owner.js ./scripts/
USER node
EXPOSE 3000
CMD ["node", "index.js"]
