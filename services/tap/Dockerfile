# Tap — AT Protocol firehose relay
# https://github.com/bluesky-social/indigo/blob/main/cmd/tap/README.md
#
# This Dockerfile is used by Railway to deploy Tap as a Docker service.
# All configuration is via environment variables set in the Railway dashboard.
FROM ghcr.io/bluesky-social/indigo/tap:latest

# Defaults — override in Railway dashboard / railway.toml env vars
ENV TAP_RELAY_HOST=wss://bsky.network \
    TAP_LOG_LEVEL=info \
    TAP_RETRY_TIMEOUT=60s

# TAP_ADMIN_PASSWORD must be set in Railway Variables (not here)
# TAP_FULL_NETWORK must NOT be set (we filter by collection in the filter engine)

EXPOSE 2480

# Data volume for Tap's internal state (sequence cursor, buffered events)
VOLUME ["/data"]
