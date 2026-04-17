import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const deployerKey = process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "0".repeat(64);

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    kite_testnet: {
      url: "https://rpc-testnet.gokite.ai",
      chainId: 2368,
      accounts: [deployerKey],
    },
    kite_mainnet: {
      url: "https://rpc.gokite.ai",
      chainId: 2366,
      accounts: [deployerKey],
    },
  },
  etherscan: {
    apiKey: {
      kite_testnet: process.env.ETHERSCAN_API_KEY ?? "placeholder",
      kite_mainnet: process.env.ETHERSCAN_API_KEY ?? "placeholder",
    },
    customChains: [
      {
        network: "kite_testnet",
        chainId: 2368,
        urls: {
          apiURL: "https://testnet.kitescan.ai/api",
          browserURL: "https://testnet.kitescan.ai",
        },
      },
      {
        network: "kite_mainnet",
        chainId: 2366,
        urls: {
          apiURL: "https://kitescan.ai/api",
          browserURL: "https://kitescan.ai",
        },
      },
    ],
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
};

export default config;
