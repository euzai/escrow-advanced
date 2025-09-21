const { ethers } = require("hardhat");

async function main() {
  const [deployer, operator] = await ethers.getSigners();
  const Escrow = await ethers.getContractFactory("Escrow");
  const escrow = await Escrow.deploy(operator.address);
  await escrow.waitForDeployment();
  console.log("Escrow deployed at:", await escrow.getAddress());
  console.log("Operator:", operator.address);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
