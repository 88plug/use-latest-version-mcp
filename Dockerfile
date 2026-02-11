# Use Node.js 18 Alpine for smaller image size
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Copy source code and config first
COPY src/ ./src/
COPY tsconfig.json ./

# Install all dependencies (including dev) for building
RUN npm ci && npm cache clean --force

# Build the application
RUN npm run build

# Production stage - create smaller image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy production package file and lockfile
COPY package.production.json ./package.json
COPY package-lock.json ./

# Install only production dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy built application from build stage
COPY --from=0 /app/build/ ./build/

# Create non-root user for security
RUN addgroup -g 1001 -S nodejs && \
    adduser -S mcp -u 1001 && \
    chown -R mcp:nodejs /app

# Switch to non-root user
USER mcp

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (res) => { \
    process.exit(res.statusCode === 200 ? 0 : 1) \
  }).on('error', () => process.exit(1))"

# Start the application
CMD ["node", "build/index.js", "http"]