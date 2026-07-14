# The object detector I Spy plays with -- 14MB of wasm and weights, pinned by
# SHA-256 in the script and fetched rather than committed. A stage of its own, so
# that curl and its CA bundle stay in the builder: the thing we ship should be
# able to fetch nothing.
FROM python:3.13-slim AS detector
RUN apt-get update \
  && apt-get install -y --no-install-recommends curl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY scripts/fetch-detector.sh /scripts/fetch-detector.sh
RUN /scripts/fetch-detector.sh


FROM python:3.13-slim

# A numeric UID, so a runtime enforcing "must not run as root" can check it
# without a passwd lookup.
RUN useradd --uid 10001 --no-create-home --system waiting-games

COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

WORKDIR /app
COPY waiting_games /app/waiting_games

# ...and the detector, on top of the static tree it is served from. Last, because
# it is the layer that never changes: the source above it changes every commit.
COPY --from=detector /waiting_games/static/vendor /app/waiting_games/static/vendor

# The version is stamped in at build time, because it is not knowable from inside
# the source tree: semantic-release decides it from the commits, AFTER this repo
# has been written. pyproject.toml says 0.0.0 for exactly the same reason.
#
# The default is "dev", which is what a checkout should say -- and a deployed
# image that somehow says "dev" is telling you its build was wrong, which is more
# use than a confident lie.
ARG VERSION=dev
ENV APP_VERSION=${VERSION}

# Bake the bytecode now, so the image still works with a read-only root
# filesystem, where Python could not write __pycache__ on import.
RUN python -m compileall -q /app/waiting_games

USER 10001
EXPOSE 8080

CMD ["uvicorn", "waiting_games.main:app", "--host", "0.0.0.0", "--port", "8080"]
