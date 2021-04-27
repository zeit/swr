# SWR Contribution Guidelines

Thank you for reading this guide and we appreciate any contribution.

## Ask a Question

You can use the repository's [Discussions](https://github.com/vercel/swr/discussions) page to ask any questions, post feedback or share your experience on how you use this library.

## Report a Bug

Whenever you find something which is not working properly, please first search the repository's [Issues](https://github.com/vercel/swr/issues) page and make sure it's not reported by someone else already.

If not, feel free to open an issue with the detailed description of the problem and the expected behavior. And reproduction (for example a [CodeSandbox](https://codesandbox.io) link) will be extremely helpful.

## Request for a New Feature

For new features, it would be great to have some discussions from the community before starting working on it. You can either create an issue (if there isn't one) or post a thread in the [Discussions](https://github.com/vercel/swr/discussions) page to describe the feature that you want to have.

If possible, you can add other additional context like how this feature can be implemented technically, what other alternative solutions we can have, etc.

## Open a PR for Bugfix or Feature

### Local Development

To develop SWR locally, you can use the Vite SWR playground to play with the source code inside the browser. You can follow these steps:

```bash
yarn install
yarn register
yarn build
yarn prepare:vite
yarn dev:vite
```

To test SSR related features, you need to use the Next.js SWR playground instead:

```bash
yarn install
yarn register
yarn build
yarn prepare:next
yarn dev:next
```

## Update Documentation

To update the [SWR Documentation](https://swr.vercel.app), you can contribute to the [website repository](https://github.com/vercel/swr-site).
