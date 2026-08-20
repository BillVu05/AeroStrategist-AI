# Backend image. Serves the simulator API from the pre-fitted market model and
# the reference data that ship inside the image - no database at runtime.

FROM python:3.11-slim

WORKDIR /app

# requirements-api.txt is the runtime-only subset: no sqlalchemy/psycopg2/
# scikit-learn/requests, which only etl/ and pacific_wings/ml/train.py need.
# See requirements.txt for the full development set.
COPY requirements-api.txt .
RUN pip install --no-cache-dir -r requirements-api.txt

COPY pacific_wings/ pacific_wings/
COPY data/ data/
COPY models/ models/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=3)" || exit 1

CMD ["uvicorn", "pacific_wings.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
