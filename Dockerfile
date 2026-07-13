FROM python:3.13-slim

# A numeric UID, so a runtime enforcing "must not run as root" can check it
# without a passwd lookup.
RUN useradd --uid 10001 --no-create-home --system waiting-games

COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir -r /requirements.txt

WORKDIR /app
COPY waiting_games /app/waiting_games

# Bake the bytecode now, so the image still works with a read-only root
# filesystem, where Python could not write __pycache__ on import.
RUN python -m compileall -q /app/waiting_games

USER 10001
EXPOSE 8080

CMD ["uvicorn", "waiting_games.main:app", "--host", "0.0.0.0", "--port", "8080"]
