# Azure DevOps PR Review Notification Workflow
#
# Fetches open PRs created by you in an Azure DevOps project,
# identifies PRs with no reviewer responses, and outputs JSON
# for any whose review status has changed since the last run.
#
# Prerequisites:
#   - Azure CLI with the azure-devops extension installed
#   - Authenticated via `az login`
#
# Usage:
#   lobster run --file ado-pr-review-notify.lobster \
#     --args-json '{"org":"myorg","project":"myproject"}'
#
# Output:
#   JSON array of per-PR objects with review status and diff tracking.

name: ado-pr-review-notify
args:
  org:
    description: Azure DevOps organization name
  project:
    description: Azure DevOps project name

steps:
  - id: fetch
    run: >
      az repos pr list
      --creator me
      --status active
      --org "https://dev.azure.com/${org}"
      --project "${project}"
      --output json

  - id: check
    for_each: $fetch.json
    steps:
      - id: enrich
        pipeline: >
          compute
          recent='days_since(creationDate) < 30'
          unreviewed='length(reviewers) == 0 || every(reviewers, @.vote == 0)'
          reviewer_count='length(reviewers)'
          approved_count='count(reviewers, @.vote > 0)'
        stdin: $item.json

      - id: diff
        pipeline: "diff.last --key ado-pr-review:${org}/${project}#$item.json.pullRequestId"
        stdin: $enrich.json
        when: $enrich.json.recent == true && $enrich.json.unreviewed == true
