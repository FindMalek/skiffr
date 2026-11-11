# Security

Please do not open a public issue for a vulnerability.

Report it with GitHub private vulnerability reporting: open the [Security tab](https://github.com/FindMalek/skiffr/security) of this repository and choose "Report a vulnerability". You get a reply from the maintainer there, and the fix is coordinated in a private advisory before anything is published.

Include what you found, the smallest steps to reproduce it, and which part it touches (fill engine, extension token, api, dashboard).

## What counts

Anything that leaks or alters a user's data, or acts on a page without the user asking:

- the extension token reaching a web page or a content script
- a page making the extension fill sensitive fields (passwords, card numbers, one-time codes) or submit a form
- one user reading or changing another user's profile, answers or tokens
- the learning store keeping a value it is meant to skip
- prompt injection from a form or job post that makes the api return data it should not

## Supported versions

Skiffr is in early development. Only the latest `main` is supported.
