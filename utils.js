"use strict";

var _ = require('underscore');
const log = require('ololog').configure({ locate: false })
const main = require('./arbitrage_main.js')
const sleep_for = ms => new Promise(resolve => setTimeout(resolve, ms));

var InMarketArbitrages = [];
var DoneArbitrages = [];

require('ansicolor').nice;

// Returns a double as a string '##.##%'
function percToStr(perc) {
    return (perc * 100.0).toFixed(2) + '%'
}

function ArbitrageOpportunity(symbol, exchLong, exchShort, feesLong, feesShort, priceLong, priceShort, spreadIn, spreadTarget) {
    this.Symbol = symbol;
    this.ExchLong = exchLong;
    this.ExchShort = exchShort;
    this.FeesLong = feesLong;
    this.FeesShort = feesShort;
    this.PriceLongIn = priceLong;
    this.PriceShortIn = priceShort;
    this.PriceLongOut = 0.0;
    this.PriceShortOut = 0.0;
    this.VolumeLong = 0.0;
    this.VolumeShort = 0.0;
    this.LongOrderId = 0;
    this.ShortOrderId = 0;
    this.SpreadIn = spreadIn;
    this.EntryTime = new Date();
    this.ExitTime = new Date();
    this.ExitTarget = spreadIn - spreadTarget - 2.0 * (feesLong + feesShort);
    this.InMarket = false;
    this.Profit = function() {
        let diffLong = (this.PriceLongIn - this.PriceLongOut) * 2 * feesLong;
        let diffShort = (this.PriceShortIn - this.PriceShortOut) * 2 * feesShort;
        // TODO profit calculation
        // Profit = Revenu - Depense
    }
}

async function getLimitPrice(symbol, exchange, volume, isBid, orderBookFactor) {

    try {
        var OrderBook = await exchange.fetchOrderBook(symbol);
    } catch (e) {
        main.log(e.message)
        return 0;
    }

    if (isBid)
        OrderBook = OrderBook.bids; // short
    else
        OrderBook = OrderBook.asks; // long

    let tmpVol = 0.0;
    let p = 0.0;
    let v;

    // Loop on volume now
    for (let i = 0; i < OrderBook.length; i++) {
        p = OrderBook[i][0]; // Price
        v = OrderBook[i][1]; // Volume

        // Cumulative volume in order to fill order as quick as possible
        tmpVol += v;
        if (tmpVol >= Math.abs(volume) * orderBookFactor)
            break;
    }
    return p;
}

async function isOrderComplete(exchange, orderId) {
    if (orderId == "0") return true;

    const order = await exchange.fetchOrder(orderId);
    if (order.status == 'open')
        return false;
    else
        return true;
}

async function entryMarket(arbitrageOpportunity, params) {

    let symbol = arbitrageOpportunity.Symbol;
    let volumeLong = params.exposure / arbitrageOpportunity.PriceLongIn;
    let volumeShort = params.exposure / arbitrageOpportunity.PriceShortIn;
    let limPriceLong = await getLimitPrice(arbitrageOpportunity.Symbol, arbitrageOpportunity.ExchLong, volumeLong, false, params.orderBookFactor);
    let limPriceShort = await getLimitPrice(arbitrageOpportunity.Symbol, arbitrageOpportunity.ExchShort, volumeShort, true, params.orderBookFactor);

    let longOrderId = 0;
    let shortOrderId = 0;

    if (limPriceLong === 0.0 || limPriceShort === 0.0) {
        main.log('EntryMarket not possible, limPrice long or short at zero, Trade cancelled');
        return;
    }

    arbitrageOpportunity.PriceLongIn = limPriceLong;
    arbitrageOpportunity.PriceShortIn = limPriceShort;

    main.log('Buy order ' + symbol, 'on ' + arbitrageOpportunity.ExchLong.name + ' ' + volumeLong.toFixed(8) + ' @ ' + limPriceLong)
    main.log('Sell order ' + symbol, 'on ' + arbitrageOpportunity.ExchShort.name + ' ' + volumeShort.toFixed(8) + ' @ ' + limPriceShort)

    // If not in demo send orders
    if (!params.demoMode) {
        // Send the orders to the two exchanges
        longOrderId = arbitrageOpportunity.ExchLong.createMarketBuyOrder(symbol, volumeLong, limPriceLong);
        shortOrderId = arbitrageOpportunity.ExchShort.createLimitSellOrder(symbol, volumeShort, limPriceShort);

        main.log('Waiting for the two orders to be filled...');
        await sleep_for(5000);

        let isLongOrderComplete = await isOrderComplete(arbitrageOpportunity.ExchLong, longOrderId);
        let isShortOrderComplete = await isOrderComplete(arbitrageOpportunity.ExchShort, shortOrderId);

        // Loops until both orders are completed
        while (!isLongOrderComplete || !isShortOrderComplete) {
            await sleep_for(3000);
            if (!isLongOrderComplete) {
                main.log("Long order on " + arbitrageOpportunity.ExchLong.name + " still open...");
                isLongOrderComplete = await isOrderComplete(arbitrageOpportunity.ExchLong, longOrderId);
            }
            if (!isShortOrderComplete) {
                main.log("Short order on " + arbitrageOpportunity.ExchShort.name + " still open...");
                isShortOrderComplete = await isOrderComplete(arbitrageOpportunity.ExchShort, shortOrderId);
            }
        }
    }
    main.log('Orders done for ' + symbol)

    // We are now in market, update arbitrage
    arbitrageOpportunity.InMarket = true;
    arbitrageOpportunity.LongOrderId = longOrderId;
    arbitrageOpportunity.ShortOrderId = shortOrderId;
    arbitrageOpportunity.VolumeLong = volumeLong;
    arbitrageOpportunity.VolumeShort = volumeShort;
    arbitrageOpportunity.EntryTime = new Date();

    // Add the arbitrage to a list of in market arb
    InMarketArbitrages.push(arbitrageOpportunity);

    // log arbitrage
    main.LogArbitrageToTable(arbitrageOpportunity)
}

