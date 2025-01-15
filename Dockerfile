# Use Node.js 18 Alpine as base image for smaller size
FROM node:18-alpine

# Install dependencies required for node-gyp
RUN apk add --no-cache python3 make g++ 

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (including dev dependencies for TypeScript compilation)
RUN npm install

# Copy app source
COPY . .

# Build TypeScript code
RUN npm run build

# Expose port (if needed)
EXPOSE 3000

# Use a health check to help Render detect if the service is running
HEALTHCHECK --interval=30s --timeout=3s \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "start"] 