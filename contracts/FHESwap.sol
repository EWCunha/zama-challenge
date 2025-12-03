// SPDX-License-Identifier: MIT
pragma solidity 0.8.27;

import "hardhat/console.sol";

import {IFHEFactory} from "./interfaces/IFHEFactory.sol";
import {IFHECallee} from "./interfaces/IFHECallee.sol";

import {ERC7984} from "./ERC7984/ERC7984.sol";
import {IERC7984} from "./interfaces/IERC7984.sol";
import {FHE, externalEuint64, ebool, euint256, euint64} from "@fhevm/solidity/lib/FHE.sol";

contract FHESwap is ERC7984 {
    using FHE for *;

    uint256 public constant MINIMUM_LIQUIDITY = 10 ** 3;

    address public factory;
    address public token0;
    address public token1;

    euint64 private reserve0; 
    euint64 private reserve1; 
    uint32 private blockTimestampLast;

    euint256 public kLast; // reserve0 * reserve1, as of immediately after the most recent liquidity event

    uint256 private unlocked = 1;
    modifier lock() {
        require(unlocked == 1, "UniswapV2: LOCKED");
        unlocked = 0;
        _;
        unlocked = 1;
    }

    function getReserves() public view returns (euint64 _reserve0, euint64 _reserve1, uint32 _blockTimestampLast) {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    event Mint(address indexed sender, euint64 amount0, euint64 amount1);
    event Burn(address indexed sender, euint64 amount0, euint64 amount1, address indexed to);
    event Swap(
        address indexed sender,
        euint64 amount0In,
        euint64 amount1In,
        euint64 amount0Out,
        euint64 amount1Out,
        address indexed to
    );
    event Sync(euint64 reserve0, euint64 reserve1);

    constructor() ERC7984("FHESwap", "FHE", "") {
        factory = msg.sender;
    }

    // called once by the factory at time of deployment
    function initialize(address _token0, address _token1) external {
        require(msg.sender == factory, "UniswapV2: FORBIDDEN"); // sufficient check
        token0 = _token0;
        token1 = _token1;
    }

    function _transferAndReturnEuint64(address token, address to, euint64 value) private returns (euint64) {
        FHE.allow(value, token);
        IERC7984(token).confidentialTransfer(to, value);
        return IERC7984(token).confidentialBalanceOf(to);
    }

    // update reserves and, on the first call per block, price accumulators
    function _update(euint64 balance0, euint64 balance1) private {
        reserve0 = balance0;
        reserve1 = balance1;
        blockTimestampLast = uint32(block.timestamp % 2 ** 32);
        kLast = FHE.asEuint256(reserve0.add(reserve1));

        FHE.makePubliclyDecryptable(reserve0);
        FHE.makePubliclyDecryptable(reserve1);
        FHE.makePubliclyDecryptable(kLast);

        emit Sync(reserve0, reserve1);
    }

    // this low-level function should be called from a contract which performs important safety checks
    function mint(address to) external lock returns (euint64 liquidity) {
        (euint64 _reserve0, euint64 _reserve1, ) = getReserves(); // gas savings
        euint64 balance0 = IERC7984(token0).confidentialBalanceOf(address(this));
        euint64 balance1 = IERC7984(token1).confidentialBalanceOf(address(this));
        euint64 amount0 = balance0.sub(_reserve0);
        euint64 amount1 = balance1.sub(_reserve1);
        liquidity = amount0;

        _mint(to, liquidity);
        _update(balance0, balance1);
        emit Mint(msg.sender, amount0, amount1);
    }
    // this low-level function should be called from a contract which performs important safety checks
    function burn(address to) external lock returns (euint64 amount0, euint64 amount1) {
        (euint64 _reserve0, euint64 _reserve1, ) = getReserves(); // gas savings
        address _token0 = token0; // gas savings
        address _token1 = token1; // gas savings
        euint64 balance0 = IERC7984(_token0).confidentialBalanceOf(address(this));
        euint64 balance1 = IERC7984(_token1).confidentialBalanceOf(address(this));
        euint64 liquidity = confidentialBalanceOf(address(this));

        amount0 = FHE.select(liquidity.eq(balance0.add(balance1).div(2)), balance0.add(balance1).div(2), FHE.asEuint64(0));
        amount1 = amount0;
        _burn(address(this), liquidity);
        FHE.allow(amount0, _token0);
        FHE.allow(amount1, _token1);
        IERC7984(_token0).confidentialTransfer(to, amount0);
        IERC7984(_token1).confidentialTransfer(to, amount1);
        balance0 = IERC7984(_token0).confidentialBalanceOf(address(this));
        balance1 = IERC7984(_token1).confidentialBalanceOf(address(this));

        _update(balance0, balance1);

        emit Burn(msg.sender, amount0, amount1, to);
    }

    // this low-level feuint64unction should be called from a contract which performs important safety checks
    function swap(
        externalEuint64 amount0OutInput, 
        externalEuint64 amount1OutInput,
        bytes calldata inputProof0, 
        bytes calldata inputProof1, 
        address to, 
        bytes calldata data
    ) external lock {
        euint64 amount0Out = FHE.fromExternal(amount0OutInput, inputProof0);
        euint64 amount1Out = FHE.fromExternal(amount1OutInput, inputProof1);
        (euint64 _reserve0, euint64 _reserve1, ) = getReserves(); // gas savings
       
        euint64 balance0;
        euint64 balance1;
        {
            // scope for _token{0,1}, avoids stack too deep errors
            address _token0 = token0;
            address _token1 = token1;
            require(to != _token0 && to != _token1, "UniswapV2: INVALID_TO");
            
            _transferAndReturnEuint64(_token0, to, amount0Out);
            _transferAndReturnEuint64(_token1, to, amount1Out);

            if (data.length > 0) IFHECallee(to).fheCall(msg.sender, amount0Out, amount1Out, data);
            balance0 = IERC7984(_token0).confidentialBalanceOf(address(this));
            balance1 = IERC7984(_token1).confidentialBalanceOf(address(this));
        }
        euint64 amount0In = FHE.select(balance0.gt(_reserve0.sub(amount0Out)), balance0.sub(_reserve0.sub(amount0Out)), FHE.asEuint64(0));
        euint64 amount1In = FHE.select(balance1.gt(_reserve1.sub(amount1Out)), balance1.sub(_reserve1.sub(amount1Out)), FHE.asEuint64(0));

        _update(balance0, balance1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }
}
