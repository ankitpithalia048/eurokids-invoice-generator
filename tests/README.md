End-to-end tests for Tagore Nagar invoice app

Prerequisites
- `curl` available on your system
- The Apps Script web app URL (set as environment variable `SCRIPT_URL`) or pass as first arg to the script

Quick manual run

1. Export the script URL to an env var (or replace `$SCRIPT_URL` in the script):

```bash
export SCRIPT_URL="https://script.google.com/macros/s/XXX/exec"
```

2. Run the e2e script:

```bash
bash run_e2e.sh
```

What the script does
- GET `action=nextNumber`
- GET `action=list`
- POST `action=save` with a sample invoice
- GET `action=list` to verify created invoice present
- POST `action=delete` to cleanup

Notes
- The script uses `curl` so it will work on macOS, Linux, and Windows with WSL or Git Bash.
- Adjust `SAMPLE_PAYLOAD` in `run_e2e.sh` if you need different test data.
