#!/usr/bin/env bash
# Simple curl-based E2E test for Tagore Nagar Apps Script
# Usage: SCRIPT_URL="https://script.google.com/macros/s/..../exec" bash run_e2e.sh

SCRIPT_URL=${SCRIPT_URL:-$1}
if [ -z "$SCRIPT_URL" ]; then
  echo "Usage: SCRIPT_URL=... bash run_e2e.sh"
  exit 1
fi

echo "1) nextNumber"
curl -s -G "$SCRIPT_URL" --data-urlencode "action=nextNumber" | jq .

echo "\n2) list (before)"
curl -s -G "$SCRIPT_URL" --data-urlencode "action=list" | jq .

# Sample invoice payload
SAMPLE_PAYLOAD='{"invoice": {"invNumber":"TEST-$(date +%s)","date":"2026-06-15","program":"training","student":"E2E Tester","candidateAge":"25","contact":"9876543210","fees":[{"label":"Course Fee","amount":1000}],"payments":[{"date":"2026-06-15","amount":1000,"mode":"Cash","ref":"tx01"}],"academicYear":"2026-2027"}}'

echo "\n3) save (create)"
curl -s -X POST -H "Content-Type: text/plain;charset=utf-8" --data "$SAMPLE_PAYLOAD" "$SCRIPT_URL" | jq .

echo "\n4) list (after)"
curl -s -G "$SCRIPT_URL" --data-urlencode "action=list" | jq .

# Try to delete the test invoice by receiptNumber (use grep to find TEST-)
INVNO=$(curl -s -G "$SCRIPT_URL" --data-urlencode "action=list" | jq -r '.data.invoices[]?.receiptNumber | select(test("TEST-"))' | head -n1)
if [ -n "$INVNO" ]; then
  echo "\n5) delete $INVNO"
  curl -s -X POST -H "Content-Type: text/plain;charset=utf-8" --data "{\"action\":\"delete\",\"invNumber\":\"$INVNO\"}" "$SCRIPT_URL" | jq .
else
  echo "No test invoice found to delete."
fi
