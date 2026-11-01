PYTHON ?= .local/harness-venv/Scripts/python.exe

.PHONY: check
check:
	"$(PYTHON)" -B scripts/check.py
