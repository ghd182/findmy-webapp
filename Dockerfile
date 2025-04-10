# Dockerfile

# Use an official Python Alpine runtime as a parent image
# Alpine is smaller and often has fewer vulnerabilities
# Platform can be specified at build time
ARG TARGETPLATFORM=linux/arm64/v8
# Pinning to a digest ensures reproducibility - replace with the actual digest for your platform
# Example: FROM python:3.13-alpine@sha256:18159b2be11db91f84b8f8f655cd860f805dbd9e49a583ddaac8ab39bf4fe1a7
FROM python:3.13-alpine
# If you know the digest, uncomment the line above and comment out the line below
# FROM python:3.13-alpine

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV FLASK_APP=run.py
ENV FLASK_ENV=production
# Default Waitress threads (can be overridden in docker-compose or .env)
ENV WAITRESS_THREADS=4
# Default Port (can be overridden)
ENV PORT=5000
# Alpine uses /usr/share/zoneinfo by default, TZDIR might not be strictly needed
# ENV TZDIR=/usr/share/zoneinfo

# Set the working directory in the container
WORKDIR /app

# Install system dependencies needed by Python packages on Alpine
# build-base: Equivalent to build-essential for compiling C extensions
# libffi-dev: Foreign Function Interface library dev files
# Add other Alpine packages here if needed (e.g., bluez-dev for bluetooth)
RUN apk add --no-cache \
    build-base \
    libffi-dev
    # Add any other required Alpine packages here, e.g.:
    # bluez-dev

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