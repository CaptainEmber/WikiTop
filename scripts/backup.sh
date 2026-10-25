#!/usr/bin/env bash
set -euo pipefail
backup_dir=${1:?Usage: scripts/backup.sh /absolute/backup-directory}
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"
for service in play-db wiki-db auth-db; do
  case "$service" in play-db) db_user=wikitop; db_name=wikitop;; wiki-db) db_user=wiki; db_name=wiki;; auth-db) db_user=keycloak; db_name=keycloak;; esac
  docker compose exec -T "$service" pg_dump -U "$db_user" -d "$db_name" -Fc > "$backup_dir/$service.dump"
done
# SeaweedFS is the only writer to this volume. Stop it while taking a consistent asset copy.
docker compose stop storage
trap 'docker compose start storage >/dev/null' EXIT
container_id=$(docker compose ps -aq storage)
docker cp "$container_id:/data" "$backup_dir/assets"
echo 'Backed up databases and asset data. Back up your .env separately in encrypted storage.'
