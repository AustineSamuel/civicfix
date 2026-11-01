import { ethers } from "hardhat";

async function main(): Promise<void> {
  const [deployer] = await ethers.getSigners();
  if (!deployer) {
    throw new Error("No deployment signer is available.");
  }
  const registry = await ethers.deployContract("CivicFixRegistry", [deployer.address]);
  await registry.waitForDeployment();
  console.log(`CivicFixRegistry deployed at ${await registry.getAddress()}`);
  console.log(`Administrator: ${deployer.address}`);
}

void main().catch((error: unknown) => {
  console.error("Contract deployment failed", error);
  process.exitCode = 1;
});
