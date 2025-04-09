# Dockerfile

# Use an official Python runtime as a parent image - choose ARM-compatible base
# Bookworm is current Debian stable, often good for Raspberry Pi OS compatibility
# Specify arm64 architecture explicitly for Pi 4
FROM --platform=linux/arm64/v8 python:3.11-slim-bookworm

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=run.py
ENV FLASK_ENV=production
# Default Waitress threads (can be overridden in docker-compose or .env)
ENV WAITRESS_THREADS=4
# Default Port (can be overridden)
ENV PORT=5000
# Define timezone data path
ENV TZDIR=/usr/share/zoneinfo

# Set the working directory in the container
WORKDIR /app

# Install system dependencies that might be needed by Python packages
# build-essential: For compiling C extensions (e.g., cryptography)
# libffi-dev: Foreign Function Interface library dev files
# libbluetooth-dev: Might be needed by findmy library if it uses BLE directly (add if necessary)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first to leverage Docker cache
COPY requirements.txt /app/requirements.txt

# Install Python dependencies
# Using --no-cache-dir makes the image smaller
RUN pip install --no-cache-dir --upgrade pip wheel setuptools && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container
COPY ./app /app/app
# Copy scripts, run.py, config files etc. to '/app'
COPY ./scripts /app/scripts
COPY run.py /app/run.py
COPY test_import.py /app/test_import.py

# Ensure the data directory exists within the container (volume mount will overlay this)
# Set appropriate permissions if running as non-root later
RUN mkdir -p /app/data

# Expose the port the app runs on (defined by PORT env var)
EXPOSE ${PORT}

# Define the command to run the application using Waitress
# Uses environment variables for host, port, and threads
CMD waitress-serve --host=0.0.0.0 --port=${PORT} --threads=${WAITRESS_THREADS} run:app