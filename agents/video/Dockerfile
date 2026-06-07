FROM python:3.13-slim

WORKDIR /app

# Install ffmpeg + system deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install shared Python package
COPY ../../packages/shared/python /app/shared
RUN pip install --no-cache-dir /app/shared

COPY . /app
RUN pip install --no-cache-dir -e .

ENV VIREO_MEDIA_DIR=/vireo_media
ENV VIREO_WHISPER_CACHE_DIR=/vireo_media/whisper_cache
ENV VIREO_WHISPER_CACHE_TTL_DAYS=30

EXPOSE 8007

CMD ["python", "-m", "vireo_video.server"]
