#!/bin/sh
set -eu
umask 077
# Keys are generated URL-safe secrets, never untrusted request data.
case "$S3_ACCESS_KEY$S3_SECRET_KEY" in *[!A-Za-z0-9_-]*) echo 'Use URL-safe alphanumeric S3 credentials' >&2; exit 1;; esac
printf '{"identities":[{"name":"wikitop","credentials":[{"accessKey":"%s","secretKey":"%s"}],"actions":["Admin","Read","List","Tagging","Write"]}]}' "$S3_ACCESS_KEY" "$S3_SECRET_KEY" > /tmp/wikitop-s3.json
exec weed server -dir=/data -s3 -s3.port=9000 -s3.config=/tmp/wikitop-s3.json
