#!/bin/sh
set -eu

: "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID is required for tusd S3 storage.}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY is required for tusd S3 storage.}"
: "${TUSD_S3_BUCKET:?TUSD_S3_BUCKET is required for tusd S3 storage.}"
: "${TUSD_S3_ENDPOINT:?TUSD_S3_ENDPOINT is required for tusd S3 storage.}"

export AWS_REGION="${AWS_REGION:-us-east-1}"
TUSD_BASE_PATH="${TUSD_BASE_PATH:-/files/}"
TUSD_PORT="${PORT:-8080}"
TUSD_S3_OBJECT_PREFIX="${TUSD_S3_OBJECT_PREFIX:-ingest/}"

exec tusd \
	-host 0.0.0.0 \
	-port "${TUSD_PORT}" \
	-base-path "${TUSD_BASE_PATH}" \
	-behind-proxy \
	-disable-download \
	-s3-bucket "${TUSD_S3_BUCKET}" \
	-s3-endpoint "${TUSD_S3_ENDPOINT}" \
	-s3-object-prefix "${TUSD_S3_OBJECT_PREFIX}"
