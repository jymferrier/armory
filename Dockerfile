FROM node:20-alpine

# Set working directory
WORKDIR /app

# Install dependencies first (layer caching)
COPY package*.json ./
RUN npm install --production

# Copy application source
COPY . .

# Create required directories and assign only those to the node user
# (avoid chown -R /app which recurses through all of node_modules)
RUN mkdir -p data uploads/photos uploads/documents \
    && chown -R node:node data uploads

USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/login || exit 1

CMD ["node", "server.js"]
