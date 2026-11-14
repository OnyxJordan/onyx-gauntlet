# The block that tells GitHub to publish

Goes at the end of the Retool workflow **gauntlet-refresh**, after `query1`
writes the snapshot. The moment new standings exist, this starts the publish.

## Why it is a resource query and not a Code block

A Code block cannot do it. Retool Workflows' JavaScript runtime has no `fetch`,
so a Code block fails with `ReferenceError: fetch is not defined`. HTTP calls in
Retool go through a REST API resource, which is what this uses. Python is not a
way around it either; the resource is the supported path.

## The resource

Already created: **GitHub publish (onyx-gauntlet)**, base URL
`https://api.github.com`, with the GitHub headers set. It is missing only the
token, because a token cannot be created on anyone's behalf.

https://retoolonyx.retool.com/resources/d0a1a8c4-6379-4897-8519-f6620128df2e

Add one header there and save:

| Key | Value |
|---|---|
| `Authorization` | `Bearer ` followed by the token, one space after Bearer |

The token is a GitHub fine-grained personal access token for
`OnyxJordan/onyx-gauntlet` with **Actions: Read and write**. See SETUP.md stage
5a. Keeping it on the resource rather than in the workflow means it is stored
once and never shows up in a run log.

## The block

In `gauntlet-refresh`, add a block, choose **GitHub publish (onyx-gauntlet)**:

| Field | Value |
|---|---|
| Method | `POST` |
| URL | `/repos/OnyxJordan/onyx-gauntlet/actions/workflows/publish.yml/dispatches` |
| Body | **Raw JSON**: `{"ref": "main"}` |

Nothing else. No query parameters, no headers on the block itself.

Then **Publish release**. An unpublished workflow keeps running the old version.

## What success looks like

GitHub answers **204** with an empty body. An empty response is correct here and
does not mean the call failed.

| Status | What is wrong |
|---|---|
| 201 or 200 | Wrong URL. A dispatch returns 204 |
| 401 | Token wrong, expired, or `Bearer ` prefix missing |
| 403 | Token lacks Actions "Read and write" |
| 404 | Token cannot see the repository, so repository access was not set to it |
| 422 | The `ref` is wrong. It must be `main` |

Press **Run** at the top of `gauntlet-refresh` and a `publish` run should appear
within seconds at https://github.com/OnyxJordan/onyx-gauntlet/actions

## Note

The GitHub cron stays switched on as a backstop. Being triggered twice is
harmless: a publish that finds the standings unchanged commits nothing.
