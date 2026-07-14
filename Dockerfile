# Phase 12: backend image - FastAPI app serving /demand_forecast, /route_economics,
# /what_if, /copilot, /routes. Reads pre-trained model + reference/profile data that
# ship in the image (no DB access needed at runtime).

FROM python:3.11-slim

WORKDIR /app

# ponytail: requirements-api.txt is the runtime-only subset (no sqlalchemy/psycopg2/
# scikit-learn/requests - those are etl/ and ml/train_demand_model.py-only, see requirements.txt)
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

COPY agents/ agents/
COPY api/ api/
COPY data/ data/
COPY ml/ ml/
COPY models/ models/
COPY simulation/ simulation/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
