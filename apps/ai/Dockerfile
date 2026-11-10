FROM python:3.12-slim
# OCR da importação por foto sem IA.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-por \
 && rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.13.6 /uv /bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src ./src
RUN uv sync --frozen --no-dev
USER nobody
EXPOSE 8000
# Traces desligados por padrão; o compose liga com OTEL_TRACES_EXPORTER=otlp e o endereço do Jaeger.
ENV OTEL_SERVICE_NAME=ai OTEL_TRACES_EXPORTER=none OTEL_METRICS_EXPORTER=none OTEL_LOGS_EXPORTER=none
CMD ["/app/.venv/bin/opentelemetry-instrument", "/app/.venv/bin/uvicorn", "ai.main:app", "--host", "0.0.0.0", "--port", "8000"]
