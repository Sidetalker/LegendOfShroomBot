FROM python:3.11

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    opus-tools \
    libopus-dev \
    python3-dev \
    build-essential \
    portaudio19-dev \
    curl \
    wget \
    unzip

# Set working directory
WORKDIR /app

# Copy and install requirements first (this layer will be cached)
COPY requirements.txt .
RUN pip install -r requirements.txt

# Create a separate layer for model download that can be cached
RUN mkdir -p /app/model && \
    cd /app/model && \
    if [ ! -d "am" ] || [ ! -f "am/final.mdl" ]; then \
        echo "Downloading model..." && \
        wget -q https://alphacephei.com/vosk/models/vosk-model-en-us-0.22.zip && \
        unzip vosk-model-en-us-0.22.zip && \
        mv vosk-model-en-us-0.22/* . && \
        rmdir vosk-model-en-us-0.22 && \
        rm vosk-model-en-us-0.22.zip && \
        chmod -R 755 . && \
        echo "Model directory contents:" && \
        ls -la && \
        echo "AM directory contents:" && \
        ls -la am/; \
    else \
        echo "Model already exists, skipping download"; \
    fi

# Copy application code (changes frequently, so do this last)
COPY . .

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Command to run the bot
CMD ["python", "main.py"] 