FROM python:3.13-slim

WORKDIR /app

COPY . /app

RUN pip install --no-cache-dir -e .

EXPOSE 8002

CMD ["python", "-m", "vireo_editor.server"]
