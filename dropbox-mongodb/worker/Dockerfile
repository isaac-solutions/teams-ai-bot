# Dockerfile for Dropbox File Processing Worker

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies required by docling
# Note: libgl1-mesa-glx was replaced with libgl1 in newer Debian versions
RUN apt-get update && apt-get install -y \
    bash \
    build-essential \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Verify critical imports work
RUN python -c "import pymongo; import motor; import azure.servicebus; import azure.storage.blob; import openai; import tiktoken; print('All imports successful')"

# Copy worker code
COPY main.py .
COPY entrypoint.sh .

# Make entrypoint executable
RUN chmod +x entrypoint.sh

# Create temp directory
RUN mkdir -p /tmp/dropbox-worker

# Set environment variables for container
ENV PYTHONUNBUFFERED=1
ENV TEMP_DIR=/tmp/dropbox-worker

# Run the worker using entrypoint script
CMD ["./entrypoint.sh"]

