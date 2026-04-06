FROM python:3.11-slim

WORKDIR /app

# Copiar archivos del proyecto (build context es yoizenclaw-application)
COPY pyproject.toml ./
COPY src ./src

# Copiar shared types desde el parent directory
COPY ../shared/types/python /shared/types/python

# Instalar dependencias
RUN pip install --no-cache-dir -e /shared/types/python
RUN pip install --no-cache-dir -e .

EXPOSE 8080

CMD ["python3", "-m", "uvicorn", "src.api.routes:app", "--host", "0.0.0.0", "--port", "8080", "--log-level", "info", "--no-access-log"]
