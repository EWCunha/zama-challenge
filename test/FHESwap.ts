import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { FHESwap, FHESwap__factory, MockFactory, MockFactory__factory, MockERC7984, MockERC7984__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
};

async function deployFixture() {
  // Deploy factory
  const factoryFactory = (await ethers.getContractFactory("MockFactory")) as MockFactory__factory;
  const factory = (await factoryFactory.deploy()) as MockFactory;
//   const factoryAddress = await factory.getAddress();

  // Deploy two mock ERC7984 tokens
  const tokenFactory = (await ethers.getContractFactory("MockERC7984")) as MockERC7984__factory;
  const token0 = (await tokenFactory.deploy("Token0", "TKN0")) as MockERC7984;
  const token1 = (await tokenFactory.deploy("Token1", "TKN1")) as MockERC7984;
  const token0Address = await token0.getAddress();
  const token1Address = await token1.getAddress();

  // Create pair through factory
  const tx = await factory.createPair(token0Address, token1Address);
  await tx.wait();

  const pairAddress = await factory.getPair(token0Address, token1Address);
  const pairFactory = (await ethers.getContractFactory("FHESwap")) as FHESwap__factory;
  const pair = pairFactory.attach(pairAddress) as FHESwap;

  return { factory, token0, token1, pair, token0Address, token1Address, pairAddress };
}

