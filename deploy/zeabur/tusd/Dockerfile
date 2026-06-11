# Purpose: Deploys tusd as a stateless upload target that writes resumable uploads directly to S3-compatible storage.
# Governing docs:
# - deploy/production/README.md
# - docs/environment-and-deployment.md
# External references:
# - https://tus.github.io/tusd/getting-started/installation/
# - https://tus.github.io/tusd/storage-backends/aws-s3/
# Tests:
# - apps/demo/test/demo-api-app.test.mjs

FROM tusproject/tusd:v2.9.2

COPY start-tusd.sh /usr/local/bin/start-tusd.sh
RUN chmod 0755 /usr/local/bin/start-tusd.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/start-tusd.sh"]
