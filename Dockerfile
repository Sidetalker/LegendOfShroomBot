FROM python:3.11 as model-downloader

# Install wget and unzip for model download
RUN apt-get update && apt-get install -y wget unzip

# Create model directory
WORKDIR /model

# Download and extract model
RUN wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip \
    && unzip vosk-model-small-en-us-0.15.zip \
    && mv vosk-model-small-en-us-0.15/* . \
    && rmdir vosk-model-small-en-us-0.15 \
    && rm vosk-model-small-en-us-0.15.zip

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

# Create model directory in app
RUN mkdir -p /app/model

# Copy the model from the first stage directly to app/model
COPY --from=model-downloader /model/* /app/model/

# Copy application code (changes frequently, so do this last)
COPY . .

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Create script to handle model setup
RUN echo '#!/bin/bash\n\
if [ -d "/data/model" ] && [ -n "$(ls -A /data/model)" ]; then\n\
    echo "Using model from volume"\n\
    rm -rf /app/model/*\n\
    cp -r /data/model/* /app/model/\n\
else\n\
    echo "Using built-in model"\n\
fi\n\
exec python main.py' > /app/start.sh && chmod +x /app/start.sh

# Command to run the bot
CMD ["/app/start.sh"] 