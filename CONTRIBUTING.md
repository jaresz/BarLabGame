# Contributing

Thanks for helping improve Bar Lab. Before opening a pull request:

1. Describe the user-visible change and keep the interface and project documentation in English.
2. Run `npm test` and `npm run build`. For browser-facing changes, also run `npm run test:browser`.
3. If the application changes, increment `GAME_VERSION` in `src/model.ts` so the status bar and exported metadata stay in sync.
4. If the appearance changes, refresh the screenshots with `npm run screenshots` and include the updated images and animations. The command attempts a real Android capture when an authorized ADB device is available; its absence does not block the contribution, and the next documentation update should retry it.
5. Summarize the change and checks in the pull request.

See the [Development Guide](docs/development.md) for setup, code navigation, build output, and screenshot details. See the [Player Guide](docs/user-guide.md) for application behavior.
