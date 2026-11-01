import { expect } from "chai";
import { ethers } from "hardhat";

describe("CivicFixRegistry", () => {
  async function deploy() {
    const [admin, registrar, committer, stranger] = await ethers.getSigners();
    const factory = await ethers.getContractFactory("CivicFixRegistry");
    const registry = await factory.deploy(admin.address);
    const registrarRole = await registry.CASE_REGISTRAR_ROLE();
    const committerRole = await registry.COMMITTER_ROLE();
    await registry.grantRole(registrarRole, registrar.address);
    await registry.grantRole(committerRole, committer.address);
    return { registry, admin, registrar, committer, stranger, registrarRole, committerRole };
  }

  it("registers a unique case and emits a commitment event", async () => {
    const { registry, registrar } = await deploy();
    const caseId = ethers.keccak256(ethers.toUtf8Bytes("CF-CASE-1"));
    const commitment = ethers.keccak256(ethers.toUtf8Bytes("initial report"));

    await expect(registry.connect(registrar).registerCase(caseId, commitment))
      .to.emit(registry, "CaseRegistered")
      .withArgs(caseId, commitment, registrar.address);
    expect(await registry.cases(caseId)).to.equal(true);
    expect(await registry.initialCommitments(caseId)).to.equal(commitment);
    await expect(registry.connect(registrar).registerCase(caseId, commitment))
      .to.be.revertedWithCustomError(registry, "CaseAlreadyRegistered");
  });

  it("rejects unauthorized and zero-value registrations", async () => {
    const { registry, stranger } = await deploy();
    const id = ethers.keccak256(ethers.toUtf8Bytes("case"));
    const hash = ethers.keccak256(ethers.toUtf8Bytes("commitment"));
    await expect(registry.connect(stranger).registerCase(id, hash)).to.be.reverted;
    await expect(registry.registerCase(ethers.ZeroHash, hash))
      .to.be.revertedWithCustomError(registry, "InvalidIdentifier");
    await expect(registry.registerCase(id, ethers.ZeroHash))
      .to.be.revertedWithCustomError(registry, "InvalidCommitment");
  });

  it("records evidence and status commitments only once for a registered case", async () => {
    const { registry, registrar, committer } = await deploy();
    const caseId = ethers.keccak256(ethers.toUtf8Bytes("case"));
    const evidenceId = ethers.keccak256(ethers.toUtf8Bytes("evidence"));
    const evidenceHash = ethers.keccak256(ethers.toUtf8Bytes("manifest"));
    const eventHash = ethers.keccak256(ethers.toUtf8Bytes("status event"));
    await registry.connect(registrar).registerCase(caseId, evidenceHash);

    await expect(registry.connect(committer).commitEvidence(caseId, evidenceId, evidenceHash))
      .to.emit(registry, "EvidenceCommitted")
      .withArgs(caseId, evidenceId, evidenceHash, committer.address);
    expect(await registry.evidenceCommitments(caseId, evidenceId)).to.equal(evidenceHash);
    await expect(registry.connect(committer).commitEvidence(caseId, evidenceId, evidenceHash))
      .to.be.revertedWithCustomError(registry, "CommitmentAlreadyRecorded");
    await expect(registry.connect(committer).commitStatus(caseId, eventHash))
      .to.emit(registry, "StatusCommitted")
      .withArgs(caseId, eventHash, committer.address);
    expect(await registry.statusCommitments(caseId, eventHash)).to.equal(eventHash);
    await expect(registry.connect(committer).commitStatus(caseId, eventHash))
      .to.be.revertedWithCustomError(registry, "CommitmentAlreadyRecorded");
  });

  it("rejects unauthorized writers and writes for unknown cases", async () => {
    const { registry, stranger, committer } = await deploy();
    const caseId = ethers.keccak256(ethers.toUtf8Bytes("case"));
    const eventHash = ethers.keccak256(ethers.toUtf8Bytes("event"));
    await expect(registry.connect(stranger).commitStatus(caseId, eventHash)).to.be.reverted;
    await expect(registry.connect(committer).commitStatus(caseId, eventHash))
      .to.be.revertedWithCustomError(registry, "CaseNotRegistered");
  });

  it("supports role assignment and revocation", async () => {
    const { registry, admin, stranger, committerRole } = await deploy();
    await registry.grantRole(committerRole, stranger.address);
    expect(await registry.hasRole(committerRole, stranger.address)).to.equal(true);
    await registry.revokeRole(committerRole, stranger.address);
    expect(await registry.hasRole(committerRole, stranger.address)).to.equal(false);
    await expect(registry.connect(stranger).grantRole(committerRole, admin.address)).to.be.reverted;
  });
});
