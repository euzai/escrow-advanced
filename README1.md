
# Escrow Advanced (PayTo-enabled)

This repository contains a production-ready ERC-721 escrow smart contract integrated with **PayTo** via an off-chain relayer.

- Contract uses **OpenZeppelin Contracts v5.x** imports (e.g., `utils/ReentrancyGuard.sol`). See OZ docs.  
- Hardhat project with tests and a Node.js relayer that calls **QuickStream PayTo** APIs based on emitted on-chain events.

## Why events + relayer?
Smart contracts cannot call HTTP or wait for webhooks directly. We emit **intent events** and a trusted relayer calls the PayTo APIs, then finalizes the transaction on-chain via role-gated functions. 

## Project layout
```
contracts/
  Escrow.sol
  mocks/TestERC721.sol
relayer/
  src/index.ts        # boots the service, event listeners
  src/payto.ts        # QuickStream API client
  src/webhook.ts      # Express router for provider webhooks
  src/abi/            # (optional) copy of Escrow ABI if not loading from artifacts
scripts/
  deploy.ts
 test/
  escrow.payto.test.ts
```

## Prerequisites
- Node.js 18+ (Hardhat 2.x) or Node 22+ (Hardhat 3).  
- pnpm / npm / yarn.

## Install & test
```bash
npm i
npm run compile
npm test
```

## Relayer service
Configure env vars in **relayer/.env** (see `.env.example`), then:
```bash
cd relayer
npm i
npm run build
npm start
```

The relayer listens to `PayToAgreementRequested` and `PayToPaymentRequested` events and calls the QuickStream endpoints. On payment webhook, it calls `confirmPayment()` to release the NFT to the buyer.

## Security notes
- Only `OPERATOR_ROLE` can call `confirmAgreement` / `confirmPayment`. Use a multisig or a locked-down service account.
- Consider adding allowlists, pausability, and/or rate-limiting at the relayer.

