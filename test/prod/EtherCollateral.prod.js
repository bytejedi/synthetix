const { contract, config } = require('hardhat');
const { web3 } = require('hardhat');
const { assert } = require('../contracts/common');
const { toUnit } = require('../utils')();
const {
	connectContracts,
	ensureAccountHasEther,
	ensureAccountHassUSD,
	skipWaitingPeriod,
	setup,
} = require('./utils');

contract('EtherCollateral (prod tests)', accounts => {
	const [, user1] = accounts;

	let owner;

	let network, deploymentPath;

	let EtherCollateral, ReadProxyAddressResolver, Depot;
	let SynthsETH, SynthsUSD;

	before('prepare', async function() {
		if (config.useOvm) {
			return this.skip();
		}

		network = config.targetNetwork;
		({ owner, deploymentPath } = await setup({ network }));

		({
			EtherCollateral,
			SynthsETH,
			SynthsUSD,
			ReadProxyAddressResolver,
			Depot,
		} = await connectContracts({
			network,
			requests: [
				{ contractName: 'EtherCollateral' },
				{ contractName: 'Depot' },
				{ contractName: 'ReadProxyAddressResolver' },
				{ contractName: 'SynthsETH', abiName: 'Synth' },
				{ contractName: 'SynthsUSD', abiName: 'Synth' },
			],
		}));

		await skipWaitingPeriod({ network });

		await ensureAccountHasEther({
			amount: toUnit('1'),
			account: owner,
			fromAccount: accounts[7],
			network,
			deploymentPath,
		});
		await ensureAccountHassUSD({
			amount: toUnit('1000'),
			account: user1,
			fromAccount: owner,
			network,
			deploymentPath,
		});
	});

	describe('misc state', () => {
		it('has the expected resolver set', async () => {
			assert.equal(await EtherCollateral.resolver(), ReadProxyAddressResolver.address);
		});

		it('has the expected owner set', async () => {
			assert.equal(await EtherCollateral.owner(), owner);
		});
	});

	describe('opening a loan', () => {
		const amount = toUnit('1');

		let ethBalance, sEthBalance;
		let tx;
		let loanID;

		before(async () => {
			ethBalance = await web3.eth.getBalance(user1);
			sEthBalance = await SynthsETH.balanceOf(user1);

			tx = await EtherCollateral.openLoan({
				from: user1,
				value: amount,
			});
		});

		it('produces a valid loan id', async () => {
			({ loanID } = tx.receipt.logs.find(log => log.event === 'LoanCreated').args);

			assert.notEqual(loanID.toString(), '0');
		});

		describe('closing a loan', () => {
			before(async () => {
				if (network === 'local') {
					const amount = toUnit('1000');

					const balance = await SynthsUSD.balanceOf(Depot.address);
					if (balance.lt(amount)) {
						await SynthsUSD.approve(Depot.address, amount, {
							from: user1,
						});

						await Depot.depositSynths(amount, {
							from: user1,
						});
					}
				}

				ethBalance = await web3.eth.getBalance(user1);
				sEthBalance = await SynthsETH.balanceOf(user1);

				await EtherCollateral.closeLoan(loanID, {
					from: user1,
				});
			});

			it('reimburses ETH', async () => {
				assert.bnGt(web3.utils.toBN(await web3.eth.getBalance(user1)), web3.utils.toBN(ethBalance));
			});

			it('deducts sETH', async () => {
				assert.bnLt(await SynthsETH.balanceOf(user1), sEthBalance);
			});
		});
	});
});
