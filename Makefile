PYTHON ?= python3
VENV := .venv
PY := $(VENV)/bin/python

.PHONY: install dev-api dev-web check ingest

install:
	$(PYTHON) -m venv $(VENV)
	$(PY) -m pip install -r apps/api/requirements.lock
	$(PY) -m pip install --no-deps -e apps/api
	npm ci

dev-api:
	$(PY) -m uvicorn flame_api.main:app --reload --host 127.0.0.1 --port 8000

dev-web:
	npm run dev:web

check:
	$(PY) -m pytest apps/api/tests
	npm run build

ingest:
	$(VENV)/bin/flame-ingest-psi --query combustion
