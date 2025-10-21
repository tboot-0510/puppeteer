# Base: lightweight Node + Chromium runtime (no need to install Chrome manually)
FROM ghcr.io/puppeteer/puppeteer:22-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files first (better Docker caching)
COPY package*.json ./

# Install dependencies (omit devDeps, skip audit, progress off for speed)
RUN npm install --omit=dev --no-audit --progress=false && npm cache clean --force

# Copy app source
COPY . .

# Expose the app port
EXPOSE 3000

# Environment vars for Puppeteer
ENV NODE_ENV=production \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

# Healthcheck to ensure Puppeteer service is up
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/health').then(r => {if(!r.ok) process.exit(1)})"

# Run as non-root (user created in base image)
USER pptruser

# Start the app
CMD ["node", "server.js"]
