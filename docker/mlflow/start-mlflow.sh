#!/bin/sh
# Starts MLflow with its login. Everything it keeps is on the volume /mlflow:
# runs and traces in mlflow.db, users in basic_auth.db, artifacts in artifacts/.
set -eu

# MLflow reads the administrator's password from MLFLOW_AUTH_ADMIN_PASSWORD
# (at least 12 characters), and only when basic_auth.db is created, on the
# first start. Later it is changed in MLflow itself, not here.
: "${MLFLOW_AUTH_ADMIN_PASSWORD:?MLFLOW_AUTH_ADMIN_PASSWORD is not set}"
: "${MLFLOW_FLASK_SERVER_SECRET_KEY:?MLFLOW_FLASK_SERVER_SECRET_KEY is not set}"

# Nobody sees anything without being let in. A checked password is remembered
# for a minute, so a burst of traces does not hash it on every request.
cat > /tmp/basic_auth.ini <<'INI'
[mlflow]
default_permission = NO_PERMISSIONS
database_uri = sqlite:////mlflow/basic_auth.db
admin_username = admin
authorization_function = mlflow.server.auth:authenticate_request_basic_auth
grant_default_workspace_access = false
auth_cache_ttl_seconds = 60
INI
export MLFLOW_AUTH_CONFIG_PATH=/tmp/basic_auth.ini

# MLflow answers only to the names it is reached by: the public domain, the
# service name inside the Openship network, and the shared-svc-… name an app
# connected to it gets. Anything else is refused (403).
# Changes from a browser are taken only from the page at the public domain;
# without it MLflow takes them from localhost only, and its own pages fail.
hosts="mlflow,mlflow:5000,shared-svc-*,localhost:*,127.0.0.1:*"
origins="http://localhost:*"
public_host="${MLFLOW_PUBLIC_URL:-}"
public_host="${public_host#*://}"
public_host="${public_host%%/*}"
if [ -n "$public_host" ]; then
  hosts="$public_host,$hosts"
  origins="https://$public_host,$origins"
fi

exec mlflow server \
  --host 0.0.0.0 --port 5000 --workers 1 \
  --backend-store-uri sqlite:////mlflow/mlflow.db \
  --default-artifact-root /mlflow/artifacts --serve-artifacts \
  --app-name basic-auth \
  --allowed-hosts "$hosts" \
  --cors-allowed-origins "$origins"
