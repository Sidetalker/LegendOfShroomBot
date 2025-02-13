FROM python:3.11 as model-downloader

# Install wget and unzip for model download
RUN apt-get update && apt-get install -y wget unzip

# Create model directory
WORKDIR /model

# Download and extract model (using 0.22 model)
RUN wget https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip \
    && unzip vosk-model-en-us-0.22.zip \
    && mv vosk-model-en-us-0.22/* . \
    && rmdir vosk-model-en-us-0.22 \
    && rm vosk-model-en-us-0.22.zip \
    && ls -la /model  # List contents for verification

FROM python:3.11

# Install only runtime dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    opus-tools \
    libopus-dev \
    python3-dev \
    build-essential \
    portaudio19-dev \
    curl

# Set working directory
WORKDIR /app

# Copy and install requirements first (this layer will be cached)
COPY requirements.txt .
RUN pip install -r requirements.txt

# Create model directory in app with proper permissions
RUN mkdir -p /app/model && chmod 755 /app/model

# Copy the model from the first stage directly to app/model and set permissions
COPY --from=model-downloader /model/ /app/model/
RUN chmod -R 755 /app/model && \
    chown -R root:root /app/model && \
    ls -la /app/model  # List contents for verification

# Copy application code (changes frequently, so do this last)
COPY . .

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Create script to handle model setup with proper permissions
RUN echo '#!/bin/bash\n\
if [ -d "/data/model" ] && [ -n "$(ls -A /data/model)" ]; then\n\
    echo "Using model from volume"\n\
    rm -rf /app/model/*\n\
    cp -rp /data/model/* /app/model/\n\
    chmod -R 755 /app/model\n\
else\n\
    echo "Using built-in model"\n\
fi\n\
ls -la /app/model\n\
exec python main.py' > /app/start.sh && chmod +x /app/start.sh

# Command to run the bot
CMD ["/app/start.sh"] 