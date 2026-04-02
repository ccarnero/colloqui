FROM python:3.11-slim

WORKDIR /app

COPY applications/yoizenclaw-application/pyproject.toml ./
COPY applications/yoizenclaw-application/src ./src
COPY applications/shared/types/python /shared/types/python

RUN pip install --no-cache-dir -e .

EXPOSE 8000

CMD ["uvicorn", "src.interfaces.http.routes:app", "--host", "0.0.0.0", "--port", "8000"]
