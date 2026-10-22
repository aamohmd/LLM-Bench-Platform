FROM python:3.12-slim

# Create a non-root user (Hugging Face Spaces requires this)
RUN useradd -m -u 1000 user

WORKDIR /app
COPY requirements.txt .
COPY LICENSE ./LICENSE
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/ /app/backend/
COPY benchmark_scoring/ /app/benchmark_scoring/
COPY alembic/ /app/alembic/
COPY alembic.ini /app/
COPY config/ /app/config/
COPY scripts/create_api_key.py /app/scripts/create_api_key.py

RUN mkdir -p data/results && chown -R user:user /app

# Switch to the non-root user
USER user

# Set default port (Cloud Run sets this to 8080 automatically)
ENV PORT=8080
EXPOSE $PORT

# Application startup owns the single schema/migration pass.
CMD ["sh", "-c", "uvicorn backend.app.main:app --host 0.0.0.0 --port $PORT"]
