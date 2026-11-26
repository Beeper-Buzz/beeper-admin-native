# syntax=docker/dockerfile:1.7
#
# Vanilla upstream Spree 4.2.7 (+ spree_auth_devise 4.3.4, spree_gateway 3.9.4)
# on Rails 6.1.7.10 / Ruby 2.7.8, Postgres. Development environment on purpose:
# no asset precompile, no SSL, readable errors. This image is a test fixture,
# not a production deployment.
#
# Build through infra/spree/docker-compose.yml (or scripts/spree-up.mjs).
#
# Optional build inputs (only needed behind a TLS-intercepting proxy):
#   build arg  http_proxy / https_proxy   CONNECT proxy for rubygems.org
#   secret     build_ca                   PEM bundle to trust during the build
# Neither ends up in the image.

ARG IMAGE_REGISTRY=mirror.gcr.io/library

# Node is only needed as an ExecJS runtime (autoprefixer-rails, pulled in by
# bootstrap 4 in spree_frontend). Copying the binary avoids apt entirely:
# Debian bullseye is EOL and its security pool now 404s on deb.debian.org.
FROM ${IMAGE_REGISTRY}/node:18-bullseye-slim AS node

# Spree 4.2 cannot boot without a database (Spree::User reads a preference
# from spree_preferences at class load), so the generators below need a live
# Postgres during the build. Its binaries are bind-mounted from this stage for
# that one RUN step only; nothing from it ends up in the final image.
FROM ${IMAGE_REGISTRY}/postgres:13-bullseye AS pg

FROM ${IMAGE_REGISTRY}/ruby:2.7.8-bullseye

COPY --from=node /usr/local/bin/node /usr/local/bin/node

ENV LANG=C.UTF-8 \
    RAILS_ENV=development \
    BUNDLE_JOBS=8 \
    BUNDLE_SILENCE_ROOT_WARNING=1

# RubyGems 3.4.22 / Bundler 2.4.22 are the last releases that support Ruby 2.7.
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    gem update --system 3.4.22 --no-document && \
    gem install bundler:2.4.22 rails:6.1.7.10 --no-document

# Skeleton app. RUBYOPT=-rlogger works around concurrent-ruby >= 1.3.5 no
# longer requiring 'logger' (Rails 6.1 crashes at load without it); inside the
# bundle the Gemfile pins concurrent-ruby 1.3.4 instead.
RUN cd / && RUBYOPT=-rlogger rails _6.1.7.10_ new app \
      --database=postgresql --skip-bundle --skip-git --skip-javascript \
      --skip-webpack-install --skip-spring --skip-bootsnap --skip-test \
      --skip-system-test --skip-action-cable --skip-action-mailbox \
      --skip-action-text --skip-turbolinks > /dev/null

WORKDIR /app

# The companion gem comes from the `gem` build context (gems/spree_admin_native). Only what
# Bundler and railties:install:migrations need is copied, so gem code edits don't rebuild;
# compose bind-mounts the full gem at runtime.
COPY --from=gem spree_admin_native.gemspec /gems/spree_admin_native/
COPY --from=gem lib/spree_admin_native/version.rb /gems/spree_admin_native/lib/spree_admin_native/
COPY --from=gem db /gems/spree_admin_native/db
COPY Gemfile Gemfile.lock ./
RUN --mount=type=secret,id=build_ca,required=false \
    if [ -s /run/secrets/build_ca ]; then export SSL_CERT_FILE=/run/secrets/build_ca; fi; \
    bundle install && rm -rf /usr/local/bundle/cache

# Spree generators, run against a throwaway Postgres that lives only for this
# step. Seeds and sample data are NOT loaded here (they would be lost with the
# throwaway DB); the entrypoint migrates and seeds the real database on first boot.
RUN --mount=type=bind,from=pg,source=/usr/lib/postgresql,target=/usr/lib/postgresql \
    --mount=type=bind,from=pg,source=/usr/share/postgresql,target=/usr/share/postgresql \
    set -e; \
    run() { "$@" > /tmp/step.log 2>&1 || { grep -v -i warn /tmp/step.log | grep -v -E "^\s*(from )?/usr/local" | tail -n 40; exit 1; }; }; \
    PGBIN=/usr/lib/postgresql/13/bin; \
    useradd -M pgbuild; mkdir -p /tmp/pg; chown pgbuild /tmp/pg; \
    su pgbuild -s /bin/sh -c "$PGBIN/initdb -D /tmp/pg/data -A trust -U postgres > /dev/null && \
      $PGBIN/pg_ctl -D /tmp/pg/data -o '-k /tmp/pg -c listen_addresses=' -w start > /dev/null"; \
    export PGHOST=/tmp/pg PGUSER=postgres; \
    su pgbuild -s /bin/sh -c "$PGBIN/createdb -h /tmp/pg -U postgres app_development"; \
    run bin/rails g spree:install --user_class=Spree::User --migrate=false \
      --seed=false --sample=false --auto-accept; \
    run bin/rails g spree:auth:install --migrate=false; \
    run bin/rails railties:install:migrations; \
    # Generators stamp migrations with the build time; renumber them in order so a rebuilt
    # image matches a database migrated by an earlier build.
    i=0; for f in $(ls db/migrate | sort); do i=$((i+1)); \
      mv "db/migrate/$f" "db/migrate/$(printf '2020010100%04d' $i)_${f#*_}"; done; \
    su pgbuild -s /bin/sh -c "$PGBIN/pg_ctl -D /tmp/pg/data -m fast -w stop > /dev/null"; \
    rm -rf /tmp/pg /tmp/step.log tmp/cache/*; userdel pgbuild; \
    test -f config/initializers/devise.rb; \
    ls db/migrate | grep -q spree_auth; ls db/migrate | grep -q spree_gateway; \
    echo "migrations: $(ls db/migrate | wc -l)"

# Accept any Host header (phones on the LAN, other containers), log to stdout,
# run jobs inline (concurrent :async job threads compiling SassC assets for
# order mails segfault libsass) and never try to deliver mail.
RUN sed -i 's/^end$//' config/environments/development.rb && \
    printf '%s\n' \
      '  config.hosts.clear' \
      '  config.active_job.queue_adapter = :inline' \
      '  config.action_mailer.perform_deliveries = false' \
      '  config.logger = ActiveSupport::Logger.new($stdout)' \
      '  config.log_level = ENV.fetch("RAILS_LOG_LEVEL", "info").to_sym' \
      'end' >> config/environments/development.rb

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["bin/rails", "server", "-b", "0.0.0.0", "-p", "3000"]
