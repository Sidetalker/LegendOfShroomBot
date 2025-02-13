# Use Node.js 16 as base image
FROM node:16-slim

# Install only ffmpeg which is required for voice functionality
RUN apt-get update && apt-get install -y \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /usr/src/app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Set environment variables
ENV NODE_ENV=production

# Start the bot
CMD ["npm", "start"]