describe("FHESwap", function () {
  let signers: Signers;
  let factory: MockFactory;
  let token0: MockERC7984;
  let token1: MockERC7984;
  let pair: FHESwap;
  let token0Address: string;
  let token1Address: string;
  let pairAddress: string;

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = { deployer: ethSigners[0], alice: ethSigners[1], bob: ethSigners[2] };
  });

  beforeEach(async function () {
    // Check whether the tests are running against an FHEVM mock environment
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }

    ({ factory, token0, token1, pair, token0Address, token1Address, pairAddress } = await deployFixture());
  });

  describe("Initialization", function () {
    it("should set factory address correctly", async function () {
      const factoryAddr = await pair.factory();
      expect(factoryAddr).to.eq(await factory.getAddress());
    });

    it("should initialize tokens correctly", async function () {
      const [token0Addr, token1Addr] = token0Address < token1Address ? [token0Address, token1Address] : [token1Address, token0Address];
      const t0 = await pair.token0();
      const t1 = await pair.token1();
      expect(t0.toLowerCase()).to.eq(token0Addr.toLowerCase());
      expect(t1.toLowerCase()).to.eq(token1Addr.toLowerCase());
    });

    it("should not allow initialize to be called twice", async function () {
      await expect(pair.initialize(token0Address, token1Address)).to.be.revertedWith("UniswapV2: FORBIDDEN");
    });

    it("should have zero reserves initially", async function () {
      const [reserve0, reserve1, blockTimestampLast] = await pair.getReserves();
      expect(reserve0).to.eq(ethers.ZeroHash);
      expect(reserve1).to.eq(ethers.ZeroHash);
      expect(blockTimestampLast).to.eq(0);
    });
  });

  describe("Mint", function () {
    it("should mint liquidity tokens when adding equal amounts", async function () {
      const amount = 1000;
      
      // Encrypt amounts
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.alice.address)
        .add64(amount)
        .encrypt();
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(token1Address, signers.alice.address)
        .add64(amount)
        .encrypt();

      // Mint tokens to pair
      let tx = await token0.connect(
        signers.alice).confidentialMint(pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
      await tx.wait();
      tx = await token1.connect(
        signers.alice).confidentialMint(pairAddress, encryptedAmount1.handles[0], encryptedAmount1.inputProof);
      await tx.wait();

      // Call mint
      tx = await pair.connect(signers.alice).mint(signers.alice.address);
      await tx.wait();

      // Check liquidity was minted
      const liquidity = await pair.confidentialBalanceOf(signers.alice.address);
      const decryptedLiquidity = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        liquidity,
        pairAddress,
        signers.alice,
      );
      expect(decryptedLiquidity).to.eq(amount);
    });

    it("should update reserves after minting", async function () {
      const amount = 1000n;
      
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.alice.address)
        .add64(amount)
        .encrypt();
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(token1Address, signers.alice.address)
        .add64(amount)
        .encrypt();

      await token0.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
      await token1.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount1.handles[0], encryptedAmount1.inputProof);

      await pair.connect(signers.alice).mint(signers.alice.address);

      const [reserve0, reserve1] = await pair.getReserves();
      const decryptedReserve0 = await fhevm.publicDecryptEuint(
        FhevmType.euint64,
        reserve0,
      );
      const decryptedReserve1 = await fhevm.publicDecryptEuint(
        FhevmType.euint64,
        reserve1,   
      );
      expect(decryptedReserve0).to.eq(amount);
      expect(decryptedReserve1).to.eq(amount);
    });

    it("should emit Mint event", async function () {
      const amount = 1000n;
      
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.alice.address)
        .add64(amount)
        .encrypt();
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(token1Address, signers.alice.address)
        .add64(amount)
        .encrypt();

      await token0.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
      await token1.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount1.handles[0], encryptedAmount1.inputProof);

      await expect(pair.connect(signers.alice).mint(signers.alice.address))
        .to.emit(pair, "Mint")
    });
  });

  describe("Burn", function () {
    beforeEach(async function () {
      // First add liquidity
      const amount = 1000n;
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.alice.address)
        .add64(amount)  
        .encrypt();
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(token1Address, signers.alice.address)
        .add64(amount)
        .encrypt();

      await token0.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
      await token1.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount1.handles[0], encryptedAmount1.inputProof);
      await pair.connect(signers.alice).mint(signers.alice.address);
    });

    it("should burn liquidity and return tokens", async function () {
      // Transfer LP tokens to pair
      const encLiquidity = await pair.confidentialBalanceOf(signers.alice.address);
      const clearCountAfterInc = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        encLiquidity,
        pairAddress,
        signers.alice,
    );
    const encryptedAmount0 = await fhevm
      .createEncryptedInput(pairAddress, signers.alice.address)
      .add64(clearCountAfterInc)
      .encrypt();

      await pair.connect(signers.alice)["confidentialTransfer(address,bytes32,bytes)"](
        pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);

      // Burn
      const tx = await pair.connect(signers.alice).burn(signers.alice.address);
      await tx.wait();

      // Check that tokens were returned
      const balance0 = await token0.confidentialBalanceOf(signers.alice.address);
      const balance1 = await token1.confidentialBalanceOf(signers.alice.address);
      const balancePair = await pair.confidentialBalanceOf(signers.alice.address);
      
      const decryptedBalance0 = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        balance0,
        token0Address,
        signers.alice,
      );
      const decryptedBalance1 = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        balance1,
        token1Address,
        signers.alice,
      );
      const decryptedBalancePair = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        balancePair,
        pairAddress,
        signers.alice,
      );

      expect(decryptedBalance0).to.be.gt(0);
      expect(decryptedBalance1).to.be.gt(0);
      expect(decryptedBalancePair).to.be.eq(0);
    });

    it("should emit Burn event", async function () {
      const liquidity = await pair.confidentialBalanceOf(signers.alice.address);
      const clearLiquidity = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        liquidity,
        pairAddress,
        signers.alice,
      );
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(pairAddress, signers.alice.address)
        .add64(clearLiquidity)
        .encrypt();
    
      await pair.connect(signers.alice)["confidentialTransfer(address,bytes32,bytes)"](
        pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);

      await expect(pair.connect(signers.alice).burn(signers.alice.address))
        .to.emit(pair, "Burn")
    });
  });

  describe("Swap", function () {
    beforeEach(async function () {
      // First add liquidity
      const amount = 10000n;
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.alice.address)
        .add64(amount)
        .encrypt();
      const encryptedAmount1 = await fhevm
        .createEncryptedInput(token1Address, signers.alice.address)
        .add64(amount)
        .encrypt();

      await token0.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
      await token1.connect(signers.alice).confidentialMint(pairAddress, encryptedAmount1.handles[0], encryptedAmount1.inputProof);
      await pair.connect(signers.alice).mint(signers.alice.address);
    });

    it("should swap token0 for token1", async function () {
      const swapAmount = 100n;
      const amount0Out = 0n;
      const amount1Out = swapAmount;

      // Mint token0 to bob for the swap
      const encryptedSwapIn = await fhevm
        .createEncryptedInput(token0Address, signers.bob.address)
        .add64(swapAmount)
        .encrypt();
      await token0.connect(signers.bob).confidentialMint(signers.bob.address, encryptedSwapIn.handles[0], encryptedSwapIn.inputProof);

      // Transfer token0 from Bob to pair
      const encryptedAmount0 = await fhevm
        .createEncryptedInput(token0Address, signers.bob.address)
        .add64(swapAmount)
        .encrypt();
      await token0.connect(signers.bob)["confidentialTransfer(address,bytes32,bytes)"](
        pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);

      // Encrypt swap amounts
      const encryptedAmount0Out = await fhevm
        .createEncryptedInput(pairAddress, signers.bob.address)
        .add64(amount0Out)
        .encrypt();
      const encryptedAmount1Out = await fhevm
        .createEncryptedInput(pairAddress, signers.bob.address)
        .add64(amount1Out)
        .encrypt();

      // Get initial balance
      const initialBalance1 = await token1.confidentialBalanceOf(signers.bob.address);

      // Perform swap
      const tx = await pair.connect(signers.bob).swap(
        encryptedAmount0Out.handles[0],
        encryptedAmount1Out.handles[0],
        encryptedAmount0Out.inputProof,
        encryptedAmount1Out.inputProof,
        signers.bob.address,
        "0x"
      );
      await tx.wait();

      // Check that bob received token1
      const finalBalance1 = await token1.confidentialBalanceOf(signers.bob.address);
      
      const decryptedFinal = await fhevm.userDecryptEuint(
        FhevmType.euint64,
        finalBalance1,
        token1Address,
        signers.bob,
      );
      
      expect(initialBalance1).to.be.eq(ethers.ZeroHash);
      expect(decryptedFinal).to.be.eq(swapAmount);
    });

    it("should emit Swap event", async function () {
        const swapAmount = 100n;
        const amount0Out = 0n;
        const amount1Out = swapAmount;
  
        // Mint token0 to bob for the swap
        const encryptedSwapIn = await fhevm
          .createEncryptedInput(token0Address, signers.bob.address)
          .add64(swapAmount)
          .encrypt();
        await token0.connect(signers.bob).confidentialMint(signers.bob.address, encryptedSwapIn.handles[0], encryptedSwapIn.inputProof);
  
        // Transfer token0 from Bob to pair
        const encryptedAmount0 = await fhevm
          .createEncryptedInput(token0Address, signers.bob.address)
          .add64(swapAmount)
          .encrypt();
        await token0.connect(signers.bob)["confidentialTransfer(address,bytes32,bytes)"](
          pairAddress, encryptedAmount0.handles[0], encryptedAmount0.inputProof);
  
        // Encrypt swap amounts
        const encryptedAmount0Out = await fhevm
          .createEncryptedInput(pairAddress, signers.bob.address)
          .add64(amount0Out)
          .encrypt();
        const encryptedAmount1Out = await fhevm
          .createEncryptedInput(pairAddress, signers.bob.address)
          .add64(amount1Out)
          .encrypt();
          
      await expect(
        pair.connect(signers.bob).swap(
          encryptedAmount0Out.handles[0],
          encryptedAmount1Out.handles[0],
          encryptedAmount0Out.inputProof,
          encryptedAmount1Out.inputProof,
          signers.bob.address,
          "0x"
        )
      )
        .to.emit(pair, "Swap")
    });
  });   
});

