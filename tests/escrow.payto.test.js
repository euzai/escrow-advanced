const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

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
      expect(deal.state).to.equal(4); // State.Paid
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
      expect(deal.state).to.equal(5); // State.Cancelled
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
      expect(deal.state).to.equal(1); // State.Opened
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

      await expect(
        escrow.connect(seller).depositNFT(1, "WRONG-ID")
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
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
      ).to.be.revertedWithCustomError(escrow, "EmptyString");
    });
  });
});