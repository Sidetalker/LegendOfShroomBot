FROM python:3.9

# Install system dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    opus-tools \
    libopus-dev \
    python3-dev \
    build-essential \
    portaudio19-dev \
    curl \
    wget

# Set working directory
WORKDIR /app

# Copy requirements first for better caching
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy the rest of the application
COPY . .

# Create model directory
RUN mkdir -p /data/model

# Download Vosk model during build (you can change the URL to the model you want)
RUN wget https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip \
    && unzip vosk-model-small-en-us-0.15.zip -d /data/model \
    && mv /data/model/vosk-model-small-en-us-0.15/* /data/model/ \
    && rmdir /data/model/vosk-model-small-en-us-0.15 \
    && rm vosk-model-small-en-us-0.15.zip

# Create symbolic link from the mounted volume to the model directory
RUN ln -sf /data/model /app/model

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:8080/health || exit 1

# Command to run the bot
CMD ["python", "main.py"] 