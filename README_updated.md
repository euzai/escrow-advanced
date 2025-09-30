# Escrow Advanced (PayTo-enabled)

This repository contains a test ERC-721 escrow smart contract integrated
with **PayTo** payment APIs via a relayer service.

-   Contract uses **OpenZeppelin Contracts v5.x** imports. See OZ docs.\
-   Hardhat project with tests that mocks relayer that calls PayTo APIs
    based on emitted on-chain events.

## Why events + relayer?

`<img width="1890" height="606" alt="image" src="https://github.com/user-attachments/assets/484db5e6-ff6f-41d8-91a5-a0c0ed5e6912" />`{=html}

Smart contracts cannot call HTTP or wait for webhooks directly. We emit
**intent events** for a relayer to call the PayTo APIs, then finalise
the transaction on-chain via role-gated functions. In a local testing
environment, we don't have a live relayer service. The test script,
escrow.payto.test.js, effectively acts as the relayer. The Escrow
contract emits two key **intent events**:

PayToAgreementRequested and PayToPaymentRequested.

In a real-world scenario, a relayer would be listening for these events.
When an event is detected, the relayer would interact with the PayTo
APIs to process the payment agreement and confirmation.

In the test script in this repo, the operator signer is used to simulate
the relayer's actions. The lines

await escrow.connect(operator).confirmAgreement(...) and await
escrow.connect(operator).confirmPayment(...)

directly call the functions that the relayer would call in response to
the events, allowing you to test the contract's entire "happy path"
locally without needing a live relayer. Script is completed when it
calls `confirmPayment()` to release the NFT to the buyer.

## Project layout

    contracts/
      Escrow.sol
      TestERC721.sol
    scripts/
      deploy.js
     tests/
      escrow.payto.test.js

## Prerequisites

-   Node.js 18+ (Hardhat 2.x)\
-   pnpm / npm / yarn

## Install & test

``` bash
npm install @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
npx hardhat compile
npx hardhat test
```

## Updates 20250930:

Security Fix: Added NFT refund mechanisms with timeouts (7 days for
agreement, 30 days for payment)

Storage Optimisation: Removed redundant string storage, saving \~100+
gas per operation

Enhanced Validation: Added checks for zero prices, empty strings, and
correlation ID verification

Better State Management: Added Refunded state and new functions for
timeout-based refunds

Emergency Admin Tools: Added emergencyRefund() for stuck transactions

Comprehensive Testing: Expanded from 1 test to 44 tests covering all
edge cases. The comprehensive set of unit tests now covers the "Happy
Path," input validation, access control, state transitions, and edge
cases like timeouts and emergency refunds.

Gas Savings: - Reduced depositNFT gas by \~15k - Reduced
confirmAgreement gas by \~10k - Optimized struct packing with uint64
timestamps

Other Changes: Functions now require correlationIdRaw parameter for
verification: **depositNFT(id, correlationIdRaw)** and
**confirmAgreement(id, correlationIdRaw, agreementToken)**

## Test outcomes

`<img width="904" height="979" alt="image" src="https://github.com/user-attachments/assets/8a751c3d-e3f3-4855-b030-e8d22e5bb25f" />`{=html}
`<img width="901" height="930" alt="image" src="https://github.com/user-attachments/assets/0654c935-ce00-413e-bd0d-f8d250d2b05c" />`{=html}
