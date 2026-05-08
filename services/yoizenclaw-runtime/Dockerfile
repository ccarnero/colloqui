FROM python:3.11-slim

WORKDIR /app

# Build from repo root so the runtime follows the same service layout as the
# rest of the platform while still consuming the shared Python package.
COPY services/yoizenclaw-runtime/pyproject.toml ./
COPY services/yoizenclaw-runtime/src ./src
COPY packages/shared-python /packages/shared-python

RUN pip install --no-cache-dir -e /packages/shared-python
RUN pip install --no-cache-dir -e .

EXPOSE 8080

CMD ["python3", "-m", "uvicorn", "src.api.routes:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info", "--no-access-log"]
