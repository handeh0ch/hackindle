FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY index.js ./
COPY contracts ./contracts
COPY projects/server ./projects/server
COPY db ./db
COPY projects/frontend ./projects/frontend
COPY scripts/migrate.js scripts/setup-owner.js scripts/export-backup.js scripts/import-backup.js ./scripts/
USER node
EXPOSE 3000
CMD ["node", "index.js"]
