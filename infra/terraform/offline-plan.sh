#!/bin/sh
# Plans the whole configuration without an AWS account: placeholder credentials, a throwaway local
# state, and offline.tfvars. Nothing is read from AWS and nothing can be applied. Used by continuous
# integration and by anyone reviewing a change:
#   ./offline-plan.sh            (needs terraform on the path)
set -eu
cd "$(dirname "$0")"

cleanup() { rm -rf backend_override.tf offline.tfstate offline.tfstate.backup; }
trap cleanup EXIT

printf 'terraform {\n  backend "local" {\n    path = "offline.tfstate"\n  }\n}\n' > backend_override.tf
export AWS_ACCESS_KEY_ID=placeholder AWS_SECRET_ACCESS_KEY=placeholder

terraform init -reconfigure -input=false >/dev/null
terraform plan -var-file=offline.tfvars -input=false -lock=false -no-color "$@"
