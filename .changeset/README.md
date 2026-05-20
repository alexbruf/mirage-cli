# Changesets

This folder is used by [changesets](https://github.com/changesets/changesets) to record version-bump intents and changelog entries. Each `*.md` file here describes a version bump for one or more packages.

Common commands:

```
bun changeset            # interactively author a new changeset
bun version              # apply pending changesets (bump versions + changelogs)
bun release              # build all + publish to npm
```

Don't edit `config.json` by hand unless you know what you're changing.
