# Zama Challenge

The challenge: write a Constant Function Market Maker (CFMM) smart contract using fhEVM.

## How to run

To run the code, do the following steps:

1. Clone this repo
2. Install dependencies: `npm install`
3. Run the tests: `npx hardhat test`

## The smart contract

I wrote a constant sum market maker. The idea was to write a constant product market maker based on Uniswap V2. However, there isn't a way to multiply 2 encoded values or to calculate the square root of an encrypted value. Another issue was that there isn't a way to compare two encoded values and have a regular `bool` as result. This prevents the use of `if`, `while`, and other statements that require a `bool` value. So there isn't a way to `revert` the transaction if, for example, one encoded value is lower than another encoded value.

I wasn't able to make all the necessary checks and revert if any requirement is not met. Therefore, I had to go with a simpler application: a constant sum market maker ($ k = x + y $).

If I had more time, I would have gotten more familiarized with the FHE library and figure out a better way of doing the checks throughout the contract.
