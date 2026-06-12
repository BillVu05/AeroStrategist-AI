# Phase 12: backend image - FastAPI app serving /demand_forecast, /route_economics,
# /what_if, /copilot, /routes. Reads pre-trained model + reference/profile data that
# ship in the image (no DB access needed at runtime).

FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY agents/ agents/
COPY api/ api/
COPY data/ data/
COPY ml/ ml/
COPY models/ models/
COPY simulation/ simulation/

EXPOSE 8000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000"]
