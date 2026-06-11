# Secrets

Credentials are never committed to this repo. They live in the deployment
platform's environment settings (Vercel / AWS) and locally in untracked .env files.

The credential registry that used to sit here was removed from the entire git
history on 2026-06-11 because it leaked live keys. All keys it held were rotated.
