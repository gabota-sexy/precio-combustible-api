#!/bin/bash
# Dispara el scraper manualmente (async, no espera respuesta).
# Uso: ./run_scraper.sh
# Opcional: ./run_scraper.sh 2026-01-15   (backfill de una fecha específica)

FECHA=${1:-""}
if [ -n "$FECHA" ]; then
  PAYLOAD="{\"fecha\": \"$FECHA\"}"
else
  PAYLOAD="{}"
fi

echo "Disparando scraper con payload: $PAYLOAD"

aws lambda invoke \
  --function-name combustible-scraper-prod \
  --region sa-east-1 \
  --invocation-type Event \
  --payload "$PAYLOAD" \
  --cli-binary-format raw-in-base64-out \
  /dev/null

echo "Lanzado. Los logs en: https://sa-east-1.console.aws.amazon.com/cloudwatch/home?region=sa-east-1#logsV2:log-groups/log-group/\$252Faws\$252Flambda\$252Fcombustible-scraper-prod"
