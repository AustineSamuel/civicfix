// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

contract CivicFixRegistry is AccessControl {
    bytes32 public constant CASE_REGISTRAR_ROLE = keccak256("CASE_REGISTRAR_ROLE");
    bytes32 public constant COMMITTER_ROLE = keccak256("COMMITTER_ROLE");

    mapping(bytes32 caseId => bool registered) public cases;
    mapping(bytes32 caseId => bytes32 initialCommitment) public initialCommitments;
    mapping(bytes32 caseId => mapping(bytes32 evidenceId => bytes32 commitment)) public evidenceCommitments;
    mapping(bytes32 caseId => mapping(bytes32 eventHash => bytes32 commitment)) public statusCommitments;

    error InvalidIdentifier();
    error InvalidCommitment();
    error CaseAlreadyRegistered();
    error CaseNotRegistered();
    error CommitmentAlreadyRecorded();

    event CaseRegistered(bytes32 indexed caseId, bytes32 indexed initialCommitment, address indexed registrar);
    event EvidenceCommitted(
        bytes32 indexed caseId,
        bytes32 indexed evidenceId,
        bytes32 commitment,
        address indexed submitter
    );
    event StatusCommitted(
        bytes32 indexed caseId,
        bytes32 indexed auditEventHash,
        address indexed submitter
    );

    constructor(address administrator) {
        if (administrator == address(0)) revert InvalidIdentifier();
        _grantRole(DEFAULT_ADMIN_ROLE, administrator);
        _grantRole(CASE_REGISTRAR_ROLE, administrator);
        _grantRole(COMMITTER_ROLE, administrator);
    }

    function registerCase(bytes32 caseId, bytes32 initialCommitment)
        external
        onlyRole(CASE_REGISTRAR_ROLE)
    {
        if (caseId == bytes32(0)) revert InvalidIdentifier();
        if (initialCommitment == bytes32(0)) revert InvalidCommitment();
        if (cases[caseId]) revert CaseAlreadyRegistered();

        cases[caseId] = true;
        initialCommitments[caseId] = initialCommitment;
        emit CaseRegistered(caseId, initialCommitment, msg.sender);
    }

    function commitEvidence(bytes32 caseId, bytes32 evidenceId, bytes32 commitment)
        external
        onlyRole(COMMITTER_ROLE)
    {
        if (caseId == bytes32(0) || evidenceId == bytes32(0)) revert InvalidIdentifier();
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (!cases[caseId]) revert CaseNotRegistered();
        if (evidenceCommitments[caseId][evidenceId] != bytes32(0)) revert CommitmentAlreadyRecorded();

        evidenceCommitments[caseId][evidenceId] = commitment;
        emit EvidenceCommitted(caseId, evidenceId, commitment, msg.sender);
    }

    function commitStatus(bytes32 caseId, bytes32 auditEventHash)
        external
        onlyRole(COMMITTER_ROLE)
    {
        if (caseId == bytes32(0)) revert InvalidIdentifier();
        if (auditEventHash == bytes32(0)) revert InvalidCommitment();
        if (!cases[caseId]) revert CaseNotRegistered();
        if (statusCommitments[caseId][auditEventHash] != bytes32(0)) revert CommitmentAlreadyRecorded();

        statusCommitments[caseId][auditEventHash] = auditEventHash;
        emit StatusCommitted(caseId, auditEventHash, msg.sender);
    }
}
