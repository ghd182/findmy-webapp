# File: Dockerfile
# Purpose: Build the Docker image for the FindMy Flask Web Application.

# Use an official Python Alpine runtime as a parent image
# Alpine is smaller and often has fewer vulnerabilities
# Platform can be specified at build time or inferred by Docker
ARG TARGETPLATFORM=linux/arm64/v8
FROM python:3.13-alpine
# Example with digest pinning for reproducibility (replace digest):
# FROM python:3.13-alpine@sha256:18159b2be11db91f84b8f8f655cd860f805dbd9e49a583ddaac8ab39bf4fe1a7

# Set environment variables for Python and Flask
# Prevent *.pyc files
ENV PYTHONDONTWRITEBYTECODE=1
# Ensure logs are sent straight to console
ENV PYTHONUNBUFFERED=1
# Entry point script for Flask commands
ENV FLASK_APP=run.py
# Default Flask environment (can be overridden)
ENV FLASK_ENV=production
# Default Waitress threads (can be overridden in docker-compose or .env)
ENV WAITRESS_THREADS=4
# Default Port (can be overridden)
ENV PORT=5000
# Optional: Set timezone if needed by Python libs (e.g., APScheduler)
# ENV TZ=Europe/Amsterdam # Example, set in docker-compose for flexibility

# Set the working directory in the container
WORKDIR /app

# <<< START MODIFIED SECTION >>>
# Install system dependencies needed by Python packages on Alpine Linux
# build-base: For compiling C extensions (like cryptography)
# libffi-dev: Required by cffi, often a dependency of crypto libs
# sqlite: Command-line tool to safely fix DB migration history
RUN apk add --no-cache \
    build-base \
    libffi-dev \
    sqlite
# <<< END MODIFIED SECTION >>>

# Copy requirements first to leverage Docker layer cache
COPY requirements.txt /app/requirements.txt

# Install Python dependencies
# Using --no-cache-dir makes the image smaller
# Upgrade pip, wheel, setuptools first for compatibility
RUN pip install --no-cache-dir --upgrade pip wheel setuptools && \
    pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code into the container's working directory
# This includes the 'app' directory, scripts, run.py etc.
# Subdirectories within './app' are copied automatically.
COPY ./app /app/app
COPY ./scripts /app/scripts
COPY run.py /app/run.py
# Copy migrations directory
COPY ./migrations /app/migrations
# If needed for testing within container
COPY test_import.py /app/test_import.py

# Ensure the data directory exists within the container
# The actual data will be provided by a Docker Volume Mount at runtime.
# This just creates the mount point inside the image.
# Optional: Set permissions if running as a non-root user later.
RUN mkdir -p /app/data

# Copy the entrypoint script and make it executable
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose the port the app runs on (defined by PORT env var)
EXPOSE ${PORT}

# Use entrypoint.sh to handle database migrations robustly on startup.
ENTRYPOINT ["/app/entrypoint.sh"]

# The default command to execute after the entrypoint runs.
# This will be passed as arguments to entrypoint.sh.
CMD ["waitress-serve", "--host=0.0.0.0", "--port=5000", "--threads=4", "run:app"]