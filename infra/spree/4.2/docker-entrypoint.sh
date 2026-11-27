#!/bin/bash
# First boot: create + migrate the database, load Spree's default seeds
# (countries, zones, roles, store, admin user) and the spree_sample catalog.
# Later boots only run pending migrations. The scenario seed (orders in
# specific states, OAuth app) is run separately by scripts/spree-up.mjs.
set -euo pipefail
cd /app

# Drop the noisy Ruby 2.7 / FriendlyId warnings; never fails the pipeline.
quiet() { grep -v -i warn || true; }

rm -f tmp/pids/server.pid

if [[ "$*" == *"rails server"* ]]; then
  echo "[entrypoint] waiting for postgres..."
  for i in $(seq 1 60); do
    if ruby -rpg -e 'PG.connect(ENV.fetch("DATABASE_URL")).close' 2>/dev/null; then break; fi
    sleep 1
  done

  bin/rails db:create 2>&1 | quiet
  # The companion gem is bind-mounted at run time (the build only has its gemspec), so its
  # migrations are installed here; the task skips ones already copied.
  bin/rails railties:install:migrations FROM=spree_admin_native 2>&1 | quiet
  echo "[entrypoint] migrating..."
  bin/rails db:migrate 2>&1 | quiet | tail -n 3

  # Spree's migrations already insert a default store, so "seeded" is judged by
  # countries (db:seed) and products (sample data) instead.
  counts="$(bin/rails runner 'puts "SEED_STATE=#{Spree::Country.count}:#{Spree::Product.count}"' 2>/dev/null | grep '^SEED_STATE=' | cut -d= -f2)"
  if [ "${counts%%:*}" = "0" ]; then
    echo "[entrypoint] loading Spree default seeds..."
    AUTO_ACCEPT=1 ADMIN_EMAIL="${ADMIN_EMAIL:-admin@example.com}" ADMIN_PASSWORD="${ADMIN_PASSWORD:-spree123}" \
      bin/rails db:seed 2>&1 | quiet | tail -n 2
  fi
  if [ "${counts##*:}" = "0" ]; then
    echo "[entrypoint] loading spree_sample data (takes ~1-2 min)..."
    bin/rails spree_sample:load 2>&1 | quiet | tail -n 2
  fi
  echo "[entrypoint] database ready (countries:products before boot = ${counts})"
fi

exec "$@"
