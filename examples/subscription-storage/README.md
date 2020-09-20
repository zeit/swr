# Subscription - Storage

## One-Click Deploy

Deploy your own SWR project with Vercel.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/project?template=https://github.com/vercel/swr/tree/master/examples/subscription-storage)

## How to Use

Download the example:

```bash
curl https://codeload.github.com/vercel/swr/tar.gz/master | tar -xz --strip=2 swr-master/examples/subscription-storage
cd subscription-storage
```

Install it and run:

```bash
yarn
yarn dev
# or
npm install
npm run dev
```

Deploy it to the cloud with [now](https://vercel.com/home) ([download](https://vercel.com/download))

```
now
```

## The Idea behind the Example

Show how to use SWR to read a value from localStorage and use subscription to get changes to the same key from another tab in real-time.
