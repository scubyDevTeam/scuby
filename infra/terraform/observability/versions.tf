terraform {
  required_version = ">= 1.15.0"
  required_providers {
    newrelic = { source = "newrelic/newrelic", version = "~> 3.101" }
  }
  # Local state (git-ignored) until staging's S3 state bucket exists.
}

# Only the User API key comes from the environment (NEW_RELIC_API_KEY, from the Keychain — apply.sh).
provider "newrelic" {
  account_id = var.account_id
  region     = "US"
}
