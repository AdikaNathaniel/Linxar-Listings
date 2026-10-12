// Deploys the whole LinXar system, in the right order, and hands out the roles.
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LinXarModule", (m) => {
  // WHO gets which role comes from a PARAMETERS file, one per network:
  //   ignition/parameters/localhost.json → Hardhat's test accounts
  //   ignition/parameters/sepolia.json   → your own Sepolia accounts
  // That way the same module deploys anywhere, without editing code.
  // (The account that deploys becomes ADMIN of every contract automatically.)
  const verifier = m.getParameter("verifier"); // approves properties, issues agent badges
  const arbiter = m.getParameter("arbiter"); // settles escrow disputes

  // 1. The contracts, in dependency order
  const propertyRegistry = m.contract("PropertyRegistry");
  const listingBoard = m.contract("ListingBoard", [propertyRegistry]);
  const escrow = m.contract("Escrow", [listingBoard, propertyRegistry]);
  const agentBadge = m.contract("AgentBadge");

  // 2. The roles. `m.staticCall` READS a value from a deployed contract (here,
  //    the role's id), and `m.call` SENDS a transaction to it: grantRole,
  //    sent by the admin, after the contract exists.
  const registryVerifierRole = m.staticCall(propertyRegistry, "VERIFIER_ROLE");
  m.call(propertyRegistry, "grantRole", [registryVerifierRole, verifier]);

  const badgeVerifierRole = m.staticCall(agentBadge, "VERIFIER_ROLE");
  m.call(agentBadge, "grantRole", [badgeVerifierRole, verifier]);

  const arbiterRole = m.staticCall(escrow, "ARBITER_ROLE");
  m.call(escrow, "grantRole", [arbiterRole, arbiter]);

  return { propertyRegistry, listingBoard, escrow, agentBadge };
});