async function exitMarket(arbitrage, params) {

    let symbol = arbitrage.Symbol;
    let volumeLong = arbitrage.VolumeLong;
    let volumeShort = arbitrage.VolumeShort;
    let limPriceLong = await getLimitPrice(symbol, arbitrage.ExchLong, volumeLong, false, params.orderBookFactor);
    let limPriceShort = await getLimitPrice(symbol, arbitrage.ExchShort, volumeShort, true, params.orderBookFactor);

    if (limPriceLong === 0.0 || limPriceShort === 0.0) {
        main.log('ExitMarket not possible, limPrice long or short at zero, Trade cancelled');
        return;
    }

    arbitrage.PriceLongOut = limPriceLong;
    arbitrage.PriceShortOut = limPriceShort;

    main.log('Close positions :')
    main.log('Sell order ' + symbol + ' on ' + arbitrage.ExchLong.name + ' ' + volumeLong.toFixed(8) + ' @ ' + limPriceLong)
    main.log('Buy order ' + symbol + ' on ' + arbitrage.ExchShort.name + ' ' + volumeShort.toFixed(8) + ' @ ' + limPriceShort)

    // If not in demo send orders
    if (!params.demoMode) {
        // Send the orders to the two exchanges
        // TODO Change Buy/Sell
        let longOrderId = arbitrage.ExchLong.createMarketBuyOrder(symbol, volumeLong, limPriceLong);
        let shortOrderId = arbitrage.ExchShort.createLimitSellOrder(symbol, volumeShort, limPriceShort);

        longOrderId = sendLongOrder(params, "sell", fabs(btcUsed[res.idExchLong]), limPriceLong);
        shortOrderId = sendShortOrder(params, "buy", fabs(btcUsed[res.idExchShort]), limPriceShort);

        main.log('Waiting for the two orders to be filled...');
        await sleep_for(5000);

        let isLongOrderComplete = await isOrderComplete(arbitrage.ExchLong, longOrderId);
        let isShortOrderComplete = await isOrderComplete(arbitrage.ExchShort, shortOrderId);

        // Loops until both orders are completed
        while (!isLongOrderComplete || !isShortOrderComplete) {
            await sleep_for(3000);
            if (!isLongOrderComplete) {
                main.log("Long order on " + arbitrage.ExchLong.name + " still open...");
                isLongOrderComplete = await isOrderComplete(arbitrage.ExchLong, longOrderId);
            }
            if (!isShortOrderComplete) {
                main.log("Short order on " + arbitrage.ExchShort.name + " still open...");
                isShortOrderComplete = await isOrderComplete(arbitrage.ExchShort, shortOrderId);
            }
        }
    }
    main.log('Orders done for ' + symbol)

    // We are now out market
    arbitrage.InMarket = false;
    arbitrage.ExitTime = new Date();

    // Add the arbitrage to a list of in market arb and remove from InMarket arb list
    let ind = InMarketArbitrages.findIndex(i => (i.Symbol === arbitrage.Symbol && i.ExchLong.name === arbitrage.ExchLong.name));
    InMarketArbitrages.splice(ind, 1);
    DoneArbitrages.push(arbitrage);

    // log arbitrage
    main.LogArbitrageToTable(arbitrage)
    main.LogArbitrageDoneToTable(arbitrage)
}

