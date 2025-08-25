import { expect } from "chai";
import { ethers } from "hardhat";
import { MockUSDC } from "../typechain-types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";

describe("MockUSDC", function () {
  let mockUSDC: MockUSDC;
  let owner: SignerWithAddress;
  let user1: SignerWithAddress;
  let user2: SignerWithAddress;
  let user3: SignerWithAddress;

  beforeEach(async function () {
    [owner, user1, user2, user3] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should have correct token properties", async function () {
      expect(await mockUSDC.name()).to.equal("Mock USD Coin");
      expect(await mockUSDC.symbol()).to.equal("USDC");
      expect(await mockUSDC.decimals()).to.equal(6);
      expect(await mockUSDC.totalSupply()).to.equal(0);
    });
  });

  describe("Basic Minting", function () {
    it("Should allow anyone to mint tokens", async function () {
      const amount = ethers.parseUnits("1000", 6); // 1000 USDC
      
      await mockUSDC.connect(user1).mint(user2.address, amount);
      
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(amount);
      expect(await mockUSDC.totalSupply()).to.equal(amount);
    });

    it("Should allow minting to self", async function () {
      const amount = ethers.parseUnits("500", 6);
      
      await mockUSDC.connect(user1).mintToSelf(amount);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amount);
    });

    it("Should allow using faucet", async function () {
      await mockUSDC.connect(user1).faucet();
      
      const expectedAmount = ethers.parseUnits("1000", 6);
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(expectedAmount);
    });

    it("Should allow minting standard amount", async function () {
      await mockUSDC.connect(user1).mintStandard(user2.address);
      
      const expectedAmount = ethers.parseUnits("1000", 6);
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(expectedAmount);
    });

    it("Should allow minting large amount", async function () {
      await mockUSDC.connect(user1).mintLarge(user2.address);
      
      const expectedAmount = ethers.parseUnits("1000000", 6); // 1M USDC
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(expectedAmount);
    });
  });

  describe("Batch Operations", function () {
    it("Should allow batch minting with different amounts", async function () {
      const recipients = [user1.address, user2.address, user3.address];
      const amounts = [
        ethers.parseUnits("100", 6),
        ethers.parseUnits("200", 6),
        ethers.parseUnits("300", 6)
      ];
      
      await mockUSDC.batchMint(recipients, amounts);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amounts[0]);
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(amounts[1]);
      expect(await mockUSDC.balanceOf(user3.address)).to.equal(amounts[2]);
    });

    it("Should allow batch minting with equal amounts", async function () {
      const recipients = [user1.address, user2.address, user3.address];
      const amount = ethers.parseUnits("500", 6);
      
      await mockUSDC.batchMintEqual(recipients, amount);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amount);
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(amount);
      expect(await mockUSDC.balanceOf(user3.address)).to.equal(amount);
    });

    it("Should allow airdrop", async function () {
      const recipients = [user1.address, user2.address];
      const amountPerRecipient = ethers.parseUnits("750", 6);
      
      await mockUSDC.airdrop(recipients, amountPerRecipient);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(amountPerRecipient);
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(amountPerRecipient);
    });

    it("Should revert batch mint with mismatched arrays", async function () {
      const recipients = [user1.address, user2.address];
      const amounts = [ethers.parseUnits("100", 6)]; // Only one amount
      
      await expect(
        mockUSDC.batchMint(recipients, amounts)
      ).to.be.revertedWith("MockUSDC: arrays length mismatch");
    });
  });

  describe("Burning", function () {
    beforeEach(async function () {
      // Mint some tokens first
      await mockUSDC.mint(user1.address, ethers.parseUnits("1000", 6));
    });

    it("Should allow burning own tokens", async function () {
      const burnAmount = ethers.parseUnits("300", 6);
      const initialBalance = await mockUSDC.balanceOf(user1.address);
      
      await mockUSDC.connect(user1).burn(burnAmount);
      
      const finalBalance = await mockUSDC.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance - burnAmount);
    });

    it("Should allow burning from another address with allowance", async function () {
      const burnAmount = ethers.parseUnits("200", 6);
      
      // Approve user2 to burn from user1
      await mockUSDC.connect(user1).approve(user2.address, burnAmount);
      
      const initialBalance = await mockUSDC.balanceOf(user1.address);
      await mockUSDC.connect(user2).burnFrom(user1.address, burnAmount);
      
      const finalBalance = await mockUSDC.balanceOf(user1.address);
      expect(finalBalance).to.equal(initialBalance - burnAmount);
    });

    it("Should revert burn from without allowance", async function () {
      const burnAmount = ethers.parseUnits("200", 6);
      
      await expect(
        mockUSDC.connect(user2).burnFrom(user1.address, burnAmount)
      ).to.be.revertedWith("MockUSDC: burn amount exceeds allowance");
    });
  });

  describe("Utility Functions", function () {
    beforeEach(async function () {
      await mockUSDC.mint(user1.address, ethers.parseUnits("1234.567890", 6));
    });

    it("Should return formatted balance", async function () {
      const formatted = await mockUSDC.getFormattedBalance(user1.address);
      expect(formatted).to.equal("1234.567890");
    });

    it("Should check sufficient balance correctly", async function () {
      const sufficientAmount = ethers.parseUnits("1000", 6);
      const insufficientAmount = ethers.parseUnits("2000", 6);
      
      expect(await mockUSDC.hasSufficientBalance(user1.address, sufficientAmount)).to.be.true;
      expect(await mockUSDC.hasSufficientBalance(user1.address, insufficientAmount)).to.be.false;
    });

    it("Should convert between raw and human amounts", async function () {
      const humanAmount = 1000;
      const rawAmount = await mockUSDC.toRawAmount(humanAmount);
      const backToHuman = await mockUSDC.toHumanAmount(rawAmount);
      
      expect(rawAmount).to.equal(ethers.parseUnits("1000", 6));
      expect(backToHuman).to.equal(humanAmount);
    });
  });

  describe("Standard ERC20 Functions", function () {
    beforeEach(async function () {
      await mockUSDC.mint(user1.address, ethers.parseUnits("1000", 6));
    });

    it("Should transfer tokens", async function () {
      const transferAmount = ethers.parseUnits("100", 6);
      
      await mockUSDC.connect(user1).transfer(user2.address, transferAmount);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("900", 6));
      expect(await mockUSDC.balanceOf(user2.address)).to.equal(transferAmount);
    });

    it("Should approve and transferFrom", async function () {
      const transferAmount = ethers.parseUnits("150", 6);
      
      await mockUSDC.connect(user1).approve(user2.address, transferAmount);
      await mockUSDC.connect(user2).transferFrom(user1.address, user3.address, transferAmount);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(ethers.parseUnits("850", 6));
      expect(await mockUSDC.balanceOf(user3.address)).to.equal(transferAmount);
      expect(await mockUSDC.allowance(user1.address, user2.address)).to.equal(0);
    });
  });

  describe("Edge Cases", function () {
    it("Should handle minting maximum amount", async function () {
      // This test might be skipped in some environments due to gas limits
      const maxAmount = ethers.MaxUint256;
      
      await mockUSDC.mintMax(user1.address);
      
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(maxAmount);
    });

    it("Should handle zero amount operations", async function () {
      await mockUSDC.mint(user1.address, 0);
      expect(await mockUSDC.balanceOf(user1.address)).to.equal(0);
    });

    it("Should handle empty arrays in batch operations", async function () {
      await mockUSDC.batchMint([], []);
      await mockUSDC.batchMintEqual([], ethers.parseUnits("100", 6));
      await mockUSDC.airdrop([], ethers.parseUnits("100", 6));
      
      // Should not revert and not change any balances
      expect(await mockUSDC.totalSupply()).to.equal(0);
    });
  });

  describe("Events", function () {
    it("Should emit Transfer events on mint", async function () {
      const amount = ethers.parseUnits("1000", 6);
      
      await expect(mockUSDC.mint(user1.address, amount))
        .to.emit(mockUSDC, "Transfer")
        .withArgs(ethers.ZeroAddress, user1.address, amount);
    });

    it("Should emit FaucetUsed event", async function () {
      const expectedAmount = ethers.parseUnits("1000", 6);
      
      await expect(mockUSDC.connect(user1).faucetWithEvent())
        .to.emit(mockUSDC, "FaucetUsed")
        .withArgs(user1.address, expectedAmount);
    });

    it("Should emit MassAirdrop event", async function () {
      const recipients = [user1.address, user2.address];
      const amountPerRecipient = ethers.parseUnits("500", 6);
      const totalAmount = amountPerRecipient * BigInt(recipients.length);
      
      await expect(mockUSDC.airdropWithEvent(recipients, amountPerRecipient))
        .to.emit(mockUSDC, "MassAirdrop")
        .withArgs(owner.address, recipients.length, totalAmount);
    });
  });
});
