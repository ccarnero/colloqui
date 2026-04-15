FROM python:3.11-slim

WORKDIR /app

# Build context must be the `applications/` directory (see knative/tenant-yoizenclaw-runtime/README.md)
COPY yoizenclaw-application/pyproject.toml ./
COPY yoizenclaw-application/src ./src
COPY shared/types/python /shared/types/python

RUN pip install --no-cache-dir -e /shared/types/python
RUN pip install --no-cache-dir -e .

EXPOSE 8080

CMD ["python3", "-m", "uvicorn", "src.api.routes:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info", "--no-access-log"]
