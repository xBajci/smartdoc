# MLflow tracking server with its login (basic auth). The plain image lacks
# Flask-WTF, which the login needs; the "-full" image has it, but is 450 MB bigger.
FROM ghcr.io/mlflow/mlflow:v3.18.0
RUN pip install --no-cache-dir "mlflow[auth]==3.18.0"
