# People

Fills `author_email`, the reviewers' emails and the `people` collection.

The page shows every teammate the same way, with a name and photo from
`people/<email>`.

- **Who is a teammate:** a Slack user in our workspace with a Taxwire email.
- **GitHub logins to emails:** for a PR author or requested reviewer, read
  the PR's commits (`pull_request_read` `get_commits`): a commit by that login
  with a Taxwire email gives it; with only a `noreply` address, search Slack
  users by the commit's author name. No match leaves the email `null`.
- **Linear and calendar names to emails:** the same Slack user search, by
  name.

For each teammate email the brief names, `ArtifactData` `get` on
`people/<email>`. When it's missing or its `updated_at` is more than 30 days
old: take the name and profile photo from `slack_search_users` (detailed),
download the photo with `curl`, crop it square and scale it to 64×64 as a JPEG
(Python with Pillow; install it with `pip` if needed), and write
`{name, org: "Taxwire", photo: "data:image/jpeg;base64,…", updated_at}`.
When the photo can't be fetched or converted, write `photo: null`.
