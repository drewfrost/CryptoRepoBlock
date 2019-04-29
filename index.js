const express = require("express");
const bodyParser = require("body-parser");
const request = require("request");
const path = require("path");

const PubSub = require("./src/pubsub");
const Blockchain = require("./src/blockchain/blockchain");
const Wallet = require("./src/wallet/wallet");
const TransactionPool = require("./src/wallet/transactionPool");
const Miner = require("./src/miner");

const app = express();
const blockchain = new Blockchain();
const wallet = new Wallet();
const transactionPool = new TransactionPool();
const pubsub = new PubSub({ blockchain, transactionPool });
const miner = new Miner({ blockchain, transactionPool, wallet, pubsub });

const DEFAULT_PORT = 3000;
const ROOT_NODE_ADDRESS = `http://localhost:${DEFAULT_PORT}`;

app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, "client/build")));
//Showing existing blocks
app.get("/api/blocks", (req, res) => {
  res.json(blockchain.chain);
});

//mining blocks to the blockchain
app.post("/api/mine", (req, res) => {
  const { data } = req.body;

  blockchain.addBlock({ data });
  pubsub.transmitChain();
  res.redirect("/api/blocks");
});

//Transacting to another user
app.post("/api/transact", (req, res) => {
  const { amount, receiver } = req.body;

  let transaction = transactionPool.existingTransaction({
    inputAddress: wallet.publicKey
  });
  try {
    if (transaction) {
      transaction.update({ senderWallet: wallet, receiver, amount });
    } else {
      transaction = wallet.createTransaction({
        receiver,
        amount,
        chain: blockchain.chain
      });
    }
  } catch (error) {
    return res.status(400).json({ type: "error", message: error.message });
  }

  transactionPool.setTransaction(transaction);
  pubsub.transmitTransaction(transaction);
  res.json({ type: "success", transaction });
});

app.get("/api/transaction-pool-map", (req, res) => {
  res.json(transactionPool.transactionMap);
});

app.get("/api/mine-transactions", (req, res) => {
  miner.mineTransactions();
  res.redirect("/api/blocks");
});

app.get("/api/wallet-info", (req, res) => {
  const address = wallet.publicKey;
  res.json({
    address,
    balance: Wallet.calculateBalance({
      chain: blockchain.chain,
      address
    })
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "client/build/index.html"));
});

// Synchronizing peers with main chain
const syncWithNetwork = () => {
  request(
    { url: `${ROOT_NODE_ADDRESS}/api/blocks` },
    (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const rootChain = JSON.parse(body);
        console.log("Syncing chain with", rootChain);
        blockchain.alterChain(rootChain);
      }
    }
  );
  request(
    { url: `${ROOT_NODE_ADDRESS}/api/transaction-pool-map` },
    (error, response, body) => {
      if (!error && response.statusCode === 200) {
        const rootTransactionPoolMap = JSON.parse(body);

        console.log("Syncing transactions with ", rootTransactionPoolMap);
        transactionPool.setMap(rootTransactionPoolMap);
      }
    }
  );
};

const testWallet1 = new Wallet();
const testWallet2 = new Wallet();

const generateWalletTransaction = ({ wallet, receiver, amount }) => {
  const transaction = wallet.createTransaction({
    receiver,
    amount,
    chain: blockchain.chain
  });

  transactionPool.setTransaction(transaction);
};

const walletAction = () =>
  generateWalletTransaction({
    wallet,
    receiver: testWallet1.publicKey,
    amount: 30
  });

const testWallet1Action = () =>
  generateWalletTransaction({
    wallet: testWallet1,
    receiver: testWallet2,
    amount: 20
  });

const testWallet2Action = () => {
  generateWalletTransaction({
    wallet: testWallet2,
    receiver: wallet.publicKey,
    amount: 15
  });
};

for (let i = 0; i < 10; i++) {
  if (i % 3 === 0) {
    walletAction();
    testWallet1Action();
  } else if (i % 3 === 1) {
    walletAction();
    testWallet2Action();
  }else{
    testWallet1Action();
    testWallet2Action();
  }
  miner.mineTransactions();
}



let PEER_PORT;
//Creating new peeers
if (process.env.GENERATE_PEER_PORT === "true") {
  PEER_PORT = DEFAULT_PORT + Math.ceil(Math.random() * 1000);
}

const PORT = PEER_PORT || DEFAULT_PORT;
app.listen(PORT, () => {
  console.log(`App is listening on localhost:${PORT}`);
  if (PORT !== DEFAULT_PORT) {
    syncWithNetwork();
  }
});
