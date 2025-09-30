const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// Define State constants for readability in new test cases
const State = {
    None: 0,
    Opened: 1,
    NftDeposited: 2,
    AgreementConfirmed: 3,
    Paid: 4,
    Cancelled: 5,
    Refunded: 6,
};

describe("Escrow x PayTo", function () {
  let seller, buyer, operator, admin, other;
  let nft, escrow;
  let tokenId = 1n;
  const correlation = "INV-123456790";
  const agreementToken = "C01791640642293";
  const priceCents = 100_000; // $1000.00

  beforeEach(async function () {
    [admin, seller, buyer, operator, other] = await ethers.getSigners();

    // Deploy NFT
    const NFT = await ethers.getContractFactory("TestERC721");
    nft = await NFT.connect(seller).deploy();
    await nft.waitForDeployment();

    // Mint to seller
    await nft.connect(seller).mint(seller.address);

    // Deploy Escrow
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.connect(admin).deploy(operator.address);
    await escrow.waitForDeployment();
  });

  describe("Happy Path", function () {
    it("should complete full escrow flow", async function () {
      // Open escrow
      await expect(
        escrow.connect(seller).openEscrow(
          buyer.address,
          await nft.getAddress(),
          tokenId,
          priceCents,
          correlation
        )
      ).to.emit(escrow, "EscrowOpened");

      // Approve and deposit NFT
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await expect(escrow.connect(seller).depositNFT(1, correlation))
        .to.emit(escrow, "NftDeposited")
        .and.to.emit(escrow, "PayToAgreementRequested");

      expect(await nft.ownerOf(tokenId)).to.equal(await escrow.getAddress());

      // Confirm agreement
      await expect(
        escrow.connect(operator).confirmAgreement(1, correlation, agreementToken)
      )
        .to.emit(escrow, "AgreementConfirmed")
        .and.to.emit(escrow, "PayToPaymentRequested");

      // Confirm payment
      await expect(
        escrow.connect(operator).confirmPayment(1, "RXN-1234567890", priceCents, "AUD")
      )
        .to.emit(escrow, "PaymentConfirmed")
        .and.to.emit(escrow, "NftReleased");

      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
      
      const deal = await escrow.getDeal(1);
      expect(deal.state).to.equal(State.Paid);
    });
  });

  describe("Input Validation", function () {
    it("should reject zero buyer address", async function () {
      await expect(
        escrow.connect(seller).openEscrow(
          ethers.ZeroAddress,
          await nft.getAddress(),
          tokenId,
          priceCents,
          correlation
        )
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should reject zero NFT address", async function () {
      await expect(
        escrow.connect(seller).openEscrow(
          buyer.address,
          ethers.ZeroAddress,
          tokenId,
          priceCents,
          correlation
        )
      ).to.be.revertedWithCustomError(escrow, "ZeroAddress");
    });

    it("should reject zero price", async function () {
      await expect(
        escrow.connect(seller).openEscrow(
          buyer.address,
          await nft.getAddress(),
          tokenId,
          0,
          correlation
        )
      ).to.be.revertedWithCustomError(escrow, "InvalidPrice");
    });

    it("should reject empty correlation ID", async function () {
      await expect(
        escrow.connect(seller).openEscrow(
          buyer.address,
          await nft.getAddress(),
          tokenId,
          priceCents,
          ""
        )
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
    });

    it("should reject empty agreement token", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(operator).confirmAgreement(1, correlation, "")
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
    });
  });

  describe("Access Control", function () {
    it("should reject deposit from non-seller", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      
      await expect(
        escrow.connect(other).depositNFT(1, correlation)
      ).to.be.revertedWithCustomError(escrow, "NotSeller");
    });

    it("should reject confirmAgreement from non-operator", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(other).confirmAgreement(1, correlation, agreementToken)
      ).to.be.reverted;
    });

    it("should reject confirmPayment from non-operator", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      await expect(
        escrow.connect(other).confirmPayment(1, "RXN-123", priceCents, "AUD")
      ).to.be.reverted;
    });
  });

  describe("State Transitions", function () {
    it("should reject deposit in wrong state", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(seller).depositNFT(1, correlation)
      ).to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("should reject confirmAgreement in wrong state", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(
        escrow.connect(operator).confirmAgreement(1, correlation, agreementToken)
      ).to.be.revertedWithCustomError(escrow, "WrongState");
    });

    it("should reject confirmPayment in wrong state", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(operator).confirmPayment(1, "RXN-123", priceCents, "AUD")
      ).to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  describe("Cancellation", function () {
    it("should allow seller to cancel before deposit", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(escrow.connect(seller).cancel(1))
        .to.emit(escrow, "EscrowCancelled");

      const deal = await escrow.getDeal(1);
      expect(deal.state).to.equal(State.Cancelled);
    });

    it("should allow admin to cancel before deposit", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(escrow.connect(admin).cancel(1))
        .to.emit(escrow, "EscrowCancelled");
    });

    it("should reject cancel from non-seller/non-admin", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(
        escrow.connect(other).cancel(1)
      ).to.be.revertedWithCustomError(escrow, "NotSellerOrAdmin");
    });

    it("should reject cancel after deposit", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(seller).cancel(1)
      ).to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  describe("Refund After Timeout", function () {
    it("should allow refund after agreement timeout", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      // Fast forward 7 days
      await time.increase(7 * 24 * 60 * 60);

      await expect(escrow.connect(seller).refundNFT(1))
        .to.emit(escrow, "NftRefunded");

      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    });

    it("should reject refund before agreement timeout", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(seller).refundNFT(1)
      ).to.be.revertedWithCustomError(escrow, "TimeoutNotReached");
    });

    it("should allow refund after payment timeout", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      // Fast forward 30 days
      await time.increase(30 * 24 * 60 * 60);

      await expect(escrow.connect(seller).refundNFT(1))
        .to.emit(escrow, "NftRefunded");

      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    });

    it("should allow admin to refund after timeout", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await time.increase(7 * 24 * 60 * 60);

      await expect(escrow.connect(admin).refundNFT(1))
        .to.emit(escrow, "NftRefunded");
    });
  });

  describe("Emergency Refund", function () {
    it("should allow admin emergency refund with NFT", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(escrow.connect(admin).emergencyRefund(1))
        .to.emit(escrow, "NftRefunded")
        .and.to.emit(escrow, "EscrowCancelled");

      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
    });

    it("should allow admin emergency refund without NFT", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(escrow.connect(admin).emergencyRefund(1))
        .to.emit(escrow, "EscrowCancelled")
        .and.to.not.emit(escrow, "NftRefunded");
    });

    it("should reject emergency refund from non-admin", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(
        escrow.connect(seller).emergencyRefund(1)
      ).to.be.reverted;
    });

    it("should reject emergency refund after payment", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);
      await escrow.connect(operator).confirmPayment(1, "RXN-123", priceCents, "AUD");

      await expect(
        escrow.connect(admin).emergencyRefund(1)
      ).to.be.revertedWithCustomError(escrow, "WrongState");
    });
  });

  describe("View Functions", function () {
    it("should return correct next ID", async function () {
      expect(await escrow.nextId()).to.equal(1);

      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      expect(await escrow.nextId()).to.equal(2);
    });

    it("should return correct deal data", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      const deal = await escrow.getDeal(1);
      expect(deal.seller).to.equal(seller.address);
      expect(deal.buyer).to.equal(buyer.address);
      expect(deal.nft).to.equal(await nft.getAddress());
      expect(deal.tokenId).to.equal(tokenId);
      expect(deal.priceCents).to.equal(priceCents);
      expect(deal.state).to.equal(State.Opened);
    });

    it("should return correct canRefund status", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      expect(await escrow.canRefund(1)).to.be.false;

      await time.increase(7 * 24 * 60 * 60);

      expect(await escrow.canRefund(1)).to.be.true;
    });
  });

  describe("NFT Ownership Validation", function () {
    it("should reject deposit if seller doesn't own NFT", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      // Transfer NFT away
      await nft.connect(seller).transferFrom(seller.address, other.address, tokenId);

      await expect(
        escrow.connect(seller).depositNFT(1, correlation)
      ).to.be.revertedWithCustomError(escrow, "InvalidNFT");
    });

    it("should reject deposit if NFT not approved", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await expect(
        escrow.connect(seller).depositNFT(1, correlation)
      ).to.be.revertedWithCustomError(escrow, "NotApproved");
    });
  });

  describe("Correlation ID Verification", function () {
    it("should reject deposit with wrong correlation ID", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);

      // The contract's MismatchedCorrelation check currently triggers the EmptyString check 
      // if the string is empty, but for a wrong, non-empty string, MismatchedCorrelation is expected.
      // Based on the contract's logic for a non-empty string:
      await expect(
        escrow.connect(seller).depositNFT(1, "WRONG-ID")
      ).to.be.revertedWithCustomError(escrow, "MismatchedCorrelation");
    });

    it("should reject confirmAgreement with wrong correlation ID", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      await expect(
        escrow.connect(operator).confirmAgreement(1, "WRONG-ID", agreementToken)
      ).to.be.revertedWithCustomError(escrow, "MismatchedCorrelation");
    });
  });
});

