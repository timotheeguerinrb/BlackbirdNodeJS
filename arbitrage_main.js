"use strict";

const ccxt = require('ccxt')
const asTable = require('as-table')
const utils = require('./utils.js')
const sleep_for = ms => new Promise(resolve => setTimeout(resolve, ms));

const log4js = require('log4js');
log4js.configure({
    appenders: { log: { type: 'file', filename: 'output.log' } },
    categories: { default: { appenders: ['log'], level: 'all' } }
});

const logger = log4js.getLogger('log');

var blessed = require('blessed');
var contrib = require('blessed-contrib');
var screen = blessed.screen();

require('ansicolor').nice;

let GDAX = {
    key: '283b131a9b6930dd2b8f9634eb2c6ced',
    secret: 'tIaSDHiw8scCUZDNyu9MIP6rgDmcQl2VWU8gfD++LtBfY+BWO+MY0FozM+b0rKRqx8BnlhSPWH8/6wHDltGvRA==',
    password: '88vwpik621l'
}

let params = {
    demoMode: true,
    spreadEntry: 0.0050,
    spreadTarget: 0.0050,
    exposure: 10,
    orderBookFactor: 3.0
}


var grid = new contrib.grid({ rows: 12, cols: 12, screen: screen })

var log = grid.set(0, 7, 6, 5, contrib.log, {
    fg: "green",
    selectedFg: "green",
    label: 'Logs'
})

var table = grid.set(0, 0, 6, 7, contrib.table, {
    keys: true,
    fg: 'white',
    interactive: false,
    label: 'Searching Opportunity',
    width: '70%',
    height: '50%',
    border: { type: "line", fg: "cyan" },
    columnSpacing: 10, //in chars
    columnWidth: [8, 10, 10, 10, 10]
})

var tableArbitragesDone = grid.set(6, 0, 6, 12, contrib.table, {
    keys: true,
    fg: 'white',
    interactive: false,
    label: 'Arbitrages Done',
    width: '70%',
    height: '50%',
    border: { type: "line", fg: "cyan" },
    columnSpacing: 10, //in chars
    columnWidth: [10, 10, 10, 24, 24, 10, 10]
})

table.setData({
    headers: ['Symbol', 'ExchLong', 'ExchShort', 'ExitTarget %', 'SpreadIn %'],
    data: []
})
var tableData = [];

tableArbitragesDone.setData({
    headers: ['Symbol', 'ExchLong', 'ExchShort', 'EntryTime', 'ExitTime', 'Duration', 'Profit'],
    data: []
})
var tableArbitragesDoneData = [];

// Returns a double as a string '##.##%'
function percToStr(perc) {
    return (perc * 100.0).toFixed(2) + '%'
}

exports.LogArbitrageToTable = function(arbitrage) {

    let row = []
    let isFound = false
    row.push(arbitrage.Symbol)
    row.push(arbitrage.ExchLong.name)
    row.push(arbitrage.ExchShort.name)

    if (arbitrage.InMarket) {
        row.push(percToStr(arbitrage.ExitTarget).green)
        row.push(percToStr(arbitrage.SpreadIn).green)
    } else {
        row.push(percToStr(arbitrage.ExitTarget).red)
        row.push(percToStr(arbitrage.SpreadIn).red)
    }

    // Replace existing element from array
    for (let i = 0; i < tableData.length; i++) {
        if (tableData[i][0] === arbitrage.Symbol &&
            tableData[i][1] === arbitrage.ExchLong.name &&
            tableData[i][2] === arbitrage.ExchShort.name) {

            isFound = true;
            tableData[i] = row;
        }
    }
    if (!isFound) tableData.push(row)

    table.setData({
        headers: ['Symbol', 'ExchLong', 'ExchShort', 'ExitTarget %', 'SpreadIn %'],
        data: tableData
    })
    screen.render()
}

exports.LogArbitrageDoneToTable = function(arbitrage) {

    let row = []
    row.push(arbitrage.Symbol)
    row.push(arbitrage.ExchLong.name)
    row.push(arbitrage.ExchShort.name)
    row.push(arbitrage.EntryTime.toISOString())
    row.push(arbitrage.ExitTime.toISOString())
    row.push(human_value_date_diff(arbitrage.ExitTime - arbitrage.EntryTime))

    row.push('Profit')

    tableArbitragesDoneData.push(row)

    tableArbitragesDone.setData({
        headers: ['Symbol', 'ExchLong', 'ExchShort', 'EntryTime', 'ExitTime', 'Duration', 'Profit'],
        data: tableArbitragesDoneData
    })
    screen.render()
}

exports.log = function(message) {
    logger.trace(message)
    log.log(message)
    screen.render()
}

screen.key(['escape', 'q', 'C-c'], function(ch, key) {
    return process.exit(0);
});
screen.render()

let printSupportedExchanges = function() {
    log.log('Supported exchanges:', ccxt.exchanges.join(', ').green)
}

let printUsage = function() {
    log.log('Usage: node', process.argv[1], 'id1'.green, 'id2'.yellow, 'id3'.blue, '...')
    printSupportedExchanges()
}

let printExchangeSymbolsAndMarkets = function(exchange) {
    log.log(getExchangeSymbols(exchange))
    log.log(getExchangeMarketsTable(exchange))
}

let getExchangeMarketsTable = (exchange) => {
    return asTable.configure({ delimiter: ' | ' })(Object.values(markets))
}

let sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

let proxies = [
    '', // no proxy by default
    'https://crossorigin.me/',
    'https://cors-anywhere.herokuapp.com/',
];

function human_value(price) {
    return typeof price == 'undefined' ? 'N/A' : price
}

function human_value_date_diff(diffDateTime) {
    let secs = Math.round(diffDateTime / 1000);
    let mins = Math.round(diffDateTime / 60000);
    var hours = Math.round(diffDateTime) / 36e5;

    if (hours > 1)
        return hours.toFixed(2) + ' hours'
    else if (mins > 1)
        return mins.toFixed(2) + ' mins'
    else
        return secs.toFixed(2) + ' secs'
}

(async function main() {

    if (process.argv.length > 3) {

        let ids = process.argv.slice(2)
        let exchanges = {}

        log.log(ids.join(', ').yellow)

        // load all markets from all exchanges 
        for (let id of ids) {

            // instantiate the exchange by id
            let exchange;
            if (id === 'gdax') {
                exchange = new ccxt[id]({
                    'apiKey': GDAX.key,
                    'secret': GDAX.secret,
                    'password': GDAX.password,
                })
                if (params.demoMode)
                    gdax.urls['api'] = 'https://api-public.sandbox.gdax.com'
            } else if (id === '') {

            } else
                exchange = new ccxt[id]()

            // save it in a dictionary under its id for future use
            exchanges[id] = exchange

            // load all markets from the exchange
            let markets = await exchange.loadMarkets()

            // basic round-robin proxy scheduler
            let currentProxy = 0
            let maxRetries = proxies.length

            for (let numRetries = 0; numRetries < maxRetries; numRetries++) {

                try { // try to load exchange markets using current proxy

                    exchange.proxy = proxies[currentProxy]
                    await exchange.loadMarkets()

                } catch (e) { // rotate proxies in case of connectivity errors, catch all other exceptions

                    // swallow connectivity exceptions only
                    if (e instanceof ccxt.DDoSProtection || e.message.includes('ECONNRESET')) {
                        log.log('[DDoS Protection Error] ' + e.message)
                    } else if (e instanceof ccxt.RequestTimeout) {
                        log.log('[Timeout Error] ' + e.message)
                    } else if (e instanceof ccxt.AuthenticationError) {
                        log.log('[Authentication Error] ' + e.message)
                    } else if (e instanceof ccxt.ExchangeNotAvailable) {
                        log.log('[Exchange Not Available Error] ' + e.message)
                    } else if (e instanceof ccxt.ExchangeError) {
                        log.log('[Exchange Error] ' + e.message)
                    } else {
                        log.log('[Other Error] '.red + e.message)
                    }

                    // retry next proxy in round-robin fashion in case of error
                    currentProxy = ++currentProxy % proxies.length
                }
            }

            log.log(id.green, 'loaded', exchange.symbols.length.green, 'markets')
        }

        log.log('Loaded all markets'.green)

        // get all unique symbols
        let uniqueSymbols = ccxt.unique(ccxt.flatten(ids.map(id => exchanges[id].symbols)))

        // filter out symbols that are not present on at least two exchanges
        let arbitrableSymbols = uniqueSymbols
            .filter(symbol =>
                ids.filter(id =>
                    (exchanges[id].symbols.indexOf(symbol) >= 0)).length > 1)
            .sort((id1, id2) => (id1 > id2) ? 1 : ((id2 > id1) ? -1 : 0))

        while (1) {

            // Dico with symbol as key and array of exchangeTicker per key
            // ['BTC/USD'].[{exchangeA, ticker},{exchangeB, ticker},{exchangeC, ticker}]
            let dicoMarkets = {}

            // For each symbol get tickers on each exchanges
            for (let symbol of arbitrableSymbols) {
                for (let id of ids) {

                    // if the exchange contains the symbol
                    if (exchanges[id].symbols.indexOf(symbol) >= 0) {

                        try {
                            var ticker = await exchanges[id].fetchTicker(symbol)
                        } catch (e) {
                            if (e instanceof ccxt.DDoSProtection || e.message.includes('ECONNRESET')) {
                                log.log('[DDoS Protection Error] '.red + e.message)
                            } else if (e instanceof ccxt.RequestTimeout) {
                                log.log('[Timeout Error] '.red + e.message)
                            } else if (e instanceof ccxt.AuthenticationError) {
                                log.log('[Authentication Error] '.red + e.message)
                            } else if (e instanceof ccxt.ExchangeNotAvailable) {
                                log.log('[Exchange Not Available Error] '.red + e.message)
                            } else if (e instanceof ccxt.ExchangeError) {
                                log.log('[Exchange Error] '.red + e.message)
                            } else {
                                log.log('[Other Error] '.red + e.message)
                            }
                        }

                        let exchTicker = new utils.ExchangeTicker(exchanges[id], ticker)

                        if (!dicoMarkets[symbol]) {
                            dicoMarkets[symbol] = []
                        }
                        dicoMarkets[symbol].push(exchTicker)
                    }
                }
                // Check entry for the symbol and compatible exchanges
                utils.checkEntry(symbol, dicoMarkets[symbol], params);
                utils.checkExit(symbol, dicoMarkets[symbol], params);
            }
            await sleep_for(30000); // Wait 30 seconds
            log.log('New loop on exchanges...')
        }
    } else {
        printUsage()
    }

    process.exit()
})()