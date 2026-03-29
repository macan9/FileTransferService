#!/usr/bin/env bash
set -euo pipefail

SERVER_USER="root"
SERVER_HOST="139.196.158.225"
SERVER_PORT="22"

LOCAL_DIR="/mnt/e/DevProjects/FileTransferService/"
REMOTE_DIR="/srv/file-transfer-service/current"
REQUIRED_NODE_VERSION="20.19.0"
NPM_REGISTRY="${NPM_REGISTRY:-}"
DEPLOY_MODE="${1:-fast}"
SSH_CONTROL_PATH="/tmp/file-transfer-service-deploy-%r@%h:%p"
SSH_OPTS=(
  -p "${SERVER_PORT}"
  -o ControlMaster=auto
  -o ControlPersist=10m
  -o "ControlPath=${SSH_CONTROL_PATH}"
)

resolve_local_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi

  if command -v node.exe >/dev/null 2>&1; then
    command -v node.exe
    return 0
  fi

  if command -v npm >/dev/null 2>&1; then
    local npm_path
    local npm_dir

    npm_path="$(command -v npm)"
    npm_dir="$(cd "$(dirname "${npm_path}")" && pwd)"

    if [ -x "${npm_dir}/node.exe" ]; then
      printf '%s\n' "${npm_dir}/node.exe"
      return 0
    fi
  fi

  return 1
}

check_node_version() {
  local version="$1"
  local min_version="$2"
  local label="$3"

  version="${version#v}"

  if ! printf '%s\n%s\n' "${min_version}" "${version}" | sort -V -C; then
    echo "${label} Node.js version ${version} is lower than required ${min_version}."
    exit 1
  fi
}

print_usage() {
  cat <<'EOF'
Usage:
  ./deploy.sh        Fast deploy: sync, build, restart
  ./deploy.sh pro    Full deploy: sync, install dependencies, build, restart
EOF
}

cleanup_ssh_control() {
  ssh -O exit "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" >/dev/null 2>&1 || true
}

run_remote_prepare_and_migrate() {
  local install_dependencies="$1"

  ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" "bash -lc 'bash -s'" <<EOF
set -euo pipefail

cd "${REMOTE_DIR}"
echo "Remote node binary: \$(command -v node)"
echo "Remote npm binary: \$(command -v npm)"
echo "Remote npx binary: \$(command -v npx)"
echo "Remote Node.js: \$(node -v)"
echo "Using npm registry: \$(npm config get registry)"

if [ "${install_dependencies}" = "true" ]; then
  npm ci --no-audit --fund=false
else
  if [ ! -d node_modules ]; then
    echo "Remote node_modules not found. Run ./deploy.sh pro to install dependencies first."
    exit 1
  fi
fi

npm run build

DB_STATE="\$(python3 - <<'PY'
from pathlib import Path
import sqlite3

db_path = Path('dev.db')
if not db_path.exists():
    print('missing|missing|missing')
    raise SystemExit(0)

conn = sqlite3.connect(str(db_path))
cur = conn.cursor()

def has_table(name: str) -> bool:
    cur.execute(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
        (name,),
    )
    return cur.fetchone() is not None

def has_column(table: str, column: str) -> bool:
    if not has_table(table):
        return False
    cur.execute(f'PRAGMA table_info({table})')
    return any(row[1] == column for row in cur.fetchall())

file_record = 'present' if has_table('FileRecord') else 'missing'
migrations = 'present' if has_table('_prisma_migrations') else 'missing'
deleted_at = 'present' if has_column('FileRecord', 'deletedAt') else 'missing'

print(f'{file_record}|{migrations}|{deleted_at}')
conn.close()
PY
)"

IFS='|' read -r FILE_RECORD_STATE MIGRATIONS_STATE DELETED_AT_STATE <<< "\${DB_STATE}"
echo "Remote DB state: FileRecord=\${FILE_RECORD_STATE}, _prisma_migrations=\${MIGRATIONS_STATE}, deletedAt=\${DELETED_AT_STATE}"

if [ "\${FILE_RECORD_STATE}" = "present" ] && [ "\${MIGRATIONS_STATE}" = "missing" ]; then
  echo "Detected baseline database without Prisma migration history. Resolving existing migrations..."
  npx prisma migrate resolve --applied 20260327112021_init

  if [ "\${DELETED_AT_STATE}" = "present" ]; then
    npx prisma migrate resolve --applied 20260329164330_add_deleted_at_to_file_record
  fi
fi

npx prisma migrate deploy
EOF
}

case "${DEPLOY_MODE}" in
  fast)
    INSTALL_DEPENDENCIES="false"
    ;;
  pro)
    INSTALL_DEPENDENCIES="true"
    ;;
  -h|--help|help)
    print_usage
    exit 0
    ;;
  *)
    echo "Unknown deploy mode: ${DEPLOY_MODE}"
    print_usage
    exit 1
    ;;
esac

echo "[0/4] Checking local Node.js version..."
LOCAL_NODE_BIN="$(resolve_local_node)" || {
  echo "Local Node.js was not found in the current shell."
  echo "Make sure WSL can access Node.js, or install Node.js ${REQUIRED_NODE_VERSION}+ in WSL."
  exit 1
}
LOCAL_NODE_VERSION="$("${LOCAL_NODE_BIN}" -v)"
echo "Local Node.js binary: ${LOCAL_NODE_BIN}"
echo "Local Node.js: ${LOCAL_NODE_VERSION}"
echo "Deploy mode: ${DEPLOY_MODE}"
check_node_version "${LOCAL_NODE_VERSION}" "${REQUIRED_NODE_VERSION}" "Local"

echo "[0.5/4] Establishing shared SSH connection..."
trap cleanup_ssh_control EXIT
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" "bash -lc 'true'"

echo "[1/4] Sync project files to server..."
rsync -avz --delete \
  -e "ssh ${SSH_OPTS[*]}" \
  --exclude ".git" \
  --exclude ".gitignore" \
  --exclude "node_modules" \
  --exclude "dist" \
  --exclude "uploads" \
  --exclude "dev.db" \
  --exclude ".env" \
  --exclude "server.out.log" \
  --exclude "server.err.log" \
  "${LOCAL_DIR}" \
  "${SERVER_USER}@${SERVER_HOST}:${REMOTE_DIR}"

echo "[2/4] Checking remote Node.js version..."
REMOTE_NODE_VERSION="$(
  ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
    "bash -lc 'node -v'"
)"
echo "Remote Node.js: ${REMOTE_NODE_VERSION}"
check_node_version "${REMOTE_NODE_VERSION}" "${REQUIRED_NODE_VERSION}" "Remote"

echo "[3/4] Prepare app and build on server..."
if [ -n "${NPM_REGISTRY}" ]; then
  echo "Configuring remote npm registry: ${NPM_REGISTRY}"
  ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
    "bash -lc 'cd ${REMOTE_DIR} && npm config set registry \"${NPM_REGISTRY}\"'"
fi

if [ "${INSTALL_DEPENDENCIES}" = "true" ]; then
  echo "Running full dependency install on remote server..."
  run_remote_prepare_and_migrate "true"
else
  echo "Skipping dependency install. Building with existing remote node_modules..."
  run_remote_prepare_and_migrate "false"
fi

echo "[4/4] Restart service with pm2..."
ssh "${SSH_OPTS[@]}" "${SERVER_USER}@${SERVER_HOST}" \
  "bash -lc 'set -e; cd ${REMOTE_DIR}; pm2 startOrReload ecosystem.config.js --update-env'"

echo "Deployment finished."
echo "Check app locally on server: http://127.0.0.1:3100"
