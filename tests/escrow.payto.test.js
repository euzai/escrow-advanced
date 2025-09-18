const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("Escrow x PayTo", function () {
  it("end-to-end happy path", async function () {
    const [seller, buyer, operator] = await ethers.getSigners();

    // Deploy NFT
    const NFT = await ethers.getContractFactory("TestERC721", seller);
    const nft = await NFT.deploy();
    await nft.waitForDeployment();

    // Mint to seller
    const mintTx = await nft.connect(seller).mint(seller.address);
    const mintRc = await mintTx.wait();
    const tokenId = 1n; // first mint

    // Deploy Escrow
    const Escrow = await ethers.getContractFactory("Escrow");
    const escrow = await Escrow.deploy(operator.address);
    await escrow.waitForDeployment();

    const correlation = "INV-123456790";

    // Open escrow
    const openTx = await escrow.connect(seller).openEscrow(
      buyer.address,
      await nft.getAddress(),
      tokenId,
      100_000, // $1000.00 (cents)
      correlation
    );
    const openRc = await openTx.wait();

    // Approve and deposit NFT
    await nft.connect(seller).approve(await escrow.getAddress(), tokenId);

    await expect(escrow.connect(seller).depositNFT(1))
      .to.emit(escrow, "PayToAgreementRequested");

    // This line confirms that the NFT is now owned by the escrow contract
    expect(await nft.ownerOf(tokenId)).to.equal(await escrow.getAddress());

    // OPERATOR confirms agreement (simulating webhook->relayer)
    await expect(escrow.connect(operator).confirmAgreement(1, "C01791640642293"))
      .to.emit(escrow, "PayToPaymentRequested");

    // OPERATOR confirms payment, NFT should move to buyer
    await expect(
      escrow.connect(operator).confirmPayment(
        1,
        "RXN-1234567890",
        100_000, // $1000.00 (cents)
        "AUD"
      )
    )
      .to.emit(escrow, "PaymentConfirmed")
      .and.to.emit(escrow, "NftReleased");

    // Check NFT ownership
    expect(await nft.ownerOf(tokenId)).to.equal(buyer.address);
  });
});