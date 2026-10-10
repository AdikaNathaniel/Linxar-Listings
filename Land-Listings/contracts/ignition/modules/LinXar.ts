// Deploys the whole LinXar system, in the right order.
import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("LinXarModule", (m) => {
  // 1. The property registry (the NFTs) comes first…
  const propertyRegistry = m.contract("PropertyRegistry");

  // 2. …because ListingBoard's constructor needs the registry's address.
  //    Passing `propertyRegistry` here tells Ignition to wait for step 1 and
  //    hand its address to ListingBoard's constructor.
  const listingBoard = m.contract("ListingBoard", [propertyRegistry]);

  return { propertyRegistry, listingBoard };
});
