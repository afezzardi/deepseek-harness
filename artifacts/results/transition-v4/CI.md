# Fork CI configuration

The Issue Policy and Issue Lifecycle jobs require the upstream organization’s GitHub App credentials. The Cloudflare preview deploy requires its hosted project credentials. These three jobs run only when `github.event.repository.fork` is false; fork build, test, packaging, and artifact checks remain enabled.

The fork-artifacts workflow runs on every pull request and supports manual dispatch. It has no path filter because large upstream merges can exceed GitHub’s changed-file evaluation limit; see [workflow diff filtering](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#git-diff-comparisons). The first PR had no fork-artifacts run despite relevant changes; path filtering is a suspected cause, not an observed GitHub diagnostic.

The initial Issue Policy and Issue Lifecycle failures reported a missing GitHub App client ID. The initial Cloudflare preview built successfully and failed at upload because its API token was absent. These failures do not establish a code-test failure. YAML parsing and repository fork status were checked before publishing the conditions; actual job skipping and fork-artifacts execution require the subsequent GitHub run.
