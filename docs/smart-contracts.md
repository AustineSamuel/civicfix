# Smart contract design

`CivicFixRegistry` records opaque case identifiers and nonzero `bytes32` commitments. Case registration is unique. Authorized committers can add a unique evidence identifier and an audit-event hash for each registered case. Role assignment and revocation use OpenZeppelin `AccessControl`; the deployer-supplied administrator is initially granted administrator, registrar, and committer roles.

Events never include report text, identities, locations, photographs, or other personal information. The API's SHA-256 values must be converted to `bytes32` before registry calls. A public commitment only attests that a digest was submitted; it does not prove the report or repair is true.

The initial contract has no external calls or financial functions. Administrative role control remains a trust assumption: production should use a reviewed multisig or equivalent controlled deployment. The contract still requires an independent audit and deployment-specific role review.
