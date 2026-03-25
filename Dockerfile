# Build Stage
FROM cgr.dev/chainguard/node:latest-dev AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

# Copy required files for CSS build
COPY static/input.css ./static/input.css
COPY static/playfair-display.ttf ./static/playfair-display.ttf
RUN npm run build:css

# Production Stage (Chainguard Node image is rootless by default)
FROM cgr.dev/chainguard/node:latest

WORKDIR /app
ENV NODE_ENV=production

# Re-install only production dependencies (better than copying node_modules to ensure native modules match runtime)
COPY package*.json ./
RUN npm install --omit=dev

# Copy build artifacts and source code
COPY --from=builder /app/static/style.css ./static/style.css
COPY static/playfair-display.ttf ./static/playfair-display.ttf
COPY src ./src
COPY views ./views
COPY index.js ./index.js

# Note: sqlite3 is used, and in a minimal container we need to ensure the data 
# directory is writable by the non-root user. The 'node' user in Chainguard images has UID 1000.
# We'll expect the DB_PATH to point to a mounted volume for persistence.

EXPOSE 3000

# Set entrypoint (node is already the CMD/Entrypoint in the base image, but we specify our app)
ENTRYPOINT ["/usr/bin/node", "index.js"]
