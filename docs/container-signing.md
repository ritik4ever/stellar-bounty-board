# Verifying published container images

Published GHCR images are keylessly signed with cosign using GitHub Actions OIDC.

Install [cosign](https://docs.sigstore.dev/cosign/system_config/installation/), then verify an image:

```sh
cosign verify \
  --certificate-identity-regexp='https://github.com/ritik4ever/stellar-bounty-board/.github/workflows/docker-publish.yml@refs/(heads/main|tags/v.*)' \
  --certificate-oidc-issuer='https://token.actions.githubusercontent.com' \
  ghcr.io/ritik4ever/stellar-bounty-board:<tag>