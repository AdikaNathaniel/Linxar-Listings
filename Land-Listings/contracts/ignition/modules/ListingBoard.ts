// Hardhat Ignition module: describes WHAT to deploy.
// Ignition then works out HOW: it sends the transactions, waits for them,
// and records the result, so a deployment can be resumed or repeated safely.
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

// "ListingBoardModule" is just a name for this deployment.
export default buildModule("ListingBoardModule", (m) => {
  // Deploy the ListingBoard contract. Its constructor takes no arguments,
  // so there's nothing else to pass in.
  const listingBoard = m.contract("ListingBoard");

  // Returning it makes the deployed address available in the output.
  return { listingBoard };
});
