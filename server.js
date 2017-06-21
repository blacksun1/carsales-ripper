'use strict';

const fetch = require('node-fetch');
const assert = require('assert');
const cheerio = require('cheerio')
const url = require('url');
const crypto = require('crypto');
const fs = require('fs');
const util = require('util');

fs.readFileAsync = util.promisify(fs.readFile);
fs.statAsync = util.promisify(fs.stat);
fs.writeFileAsync = util.promisify(fs.writeFile);
fs.mkdirAsync = util.promisify(fs.mkdir);


main('https://www.carsales.com.au/cars/results?q=%28And.Service.Carsales._.%28C.Make.Subaru._.Model.Outback.%29_.GenericGearType.Automatic._.Price.range%280..20000%29._.Odometer.range%280..200000%29.%29&limit=24&sortby=~Odometer');


function extractCarsFromPage(html, baseUrl) {
    const cars = [];
    const $ = cheerio.load(html);

    $('.listing-item').each(function() {
        const car = {};
        const $this = $(this);
        $this.find('h2').each(function() {
            car.title = $(this.childNodes[0]).text().trim()
            const $this = $(this);
            car.url = new url.URL(url.resolve(baseUrl, $(this).parent('a').attr('href')));

            const findYear = /^(\d{4})/
            car.year = findYear.exec(car.title)[0];
        });
        $this.find('.price').each(function() {
            car.price = $(this).text().trim()
            car.price = car.price.replace('$', '');
            car.price = car.price.replace(',', '');
            car.price = car.price.replace('*', '');
            car.price = Number.parseInt(car.price);
        });
        $this.find('.feature-title').each(function() {
            const $feature = $(this);
            if ($feature.text() === 'Odometer') {
                const $odometer = $feature.parent().find('.feature-text');
                car.odometer = $odometer.text().trim();
                car.odometer = car.odometer.replace(',', '');
                car.odometer = car.odometer.replace(' km', '');
                car.odometer = Number.parseInt(car.odometer);
            }
        })
        $this.find('.state').each(function() {
            car.state = $(this).text();
        });

        if (car.title && car.title.length > 0) {
            cars.push(car);
        }
    });

    let nextUrl;
    const $next = $('.next a');
    if ($next.length > 0) {
        nextUrl = url.resolve(baseUrl, $next.first().attr('href'));
        console.log('NextURL:', nextUrl);
    }

    return [cars, nextUrl];
}

function displayCars(cars) {

    cars.forEach((car) => {
        console.log('Title:', car.title);
        console.log('URL', car.url.href);
        console.log('Year:', car.year, 'Price:', car.price.toLocaleString(), 'Odometer:', car.odometer.toLocaleString(), 'State:', car.state);
        console.log();
    });
}

function csvCars(cars) {

    console.log(['Odometer', 'Price', 'Year', 'State', 'Title', 'URL'].join(','));
    cars.forEach((car) => {
        console.log([car.odometer, car.price, car.year, car.state, `"${car.title}"`, `"${car.url}"`].join(','));
    });
}

async function getCachedPage(url) {

    try {
        const urlHash = crypto.createHash('sha256');
        urlHash.update(url);
        const fileName = './cache/' + urlHash.digest('hex');
        const fileStat = await fs.statAsync(fileName);
        if (((new Date()).valueOf() - fileStat.mtimeMs) / 1000 / 60 / 60 > 1) {
            console.log('Page has expired from cache');
            return;
        }
        const fileBody = await fs.readFileAsync(fileName);

        return fileBody;
    } catch (err) {

        if (err.code === 'ENOENT') {
            return;
        }

        console.log(err);
    }
}

async function cachePage(url, content) {

    try {
        const urlHash = crypto.createHash('sha256');
        urlHash.update(url);
        const urlHashDigest = urlHash.digest('hex')
        let notSaved = true;

        do {
            try {
                await fs.writeFileAsync('./cache/' + urlHashDigest, content);

                return true;
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    throw err;
                }
            }

            await fs.mkdirAsync('./cache');
        } while (notSaved);
    } catch (err) {

        console.log(err);

        return false
    }
}

async function getUrl(url) {
    let page = await getCachedPage(url);

    if (!page) {
        console.log('Fetching page');

        let tryAgain = false;
        let tries = 0;
        let req;
        do {
            try {
                tryAgain = false;
                req = await fetch(url, { timeout: 30000 });
            } catch (err) {
                if (err.name === 'FetchError' && err.type === 'request-timeout') {
                    if (tries >= 3) {
                        console.error('Connection timeout, no more tries left');
                        throw err;
                    }
                    console.log('Connection timeout, try again');
                    tryAgain = true;
                    tries++;
                } else {
                    throw err;
                }
            }
        } while (tryAgain)

        assert.equal(req.status, 200);
        console.log('Page fetched');

        page = await req.text();
        if (cachePage(url, page)) {
            console.log('Request cached');
        } else {
            console.log('Request could not be cached');
        }
    }

    return page;
}

async function main(pageUrl) {

    try {
        const listingUrl = new url.URL(pageUrl);
        let html;

        let cars = [];
        let newCars;
        let nextPage = listingUrl.href;
        do {
            html = await getUrl(nextPage);
            [newCars, nextPage] = extractCarsFromPage(html, listingUrl.href);
            cars = cars.concat(newCars);
        } while (nextPage)
        csvCars(cars);
    } catch(err) {

        console.error('Error', err);
    }
}