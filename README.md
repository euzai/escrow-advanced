
# Escrow Advanced (PayTo-enabled)

This repository contains a production-ready ERC-721 escrow smart contract integrated with **PayTo** via an off-chain relayer.

- Contract uses **OpenZeppelin Contracts v5.x** imports (e.g., `utils/ReentrancyGuard.sol`). See OZ docs.  
- Hardhat project with tests that mocks relayer that calls PayTo APIs based on emitted on-chain events.

## Why events + relayer?

<img width="1890" height="606" alt="image" src="https://github.com/user-attachments/assets/484db5e6-ff6f-41d8-91a5-a0c0ed5e6912" />

sequenceDiagram
    autonumber
    participant Seller
    participant Escrow as Escrow Contract
    participant Relayer
    participant QuickStream as QuickStream PayTo APIs
    participant Bank as Payer Bank (MMS)
    participant Buyer

    Seller->>Escrow: openEscrow(buyer, nft, tokenId, price, correlationId)
    Seller->>Escrow: depositNFT(id)
    Escrow-->>Relayer: Event PayToAgreementRequested(id, correlationId)
    Relayer->>QuickStream: POST /customers/{id}/payto-agreements
    QuickStream-->>Bank: Notify Agreement for Authorization
    Bank-->>QuickStream: Agreement Authorized
    Relayer->>Escrow: confirmAgreement(id, agreementToken)
    Escrow-->>Relayer: Event PayToPaymentRequested(id, correlationId, agreementToken)
    Relayer->>QuickStream: POST /transactions (endToEndId=correlationId, agreementToken)
    QuickStream-->>Relayer: Payment webhook (success)
    Relayer->>Escrow: confirmPayment(id, receipt, amount, "AUD")
    Escrow->>Buyer: safeTransferFrom(NFT)​

Smart contracts cannot call HTTP or wait for webhooks directly. We emit **intent events** for a relayer to call the PayTo APIs, then finalise the transaction on-chain via role-gated functions. 
In a local testing environment, we don't have a live relayer service. The test script, escrow.payto.test.js, effectively acts as the relayer.
The Escrow contract emits two key **intent events**: 
PayToAgreementRequested and 
PayToPaymentRequested. 
In a real-world scenario, a relayer would be listening for these events. When an event is detected, the relayer would interact with the PayTo APIs to process the payment agreement and confirmation.

In the test script in this repo, the operator signer is used to simulate the relayer's actions. The lines 
await escrow.connect(operator).confirmAgreement(...) and 
await escrow.connect(operator).confirmPayment(...) 
directly call the functions that the relayer would call in response to the events, allowing you to test the contract's entire "happy path" locally without needing a live relayer.
Script is completed when it calls `confirmPayment()` to release the NFT to the buyer.



## Project layout
```
contracts/
  Escrow.sol
  TestERC721.sol
scripts/
  deploy.js
 test/
  escrow.payto.test.js
```

## Prerequisites
- Node.js 18+ (Hardhat 2.x)  
- pnpm / npm / yarn.

## Install & test
```bash
npm i
npm run compile
npm test
```
## Security notes
- Only `OPERATOR_ROLE` can call `confirmAgreement` / `confirmPayment`. Use a multisig or a locked-down service account.
- Consider adding allowlists, pausability, and/or rate-limiting at the relayer.