describe("Additional Edge Cases", function () {
  let seller, buyer, operator, admin, other;
  let nft, escrow;
  let tokenId = 1n;
  const correlation = "INV-123456790";
  const agreementToken = "C01791640642293";
  const priceCents = 100_000; // $1000.00
  // Timeout is 7 days (7 * 24 * 60 * 60 seconds)
  const DEFAULT_AGREEMENT_TIMEOUT = 7 * 24 * 60 * 60; 

  beforeEach(async function () {
    [admin, seller, buyer, operator, other] = await ethers.getSigners();

    // Deploy NFT
    const NFT = await ethers.getContractFactory("TestERC721");
    nft = await NFT.connect(seller).deploy();
    await nft.waitForDeployment();

    // Mint to seller
    await nft.connect(seller).mint(seller.address);

    // Deploy Escrow
    const Escrow = await ethers.getContractFactory("Escrow");
    escrow = await Escrow.connect(admin).deploy(operator.address);
    await escrow.waitForDeployment();
  });

  describe("Multiple Escrows", function () {
    it("should handle multiple concurrent escrows independently", async function () {
      // First escrow
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      // Mint second NFT
      await nft.connect(seller).mint(seller.address);
      const tokenId2 = 2n;
      const correlation2 = "INV-999999999";

      // Second escrow
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId2,
        priceCents + 50_000,
        correlation2
      );

      // Complete first escrow
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);
      await escrow.connect(operator).confirmPayment(1, "RXN-001", priceCents, "AUD");

      // Second escrow should still be in Opened state
      const deal2 = await escrow.getDeal(2);
      expect(deal2.state).to.equal(State.Opened);
      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
      expect(await nft.ownerOf(tokenId2)).to.equal(seller.address);
    });
  });

  describe("Timestamp Edge Cases", function () {
    it("should allow refund exactly at timeout boundary", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      // Get exact deposit timestamp
      const deal = await escrow.getDeal(1);
      const depositTime = Number(deal.depositTimestamp);

      // Fast forward to exactly 7 days later
      const targetTime = depositTime + DEFAULT_AGREEMENT_TIMEOUT;
      await time.increaseTo(targetTime);

      // Should succeed at exact boundary (block.timestamp >= boundary)
      await expect(escrow.connect(seller).refundNFT(1))
        .to.emit(escrow, "NftRefunded");
    });

    it("should reject refund one second before timeout", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      const deal = await escrow.getDeal(1);
      const depositTime = Number(deal.depositTimestamp);

      // FIX: Calculate the time two seconds BEFORE the boundary.
      // This ensures that when Hardhat's next block (for refundNFT) 
      // advances the clock by 1 second, the resulting time is still 
      // one second BEFORE the timeout boundary.
      const targetTime = depositTime + DEFAULT_AGREEMENT_TIMEOUT - 2;

      await time.increaseTo(targetTime);

      // At this point, block.timestamp is targetTime. 
      // The refundNFT transaction will execute in the next block, 
      // at block.timestamp >= targetTime + 1 (i.e., depositTime + 7d - 1).
      // Since (depositTime + 7d - 1) < (depositTime + 7d), it must revert.
      await expect(escrow.connect(seller).refundNFT(1))
        .to.be.revertedWithCustomError(escrow, "TimeoutNotReached");
    });
  });

  describe("State Persistence", function () {
    it("should maintain deal state after failed refund attempt", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      // Try refund before timeout (should fail)
      await expect(
        escrow.connect(seller).refundNFT(1)
      ).to.be.revertedWithCustomError(escrow, "TimeoutNotReached");

      // State should still be NftDeposited
      const deal = await escrow.getDeal(1);
      expect(deal.state).to.equal(State.NftDeposited);

      // Should still be able to continue normal flow
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);
      const deal2 = await escrow.getDeal(1);
      expect(deal2.state).to.equal(State.AgreementConfirmed);
    });
  });

  describe("NFT Transfer Validation", function () {
    it("should handle NFT with multiple approvals correctly", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      // Approve both escrow and another address
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await nft.connect(seller).approve(other.address, tokenId);

      // Last approval (other.address) wins, so deposit should fail
      await expect(
        escrow.connect(seller).depositNFT(1, correlation)
      ).to.be.revertedWithCustomError(escrow, "NotApproved");
    });

    it("should verify NFT is actually transferred to escrow", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      
      const escrowAddress = await escrow.getAddress();
      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
      
      await escrow.connect(seller).depositNFT(1, correlation);
      
      expect(await nft.ownerOf(tokenId)).to.equal(escrowAddress);
    });
  });

  describe("Gas Optimization Verification", function () {
    it("should use similar gas for subsequent deposits", async function () {
      // First deposit
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      const tx1 = await escrow.connect(seller).depositNFT(1, correlation);
      const receipt1 = await tx1.wait();

      // Complete first escrow
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);
      await escrow.connect(operator).confirmPayment(1, "RXN-001", priceCents, "AUD");

      // Second deposit
      await nft.connect(seller).mint(seller.address);
      const tokenId2 = 2n;
      const correlation2 = "INV-999999999";
      
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId2,
        priceCents,
        correlation2
      );
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId2);
      const tx2 = await escrow.connect(seller).depositNFT(2, correlation2);
      const receipt2 = await tx2.wait();

      // Gas should be similar (within 10% variance for warm vs cold slots)
      const gasDiff = Math.abs(Number(receipt1.gasUsed - receipt2.gasUsed));
      const gasAvg = Number((receipt1.gasUsed + receipt2.gasUsed) / 2n);
      expect(gasDiff).to.be.lessThan(gasAvg * 0.1);
    });
  });

  describe("Correlation Hash Collisions", function () {
    it("should handle different strings with same prefix correctly", async function () {
      const correlation1 = "INV-123456789";
      const correlation2 = "INV-123456789-EXTRA";

      // Open first escrow
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation1
      );

      // Mint second NFT
      await nft.connect(seller).mint(seller.address);
      const tokenId2 = 2n;

      // Open second escrow with different correlation
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId2,
        priceCents,
        correlation2
      );

      // Approve first NFT
      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);

      // Should reject deposit with wrong correlation
      await expect(
        escrow.connect(seller).depositNFT(1, correlation2)
      ).to.be.revertedWithCustomError(escrow, "MismatchedCorrelation");

      // Should succeed with correct correlation
      await expect(escrow.connect(seller).depositNFT(1, correlation1))
        .to.emit(escrow, "NftDeposited");
    });
  });

  describe("Refund After Cancelled Agreement", function () {
    it("should allow refund if stuck in NftDeposited state", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);

      // Simulate agreement creation failure - NFT stuck in escrow
      await time.increase(7 * 24 * 60 * 60);

      // Seller should be able to recover NFT
      await expect(escrow.connect(seller).refundNFT(1))
        .to.emit(escrow, "NftRefunded");

      expect(await nft.ownerOf(tokenId)).to.equal(seller.address);
      
      const deal = await escrow.getDeal(1);
      expect(deal.state).to.equal(State.Refunded);
    });
  });

  describe("Payment Confirmation Edge Cases", function () {
    it("should reject payment confirmation with empty receipt", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      await expect(
        escrow.connect(operator).confirmPayment(1, "", priceCents, "AUD")
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
    });

    it("should reject payment confirmation with empty currency", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      await expect(
        escrow.connect(operator).confirmPayment(1, "RXN-123", priceCents, "")
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
    });

    it("should reject payment with mismatched amount", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      const mismatchedAmount = priceCents + 1000;

      // The contract now validates the payment amount against d.priceCents
      await expect(
        escrow.connect(operator).confirmPayment(1, "RXN-123", mismatchedAmount, "AUD")
      ).to.be.revertedWithCustomError(escrow, "PaymentAmountMismatch")
        .withArgs(priceCents, mismatchedAmount);
    });

    it("should accept payment with exact matching amount", async function () {
      await escrow.connect(seller).openEscrow(
        buyer.address,
        await nft.getAddress(),
        tokenId,
        priceCents,
        correlation
      );

      await nft.connect(seller).approve(await escrow.getAddress(), tokenId);
      await escrow.connect(seller).depositNFT(1, correlation);
      await escrow.connect(operator).confirmAgreement(1, correlation, agreementToken);

      // Confirm with exact amount
      await expect(
        escrow.connect(operator).confirmPayment(1, "RXN-123", priceCents, "AUD")
      ).to.emit(escrow, "PaymentConfirmed");

      expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
    });
  });
});