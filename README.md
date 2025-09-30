
# Escrow Advanced (PayTo-enabled)

This repository contains a test **ERC-721 escrow smart contract** integrated with the **PayTo** payment APIs via a relayer service.

- The contract uses **OpenZeppelin Contracts v5.x** imports. (See OZ docs for more details.)
- It is a **Hardhat project** with tests that mock the relayer's function calls to the PayTo APIs based on emitted on-chain events.

---

## Why Events + Relayer?

Smart contracts cannot directly call HTTP endpoints or wait for webhooks. To integrate with off-chain payment systems like PayTo, we use an event-driven model:

1.  **Intent Events**: The smart contract emits **intent events** (like `PayToAgreementRequested` and `PayToPaymentRequested`) on-chain.
2.  **Relayer Service**: A dedicated off-chain service (the **relayer**) listens for these events.
3.  **API Interaction**: Upon detecting an event, the relayer calls the necessary PayTo APIs.
4.  **Finalisation**: The relayer then calls role-gated functions on the smart contract to finalise the transaction on-chain.

In this local testing environment, the **`escrow.payto.test.js`** script effectively acts as the relayer. The **operator signer** is used to simulate the relayer's actions by directly calling `confirmAgreement(...)` and `confirmPayment(...)` in response to the events, which allows for local testing of the contract's "happy path". The script completes when `confirmPayment()` is called to release the NFT to the buyer.

<img width="1890" height="606" alt="Event-Relayer-PayTo Flow Diagram" src="https://github.com/user-attachments/assets/484db5e6-ff6f-41d8-91a5-a0c0ed5e6912" />

---

## Project Layout
```
contracts/
  Escrow.sol
  TestERC721.sol
scripts/
  deploy.js
 tests/
  escrow.payto.test.js
```

## Prerequisites
- Node.js 18+ (Hardhat 2.x)  
- pnpm / npm / yarn

## Install & test
```bash
npm install @nomicfoundation/hardhat-toolbox
npm install @openzeppelin/contracts
npx hardhat compile
npx hardhat test
```

## Updates 20250930

1.  **Security Fix**: Added NFT refund mechanisms with timeouts (7 days for agreement, 30 days for payment).
2.  **Storage Optimisation**: Removed redundant string storage, saving ~100+ gas per operation.
3.  **Enhanced Validation**: Added checks for zero prices, empty strings, and correlation ID verification.
4.  **Enhanced State Management**: Added Refunded state and new functions for timeout-based refunds.
5.  **Emergency Admin Tools**: Added emergencyRefund() for stuck transactions
6.  **Comprehensive Testing**: Expanded from 1 test to 44 tests covering all edge cases. The comprehensive set of unit tests now covers the "Happy Path," input validation, access control, state transitions, and edge cases like timeouts and emergency refunds.
7.  **Gas Savings**:
- Reduced depositNFT gas by ~15k
- Reduced confirmAgreement gas by ~10k
- Optimized struct packing with uint64 timestamps
8.  **Other Changes**: Functions now require correlationIdRaw parameter for verification: `depositNFT(id, correlationIdRaw)` and `confirmAgreement(id, correlationIdRaw, agreementToken)`

## Test outcomes
<img width="904" height="979" alt="image" src="https://github.com/user-attachments/assets/8a751c3d-e3f3-4855-b030-e8d22e5bb25f" />
<img width="901" height="930" alt="image" src="https://github.com/user-attachments/assets/0654c935-ce00-413e-bd0d-f8d250d2b05c" />

******