function getInMarketArbitrage(symbol, exchLong, exchShort) {
    return InMarketArbitrages.filter(function(e) { return e.Symbol == symbol && e.ExchLong == exchLong && e.ExchShort == exchShort });
}

module.exports = {

    ExchangeTicker: function(exchange, ticker) {
        this.Exchange = exchange;
        this.Ticker = ticker;
        return this;
    },

    checkEntry: function(symbol, listExchangeTicker, params) {

        for (let i = 0; i < listExchangeTicker.length; i++) {
            for (let j = i + 1; j < listExchangeTicker.length; j++) {
                let spreadIn;
                let arbitragePossible = false;
                let exchLong = listExchangeTicker[i].Exchange;
                let exchShort = listExchangeTicker[j].Exchange;

                // Gets the prices and computes the spread
                let priceLong = listExchangeTicker[i].Ticker['ask'];
                let priceShort = listExchangeTicker[j].Ticker['bid'];

                // If the prices are null we return a null spread
                // to avoid false opportunities
                if (priceLong > 0.0 && priceShort > 0.0) {
                    spreadIn = (priceShort - priceLong) / priceLong;
                } else {
                    spreadIn = 0.0;
                }

                if (spreadIn > params.spreadEntry) {
                    arbitragePossible = true;
                }

                let arbOpportunity = new ArbitrageOpportunity(symbol, exchLong, exchShort, 0.002, 0.002, priceLong, priceShort, spreadIn, params.spreadTarget)

                let InMarketArbitragesFound = getInMarketArbitrage(symbol, exchLong, exchShort)
                if (InMarketArbitragesFound.length > 0) {
                    InMarketArbitragesFound[0].InMarket = true;
                    main.LogArbitrageToTable(InMarketArbitragesFound[0])
                    main.log('Symbol: ' + InMarketArbitragesFound[0].Symbol + ' Exch: ' + exchLong.name + '/' + exchShort.name + ' ExitTarget: ' + percToStr(InMarketArbitragesFound[0].ExitTarget) + ' SpreadIn: ' + percToStr(spreadIn) + ' poss: ' + arbitragePossible)
                    continue;
                }

                main.LogArbitrageToTable(arbOpportunity)
                main.log('Symbol: ' + arbOpportunity.Symbol + ' Exch: ' + exchLong.name + '/' + exchShort.name + ' ExitTarget: ' + percToStr(arbOpportunity.ExitTarget) + ' SpreadIn: ' + percToStr(spreadIn))

                if (arbitragePossible === true) {
                    entryMarket(arbOpportunity, params);
                }
            }
        }
    },

    checkExit: function(symbol, listExchangeTicker, params) {

        for (let i = 0; i < listExchangeTicker.length; i++) {
            for (let j = i + 1; j < listExchangeTicker.length; j++) {

                let spreadOut;
                let exchLong = listExchangeTicker[i].Exchange;
                let exchShort = listExchangeTicker[j].Exchange;

                //  InMarketArbitrages
                var arbitrage = InMarketArbitrages.find(o => o.Symbol === symbol && o.ExchLong.name === exchLong.name && o.ExchShort.name === exchShort.name);

                if (arbitrage === undefined)
                    continue;

                // Gets the prices and computes the spread
                let priceLong = listExchangeTicker[i].Ticker['ask'];
                let priceShort = listExchangeTicker[j].Ticker['bid'];

                if (priceLong > 0.0 && priceShort > 0.0) {
                    spreadOut = (priceShort - priceLong) / priceLong;
                } else {
                    main.log('Error checkExit priceLong & priceShort = 0'.red)
                    return;
                }

                // TESTING : Remove comment
                //if (spreadOut > arbitrage.ExitTarget) {
                if (spreadOut < arbitrage.ExitTarget) {

                    main.log('Exit Opportunity Found !'.red)

                    // Update value and call exitMarket
                    arbitrage.PriceLongOut = priceLong;
                    arbitrage.PriceShortOut = priceShort;
                    exitMarket(arbitrage, params);
                }
            }
        }
    },

    GetInMarketArbitrages: function() {
        return InMarketArbitrages;
    },

};