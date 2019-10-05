## Williams Mobile Firebase Functions

In this repo, we have functions executed with Google Cloud that prepare:

1. Daily Messages - `getEvents`
2. Events - `getDailyMessages`
3. Dining - `getDiningInfo`

## Install
`npm install -g firebase-tools`

## Login
`firebase login`

## Upload functions
### All
`firebase deploy --only functions`
### A specific function (recommended)
`firebase deploy --only functions:[FUNCTION NAME]`